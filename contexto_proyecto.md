# Red Human AI — Contexto técnico del repositorio

> Documento generado para dar contexto completo a otro asistente de IA (Gemini) que va a
> colaborar en este repositorio. Refleja el estado real del código al **2026-09-01**,
> commit `3985b0e` en la rama `red-human-v2.0`. Todo lo descrito aquí fue verificado
> leyendo el código fuente directamente, no se asume nada de documentación externa.

---

## 1. Objetivo general del proyecto

**Red Human AI** es una plataforma SaaS de agente de IA de Recursos Humanos para
empresas en **México**. Cubre el ciclo de vida completo de una contratación y, a
partir de la v2.0, también movilidad interna:

1. **Reclutamiento y selección** — generación de vacantes con IA, publicación
   multicanal (WhatsApp, OCC, LinkedIn, portal propio), recepción de candidatos
   (formulario web o WhatsApp), prefiltro conversacional con IA, extracción y
   calificación de CVs, entrevista con avatar de video (Anam) o texto.
2. **Contratación e integración (Onboarding)** — captura de condiciones finales,
   expediente digital con checklist de documentos obligatorios, seguimiento de
   documentos vía IA, alta como colaborador.
3. **Requisiciones inteligentes / "Cazatalentos IA"** — un gerente levanta una
   requisición, RH la autoriza, corre un "Radar Interno" que compara la vacante
   contra empleados activos (movilidad interna) antes de salir a buscar afuera.
4. Módulos de panel aún en fase de UI/placeholder: capacitación, desempeño, clima,
   conocimiento (ver `red-human-app/app/dashboard/*`).

Principio rector explícito en el código y en `CLAUDE.md`: **human-in-the-loop**.
La IA solo recomienda; avanzar, descartar o dar de alta a alguien siempre lo decide
una persona de RH identificada, registrada en una bitácora con cadena de hashes
(`Bitacora` / `registrar()` en `models.py`), por cumplimiento con la **LFPDPPP**
(ley de protección de datos personales mexicana).

---

## 2. Stack tecnológico

### Backend — `red-human-api/`
- **FastAPI** (`fastapi>=0.115`) sobre **Uvicorn**.
- **SQLAlchemy 2.0** (ORM declarativo con `Mapped[...]`) — `database_url` default
  `sqlite:///./redhuman.db` (SQLite en dev; el `.env.example` sugiere Postgres en
  producción vía `postgresql+psycopg://...`, pero no hay driver de Postgres en
  `requirements.txt` todavía).
- **Pydantic v2** + **pydantic-settings** para configuración tipada (`app/config.py`).
- **OpenAI SDK** (`openai>=1.60`) — "el cerebro" de toda la IA (extracción de CVs,
  generación de vacantes, agente de prefiltro/WhatsApp, validación de documentos,
  LLM detrás del avatar de entrevistas). Modelo configurado vía `OPENAI_MODEL`
  (default `gpt-5.6-luna`).
- **httpx** — cliente HTTP async, usado para llamar a la Graph API de Meta y a los
  gateways alternos de WhatsApp (WAHA/Evolution).
- **APScheduler** (`AsyncIOScheduler`) — corre un job cada 5 min para detectar
  no-shows de videollamada (`services/agenda.revisar_videollamadas_noshow`).
- **pypdf** — extracción de texto de CVs en PDF.
- Autenticación propia por sesión de servidor (no JWT): cookie + hash `scrypt` +
  tabla `sesiones` revocable (`services/auth.py`, `models.Usuario`, `models.Sesion`).
- **Sin suite de pruebas automatizadas** — no existe ningún directorio/archivo
  `test*` en todo el repo.

### Frontend — `red-human-app/`
- **Next.js 15** (App Router) + **React 19** + **TypeScript**.
- **Tailwind CSS 4** (vía `@tailwindcss/postcss`).
- **Framer Motion** — animaciones.
- **Recharts** — gráficas del dashboard/métricas.
- **@anam-ai/js-sdk** + **@react-three/fiber** / **drei** / **three** — avatar de
  video 3D de entrevistas (Anam).
- Sin librería de estado global (no Redux/Zustand visible) ni de fetching
  (no React Query) — `lib/api.ts` como capa de acceso directo a la API.

### Integraciones externas (todas server-side, llaves solo en `red-human-api/.env`)
| Servicio | Para qué | Dónde |
|---|---|---|
| OpenAI | LLM de todo el sistema | `services/ia.py` |
| Anam | Avatar de video en entrevistas (STT/TTS/cara; el LLM sigue siendo OpenAI) | `services/avatar.py` |
| Meta WhatsApp Cloud API | Canal principal de mensajería con candidatos | `services/whatsapp.py`, `routers/webhooks.py` |
| WAHA / Evolution API | Gateways alternos de WhatsApp (self-hosted, sin costo por conversación) | `services/whatsapp.py` |

---

## 3. Árbol de directorios principal

```
redhuman-v2/
├── CLAUDE.md                  # reglas del proyecto para el asistente de IA
├── README.md
├── scripts/                   # scripts de operación/despliegue (fuera de detalle aquí)
├── red-human-api/             # Backend FastAPI
│   ├── app/
│   │   ├── main.py            # arranque, CORS, scheduler, registro de routers, /salud
│   │   ├── config.py          # Settings (pydantic-settings) — TODAS las variables de entorno
│   │   ├── database.py        # engine, SessionLocal, Base declarativa
│   │   ├── models.py          # TODOS los modelos SQLAlchemy (ver sección 4)
│   │   ├── migraciones.py     # sincroniza columnas nuevas sobre una DB SQLite ya existente
│   │   ├── seed.py            # siembra de datos demo + usuario admin inicial
│   │   ├── serial.py          # serializadores dict/JSON de los modelos hacia la API
│   │   ├── deps.py            # dependencias FastAPI (usuario_actual, usuario_decisor, etc.)
│   │   ├── routers/           # un router por dominio, montado en main.py
│   │   │   ├── auth.py            # login/logout, sesiones
│   │   │   ├── vacantes.py        # CRUD de vacantes + generador de contenido con IA
│   │   │   ├── candidatos.py      # pipeline de reclutamiento: carga CV, prefiltro, postulación
│   │   │   ├── entrevistas.py     # módulo de entrevista con avatar/texto (Anam)
│   │   │   ├── contratacion.py    # expediente, documentos, alta como colaborador
│   │   │   ├── colaboradores.py   # colaboradores ya dados de alta
│   │   │   ├── requisiciones.py   # requisiciones + Radar Interno (Cazatalentos IA)
│   │   │   ├── empleados.py       # universo de empleados activos (para el Radar Interno)
│   │   │   ├── metricas.py        # datos para el dashboard
│   │   │   └── webhooks.py        # ★ webhook entrante de WhatsApp (Meta/WAHA/Evolution) + bitácora
│   │   └── services/          # lógica de negocio / integraciones desacopladas de FastAPI
│   │       ├── whatsapp.py        # ★ TODO el envío/recepción de WhatsApp (ver sección 6)
│   │       ├── ia.py              # prompts, function-calling del agente, extracción de CV
│   │       ├── avatar.py          # tokens de sesión de Anam
│   │       ├── agenda.py          # rescate de no-shows de videollamada (job cada 5 min)
│   │       └── archivos.py        # validación/guardado de archivos subidos (CVs, documentos)
│   ├── uploads/cv/             # CVs subidos (excluido de git)
│   ├── redhuman.db             # SQLite local (excluido de git)
│   ├── .env / .env.example     # credenciales (.env excluido de git) / plantilla
│   └── requirements.txt
└── red-human-app/              # Frontend Next.js
    ├── app/
    │   ├── page.tsx                 # landing pública
    │   ├── login/                   # login de RH
    │   ├── dashboard/                # panel interno de RH (protegido por middleware.ts)
    │   │   ├── vacantes/ candidatos/ requisiciones/ colaboradores/ entrevistas/ onboarding/
    │   │   └── capacitacion/ desempeno/ clima/ conocimiento/   # módulos futuros, UI placeholder
    │   ├── aplicar/[slug]/          # postulación pública a una vacante (sin login)
    │   ├── entrevista/[token]/      # entrevista con avatar — liga pública tokenizada
    │   └── portal/                  # bolsa de trabajo pública (todas las vacantes publicadas)
    ├── components/                  # UI compartida (dashboard/, landing/, ui.tsx genérico)
    ├── lib/
    │   ├── api.ts                   # cliente fetch hacia la API
    │   ├── data.ts / phase2.ts      # tipos/helpers de datos
    │   └── utils.ts
    └── middleware.ts                # protege /dashboard con la cookie de sesión
```

---

## 4. Modelos de datos principales

Todos en `red-human-api/app/models.py` (SQLAlchemy 2.0, `Mapped[...]`). Relaciones
clave:

- **`Vacante`** — puesto publicado. Tiene `estado` (Borrador/Publicada/En
  revisión/Cerrada), `plataformas` (JSON, subset de `PLATAFORMAS = ["WhatsApp",
  "OCC", "LinkedIn", "Portal"]`), contenido generado por IA (`resumen`,
  `perfil_ideal`, `publicaciones` por canal), y opcionalmente viene de una
  `Requisicion` (`requisicion_id`).
- **`Candidato`** — el corazón del pipeline. Campos clave: `etapa` (una de
  `ETAPAS_CANDIDATO = ["Prefiltro", "Entrevista IA", "Evaluación", "Entrevista
  Humana", "Contratación", "Onboarding"]`), `estado` (cumple/revision/no_cumple/
  pendiente), `fuente` (Formulario/WhatsApp/OCC/LinkedIn/Indeed/RH),
  `consentimiento` + `consentimiento_fecha` (LFPDPPP), `telefono` (guardado a
  **10 dígitos**), **`wa_id`** (el identificador que manda Meta, con lada — es
  la clave de deduplicación de conversación), `wa_nombre` (nombre de perfil de
  WhatsApp), y todo el estado de la fase "Zero-Touch" de videollamada
  (`videollamada_agendada_en`, `videollamada_liga`,
  `videollamada_aviso_noshow_enviado`). Relaciones 1-a-N con `Mensaje`,
  `Entrevista`, `Archivo`; 1-a-1 con `Expediente`.
- **`Mensaje`** — cada turno de la conversación (WhatsApp/web/simulador).
  Campos: `rol` (user/assistant), `texto`, `canal`, **`enviado`** (bool — si
  realmente salió por WhatsApp; ver hallazgos en sección 6), **`wa_id`** (el
  *wamid* de Meta — pensado para deduplicar reintentos del webhook, aunque en la
  práctica no se usa para eso, ver sección 6).
- **`Archivo`** — CV y anexos del candidato *antes* de ser contratado (distinto
  de `Documento`, que es del expediente ya en Contratación/Onboarding).
- **`Entrevista`** — entrevista estructurada con IA (avatar Anam o texto).
  `token` es la liga pública (`/entrevista/[token]`), `transcript` y
  `evaluacion` son JSON. También guarda `liga_meet` cuando RH genera manualmente
  una videollamada de Google Meet (independiente del avatar).
- **`Requisicion`** → **`SugerenciaMovilidad`** → **`Empleado`** — módulo 4
  (Cazatalentos IA): una requisición autorizada corre el Radar Interno, que
  genera una `SugerenciaMovilidad` por cada `Empleado` con match, con
  `porcentaje_match`, habilidades coincidentes/faltantes. Decisión final
  siempre de RH.
- **`Expediente`** → **`Documento`** — expediente de contratación. Checklist fijo
  en `DOCUMENTOS_BASE` (identificación, CURP, RFC, NSS, comprobante de domicilio,
  CLABE). Propiedades calculadas: `progreso` (% de documentos obligatorios
  recibidos — es lo que habilita el alta) y `pendientes`.
- **`Colaborador`** — se crea al dar de alta desde Onboarding; copia lo
  definitivo del candidato/expediente. Trae `candidato_origen_id` y
  `expediente_id` para trazabilidad completa.
- **`Usuario`** / **`Sesion`** — cuentas de RH (`rol`: admin/rh/lectura) y
  sesiones de servidor revocables (login con `scrypt` + bloqueo por intentos
  fallidos).
- **`Bitacora`** — auditoría **append-only con cadena de hashes**
  (`hash_prev`/`hash`, SHA-256 sobre el evento anterior + el actual). Escrita por
  `registrar()`, exigida por LFPDPPP para trazabilidad de decisiones humanas.

---

## 5. Estado actual general del código

- **Rama activa:** `red-human-v2.0` (también parece ser la rama principal/base).
  `git status` limpio; el trabajo reciente (últimos commits) está enfocado casi
  por completo en depurar la integración de WhatsApp.
- **Commits más recientes** (de más nuevo a más viejo):
  1. `3985b0e` Fix: idioma `es_MX` hardcodeado en `enviar_plantilla`.
  2. `0a5cc7b` Fix: manejo de errores silencioso para envíos fallidos de Meta
     (los tres puntos de `webhooks.py` que marcaban `enviado=True` a fuerzas ya
     reflejan el resultado real del envío; ver sección 6).
  3. `63fc068`, `1e31ed9`, `6ae6fbf`, `1e83143`, `abdaff4` — trabajo del módulo de
     Onboarding/Contratación (UI de 6 bloques, botones manuales de Meet, alta de
     colaborador).
  4. `065b3b6` — "Flujo Zero-Touch completo" (plantilla Meta + agendador +
     monitor de inasistencias), la base del flujo automatizado de WhatsApp.
- **Sin pruebas automatizadas.** Ningún archivo/directorio de tests en todo el
  repo (ni backend ni frontend). La validación hoy es manual / en producción
  (el propio usuario ha reportado que están "depurando directo en producción
  porque no podemos levantar ngrok localmente").
- **Sin CI de tests visible** en `.github/` más allá de lo que ya exista (no se
  auditó en detalle, pero no hay pipeline de tests que hubiera atrapado los bugs
  de WhatsApp descritos abajo).
- **Deuda técnica marcada explícitamente en el código:**
  - `config.py:41` — `meta_verify_token` tiene un **valor por defecto hardcodeado
    en el repo** (`"redhuman_webhook_verify_token_2026_x89a"`), con un comentario
    `TODO: mover a .env — este default quedó en el repo y conviene rotarlo`. No es
    una llave secreta de alto riesgo (solo el token del handshake GET de
    verificación de Meta), pero sigue siendo una mala práctica tenerlo en el
    código fuente y debería rotarse/moverse.
- **Base de datos:** SQLite local (`redhuman.db`, excluida de git) con un
  mecanismo casero de migración (`migraciones.py: sincronizar()`) que agrega
  columnas nuevas a una DB ya existente en cada arranque — no hay Alembic ni
  migraciones versionadas.
- El resto de los módulos (vacantes, candidatos, contratación, requisiciones,
  auth) se ven funcionalmente completos y consistentes con lo documentado en
  `CLAUDE.md`; no se detectaron inconsistencias graves fuera del área de
  WhatsApp.

---

## 6. ANÁLISIS DETALLADO DE WHATSAPP (prioridad alta)

### 6.1 Arquitectura general

Meta WhatsApp Cloud API es el canal de mensajería principal con los candidatos.
El diseño documentado en `CLAUDE.md` es:

> El webhook `POST /webhooks/whatsapp` es público: valida siempre la firma
> `X-Hub-Signature-256`. Contesta 200 de inmediato y corre el prefiltro en
> segundo plano — Meta reintenta si tardas, y se deduplica por `wamid`.

**Esto es lo que el código actualmente hace, verificado línea por línea — y hay
tres discrepancias importantes entre ese diseño y la implementación real (6.4).**

### 6.2 Archivos que manejan esta lógica

| Archivo | Responsabilidad |
|---|---|
| `red-human-api/app/services/whatsapp.py` | Todo el envío (texto, plantilla, lista interactiva) y el parseo de webhooks entrantes de Meta/WAHA/Evolution. Es la única capa que debe hablar con `graph.facebook.com`. |
| `red-human-api/app/routers/webhooks.py` | Endpoint público `GET/POST /webhooks/whatsapp`: handshake de verificación de Meta, y el agente conversacional completo (detección de vacante, dedup/creación de candidato, consentimiento LFPDPPP, disparo del prefiltro). |
| `red-human-api/app/routers/candidatos.py` | `_disparar_plantilla_inicio` (línea ~330) — dispara la plantilla `inicio_entrevista_rh` apenas se guarda un candidato nuevo desde el formulario web. También varios otros `enviar_mensaje(...)` durante el flujo de prefiltro/agenda. |
| `red-human-api/app/routers/contratacion.py` | Envíos de WhatsApp durante Contratación/Onboarding (avisos de documentos, etc.). |
| `red-human-api/app/routers/entrevistas.py` | Envío manual de ligas de Google Meet por WhatsApp (botones del panel, feature reciente). |
| `red-human-api/app/services/agenda.py` | Job cada 5 min que manda el mensaje de rescate a candidatos que no se presentaron a la videollamada agendada por el agente. |
| `red-human-api/app/config.py` | Todas las variables `META_*` / `WHATSAPP_*` (líneas 29-55). |
| `red-human-api/app/models.py` | `Candidato.wa_id`/`telefono` (dedup de conversación), `Mensaje.enviado`/`wa_id` (estado de entrega). |

No existe ningún otro punto del backend que construya un payload hacia
`graph.facebook.com` — se confirmó por búsqueda exhaustiva. El frontend
(`red-human-app`) tampoco llama a Meta directamente (correcto: el token nunca
debe llegar al navegador).

### 6.3 Cómo funciona el envío (`services/whatsapp.py`)

- **Multi-proveedor:** `WHATSAPP_PROVIDER` ∈ `{"meta", "waha", "evolution", ""}`.
  `proveedor()` (línea 40) infiere `"meta"` automáticamente si hay credenciales de
  Meta aunque la variable esté vacía, para que un `.env` incompleto no caiga en
  modo demo silenciosamente.
- **Normalización de teléfono — `numero_e164()` (línea 64):** quita todo lo que
  no sea dígito (incluido cualquier `+`), y si quedan 10 dígitos les antepone
  `52`; si detecta el prefijo legado `521` de 13 dígitos (con el `1` que Meta ya
  no usa) lo colapsa a `52` + 10 dígitos. Verificado con casos reales — funciona
  correctamente para el formato en que se guardan los teléfonos en la base (10
  dígitos, `Candidato.telefono`).
- **Envío de texto libre — `enviar_mensaje()` (línea 163):** si Meta rechaza por
  estar fuera de la ventana de 24 h (`CODIGOS_FUERA_DE_VENTANA = {131047, 131026,
  132000}`), reintenta automáticamente con la plantilla aprobada
  (`META_PLANTILLA_AVISO`) si está configurada.
- **Envío de plantilla — `enviar_plantilla()` (línea 139):** arma
  `template.components = [{"type": "body", "parameters": [{"type": "text",
  "text": ...}]}]` a partir de la lista `parametros` que le pasen — esto es lo
  que llena variables tipo `{{1}}` en la plantilla aprobada en Meta. El único
  caller actual (`_disparar_plantilla_inicio`) siempre pasa `[primer_nombre]`
  para la plantilla `inicio_entrevista_rh` ("Hola {{1}}, recibimos...").
  `language.code` está **hardcodeado a `"es_MX"`** (cambio del commit más
  reciente, `3985b0e`) — antes dependía de `settings.meta_plantilla_idioma`,
  cuyo default en `config.py` también es `"es_MX"`, pero producción seguía
  reportando error de idioma (ver 6.5) hasta que se hizo literal.
- **`_meta_post()` (línea 110):** hace el POST real. Nunca lanza excepción hacia
  arriba — cualquier error de red o de la Graph API se captura y se regresa como
  `{"enviado": False, "detalle": "...", "codigo": ...}`. Desde el commit
  `0a5cc7b`, también hace `print("[whatsapp] Meta rechazó el mensaje (...): ...")`
  con el cuerpo crudo de la respuesta de error, para depuración en logs del
  servidor sin exponer nada al usuario final.
- **Recepción — `parsear_webhook()` (línea 260):** normaliza el payload entrante
  de los tres proveedores a `{telefono, texto, nombre, wa_id, tipo,
  id_seleccionado}`. Para Meta, ignora correctamente los eventos de tipo
  `"statuses"` (acuses de entrega/lectura) y solo procesa `"messages"`.
- **`firma_valida()` (línea 222):** valida `X-Hub-Signature-256` con HMAC-SHA256
  usando `META_APP_SECRET`. **Está implementada pero, ver 6.4, nunca se invoca.**

### 6.4 Discrepancias verificadas entre el diseño documentado y el código real

Estos tres puntos son hallazgos de esta auditoría, no reportes del usuario — se
confirmaron leyendo `webhooks.py` completo y buscando todos los usos de cada
función relevante en el repo.

1. **La firma del webhook NUNCA se valida.** `firma_valida()` existe en
   `services/whatsapp.py:222` pero no aparece invocada en ningún lugar del
   código (`grep` de `firma_valida` solo la encuentra en su propia definición).
   El handler `POST /webhooks/whatsapp` (`webhooks.py:164`) lee el JSON del
   `Request` y lo procesa directo, sin leer ni verificar el header
   `X-Hub-Signature-256`. **Esto significa que cualquiera que conozca la URL del
   webhook puede mandarle un POST con un payload falso y el sistema lo procesará
   como si viniera de Meta** (crear candidatos falsos, disparar el agente de IA,
   etc.). Esto contradice directamente la regla de `CLAUDE.md`: *"valida siempre
   la firma X-Hub-Signature-256 con META_APP_SECRET"*.

2. **El webhook NO responde 200 de inmediato ni procesa en segundo plano.** El
   handler hace todo de forma síncrona y `await`-eada antes de devolver la
   respuesta: parsear el payload, detectar vacante, crear/buscar candidato,
   correr el prefiltro (que a su vez llama a OpenAI) y mandar la respuesta por
   WhatsApp — todo dentro del mismo request-response del webhook. No hay
   `BackgroundTasks` ni `add_task` en ningún punto del código (`grep` no
   encuentra ninguno). En producción, si una llamada a OpenAI o a Meta tarda,
   la respuesta al webhook se retrasa, lo que puede hacer que **Meta reintente
   la entrega del mismo mensaje** (Meta reintenta si no recibe 200 rápido).

3. **No hay deduplicación real por `wamid`.** El modelo `Mensaje.wa_id` tiene un
   comentario explícito: *"Meta reenvía el webhook si no le contestamos rápido;
   guardarlo evita procesar dos veces el mismo mensaje"* — pero esa lógica no
   está implementada. `parsear_webhook()` sí regresa el `wamid` entrante como
   `msg["wa_id"]`, pero `webhooks.py` **nunca lee ese campo** (no aparece
   `msg["wa_id"]` ni `msg.get("wa_id")` en todo el archivo) ni lo compara contra
   mensajes ya guardados antes de procesar. Combinado con el punto 2 (reintentos
   de Meta por respuesta lenta), esto es una vía plausible para procesar el
   mismo mensaje del candidato dos veces y mandar respuestas duplicadas.

   > Nota: sí existe deduplicación de **candidato** (por `wa_id` del remitente o
   > por teléfono normalizado, en `_buscar_o_crear_candidato`, `webhooks.py:89`)
   > — eso evita crear candidatos duplicados. Lo que falta es deduplicar el
   > **mensaje individual** por su `wamid` para no reprocesar un reintento.

### 6.5 Historial de bugs encontrados y corregidos en esta sesión de depuración

Contexto: el usuario reportó que **el envío de plantillas fallaba silenciosamente
en producción** — la UI marcaba el mensaje como enviado pero nunca llegaba al
candidato, y no había forma de levantar un túnel (ngrok) para depurar localmente,
así que la depuración se hizo agregando logs y leyéndolos directo en producción.

1. **Hipótesis inicial descartada — normalización de teléfono.** El usuario
   reportó números de 10 dígitos (ej. `+5612717776`) siendo interpretados por
   Meta como código de país de Chile (`56`). Se auditó `numero_e164()` y **ya
   normalizaba correctamente** este caso exacto (probado con el ejemplo real:
   `+5612717776` → `525612717776`) desde el commit original de la integración
   (`9c397b0`). No fue necesario ningún cambio aquí.

2. **Bug real #1 — `enviado=True` hardcodeado en 3 puntos de `webhooks.py`.**
   Tres lugares del agente conversacional (saludo tras capturar nombre, pregunta
   de nombre, despedida al completar el prefiltro) llamaban a `enviar_mensaje()`
   pero **descartaban el resultado** y guardaban el `Mensaje` en la base con
   `enviado=True` fijo, sin importar si Meta lo aceptó o lo rechazó. Corregido en
   el commit `0a5cc7b`: ahora capturan el `dict` de retorno y usan
   `envio.get("enviado", False)` + `envio.get("wa_id", "")`, igual que ya se
   hacía correctamente en el resto de los call sites del sistema
   (`candidatos.py`, `contratacion.py`, `entrevistas.py`, `agenda.py`).

3. **Bug real #2 — el mensaje guardado en el historial no reflejaba el fallo.**
   En `_disparar_plantilla_inicio` (`candidatos.py`), aunque ya se guardaba el
   `enviado=False` correcto, el **texto** del `Mensaje` seguía siendo el texto de
   la plantilla como si se hubiera mandado ("Hola Juan, ¡gracias por tu
   interés!..."). Corregido en `0a5cc7b`: si `envio.get("enviado")` es falso, el
   texto guardado ahora es `"[Fallo de envío Meta] La plantilla «...» no pudo
   entregarse a <teléfono>: <detalle>."` — visible y honesto para RH en el chat,
   sin romper el flujo (sigue sin lanzar excepción).

4. **Causa raíz real, encontrada gracias al log agregado en el punto 2/3 —
   error 132001 de Meta: `Template name does not exist in the translation`.**
   El log `[whatsapp] Meta rechazó el mensaje (...)` (agregado en `_meta_post`,
   commit `0a5cc7b`) capturó el error real: la plantilla `inicio_entrevista_rh`
   está aprobada en Meta Business Manager bajo *"Spanish (MEX)"* (código de API
   `es_MX`), y el código no estaba mandando ese código de idioma de forma
   confiable — dependía de `settings.meta_plantilla_idioma`, que aunque en este
   repo ya tenía default `"es_MX"` (`config.py:47`), podía verse afectado por
   diferencias de despliegue/entorno. Corregido en `3985b0e`: `language.code` en
   `enviar_plantilla` ahora es literal `idioma or "es_MX"`, sin depender de
   `settings` — garantiza `es_MX` salvo que el caller pase `idioma` explícito.

   ⚠️ **Importante para quien retome esto:** este fix solo sirve si el proceso en
   producción corre este mismo commit. Si el servidor de producción sigue
   sirviendo un checkout/imagen vieja, el error 132001 va a seguir apareciendo
   hasta que se despliegue esta versión.

### 6.6 Pendientes / riesgos abiertos en WhatsApp (no corregidos aún)

- **Validar la firma del webhook** (6.4.1) — riesgo de seguridad real en un
  endpoint público sin autenticación. Requiere leer el *raw body* de la request
  (no el JSON ya parseado) para calcular el HMAC contra `META_APP_SECRET` antes
  de aceptar el payload.
- **Mover el procesamiento del webhook a background** (6.4.2) — para cumplir con
  el diseño documentado ("200 inmediato") y reducir el riesgo de reintentos de
  Meta bajo carga o cuando OpenAI responde lento.
- **Deduplicar por `wamid`** (6.4.3) — antes de procesar un mensaje entrante,
  revisar si `msg["wa_id"]` ya existe en `Mensaje.wa_id`.
- `meta_verify_token` con default hardcodeado en el repo (`config.py:41`) —
  debería vivir solo en `.env` y rotarse.
- Confirmar en Meta Business Manager que **todas** las plantillas usadas
  (`inicio_entrevista_rh`, la de `META_PLANTILLA_AVISO`) están aprobadas bajo el
  mismo código de idioma que manda el código (`es_MX`), no solo la que ya se
  depuró.
