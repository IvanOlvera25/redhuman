"""Telegram como canal de mensajería (2026-10-01, demo Fraiche).

Con `WHATSAPP_PROVIDER=telegram` todo lo que la plataforma manda «por WhatsApp» (agente de prefiltro, avisos,
recordatorios, solicitudes de documentos, avisos a entrevistadores y colaboradores) sale por un bot de
Telegram. El resto del código no cambia: sigue enviando «al teléfono» con `services.whatsapp.enviar_mensaje`.

Diferencia clave con WhatsApp: un bot NO puede iniciar una conversación con un número. La persona tiene que
abrir el bot una vez y vincular su chat con su teléfono (`VinculoTelegram`):
  1. Abre https://t.me/<bot> (o una liga con `?start=VAC-1042` desde el portal / QR de la vacante).
  2. El bot le pide «📱 Compartir mi número» (botón nativo de Telegram: solo puede compartir SU número).
  3. Queda vinculado; si la liga traía una vacante, el agente arranca con esa vacante.
Ligas firmadas (`liga_vinculo`): `?start=L-<tel>-<ref>-<firma>` vincula sin pedir el número (la firma HMAC
garantiza que la liga la generó la plataforma para ESE teléfono). Se usan tras postularse en la web.

Sin ventana de 24 h ni plantillas: cualquier persona vinculada recibe texto libre en cualquier momento.
"""

import hashlib
import hmac
import html
import re
from datetime import datetime, timezone
from typing import List, Optional

import httpx

from ..config import settings

API = "https://api.telegram.org"
_USERNAME_CACHE = {"valor": ""}


def configurado() -> bool:
    return bool((settings.telegram_bot_token or "").strip())


def _url(metodo: str) -> str:
    return f"{API}/bot{settings.telegram_bot_token.strip()}/{metodo}"


async def api(metodo: str, datos: Optional[dict] = None, timeout: float = 20) -> dict:
    """Llama al Bot API. Regresa el JSON de Telegram ({ok, result | description, error_code}); nunca lanza."""
    if not configurado():
        return {"ok": False, "description": "TELEGRAM_BOT_TOKEN sin configurar"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as cli:
            r = await cli.post(_url(metodo), json=datos or {})
        try:
            return r.json()
        except Exception:
            return {"ok": False, "error_code": r.status_code, "description": r.text[:300]}
    except Exception as e:  # red caída: no romper el flujo de RH
        return {"ok": False, "description": f"error de red: {e}"}


async def nombre_bot() -> str:
    """@username del bot (sin @). Usa TELEGRAM_BOT_USERNAME o lo pregunta una vez con getMe."""
    if (settings.telegram_bot_username or "").strip():
        return settings.telegram_bot_username.strip().lstrip("@")
    if _USERNAME_CACHE["valor"]:
        return _USERNAME_CACHE["valor"]
    r = await api("getMe")
    if r.get("ok"):
        _USERNAME_CACHE["valor"] = (r["result"].get("username") or "").strip()
    return _USERNAME_CACHE["valor"]


def nombre_bot_sync() -> str:
    """Versión síncrona para serializadores: solo lo ya conocido (variable o caché de getMe)."""
    return (settings.telegram_bot_username or "").strip().lstrip("@") or _USERNAME_CACHE["valor"]


# --------------------------------------------------------------------------- #
# Formato: el agente escribe con el marcado de WhatsApp (*negritas*, _cursiva_)
# --------------------------------------------------------------------------- #

def a_html(texto: str) -> str:
    """Convierte el marcado de WhatsApp a HTML de Telegram (escapando todo lo demás)."""
    t = html.escape(texto or "", quote=False)
    t = re.sub(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])", r"<i>\1</i>", t)
    t = re.sub(r"(?<![\w~])~(?!\s)([^~\n]+?)(?<!\s)~(?![\w~])", r"<s>\1</s>", t)
    return t


def _sin_marcado(texto: str) -> str:
    return re.sub(r"[*_~]", "", texto or "")


# --------------------------------------------------------------------------- #
# Vínculo chat ↔ teléfono
# --------------------------------------------------------------------------- #

def clave(telefono: str) -> str:
    digitos = re.sub(r"\D", "", telefono or "")
    return digitos[-10:] if len(digitos) > 10 else digitos


def chat_de_telefono(telefono: str) -> Optional[str]:
    """chat_id vinculado a ese teléfono (el vínculo más reciente), o None."""
    from ..database import SessionLocal
    from ..models import VinculoTelegram

    tel = clave(telefono)
    if not tel:
        return None
    db = SessionLocal()
    try:
        v = (
            db.query(VinculoTelegram)
            .filter(VinculoTelegram.telefono == tel)
            .order_by(VinculoTelegram.id.desc())
            .first()
        )
        return v.chat_id if v else None
    finally:
        db.close()


def vincular(db, chat_id: str, telefono: str, nombre: str = "", usuario: str = ""):
    """Une el chat con el teléfono. Un teléfono queda en UN solo chat (el último que lo vinculó)."""
    from ..models import VinculoTelegram, registrar

    tel = clave(telefono)
    v = db.query(VinculoTelegram).filter(VinculoTelegram.chat_id == str(chat_id)).first()
    if v is None:
        v = VinculoTelegram(chat_id=str(chat_id))
        db.add(v)
    for otro in db.query(VinculoTelegram).filter(VinculoTelegram.telefono == tel, VinculoTelegram.chat_id != str(chat_id)).all():
        otro.telefono = ""
    v.telefono = tel
    v.nombre = nombre or v.nombre
    v.usuario = usuario or v.usuario
    v.vinculado_en = datetime.now(timezone.utc)
    db.flush()
    registrar(db, "telegram", "telegram_vinculado", "telefono", tel, {"chat_id": str(chat_id), "usuario": usuario})
    return v


def _secreto() -> bytes:
    return (settings.telegram_webhook_secret or settings.telegram_bot_token or "redhuman-telegram").encode()


def _firma(telefono: str, ref: str) -> str:
    return hmac.new(_secreto(), f"{telefono}|{ref}".encode(), hashlib.sha256).hexdigest()[:12]


def payload_vinculo(telefono: str, ref: str = "") -> str:
    """Payload de /start que vincula ese teléfono sin pedir el número (≤ 64 caracteres, [A-Za-z0-9_-])."""
    tel = clave(telefono)
    ref = re.sub(r"[^A-Za-z0-9]", "", ref or "")[:16]
    return f"L-{tel}-{ref}-{_firma(tel, ref)}"


def leer_payload_vinculo(payload: str) -> Optional[dict]:
    m = re.fullmatch(r"L-(\d{10})-([A-Za-z0-9]{0,16})-([0-9a-f]{12})", payload or "")
    if not m:
        return None
    tel, ref, firma = m.groups()
    if not hmac.compare_digest(firma, _firma(tel, ref)):
        return None
    return {"telefono": tel, "ref": ref}


def liga(payload: str = "") -> str:
    usuario = nombre_bot_sync()
    if not usuario:
        return ""
    return f"https://t.me/{usuario}" + (f"?start={payload}" if payload else "")


def liga_vinculo(telefono: str, ref: str = "") -> str:
    return liga(payload_vinculo(telefono, ref)) if clave(telefono) else liga()


def liga_vacante(codigo_vacante: str) -> str:
    """Liga pública para postularse a una vacante por Telegram (portal, QR, publicaciones)."""
    return liga(re.sub(r"[^A-Za-z0-9_-]", "", codigo_vacante or ""))


# --------------------------------------------------------------------------- #
# Envío
# --------------------------------------------------------------------------- #

def _resultado(enviado: bool, detalle, **extra) -> dict:
    return {"enviado": enviado, "proveedor": "telegram", "detalle": detalle, **extra}


async def enviar_a_chat(chat_id: str, texto: str, teclado: Optional[dict] = None) -> dict:
    texto = (texto or "").strip() or "…"
    trozos = [texto[i:i + 3900] for i in range(0, len(texto), 3900)]
    ultimo = {}
    for i, trozo in enumerate(trozos):
        datos = {"chat_id": chat_id, "text": a_html(trozo), "parse_mode": "HTML", "disable_web_page_preview": False}
        if teclado and i == len(trozos) - 1:
            datos["reply_markup"] = teclado
        r = await api("sendMessage", datos)
        if not r.get("ok") and "parse" in str(r.get("description", "")).lower():
            datos.pop("parse_mode")
            datos["text"] = _sin_marcado(trozo)
            r = await api("sendMessage", datos)
        if not r.get("ok"):
            print(f"[telegram] sendMessage rechazado (chat {chat_id}): {r}", flush=True)
            return _resultado(False, f"{r.get('error_code', '')}: {r.get('description', 'sin detalle')}".strip(": "))
        ultimo = r.get("result") or {}
    return _resultado(True, 200, wa_id=f"tg-{chat_id}-{ultimo.get('message_id', '')}")


def _no_vinculado(telefono: str) -> dict:
    bot = nombre_bot_sync()
    donde = f"https://t.me/{bot}" if bot else "el bot de Telegram"
    return _resultado(
        False,
        f"El {clave(telefono) or 'destinatario'} no ha vinculado Telegram: la persona debe abrir {donde} y tocar «Compartir mi número» una vez.",
        sin_vinculo=True,
    )


async def enviar_a_telefono(telefono: str, texto: str, teclado: Optional[dict] = None) -> dict:
    if not configurado():
        return _resultado(False, "TELEGRAM_BOT_TOKEN sin configurar")
    chat = chat_de_telefono(telefono)
    if not chat:
        return _no_vinculado(telefono)
    return await enviar_a_chat(chat, texto, teclado)


def teclado_opciones(opciones: List[dict]) -> dict:
    """Botones en línea (uno por fila) con callback_data = id de la opción (VAC-####, P-####, CTA-#)."""
    filas = []
    for o in opciones:
        titulo = str(o.get("titulo") or o["id"])
        desc = str(o.get("descripcion") or "")
        etiqueta = f"{titulo} · {desc}" if desc else titulo
        filas.append([{"text": etiqueta[:60], "callback_data": str(o["id"])[:64]}])
    return {"inline_keyboard": filas}


async def enviar_opciones(telefono: str, encabezado: str, cuerpo: str, opciones: list, secciones: Optional[list] = None) -> dict:
    """Equivalente de la lista interactiva de WhatsApp: el texto + un botón por opción (máx. 30)."""
    planas: List[dict] = []
    if secciones:
        for sec in secciones:
            for o in sec.get("opciones") or []:
                titulo = str(o.get("titulo") or o["id"])
                planas.append({**o, "titulo": f"{titulo} ({sec.get('titulo')})" if len(secciones) > 1 and sec.get("titulo") else titulo})
    else:
        planas = list(opciones or [])
    if not planas:
        return _resultado(False, "No hay opciones que mostrar")
    texto = f"*{encabezado}*\n\n{cuerpo}" if encabezado else cuerpo
    return await enviar_a_telefono(telefono, texto, teclado_opciones(planas[:30]))


TECLADO_COMPARTIR = {
    "keyboard": [[{"text": "📱 Compartir mi número", "request_contact": True}]],
    "resize_keyboard": True,
    "one_time_keyboard": True,
}
QUITAR_TECLADO = {"remove_keyboard": True}


async def pedir_numero(chat_id: str, nombre: str = "") -> dict:
    saludo = f"¡Hola{' ' + nombre if nombre else ''}! 👋 Soy Red Human."
    texto = (
        f"{saludo}\n\nPara continuar necesito vincular este chat con tu número de celular "
        "(es el mismo que registras al postularte). Toca el botón *📱 Compartir mi número* de abajo."
    )
    return await enviar_a_chat(chat_id, texto, TECLADO_COMPARTIR)


async def responder_callback(callback_id: str) -> None:
    await api("answerCallbackQuery", {"callback_query_id": callback_id})


# --------------------------------------------------------------------------- #
# Archivos recibidos (documentos del expediente)
# --------------------------------------------------------------------------- #

_EXT = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp"}


async def descargar_archivo(file_id: str, mime: str = "", nombre: str = "") -> dict:
    """getFile → descarga binaria. Mismo contrato que whatsapp.descargar_media; nunca lanza."""
    if not file_id:
        return {"ok": False, "detalle": "sin file_id"}
    info = await api("getFile", {"file_id": file_id})
    if not info.get("ok"):
        return {"ok": False, "detalle": f"Telegram getFile: {info.get('description', 'sin detalle')}"}
    ruta = (info.get("result") or {}).get("file_path", "")
    try:
        async with httpx.AsyncClient(timeout=30) as cli:
            r = await cli.get(f"{API}/file/bot{settings.telegram_bot_token.strip()}/{ruta}")
        if r.status_code >= 300:
            return {"ok": False, "detalle": f"descarga del archivo: HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "detalle": f"error de red: {e}"}
    ext_ruta = ruta.rsplit(".", 1)[-1].lower() if "." in ruta else ""
    mime = (mime or {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "pdf": "application/pdf", "webp": "image/webp"}.get(ext_ruta, "")).lower()
    ext = _EXT.get(mime, "")
    if not ext:
        return {"ok": False, "detalle": f"formato no admitido ({mime or 'desconocido'}); acepta PDF, JPG o PNG"}
    return {"ok": True, "contenido": r.content, "mime": mime, "extension": ext, "filename": nombre or f"telegram_{file_id[:12]}.{ext}", "tamano": len(r.content)}


# --------------------------------------------------------------------------- #
# Recepción
# --------------------------------------------------------------------------- #

def firma_valida(cabecera: str) -> bool:
    """Telegram manda en X-Telegram-Bot-Api-Secret-Token el secret_token registrado con setWebhook."""
    esperado = (settings.telegram_webhook_secret or "").strip()
    return bool(esperado) and hmac.compare_digest(esperado, (cabecera or "").strip())


def normalizar_update(update: dict) -> Optional[dict]:
    """Saca de un update de Telegram lo que el webhook necesita. Regresa None si no es de una persona en chat
    privado. Campos: chat_id, nombre, usuario, update_id, y uno de: callback (id, data) | contacto (telefono,
    propio) | inicio (payload) | texto/tipo/media."""
    base = {"update_id": update.get("update_id")}
    cb = update.get("callback_query")
    if cb:
        de = cb.get("from") or {}
        chat = ((cb.get("message") or {}).get("chat") or {}).get("id") or de.get("id")
        return {**base, "chat_id": str(chat), "nombre": " ".join(x for x in (de.get("first_name"), de.get("last_name")) if x),
                "usuario": de.get("username") or "", "callback": {"id": cb.get("id"), "data": cb.get("data") or ""}}
    m = update.get("message") or update.get("edited_message")
    if not m or (m.get("chat") or {}).get("type") != "private":
        return None
    de = m.get("from") or {}
    if de.get("is_bot"):
        return None
    salida = {**base, "chat_id": str(m["chat"]["id"]), "nombre": " ".join(x for x in (de.get("first_name"), de.get("last_name")) if x),
              "usuario": de.get("username") or "", "message_id": m.get("message_id")}
    if m.get("contact"):
        c = m["contact"]
        return {**salida, "contacto": {"telefono": c.get("phone_number", ""), "propio": c.get("user_id") == de.get("id")}}
    texto = m.get("text") or m.get("caption") or ""
    if texto.startswith("/start"):
        return {**salida, "inicio": texto[len("/start"):].strip()}
    media = None
    tipo = "text"
    if m.get("document"):
        d = m["document"]
        tipo, media = "document", {"id": d.get("file_id", ""), "mime_type": d.get("mime_type", ""), "filename": d.get("file_name", "")}
    elif m.get("photo"):
        foto = sorted(m["photo"], key=lambda x: x.get("file_size") or 0)[-1]
        tipo, media = "image", {"id": foto.get("file_id", ""), "mime_type": "image/jpeg", "filename": ""}
    elif not texto:
        return {**salida, "texto": "", "tipo": "otro"}
    return {**salida, "texto": texto, "tipo": tipo, "media": media}


async def registrar_webhook(url: str) -> dict:
    """setWebhook con secret_token (lo usa scripts/telegram_configurar.py)."""
    return await api("setWebhook", {
        "url": url, "secret_token": settings.telegram_webhook_secret, "allowed_updates": ["message", "edited_message", "callback_query"],
        "drop_pending_updates": True,
    })
