"""Diagnóstico (2026-09-17): qué Cuenta publica cada vacante que aparece en el portal público.

Úsalo cuando «una vacante eliminada sigue en el portal»: el dashboard solo ve la Cuenta actual, el
portal global las ve todas. Solo lectura. Uso (desde red-human-api/, con el .env de producción):
    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/diagnostico_vacantes_portal.py [texto a buscar]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.models import Cuenta, Vacante  # noqa: E402

filtro = " ".join(sys.argv[1:]).strip().lower()
with SessionLocal() as db:
    cuentas = {c.id: c for c in db.query(Cuenta).all()}
    filas = db.query(Vacante).order_by(Vacante.cuenta_id, Vacante.id).all()
    print(f"{'código':10} {'estado':12} {'cuenta_id':9} {'cuenta':28} {'estado cuenta':14} título")
    for v in filas:
        if filtro and filtro not in (v.titulo or "").lower():
            continue
        cu = cuentas.get(v.cuenta_id)
        en_portal = v.estado == "Publicada" and cu is not None and cu.estado == "Activa"
        print(
            f"{v.codigo:10} {v.estado:12} {str(v.cuenta_id):9} {(cu.nombre_visible if cu else '— SIN CUENTA —'):28} "
            f"{(cu.estado if cu else '-'):14} {v.titulo}{'   ← visible en el portal global' if en_portal else ''}"
        )
