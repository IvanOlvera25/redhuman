"""Baja lógica de la vacante VAC-1073 (2026-09-17) — mismo efecto que DELETE /vacantes/{codigo}:
estado «Eliminada» (fecha y quién), fuera de portal/WhatsApp/plataformas, y sus postulaciones ACTIVAS
se cierran con motivo `vacante_eliminada`. Nada se borra físicamente (reversible con POST /restaurar).

Uso (desde red-human-api/, con el .env del entorno):
    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/eliminar_vacante_1073.py            # solo muestra
    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/eliminar_vacante_1073.py --forzar   # aplica
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.models import Cuenta, Vacante, registrar  # noqa: E402

CODIGO = "VAC-1073"
ACTOR = "script:eliminar_vacante_1073"
forzar = "--forzar" in sys.argv

with SessionLocal() as db:
    v = db.query(Vacante).filter(Vacante.codigo == CODIGO).first()
    if not v:
        print(f"No existe la vacante {CODIGO}.")
        sys.exit(1)
    cuenta = db.query(Cuenta).filter(Cuenta.id == v.cuenta_id).first() if v.cuenta_id else None
    activas = [p for p in v.postulaciones if p.activa]
    print(f"{v.codigo} «{v.titulo}» · estado={v.estado} · cuenta={cuenta.nombre_visible if cuenta else v.cuenta_id} · postulaciones activas={len(activas)}")
    if v.estado == "Eliminada":
        print("Ya está eliminada; no hay nada que hacer.")
        sys.exit(0)
    if not forzar:
        print("Modo consulta. Corre con --forzar para aplicar la baja lógica.")
        sys.exit(0)

    for p in activas:
        p.cerrar("vacante_eliminada")
    v.estado = "Eliminada"
    v.plataformas = []
    v.eliminada_en = datetime.now(timezone.utc)
    v.eliminada_por = ACTOR
    registrar(
        db, ACTOR, "vacante_eliminada", "vacante", v.codigo,
        {"titulo": v.titulo, "postulaciones_cerradas": [p.codigo for p in activas], "via": "script"},
    )
    db.commit()
    print(f"✅ {v.codigo} marcada como Eliminada; {len(activas)} postulación(es) cerradas con motivo vacante_eliminada.")
