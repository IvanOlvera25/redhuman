"""Pasar de ambiente de prueba a PRODUCCIÓN (2026-10-02) sin trasladar datos de prueba.

Antes de correrlo: poner `AMBIENTE_PRUEBA=false` en el .env del servidor. Este script:
  1. Apaga el Modo Prueba de Configuración.
  2. Cierra TODAS las postulaciones de prueba (`es_prueba`) con motivo `prueba_expirada` (baja lógica: sus conversaciones,
     entrevistas y resultados quedan como historial cerrado y fuera de tableros, Kanban y reportes).
  3. Da de baja lógica a las personas de prueba que no tengan ninguna postulación productiva.
Nada se borra físicamente; los vínculos de Telegram (identidad chat ↔ teléfono) se conservan.

Uso (desde red-human-api/, con DATABASE_URL apuntando a la base destino):
    .venv/bin/python scripts/preparar_produccion.py            → simulacro (rollback)
    .venv/bin/python scripts/preparar_produccion.py --ejecutar → guarda
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import Candidato, Postulacion, registrar  # noqa: E402
from app.services import configuracion  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ejecutar", action="store_true")
    args = ap.parse_args()
    if settings.ambiente_prueba:
        print("⚠️  AMBIENTE_PRUEBA sigue en true: ponlo en false en el .env antes de habilitar producción.")
    db = SessionLocal()
    try:
        cfg = configuracion.obtener(db)
        modo_antes = cfg.modo_prueba
        cfg.modo_prueba = False
        ahora = datetime.now(timezone.utc)
        cerradas = 0
        for p in db.query(Postulacion).filter(Postulacion.es_prueba.is_(True), Postulacion.activa.is_(True)).all():
            p.cerrar("prueba_expirada")
            cerradas += 1
        personas = 0
        for c in db.query(Candidato).filter(Candidato.es_prueba.is_(True), Candidato.eliminado_en.is_(None)).all():
            if any(not x.es_prueba for x in c.postulaciones):
                continue
            c.eliminado_en, c.eliminado_por = ahora, "preparar_produccion"
            if c.postulacion_conversacion_id:
                c.postulacion_conversacion_id = None
            personas += 1
        registrar(db, "sistema", "preparar_produccion", "sistema", "ambiente", {"postulaciones_cerradas": cerradas, "personas_baja": personas, "modo_prueba_antes": modo_antes})
        print(f"  Modo Prueba de Configuración: {'encendido → apagado' if modo_antes else 'ya estaba apagado'}")
        print(f"  Postulaciones de prueba cerradas: {cerradas}")
        print(f"  Personas de prueba dadas de baja (lógica): {personas}")
        if args.ejecutar:
            db.commit()
            print("✅ Listo para producción: se empieza sin postulaciones, conversaciones ni resultados de prueba.")
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
