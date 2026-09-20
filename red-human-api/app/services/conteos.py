"""Conteos de candidatos por etapa — ÚNICA fuente de verdad (2026-09-20, Bloque 4).

`Postulacion.etapa` es la única columna que dice en qué etapa está un candidato. Todo contador
(tarjeta/detalle de la vacante, pipeline global, Kanban) sale de la MISMA base:

    postulaciones ACTIVAS (`Postulacion.activa`) de la Cuenta, cuya persona no está eliminada
    (`Candidato.eliminado_en IS NULL`), incluidas las de Modo Prueba (el Kanban las muestra).

Esa es exactamente la base de `GET /candidatos` sin filtros, así que la suma por etapa de una vacante
== número de tarjetas del Kanban filtrado por esa vacante, y el pipeline global == Kanban completo.
"""

from typing import Dict, Optional

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from ..models import Candidato, Postulacion


def postulaciones_visibles(db: Session, cuenta_id: int, vacante_id: Optional[int] = None) -> Query:
    """Base común (ver docstring del módulo). Mismo filtro que el Kanban por defecto."""
    q = (
        db.query(Postulacion)
        .join(Candidato, Postulacion.candidato_id == Candidato.id)
        .filter(Postulacion.cuenta_id == cuenta_id, Candidato.eliminado_en.is_(None), Postulacion.activa.is_(True))
    )
    if vacante_id is not None:
        q = q.filter(Postulacion.vacante_id == vacante_id)
    return q


def por_etapa(db: Session, cuenta_id: int, vacante_id: Optional[int] = None) -> Dict[str, int]:
    """{etapa: n} de postulaciones activas — Cuenta completa o una vacante."""
    filas = (
        postulaciones_visibles(db, cuenta_id, vacante_id)
        .with_entities(Postulacion.etapa, func.count(Postulacion.id))
        .group_by(Postulacion.etapa)
        .all()
    )
    return {etapa: int(n) for etapa, n in filas}


def por_estado(db: Session, cuenta_id: int, vacante_id: Optional[int] = None) -> Dict[str, int]:
    """{estado del agente: n} sobre la misma base (para la tarjeta de la vacante)."""
    filas = (
        postulaciones_visibles(db, cuenta_id, vacante_id)
        .with_entities(Postulacion.estado, func.count(Postulacion.id))
        .group_by(Postulacion.estado)
        .all()
    )
    return {estado: int(n) for estado, n in filas}


def total(db: Session, cuenta_id: int, vacante_id: Optional[int] = None) -> int:
    return postulaciones_visibles(db, cuenta_id, vacante_id).count()
