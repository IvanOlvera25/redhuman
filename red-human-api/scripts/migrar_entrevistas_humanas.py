"""Migra los campos sueltos `Candidato.entrevista_humana_*` (legado, uno por candidato) a la
tabla nueva `entrevistas_humanas` (uno a muchos, ver models.EntrevistaHumana — Lote 3).

Por cada Candidato con `entrevista_humana_fecha` no nulo, crea UNA fila EntrevistaHumana con
esos 13 campos copiados tal cual, más:
  - token: nunca existió antes (la liga del entrevistador es nueva en este lote), se genera
    aunque no se vaya a mandar correo por esta entrevista ya vieja/cerrada.
  - resultado_capturado_por: "rh" si el candidato ya tenía un resultado capturado con el flujo
    viejo (era RH quien lo tecleaba a mano, la única fuente que existía hasta hoy); "" si no.

Las columnas viejas de `Candidato` NO se tocan ni se borran — quedan de puente. Este script se
puede correr más de una vez sin duplicar: si el candidato ya tiene alguna fila en
`entrevistas_humanas`, se salta (asumimos que ya fue migrado).

Uso (desde red-human-api/):
    .venv/bin/python scripts/migrar_entrevistas_humanas.py           # pide confirmación
    .venv/bin/python scripts/migrar_entrevistas_humanas.py --forzar  # sin preguntar
"""

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # para poder importar `app.*`

from app.database import SessionLocal  # noqa: E402
from app.models import Candidato, EntrevistaHumana  # noqa: E402


def migrar(db, forzar: bool) -> int:
    candidatos = (
        db.query(Candidato)
        .filter(Candidato.entrevista_humana_fecha.isnot(None))
        .all()
    )
    if not candidatos:
        print("No hay candidatos con Entrevista Humana (campos legado) que migrar.")
        return 0

    ya_migrados = [c for c in candidatos if c.entrevistas_humanas]
    pendientes = [c for c in candidatos if not c.entrevistas_humanas]

    if ya_migrados:
        print(f"{len(ya_migrados)} candidato(s) ya tienen fila(s) en entrevistas_humanas — se omiten:")
        for c in ya_migrados:
            print(f"  {c.codigo} — {c.nombre}")

    if not pendientes:
        print("No queda nada por migrar.")
        return 0

    print(f"\nSe van a crear {len(pendientes)} fila(s) en EntrevistaHumana:")
    for c in pendientes:
        tiene_resultado = "con resultado" if c.entrevista_humana_resultado else "sin resultado"
        print(
            f"  {c.codigo} — {c.nombre} · entrevistador: "
            f"{c.entrevista_humana_entrevistador or '(sin nombre)'} · "
            f"fecha: {c.entrevista_humana_fecha} · {tiene_resultado}"
        )

    if not forzar:
        resp = input("\n¿Confirmas? Esto no se puede deshacer (escribe 'si'): ").strip().lower()
        if resp != "si":
            print("Cancelado — no se escribió nada.")
            return 1

    for c in pendientes:
        db.add(EntrevistaHumana(
            candidato_id=c.id,
            entrevistador=c.entrevista_humana_entrevistador,
            tipo=c.entrevista_humana_tipo,
            usuario_id=c.entrevista_humana_usuario_id,
            correo_externo=c.entrevista_humana_correo_externo,
            fecha=c.entrevista_humana_fecha,
            modalidad=c.entrevista_humana_modalidad,
            liga=c.entrevista_humana_liga,
            ubicacion=c.entrevista_humana_ubicacion,
            telefono_contacto=c.entrevista_humana_telefono_contacto,
            comentario=c.entrevista_humana_comentario,
            realizada=c.entrevista_humana_realizada,
            resultado=c.entrevista_humana_resultado,
            recomendacion=c.entrevista_humana_recomendacion,
            token=secrets.token_urlsafe(24),
            resultado_capturado_por="rh" if c.entrevista_humana_resultado else "",
        ))

    db.commit()
    print(f"\nListo: {len(pendientes)} fila(s) creada(s) en entrevistas_humanas.")
    print("Las columnas entrevista_humana_* de Candidato NO se tocaron — siguen ahí de puente.")
    return 0


def main() -> int:
    forzar = "--forzar" in sys.argv[1:]
    db = SessionLocal()
    try:
        return migrar(db, forzar)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
