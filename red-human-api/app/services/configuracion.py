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


def ventana_modo_prueba_min(db: Session) -> int:
    """Punto 13: minutos sin actividad tras los cuales una conversacion de prueba se considera
    fria y el siguiente mensaje arranca una postulacion nueva (ver webhooks._conversacion_fria)."""
    return int(obtener(db).modo_prueba_ventana_min or 60)


def puede_forzar_prueba(db: Session, forzar: bool) -> bool:
    """`forzar_prueba` (Lote 4) solo tiene efecto si Modo Prueba está activo — en producción
    real, mandar el flag no hace absolutamente nada."""
    return bool(forzar) and modo_prueba_activo(db)
