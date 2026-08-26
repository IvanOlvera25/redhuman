"""
Servicio de WhatsApp — envío y recepción de mensajes del agente.

Proveedores (`WHATSAPP_PROVIDER` en .env):
  · meta       →  WhatsApp Cloud API oficial. Número verificado por Meta, sin
                  servidor extra que mantener. Se paga por conversación.
  · waha       →  https://waha.devlike.pro          (docker devlikeapro/waha)
  · evolution  →  https://github.com/EvolutionAPI/evolution-api
  · ""         →  modo demo: el mensaje se guarda en la base como "no enviado".

Webhook de entrada:  {API}/webhooks/whatsapp
  · Meta pide además un GET de verificación (hub.challenge) y firma cada POST
    con HMAC-SHA256 en la cabecera X-Hub-Signature-256.

Ventana de 24 horas (solo Meta): a un candidato que NO nos ha escrito en las
últimas 24 h no se le puede mandar texto libre; Meta lo rechaza con el error
131047. Para esos casos se usa una plantilla aprobada (`META_PLANTILLA_AVISO`),
y `enviar_mensaje` cae a ella automáticamente cuando existe.
"""

import hashlib
import hmac
import re
from typing import List, Optional

import httpx

from ..config import settings

GRAPH_URL = "https://graph.facebook.com"

# Meta rechaza texto libre fuera de la ventana de 24 h con estos códigos.
CODIGOS_FUERA_DE_VENTANA = {131047, 131026, 132000}


def whatsapp_activo() -> bool:
    return settings.whatsapp_provider in ("meta", "waha", "evolution")


def proveedor() -> str:
    return settings.whatsapp_provider or "demo"


def _solo_digitos(telefono: str) -> str:
    return re.sub(r"\D", "", telefono or "")


def clave_telefono(telefono: str) -> str:
    """Últimos 10 dígitos: la forma en que se guardan los teléfonos en la base.

    Sirve para que un mensaje entrante (que llega como 5213311112222) empate con
    el candidato que ya existe capturado como 3311112222.
    """
    digitos = _solo_digitos(telefono)
    return digitos[-10:] if len(digitos) > 10 else digitos


def numero_e164(telefono: str) -> str:
    """Número listo para la API, en E.164 sin '+'. Asume México si no trae lada."""
    digitos = _solo_digitos(telefono)
    if len(digitos) == 10:  # capturado sin lada internacional
        digitos = "52" + digitos
    # México ya no usa el '1' después del 52 para WhatsApp; Meta devuelve los
    # wa_id sin él, así que lo quitamos para que envío y webhook coincidan.
    if len(digitos) == 13 and digitos.startswith("521"):
        digitos = "52" + digitos[3:]
    return digitos


def _resultado(enviado: bool, detalle, prov: Optional[str] = None, **extra) -> dict:
    return {"enviado": enviado, "proveedor": prov or proveedor(), "detalle": detalle, **extra}


# --------------------------------------------------------------------------- #
# Envío
# --------------------------------------------------------------------------- #

def _meta_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.meta_whatsapp_token}",
        "Content-Type": "application/json",
    }


def _meta_url() -> str:
    return (
        f"{GRAPH_URL}/{settings.meta_api_version}"
        f"/{settings.meta_phone_number_id}/messages"
    )


def _meta_error(r: httpx.Response) -> dict:
    """Extrae {codigo, mensaje} del cuerpo de error de Graph."""
    try:
        err = (r.json() or {}).get("error") or {}
    except Exception:
        return {"codigo": r.status_code, "mensaje": r.text[:300]}
    return {
        "codigo": err.get("code", r.status_code),
        "mensaje": err.get("error_user_msg") or err.get("message") or r.text[:300],
    }


async def _meta_post(cuerpo: dict) -> dict:
    if not (settings.meta_whatsapp_token and settings.meta_phone_number_id):
        return _resultado(False, "Faltan META_WHATSAPP_TOKEN o META_PHONE_NUMBER_ID")
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.post(_meta_url(), headers=_meta_headers(), json=cuerpo)
    except Exception as e:  # red caída: no romper el flujo de RH
        return _resultado(False, f"error de red: {e}")

    if r.status_code < 300:
        datos = r.json()
        wamid = ((datos.get("messages") or [{}])[0]).get("id", "")
        return _resultado(True, r.status_code, wa_id=wamid)

    error = _meta_error(r)
    return _resultado(False, f"{error['codigo']}: {error['mensaje']}", codigo=error["codigo"])


def _param_plantilla(valor: str) -> str:
    """Meta rechaza variables con saltos de línea, tabuladores o 4+ espacios seguidos."""
    limpio = re.sub(r"[\r\n\t]+", " ", valor or "")
    limpio = re.sub(r" {2,}", " ", limpio).strip()
    return limpio[:900]


async def enviar_plantilla(
    telefono: str,
    plantilla: str,
    parametros: Optional[List[str]] = None,
    idioma: Optional[str] = None,
) -> dict:
    """Manda una plantilla aprobada (único formato válido fuera de la ventana de 24 h)."""
    componentes = []
    if parametros:
        componentes.append({
            "type": "body",
            "parameters": [{"type": "text", "text": _param_plantilla(p)} for p in parametros],
        })
    cuerpo = {
        "messaging_product": "whatsapp",
        "to": numero_e164(telefono),
        "type": "template",
        "template": {
            "name": plantilla,
            "language": {"code": idioma or settings.meta_plantilla_idioma},
            **({"components": componentes} if componentes else {}),
        },
    }
    resultado = await _meta_post(cuerpo)
    resultado["formato"] = "plantilla"
    return resultado


async def enviar_mensaje(telefono: str, texto: str) -> dict:
    """Envía un mensaje de texto. Regresa {enviado, proveedor, detalle}."""
    if settings.whatsapp_provider == "meta":
        resultado = await _meta_post({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": numero_e164(telefono),
            "type": "text",
            "text": {"preview_url": True, "body": texto},
        })
        # Fuera de la ventana de 24 h el texto libre no pasa: reintenta con la
        # plantilla aprobada si está configurada.
        if (
            not resultado["enviado"]
            and resultado.get("codigo") in CODIGOS_FUERA_DE_VENTANA
            and settings.meta_plantilla_aviso
        ):
            alterno = await enviar_plantilla(telefono, settings.meta_plantilla_aviso, [texto])
            alterno["motivo_fallback"] = resultado["detalle"]
            return alterno
        return resultado

    numero = numero_e164(telefono)

    if settings.whatsapp_provider == "waha":
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{settings.waha_url.rstrip('/')}/api/sendText",
                    headers={"X-Api-Key": settings.waha_api_key} if settings.waha_api_key else {},
                    json={"session": settings.waha_session, "chatId": f"{numero}@c.us", "text": texto},
                )
            return _resultado(r.status_code < 300, r.status_code)
        except Exception as e:  # gateway caído: no romper el flujo
            return _resultado(False, str(e))

    if settings.whatsapp_provider == "evolution":
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{settings.evolution_url.rstrip('/')}/message/sendText/{settings.evolution_instance}",
                    headers={"apikey": settings.evolution_api_key} if settings.evolution_api_key else {},
                    json={"number": numero, "text": texto},
                )
            return _resultado(r.status_code < 300, r.status_code)
        except Exception as e:
            return _resultado(False, str(e))

    return _resultado(False, "WHATSAPP_PROVIDER sin configurar", prov="demo")


# --------------------------------------------------------------------------- #
# Recepción
# --------------------------------------------------------------------------- #

def firma_valida(cuerpo: bytes, cabecera: str) -> bool:
    """Valida X-Hub-Signature-256. Sin META_APP_SECRET no se puede validar."""
    if not settings.meta_app_secret:
        return False
    esperado = hmac.new(
        settings.meta_app_secret.encode(), cuerpo, hashlib.sha256
    ).hexdigest()
    recibida = (cabecera or "").removeprefix("sha256=").strip()
    return hmac.compare_digest(esperado, recibida)


def _texto_de_meta(m: dict) -> str:
    """Saca el texto de un mensaje de Meta sea cual sea su tipo."""
    tipo = m.get("type")
    if tipo == "text":
        return (m.get("text") or {}).get("body", "")
    if tipo == "interactive":
        inter = m.get("interactive") or {}
        destino = inter.get("button_reply") or inter.get("list_reply") or {}
        return destino.get("title", "")
    if tipo == "button":
        return (m.get("button") or {}).get("text", "")
    # imagen/documento/video con pie de foto: el pie es el mensaje
    return (m.get(tipo) or {}).get("caption", "") if isinstance(m.get(tipo), dict) else ""


def parsear_webhook(payload: dict) -> Optional[dict]:
    """Normaliza el webhook de Meta, WAHA o Evolution.

    Regresa {telefono, texto, nombre, wa_id, tipo} o None si el evento no es un
    mensaje entrante de una persona (acuses de entrega, mensajes propios, etc.).
    """
    # --- Meta Cloud API ---
    # {"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages",
    #   "value":{"contacts":[{"profile":{"name":...},"wa_id":...}],
    #            "messages":[{"from":...,"id":"wamid...","type":"text","text":{"body":...}}]}}]}]}
    if payload.get("object") == "whatsapp_business_account":
        for entrada in payload.get("entry") or []:
            for cambio in entrada.get("changes") or []:
                valor = cambio.get("value") or {}
                mensajes = valor.get("messages") or []
                if not mensajes:
                    continue  # "statuses": acuses de entrega/lectura, se ignoran
                m = mensajes[0]
                contactos = valor.get("contacts") or [{}]
                nombre = ((contactos[0].get("profile") or {}).get("name")) or ""
                return {
                    "telefono": str(m.get("from", "")),
                    "texto": _texto_de_meta(m),
                    "nombre": nombre,
                    "wa_id": m.get("id", ""),
                    "tipo": m.get("type", "text"),
                }
        return None

    # --- WAHA ---
    if payload.get("event") == "message" and isinstance(payload.get("payload"), dict):
        p = payload["payload"]
        if p.get("fromMe"):
            return None
        tel = str(p.get("from", "")).split("@")[0]
        texto = p.get("body") or ""
        nombre = (p.get("_data") or {}).get("notifyName") or ""
        if tel and texto:
            return {"telefono": tel, "texto": texto, "nombre": nombre,
                    "wa_id": str(p.get("id", "")), "tipo": "text"}

    # --- Evolution ---
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
            return {"telefono": tel, "texto": texto, "nombre": nombre,
                    "wa_id": str(key.get("id", "")), "tipo": "text"}

    return None
