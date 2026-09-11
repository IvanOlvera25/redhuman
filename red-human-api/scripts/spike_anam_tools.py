"""SPIKE Fase 4 (Punto 4) — ¿Anam acepta `tools` (client) y `voiceDetectionOptions` inline en el
personaConfig cuando el LLM es nuestro endpoint custom (ANAM_LLM_ID)? NO toca la base ni producción:
solo pide un session-token a la API real y reporta la respuesta.

Qué prueba:
  1. Session-token SIN tools (control): debe ser 200.
  2. Session-token CON la tool `terminar_entrevista` (type=client) + voiceDetectionOptions: si es 200,
     Anam acepta la declaración inline con nuestro llmId (falta comprobar en el navegador que el LLM la
     invoque: abre scripts/spike_anam_tools.html y pega el token que imprime este script).
  3. Session-token con tools pero SIN llmId: referencia para saber si el rechazo (si lo hay) es por el
     LLM custom o por la sintaxis de la tool.

Uso (desde red-human-api/, con ANAM_API_KEY/ANAM_AVATAR_ID/ANAM_LLM_ID en .env):
    .venv/Scripts/python.exe scripts/spike_anam_tools.py
"""

import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.services.avatar import ANAM_SESSION_URL, persona_config  # noqa: E402
from app.services.ia import DESPEDIDA_ENTREVISTA  # noqa: E402

TOOL_TERMINAR = {
    "type": "client",
    "name": "terminar_entrevista",
    "description": (
        "Llámala UNA sola vez, inmediatamente después de despedirte del candidato con la frase "
        f"«{DESPEDIDA_ENTREVISTA}…». Cierra la entrevista en el sistema."
    ),
    "parameters": {
        "type": "object",
        "properties": {"motivo": {"type": "string", "description": "temas_cubiertos | candidato_sin_mas_aportes"}},
        "required": ["motivo"],
    },
}

VOZ = {
    "voiceDetectionOptions": {
        "silenceBeforeSkipTurnSeconds": 8,
        "silenceBeforeSessionEndSeconds": 120,
    }
}

PROMPT = (
    "Eres Alma, entrevistadora de prueba. Haz UNA pregunta corta al usuario; cuando responda, despídete "
    f"con la frase exacta «{DESPEDIDA_ENTREVISTA}, gracias.» y de inmediato llama a la herramienta "
    "terminar_entrevista con motivo='temas_cubiertos'."
)


def pedir_token(persona: dict) -> tuple[int, str]:
    with httpx.Client(timeout=30) as client:
        r = client.post(ANAM_SESSION_URL, headers={"Authorization": f"Bearer {settings.anam_api_key}"}, json={"personaConfig": persona})
    return r.status_code, r.text


def main() -> int:
    if not (settings.anam_api_key and settings.anam_avatar_id):
        print("Faltan ANAM_API_KEY / ANAM_AVATAR_ID en .env. Este spike necesita la clave real.")
        return 1
    print(f"llmId configurado: {'sí' if settings.anam_llm_id else 'NO'} · avatar: {settings.anam_avatar_id[:8]}…\n")

    casos = [
        ("1) control sin tools", persona_config("Alma", PROMPT, "Hola, soy Alma. ¿Estás listo?")),
        ("2) con tool client + voiceDetectionOptions (llmId custom)", persona_config("Alma", PROMPT, "Hola, soy Alma. ¿Estás listo?", {"tools": [TOOL_TERMINAR], **VOZ})),
    ]
    sin_llm = persona_config("Alma", PROMPT, "Hola, soy Alma. ¿Estás listo?", {"tools": [TOOL_TERMINAR]})
    sin_llm.pop("llmId", None)
    casos.append(("3) con tool, SIN llmId (referencia)", sin_llm))

    token_con_tools = None
    for nombre, persona in casos:
        status, cuerpo = pedir_token(persona)
        print(f"{nombre}: HTTP {status}")
        try:
            data = json.loads(cuerpo)
        except ValueError:
            data = {"raw": cuerpo[:300]}
        if status == 200 and "sessionToken" in data:
            print("   sessionToken: OK")
            if "tools" in persona:
                token_con_tools = token_con_tools or data["sessionToken"]
        else:
            print(f"   respuesta: {json.dumps(data, ensure_ascii=False)[:400]}")
        print()

    if token_con_tools:
        print("=" * 60)
        print("Token CON tools (pégalo en scripts/spike_anam_tools.html para probar en el navegador que el")
        print("LLM invoca la herramienta y que llegan TOOL_CALL_STARTED / USER_SPEECH_*):")
        print(token_con_tools)
        print("=" * 60)
        return 0
    print("Anam rechazó las tools inline con nuestro LLM custom → el cierre automático usará el fallback")
    print("'marcador' (despedida fija verificada en servidor), ya implementado en /finalizar.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
