"""Configuración global del sistema (fila única, id=1) — hoy solo Modo Prueba."""

from sqlalchemy.orm import Session

from ..models import ConfiguracionSistema


def obtener(db: Session) -> ConfiguracionSistema:
    cfg = db.get(ConfiguracionSistema, 1)
    if not cfg:
        cfg = ConfiguracionSistema(id=1, modo_prueba=False)
        db.add(cfg)
        db.flush()
    return cfg


def modo_prueba_activo(db: Session) -> bool:
    return obtener(db).modo_prueba
