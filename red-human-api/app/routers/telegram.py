"""Telegram para RH (2026-10-01, demo Fraiche): estado del bot, personas vinculadas, ligas de vinculación,
registro del webhook y mensaje de prueba. El webhook de entrada vive en routers/webhooks.py."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import usuario_actual
from ..models import Candidato, ClienteContacto, Colaborador, Usuario, VinculoTelegram, registrar
from ..services import telegram as tg
from ..services.whatsapp import proveedor

router = APIRouter(prefix="/telegram", tags=["telegram"])


def _clave(t: str) -> str:
    return tg.clave(t)


def _quien(db: Session, tel: str) -> str:
    """A quién corresponde el teléfono vinculado (para que RH lo reconozca en la lista)."""
    if not tel:
        return ""
    for modelo, etiqueta in ((Usuario, "Usuario"), (Colaborador, "Colaborador"), (Candidato, "Candidato"), (ClienteContacto, "Contacto de cliente")):
        for x in db.query(modelo).filter(modelo.telefono.like(f"%{tel}")).limit(1).all():
            nombre = getattr(x, "nombre", "") + (f" {x.apellidos}" if getattr(x, "apellidos", "") else "")
            return f"{etiqueta}: {nombre}".strip()
    return "Sin registro en la plataforma"


@router.get("/estado")
async def estado(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    activo = proveedor() == "telegram"
    bot = await tg.nombre_bot() if tg.configurado() else ""
    info = (await tg.api("getWebhookInfo")).get("result") if tg.configurado() else None
    vinculos = db.query(VinculoTelegram).order_by(VinculoTelegram.vinculado_en.desc()).all()
    return {
        "canalActivo": activo,
        "configurado": tg.configurado(),
        "bot": bot,
        "liga": f"https://t.me/{bot}" if bot else "",
        "webhook": {"url": (info or {}).get("url", ""), "pendientes": (info or {}).get("pending_update_count", 0),
                    "ultimoError": (info or {}).get("last_error_message", "")} if info is not None else None,
        "vinculados": [
            {"nombre": v.nombre, "usuario": v.usuario, "telefono": v.telefono, "quien": _quien(db, v.telefono),
             "vinculadoEn": v.vinculado_en.isoformat() if v.vinculado_en else None}
            for v in vinculos if v.telefono
        ],
        "sinVincular": sum(1 for v in vinculos if not v.telefono),
    }


@router.get("/liga")
def liga(telefono: str, ref: str = "", _: Usuario = Depends(usuario_actual)):
    """Liga firmada para que ESA persona vincule su chat sin compartir el número (se la mandas por correo, SMS
    o en persona). También sirve para entrevistadores y colaboradores."""
    if len(_clave(telefono)) != 10:
        raise HTTPException(400, "Teléfono a 10 dígitos.")
    if not tg.nombre_bot_sync():
        raise HTTPException(503, "El bot de Telegram no está configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME).")
    return {"liga": tg.liga_vinculo(telefono, ref), "vinculado": bool(tg.chat_de_telefono(telefono))}


class PruebaIn(BaseModel):
    telefono: str
    texto: Optional[str] = None


@router.post("/prueba")
async def prueba(datos: PruebaIn, u: Usuario = Depends(usuario_actual)):
    texto = datos.texto or f"Mensaje de prueba de Red Human enviado por {u.nombre}. ✅"
    r = await tg.enviar_a_telefono(datos.telefono, texto)
    return r


@router.post("/webhook/registrar")
async def registrar_webhook(db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual)):
    """Registra en Telegram {APP_URL}/webhooks/telegram con el secret token (solo Administrador)."""
    if u.rol != "Administrador":
        raise HTTPException(403, "Solo un Administrador registra el webhook.")
    if not (tg.configurado() and settings.telegram_webhook_secret):
        raise HTTPException(503, "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET en el servidor.")
    url = f"{settings.app_url.rstrip('/')}/webhooks/telegram"
    r = await tg.registrar_webhook(url)
    registrar(db, u.nombre, "telegram_webhook_registrado", "sistema", "telegram", {"url": url, "ok": r.get("ok")})
    db.commit()
    return {"url": url, **r}
