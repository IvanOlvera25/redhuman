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

## Fase 2 — Candidato (persona) vs Postulación (proceso)

- `Candidato` = identidad (nombre, teléfono, correo, wa_id, CV, archivos). `Postulacion` = una aplicación a una vacante: etapa, estado, score, chat, entrevistas, expediente. **Ningún endpoint escribe estado de proceso en `Candidato`** (sus columnas de proceso son legado solo para `scripts/migrar_postulaciones.py`).
- Kanban: una tarjeta por Postulación; `id`/`candidatoId` en la API es el código `P-####` (lo que se manda a `/candidatos/{codigo}/...`); la persona va en `candidatoCodigo`. Se acepta `C-####` por compatibilidad.
- Expediente pertenece a la Postulación (una persona puede tener varios a lo largo del tiempo).
- Reaplicar: si hay postulación ACTIVA para esa vacante se reutiliza; si está cerrada (`descartado`/`contratado`/`reinicio_prueba`) se crea una nueva y la vieja queda como historial. `descartar` cierra; mover de etapa reabre.
- WhatsApp: elegir vacante del menú NUNCA es consentimiento — siempre aviso de privacidad + "Sí"/"Acepto" explícito (palabra completa, `_es_aceptacion`) antes de iniciar el prefiltro; solo se omite si la postulación ya tenía consentimiento registrado por otro medio (RH / `/aplicar`).
- WhatsApp: `Candidato.postulacion_conversacion_id` es la postulación en chat. Lo mueve SOLO el candidato (mensaje entrante enrutado o selección explícita en lista); un mensaje saliente de RH/sistema NUNCA lo mueve (B1). Si el puntero no sirve y varias postulaciones esperan respuesta (`Postulacion.espera_respuesta`), el webhook manda lista interactiva (ids `P-####`) y NO adivina. Ver docstring de `routers/webhooks.py`.
- Crear postulaciones SOLO con `candidatos.crear_postulacion` / `postulacion_para_vacante` (código `P-{8800+id}` de la propia postulación).
- Kanban (B4): `GET /candidatos` regresa solo postulaciones activas salvo `mostrar_cerradas=true` (toggle "Mostrar cerradas") o `activa=` explícito.
- Base existente: correr `scripts/migrar_postulaciones.py --forzar` una vez ANTES de arrancar la versión nueva; la API se niega a arrancar (RuntimeError en lifespan) si hay candidatos sin postulación — la migración de datos nunca corre sola. Prueba de regresión: `scripts/verificar_fase2.py` (modo demo, base desechable).

## Configuración administrativa (Puntos 9-13)

- Cuentas: un Administrador solo ve/administra las Cuentas vinculadas a él (`usuario_cuentas`); `GET/PATCH /cuentas/{id}` responde 404 para una ajena. `Cuenta.nombre` (interno) ≠ `nombre_comercial` (candidatos); leer siempre `nombre_visible`.
- Notificaciones: `services/notificaciones.disparar(..., override=)` acepta ajustes SOLO para esa acción (`NotificarIn`, body `notificar`); la regla guardada nunca se toca desde una acción. Los eventos automáticos (`candidato_apto`, no-show, liga externa) nunca mandan override. En el frontend, toda acción manual que notifica pasa por `LineaNotificar`/`ConfirmacionAccion`.
- Plantillas: el contenido compartido Vacante↔Plantilla es `models.CAMPOS_PLANTILLA` (única lista); el formulario de contenido es uno solo (`components/dashboard/vacantes/formulario-contenido.tsx`) para Nueva vacante y Configuración → Plantillas.
- Modo Prueba: la ventana de nueva sesión se lee de `ConfiguracionSistema.modo_prueba_ventana_min` (nunca hardcodearla).
- Al cambiar de Cuenta, `<PorCuenta>` (layout del dashboard) remonta todo el árbol: no cachear datos por Cuenta fuera de React.

## Entrevista IA (Fase 4)

- Toda identidad de empresa en contenido generado por IA (vacantes, WhatsApp, entrevista) sale de UNA regla: `serial.nombre_empresa(cuenta, cliente, mostrar)` / `nombre_empresa_candidato(v)` → Cliente visible si "mostrar cliente al candidato", si no el nombre comercial de la Cuenta. Nunca texto libre.
- Nombre del candidato: siempre el de la ficha (`candidatos.nombre_ficha(p)`); el perfil de WhatsApp (`wa_nombre`) solo si la ficha trae placeholder. Contexto de la entrevista siempre desde `e.postulacion` (nunca desde la persona).
- Alma se presenta "de Red Human" y entrevista "para el puesto de X en {empresa resuelta}". Saludo e inicio fijos (`ia.mensaje_inicial_entrevista`); sin numerar preguntas; una pregunta principal por turno; despedida fija `ia.DESPEDIDA_ENTREVISTA`.
- Cierre verificable: el backend solo cierra una entrevista con `POST /finalizar` y verifica el `cierre` declarado contra el transcript (`_cierre_verificado`); sin señal verificable degrada a `manual`; desconexión con <2 turnos → `interrumpida` (RH reabre con `POST /entrevistas/{codigo}/reabrir`). Nunca cerrar por tiempo en el servidor sin señal.
- Enfoque de entrevista por vacante: SOLO 2 niveles (`profesional` | `profesional_personal`, `models.ENFOQUES_ENTREVISTA`). No agregar más.
- Datos sensibles (`ia.DATOS_SENSIBLES_PROHIBIDOS`): ni preguntar ni registrar aunque el candidato los mencione — aplica al entrevistador y al evaluador.
