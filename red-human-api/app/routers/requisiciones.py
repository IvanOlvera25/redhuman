"""Módulo 4 · Requisiciones inteligentes — Cazatalentos de IA (3.12–3.14).

Flujo: un gerente/RH levanta la requisición (borrador) → se envía a autorización →
RH autoriza o rechaza → al autorizar corre el Radar Interno contra la plantilla
activa (Empleado) → si no hay match suficiente, RH convierte la requisición en
Vacante para salir a buscar afuera, reutilizando el generador de contenido y el
pipeline de CVs que ya existen en el módulo de Reclutamiento.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import (
    ESTADOS_SUGERENCIA,
    MOTIVOS_REQUISICION,
    Empleado,
    Requisicion,
    SugerenciaMovilidad,
    Usuario,
    Vacante,
    registrar,
)
from ..routers.vacantes import GenerarIn, _aplicar_generado, _generar, _slug_unico

router = APIRouter(prefix="/requisiciones", tags=["requisiciones"])

UMBRAL_SUGERENCIA = 50  # % mínimo de habilidades en común para sugerir un match interno


def _por_codigo(db: Session, codigo: str) -> Requisicion:
    r = db.query(Requisicion).filter(Requisicion.codigo == codigo).first()
    if not r:
        raise HTTPException(404, "Requisición no encontrada")
    return r


# ------------------------------------------------------------
# Serialización — provisional aquí; muévela a serial.py cuando
# me compartas ese archivo, para no inventar su convención exacta.
# ------------------------------------------------------------


def _salida(db: Session, r: Requisicion) -> dict:
    return {
        "id": r.codigo,
        "solicitanteNombre": r.solicitante_nombre,
        "area": r.area,
        "motivo": r.motivo,
        "reemplazoDe": r.reemplazo_de,
        "puesto": r.puesto,
        "ubicacion": r.ubicacion,
        "modalidad": r.modalidad,
        "sueldoPropuesto": r.sueldo_propuesto,
        "habilidadesRequeridas": r.habilidades_requeridas,
        "requisitos": r.requisitos,
        "justificacion": r.justificacion,
        "estado": r.estado,
        "autorizadaPor": r.autorizada_por,
        "autorizadaEn": r.autorizada_en.isoformat() if r.autorizada_en else None,
        "comentarioAutorizacion": r.comentario_autorizacion,
        "vacante": r.vacante.codigo if r.vacante else None,
        "totalSugerencias": len(r.sugerencias),
        "creadaEn": r.creada_en.isoformat(),
    }


def _sugerencia_dict(s: SugerenciaMovilidad) -> dict:
    return {
        "id": s.id,
        "empleado": {
            "id": s.empleado.codigo,
            "nombre": s.empleado.nombre,
            "puestoActual": s.empleado.puesto_actual,
            "area": s.empleado.area,
        },
        "porcentajeMatch": s.porcentaje_match,
        "habilidadesCoincidentes": s.habilidades_coincidentes,
        "habilidadesFaltantes": s.habilidades_faltantes,
        "evidencia": s.evidencia,
        "estado": s.estado,
        "revisadoPor": s.revisado_por,
        "creadaEn": s.creada_en.isoformat(),
    }


@router.get("")
def listar(
    estado: Optional[str] = None,
    area: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
):
    q = db.query(Requisicion).order_by(Requisicion.id.desc())
    if estado:
        q = q.filter(Requisicion.estado == estado)
    if area:
        q = q.filter(Requisicion.area == area)
    return [_salida(db, r) for r in q.all()]


# ------------------------------------------------------------
# Alta y edición
# ------------------------------------------------------------


class CrearIn(BaseModel):
    solicitante_nombre: str = ""
    area: str = ""
    motivo: str = "Crecimiento"  # Crecimiento | Reemplazo
    reemplazo_de: str = ""
    puesto: str
    ubicacion: str = ""
    modalidad: str = "Presencial"
    sueldo_propuesto: str = "A convenir"
    habilidades_requeridas: List[str] = []
    requisitos: str = ""
    justificacion: str = ""
    enviar_a_autorizacion: bool = False


@router.post("", status_code=201)
def crear(datos: CrearIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    if not datos.puesto.strip():
        raise HTTPException(400, "El puesto es obligatorio.")
    if datos.motivo not in MOTIVOS_REQUISICION:
        raise HTTPException(400, f"Motivo inválido. Usa uno de: {', '.join(MOTIVOS_REQUISICION)}")
    if datos.motivo == "Reemplazo" and not datos.reemplazo_de.strip():
        raise HTTPException(400, "Indica a quién se reemplaza cuando el motivo es 'Reemplazo'.")

    r = Requisicion(
        codigo="TMP",
        solicitante_id=u.id,
        solicitante_nombre=datos.solicitante_nombre.strip() or u.nombre,
        area=datos.area,
        motivo=datos.motivo,
        reemplazo_de=datos.reemplazo_de,
        puesto=datos.puesto.strip(),
        ubicacion=datos.ubicacion,
        modalidad=datos.modalidad,
        sueldo_propuesto=datos.sueldo_propuesto,
        habilidades_requeridas=datos.habilidades_requeridas,
        requisitos=datos.requisitos,
        justificacion=datos.justificacion,
        estado="pendiente_autorizacion" if datos.enviar_a_autorizacion else "borrador",
    )
    db.add(r)
    db.flush()
    r.codigo = f"REQ-{100 + r.id}"
    registrar(db, u.nombre, "requisicion_creada", "requisicion", r.codigo, {"puesto": r.puesto, "motivo": r.motivo, "estado": r.estado})
    db.commit()
    return _salida(db, r)


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    r = _por_codigo(db, codigo)
    return {**_salida(db, r), "sugerencias": [_sugerencia_dict(s) for s in r.sugerencias]}


class ActualizarIn(BaseModel):
    solicitante_nombre: Optional[str] = None
    area: Optional[str] = None
    motivo: Optional[str] = None
    reemplazo_de: Optional[str] = None
    puesto: Optional[str] = None
    ubicacion: Optional[str] = None
    modalidad: Optional[str] = None
    sueldo_propuesto: Optional[str] = None
    habilidades_requeridas: Optional[List[str]] = None
    requisitos: Optional[str] = None
    justificacion: Optional[str] = None


@router.patch("/{codigo}")
def actualizar(codigo: str, datos: ActualizarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Edición manual — solo mientras la requisición no haya sido autorizada/rechazada."""
    r = _por_codigo(db, codigo)
    if r.estado not in ("borrador", "pendiente_autorizacion"):
        raise HTTPException(409, f"No se puede editar una requisición en estado '{r.estado}'.")

    cambios = datos.model_dump(exclude_none=True)
    if "motivo" in cambios and cambios["motivo"] not in MOTIVOS_REQUISICION:
        raise HTTPException(400, f"Motivo inválido. Usa uno de: {', '.join(MOTIVOS_REQUISICION)}")

    for campo, valor in cambios.items():
        setattr(r, campo, valor)

    registrar(db, u.nombre, "requisicion_editada", "requisicion", r.codigo, {"campos": sorted(cambios)})
    db.commit()
    return _salida(db, r)


# ------------------------------------------------------------
# Flujo de autorización
# ------------------------------------------------------------


@router.post("/{codigo}/enviar")
def enviar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Pasa de borrador a pendiente de autorización."""
    r = _por_codigo(db, codigo)
    if r.estado != "borrador":
        raise HTTPException(409, f"Solo se puede enviar a autorización una requisición en borrador. Estado actual: {r.estado}")
    r.estado = "pendiente_autorizacion"
    registrar(db, u.nombre, "requisicion_enviada", "requisicion", r.codigo, {})
    db.commit()
    return _salida(db, r)


class AutorizarIn(BaseModel):
    comentario: str = ""


def _match_habilidades(requeridas: List[str], skills_empleado: List[str]):
    """Compara habilidades por coincidencia directa (normalizada). Punto de entrada para
    sustituir por un match semántico con IA en services/radar_interno.py más adelante."""
    req_norm = {h.strip().lower() for h in requeridas if h.strip()}
    emp_norm = {s.strip().lower() for s in skills_empleado if s.strip()}
    if not req_norm:
        return 0, [], []
    coincidentes = req_norm & emp_norm
    faltantes = req_norm - emp_norm
    porcentaje = round(len(coincidentes) / len(req_norm) * 100)
    coincidentes_orig = [h for h in requeridas if h.strip().lower() in coincidentes]
    faltantes_orig = [h for h in requeridas if h.strip().lower() in faltantes]
    return porcentaje, coincidentes_orig, faltantes_orig


@router.post("/{codigo}/autorizar")
def autorizar(codigo: str, datos: AutorizarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Autoriza la requisición y corre el Radar Interno antes de considerar buscar afuera."""
    r = _por_codigo(db, codigo)
    if r.estado not in ("borrador", "pendiente_autorizacion"):
        raise HTTPException(409, f"Solo se puede autorizar una requisición en borrador o pendiente. Estado actual: {r.estado}")

    r.estado = "autorizada"
    r.autorizada_por = u.nombre
    r.autorizada_en = datetime.now(timezone.utc)
    r.comentario_autorizacion = datos.comentario

    empleados = db.query(Empleado).filter(Empleado.activo == True).all()
    nuevas = 0
    for emp in empleados:
        porcentaje, coincidentes, faltantes = _match_habilidades(r.habilidades_requeridas, emp.skills)
        if porcentaje >= UMBRAL_SUGERENCIA:
            db.add(SugerenciaMovilidad(
                requisicion_id=r.id,
                empleado_id=emp.id,
                porcentaje_match=porcentaje,
                habilidades_coincidentes=coincidentes,
                habilidades_faltantes=faltantes,
                evidencia=f"Coincide en {len(coincidentes)} de {len(r.habilidades_requeridas)} habilidades requeridas.",
            ))
            nuevas += 1

    registrar(
        db, u.nombre, "requisicion_autorizada", "requisicion", r.codigo,
        {"comentario": datos.comentario, "sugerencias_internas": nuevas},
    )
    db.commit()
    return {"sugerenciasInternas": nuevas, **_salida(db, r)}


class RechazarIn(BaseModel):
    comentario: str = ""


@router.post("/{codigo}/rechazar")
def rechazar(codigo: str, datos: RechazarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    r = _por_codigo(db, codigo)
    if r.estado not in ("pendiente_autorizacion", "borrador"):
        raise HTTPException(409, f"No se puede rechazar una requisición en estado '{r.estado}'.")
    r.estado = "rechazada"
    r.comentario_autorizacion = datos.comentario
    registrar(db, u.nombre, "requisicion_rechazada", "requisicion", r.codigo, {"comentario": datos.comentario})
    db.commit()
    return _salida(db, r)


# ------------------------------------------------------------
# Radar Interno — seguimiento humano de cada sugerencia (HITL)
# ------------------------------------------------------------


@router.get("/{codigo}/sugerencias")
def sugerencias(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    r = _por_codigo(db, codigo)
    return [_sugerencia_dict(s) for s in r.sugerencias]


class DecidirSugerenciaIn(BaseModel):
    estado: str  # notificada | interesado | no_interesado | avanzo | descartada
    comentario: str = ""


@router.post("/{codigo}/sugerencias/{sugerencia_id}/decidir")
def decidir_sugerencia(
    codigo: str,
    sugerencia_id: int,
    datos: DecidirSugerenciaIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
):
    r = _por_codigo(db, codigo)
    s = next((x for x in r.sugerencias if x.id == sugerencia_id), None)
    if not s:
        raise HTTPException(404, "Sugerencia no encontrada")
    if datos.estado not in ESTADOS_SUGERENCIA:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS_SUGERENCIA)}")

    s.estado = datos.estado
    s.revisado_por = u.nombre
    registrar(
        db, u.nombre, "sugerencia_decidida", "sugerencia_movilidad", str(s.id),
        {"empleado": s.empleado.codigo, "estado": datos.estado, "comentario": datos.comentario},
    )
    db.commit()
    return _sugerencia_dict(s)


# ------------------------------------------------------------
# Conversión a Vacante — pilar 3: salir a buscar afuera
# ------------------------------------------------------------


class ConvertirVacanteIn(BaseModel):
    generar_contenido: bool = True
    notas: str = ""


@router.post("/{codigo}/convertir-vacante", status_code=201)
def convertir_vacante(
    codigo: str,
    datos: ConvertirVacanteIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
):
    """Crea la Vacante pública ligada a esta requisición ya autorizada — de aquí en
    adelante corre el mismo pipeline de generación, prefiltro y CVs que ya existe."""
    r = _por_codigo(db, codigo)
    if r.estado != "autorizada":
        raise HTTPException(409, f"Solo se puede convertir una requisición autorizada. Estado actual: {r.estado}")
    if r.vacante:
        raise HTTPException(409, f"Esta requisición ya generó la vacante {r.vacante.codigo}.")

    v = Vacante(
        codigo="TMP",
        titulo=r.puesto,
        area=r.area,
        ubicacion=r.ubicacion,
        modalidad=r.modalidad,
        sueldo=r.sueldo_propuesto,
        estado="Borrador",
        requisitos=r.requisitos,
        palabras_clave=list(r.habilidades_requeridas),
        requisicion_id=r.id,
    )
    db.add(v)
    db.flush()
    v.codigo = f"VAC-{1036 + v.id}"
    v.slug = _slug_unico(db, v.titulo, v.id)

    con_ia = None
    if datos.generar_contenido:
        generado, con_ia = _generar(GenerarIn(
            titulo=r.puesto, area=r.area, ubicacion=r.ubicacion, sueldo=r.sueldo_propuesto,
            requisitos=r.requisitos, modalidad=r.modalidad, notas=datos.notas,
        ))
        _aplicar_generado(v, generado)

    r.estado = "convertida_vacante"
    registrar(db, u.nombre, "requisicion_convertida", "requisicion", r.codigo, {"vacante": v.codigo, "ia": con_ia})
    registrar(db, u.nombre, "vacante_creada", "vacante", v.codigo, {"origen": "requisicion", "requisicion": r.codigo, "ia": con_ia})
    db.commit()
    return {"vacante": v.codigo, "ia": con_ia, **_salida(db, r)}