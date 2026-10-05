"""Consulta automática de resultados de pruebas conectadas a un proveedor (2026-10-04, ajustado 2026-10-05).

CADA llamada a la API de Psicométricas.mx gasta una «petición» de su paquete de API (100 por paquete). La primera versión
preguntaba cada 10 minutos en cada proceso del servidor y agotó el paquete en unas horas. Ahora:
* corre en UN solo proceso (candado de archivo) aunque haya varios workers;
* cada evaluación se consulta como máximo cada `PSICOMETRICAS_HORAS_ENTRE_CONSULTAS` (6 h) y solo sus primeros 21 días;
* hay un tope diario de consultas automáticas (`PSICOMETRICAS_CONSULTAS_DIA`, 8);
* si el proveedor responde credencial/paquete (1001/1002/1003) se PAUSA 12 h — no se insiste contra una cuenta sin paquete.
El webhook del proveedor y el botón «Consultar resultado» siguen disponibles (una petición cada uno).
"""

import fcntl
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..database import SessionLocal

_ESTADO = os.path.join(tempfile.gettempdir(), "redhuman_psicometria_sync.json")
_CANDADO = _ESTADO + ".lock"


def _leer_estado() -> dict:
    try:
        with open(_ESTADO) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _guardar_estado(d: dict) -> None:
    try:
        with open(_ESTADO, "w") as f:
            json.dump(d, f)
    except Exception:  # noqa: BLE001
        pass


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


async def revisar_resultados_psicometria() -> int:
    from ..models import EvaluacionCandidato, registrar
    from . import evaluaciones as sev
    from . import psicometricas as psi

    if not psi.configurado():
        return 0
    try:
        candado = open(_CANDADO, "w")
        fcntl.flock(candado, fcntl.LOCK_EX | fcntl.LOCK_NB)  # otro worker ya la está corriendo
    except OSError:
        return 0
    ahora = datetime.now(timezone.utc)
    estado = _leer_estado()
    if estado.get("pausa_hasta") and datetime.fromisoformat(estado["pausa_hasta"]) > ahora:
        return 0
    hoy = ahora.date().isoformat()
    usadas = estado.get("consultas", 0) if estado.get("dia") == hoy else 0
    tope = max(0, int(settings.psicometricas_consultas_dia))
    espera = timedelta(hours=max(1, int(settings.psicometricas_horas_entre_consultas)))
    db = SessionLocal()
    n = 0
    try:
        candidatas = (
            db.query(EvaluacionCandidato)
            .filter(EvaluacionCandidato.clave_proveedor != "", EvaluacionCandidato.estado.in_(("pendiente", "en_proceso")))
            .order_by(EvaluacionCandidato.proveedor_consultado_en.asc().nullsfirst(), EvaluacionCandidato.id)
            .all()
        )
        for ev in candidatas:
            if usadas >= tope:
                break
            if _utc(ev.creada_en) and _utc(ev.creada_en) < ahora - timedelta(days=21):
                continue
            if ev.proveedor_consultado_en and _utc(ev.proveedor_consultado_en) > ahora - espera:
                continue
            ev.proveedor_consultado_en = ahora
            db.commit()
            usadas += 1
            try:
                r = sev.sincronizar_psicometricas(db, ev, por="Psicométricas.mx (consulta automática)")
            except psi.PsicometricasError as ex:
                print(f"[psicometria] {ev.codigo}: {ex}", flush=True)
                if any(c in str(ex) for c in ("1001", "1002", "1003")):
                    estado["pausa_hasta"] = (ahora + timedelta(hours=12)).isoformat()
                    estado["motivo_pausa"] = str(ex)
                    break
                continue
            if r == "resultado_recibido":
                usadas += 2  # resultado JSON + PDF
                registrar(db, "sistema", "evaluacion_resultado_automatico", "evaluaciones", ev.codigo, {"proveedor": ev.proveedor})
                db.commit()
                n += 1
        return n
    except Exception as ex:  # noqa: BLE001
        print(f"[psicometria] consulta automática falló: {ex}", flush=True)
        db.rollback()
        return n
    finally:
        estado.update({"dia": hoy, "consultas": usadas})
        _guardar_estado(estado)
        db.close()
        try:
            fcntl.flock(candado, fcntl.LOCK_UN)
            candado.close()
        except Exception:  # noqa: BLE001
            pass
