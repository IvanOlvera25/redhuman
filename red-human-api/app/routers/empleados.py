"""Módulo 4 · Requisiciones inteligentes — Empleados (plantilla activa, 3.13).

Universo del Radar Interno: cada Empleado trae sus `skills`, que es lo que se
compara contra `Requisicion.habilidades_requeridas` al autorizar una requisición
(ver routers/requisiciones.py). No hay borrado físico — se da de baja (activo=False)
para no perder la trazabilidad ni las sugerencias de movilidad ya generadas.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import Candidato, Empleado, Usuario, registrar

router = APIRouter(prefix="/empleados", tags=["empleados"])


def _por_codigo(db: Session, codigo: str) -> Empleado:
    e = db.query(Empleado).filter(Empleado.codigo == codigo).first()
    if not e:
        raise HTTPException(404, "Empleado no encontrado")
    return e


# ------------------------------------------------------------
# Serialización — provisional aquí; muévela a serial.py cuando
# me compartas ese archivo, para no inventar su convención exacta.
# ------------------------------------------------------------


def _salida(e: Empleado) -> dict:
    return {
        "id": e.codigo,
        "nombre": e.nombre,
        "correo": e.correo,
        "telefono": e.telefono,
        "puestoActual": e.puesto_actual,
        "area": e.area,
        "ubicacion": e.ubicacion,
        "seniority": e.seniority,
        "skills": e.skills,
        "aniosExperiencia": e.anios_experiencia,
        "fechaIngreso": e.fecha_ingreso.isoformat() if e.fecha_ingreso else None,
        "jefeDirecto": e.jefe_directo.codigo if e.jefe_directo else None,
        "activo": e.activo,
        "candidatoOrigen": e.candidato_origen.codigo if e.candidato_origen else None,
        "totalSugerencias": len(e.sugerencias),
        "creadoEn": e.creado_en.isoformat(),
    }


@router.get("")
def listar(
    activo: Optional[bool] = None,
    area: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
):
    query = db.query(Empleado).order_by(Empleado.id.desc())
    if activo is not None:
        query = query.filter(Empleado.activo == activo)
    if area:
        query = query.filter(Empleado.area == area)
    if q:
        patron = f"%{q.strip()}%"
        query = query.filter(or_(Empleado.nombre.ilike(patron), Empleado.puesto_actual.ilike(patron)))
    return [_salida(e) for e in query.all()]


# ------------------------------------------------------------
# Alta y edición
# ------------------------------------------------------------


class CrearIn(BaseModel):
    nombre: str
    correo: str = ""
    telefono: str = ""
    puesto_actual: str = ""
    area: str = ""
    ubicacion: str = ""
    seniority: str = ""
    skills: List[str] = []
    anios_experiencia: float = 0.0
    fecha_ingreso: Optional[str] = None  # ISO: 2026-01-15
    jefe_directo_codigo: Optional[str] = None
    candidato_origen_codigo: Optional[str] = None


@router.post("", status_code=201)
def crear(datos: CrearIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre del empleado es obligatorio.")

    jefe = _por_codigo(db, datos.jefe_directo_codigo) if datos.jefe_directo_codigo else None

    candidato = None
    if datos.candidato_origen_codigo:
        candidato = db.query(Candidato).filter(Candidato.codigo == datos.candidato_origen_codigo).first()
        if not candidato:
            raise HTTPException(404, f"Candidato '{datos.candidato_origen_codigo}' no encontrado")

    fecha = None
    if datos.fecha_ingreso:
        try:
            fecha = datetime.fromisoformat(datos.fecha_ingreso).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "fecha_ingreso inválida (usa ISO: 2026-01-15)")

    e = Empleado(
        codigo="TMP",
        nombre=datos.nombre.strip(),
        correo=datos.correo.strip(),
        telefono=datos.telefono,
        puesto_actual=datos.puesto_actual,
        area=datos.area,
        ubicacion=datos.ubicacion,
        seniority=datos.seniority,
        skills=datos.skills,
        anios_experiencia=datos.anios_experiencia,
        fecha_ingreso=fecha,
        jefe_directo_id=jefe.id if jefe else None,
        candidato_origen_id=candidato.id if candidato else None,
    )
    db.add(e)
    db.flush()
    e.codigo = f"EMP-{4000 + e.id}"
    registrar(db, u.nombre, "empleado_alta", "empleado", e.codigo, {"puesto": e.puesto_actual, "area": e.area, "skills": e.skills})
    db.commit()
    return _salida(e)


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return _salida(_por_codigo(db, codigo))


class ActualizarIn(BaseModel):
    nombre: Optional[str] = None
    correo: Optional[str] = None
    telefono: Optional[str] = None
    puesto_actual: Optional[str] = None
    area: Optional[str] = None
    ubicacion: Optional[str] = None
    seniority: Optional[str] = None
    skills: Optional[List[str]] = None
    anios_experiencia: Optional[float] = None
    fecha_ingreso: Optional[str] = None  # ISO: 2026-01-15
    jefe_directo_codigo: Optional[str] = None  # "" para quitarle el jefe directo


@router.patch("/{codigo}")
def actualizar(codigo: str, datos: ActualizarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    e = _por_codigo(db, codigo)
    campos_tocados: List[str] = []

    genericos = datos.model_dump(exclude_none=True, exclude={"jefe_directo_codigo", "fecha_ingreso"})
    for campo, valor in genericos.items():
        setattr(e, campo, valor)
        campos_tocados.append(campo)

    if datos.jefe_directo_codigo is not None:
        if datos.jefe_directo_codigo == e.codigo:
            raise HTTPException(400, "Un empleado no puede ser su propio jefe directo.")
        jefe = _por_codigo(db, datos.jefe_directo_codigo) if datos.jefe_directo_codigo else None
        e.jefe_directo_id = jefe.id if jefe else None
        campos_tocados.append("jefe_directo")

    if datos.fecha_ingreso is not None:
        try:
            e.fecha_ingreso = datetime.fromisoformat(datos.fecha_ingreso).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "fecha_ingreso inválida (usa ISO: 2026-01-15)")
        campos_tocados.append("fecha_ingreso")

    registrar(db, u.nombre, "empleado_editado", "empleado", e.codigo, {"campos": sorted(campos_tocados)})
    db.commit()
    return _salida(e)


# ------------------------------------------------------------
# Baja y reactivación (sin borrado físico — se preserva la trazabilidad)
# ------------------------------------------------------------


@router.post("/{codigo}/baja")
def dar_de_baja(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    e = _por_codigo(db, codigo)
    e.activo = False
    registrar(db, u.nombre, "empleado_baja", "empleado", e.codigo, {})
    db.commit()
    return _salida(e)


@router.post("/{codigo}/reactivar")
def reactivar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    e = _por_codigo(db, codigo)
    e.activo = True
    registrar(db, u.nombre, "empleado_reactivado", "empleado", e.codigo, {})
    db.commit()
    return _salida(e)