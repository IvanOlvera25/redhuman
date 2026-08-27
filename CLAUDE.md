# Red Human AI — Reglas del proyecto

Plataforma SaaS de agente de IA de RH para México. `red-human-app` (Next.js 15) + `red-human-api` (FastAPI). Respuestas y UI en español mexicano.

## Claves y seguridad

- Las claves viven SOLO en `red-human-api/.env` (gitignored). Nunca en código, ni en el bundle del cliente, ni pegadas en chats.
- `OPENAI_API_KEY` → cerebro de toda la IA (modelo en `OPENAI_MODEL`, hoy `gpt-5.6-luna`).
- `ANAM_API_KEY` → avatar de entrevistas. NUNCA exponerla al navegador: los session tokens se generan en el servidor (`app/services/avatar.py`) y solo el token efímero (~1 h) llega al cliente.
- El endpoint de OpenAI está registrado en Anam como LLM propio (`ANAM_LLM_ID`); para rotar la clave de OpenAI hay que actualizar también esa registración (`POST https://api.anam.ai/v1/llms`).
- Todo `personaConfig` inline debe incluir `llmId`, o Anam rechaza el token como "legacy".

## Avatar de entrevistas (Anam)

- Anam escucha (STT), habla (TTS) y pone la cara; el que piensa es NUESTRO modelo de OpenAI.
- El endpoint del LLM debe soportar streaming.
- Respuestas del agente breves y conversacionales: se dicen en voz alta.
- Preparar en page-load (SDK precargado, `preconnect` a api.anam.ai); el clic del usuario solo inicia el stream.
- Usar avatares neutrales del catálogo de Anam — nunca clones de personas reales sin consentimiento expreso (reforma de derecho de autor 2026).

## WhatsApp (Meta Cloud API)

- `WHATSAPP_PROVIDER=meta`. El token (`META_WHATSAPP_TOKEN`) vive solo en el servidor; nunca al navegador.
- El webhook `POST /webhooks/whatsapp` es público: valida siempre la firma `X-Hub-Signature-256` con `META_APP_SECRET`.
- El webhook contesta 200 de inmediato y corre el prefiltro en segundo plano — Meta reintenta si tardas, y se deduplica por `wamid`.
- Teléfonos: en la base se guardan a 10 dígitos; hacia la API salen como `52` + 10 (sin el `1`, que Meta ya no usa).
- Ventana de 24 h: fuera de ella Meta rechaza el texto libre (error 131047) y hay que usar plantilla aprobada (`META_PLANTILLA_AVISO`).
- Ningún mensaje saliente decide nada: sigue siendo la persona de RH quien avanza o descarta.

## Legal (México)

- LFPDPPP 2025: la IA solo recomienda; avanzar/descartar/alta siempre lo decide una persona de RH con nombre registrado en bitácora (human-in-the-loop).
- Consentimiento explícito del candidato antes de cualquier entrevista o tratamiento de datos; queda en la bitácora hash-encadenada.
- No pedir ni inferir datos sensibles (salud, embarazo, religión, estado civil, orientación).
