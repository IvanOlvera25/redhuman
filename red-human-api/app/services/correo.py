"""
Servicio de correo — notificaciones de Entrevista Humana vía Resend.

`RESEND_API_KEY` en .env; sin ella, modo demo: el envío se registra como "no enviado"
en la bitácora, igual que WHATSAPP_PROVIDER sin configurar en services/whatsapp.py.
"""

import httpx

from ..config import settings

RESEND_URL = "https://api.resend.com/emails"


def correo_activo() -> bool:
    return bool(settings.resend_api_key)


def _resultado(enviado: bool, detalle, **extra) -> dict:
    return {"enviado": enviado, "proveedor": "resend" if settings.resend_api_key else "demo", "detalle": detalle, **extra}


async def enviar_correo(destinatario: str, asunto: str, cuerpo_html: str) -> dict:
    """Manda un correo transaccional vía Resend. Regresa {enviado, proveedor, detalle}."""
    if not destinatario:
        return _resultado(False, "Sin dirección de correo")
    if not settings.resend_api_key:
        return _resultado(False, "RESEND_API_KEY sin configurar")

    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(
                RESEND_URL,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.resend_from,
                    "to": [destinatario],
                    "subject": asunto,
                    "html": cuerpo_html,
                },
            )
        if r.status_code < 300:
            return _resultado(True, r.status_code, id=(r.json() or {}).get("id"))
        return _resultado(False, r.text[:300], codigo=r.status_code)
    except Exception as e:  # que Resend falle no debe tumbar el flujo que lo llama
        return _resultado(False, str(e))
