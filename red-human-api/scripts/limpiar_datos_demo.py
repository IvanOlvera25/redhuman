"""Limpieza de datos de EJEMPLO para arrancar en vivo (2026-09-15).

Hasta hoy `app/seed.py` sembraba 6 vacantes (VAC-1037…VAC-1042) y 11 candidatos (C-8801…C-8811) en toda base
vacía. Este script les aplica BAJA LÓGICA con las mismas reglas que los endpoints DELETE (nada se borra
físicamente; el historial y la bitácora se conservan):
  - vacantes de ejemplo → estado «Eliminada» (sus postulaciones activas se cierran con `vacante_eliminada`);
  - candidatos de ejemplo → `eliminado_en` (sus postulaciones se cierran con `eliminado`);
  - colaboradores nacidos de esos candidatos → eliminación lógica.
Solo toca filas cuyo código Y título/nombre coinciden con el seed: una vacante real que reutilizó un código
no se toca.

Uso (desde red-human-api/):
    .venv/Scripts/python.exe scripts/limpiar_datos_demo.py            # dry-run: muestra qué haría
    .venv/Scripts/python.exe scripts/limpiar_datos_demo.py --forzar   # aplica (pide confirmación)
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.models import Candidato, Colaborador, Vacante, registrar  # noqa: E402

VACANTES_SEED = {
    "VAC-1042": "Cajero(a) de sucursal",
    "VAC-1041": "Ejecutivo(a) de ventas telefónicas",
    "VAC-1040": "Auxiliar de almacén",
    "VAC-1039": "Analista de nómina",
    "VAC-1038": "Desarrollador(a) Full-Stack",
    "VAC-1037": "Supervisor(a) de piso",
}
CANDIDATOS_SEED = {
    "C-8801": "María Fernanda López", "C-8802": "Jorge Alberto Ramírez", "C-8803": "Ana Sofía Herrera",
    "C-8804": "Luis Ángel Torres", "C-8805": "Diana Karen Méndez", "C-8806": "Roberto Carlos Nava",
    "C-8807": "Gabriela Ruiz Ponce", "C-8808": "Emiliano Cruz Vega", "C-8809": "Valeria Jiménez Soto",
    "C-8810": "Héctor Manuel Ríos", "C-8811": "Fernando Castillo Prado",
}


def main(forzar: bool) -> int:
    ahora = datetime.now(timezone.utc)
    with SessionLocal() as db:
        vacantes = [
            v for v in db.query(Vacante).filter(Vacante.codigo.in_(list(VACANTES_SEED))).all()
            if v.titulo == VACANTES_SEED[v.codigo] and v.estado != "Eliminada"
        ]
        candidatos = [
            c for c in db.query(Candidato).filter(Candidato.codigo.in_(list(CANDIDATOS_SEED))).all()
            if c.nombre == CANDIDATOS_SEED[c.codigo] and c.eliminado_en is None
        ]
        colaboradores = [
            col for col in db.query(Colaborador).filter(Colaborador.candidato_origen_id.in_([c.id for c in candidatos] or [-1])).all()
            if col.eliminado_en is None
        ] if candidatos else []

        print(f"Vacantes de ejemplo a eliminar (lógico): {len(vacantes)}")
        for v in vacantes:
            print(f"  · {v.codigo} {v.titulo} ({v.estado}, {sum(1 for p in v.postulaciones if p.activa)} postulaciones activas)")
        print(f"Candidatos de ejemplo a eliminar (lógico): {len(candidatos)}")
        for c in candidatos:
            print(f"  · {c.codigo} {c.nombre} ({len(c.postulaciones)} postulaciones)")
        print(f"Colaboradores de ejemplo a eliminar (lógico): {len(colaboradores)}")

        if not (vacantes or candidatos or colaboradores):
            print("\nNada que limpiar: la base no tiene datos de ejemplo.")
            return 0
        if not forzar:
            print("\nDry-run. Vuelve a correr con --forzar para aplicar.")
            return 0
        if input("\n¿Aplicar la baja lógica a estos registros? (escribe SI): ").strip().upper() != "SI":
            print("Cancelado.")
            return 1

        for v in vacantes:
            cerradas = []
            for p in v.postulaciones:
                if p.activa:
                    p.cerrar("vacante_eliminada")
                    cerradas.append(p.codigo)
            v.estado = "Eliminada"
            v.plataformas = []
            v.eliminada_en = ahora
            v.eliminada_por = "limpiar_datos_demo"
            registrar(db, "sistema", "vacante_eliminada", "vacante", v.codigo, {"titulo": v.titulo, "postulaciones_cerradas": cerradas, "origen": "limpiar_datos_demo"})
        for c in candidatos:
            cerradas = []
            for p in c.postulaciones:
                if p.activa:
                    p.cerrar("eliminado")
                    cerradas.append(p.codigo)
            c.eliminado_en = ahora
            c.eliminado_por = "limpiar_datos_demo"
            c.postulacion_conversacion_id = None
            registrar(db, "sistema", "candidato_eliminado", "candidato", c.codigo, {"nombre": c.nombre, "postulaciones_cerradas": cerradas, "origen": "limpiar_datos_demo"})
        for col in colaboradores:
            col.eliminado_en = ahora
            col.eliminado_por = "limpiar_datos_demo"
            col.activo = False
            registrar(db, "sistema", "colaborador_eliminado", "colaborador", col.codigo, {"nombre": col.nombre, "origen": "limpiar_datos_demo"})
        db.commit()
        print(f"\nListo: {len(vacantes)} vacantes, {len(candidatos)} candidatos y {len(colaboradores)} colaboradores de ejemplo con baja lógica.")
    return 0


if __name__ == "__main__":
    sys.exit(main("--forzar" in sys.argv))
