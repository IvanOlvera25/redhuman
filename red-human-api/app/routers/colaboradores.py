"""Colaboradores — roster de personas dadas de alta al cerrar el Onboarding.

El alta la hace `contratacion.alta` («Dar de alta como colaborador»). 2026-09-15: aquí viven el perfil
detallado (GET /{codigo}), la BAJA (activo=False, conserva historial; reversible) y la ELIMINACIÓN
lógica (limpieza de pruebas; desaparece de listados y conteos, la fila se conserva).
"""

from typing import Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import AsignacionCurso, Cliente, Colaborador, Cuenta, Usuario, registrar
from ..serial import colaborador_detalle_dict, colaborador_dict

router = APIRouter(prefix="/colaboradores", tags=["colaboradores"])


@router.get("")
def listar(
    activo: Optional[bool] = None,
    cliente_id: Optional[int] = None,  # Fase 5: solo los contratados para ese Cliente (0 = sin Cliente / directo)
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    q = (
        db.query(Colaborador)
        .filter(Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None))  # eliminados (lógico) nunca salen
        .order_by(Colaborador.id.desc())
    )
    if activo is not None:
        q = q.filter(Colaborador.activo.is_(activo))
    if cliente_id is not None:
        q = q.filter(Colaborador.cliente_id.is_(None)) if cliente_id == 0 else q.filter(Colaborador.cliente_id == cliente_id)
    return [colaborador_dict(c) for c in q.all()]


@router.get("/clientes")
def clientes_con_colaboradores(
    db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual),
):
    """Fase 5: opciones del filtro por Cliente — solo Clientes que ya tienen colaboradores, con conteo,
    más «Directo (sin Cliente)» si aplica."""
    filas = (
        db.query(Colaborador.cliente_id, func.count(Colaborador.id))
        .filter(Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None))
        .group_by(Colaborador.cliente_id)
        .all()
    )
    conteo = {cid: n for cid, n in filas}
    ids = [cid for cid in conteo if cid is not None]
    clientes = db.query(Cliente).filter(Cliente.id.in_(ids)).all() if ids else []
    salida = [{"id": c.id, "nombre": c.nombre, "colaboradores": conteo.get(c.id, 0)} for c in sorted(clientes, key=lambda c: c.nombre.lower())]
    if None in conteo:
        salida.append({"id": 0, "nombre": "Directo (sin Cliente)", "colaboradores": conteo[None]})
    return salida


def _por_codigo(db: Session, codigo: str, cuenta_id: int) -> Colaborador:
    col = db.query(Colaborador).filter(
        Colaborador.codigo == codigo, Colaborador.cuenta_id == cuenta_id, Colaborador.eliminado_en.is_(None)
    ).first()
    if not col:
        raise HTTPException(404, "Colaborador no encontrado")
    return col


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Perfil completo: datos de alta, condiciones, expediente con documentos, candidato de origen."""
    return colaborador_detalle_dict(_por_codigo(db, codigo, cuenta.id))


class BajaIn(BaseModel):
    motivo: str = ""


@router.post("/{codigo}/baja")
def dar_de_baja(
    codigo: str, datos: BajaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Baja del colaborador: activo=False con fecha, motivo y quién. Conserva TODO el historial y se
    puede reactivar (POST /{codigo}/reactivar)."""
    col = _por_codigo(db, codigo, cuenta.id)
    if not col.activo:
        raise HTTPException(409, "El colaborador ya está dado de baja.")
    col.activo = False
    col.baja_en = datetime.now(timezone.utc)
    col.baja_motivo = datos.motivo.strip()[:300]
    col.baja_por = u.nombre
    registrar(db, u.nombre, "colaborador_baja", "colaborador", col.codigo, {"motivo": col.baja_motivo, "correo_rh": u.correo})
    db.commit()
    return colaborador_detalle_dict(col)


@router.post("/{codigo}/reactivar")
def reactivar(
    codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual),
):
    col = _por_codigo(db, codigo, cuenta.id)
    if col.activo:
        raise HTTPException(409, "El colaborador ya está activo.")
    col.activo = True
    col.baja_en = None
    col.baja_motivo = ""
    col.baja_por = ""
    registrar(db, u.nombre, "colaborador_reactivado", "colaborador", col.codigo, {"correo_rh": u.correo})
    db.commit()
    return colaborador_detalle_dict(col)


@router.delete("/{codigo}")
def eliminar(
    codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual),
):
    """Eliminación LÓGICA (limpieza de pruebas / registros erróneos): la fila se conserva con fecha y
    quién, pero desaparece de listados, filtros y conteos, y su código deja de resolverse. El
    expediente y el candidato de origen no se tocan."""
    col = _por_codigo(db, codigo, cuenta.id)
    col.eliminado_en = datetime.now(timezone.utc)
    col.eliminado_por = u.nombre
    col.activo = False
    # 2026-09-18: sus asignaciones de capacitación se eliminan (dejaban «fantasmas» en Seguimiento y en los
    # contadores «X personas asignadas»).
    asignaciones = db.query(AsignacionCurso).filter(AsignacionCurso.colaborador_id == col.id).all()
    cursos = sorted({a.curso.codigo for a in asignaciones if a.curso})
    for a in asignaciones:
        db.delete(a)
    registrar(db, u.nombre, "colaborador_eliminado", "colaborador", col.codigo, {"nombre": col.nombre, "correo_rh": u.correo, "asignaciones_curso_eliminadas": len(asignaciones), "cursos": cursos})
    db.commit()
    return {"ok": True, "colaborador": col.codigo, "asignacionesCursoEliminadas": len(asignaciones)}
