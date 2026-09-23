"""Módulo de Clima laboral — andamiaje 2026-09-22.

REGLA DE ORO: los participantes internos SON los `Colaborador` del roster maestro; este módulo nunca
captura personas ni crea usuarios. Además se puede abrir una liga pública (`/clima/{token}`) para que
respondan sin sesión — ahí un participante externo deja solo nombre/correo en la respuesta, jamás se
crea un colaborador.

Privacidad (LFPDPPP): si la medición es ANÓNIMA (default), la respuesta se guarda SIN `colaborador_id`
— no hay forma de reconstruir quién contestó, ni siquiera desde la bitácora. Si es identificada, se
guarda a quién pertenece y el candado lo sabe la persona antes de responder.
"""

import secrets
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import (
    ESTADOS_MEDICION_CLIMA,
    TIPOS_PREGUNTA_CLIMA,
    Colaborador,
    Cuenta,
    MedicionClima,
    RespuestaClima,
    Usuario,
    registrar,
)
from ..serial import medicion_clima_dict, medicion_clima_publica_dict
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/clima", tags=["clima"], dependencies=[Depends(requiere_modulos_rh)])


def _medicion(db: Session, codigo: str, cuenta_id: int) -> MedicionClima:
    m = db.query(MedicionClima).filter(MedicionClima.codigo == codigo, MedicionClima.cuenta_id == cuenta_id).first()
    if not m:
        raise HTTPException(404, "Medición de clima no encontrada.")
    return m


def _por_token(db: Session, token: str) -> MedicionClima:
    m = db.query(MedicionClima).filter(MedicionClima.token == token).first()
    if not m:
        raise HTTPException(404, "Esta liga no existe o fue dada de baja.")
    return m


def liga_publica(m: MedicionClima) -> str:
    return f"{settings.app_url}/clima/{m.token}"


def _normalizar_preguntas(preguntas: List[dict]) -> List[dict]:
    """Cada pregunta queda con id, texto y tipo válidos (escala | opcion | abierta)."""
    salida = []
    for i, p in enumerate(preguntas, start=1):
        texto = str(p.get("texto") or "").strip()
        if not texto:
            continue
        tipo = str(p.get("tipo") or "escala").strip()
        if tipo not in TIPOS_PREGUNTA_CLIMA:
            raise HTTPException(400, f"Tipo de pregunta inválido «{tipo}». Usa: {', '.join(TIPOS_PREGUNTA_CLIMA)}")
        fila = {"id": str(p.get("id") or f"p{i}"), "texto": texto, "tipo": tipo}
        if tipo == "escala":
            fila["escala_max"] = int(p.get("escala_max") or 5)
        if tipo == "opcion":
            opciones = [str(o).strip() for o in (p.get("opciones") or []) if str(o).strip()]
            if len(opciones) < 2:
                raise HTTPException(400, f"La pregunta «{texto}» es de opción y necesita al menos 2 opciones.")
            fila["opciones"] = opciones
        salida.append(fila)
    return salida


# ------------------------------------------------------------
# Administración (RH)
# ------------------------------------------------------------


class MedicionIn(BaseModel):
    titulo: str
    descripcion: str = ""
    preguntas: List[dict] = []
    anonima: bool = True
    permite_externos: bool = False
    cierra_en: Optional[str] = None  # ISO


@router.post("/mediciones", status_code=201)
def crear_medicion(datos: MedicionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    if not datos.titulo.strip():
        raise HTTPException(400, "El título de la medición es obligatorio.")
    preguntas = _normalizar_preguntas(datos.preguntas)
    if not preguntas:
        raise HTTPException(400, "Captura al menos una pregunta.")
    m = MedicionClima(
        codigo="TMP", cuenta_id=cuenta.id, titulo=datos.titulo.strip(), descripcion=datos.descripcion.strip(),
        preguntas=preguntas, anonima=bool(datos.anonima), permite_externos=bool(datos.permite_externos),
        estado="borrador", token=secrets.token_urlsafe(24), creado_por=u.nombre,
    )
    if datos.cierra_en:
        try:
            m.cierra_en = datetime.fromisoformat(datos.cierra_en).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "cierra_en inválida (usa ISO: 2026-10-15)")
    db.add(m)
    db.flush()
    m.codigo = f"CLI-{900 + m.id}"
    registrar(db, u.nombre, "medicion_clima_creada", "clima", m.codigo, {"titulo": m.titulo, "anonima": m.anonima, "preguntas": len(preguntas), "correo_rh": u.correo})
    db.commit()
    return medicion_clima_dict(m, liga=liga_publica(m))


@router.get("/mediciones")
def listar_mediciones(estado: Optional[str] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    q = db.query(MedicionClima).filter(MedicionClima.cuenta_id == cuenta.id).order_by(MedicionClima.id.desc())
    if estado:
        q = q.filter(MedicionClima.estado == estado)
    return [medicion_clima_dict(m, liga=liga_publica(m)) for m in q.all()]


@router.get("/mediciones/{codigo}")
def ver_medicion(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    m = _medicion(db, codigo, cuenta.id)
    return medicion_clima_dict(m, liga=liga_publica(m), detalle=True)


class EstadoMedicionIn(BaseModel):
    estado: str  # borrador | abierta | cerrada


@router.patch("/mediciones/{codigo}/estado")
def cambiar_estado(codigo: str, datos: EstadoMedicionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Abrir = empieza a recibir respuestas (por la liga y desde el tablero). Cerrar = deja de recibirlas
    y los resultados quedan congelados."""
    m = _medicion(db, codigo, cuenta.id)
    if datos.estado not in ESTADOS_MEDICION_CLIMA:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS_MEDICION_CLIMA)}")
    m.estado = datos.estado
    if datos.estado == "abierta" and not m.abierta_en:
        m.abierta_en = datetime.now(timezone.utc)
    registrar(db, u.nombre, "medicion_clima_estado", "clima", m.codigo, {"estado": m.estado, "correo_rh": u.correo})
    db.commit()
    return medicion_clima_dict(m, liga=liga_publica(m), detalle=True)


@router.post("/mediciones/{codigo}/liga")
def regenerar_liga(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Genera una liga pública nueva (la anterior deja de funcionar)."""
    m = _medicion(db, codigo, cuenta.id)
    m.token = secrets.token_urlsafe(24)
    registrar(db, u.nombre, "medicion_clima_liga", "clima", m.codigo, {"correo_rh": u.correo})
    db.commit()
    return {"liga": liga_publica(m), "medicion": medicion_clima_dict(m, liga=liga_publica(m))}


# ------------------------------------------------------------
# Participación
# ------------------------------------------------------------


class ResponderIn(BaseModel):
    respuestas: Dict[str, object] = {}
    colaborador_id: str = ""   # código COL-#### (solo si la medición NO es anónima)
    externo_nombre: str = ""   # solo liga pública con externos permitidos
    externo_correo: str = ""


def _validar_respuestas(m: MedicionClima, respuestas: Dict[str, object]) -> dict:
    ids = {p["id"] for p in (m.preguntas or [])}
    limpias = {k: v for k, v in respuestas.items() if k in ids and v not in (None, "")}
    if not limpias:
        raise HTTPException(400, "No llegó ninguna respuesta válida.")
    return limpias


def _guardar_respuesta(db: Session, m: MedicionClima, datos: ResponderIn, origen: str, colaborador: Optional[Colaborador]) -> RespuestaClima:
    if m.estado != "abierta":
        raise HTTPException(409, "Esta medición no está recibiendo respuestas.")
    if m.cierra_en and datetime.now(timezone.utc) > m.cierra_en.replace(tzinfo=m.cierra_en.tzinfo or timezone.utc):
        raise HTTPException(409, "El periodo para responder esta medición ya terminó.")
    r = RespuestaClima(
        cuenta_id=m.cuenta_id, medicion_id=m.id, origen=origen,
        # ANÓNIMA: nunca se guarda a quién pertenece (ni siquiera si el frontend lo manda).
        colaborador_id=None if m.anonima else (colaborador.id if colaborador else None),
        externo_nombre="" if m.anonima else datos.externo_nombre.strip()[:200],
        externo_correo="" if m.anonima else datos.externo_correo.strip().lower()[:200],
        respuestas=_validar_respuestas(m, datos.respuestas),
    )
    db.add(r)
    return r


@router.post("/mediciones/{codigo}/responder", status_code=201)
def responder_interno(codigo: str, datos: ResponderIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Respuesta desde el dashboard (RH captura la de un colaborador o responde la persona en sesión).
    El participante SIEMPRE se elige del roster: `colaborador_id` es un código COL-####."""
    m = _medicion(db, codigo, cuenta.id)
    col = None
    if datos.colaborador_id:
        col = db.query(Colaborador).filter(
            Colaborador.codigo == datos.colaborador_id, Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None)
        ).first()
        if not col:
            raise HTTPException(404, "Ese colaborador no existe en el roster.")
    elif not m.anonima:
        raise HTTPException(400, "Esta medición es identificada: indica el colaborador (COL-####).")
    _guardar_respuesta(db, m, datos, "colaborador", col)
    registrar(db, u.nombre, "clima_respuesta", "clima", m.codigo, {"anonima": m.anonima, "colaborador": None if m.anonima else (col.codigo if col else None)})
    db.commit()
    return {"guardada": True, "anonima": m.anonima}


@router.get("/publica/{token}")
def ver_publica(token: str, db: Session = Depends(get_db)):
    """Lo que ve quien abre la liga: título, aviso de anonimato y preguntas. Sin sesión."""
    m = _por_token(db, token)
    return medicion_clima_publica_dict(m)


@router.post("/publica/{token}/responder", status_code=201)
def responder_publica(token: str, datos: ResponderIn = Body(...), db: Session = Depends(get_db)):
    """Respuesta por la liga pública. Si la medición NO es anónima y la persona es del roster, puede
    identificarse con su código COL-####; un participante externo solo deja nombre/correo (nunca se crea
    un colaborador ni un usuario)."""
    m = _por_token(db, token)
    col = None
    if datos.colaborador_id:
        col = db.query(Colaborador).filter(
            Colaborador.codigo == datos.colaborador_id, Colaborador.cuenta_id == m.cuenta_id, Colaborador.eliminado_en.is_(None)
        ).first()
    origen = "colaborador" if col else "externo"
    if origen == "externo" and not m.permite_externos:
        raise HTTPException(403, "Esta medición es solo para colaboradores de la empresa.")
    _guardar_respuesta(db, m, datos, origen, col)
    db.commit()
    return {"guardada": True, "anonima": m.anonima}


# ------------------------------------------------------------
# Resultados
# ------------------------------------------------------------


@router.get("/mediciones/{codigo}/resultados")
def resultados(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Agregados por pregunta. En una medición anónima NUNCA se regresa quién respondió; el detalle de
    las abiertas viene sin autor."""
    m = _medicion(db, codigo, cuenta.id)
    respuestas = list(m.respuestas)
    total_roster = db.query(Colaborador).filter(
        Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None), Colaborador.activo.is_(True)
    ).count()
    por_pregunta = []
    for p in m.preguntas or []:
        valores = [r.respuestas.get(p["id"]) for r in respuestas if r.respuestas and r.respuestas.get(p["id"]) not in (None, "")]
        fila = {"id": p["id"], "texto": p["texto"], "tipo": p["tipo"], "respuestas": len(valores)}
        if p["tipo"] == "escala":
            numeros = [float(v) for v in valores if str(v).replace(".", "", 1).isdigit()]
            fila["promedio"] = round(sum(numeros) / len(numeros), 2) if numeros else None
            fila["escalaMax"] = p.get("escala_max", 5)
            fila["distribucion"] = {str(n): numeros.count(n) for n in sorted(set(numeros))}
        elif p["tipo"] == "opcion":
            fila["distribucion"] = {o: [str(v) for v in valores].count(o) for o in p.get("opciones", [])}
        else:
            fila["textos"] = [str(v)[:500] for v in valores]  # sin autor, siempre
        por_pregunta.append(fila)
    return {
        "medicion": medicion_clima_dict(m, liga=liga_publica(m)),
        "totalRespuestas": len(respuestas),
        "colaboradoresActivos": total_roster,
        "participacion": round(len(respuestas) / total_roster * 100) if total_roster else None,
        "externos": sum(1 for r in respuestas if r.origen == "externo"),
        "porPregunta": por_pregunta,
    }
