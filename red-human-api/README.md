# Red Human AI — API (Backend · Módulos 1 y 2)

Backend real en **FastAPI** de la plataforma Red Human AI. Implementa:

- **Módulo 1 · Reclutamiento y selección** — vacantes, distribuidor con IA, captación por 4 rutas,
  extractor de CVs, agente de prefiltro conversacional y decisiones con humano en el circuito.
- **Módulo 2 · Contratación e integración** — expedientes, checklist de documentos con validación IA,
  recordatorios por WhatsApp y alta autorizada por RH.
- **Bitácora de auditoría** append-only con cadena de hashes (LFPDPPP).

Funciona **sin ninguna clave** (modo demo con respuestas simuladas); cada clave que configures
activa esa capacidad real.

## Cómo correr

```bash
cd red-human-api
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env            # llena tus claves (opcional)
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

- Documentación interactiva: **http://localhost:8000/docs**
- Estado: `GET /salud` → te dice si la IA y WhatsApp están configurados.
- La base (SQLite) se crea y se siembra sola con datos de demostración.

## APIs externas — cuáles y dónde obtenerlas

| # | API | Para qué se usa | Dónde obtenerla | Variable en `.env` |
|---|-----|-----------------|-----------------|--------------------|
| 1 | **OpenAI** | Extractor de CVs, generador de vacantes, agente de prefiltro y entrevistas, validación de documentos | [platform.openai.com](https://platform.openai.com) → API Keys | `OPENAI_API_KEY` (modelo con `OPENAI_MODEL`) |
| 1b | **Anam** (avatar de video) | Entrevista en video con avatar neutral; sin clave la entrevista corre por chat | [lab.anam.ai/register](https://lab.anam.ai/register) → API Keys (gratis: 30 min/mes) | `ANAM_API_KEY`, `ANAM_AVATAR_ID` |
| 2 | **WAHA** (WhatsApp, opción A) | Enviar/recibir WhatsApp con tu propio número (sin costo por mensaje de Meta) | [waha.devlike.pro](https://waha.devlike.pro) · Docker: `devlikeapro/waha` en tu VPS | `WHATSAPP_PROVIDER=waha`, `WAHA_URL`, `WAHA_API_KEY` |
| 2 | **Evolution API** (WhatsApp, opción B) | Igual que WAHA, alternativa popular en LATAM | [github.com/EvolutionAPI/evolution-api](https://github.com/EvolutionAPI/evolution-api) (Docker) | `WHATSAPP_PROVIDER=evolution`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` |

**Webhook de entrada:** configura tu gateway (WAHA o Evolution) para que apunte a
`POST http://tu-servidor:8000/webhooks/whatsapp`. Con eso, cuando un candidato escribe al número,
el agente lo registra y hace el prefiltro solo.

Próximas fases (aún no requeridas): Deepgram (voz STT), Cartesia/ElevenLabs (voz TTS),
LiveKit (entrevistas en vivo), Resend (correo).

## Endpoints principales

### Módulo 1 · Reclutamiento
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/vacantes` | Lista con conteo real de candidatos |
| POST | `/vacantes/generar` | Genera descripción + textos por plataforma + preguntas de filtro (IA) |
| POST | `/vacantes` | Crea (borrador o publicada) |
| POST | `/vacantes/{codigo}/publicar` | Publica en plataformas |
| GET/POST | `/candidatos` | Lista / ingesta con dedup por teléfono-correo |
| POST | `/candidatos/cv` | Sube CV (PDF/imagen) → extracción con IA → crea candidato |
| POST | `/candidatos/{codigo}/prefiltro` | Un turno de conversación con el agente de prefiltro |
| GET | `/candidatos/{codigo}/mensajes` | Historial de la conversación |
| POST | `/candidatos/{codigo}/decision` | **Decisión humana** (avanzar/descartar) — exige nombre de RH |
| POST | `/candidatos/{codigo}/seleccionar` | Selección → crea expediente y solicita documentos |
| GET/POST | `/entrevistas` | Lista / agenda entrevista con IA (guion a la medida + liga pública) |
| GET | `/entrevistas/publica/{token}` | Info de la sala para el candidato |
| POST | `/entrevistas/publica/{token}/consentimiento` | Consentimiento explícito del candidato (bitácora) |
| POST | `/entrevistas/publica/{token}/sesion` | Inicia sesión: avatar Anam o modo texto |
| POST | `/entrevistas/publica/{token}/turno` | Un turno de la entrevista en modo texto |
| POST | `/entrevistas/publica/{token}/finalizar` | Cierra y evalúa con IA (recomendación para RH) |

### Módulo 2 · Contratación
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/contratacion/expedientes` | Expedientes con checklist y avance |
| POST | `/contratacion/expedientes/{id}/documentos` | Sube documento → validación IA → estado |
| POST | `/contratacion/expedientes/{id}/documentos/estado` | Revisión humana manual |
| POST | `/contratacion/expedientes/{id}/recordatorio` | Recordatorio de pendientes por WhatsApp |
| POST | `/contratacion/expedientes/{id}/alta` | **Alta del colaborador** — exige autorización de RH y expediente al 100% |

### Transversal
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/webhooks/whatsapp` | Entrada de mensajes (WAHA y Evolution) |
| GET | `/bitacora` | Auditoría con cadena de hashes |
| GET | `/salud` | Estado de configuración |

## Producción (VPS Hostinger)

1. `DATABASE_URL=postgresql+psycopg://…` (instala Postgres en el VPS) — SQLite es solo para dev.
2. Corre la API con `uvicorn` detrás de Nginx/Caddy (o en Docker/Coolify).
3. Levanta WAHA o Evolution en el mismo VPS y apunta su webhook a la API.
4. En el frontend define `NEXT_PUBLIC_API_URL=https://api.tudominio.mx`.

## Principios integrados

- **Human-in-the-loop:** ninguna decisión adversa es automática; `decision`, `seleccionar` y `alta`
  exigen el nombre de la persona de RH y quedan en bitácora junto a la recomendación de la IA (LFPDPPP 2025).
- **Consentimiento** registrado con fecha; el candidato que escribe primero por WhatsApp lo otorga al iniciar.
- **Bitácora hash-encadenada:** cada evento incluye el hash del anterior (evidencia de no-alteración).
