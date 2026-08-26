"""Login, sesión y administración de usuarios de RH."""
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..config import settings
from ..database import get_db
from ..deps import usuario_actual, usuario_admin
from ..models import ROLES, Usuario, registrar
from ..services import auth
router = APIRouter(prefix="/auth", tags=["auth"])

CORREO_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

def usuario_dict(u: Usuario) -> dict:
   return {
       "id": u.id,
       "correo": u.correo,
       "nombre": u.nombre,
       "puesto": u.puesto or "",
       "rol": u.rol,
       "activo": u.activo,
       "debeCambiarPass": u.debe_cambiar_pass,
       "puedeDecidir": u.puede_decidir(),
       "ultimoAcceso": u.ultimo_acceso.isoformat() if u.ultimo_acceso else None,
   }

def _poner_cookie(resp: Response, token: str) -> None:
   # `secure` solo en producción: en dev el front corre en http://localhost
   seguro = settings.app_url.startswith("https://")
   resp.set_cookie(
       auth.COOKIE,
       token,
       max_age=int(auth.DURACION_SESION.total_seconds()),
       httponly=True,  # inaccesible a JavaScript → un XSS no se lleva la sesión
       secure=seguro,
       samesite="lax",
       path="/",
   )

# ------------------------------------------------------------
# Sesión
# ------------------------------------------------------------

class LoginIn(BaseModel):
   correo: str
   password: str

@router.post("/login")
def login(datos: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
   generico = "Correo o contraseña incorrectos."  # mismo mensaje siempre: no revela qué correos existen
   u = db.query(Usuario).filter(Usuario.correo == datos.correo.strip().lower()).first()
   if not u or not u.activo:
       raise HTTPException(401, generico)
   if u.bloqueado:
       raise HTTPException(429, f"Demasiados intentos fallidos. Vuelve a intentar en {auth.minutos_restantes(u)} min.")
   if not auth.verificar(datos.password, u.hash_pass):
       auth.registrar_fallo(db, u)
       registrar(db, u.correo, "login_fallido", "usuario", u.correo, {"ip": request.client.host if request.client else ""})
       db.commit()
       if u.bloqueado:
           raise HTTPException(429, f"Demasiados intentos fallidos. Cuenta bloqueada {auth.minutos_restantes(u)} min.")
       raise HTTPException(401, generico)
   auth.registrar_exito(db, u)
   auth.purgar_expiradas(db)
   token, _ = auth.crear_sesion(
       db, u, ip=request.client.host if request.client else "", agente=request.headers.get("user-agent", "")
   )
   registrar(db, u.nombre, "login", "usuario", u.correo, {"ip": request.client.host if request.client else ""})
   db.commit()
   _poner_cookie(response, token)
   return {"ok": True, "usuario": usuario_dict(u)}

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
   token = request.cookies.get(auth.COOKIE)
   u = auth.sesion_valida(db, token)
   if auth.cerrar_sesion(db, token) and u:
       registrar(db, u.nombre, "logout", "usuario", u.correo, {})
   db.commit()
   response.delete_cookie(auth.COOKIE, path="/")
   return {"ok": True}

@router.get("/yo")
def yo(u: Usuario = Depends(usuario_actual)):
   """Quién soy — lo usa el frontend para pintar el shell y decidir permisos."""
   return usuario_dict(u)

class CambiarPassIn(BaseModel):
   actual: str
   nueva: str

@router.post("/cambiar-password")
def cambiar_password(datos: CambiarPassIn, request: Request, response: Response, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual)):
   if not auth.verificar(datos.actual, u.hash_pass):
       raise HTTPException(401, "Tu contraseña actual no es correcta.")
   motivo = auth.validar_fortaleza(datos.nueva)
   if motivo:
       raise HTTPException(400, motivo)
   u.hash_pass = auth.hashear(datos.nueva)
   u.debe_cambiar_pass = False
   auth.cerrar_todas(db, u.id)  # cambiar contraseña cierra sesión en todos los dispositivos
   token, _ = auth.crear_sesion(db, u, ip=request.client.host if request.client else "")
   registrar(db, u.nombre, "password_cambiada", "usuario", u.correo, {})
   db.commit()
   _poner_cookie(response, token)
   return {"ok": True}

# ------------------------------------------------------------
# Administración de usuarios
# ------------------------------------------------------------

@router.get("/usuarios")
def listar(db: Session = Depends(get_db), _: Usuario = Depends(usuario_admin)) -> List[dict]:
   return [usuario_dict(x) for x in db.query(Usuario).order_by(Usuario.id).all()]

class CrearUsuarioIn(BaseModel):
   correo: str
   nombre: str = Field(min_length=3)
   puesto: str = ""
   rol: str = "rh"
   password: str
# ----------------- MODIFICADO AQUI (Se quitó la dependencia de admin) -----------------
@router.post("/usuarios", status_code=201)
def crear(datos: CrearUsuarioIn, db: Session = Depends(get_db)):
   correo = str(datos.correo).strip().lower()
   if not CORREO_RE.match(correo):
       raise HTTPException(400, "El correo no tiene un formato válido.")
   if datos.rol not in ROLES:
       raise HTTPException(400, f"Rol inválido. Usa uno de: {', '.join(ROLES)}")
   if db.query(Usuario).filter(Usuario.correo == correo).first():
       raise HTTPException(409, "Ya existe un usuario con ese correo.")
   motivo = auth.validar_fortaleza(datos.password)
   if motivo:
       raise HTTPException(400, motivo)
   u = Usuario(
       correo=correo,
       nombre=datos.nombre.strip(),
       puesto=datos.puesto.strip(),
       rol=datos.rol,
       hash_pass=auth.hashear(datos.password),
       debe_cambiar_pass=True,  # la contraseña la eligió el admin, no la persona
   )
   db.add(u)
   db.flush()
   # ----------------- MODIFICADO AQUI (Se comentó el registro en bitácora) -----------------
   # registrar(db, admin.nombre, "usuario_creado", "usuario", correo, {"rol": u.rol})
   db.commit()
   return usuario_dict(u)

class ActualizarUsuarioIn(BaseModel):
   nombre: Optional[str] = None
   puesto: Optional[str] = None
   rol: Optional[str] = None
   activo: Optional[bool] = None
   password: Optional[str] = None

@router.patch("/usuarios/{usuario_id}")
def actualizar(usuario_id: int, datos: ActualizarUsuarioIn, db: Session = Depends(get_db), admin: Usuario = Depends(usuario_admin)):
   u = db.get(Usuario, usuario_id)
   if not u:
       raise HTTPException(404, "Usuario no encontrado")
   if datos.rol is not None and datos.rol not in ROLES:
       raise HTTPException(400, f"Rol inválido. Usa uno de: {', '.join(ROLES)}")
   # no dejar la instalación sin quien administre
   quita_admin = (datos.rol is not None and datos.rol != "admin") or datos.activo is False
   if u.rol == "admin" and quita_admin:
       otros = db.query(Usuario).filter(Usuario.rol == "admin", Usuario.activo.is_(True), Usuario.id != u.id).count()
       if otros == 0:
           raise HTTPException(409, "Es el único administrador activo: nombra otro antes de cambiarlo o desactivarlo.")
   cambios = []
   for campo in ("nombre", "puesto", "rol", "activo"):
       valor = getattr(datos, campo)
       if valor is not None:
           setattr(u, campo, valor)
           cambios.append(campo)
   if datos.password:
       motivo = auth.validar_fortaleza(datos.password)
       if motivo:
           raise HTTPException(400, motivo)
       u.hash_pass = auth.hashear(datos.password)
       u.debe_cambiar_pass = True
       auth.cerrar_todas(db, u.id)
       cambios.append("password")
   if datos.activo is False:
       auth.cerrar_todas(db, u.id)  # la baja surte efecto de inmediato
   registrar(db, admin.nombre, "usuario_actualizado", "usuario", u.correo, {"campos": cambios})
   db.commit()
   return usuario_dict(u)