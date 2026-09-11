"""Siembra de Fase D -- crea ReglaNotificacion para cada Cuenta existente, replicando el
comportamiento de HOY (decision 4 confirmada con el usuario: cero regresion al desplegar).

Encendido por evento (todo lo demas apagado, incluido TODO lo de Cliente -- nunca se le ha
mandado nada a un Cliente hasta Fase D):

  entrevista_agendada          -> Candidato: Correo+WhatsApp . Entrevistador: Correo
  recordatorio_entrevista      -> Candidato: WhatsApp
  entrevista_humana_terminada  -> Entrevistador: Correo
  contratacion                 -> Candidato: WhatsApp
  solicitud_documentos         -> Candidato: WhatsApp
  recordatorio_documentos      -> Candidato: WhatsApp
  entrevista_modificada        -> todo apagado (evento nuevo, no existia)
  entrevista_cancelada         -> todo apagado (evento nuevo, no existia)
  recomendacion_final          -> todo apagado (evento nuevo, no existia)
  candidato_apto               -> todo apagado (evento nuevo, no existia)

Es idempotente: una Cuenta que YA tiene sus 10 filas de ReglaNotificacion no se toca (ni se
sobreescribe una regla que un admin ya haya modificado a mano tras el deploy).

Uso (desde red-human-api/):
  .venv/Scripts/python.exe scripts/sembrar_reglas_notificacion.py           # dry-run: muestra resumen
  .venv/Scripts/python.exe scripts/sembrar_reglas_notificacion.py --forzar  # pide confirmacion y escribe
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models import Cuenta, EVENTOS_NOTIFICACION, ReglaNotificacion

# evento -> kwargs de ReglaNotificacion que van en True (el resto queda en False por default)
SIEMBRA_HISTORICA = {
    "entrevista_agendada": {"candidato_correo": True, "candidato_whatsapp": True, "entrevistador_correo": True},
    "recordatorio_entrevista": {"candidato_whatsapp": True},
    "entrevista_humana_terminada": {"entrevistador_correo": True},
    "contratacion": {"candidato_whatsapp": True},
    "solicitud_documentos": {"candidato_whatsapp": True},
    "recordatorio_documentos": {"candidato_whatsapp": True},
    # entrevista_modificada, entrevista_cancelada, recomendacion_final, candidato_apto: todo apagado.
}


def main() -> None:
    forzar = "--forzar" in sys.argv

    db = SessionLocal()
    try:
        cuentas = db.query(Cuenta).order_by(Cuenta.id).all()
        existentes = {
            (r.cuenta_id, r.evento)
            for r in db.query(ReglaNotificacion.cuenta_id, ReglaNotificacion.evento).all()
        }

        faltantes = []  # [(cuenta, evento)]
        for cu in cuentas:
            for evento in EVENTOS_NOTIFICACION:
                if (cu.id, evento) not in existentes:
                    faltantes.append((cu, evento))

        print("\n=== Siembra ReglaNotificacion -- Fase D ===\n")
        if not faltantes:
            print("  Todas las Cuentas ya tienen sus 10 reglas. Nada que hacer.")
            return

        por_cuenta: dict[int, list[str]] = {}
        for cu, evento in faltantes:
            por_cuenta.setdefault(cu.id, []).append(evento)

        for cu in cuentas:
            eventos_a_crear = por_cuenta.get(cu.id)
            if not eventos_a_crear:
                continue
            print(f"  [{cu.id}] {cu.nombre_comercial}: {len(eventos_a_crear)} regla(s) nueva(s)")
            for evento in eventos_a_crear:
                encendidos = SIEMBRA_HISTORICA.get(evento, {})
                detalle = ", ".join(f"{k}=True" for k in encendidos) or "todo apagado"
                print(f"      - {evento}: {detalle}")
        print(f"\n  TOTAL reglas a crear: {len(faltantes)}")

        if not forzar:
            print("\n  -> Modo dry-run (sin cambios). Usa --forzar para escribir.")
            return

        print("\n  Procediendo a escribir los cambios...")
        resp = input("  Confirmar? [s/N] ").strip().lower()
        if resp != "s":
            print("  Cancelado.")
            return

        for cu, evento in faltantes:
            db.add(ReglaNotificacion(cuenta_id=cu.id, evento=evento, **SIEMBRA_HISTORICA.get(evento, {})))

        db.commit()
        print(f"\n  OK. {len(faltantes)} reglas creadas.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
