"""Conteos de candidatos por etapa — ÚNICA fuente de verdad (2026-09-20, Bloque 4).

`Postulacion.etapa` es la única columna que dice en qué etapa está un candidato. Todo contador
(tarjeta/detalle de la vacante, pipeline global, Kanban) sale de la MISMA base:

    postulaciones ACTIVAS (`Postulacion.activa`) de la Cuenta, cuya persona no está eliminada
    (`Candidato.eliminado_en IS NULL`), incluidas las de Modo Prueba (el Kanban las muestra).

Esa es exactamente la base de `GET /candidatos` sin filtros, así que la suma por etapa de una vacante
== número de tarjetas del Kanban filtrado por esa vacante, y el pipeline global == Kanban completo.
"""

from datetime import datetime
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
    salida: Dict[str, int] = {}
    for etapa, n in filas:
        k = _columna(etapa)
        salida[k] = salida.get(k, 0) + int(n)
    return salida


def _columna(etapa: str) -> str:
    """Pipeline Fraiche v2 (2026-10-01): «Evaluación» ya no es columna — lo que quede ahí cuenta en Filtro humano."""
    return "Entrevista Humana" if etapa == "Evaluación" else etapa


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


def resumen_por_vacante(db: Session, cuenta_id: int, desde_nuevos: datetime) -> Dict[int, dict]:
    """Hotfix concurrencia 2026-09-24: los contadores de TODAS las vacantes de la Cuenta en tres
    consultas agrupadas (antes eran ~5 por vacante en el listado). MISMA base `postulaciones_visibles`,
    así cada número sigue siendo idéntico a `por_etapa`/`por_estado`/`total` de esa vacante.
    Regresa {vacante_id: {"etapas", "estados", "total", "nuevos"}}; una vacante sin postulaciones no aparece."""
    base = postulaciones_visibles(db, cuenta_id).filter(Postulacion.vacante_id.isnot(None))
    res: Dict[int, dict] = {}

    def fila(vid: int) -> dict:
        return res.setdefault(vid, {"etapas": {}, "estados": {}, "total": 0, "nuevos": 0})

    for vid, etapa, n in (
        base.with_entities(Postulacion.vacante_id, Postulacion.etapa, func.count(Postulacion.id))
        .group_by(Postulacion.vacante_id, Postulacion.etapa)
        .all()
    ):
        f = fila(vid)
        k = _columna(etapa)
        f["etapas"][k] = f["etapas"].get(k, 0) + int(n)
        f["total"] += int(n)
    for vid, estado, n in (
        base.with_entities(Postulacion.vacante_id, Postulacion.estado, func.count(Postulacion.id))
        .group_by(Postulacion.vacante_id, Postulacion.estado)
        .all()
    ):
        fila(vid)["estados"][estado] = int(n)
    for vid, n in (
        base.filter(Postulacion.creado_en >= desde_nuevos)
        .with_entities(Postulacion.vacante_id, func.count(Postulacion.id))
        .group_by(Postulacion.vacante_id)
        .all()
    ):
        fila(vid)["nuevos"] = int(n)
    return res
