"""Borra ÚNICAMENTE los candidatos creados por seed_demo_candidatos.py (los que tienen
`codigo` con prefijo "DEMO-") y todo lo que cuelga de ellos: Mensaje, Entrevista,
Expediente + sus Documento. No toca ningún otro candidato ni la Vacante que hayan usado
(puede ser una vacante real).

La Bitácora NUNCA se toca — es un log de auditoría append-only con cadena de hashes
(LFPDPPP); borrar una fila de ahí rompería la cadena de todo lo que viene después. Los
eventos que quedan referenciando a un candidato demo ya borrado son exactamente lo que
se espera cuando se borra cualquier registro, real o demo.

Uso (desde red-human-api/):
    .venv/bin/python scripts/borrar_demo_candidatos.py           # pide confirmación
    .venv/bin/python scripts/borrar_demo_candidatos.py --forzar  # sin preguntar
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # para poder importar `app.*`

from app.database import SessionLocal  # noqa: E402
from app.models import Candidato, Entrevista, Expediente, Mensaje, registrar  # noqa: E402

PREFIJO = "DEMO-"


def borrar_demo(db, forzar: bool) -> int:
    candidatos = db.query(Candidato).filter(Candidato.codigo.like(f"{PREFIJO}%")).all()
    if not candidatos:
        print("No hay candidatos demo (código 'DEMO-%') que borrar.")
        return 0

    print(f"Se van a borrar {len(candidatos)} candidatos demo:")
    for c in candidatos:
        print(f"  {c.codigo} — {c.nombre} ({c.etapa})")

    if not forzar:
        resp = input("\n¿Confirmas? Esto no se puede deshacer (escribe 'si'): ").strip().lower()
        if resp != "si":
            print("Cancelado — no se borró nada.")
            return 1

    ids = [c.id for c in candidatos]

    n_msj = db.query(Mensaje).filter(Mensaje.candidato_id.in_(ids)).delete(synchronize_session=False)
    n_ent = db.query(Entrevista).filter(Entrevista.candidato_id.in_(ids)).delete(synchronize_session=False)

    # Expediente uno por uno (no bulk delete) para que la cascada del ORM se lleve
    # también sus Documento — Expediente.documentos tiene cascade="all, delete-orphan".
    expedientes = db.query(Expediente).filter(Expediente.candidato_id.in_(ids)).all()
    n_doc = sum(len(e.documentos) for e in expedientes)
    for e in expedientes:
        db.delete(e)
    db.flush()

    codigos = [c.codigo for c in candidatos]
    for c in candidatos:
        db.delete(c)  # Candidato.archivos también tiene cascade="all, delete-orphan"

    registrar(db, "sistema", "semilla_demo_borrada", "sistema", "seed_demo", {"candidatos": codigos})
    db.commit()

    print(
        f"\nBorrados: {len(candidatos)} candidatos, {n_msj} mensajes, {n_ent} entrevistas, "
        f"{len(expedientes)} expedientes ({n_doc} documentos)."
    )
    print("La Vacante que usaban NO se tocó. La Bitácora tampoco — quedan sus registros históricos.")
    return 0


def main() -> int:
    forzar = "--forzar" in sys.argv[1:]
    db = SessionLocal()
    try:
        return borrar_demo(db, forzar)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
