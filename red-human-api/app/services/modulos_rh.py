"""Disponibilidad de los módulos nuevos de RH (Desempeño y Clima) — andamiaje 2026-09-22.

Mismo patrón que `services/rag.py` tras el hotfix del 2026-09-18: sus tablas se crean en un paso
aparte y NO fatal del arranque (`migraciones.crear_tablas_modulos_rh`). Si el motor de producción las
rechaza, la API arranca igual y estos módulos responden 503 con el motivo exacto en vez de tumbar
todo el servicio.
"""

from fastapi import HTTPException

_DISPONIBLE = {"ok": True, "error": ""}


def marcar_disponible(ok: bool, error: str = "") -> None:
    _DISPONIBLE["ok"] = bool(ok)
    _DISPONIBLE["error"] = error or ""


def disponible() -> bool:
    return _DISPONIBLE["ok"]


def error_inicializacion() -> str:
    return _DISPONIBLE["error"]


def requiere_modulos_rh() -> None:
    """Dependencia de FastAPI: 503 con el motivo si las tablas no se pudieron crear."""
    if not _DISPONIBLE["ok"]:
        raise HTTPException(
            503,
            "Los módulos de Desempeño y Clima no están disponibles en este servidor: "
            f"no se pudieron crear sus tablas ({_DISPONIBLE['error'] or 'sin detalle'}).",
        )
