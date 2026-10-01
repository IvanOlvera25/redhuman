"""Nombre visible del canal de mensajería (2026-10-01): «Telegram» con WHATSAPP_PROVIDER=telegram, si no
«WhatsApp». Los valores INTERNOS (canal="whatsapp" en mensajes, reglas de notificación, columnas) no cambian;
solo lo que lee una persona."""

from ..config import settings


def es_telegram() -> bool:
    return (settings.whatsapp_provider or "").strip().lower() == "telegram"


def nombre() -> str:
    return "Telegram" if es_telegram() else "WhatsApp"
