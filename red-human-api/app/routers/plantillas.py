"""Plantillas de vacante — reutilizables, Generales de la Cuenta o de un Cliente específico, sin
nivel intermedio (Fase B, reestructuración multi-cuenta, punto 11)."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import (
    CAMPOS_PLANTILLA, ENFOQUES_ENTREVISTA, PERIODICIDADES_SUELDO, Cliente, Cuenta, Plantilla, Usuario, Vacante, registrar,
    texto_sueldo,
)

router = APIRouter(prefix="/plantillas", tags=["plantillas"])


def _plantilla_dict(p: Plantilla) -> dict:
    return {
        "id": p.id,
        "nombre": p.nombre,
        "clienteId": p.cliente_id,
        "clienteNombre": p.cliente.nombre if p.cliente else None,
        "activa": p.activa,
        "titulo": p.titulo,
        "area": p.area,
        "ubicacion": p.ubicacion,
        "modalidad": p.modalidad,
        "sueldo": p.sueldo,
        "sueldoDesde": p.sueldo_desde,  # Parte 3
        "sueldoHasta": p.sueldo_hasta,
        "sueldoMoneda": p.sueldo_moneda or "MXN",
        "sueldoPeriodicidad": p.sueldo_periodicidad or "",
        "requisitos": p.requisitos,
        "descripcion": p.descripcion,
        "resumen": p.resumen,
        "perfilIdeal": p.perfil_ideal,
        "responsabilidades": p.responsabilidades or [],
        "requisitosDeseables": p.requisitos_deseables or [],
        "beneficios": p.beneficios or [],
        "palabrasClave": p.palabras_clave or [],
        "seniority": p.seniority,
        "avisosCumplimiento": p.avisos_cumplimiento or [],
        "preguntasFiltro": p.preguntas_filtro or [],  # = "evaluaciones" (ver spec Fase B)
        "textoWhatsapp": p.texto_whatsapp,
        "textoBolsa": p.texto_bolsa,
        "enfoqueEntrevista": p.enfoque_entrevista or "profesional",
        "creadoPor": p.creado_por,
        "creada": p.creada_en.isoformat(),
        "actualizada": (p.actualizada_en or p.creada_en).isoformat(),
    }


def _por_id(db: Session, plantilla_id: int, cuenta_id: int) -> Plantilla:
    p = db.query(Plantilla).filter(Plantilla.id == plantilla_id, Plantilla.cuenta_id == cuenta_id).first()
    if not p:
        raise HTTPException(404, "Plantilla no encontrada")
    return p


def _validar_cliente(db: Session, cuenta_id: int, cliente_id: Optional[int]) -> None:
    if cliente_id is None:
        return
    existe = db.query(Cliente).filter(Cliente.id == cliente_id, Cliente.cuenta_id == cuenta_id).first()
    if not existe:
        raise HTTPException(400, "El Cliente indicado no existe en esta Cuenta.")


@router.get("")
def listar(
    cliente_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Sin `cliente_id`: todas las plantillas activas de la Cuenta (pantalla de gestión). Con
    `cliente_id`: las de ese Cliente primero, luego las generales — el orden de sugerencia exacto
    que pide el punto 11 al crear una vacante con Cliente ya elegido."""
    q = db.query(Plantilla).filter(Plantilla.cuenta_id == cuenta.id, Plantilla.activa.is_(True))
    if cliente_id is None:
        return [_plantilla_dict(p) for p in q.order_by(Plantilla.nombre).all()]
    filas = q.filter((Plantilla.cliente_id == cliente_id) | (Plantilla.cliente_id.is_(None))).all()
    filas.sort(key=lambda p: (p.cliente_id != cliente_id, p.nombre))
    return [_plantilla_dict(p) for p in filas]


@router.get("/{plantilla_id}")
def detalle(
    plantilla_id: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)
):
    return _plantilla_dict(_por_id(db, plantilla_id, cuenta.id))


class PlantillaIn(BaseModel):
    nombre: str
    cliente_id: Optional[int] = None
    titulo: str = ""
    area: str = ""
    ubicacion: str = ""
    modalidad: str = "Presencial"
    sueldo: str = "A convenir"
    sueldo_desde: Optional[int] = None  # Parte 3
    sueldo_hasta: Optional[int] = None
    sueldo_moneda: str = "MXN"
    sueldo_periodicidad: str = ""
    requisitos: str = ""
    descripcion: str = ""
    resumen: str = ""
    perfil_ideal: str = ""
    responsabilidades: List[str] = []
    requisitos_deseables: List[str] = []
    beneficios: List[str] = []
    palabras_clave: List[str] = []
    seniority: str = ""
    avisos_cumplimiento: List[str] = []
    preguntas_filtro: List[dict] = []
    texto_whatsapp: str = ""
    texto_bolsa: str = ""
    enfoque_entrevista: str = "profesional"


@router.post("", status_code=201)
def crear(
    datos: PlantillaIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre de la plantilla es obligatorio.")
    _validar_cliente(db, cuenta.id, datos.cliente_id)
    if datos.enfoque_entrevista not in ENFOQUES_ENTREVISTA:
        raise HTTPException(400, f"Enfoque de entrevista inválido. Usa uno de: {', '.join(ENFOQUES_ENTREVISTA)}")

    if datos.sueldo_periodicidad and datos.sueldo_periodicidad not in PERIODICIDADES_SUELDO:
        raise HTTPException(400, f"Periodicidad de sueldo inválida. Usa una de: {', '.join(PERIODICIDADES_SUELDO)}")
    campos = datos.model_dump()
    campos["nombre"] = campos["nombre"].strip()
    if datos.sueldo_periodicidad or datos.sueldo_desde or datos.sueldo_hasta:
        campos["sueldo"] = texto_sueldo(datos.sueldo_desde, datos.sueldo_hasta, datos.sueldo_moneda, datos.sueldo_periodicidad)
    p = Plantilla(cuenta_id=cuenta.id, creado_por=u.nombre, **campos)
    db.add(p)
    db.flush()
    registrar(
        db, u.nombre, "plantilla_creada", "plantilla", str(p.id),
        {"nombre": p.nombre, "cliente_id": p.cliente_id},
    )
    db.commit()
    return _plantilla_dict(p)


class ActualizarIn(BaseModel):
    nombre: Optional[str] = None
    cliente_id: Optional[int] = None
    activa: Optional[bool] = None
    titulo: Optional[str] = None
    area: Optional[str] = None
    ubicacion: Optional[str] = None
    modalidad: Optional[str] = None
    sueldo: Optional[str] = None
    sueldo_desde: Optional[int] = None  # Parte 3
    sueldo_hasta: Optional[int] = None
    sueldo_moneda: Optional[str] = None
    sueldo_periodicidad: Optional[str] = None
    requisitos: Optional[str] = None
    descripcion: Optional[str] = None
    resumen: Optional[str] = None
    perfil_ideal: Optional[str] = None
    responsabilidades: Optional[List[str]] = None
    requisitos_deseables: Optional[List[str]] = None
    beneficios: Optional[List[str]] = None
    palabras_clave: Optional[List[str]] = None
    seniority: Optional[str] = None
    avisos_cumplimiento: Optional[List[str]] = None
    preguntas_filtro: Optional[List[dict]] = None
    texto_whatsapp: Optional[str] = None
    texto_bolsa: Optional[str] = None
    enfoque_entrevista: Optional[str] = None


@router.patch("/{plantilla_id}")
def actualizar(
    plantilla_id: int,
    datos: ActualizarIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    p = _por_id(db, plantilla_id, cuenta.id)
    if datos.cliente_id is not None:
        _validar_cliente(db, cuenta.id, datos.cliente_id)
    if datos.enfoque_entrevista is not None and datos.enfoque_entrevista not in ENFOQUES_ENTREVISTA:
        raise HTTPException(400, f"Enfoque de entrevista inválido. Usa uno de: {', '.join(ENFOQUES_ENTREVISTA)}")

    if datos.sueldo_periodicidad is not None and datos.sueldo_periodicidad not in PERIODICIDADES_SUELDO:
        raise HTTPException(400, f"Periodicidad de sueldo inválida. Usa una de: {', '.join(PERIODICIDADES_SUELDO)}")
    cambios = datos.model_dump(exclude_none=True)
    for campo, valor in cambios.items():
        setattr(p, campo, valor.strip() if campo == "nombre" and isinstance(valor, str) else valor)
    if any(k in cambios for k in ("sueldo_desde", "sueldo_hasta", "sueldo_moneda", "sueldo_periodicidad")):
        p.sueldo = texto_sueldo(p.sueldo_desde, p.sueldo_hasta, p.sueldo_moneda, p.sueldo_periodicidad)

    if cambios:
        registrar(db, u.nombre, "plantilla_editada", "plantilla", str(p.id), {"campos": sorted(cambios)})
        db.commit()
    return _plantilla_dict(p)


@router.delete("/{plantilla_id}")
def eliminar(
    plantilla_id: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)
):
    """No borra — desactiva (`activa=False`). Una Vacante ya creada desde esta plantilla conserva
    su `plantilla_id` para trazabilidad aunque ya no se sugiera para vacantes nuevas."""
    p = _por_id(db, plantilla_id, cuenta.id)
    p.activa = False
    registrar(db, u.nombre, "plantilla_desactivada", "plantilla", str(p.id), {})
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------
# Punto 11 — Duplicar y "Guardar como plantilla" desde una vacante
# ------------------------------------------------------------


def _copiar_contenido(origen, destino) -> None:
    """Copia los campos compartidos Vacante/Plantilla (CAMPOS_PLANTILLA) — única lista, para que
    duplicar, guardar-desde-vacante y (en el frontend) usar-plantilla nunca diverjan."""
    for campo in CAMPOS_PLANTILLA:
        valor = getattr(origen, campo)
        setattr(destino, campo, list(valor) if isinstance(valor, list) else valor)


@router.post("/{plantilla_id}/duplicar", status_code=201)
def duplicar(
    plantilla_id: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)
):
    """Acción «Duplicar» del listado: copia activa con el mismo alcance (General/Cliente)."""
    origen = _por_id(db, plantilla_id, cuenta.id)
    copia = Plantilla(cuenta_id=cuenta.id, cliente_id=origen.cliente_id, nombre=f"Copia de {origen.nombre}"[:150], creado_por=u.nombre)
    _copiar_contenido(origen, copia)
    db.add(copia)
    db.flush()
    registrar(db, u.nombre, "plantilla_duplicada", "plantilla", str(copia.id), {"origen": origen.id, "nombre": copia.nombre})
    db.commit()
    return _plantilla_dict(copia)


class DesdeVacanteIn(BaseModel):
    nombre: str
    cliente_id: Optional[int] = None  # None = General de la Cuenta


@router.post("/desde-vacante/{codigo}", status_code=201)
def desde_vacante(
    codigo: str, datos: DesdeVacanteIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Acción «Guardar como plantilla» desde una vacante existente: el servidor copia los campos
    compartidos (el frontend ya no arma la copia a mano)."""
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre de la plantilla es obligatorio.")
    v = db.query(Vacante).filter(Vacante.codigo == codigo, Vacante.cuenta_id == cuenta.id).first()
    if not v:
        raise HTTPException(404, "Vacante no encontrada")
    _validar_cliente(db, cuenta.id, datos.cliente_id)
    p = Plantilla(cuenta_id=cuenta.id, cliente_id=datos.cliente_id, nombre=datos.nombre.strip(), creado_por=u.nombre)
    _copiar_contenido(v, p)
    db.add(p)
    db.flush()
    registrar(db, u.nombre, "plantilla_creada", "plantilla", str(p.id), {"nombre": p.nombre, "cliente_id": p.cliente_id, "vacante": v.codigo})
    db.commit()
    return _plantilla_dict(p)
