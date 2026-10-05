"""Ayuda de pruebas (2026-10-05): el webhook de WhatsApp exige X-Hub-Signature-256. Las verificaciones firman sus llamadas
igual que Meta (HMAC-SHA256 del cuerpo con META_APP_SECRET) en vez de saltarse la validación."""
import hashlib
import hmac
import json

SECRETO_PRUEBAS = "secreto-de-pruebas-webhook"


def instalar(client) -> None:
    from app.config import settings

    settings.meta_app_secret = settings.meta_app_secret or SECRETO_PRUEBAS
    original = client.post

    def post(url, *args, **kwargs):
        if url == "/webhooks/whatsapp" and "json" in kwargs:
            cuerpo = json.dumps(kwargs.pop("json")).encode()
            firma = hmac.new(settings.meta_app_secret.encode(), cuerpo, hashlib.sha256).hexdigest()
            kwargs["content"] = cuerpo
            kwargs["headers"] = {**(kwargs.get("headers") or {}), "Content-Type": "application/json", "X-Hub-Signature-256": f"sha256={firma}"}
        return original(url, *args, **kwargs)

    client.post = post
