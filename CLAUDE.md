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
- La entrevistadora se presenta SOLO como «Red Human» (nunca con nombre de persona — "Alma" se eliminó —, nunca "asistente virtual" ni "agente de inteligencia artificial"; si le preguntan si es IA lo dice con naturalidad). Introducción EXACTA en `ia.mensaje_inicial_entrevista(titulo_vacante)` con el nombre real de la vacante; tras la respuesta del candidato inicia de inmediato sin transición; silencio `ia.AVISO_SILENCIO`; sin numerar preguntas; una pregunta principal por turno; despedida fija `ia.DESPEDIDA_ENTREVISTA`. El aviso "conversas con una IA" vive solo en la pantalla de consentimiento (LFPDPPP).
- Cierre verificable: el backend solo cierra una entrevista con `POST /finalizar` y verifica el `cierre` declarado contra el transcript (`_cierre_verificado`); sin señal verificable degrada a `manual`; desconexión con <2 turnos → `interrumpida` (RH reabre con `POST /entrevistas/{codigo}/reabrir`). Nunca cerrar por tiempo en el servidor sin señal.
- Enfoque de entrevista por vacante: SOLO 2 niveles (`profesional` | `profesional_personal`, `models.ENFOQUES_ENTREVISTA`). No agregar más.
- Datos sensibles (`ia.DATOS_SENSIBLES_PROHIBIDOS`): ni preguntar ni registrar aunque el candidato los mencione — aplica al entrevistador y al evaluador.

## Formulario de vacante (Parte 3)

- Orden fijo del formulario compartido (`components/dashboard/vacantes/formulario-contenido.tsx`, Nueva vacante Y Plantillas): Datos principales → Guía opcional → [Generar vacante con Red Human] → Contenido generado y editable → Selección (Prefiltro → Entrevista Red Human) → Gestión → Publicación. El botón de generar va ABAJO de la captura, nunca arriba. No existe "Notas para la IA".
- Regla no negociable 1: Red Human NUNCA inventa condiciones reales (sueldo, periodicidad, ubicación, modalidad, horario, prestaciones). Lo que RH no capturó queda vacío/pendiente con aviso; `beneficios` = exactamente los capturados; `rango_salarial_sugerido` es solo informativo. Garantizado en `ia._asegurar_capturado` (IA y demo) — no depende del prompt.
- Regla no negociable 2: lo capturado se respeta literal — indispensable sigue indispensable, deseable sigue deseable, seniority el elegido; la IA solo AGREGA/complementa lo vacío (`_unir_capturado`, `contenidoDesdeGenerado`). La descripción breve es guía y se expande.
- Sueldo: se captura ESTRUCTURADO (`sueldo_desde/hasta/moneda/periodicidad`, `PERIODICIDADES_SUELDO`); `Vacante.sueldo` (texto) es DERIVADO por `models.texto_sueldo` y es lo que leen WhatsApp, prefiltro, entrevista, portal, publicaciones y el agente. Nunca capturar ni editar el texto por separado. Seniority = uno de `ia.SENIORITY`.
- `Vacante.requisitos` sigue siendo texto (indispensables unidos por « · »); usa `routers.vacantes.requisitos_lista` / `requisitosLista` para tratarlo como lista.
- "Entrevista IA" es el valor interno de la etapa (base y API); en la interfaz siempre se muestra con `nombreEtapa()` → «Entrevista Red Human». No renombrar el valor almacenado.

## Entrevista Humana (Fase 7A)

- Entrevistador interno = `Usuario` de la Cuenta: nombre, correo y WhatsApp salen SIEMPRE del perfil (`Usuario.telefono`, capturado en Configuración → Usuarios); nunca se recapturan en la entrevista. `/auth/entrevistadores` los expone a cualquier sesión de la Cuenta.
- Entrevistador externo = `ClienteContacto` del Cliente de la vacante (`EntrevistaHumanaIn.entrevistador_contacto_id`, se guarda `EntrevistaHumana.contacto_id` y se copian nombre/correo/WhatsApp) o «+ Otro entrevistador» (captura manual). Nunca limitar a contactos registrados.
- Notificar al Cliente: `NotificarIn.cliente_contactos_ids` elige contactos ya registrados (None = todos, [] = ninguno); nunca se capturan datos nuevos del Cliente en una acción.
- Correo: `services/correo.py` (Resend). Sin `RESEND_API_KEY` no sale y se registra «RESEND_API_KEY sin configurar»; el remitente sandbox `onboarding@resend.dev` solo entrega al dueño de la cuenta Resend — en producción `RESEND_FROM` debe ser un dominio verificado. Todo envío regresa `{destinatario, canal, destino, enviado, detalle}` y las acciones manuales lo muestran a RH (`lineasResultados`): un envío fallido nunca es silencioso.
- Las reglas de notificación de una Cuenta NACEN con `models.REGLAS_NOTIFICACION_DEFAULT` (entrevista_agendada = correo+WhatsApp a candidato y entrevistador); las reglas ya guardadas nunca se tocan automáticamente.

## Microsoft Teams (Fase 7B)

- Variables EXACTAS: `TEAMS_CLIENT_ID`, `TEAMS_TENANT_ID`, `TEAMS_CLIENT_SECRET` (+ opcional `TEAMS_REDIRECT_URI`). Solo en el `.env` del servidor; sin ellas `teams.teams_configurado()` es False y todo cae a la liga manual (mismo patrón que Resend/Anam: nunca rompe el flujo).
- OAuth con permisos DELEGADOS, conexión POR CUENTA (`IntegracionTeams`, una fila por Cuenta). Tokens SIEMPRE cifrados (Fernet con clave derivada de `TEAMS_CLIENT_SECRET`, `services/teams.py`); nunca se exponen por la API. Rotar el secret obliga a reconectar.
- La reunión se crea con `POST /me/events` (`isOnlineMeeting` + `teamsForBusiness`, asistentes = correos de candidato y entrevistador): Graph manda las invitaciones de calendario. Se crea ANTES de guardar la entrevista; si falla → 502 y no se guarda nada (decisión del usuario). Modificar/cancelar sincronizan la reunión best-effort (nunca bloquean).
- Con Teams conectado la UI NO pide la liga en Videollamada; «Usar otra liga» (`usar_teams=false`) es la excepción. No agregar modalidades ni pasos.

## Evaluación del candidato (2026-09-13)

- Prefiltro por WhatsApp = SOLO filtro de entrada: resultado `cumple` | `no_cumple`, sin score. `Postulacion.score` lo escribe únicamente el Análisis de CV. El prefiltro NO participa en la evaluación integral ni en la afinidad.
- Evaluación integral (`ia.evaluar_entrevista`) = Análisis de CV + Entrevista Red Human, nada más. Estructura: Afinidad (`match_perfil`), Fortalezas, Puntos por validar (`riesgos`), Recomendación, `faltante`.
- `/finalizar` valida el transcript antes de evaluar: sin respuestas útiles → `interrumpida` (`motivo=sin_respuestas`); pocas respuestas → `ia.suficiencia_entrevista` decide `parcial` (sin score) o evaluar indicando lo que faltó. Nunca generar score ni recomendar entrevista humana sin entrevista válida; la acción siguiente es «Reintentar Entrevista Red Human» (reabrir).
- La sala pública nunca debe quedar en negro: errores de sesión → fase `cerrada`/`error` con mensaje; fallo del avatar → sesión de texto forzada (`POST /sesion {"modo":"texto"}`); `error.tsx` en la ruta.
- Embudos y contadores por etapa cuentan solo postulaciones activas.

## Correcciones post-demo (2026-09-15)

- Memoria de WhatsApp: en `ETAPAS_CONTEXTO_LARGO` (Entrevista IA → Onboarding) el contexto vive `CONTEXTO_WHATSAPP_HORAS` (120 h); la ventana corta de Modo Prueba solo aplica a Prefiltro. La frialdad se mide sobre la POSTULACIÓN (`webhooks._ultima_actividad`: creación / `ultima_actividad_en` / último mensaje). Pasados los 5 días en Modo Prueba se cierra por `sin_interes`; con Modo Prueba apagado nunca se cierra sola.
- Reagendar: con cita agendada, "reagendar/cambiar/no pude…" o un «Sí» tras el aviso de no-show reabre la agenda en la MISMA postulación (`candidatos._quiere_reagendar` → `_reabrir_agenda`; la cita anterior queda en `analisis.videollamadas_anteriores`). Nunca respuesta fija ni menú.
- No-show: `services/agenda.py` reclama el flag con UPDATE condicional + commit ANTES de enviar y registra `NotificacionEnviada(evento="reagendar_noshow")`; no se repite en 24 h aunque el flag se pierda. El job va con `max_instances=1, coalesce=True`.
- Alta como colaborador: sin NINGÚN documento adjunto → 400 «El expediente no tiene documentos adjuntos», ni con `forzar_prueba`.
- Documentos por WhatsApp: `META_PLANTILLA_DOCUMENTOS` (default `solicitud_documentos_rh`) con variables en el orden de `META_PLANTILLA_DOCUMENTOS_PARAMS` (`nombre,documentos,liga[,empresa,vacante]`); si falla, texto libre. «Solicitar documentos» / «Enviar recordatorio» existen en Contratación y Onboarding. Un `image`/`document` entrante en esas etapas se descarga de Graph (`whatsapp.descargar_media`) y se adjunta al expediente (`contratacion.documento_para_adjunto` + `adjuntar_documento_bytes`, misma validación que la liga pública). Regresión: `scripts/verificar_correcciones_demo.py`.

## Fases 1-3 post-demo (2026-09-15)

- Cuentas: baja lógica (`estado="Eliminada"`, `eliminada_en/por`; `DELETE /cuentas/{id}`, `POST /{id}/restaurar`); nunca la actual ni la última activa. Predeterminada es POR USUARIO (`Usuario.cuenta_predeterminada_id`); `cuenta_actual` sin cabecera cae en ella.
- Cargas masivas: `services/masivo.leer_tabla` (CSV/xlsx, encabezados homologados) + savepoint por fila; los endpoints `/auth/usuarios/masivo`, `/clientes/masivo`, `/plantillas/masivo` reutilizan SIEMPRE la función del alta individual (`crear_usuario_basico`, `_crear_cliente`, `_crear_plantilla`). `GET …/masivo/plantilla` = CSV de ejemplo.
- Entrevista IA interrumpida/parcial: el candidato la reanuda desde WhatsApp (`candidatos._reanudar_entrevista_ia` → `services.entrevistas.reabrir_entrevista`, misma liga) o la reagenda (`_reabrir_agenda`). Una `evaluada` solo la reabre RH.
- Recordatorios automáticos de documentos: `services/recordatorios.py` (cada hora) manda `recordatorio_documentos` cada `ConfiguracionSistema.recordatorio_documentos_dias` desde `recordatorio_documentos_hora` (MX) mientras `Expediente.documentos_hasta` no venza; al vencer, un solo aviso en bitácora. Reclama `ultimo_recordatorio_en` antes de enviar.
- `notificaciones.disparar` sin regla guardada usa `REGLAS_NOTIFICACION_DEFAULT` (eventos automáticos en Cuentas nuevas ya no se quedan mudos).
- `Expediente.progreso` cuenta digitales subidos (`Documento.entregado`); el alta exige confirmación de RH (`sin_confirmar`). Carta de intención con fpdf2 (`services/pdf.py`), no WeasyPrint.
- Fase 4: ubicación de vacante/plantilla estructurada (`ubicacion_estado`, `ubicacion_municipio`, catálogo INEGI en `red-human-app/lib/estados-municipios.json`); `Vacante.ubicacion` (texto) se DERIVA con `models.texto_ubicacion` (texto libre solo para registros previos). Prefiltro por WhatsApp = `preguntas_filtro_whatsapp` (independiente de `preguntas_filtro`, la web); vacío → el agente usa las de la web. El botón «Generar vacante» va al FINAL del formulario (después de Prefiltro y Entrevista). Tableros se revalidan con `lib/use-polling.ts` (`usePolling`), nunca con timers a mano.
