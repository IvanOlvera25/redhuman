"""Plantillas de vacante — reutilizables, Generales de la Cuenta o de un Cliente específico, sin
nivel intermedio (Fase B, reestructuración multi-cuenta, punto 11)."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import Cliente, Cuenta, Plantilla, Usuario, registrar

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
        "modalidad": p.modalidad,
        "sueldo": p.sueldo,
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
        "creadoPor": p.creado_por,
        "creada": p.creada_en.isoformat(),
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
    modalidad: str = "Presencial"
    sueldo: str = "A convenir"
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

    campos = datos.model_dump()
    campos["nombre"] = campos["nombre"].strip()
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
    modalidad: Optional[str] = None
    sueldo: Optional[str] = None
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

    cambios = datos.model_dump(exclude_none=True)
    for campo, valor in cambios.items():
        setattr(p, campo, valor.strip() if campo == "nombre" and isinstance(valor, str) else valor)

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
