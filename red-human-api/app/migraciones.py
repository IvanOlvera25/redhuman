"""Sincronización de esquema para SQLite (sin Alembic).

`Base.metadata.create_all` crea tablas nuevas pero nunca agrega columnas a una
tabla que ya existe. Como `redhuman.db` vive en disco entre versiones, aquí se
agregan las columnas faltantes con ALTER TABLE, tomando el default declarado en
el modelo para que los renglones viejos no queden en NULL.
"""

import json
from typing import List

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .database import Base


def _default_sql(col) -> str:
    """Cláusula DEFAULT constante para la columna, o cadena vacía si no aplica."""
    d = col.default
    if d is None:
        return ""
    arg = getattr(d, "arg", None)
    if callable(arg):
        try:
            arg = arg(None)  # default_factory (list, dict, …)
        except Exception:
            return ""
    if isinstance(arg, (list, dict)):
        return f" DEFAULT '{json.dumps(arg)}'"
    if isinstance(arg, bool):
        return f" DEFAULT {1 if arg else 0}"
    if isinstance(arg, (int, float)):
        return f" DEFAULT {arg}"
    if isinstance(arg, str):
        return " DEFAULT '{}'".format(arg.replace("'", "''"))
    return ""  # datetimes u otros callables → la columna queda NULL


def sincronizar(engine: Engine) -> List[str]:
    """Agrega a la base las columnas que existen en los modelos y no en las tablas."""
    insp = inspect(engine)
    tablas = set(insp.get_table_names())
    cambios: List[str] = []

    with engine.begin() as con:
        for tabla in Base.metadata.sorted_tables:
            if tabla.name not in tablas:
                continue  # create_all ya la creó completa
            existentes = {c["name"] for c in insp.get_columns(tabla.name)}
            for col in tabla.columns:
                if col.name in existentes:
                    continue
                tipo = col.type.compile(engine.dialect)
                con.execute(text(f"ALTER TABLE {tabla.name} ADD COLUMN {col.name} {tipo}{_default_sql(col)}"))
                cambios.append(f"{tabla.name}.{col.name}")

    return cambios
