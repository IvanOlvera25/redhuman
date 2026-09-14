"""
Servicio de avatar para entrevistas — Anam (https://anam.ai).

API necesaria: ANAM_API_KEY  →  https://lab.anam.ai/register → API Keys
Sin clave, la entrevista corre en "modo texto": el mismo agente entrevistador
(OpenAI) conversa por chat, así el flujo completo funciona de punta a punta.

Restricción legal (reforma de derecho de autor 2026): usar únicamente avatares
neutrales del catálogo del proveedor, nunca clones de personas reales sin
consentimiento expreso.
"""

from typing import Optional

import httpx

from ..config import settings

ANAM_SESSION_URL = "https://api.anam.ai/v1/auth/session-token"


def _limpio(valor: str) -> str:
    # Un .env con comillas o espacios ("ANAM_API_KEY = "abc" ") no debe apagar el avatar en silencio.
    return (valor or "").strip().strip('"').strip("'").strip()


def avatar_activo() -> bool:
    # CLAUDE.md: todo personaConfig inline debe traer llmId o Anam rechaza el token como "legacy" —
    # sin ANAM_LLM_ID no se intenta el avatar (antes se intentaba y caía a texto con error).
    return bool(_limpio(settings.anam_api_key) and _limpio(settings.anam_avatar_id) and _limpio(settings.anam_llm_id))


def estado_avatar() -> dict:
    """Qué variables de Anam ve el proceso (presencia, nunca valores) — para el log de arranque y
    el diagnóstico de RH. Si en producción "cae a texto", esto dice si es configuración o Anam."""
    return {
        "activo": avatar_activo(),
        "ANAM_API_KEY": bool(_limpio(settings.anam_api_key)),
        "ANAM_AVATAR_ID": bool(_limpio(settings.anam_avatar_id)),
        "ANAM_LLM_ID": bool(_limpio(settings.anam_llm_id)),
        "ANAM_VOICE_ID": bool(_limpio(settings.anam_voice_id)),
        "max_sesion_seg": settings.anam_max_sesion_seg,
    }


class AvatarError(RuntimeError):
    """Anam rechazó la sesión: el mensaje trae status + cuerpo de la respuesta (antes solo se veía
    "400 Bad Request" en el log y era imposible saber por qué caía a texto)."""


def persona_config(nombre_persona: str, system_prompt: str, mensaje_inicial: str, extras: Optional[dict] = None) -> dict:
    """personaConfig que se manda a Anam. `extras` (Fase 4, Punto 4 — tras el spike) permite
    agregar `tools`/`voiceDetectionOptions` sin tocar este núcleo."""
    persona = {
        "name": nombre_persona,
        "avatarId": _limpio(settings.anam_avatar_id),
        "systemPrompt": system_prompt,
        "languageCode": "es",
        "maxSessionLengthSeconds": settings.anam_max_sesion_seg,
        "initialMessage": mensaje_inicial,
    }
    if _limpio(settings.anam_voice_id):
        persona["voiceId"] = _limpio(settings.anam_voice_id)
    if _limpio(settings.anam_llm_id):
        persona["llmId"] = _limpio(settings.anam_llm_id)
    if extras:
        persona.update(extras)
    return persona


async def crear_sesion_avatar(
    nombre_persona: str, system_prompt: str, mensaje_inicial: str, extras: Optional[dict] = None
) -> Optional[dict]:
    """Crea una sesión de avatar en Anam y regresa el sessionToken para el navegador.

    Regresa None en modo demo (sin clave) — el frontend cae a entrevista por texto.
    """
    if not avatar_activo():
        return None

    persona = persona_config(nombre_persona, system_prompt, mensaje_inicial, extras)

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            ANAM_SESSION_URL,
            headers={"Authorization": f"Bearer {_limpio(settings.anam_api_key)}"},
            json={"personaConfig": persona},
        )
        if r.status_code >= 400:
            raise AvatarError(f"Anam {r.status_code} en session-token: {r.text[:400]}")
        datos = r.json()
        token = datos.get("sessionToken")
        if not token:
            raise AvatarError(f"Anam no regresó sessionToken: {str(datos)[:300]}")
        return {"session_token": token, "proveedor": "anam"}


async def probar_avatar() -> dict:
    """Diagnóstico para RH/soporte: intenta crear un session token real con un prompt mínimo y
    regresa qué pasó, sin exponer claves. No abre ninguna entrevista."""
    estado = estado_avatar()
    if not estado["activo"]:
        return {**estado, "ok": False, "detalle": "Faltan variables de Anam en el servidor (ver banderas)."}
    try:
        ses = await crear_sesion_avatar("Red Human", "Eres Red Human. Responde en una frase.", "Hola, soy Red Human.")
        return {**estado, "ok": bool(ses), "detalle": "Anam emitió un session token." if ses else "Sin respuesta."}
    except Exception as ex:  # noqa: BLE001 — se reporta tal cual a RH
        return {**estado, "ok": False, "detalle": str(ex)[:500]}
