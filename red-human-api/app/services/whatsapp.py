"""
Servicio de WhatsApp — soporta:
  1. Meta Cloud API oficial (v22.0)
  2. Gateway propio (WAHA / Evolution)
"""

import re
from typing import Optional
import httpx

from ..config import settings


def _solo_digitos(valor: Optional[str]) -> str:
    """Extrae únicamente los dígitos de una cadena de texto."""
    return re.sub(r"\D", "", valor or "")


def whatsapp_activo() -> bool:
    return settings.whatsapp_provider in ("meta", "waha", "evolution")


def normalizar_numero_meta(telefono: str) -> str:
    """Normaliza número de teléfono para Meta Cloud API (E.164 mexicano 52 + 10 dígitos).
    Meta rechaza números con prefijo 521 en muchas regiones."""
    num = _solo_digitos(telefono)
    if num.startswith("521") and len(num) == 13:
        return "52" + num[3:]
    if len(num) == 10:
        return "52" + num
    return num


async def enviar_mensaje(telefono: str, texto: str) -> dict:
    """Envía un mensaje de texto. Regresa {enviado, proveedor, detalle}."""
    numero = normalizar_numero_meta(telefono)

    # 1. Meta WhatsApp Cloud API (Oficial v22.0)
    if settings.whatsapp_provider == "meta":
        if not settings.meta_whatsapp_token or not settings.meta_phone_number_id:
            print("[whatsapp-meta-error] Faltan META_WHATSAPP_TOKEN o META_PHONE_NUMBER_ID en configuración")
            return {"enviado": False, "proveedor": "meta", "detalle": "Faltan META_WHATSAPP_TOKEN o META_PHONE_NUMBER_ID"}

        url = f"https://graph.facebook.com/v22.0/{settings.meta_phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {settings.meta_whatsapp_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": numero,
            "type": "text",
            "text": {
                "preview_url": False,
                "body": texto,
            },
        }

        print(f"[whatsapp-meta] Enviando mensaje a {numero} ({len(texto)} chars)...")
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(url, headers=headers, json=payload)
                try:
                    data = r.json()
                except Exception:
                    data = r.text
            exito = r.status_code < 300
            print(f"[whatsapp-meta] Respuesta Meta ({r.status_code}): {data}")
            return {
                "enviado": exito,
                "proveedor": "meta",
                "status_code": r.status_code,
                "detalle": data,
            }
        except Exception as e:
            print(f"[whatsapp-meta-error] Excepción al llamar a Meta Graph API: {e}")
            return {"enviado": False, "proveedor": "meta", "detalle": str(e)}

    # 2. WAHA
    if settings.whatsapp_provider == "waha":
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{settings.waha_url.rstrip('/')}/api/sendText",
                    headers={"X-Api-Key": settings.waha_api_key} if settings.waha_api_key else {},
                    json={"session": settings.waha_session, "chatId": f"{numero}@c.us", "text": texto},
                )
            return {"enviado": r.status_code < 300, "proveedor": "waha", "detalle": r.status_code}
        except Exception as e:
            return {"enviado": False, "proveedor": "waha", "detalle": str(e)}

    # 3. Evolution API
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
    """Normaliza webhooks de Meta, WAHA o Evolution a {telefono, texto, nombre}."""
    # 1. Meta WhatsApp Cloud API
    if payload.get("object") == "whatsapp_business_account":
        try:
            for entry in payload.get("entry", []):
                for change in entry.get("changes", []):
                    value = change.get("value", {})
                    statuses = value.get("statuses", [])
                    if statuses:
                        print(f"[whatsapp-meta] Recibido estado de mensaje: {statuses[0].get('status')} para id {statuses[0].get('id')}")
                        return None
                    messages = value.get("messages", [])
                    contacts = value.get("contacts", [])
                    if messages:
                        msg = messages[0]
                        tel = msg.get("from", "")
                        tipo = msg.get("type", "")
                        texto = ""
                        if tipo == "text":
                            texto = msg.get("text", {}).get("body", "")
                        elif tipo == "button":
                            texto = msg.get("button", {}).get("text", "")
                        elif tipo == "interactive":
                            interactive = msg.get("interactive", {})
                            list_reply = interactive.get("list_reply", {})
                            button_reply = interactive.get("button_reply", {})
                            if list_reply:
                                # Incluir el id (VAC-XXXX) para que el webhook detecte la vacante
                                texto = f"{list_reply.get('title', '')} {list_reply.get('id', '')}".strip()
                            elif button_reply:
                                texto = button_reply.get("title", "")
                            else:
                                texto = ""
                        nombre = ""
                        if contacts:
                            nombre = contacts[0].get("profile", {}).get("name", "")
                        if tel and texto:
                            res = {"telefono": tel, "texto": texto, "nombre": nombre, "id_mensaje": msg.get("id")}
                            print(f"[whatsapp-meta] Mensaje parseado exitosamente: {res}")
                            return res
                        else:
                            print(f"[whatsapp-meta] Mensaje recibido pero sin texto legible o tipo no soportado: tipo={tipo}, tel={tel}")
        except Exception as e:
            print(f"[whatsapp-meta-error] Error parseando payload de Meta: {e}")
            return None

    # 2. WAHA
    if payload.get("event") == "message" and isinstance(payload.get("payload"), dict):
        p = payload["payload"]
        if p.get("fromMe"):
            return None
        tel = str(p.get("from", "")).split("@")[0]
        texto = p.get("body") or ""
        nombre = (p.get("_data") or {}).get("notifyName") or ""
        if tel and texto:
            return {"telefono": tel, "texto": texto, "nombre": nombre}

    # 3. Evolution
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


async def enviar_lista_interactiva(
    telefono: str,
    encabezado: str,
    cuerpo: str,
    boton: str,
    opciones: list,
) -> dict:
    """Envía un mensaje interactivo tipo lista (Meta Cloud API).

    opciones: [{"id": "VAC-1042", "titulo": "Cajero(a)", "descripcion": "Guadalajara · $9,500"}]
    El candidato elige una opción y Meta manda un list_reply con el id seleccionado.
    parsear_webhook ya extrae el título de list_reply como texto; el webhook detecta
    el código VAC-XXXX en una segunda pasada por regex.
    """
    numero = normalizar_numero_meta(telefono)

    if settings.whatsapp_provider != "meta" or not settings.meta_whatsapp_token:
        print("[whatsapp-meta-error] enviar_lista_interactiva solo soportado con Meta Cloud API configurada")
        return {"enviado": False, "proveedor": "demo", "detalle": "Solo soportado con Meta Cloud API"}

    url = f"https://graph.facebook.com/v22.0/{settings.meta_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.meta_whatsapp_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": numero,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "header": {"type": "text", "text": encabezado[:60]},
            "body": {"text": cuerpo[:1024]},
            "action": {
                "button": boton[:20],
                "sections": [
                    {
                        "title": "Vacantes",
                        "rows": [
                            {
                                "id": o["id"],
                                "title": o["titulo"][:24],
                                "description": (o.get("descripcion") or "")[:72],
                            }
                            for o in opciones[:10]  # Meta permite máx. 10 rows
                        ],
                    }
                ],
            },
        },
    }

    print(f"[whatsapp-meta] Enviando lista interactiva a {numero} ({len(opciones)} opciones)...")
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(url, headers=headers, json=payload)
            try:
                data = r.json()
            except Exception:
                data = r.text
        exito = r.status_code < 300
        print(f"[whatsapp-meta] Respuesta Meta Lista Interactiva ({r.status_code}): {data}")
        return {"enviado": exito, "proveedor": "meta", "status_code": r.status_code, "detalle": data}
    except Exception as e:
        print(f"[whatsapp-meta-error] Excepción en lista interactiva: {e}")
        return {"enviado": False, "proveedor": "meta", "detalle": str(e)}
