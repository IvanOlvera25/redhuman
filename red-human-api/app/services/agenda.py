"""
Zero-Touch fase 1 — seguimiento de videollamadas agendadas por el agente.

`revisar_videollamadas_noshow` corre cada 5 min desde el lifespan de FastAPI (ver app/main.py)
y rescata a los candidatos que agendaron una videollamada (herramienta agendar_videollamada,
ver services/ia.py) pero no llegaron: 15 minutos después de la hora acordada, nadie los movió
de la etapa "Entrevista IA" (ver models.ETAPAS_CANDIDATO). Es un mensaje de texto libre porque
el candidato ya nos escribió antes para llegar hasta aquí, así que la ventana de 24h de Meta
sigue abierta.
"""

from datetime import datetime, timedelta, timezone

from ..database import SessionLocal
from ..models import Candidato, Mensaje, registrar
from .whatsapp import enviar_mensaje

MINUTOS_TOLERANCIA_NOSHOW = 15

MENSAJE_RESCATE = "Hola, vi que no pudiste unirte a la sesión. ¿Te gustaría reagendar? 🙌"


async def revisar_videollamadas_noshow() -> int:
    """Busca citas vencidas sin aviso de rescate y les manda un mensaje. Regresa cuántas procesó.

    "No llegó" se infiere de que RH (o el propio agente) nunca sacó al candidato de la etapa
    'Entrevista' — no hay señal real de asistencia a la videollamada todavía (el mock no la
    tiene). El flag `videollamada_aviso_noshow_enviado` se marca SIEMPRE que se intenta, aun si
    el envío de WhatsApp falla, para no reintentar en bucle cada 5 min contra un número roto.
    """
    corte = datetime.now(timezone.utc) - timedelta(minutes=MINUTOS_TOLERANCIA_NOSHOW)
    procesados = 0
    with SessionLocal() as db:
        candidatos = (
            db.query(Candidato)
            .filter(
                Candidato.videollamada_agendada_en.isnot(None),
                Candidato.videollamada_agendada_en < corte,
                Candidato.videollamada_aviso_noshow_enviado.is_(False),
                Candidato.etapa == "Entrevista IA",
            )
            .all()
        )
        for c in candidatos:
            envio = {"enviado": False, "proveedor": "demo"}
            if c.telefono:
                try:
                    envio = await enviar_mensaje(c.telefono, MENSAJE_RESCATE)
                except Exception as e:  # que WhatsApp falle no debe tumbar el job
                    print(f"[noshow-whatsapp-error] {c.codigo}: {e}")
                    envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}

            db.add(Mensaje(
                candidato_id=c.id, rol="assistant", texto=MENSAJE_RESCATE, canal="whatsapp",
                enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", ""),
            ))
            c.videollamada_aviso_noshow_enviado = True
            registrar(
                db, "agente-ia", "aviso_noshow_enviado", "candidato", c.codigo,
                {
                    "cita": c.videollamada_agendada_en.isoformat() if c.videollamada_agendada_en else None,
                    "whatsapp": envio,
                },
            )
            procesados += 1

        if procesados:
            db.commit()
            print(f"[noshow] {procesados} candidato(s) rescatado(s) por inasistencia.")

    return procesados
