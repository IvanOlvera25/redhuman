"""Colaboradores — roster de personas dadas de alta al cerrar el Onboarding.

El único punto de escritura es `contratacion.alta` («Dar de alta como colaborador»); este
router es de solo lectura, para el nuevo bloque COLABORADOR del sidebar.
"""

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual
from ..models import Colaborador, Usuario
from ..serial import colaborador_dict

router = APIRouter(prefix="/colaboradores", tags=["colaboradores"])


@router.get("")
def listar(activo: Optional[bool] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    q = db.query(Colaborador).order_by(Colaborador.id.desc())
    if activo is not None:
        q = q.filter(Colaborador.activo.is_(activo))
    return [colaborador_dict(c) for c in q.all()]
