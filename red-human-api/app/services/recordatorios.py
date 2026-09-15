"""
Fase 3 (2026-09-15) — Recordatorios automáticos de documentos pendientes.

`revisar_recordatorios_documentos` corre cada hora (lifespan, app/main.py). Para cada expediente en
integración con documentos obligatorios pendientes y una fecha «recordar hasta»
(Expediente.documentos_hasta) manda el recordatorio por la regla `recordatorio_documentos` de la Cuenta
(services/notificaciones.disparar, sin override — es un evento automático):

- cada `ConfiguracionSistema.recordatorio_documentos_dias` días (default 2), no antes de las
  `recordatorio_documentos_hora` (hora de México, default 10:00);
- NUNCA después de `documentos_hasta`: al vencer se registra UNA vez `documentos_fecha_limite_vencida`
  en bitácora para que RH decida, y no se vuelve a escribir al candidato;
- idempotente entre workers/reinicios: `ultimo_recordatorio_en` se reclama con UPDATE condicional y
  commit ANTES de enviar (mismo patrón que services/agenda.py).
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import ConfiguracionSistema, Expediente, Postulacion, registrar
from . import notificaciones
from .configuracion import obtener

TZ_MEXICO = ZoneInfo("America/Mexico_City")


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _fin_del_dia_mx(dt: datetime) -> datetime:
    """`documentos_hasta` se captura como fecha; el límite real es el final de ese día en México."""
    local = _utc(dt).astimezone(TZ_MEXICO)
    return local.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(timezone.utc)


def toca_recordar(e: Expediente, cfg: ConfiguracionSistema, ahora: datetime) -> str:
    """"" si NO toca (con el motivo vacío); si toca, "enviar"; si ya venció, "vencido"."""
    if e.estado == "alta" or not e.documentos_hasta or not e.pendientes:
        return ""
    p = e.postulacion
    if p is not None and not p.activa:
        return ""
    if ahora > _fin_del_dia_mx(e.documentos_hasta):
        return "" if e.documentos_vencidos_avisado else "vencido"
    if ahora.astimezone(TZ_MEXICO).hour < int(cfg.recordatorio_documentos_hora or 0):
        return ""
    ultimo = _utc(e.ultimo_recordatorio_en)
    if ultimo is None:
        # sin recordatorio previo: el primero sale al día siguiente de solicitar (la solicitud inicial
        # ya la mandó RH con «Solicitar documentos»), contando desde la creación del expediente.
        ultimo = _utc(e.creado_en)
    if ahora - ultimo < timedelta(days=max(1, int(cfg.recordatorio_documentos_dias or 1))):
        return ""
    return "enviar"


def _reclamar(db: Session, e: Expediente, ahora: datetime) -> bool:
    previo = e.ultimo_recordatorio_en
    q = db.query(Expediente).filter(Expediente.id == e.id)
    q = q.filter(Expediente.ultimo_recordatorio_en.is_(None)) if previo is None else q.filter(Expediente.ultimo_recordatorio_en == previo)
    filas = q.update({Expediente.ultimo_recordatorio_en: ahora}, synchronize_session=False)
    db.commit()
    return filas == 1


async def revisar_recordatorios_documentos() -> int:
    """Regresa cuántos recordatorios mandó."""
    ahora = datetime.now(timezone.utc)
    enviados = 0
    with SessionLocal() as db:
        cfg = obtener(db)
        expedientes = (
            db.query(Expediente)
            .filter(Expediente.documentos_hasta.isnot(None), Expediente.estado != "alta")
            .all()
        )
        for e in expedientes:
            accion = toca_recordar(e, cfg, ahora)
            if not accion:
                continue
            p = e.postulacion
            if accion == "vencido":
                e.documentos_vencidos_avisado = True
                registrar(
                    db, "sistema", "documentos_fecha_limite_vencida", "expediente", str(e.id),
                    {"postulacion": p.codigo if p else None, "pendientes": e.pendientes, "hasta": _utc(e.documentos_hasta).isoformat()},
                )
                db.commit()
                continue
            if p is None or not _reclamar(db, e, ahora):
                continue
            db.refresh(e)
            resultados = await notificaciones.disparar(
                db, "recordatorio_documentos", p, "sistema",
                extra={"pendientes": e.pendientes, "puesto": e.puesto or "tu nuevo puesto", "fecha_limite": _utc(e.documentos_hasta)},
            )
            registrar(
                db, "sistema", "recordatorio_documentos_automatico", "expediente", str(e.id),
                {"postulacion": p.codigo, "pendientes": e.pendientes, "notificaciones": resultados},
            )
            db.commit()
            enviados += 1
        if enviados:
            print(f"[recordatorios] {enviados} recordatorio(s) de documentos enviados.", flush=True)
    return enviados
