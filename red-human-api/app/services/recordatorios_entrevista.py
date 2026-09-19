"""
2026-09-19 — Recordatorio automático de la Entrevista Humana.

`revisar_recordatorios_entrevista` corre cada 10 min (lifespan, app/main.py): para cada Entrevista Humana
vigente (no cancelada, sin realizar, postulación activa) cuya fecha cae dentro de las próximas
`ConfiguracionSistema.recordatorio_entrevista_horas` (default 24; 0 = apagado) y que aún no tiene
`recordatorio_enviado_en`, dispara el evento `recordatorio_entrevista` (regla de la Cuenta; default
candidato correo+WhatsApp y entrevistador correo+WhatsApp) con las plantillas HTML corporativas.
Idempotente entre workers: reclama `recordatorio_enviado_en` con UPDATE condicional antes de enviar.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import EntrevistaHumana, Postulacion, registrar
from . import notificaciones
from .configuracion import obtener


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _reclamar(db: Session, eh: EntrevistaHumana, ahora: datetime) -> bool:
    filas = (
        db.query(EntrevistaHumana)
        .filter(EntrevistaHumana.id == eh.id, EntrevistaHumana.recordatorio_enviado_en.is_(None))
        .update({EntrevistaHumana.recordatorio_enviado_en: ahora}, synchronize_session=False)
    )
    db.commit()
    return filas == 1


def pendientes_de_recordatorio(db: Session, ahora: datetime, horas: int):
    limite = ahora + timedelta(hours=horas)
    return (
        db.query(EntrevistaHumana)
        .join(Postulacion, Postulacion.id == EntrevistaHumana.postulacion_id)
        .filter(
            EntrevistaHumana.fecha.isnot(None), EntrevistaHumana.recordatorio_enviado_en.is_(None),
            EntrevistaHumana.cancelada.is_(False), EntrevistaHumana.realizada.is_(False),
            Postulacion.activa.is_(True),
        )
        .all()
    )


async def revisar_recordatorios_entrevista() -> int:
    ahora = datetime.now(timezone.utc)
    enviados = 0
    with SessionLocal() as db:
        cfg = obtener(db)
        horas = int(cfg.recordatorio_entrevista_horas or 0)
        if horas <= 0:
            return 0
        limite = ahora + timedelta(hours=horas)
        for eh in pendientes_de_recordatorio(db, ahora, horas):
            fecha = _utc(eh.fecha)
            if fecha is None or fecha <= ahora or fecha > limite:
                continue
            p = eh.postulacion
            if p is None or not _reclamar(db, eh, ahora):
                continue
            db.refresh(eh)
            resultados = await notificaciones.disparar(db, "recordatorio_entrevista", p, "sistema", eh=eh)
            registrar(db, "sistema", "recordatorio_entrevista_automatico", "postulacion", p.codigo, {"entrevista_humana": eh.id, "fecha": fecha.isoformat(), "notificaciones": resultados})
            db.commit()
            enviados += 1
    if enviados:
        print(f"[recordatorios] {enviados} recordatorio(s) de entrevista enviados.", flush=True)
    return enviados
