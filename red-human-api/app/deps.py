"""Dependencias de autorización.

`usuario_actual` es la única fuente de verdad sobre quién está operando: los
endpoints ya NO aceptan del cliente el nombre de quien decide, porque eso
permitiría firmar la bitácora a nombre de otra persona.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .models import Cuenta, Usuario, UsuarioCuenta
from .services import auth

CABECERA_CUENTA = "X-Cuenta-Id"


def _token(request: Request) -> Optional[str]:
    """La cookie es la vía normal; el Bearer existe para scripts e integraciones."""
    cookie = request.cookies.get(auth.COOKIE)
    if cookie:
        return cookie
    cabecera = request.headers.get("authorization", "")
    if cabecera.lower().startswith("bearer "):
        return cabecera[7:].strip()
    return None


def usuario_opcional(request: Request, db: Session = Depends(get_db)) -> Optional[Usuario]:
    return auth.sesion_valida(db, _token(request))


def usuario_actual(request: Request, db: Session = Depends(get_db)) -> Usuario:
    u = auth.sesion_valida(db, _token(request))
    if not u:
        raise HTTPException(401, "Tu sesión expiró o no has iniciado sesión.", headers={"WWW-Authenticate": "Cookie"})
    return u


def usuario_decisor(u: Usuario = Depends(usuario_actual)) -> Usuario:
    """Para acciones que firman la bitácora: el rol 'lectura' no puede."""
    if not u.puede_decidir():
        raise HTTPException(403, "Tu perfil es de solo lectura; pide a un administrador que te cambie el rol.")
    return u


def usuario_admin(u: Usuario = Depends(usuario_actual)) -> Usuario:
    if u.rol != "Administrador":
        raise HTTPException(403, "Solo un administrador puede hacer esto.")
    return u


def cuenta_actual(request: Request, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual)) -> Cuenta:
    """Cuenta sobre la que opera esta request. Si el usuario solo tiene una, se resuelve
    sola — el frontend no manda nada. Si tiene varias, debe mandar la cabecera X-Cuenta-Id."""
    cuentas = (
        db.query(Cuenta)
        .join(UsuarioCuenta, UsuarioCuenta.cuenta_id == Cuenta.id)
        .filter(UsuarioCuenta.usuario_id == u.id, Cuenta.estado == "Activa")
        .order_by(Cuenta.id)
        .all()
    )
    if not cuentas:
        raise HTTPException(403, "Tu usuario no tiene ninguna Cuenta activa asignada.")
    if len(cuentas) == 1:
        return cuentas[0]
    solicitada = request.headers.get(CABECERA_CUENTA)
    if not solicitada:
        raise HTTPException(400, f"Tienes acceso a varias Cuentas: manda la cabecera {CABECERA_CUENTA}.")
    for c in cuentas:
        if str(c.id) == solicitada:
            return c
    raise HTTPException(403, "No tienes acceso a esa Cuenta.")
