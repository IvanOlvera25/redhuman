"""Fase 2 (Puntos 7/8) — migra los datos existentes al modelo Candidato (persona) + Postulacion.

Por cada `Candidato` sin postulación crea UNA `Postulacion` copiando el estado del proceso que
vivía en la persona (etapa, estado, score, análisis, consentimiento, videollamada…) y le liga
los `Mensaje`, `Entrevista`, `EntrevistaHumana` y `Expediente` que aún cuelgan solo de la
persona. Los candidatos sin vacante también reciben su postulación (decisión 2026-09-11) para
seguir visibles en Prefiltro.

Idempotente: se puede correr las veces que haga falta. La lógica vive en
app/migraciones.py::migrar_postulaciones (la usa también seed.py en una base nueva).

Uso:
    .venv/Scripts/python.exe scripts/migrar_postulaciones.py           # muestra el plan y pide confirmación
    .venv/Scripts/python.exe scripts/migrar_postulaciones.py --forzar  # ejecuta directo
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.migraciones import candidatos_sin_postulacion, migrar_postulaciones, sincronizar  # noqa: E402
from app.models import Candidato, Entrevista, EntrevistaHumana, Expediente, Mensaje, Postulacion  # noqa: E402


def main(forzar: bool) -> int:
    # Esquema primero: la tabla `postulaciones` y las columnas `postulacion_id` nuevas.
    Base.metadata.create_all(bind=engine)
    cambios = sincronizar(engine)
    if cambios:
        print(f"[esquema] columnas agregadas: {', '.join(cambios)}")

    with SessionLocal() as db:
        pendientes = candidatos_sin_postulacion(db)
        huerfanos = {
            "mensajes": db.query(Mensaje).filter(Mensaje.postulacion_id.is_(None)).count(),
            "entrevistas IA": db.query(Entrevista).filter(Entrevista.postulacion_id.is_(None)).count(),
            "entrevistas humanas": db.query(EntrevistaHumana).filter(EntrevistaHumana.postulacion_id.is_(None)).count(),
            "expedientes": db.query(Expediente).filter(Expediente.postulacion_id.is_(None)).count(),
        }
        print("=" * 60)
        print("MIGRACIÓN FASE 2 — Candidato (persona) + Postulacion")
        print("=" * 60)
        print(f"Candidatos en total:               {db.query(Candidato).count()}")
        print(f"Postulaciones ya existentes:       {db.query(Postulacion).count()}")
        print(f"Candidatos SIN postulación:        {pendientes}")
        for k, v in huerfanos.items():
            print(f"{k.capitalize():<26} sin postulacion_id: {v}")
        print("=" * 60)

        if pendientes == 0 and not any(huerfanos.values()):
            print("Todo está ya en el modelo de Fase 2. Nada que hacer.")
            return 0

        if not forzar:
            resp = input("¿Proceder con la migración? [s/N]: ").strip().lower()
            if resp not in ("s", "si", "sí", "y", "yes"):
                print("Cancelado por el usuario.")
                return 0

        conteo = migrar_postulaciones(db)
        db.commit()
        print("\n✅ Migración completada:")
        for k, v in conteo.items():
            print(f"  - {k:<22} {v}")
        return 0


if __name__ == "__main__":
    sys.exit(main(forzar="--forzar" in sys.argv))
