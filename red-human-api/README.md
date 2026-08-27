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
| 2 | **Meta · WhatsApp Cloud API** (opción A, la que usamos) | Enviar/recibir WhatsApp desde un número verificado por Meta, sin servidor extra | [developers.facebook.com](https://developers.facebook.com) → app de Negocio → WhatsApp | `WHATSAPP_PROVIDER=meta`, `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_WHATSAPP_TOKEN`, `META_VERIFY_TOKEN`, `META_APP_SECRET` |
| 2 | **WAHA** (opción B) | Tu propio número, sin costo por mensaje de Meta | [waha.devlike.pro](https://waha.devlike.pro) · Docker: `devlikeapro/waha` en tu VPS | `WHATSAPP_PROVIDER=waha`, `WAHA_URL`, `WAHA_API_KEY` |
| 2 | **Evolution API** (opción C) | Igual que WAHA, alternativa popular en LATAM | [github.com/EvolutionAPI/evolution-api](https://github.com/EvolutionAPI/evolution-api) (Docker) | `WHATSAPP_PROVIDER=evolution`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` |

### Alta del webhook de WhatsApp

El webhook vive en `{API}/webhooks/whatsapp` y **exige HTTPS público**: por eso no se puede
probar en `localhost`. Con el dominio de producción ya arriba:

1. **Meta** → tu app → WhatsApp → Configuración → Webhook → *Editar*:
   - URL de devolución de llamada: `https://api.tudominio.mx/webhooks/whatsapp`
   - Token de verificación: el mismo valor de `META_VERIFY_TOKEN`
   Meta pega un `GET` y espera de vuelta el `hub.challenge`; la API ya lo contesta sola.
2. Suscríbete al campo **`messages`**.
3. Copia el **App Secret** (app → Configuración → Básica) a `META_APP_SECRET`.
   Sin él, el webhook queda abierto: cualquiera puede inyectar mensajes falsos.
4. La cuenta de WhatsApp Business debe estar suscrita a la app
   (`POST /{WABA_ID}/subscribed_apps`); si no, Meta nunca manda los webhooks.
5. Usa un token de **System User sin caducidad** (Business Manager → Usuarios del sistema,
   permisos `whatsapp_business_messaging` + `whatsapp_business_management`).
   El token de prueba del panel dura 24 horas.

**Ventana de 24 horas.** Meta solo deja mandar texto libre a quien nos escribió en las últimas
24 h. Fuera de esa ventana el mensaje se rechaza con el error `131047`, y hay que usar una
plantilla aprobada: pon su nombre en `META_PLANTILLA_AVISO` y la API la usa sola como respaldo.
Los mensajes que el candidato inicia (ruta normal del prefiltro) no tienen este problema.

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
| GET | `/webhooks/whatsapp` | Verificación del webhook de Meta (`hub.challenge`) |
| POST | `/webhooks/whatsapp` | Entrada de mensajes (Meta, WAHA y Evolution) |
| GET | `/bitacora` | Auditoría con cadena de hashes |
| GET | `/salud` | Estado de configuración |

## Producción (VPS Hostinger)

1. `DATABASE_URL=postgresql+psycopg://…` (instala Postgres en el VPS) — SQLite es solo para dev.
2. Corre la API con `uvicorn` detrás de Nginx/Caddy (o en Docker/Coolify), **con certificado
   válido**: Meta rechaza webhooks en HTTP o con certificado autofirmado.
3. `CORS_ORIGINS=https://app.tudominio.mx` y `APP_URL=https://app.tudominio.mx`.
4. Da de alta el webhook de WhatsApp con la URL pública (ver arriba) y llena `META_APP_SECRET`.
5. En el frontend define `NEXT_PUBLIC_API_URL=https://api.tudominio.mx`.
6. Comprueba con `curl https://api.tudominio.mx/salud` → debe decir
   `"whatsapp_proveedor": "meta"` y `"whatsapp_webhook_firmado": true`.

## Principios integrados

- **Human-in-the-loop:** ninguna decisión adversa es automática; `decision`, `seleccionar` y `alta`
  exigen el nombre de la persona de RH y quedan en bitácora junto a la recomendación de la IA (LFPDPPP 2025).
- **Consentimiento** registrado con fecha; el candidato que escribe primero por WhatsApp lo otorga al iniciar.
- **Bitácora hash-encadenada:** cada evento incluye el hash del anterior (evidencia de no-alteración).
