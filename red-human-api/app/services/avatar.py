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


def avatar_activo() -> bool:
    # CLAUDE.md: todo personaConfig inline debe traer llmId o Anam rechaza el token como "legacy" —
    # sin ANAM_LLM_ID no se intenta el avatar (antes se intentaba y caía a texto con error).
    return bool(settings.anam_api_key and settings.anam_avatar_id and settings.anam_llm_id)


def persona_config(nombre_persona: str, system_prompt: str, mensaje_inicial: str, extras: Optional[dict] = None) -> dict:
    """personaConfig que se manda a Anam. `extras` (Fase 4, Punto 4 — tras el spike) permite
    agregar `tools`/`voiceDetectionOptions` sin tocar este núcleo."""
    persona = {
        "name": nombre_persona,
        "avatarId": settings.anam_avatar_id,
        "systemPrompt": system_prompt,
        "languageCode": "es",
        "maxSessionLengthSeconds": settings.anam_max_sesion_seg,
        "initialMessage": mensaje_inicial,
    }
    if settings.anam_voice_id:
        persona["voiceId"] = settings.anam_voice_id
    if settings.anam_llm_id:
        persona["llmId"] = settings.anam_llm_id
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
            headers={"Authorization": f"Bearer {settings.anam_api_key}"},
            json={"personaConfig": persona},
        )
        r.raise_for_status()
        return {"session_token": r.json()["sessionToken"], "proveedor": "anam"}
