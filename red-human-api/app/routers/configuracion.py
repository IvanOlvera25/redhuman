"""Configuración global del sistema — hoy solo Modo Prueba (solo admin)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_admin
from ..models import Candidato, Usuario, registrar
from ..services import configuracion as cfg_service

router = APIRouter(prefix="/configuracion", tags=["configuracion"])


def _salida(db: Session) -> dict:
    cfg = cfg_service.obtener(db)
    candidatos_prueba = db.query(Candidato).filter(Candidato.es_prueba.is_(True)).count()
    return {"modoPrueba": cfg.modo_prueba, "candidatosPrueba": candidatos_prueba}


@router.get("")
def obtener(db: Session = Depends(get_db), _: Usuario = Depends(usuario_admin)):
    return _salida(db)


class ConfiguracionIn(BaseModel):
    modo_prueba: bool


@router.patch("")
def actualizar(datos: ConfiguracionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin)):
    cfg = cfg_service.obtener(db)
    cfg.modo_prueba = datos.modo_prueba
    registrar(
        db, u.nombre, "modo_prueba_activado" if datos.modo_prueba else "modo_prueba_desactivado",
        "sistema", "configuracion", {"correo_rh": u.correo},
    )
    db.commit()
    return _salida(db)
