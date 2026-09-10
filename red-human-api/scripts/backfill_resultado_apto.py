"""Backfill de Fase C -- calcula y guarda resultado_apto para todos los candidatos existentes.

Regla "el mas reciente gana" (identica a _recalcular_resultado_apto en routers/candidatos.py):
  1. Contratacion / Onboarding  -> True siempre (llegaron al final del pipeline).
  2. EntrevistaHumana mas reciente con resultado  -> aprobado=True | no_aprobado=False.
  3. Entrevista IA mas reciente con recomendacion  -> avanzar=True | no_avanzar=False.
  4. Prefiltro (c.estado)  -> cumple=True | no_cumple=False | otro=None.

Uso (desde red-human-api/):
  .venv/Scripts/python.exe scripts/backfill_resultado_apto.py          # dry-run: muestra resumen
  .venv/Scripts/python.exe scripts/backfill_resultado_apto.py --forzar  # pide confirmacion y escribe

Es idempotente: puede correrse mas de una vez sin efectos secundarios.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models import Candidato, Cuenta


def _calcular_resultado(c: "Candidato"):
    """Identica a _recalcular_resultado_apto en routers/candidatos.py -- mantener sincronizadas."""
    # Regla 1: etapas finales del pipeline
    if c.etapa in ("Contrataci\u00f3n", "Onboarding"):
        return True

    # Regla 2 (incluida en Regla 3): EntrevistaHumana mas reciente con resultado registrado
    for eh in reversed(c.entrevistas_humanas):
        if eh.resultado:
            return eh.resultado == "aprobado"

    # Regla 3: Entrevista IA mas reciente evaluada
    for e in reversed(c.entrevistas):
        rec = (e.evaluacion or {}).get("recomendacion", "")
        if rec:
            return rec == "avanzar"

    # Regla 4: Prefiltro del agente (fallback)
    if c.estado == "cumple":
        return True
    if c.estado == "no_cumple":
        return False
    return None


def main() -> None:
    forzar = "--forzar" in sys.argv

    db = SessionLocal()
    try:
        candidatos = (
            db.query(Candidato)
            .order_by(Candidato.cuenta_id, Candidato.id)
            .all()
        )

        # --- Calcular sin tocar la BD todavia ---
        cambios = []
        for c in candidatos:
            nuevo = _calcular_resultado(c)
            cambios.append({"c": c, "antes": c.resultado_apto, "nuevo": nuevo})

        # --- Resumen agrupado por Cuenta ---
        cuentas = {cu.id: cu.nombre for cu in db.query(Cuenta).all()}
        por_cuenta: dict[int, dict[str, int]] = {}
        for ch in cambios:
            cid = ch["c"].cuenta_id
            if cid not in por_cuenta:
                por_cuenta[cid] = {"apto": 0, "no_apto": 0, "sin_eval": 0, "sin_cambio": 0}
            bucket = por_cuenta[cid]
            if ch["antes"] == ch["nuevo"]:
                bucket["sin_cambio"] += 1
            elif ch["nuevo"] is True:
                bucket["apto"] += 1
            elif ch["nuevo"] is False:
                bucket["no_apto"] += 1
            else:
                bucket["sin_eval"] += 1

        total_cambios = sum(1 for ch in cambios if ch["antes"] != ch["nuevo"])

        print("\n=== Backfill resultado_apto -- Fase C ===\n")
        for cid, stats in sorted(por_cuenta.items()):
            nombre = cuentas.get(cid, f"Cuenta {cid}")
            print(f"  [{cid}] {nombre}:")
            print(f"    Apto=True (nuevos)   : {stats['apto']:>5}")
            print(f"    Apto=False (nuevos)  : {stats['no_apto']:>5}")
            print(f"    Apto=None (sin eval) : {stats['sin_eval']:>5}")
            print(f"    Sin cambio           : {stats['sin_cambio']:>5}")
            print()
        print(f"  TOTAL candidatos a actualizar: {total_cambios}")

        if not forzar:
            print("\n  -> Modo dry-run (sin cambios). Usa --forzar para escribir.")
            return

        print("\n  Procediendo a escribir los cambios...")
        resp = input("  Confirmar? [s/N] ").strip().lower()
        if resp != "s":
            print("  Cancelado.")
            return

        for ch in cambios:
            if ch["antes"] != ch["nuevo"]:
                ch["c"].resultado_apto = ch["nuevo"]

        db.commit()
        print(f"\n  OK. {total_cambios} candidatos actualizados.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
