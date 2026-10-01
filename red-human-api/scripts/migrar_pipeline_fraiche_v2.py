"""Cambios integrados Fraiche (2026-10-01) — migración de DATOS (manual, como todas las del proyecto).

1. Postulaciones en la columna retirada «Evaluación» → Filtro humano (si ya tienen entrevista humana o evaluación)
   o Filtro Red Human (si no).
2. Franquicias cerradas como «aceptado_franquicia» → se reabren en Filtro humano con «Aceptado» (ahora siguen a
   Contratación, donde RH registra la confirmación del franquiciatario).
3. Franquicia: lo PENDIENTE de IPV / psicometría / médico / socioeconómico se cancela con motivo (resultados e
   historial se conservan).
4. Guiones de Entrevista Red Human ya configurados y aún sin hacer: sin sueldo, disponibilidad «¿Cuándo podrías
   empezar a trabajar en Fraiche?» y nombre visible de la empresa.
5. Cuenta «fraiche»: sueldos de las vacantes demo como monto fijo ($11,500 / $12,800 / $14,500 MXN mensuales) en
   lugar de «Desde …».

Uso (desde red-human-api/, con DATABASE_URL apuntando a la base destino):
    .venv/bin/python scripts/migrar_pipeline_fraiche_v2.py            → simulacro (rollback)
    .venv/bin/python scripts/migrar_pipeline_fraiche_v2.py --ejecutar → guarda
"""

import argparse
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
for _k in ("WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "RESEND_API_KEY", "OPENAI_API_KEY", "ANAM_API_KEY", "TELEGRAM_BOT_TOKEN"):
    os.environ[_k] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.migraciones import sincronizar  # noqa: E402
from app.models import Cuenta, Vacante, texto_sueldo  # noqa: E402
from app.services import fraiche_pipeline as fp  # noqa: E402


def sueldos_demo(db) -> int:
    c = db.query(Cuenta).filter(Cuenta.slug == "fraiche").first()
    if not c:
        return 0
    n = 0
    for v in db.query(Vacante).filter(Vacante.cuenta_id == c.id).all():
        if v.sueldo_desde and not v.sueldo_hasta:
            v.sueldo_hasta = v.sueldo_desde
            v.sueldo = texto_sueldo(v.sueldo_desde, v.sueldo_hasta, v.sueldo_moneda or "MXN", v.sueldo_periodicidad or "mensual")
            n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ejecutar", action="store_true")
    args = ap.parse_args()
    Base.metadata.create_all(bind=engine)
    sincronizar(engine)
    db = SessionLocal()
    try:
        r = {"reubicadas_evaluacion": fp.reubicar_evaluacion(db), "franquicias_reabiertas": fp.reabrir_aceptados_franquicia(db)}
        db.flush()
        r["pendientes_cancelados_franquicia"] = fp.limpiar_franquicias(db)
        r["guiones_corregidos"] = fp.refrescar_guiones(db)
        r["sueldos_demo"] = sueldos_demo(db)
        for k, v in r.items():
            print(f"  {k:<34} {v}")
        if args.ejecutar:
            db.commit()
            print("✅ Migración del pipeline Fraiche v2 guardada.")
        else:
            db.rollback()
            print("ℹ️  Simulacro: nada se guardó. Vuelve a correr con --ejecutar.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
