"""
Servicio de WhatsApp — gateway propio (sin costo por mensaje de Meta).

API necesaria (elige una, corre en tu VPS con Docker):
  · WAHA        →  https://waha.devlike.pro          (docker run devlikeapro/waha)
  · Evolution   →  https://github.com/EvolutionAPI/evolution-api

Configura en .env: WHATSAPP_PROVIDER=waha|evolution y sus URL/keys.
Sin configurar, el mensaje se registra en la base como "no enviado" (modo demo).

Webhook de entrada: apunta el gateway a  POST {API}/webhooks/whatsapp
"""

from typing import Optional

import httpx

from ..config import settings


def whatsapp_activo() -> bool:
    return settings.whatsapp_provider in ("waha", "evolution")


def _solo_digitos(telefono: str) -> str:
    return "".join(c for c in telefono if c.isdigit())


async def enviar_mensaje(telefono: str, texto: str) -> dict:
    """Envía un mensaje de texto. Regresa {enviado, proveedor, detalle}."""
    numero = _solo_digitos(telefono)
    if len(numero) == 10:  # México sin lada internacional
        numero = "521" + numero

    if settings.whatsapp_provider == "waha":
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{settings.waha_url.rstrip('/')}/api/sendText",
                    headers={"X-Api-Key": settings.waha_api_key} if settings.waha_api_key else {},
                    json={"session": settings.waha_session, "chatId": f"{numero}@c.us", "text": texto},
                )
            return {"enviado": r.status_code < 300, "proveedor": "waha", "detalle": r.status_code}
        except Exception as e:  # gateway caído: no romper el flujo
            return {"enviado": False, "proveedor": "waha", "detalle": str(e)}

    if settings.whatsapp_provider == "evolution":
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{settings.evolution_url.rstrip('/')}/message/sendText/{settings.evolution_instance}",
                    headers={"apikey": settings.evolution_api_key} if settings.evolution_api_key else {},
                    json={"number": numero, "text": texto},
                )
            return {"enviado": r.status_code < 300, "proveedor": "evolution", "detalle": r.status_code}
        except Exception as e:
            return {"enviado": False, "proveedor": "evolution", "detalle": str(e)}

    return {"enviado": False, "proveedor": "demo", "detalle": "WHATSAPP_PROVIDER sin configurar"}


def parsear_webhook(payload: dict) -> Optional[dict]:
    """Normaliza el webhook de WAHA o Evolution a {telefono, texto, nombre}."""
    # WAHA: {"event": "message", "payload": {"from": "521...@c.us", "body": "...", "_data": {"notifyName": ...}}}
    if payload.get("event") == "message" and isinstance(payload.get("payload"), dict):
        p = payload["payload"]
        if p.get("fromMe"):
            return None
        tel = str(p.get("from", "")).split("@")[0]
        texto = p.get("body") or ""
        nombre = (p.get("_data") or {}).get("notifyName") or ""
        if tel and texto:
            return {"telefono": tel, "texto": texto, "nombre": nombre}

    # Evolution: {"event": "messages.upsert", "data": {"key": {"remoteJid": "521...@s.whatsapp.net", "fromMe": false},
    #             "pushName": "...", "message": {"conversation": "..."}}}
    if payload.get("event") in ("messages.upsert", "MESSAGES_UPSERT") and isinstance(payload.get("data"), dict):
        d = payload["data"]
        key = d.get("key") or {}
        if key.get("fromMe"):
            return None
        tel = str(key.get("remoteJid", "")).split("@")[0]
        msg = d.get("message") or {}
        texto = msg.get("conversation") or (msg.get("extendedTextMessage") or {}).get("text") or ""
        nombre = d.get("pushName") or ""
        if tel and texto:
            return {"telefono": tel, "texto": texto, "nombre": nombre}

    return None
