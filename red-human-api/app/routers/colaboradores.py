"""Colaboradores — roster de personas dadas de alta al cerrar el Onboarding.

El único punto de escritura es `contratacion.alta` («Dar de alta como colaborador»); este
router es de solo lectura, para el nuevo bloque COLABORADOR del sidebar.
"""

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual
from ..models import Cliente, Colaborador, Cuenta, Usuario
from ..serial import colaborador_dict

router = APIRouter(prefix="/colaboradores", tags=["colaboradores"])


@router.get("")
def listar(
    activo: Optional[bool] = None,
    cliente_id: Optional[int] = None,  # Fase 5: solo los contratados para ese Cliente (0 = sin Cliente / directo)
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    q = db.query(Colaborador).filter(Colaborador.cuenta_id == cuenta.id).order_by(Colaborador.id.desc())
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
        .filter(Colaborador.cuenta_id == cuenta.id)
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
