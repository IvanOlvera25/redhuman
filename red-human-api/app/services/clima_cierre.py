"""Cierre automático de mediciones de clima (Clima v2, 2026-09-27).

Job del scheduler (cada 5 min, `max_instances=1, coalesce=True`): toda medición ABIERTA cuya fecha de
cierre ya pasó pasa a CERRADA (`cerrada_por="sistema"`) y queda en bitácora. Es el único cierre sin
persona detrás, y solo ocurre por la fecha que RH fijó al enviar (editable mientras está abierta).
Desde antes, una medición vencida ya no aceptaba respuestas (`routers.clima._exigir_abierta`); esto
además congela su estado para el tablero.
"""

from datetime import datetime, timezone

from ..database import SessionLocal
from ..models import MedicionClima, registrar


def cerrar_vencidas(db) -> int:
    ahora = datetime.now(timezone.utc)
    cerradas = 0
    for m in db.query(MedicionClima).filter(MedicionClima.estado == "abierta", MedicionClima.cierra_en.isnot(None)).all():
        cierre = m.cierra_en if m.cierra_en.tzinfo else m.cierra_en.replace(tzinfo=timezone.utc)
        if cierre > ahora:
            continue
        m.estado = "cerrada"
        m.cerrada_en = ahora
        m.cerrada_por = "sistema"
        registrar(db, "sistema", "medicion_clima_cerrada_automatica", "clima", m.codigo, {"cierra_en": cierre.isoformat()})
        cerradas += 1
    if cerradas:
        db.commit()
    return cerradas


async def cerrar_mediciones_vencidas() -> int:
    from . import modulos_rh

    if not modulos_rh.disponible():  # tablas de Clima deshabilitadas en este motor: nada que cerrar
        return 0
    with SessionLocal() as db:
        n = cerrar_vencidas(db)
    if n:
        print(f"[clima] {n} medición(es) cerrada(s) por fecha de cierre", flush=True)
    return n
