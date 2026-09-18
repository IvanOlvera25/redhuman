"""Diagnóstico del esquema (hotfix 2026-09-18): qué motor usa DATABASE_URL, qué tablas existen y qué dice
EXACTAMENTE el motor al intentar crear las tablas de la Base de Conocimiento. Solo lectura salvo el
intento de creación (idempotente: si ya existen no hace nada).

Uso (desde red-human-api/, con el .env del entorno):
    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/diagnostico_esquema.py
"""

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.models import TABLAS_CONOCIMIENTO  # noqa: E402

url = settings.database_url
print(f"Motor: {engine.dialect.name} ({url.split('@')[-1] if '@' in url else url})")
insp = inspect(engine)
existentes = set(insp.get_table_names())
print(f"Tablas existentes: {len(existentes)}")
for nombre in TABLAS_CONOCIMIENTO:
    print(f"\n== {nombre}: {'EXISTE' if nombre in existentes else 'no existe'}")
    if nombre in existentes:
        print("   columnas:", ", ".join(c["name"] for c in insp.get_columns(nombre)))
        print("   llaves foráneas:", insp.get_foreign_keys(nombre) or "ninguna")
        continue
    try:
        Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables[nombre]])
        print("   ✅ creada ahora sin error")
    except Exception:  # noqa: BLE001
        print("   ❌ el motor rechazó la creación:")
        traceback.print_exc()
