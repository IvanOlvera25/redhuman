# Estado del proyecto Red Human AI

## Reestructuración multi-cuenta en curso
Especificación completa en Otros_cambios_2.docx (29 puntos), dividida en 6 fases por 
dependencia real (cada fase depende de que la anterior esté terminada, salvo E que es 
transversal):
- Fase A: Modelo de Cuenta, Cliente, Usuarios y permisos — COMPLETA Y DESPLEGADA EN
  PRODUCCIÓN (confirmado contra `git log`/`git status`, coincide exactamente con
  `origin/red-human-v2.0`); `migrar_cuentas.py` corrido en producción.
- Fase B: Vacantes (creación, herencia automática de Cuenta/Cliente, plantillas, vista previa) — COMPLETA Y DESPLEGADA EN PRODUCCIÓN.
- Fase C: Vistas de Vacantes/Candidatos (tarjetas/lista, filtros, conteos reales por etapa, navegación desde contadores, lógica de "Apto") — COMPLETA Y DESPLEGADA EN PRODUCCIÓN; incluye script de backfill `backfill_resultado_apto.py`.
- Fase D: Notificaciones configurables por evento/destinatario/canal — CÓDIGO LISTO, sin
  commit/deploy; ver detalle abajo. Falta correr `scripts/sembrar_reglas_notificacion.py`
  en producción tras el deploy (siembra reglas que replican el comportamiento de hoy, cero
  regresión).
- Fase E: Reglas de simplificación (ocultar selectores cuando no aplican, herencia automática, no repetir capturas) — transversal, se verifica en cada fase, no es un entregable aparte
- Fase F: Agente global "Pregunta a Red Human" (consulta/analiza/encuentra/ejecuta sobre 
  todo el sistema) — PENDIENTE, depende de que A-D existan con API consistente

## Reglas de negocio ya definidas para la Fase A (no las vuelvas a preguntar)
- Cuenta = empresa reclutadora: nombre comercial, razón social (opcional), logo, contacto, 
  correo/WhatsApp de comunicación, estatus Activa/Inactiva.
- Cuenta puede tener cero o varios Clientes (empresas para las que recluta).
- Cliente: nombre, estatus, uno o varios contactos (nombre, puesto, correo, teléfono) — 
  los contactos NO son usuarios del sistema.
- Usuario: nombre, correo, teléfono, perfil SOLO "Administrador" o "Usuario" (nada más), 
  Cuenta(s) con acceso, si puede ver a su equipo (Sí/No), a quién reporta, activo/inactivo.
- Visibilidad automática (sin que el usuario configure filtros): Usuario ve solo lo suyo; 
  con "ver equipo" alterna Mío/Mi equipo; Administrador ve todo dentro de sus Cuentas.
- Si un usuario solo tiene acceso a una Cuenta, NO se muestra ningún selector — la 
  interfaz se comporta exactamente como hoy para ese caso.

## Convenciones del proyecto — síguelas siempre, en cualquier fase
- Migraciones de esquema: migraciones.py::sincronizar() agrega columnas nuevas solas vía 
  ALTER TABLE; tablas nuevas se crean solas vía Base.metadata.create_all(). NO se usa 
  Alembic en este proyecto.
- Migraciones de DATOS existentes (no solo esquema): script standalone en scripts/, mismo 
  patrón que scripts/seed_demo_candidatos.py y scripts/migrar_entrevistas_humanas.py — pide 
  confirmación explícita antes de escribir, nunca se ejecuta automáticamente, siempre se le 
  muestra el contenido completo al usuario antes de correrlo.
- Antes de escribir código en cualquier tarea nueva: SIEMPRE investigar primero con el 
  código real y reportar hallazgos, sin tocar nada, hasta que el usuario apruebe 
  explícitamente el plan.
- Antes de aplicar cualquier cambio ya aprobado: mostrar el diff completo, nunca hacer 
  commit ni deploy sin que el usuario lo pida explícitamente.
- Modo Prueba: modo_prueba_activo(db) en services/configuracion.py ya existe — créalo o 
  reutilízalo para poblar/probar el modelo de Cuenta sin afectar datos reales.
- Zona horaria: SQLite pierde el tzinfo al guardar DateTime — cualquier fecha nueva debe 
  normalizarse a UTC explícitamente antes de guardar (ya nos mordió 2 veces en este proyecto).
- El stack es FastAPI + SQLAlchemy (backend) y Next.js (frontend) — red-human-api/ y 
  red-human-app/ respectivamente.

## Cómo continuar si retomas este trabajo en una sesión nueva (otro agente u otra sesión)
1. Lee este archivo completo antes de hacer cualquier cosa.
2. Revisa `git log --oneline -20` para ver qué se ha subido desde la última actualización 
   de este archivo.
3. Continúa exactamente desde la sección "## Lo que sigue" de abajo — no repitas 
   investigación ya hecha, no proponses decisiones ya tomadas en este archivo.
4. Actualiza este archivo al terminar tu parte, antes de que la sesión termine, con lo que 
   hiciste y cuál es el siguiente paso.

## Lo último que se hizo
Hotfix urgente de WhatsApp (2026-09-11, ver sección "Bug urgente WhatsApp" al final): el agente no
respondía al botón "Sí, empezar ahora" de la plantilla de inicio. Código listo, pendiente de
commit/deploy inmediato. Antes: Fase 4 (Entrevista IA) comiteada y desplegada en `8b45d18`
(incluye el hotfix de `entrevistas.py`/`contratacion.py`); Fase 2 (`24acfd7`) y las 5 pantallas de
Configuración (`47a4a8b`) también en producción. Pendientes de Fase 4: spike de Anam y guion de
ejemplo (ver su sección).

## Lo que sigue

### Investigación de Fase A — completada 2026-09-10, código real revisado (no se tocó nada)

**1. Modelos que necesitarían relación con Cuenta** (leído en `red-human-api/app/models.py`):
- `Vacante`: tiene `empresa: String(150)` libre, default `"Grupo Carbe"` (línea 44) — parcial
  pero inútil para filtrar (texto libre, sin FK). El seed usa 3 valores distintos ("Grupo
  Carbe", "Distribuidora Norte", "Retail Bajío") — candidatos naturales a convertirse en Cliente.
- `Candidato`: nada directo, solo hereda `empresa` indirecto vía `vacante_id` (que es
  **nullable** — un candidato puede no tener vacante y entonces no hay cómo resolver su
  Cuenta por herencia). 100% nuevo.
- `Usuario`: nada — `rol` es global (admin/rh/lectura), sin columna ni tabla puente a cuenta.
  100% nuevo. La spec pide "Cuenta(s)" en plural → hace falta tabla puente muchos-a-muchos
  (`usuario_cuentas`).
- `Empleado`, `Requisicion`: nada. 100% nuevo.
- `Colaborador`: `empresa: String(150)` libre, mismo problema que Vacante.
- Entrevista, EntrevistaHumana, Mensaje, Archivo, Expediente, Documento, Curso,
  AsignacionCurso, SugerenciaMovilidad: cuelgan por FK de Candidato/Vacante/Colaborador/
  Requisicion → resuelven Cuenta por relación transitiva, no necesitan columna propia salvo
  que se quiera desnormalizar por performance.
- `ConfiguracionSistema`: fila única global (id=1) — a decidir si sigue global o se vuelve
  por-Cuenta; probablemente fuera del alcance de Fase A.

**2. Auth/sesión** (`deps.py`, `services/auth.py`, `models.py::Usuario/Sesion`):
No existe NINGÚN concepto de "contexto de cuenta" hoy — es 100% nuevo, no hay nada
reutilizable. `deps.py` solo resuelve identidad (`usuario_actual`/`usuario_decisor`/
`usuario_admin`), nunca alcance. `Sesion` solo guarda `usuario_id`, `token_hash`,
`expira_en`. Cambio necesario: tabla puente `usuario_cuentas` + nueva dependencia
`cuenta_actual` en `deps.py` que resuelva qué Cuenta(s) puede ver el usuario (si tiene más
de una, el front debe mandar cuál está usando — vía header/query — ya que "si solo tiene
una Cuenta no hay selector"). Es aditivo, no una reescritura completa.

**3. Migración de datos existentes** (propuesta, sin implementar):
1. Crear una Cuenta default ("Grupo Carbe", el valor ya hardcoded en `Vacante.empresa` y
   en `seed.py`).
2. Asignar esa Cuenta a todas las Vacante/Candidato/Empleado/Colaborador/Requisicion
   existentes.
3. Asignar todos los Usuario existentes a esa Cuenta vía la tabla puente.
4. **Decisión de negocio pendiente, no asumida**: ¿los 3 valores distintos que ya existen
   en `Vacante.empresa` se convierten en Clientes dentro de la Cuenta default, o todo entra
   sin Clientes por ahora?
5. Mismo patrón ya usado en el proyecto: script standalone en `scripts/` (como
   `seed_demo_candidatos.py` / `migrar_entrevistas_humanas.py`), pide confirmación
   explícita, nunca automático, se muestra completo antes de correr.

**4. Impacto en Bitácora**: `registrar()` (models.py:537) calcula el hash sobre
`{ts, actor, accion, entidad, entidad_id, detalle}` — NO incluye columnas como `id`. Agregar
`cuenta_id` como columna nueva vía `migraciones.py::sincronizar()` (ALTER TABLE) NO rompe la
cadena de hashes. Puede esperar (no bloquea el resto de Fase A), pero como es un ALTER TABLE
+ backfill barato, conviene hacerlo en la misma fase si se quiere filtrar la vista de
bitácora por Cuenta.

**5. Dimensión del impacto** — 103 endpoints en 14 archivos de `routers/`, de los cuales
~85-90 dependen hoy de `usuario_actual`/`usuario_admin`/`usuario_decisor` y serían
candidatos a filtrar por Cuenta:
candidatos.py (23), contratacion.py (13), capacitacion.py (12), vacantes.py (11),
requisiciones.py (10), entrevistas.py (9, 5 protegidas — resto públicas por token),
auth.py (8), empleados.py (6), webhooks.py (3, 1 protegida — el webhook de Meta es
público), entrevista_humana.py (2, públicas por token), expediente_publico.py (2, públicas
por token), configuracion.py (2), colaboradores.py (1), metricas.py (1, pero es el que
internamente más cambia porque todos sus conteos son globales hoy). El cambio es mecánico
y repetitivo una vez que exista `cuenta_actual` en `deps.py`, pero toca prácticamente todos
los archivos de routers.

### Decisión de negocio — punto 3.4, confirmada 2026-09-10
Los 3 valores distintos de `Vacante.empresa` en los datos actuales ("Grupo Carbe",
"Distribuidora Norte", "Retail Bajío") se convierten en 3 Clientes reales dentro de la
Cuenta default durante la migración — no entran sin Cliente. Son datos de seed/demo, es el
momento correcto para establecer el patrón real de Cuenta→Cliente desde el inicio.

### Fix de seguridad aplicado — 2026-09-10 (commit `74d71ce`, ya en producción)
`POST /auth/usuarios` (routers/auth.py) había perdido la dependencia de admin y el
registro en bitácora (comentario "MODIFICADO AQUI" en el código, hallado durante la
investigación de Fase A). Se restauró `Depends(usuario_admin)` y
`registrar(db, admin.nombre, "usuario_creado", ...)`. Confirmado y comiteado por el
usuario fuera de esta sesión.

### Diseño de Fase A aprobado e implementado — 2026-09-10

Plan completo guardado por el harness en `C:\Users\chris\.claude\plans\indexed-baking-yeti.md`.
Decisiones de negocio confirmadas (no repetir):
- "Distribuidora Norte" y "Retail Bajío" (valores de `Vacante.empresa`) se migran como
  Clientes reales dentro de la Cuenta default "Grupo Carbe". Las filas con
  `empresa == "Grupo Carbe"` se quedan con `cliente_id = NULL` (la Cuenta recluta para sí
  misma, no es su propio Cliente).
- El rol de solo-lectura desaparece: `ROLES = ("Administrador", "Usuario")`, ambos
  pueden decidir (`puede_decidir()` ahora siempre `True`). Migración de datos:
  `admin → "Administrador"`; `rh`/`lectura → "Usuario"`.

**Implementado (working tree, SIN commit — pendiente de que el usuario lo revise):**

1. `models.py` — 4 tablas nuevas (`Cuenta`, `Cliente`, `ClienteContacto`,
   `UsuarioCuenta`, vía `Base.metadata.create_all()`), `Usuario` gana `ve_equipo` y
   `reporta_a_id` + relationship `cuentas`, `ROLES` colapsa a 2 valores,
   `cuenta_id`/`cliente_id` (nullable) agregados a `Vacante`, `Candidato` (solo
   `cuenta_id`), `Empleado`, `Colaborador`, `Requisicion`; `Bitacora` gana `cuenta_id`
   (confirmado fuera del payload que se hashea en `registrar()`, no rompe la cadena).
   Limpieza de los 3 strings de rol viejos en `deps.py`, `routers/auth.py`,
   `routers/candidatos.py:1211` (se quitó el filtro por rol en la lista de
   entrevistadores — ya no hace falta, ambos perfiles pueden entrevistar) y `seed.py`.
2. `deps.py` — nueva dependencia `cuenta_actual` (cabecera `X-Cuenta-Id` cuando el
   usuario tiene más de una Cuenta; se resuelve sola si solo tiene una).
3. `scripts/migrar_cuentas.py` (nuevo, **NO ejecutado en producción** — lo corre el
   usuario). Verificado por mí en una copia descartable de `redhuman.db` (no la real):
   crea la Cuenta y los 2 Clientes correctos, deja `cliente_id = NULL` en las vacantes de
   "Grupo Carbe", migra roles, es idempotente (segunda corrida no hace nada), 0 filas con
   `cuenta_id` NULL al terminar.
4. Endpoints de ejemplo reescritos con el patrón (`cuenta_actual` + filtro/estampado):
   `GET /candidatos`, `GET /vacantes`, `POST /vacantes`. Probados con `TestClient` contra
   la misma copia descartable ya migrada — mismos conteos que antes (11 candidatos, 6
   vacantes) para un usuario de una sola Cuenta, sin mandar ninguna cabecera nueva.
5. Sin cambios de frontend.

⚠️ **Orden de despliegue obligatorio**: hasta que `scripts/migrar_cuentas.py` corra en
producción, la tabla `usuario_cuentas` está vacía → `cuenta_actual` respondería 403 a
todos. No desplegar los endpoints de ejemplo del punto 4 antes de correr el script.

### Filtrado por Cuenta extendido a TODO el sistema — 2026-09-10

Con el patrón de los 3 endpoints de ejemplo ya aprobado, se aplicó a los ~85-90 endpoints
restantes que dependen de sesión, en los 14 archivos de `routers/`. **Todos los archivos
de routers quedaron migrados a filtrado por Cuenta**: auth.py, candidatos.py,
capacitacion.py, colaboradores.py, configuracion.py, contratacion.py, empleados.py,
entrevista_humana.py*, entrevistas.py, expediente_publico.py*, metricas.py,
requisiciones.py, vacantes.py, webhooks.py.
(*entrevista_humana.py y expediente_publico.py son 100% públicos por token — no
necesitaban tocarse, se confirmó explícitamente que ninguno de sus endpoints depende de
sesión.)

**Sigue sin commit ni deploy — todo en el working tree, pendiente de revisión.**

**Patrón aplicado**: helpers compartidos de lookup por código (`_por_codigo`, `_vacante`,
`_expediente`, `_duplicado`, etc.) ahora exigen `cuenta_id` y filtran por él — cualquier
endpoint que dependa de un helper queda protegido automáticamente. Donde el modelo no
tiene columna `cuenta_id` propia (`Expediente`, `Entrevista`), se resuelve con `JOIN`
contra `Candidato`. Verificado con un script que recorre cada handler con sesión en los 12
archivos y confirma que todos traen `cuenta_actual` en la firma — cero huecos (2 falsos
positivos esperados y confirmados manualmente: `POST /vacantes/generar` no toca la base,
`GET /auth/yo` no consulta nada por Cuenta).

**3 decisiones/ajustes que surgieron durante la implementación (todas ya resueltas con el
usuario, documentadas aquí para no repetir la pregunta):**
1. `Curso` (capacitación) no tenía `cuenta_id` en el diseño original de Fase A porque no
   cuelga de ningún Candidato/Vacante — se agregó la columna a `models.py` y se actualizó
   `migrar_cuentas.py` para estamparla. `AsignacionCurso` se resuelve transitivamente vía
   `Curso.cuenta_id`; además `POST /capacitacion/{codigo}/asignar` ahora valida que el
   Colaborador a asignar sea de la misma Cuenta que el Curso.
2. `POST /auth/usuarios` ahora también crea la fila `usuario_cuentas` del usuario nuevo
   con la Cuenta del admin que lo creó — si no, el usuario nuevo se quedaba sin ninguna
   Cuenta asignada y `cuenta_actual` le daría 403 en su primer login. Verificado con
   TestClient: el usuario nuevo queda vinculado correctamente.
3. El webhook público de WhatsApp (`_buscar_o_crear_candidato` en webhooks.py) no tiene
   sesión ni forma de resolver una Cuenta (un solo WABA para toda la plataforma hoy) — se
   agregó `_cuenta_unica(db)`, que toma la única Cuenta activa (y lanza 500 explícito si
   hay 0 o más de 1, en vez de adivinar). **Pendiente real de Fase D**: ruteo de WhatsApp
   por número/Cuenta cuando haya más de una Cuenta con WhatsApp activo.

**Nota aparte, NO resuelta, fuera de alcance de esta tarea**: `seed.py::sembrar_admin`
crea el primer administrador en una instalación *nueva* (sin datos) antes de que exista
cualquier Cuenta — en una instalación realmente nueva (no el caso de este proyecto, que ya
tiene datos y corre `migrar_cuentas.py`) ese admin quedaría sin Cuenta asignada. Anotado
para cuando se toque el flujo de instalación desde cero.

**Verificación end-to-end realizada** (todo contra una copia descartable de
`redhuman.db`, nunca la real):
- Esquema: `Base.metadata.create_all()` + `migraciones.py::sincronizar()` agregan las
  tablas/columnas nuevas sin errores (incluye la columna nueva de `Curso`).
- `migrar_cuentas.py` corrido dos veces: primera vez migra todo correctamente (2 Clientes,
  0 filas con `cuenta_id` NULL en las 7 tablas tocadas, 3 usuarios reales migrados de rol
  y asignados a la Cuenta); segunda vez es no-op (idempotente).
- 17 endpoints GET probados con `TestClient` (uno por archivo de router, más los 3 de
  ejemplo previos) — los 17 responden 200 con los mismos conteos que antes de migrar.
- 2 endpoints de escritura probados: `POST /vacantes` estampa `cuenta_id`; `POST
  /auth/usuarios` crea el usuario Y su fila en `usuario_cuentas`.

### Bug encontrado y corregido en migrar_cuentas.py — 2026-09-10 (antes de correr en producción)

El usuario, revisando el diff, detectó que la lista de Clientes a crear traía "GROWTIA" y
"Growtia" como 2 entradas separadas. Confirmado: `_nombres_cliente()` agrupaba los valores
de `empresa` en un `set()` de Python después de solo `.strip()` — sin normalizar
mayúsculas ni espacios internos, así que cualquier variante de capitalización/espaciado del
mismo nombre real habría creado un Cliente duplicado.

**Fix aplicado**: nueva función `_normalizar()` (colapsa espacios + `casefold()`) usada
para agrupar — `_agrupar_empresas()` regresa `{clave_normalizada: Counter(variantes)}` y
`_nombres_cliente()` elige como nombre visible la variante más frecuente en los datos
reales (empate → alfabética, determinista). El resumen que imprime el script antes de
pedir confirmación ahora muestra qué variantes se agruparon bajo cada Cliente, p.ej.
`GROWTIA  (agrupa: "GROWTIA"×1, "Growtia"×1, "growtia"×1)`. `_cliente_id()` (la función que
asigna `cliente_id` a cada Vacante/Colaborador) también normaliza antes de buscar, así que
las 3 variantes de un mismo nombre real quedan apuntando al mismo Cliente.

**Verificado con datos sintéticos** (NO se tiene acceso a la base de datos real de
producción desde este entorno — la única `redhuman.db` local disponible aquí es la de
seed/demo, sin "GROWTIA"): se insertaron 3 vacantes de prueba con "GROWTIA"/"Growtia"/
"growtia  " (espacio extra) en una copia descartable, se corrió el script completo, y se
confirmó: 1 solo Cliente creado (no 3), las 3 vacantes de prueba quedaron con el mismo
`cliente_id`. Copia de prueba borrada al terminar.

⚠️ **El usuario todavía debe correr el script corregido contra una copia real de
producción (o revisar la lista impresa en un `--forzar` no confirmado) antes de la
migración real, para ver el resultado con sus datos reales** — lo que se verificó aquí
prueba que la lógica de agrupación funciona, no sustituye ver la lista real.

### Fase A — pendiente de deploy
1. El usuario revisa el diff completo de Fase A (`git diff` — 14 archivos de `routers/` +
   `models.py` + `deps.py` + `seed.py`, y el archivo nuevo `scripts/migrar_cuentas.py`, ya
   con el fix de normalización de nombres) — nada está comiteado todavía.
2. Antes de confirmar la migración real: correr `migrar_cuentas.py` SIN `--forzar` contra
   una copia de la base de producción (o directamente, cancelando en el prompt de
   confirmación) para revisar la lista real de Clientes que se crearían — especialmente
   verificar si hay más agrupaciones por mayúsculas/espacios aparte de GROWTIA.
3. Si aprueba: commit → deploy → correr `migrar_cuentas.py` en producción (con
   confirmación explícita, como siempre). **Orden obligatorio**: el script debe correr
   inmediatamente después del deploy — hasta que corra, `usuario_cuentas` está vacía y
   `cuenta_actual` le da 403 a todo el mundo.

### Fase B — implementada completa (código real, todavía sin commit/deploy) — 2026-09-10

Investigación previa (3 agentes en paralelo, backend + 2 de frontend) confirmó: puntos 8,
10, 11 y 12 eran 100% nuevos (nada que reutilizar salvo `Cuenta.logo`/`nombre_comercial`,
que Fase A dejó listos pero sin usar en ningún lado); punto 9 (herencia automática) ya
funcionaba en su mayor parte gracias a Fase A — solo faltaba resolver el nombre de empresa
candidato-visible en 4 puntos (ver detalle en el plan, `nombre_empresa_candidato`).

Decisiones de negocio confirmadas por el usuario (no volver a preguntar):
- CRUD de Cliente (listar/crear/editar, sin contactos) sí entra en Fase B.
- Cuando `mostrar_cliente_candidato=False` o no hay Cliente: el candidato ve el nombre
  comercial de la Cuenta (`Cuenta.nombre_comercial`), nunca un texto genérico.
- "Evaluaciones" en una Plantilla = solo `preguntas_filtro` (el guion de Entrevista IA
  sigue generándose con IA, no viene de la plantilla).
- Apariencia del Portal (vista previa) = mínimo viable: `Cuenta.logo` +
  `Cuenta.nombre_comercial` en vez del logo fijo de Red Human. Sin sistema de colores nuevo.

**Backend implementado:**
- `models.py`: `Vacante` gana `responsable_id`, `colaboradores_ids` (lista de ids, sin
  tabla puente), `mostrar_cliente_candidato`, `plantilla_id`, y relationships
  `responsable`/`cliente`/`cuenta`. Tabla nueva `Plantilla` (General de la Cuenta o de un
  Cliente específico, nunca ambos — mismos campos reutilizables que Vacante).
- `serial.py`: nueva función `nombre_empresa_candidato(v)` — Cliente si aplica y está
  visible, si no el nombre de la Cuenta. Aplicada en `vacante_dict`, en los call-sites de
  generación de copy IA (`routers/vacantes.py::crear/regenerar`, vía
  `routers/candidatos.py::prefiltro_turno`), en la carta de intención
  (`routers/contratacion.py`) y en `GET /entrevistas/publica/{token}`.
- `routers/vacantes.py`: `CrearIn`/`ActualizarIn` ganan los 5 campos de Fase B con
  validación cruzada de Cuenta (`_validar_relaciones`); nuevo endpoint
  `GET /vacantes/{codigo}/vista-previa` (funciona con la vacante en Borrador — nunca
  obligatoria para publicar); `por_slug`/`listar_publicas` agregan `nombreEmpresa`/`logoUrl`.
- Dos routers nuevos: `routers/clientes.py` (CRUD simple) y `routers/plantillas.py`
  (`GET /plantillas?cliente_id=` regresa las del Cliente primero, luego generales — el
  orden de sugerencia exacto del punto 11; `DELETE` no borra, desactiva).
- Registrados en `main.py`.

**Frontend implementado** (`red-human-app`):
- Fix del bug de roles viejos (`admin`/`rh`/`lectura` → `Administrador`/`Usuario`) en
  `lib/api.ts`, `components/sesion.tsx`, `components/dashboard/shell.tsx` — encontrado
  durante la investigación, corregido como parte de este mismo trabajo por ser mecánico.
- `app/dashboard/vacantes/page.tsx` (el cambio grande): `CrearVacante` gana el paso
  "Crear desde cero | Usar plantilla", selectores de Cliente/Responsable/Colaboradores
  (Cliente oculto por completo si la Cuenta no tiene ninguno), toggle "Mostrar cliente al
  candidato"; nuevo botón "Vista previa" en `DetalleVacante` (Panel nuevo
  `VistaPreviaVacante`); nueva tarjeta editable `RelacionesVacante` en el detalle; botón
  "Guardar este contenido como plantilla reutilizable" en el detalle; panel de gestión
  `GestionPlantillas` (listar/crear/desactivar) accesible desde un botón "Plantillas" en
  el header.
- `app/dashboard/configuracion/page.tsx`: tarjeta nueva de gestión de Clientes
  (listar/crear/activar-desactivar), junto a Modo Prueba.
- `app/aplicar/[slug]/page.tsx` y `app/portal/page.tsx`: usan `nombreEmpresa`/`logoUrl` ya
  resueltos por el backend en vez del `empresa` crudo (quitado el fallback fijo
  `"Grupo Carbe"` del primero).

**Verificación realizada** (todo contra copias descartables, nunca la base real):
- Backend: esquema nuevo aplica limpio (incluida la tabla `plantillas` y las 4 columnas
  nuevas de `Vacante`); suite de `TestClient` cubriendo Clientes (CRUD + duplicado
  case-insensitive), Plantillas (CRUD + orden de sugerencia por Cliente + desactivar),
  Vacantes (crear con Cliente/Responsable/Colaboradores/plantilla, `mostrar_cliente`
  en ambos sentidos, vista previa en Borrador, publicar, `/publicas` y `/slug/{slug}` con
  los campos nuevos) — todo en verde; regresión de los 17 endpoints de Fase A: sin
  cambios.
- Frontend: `tsc --noEmit` limpio, `next build` compila y pasa lint/type-check sin
  errores. Prueba con servidores reales (backend `uvicorn` + frontend `next dev`, ambos
  contra una copia de la base ya migrada): login real funciona, `/vacantes/publicas` y
  `/vacantes/slug/{slug}` regresan `nombreEmpresa`/`logoUrl` correctos a través del
  servidor real (no solo TestClient), todas las páginas tocadas responden 200 (o 307 a
  login cuando no hay sesión, correcto). Servidores y base de prueba ya detenidos/borrados.

### Diseño e Implementación de Fase C completados — 2026-09-10 (CÓDIGO LISTO, sin commit/deploy)

**Alcance ejecutado**:
1. Vistas duales (Tarjetas / Lista) con persistencia en `localStorage` tanto para Vacantes como para Candidatos.
2. Filtros avanzados en backend y frontend (Cliente, Responsable, Área, Ubicación, Fuente, Score CV mín/máx, Resultado Apto, Consentimiento, Duplicados).
3. Navegación directa y resaltado de columnas en el Pipeline de Candidatos (Opción A aprobada) desde contadores del mini-embudo de Vacantes y parámetros de URL (`?vacante=...&etapa=...`).
4. Lógica de "Apto" persistida (`Candidato.resultado_apto`) con la regla "el más reciente gana" (Contratación/Onboarding=True, Entrevista Humana, Entrevista IA, Prefiltro).
5. Registro de `Candidato.ultima_actividad_en` y ordenamiento por actividad reciente.
6. Detección visual y filtro de posibles candidatos duplicados (mismo teléfono normalizado a 10 dígitos o correo).
7. Script standalone de backfill de datos `scripts/backfill_resultado_apto.py` (dry-run primero, confirmación explícita).

**Backend implementado** (`red-human-api`):
- `models.py`: 3 columnas nuevas en `Candidato` (`ultima_actividad_en`, `resultado_apto`) y `Vacante` (`publicada_en`).
- `serial.py`: serialización de los 4 campos nuevos (`publicadaEn` en vacante_dict; `ultimaActividadEn`, `resultadoApto`, `clienteVacante` en candidato_dict).
- `routers/vacantes.py`: filtros de listado (`busqueda`, `cliente_id`, `responsable_id`, `area`, `ubicacion`) y registro de `publicada_en` al publicar.
- `routers/candidatos.py`: filtros adicionales (`fuente`, `cliente_id`, `responsable_id`, `consentimiento`, `apto`, `duplicados`), helpers `_actualizar_ultima_actividad` y `_recalcular_resultado_apto` aplicados en todos los endpoints de transición.
- `routers/entrevista_humana.py`: invocación de actualización de actividad y recálculo de `resultado_apto` al recibir resultado de evaluación pública externa.
- `scripts/backfill_resultado_apto.py`: script de migración para poblar `resultado_apto` y `ultima_actividad_en` en candidatos históricos y `publicada_en` en vacantes publicadas existentes.

**Frontend implementado** (`red-human-app`):
- `lib/data.ts`: tipos actualizados con `publicadaEn`, `ultimaActividadEn`, `resultadoApto`, `clienteVacante`.
- `lib/api.ts`: parámetros de filtro tipados en `fetchVacantes()` y `fetchCandidatos()`.
- `app/dashboard/vacantes/page.tsx`: vista Lista de vacantes (tabla completa), mini-embudo clicable con navegación a Candidatos por etapa, fechas de creación/publicación, filtros avanzados.
- `app/dashboard/candidatos/page.tsx`: vista Lista de candidatos (tabla completa con score, fuente, cliente, apto), pipeline con badge Apto y detección de duplicados, soporte de query params (`?vacante=...&etapa=...`), auto-scroll y enfoque visual de columna etapa, panel de filtros avanzados y ordenamiento dinámico.

**Verificación realizada**:
- Backend: `py_compile` en todos los archivos modificados y scripts sin errores.
- Frontend: `next build` (con `tsc --noEmit` y linting) completado con exit code 0; 19 rutas generadas limpiamente.

### Siguiente paso (histórico, ya completado — ver Fase D abajo)
1. El usuario revisa los cambios de la Fase C.
2. Deploy y corrida de `scripts/backfill_resultado_apto.py` cuando se apruebe.
3. Sigue Fase D: Notificaciones configurables por evento/destinatario/canal.

## Diseño e Implementación de Fase D completados — 2026-09-11 (CÓDIGO LISTO, sin commit/deploy)

**Inventario previo** (reportado y confirmado con el usuario antes de diseñar): 15 puntos de
envío de WhatsApp/correo hardcodeados en 8 archivos, ningún Cliente notificado nunca. Plan
completo aprobado en `plan mode` antes de escribir código; 4 decisiones de negocio
confirmadas por el usuario vía preguntas explícitas (agregar `Usuario.telefono` y
`EntrevistaHumana.whatsapp_externo`; "Candidato apto" = `resultado_apto`→True en cualquier
etapa POSTERIOR al prefiltro; los botones manuales de RH quedan 100% gobernados por la
regla configurada; la siembra inicial replica el comportamiento de hoy, cero regresión).
Decisión ya tomada por el usuario y solo documentada (no se volvió a preguntar): Entrevista
IA agendada/terminada (avatar, Zero-Touch) NO se conecta a los eventos 1/6 — sigue
hardcoded, fuera de configuración, porque toda la familia "agendada/recordatorio/
modificada/cancelada/terminada" es específica del proceso manual de RH (Entrevista
**Humana**), no del flujo automático de un solo paso del avatar.

**Modelo de datos nuevo** (`models.py`):
- `ReglaNotificacion` (`reglas_notificacion`): una fila por `(cuenta_id, evento)`, 6
  booleanos (`candidato_correo/whatsapp`, `entrevistador_correo/whatsapp`,
  `cliente_correo/whatsapp`).
- `NotificacionEnviada` (`notificaciones_enviadas`): bitácora operativa de cada envío
  (distinta de `Bitacora`, que es la cadena hash LFPDPPP).
- `EVENTOS_NOTIFICACION`: los 10 eventos configurables (puntos 22-26).
- Columnas aditivas: `Usuario.telefono`, `EntrevistaHumana.whatsapp_externo`,
  `EntrevistaHumana.cancelada` (no mueve la etapa del candidato automáticamente).

**Servicio central** `app/services/notificaciones.py` (nuevo) — punto único de entrada
`disparar(db, evento, c, actor, eh=None, liga="", extra=None)`: resuelve destinatarios
SIEMPRE desde datos que ya existen (candidato → su ficha; entrevistador → `Usuario` si es
interno o los campos `_externo` de la `EntrevistaHumana` si es externo; Cliente → TODOS los
`ClienteContacto` del Cliente de la vacante, omitido en silencio si la vacante no tiene
Cliente — punto 26), arma el texto (fijo en código, Fase D no incluye editor de
plantillas), envía por cada canal activado en la regla, y deja rastro en
`NotificacionEnviada`. Nunca truena: sin Cuenta/regla/dato de contacto, simplemente omite
ese envío puntual.

**Conexión de los 10 eventos** (reemplazando los 15 puntos de envío ad-hoc):
`candidatos.py::programar_entrevista_humana` → `entrevista_agendada`;
`recordatorio_entrevista_humana` → `recordatorio_entrevista`; nuevo
`PATCH /candidatos/{codigo}/entrevista-humana` → `entrevista_modificada`; nuevo
`POST .../entrevista-humana/cancelar` → `entrevista_cancelada`; nuevo wrapper
`_recalcular_resultado_apto_y_notificar` (dispara solo en la transición a `True`,
excluyendo el prefiltro Zero-Touch) → `candidato_apto`; `marcar_entrevista_humana_realizada`
→ `entrevista_humana_terminada`; `registrar_resultado_entrevista_humana` y
`entrevista_humana.py::enviar_resultado` (liga pública del entrevistador) →
`recomendacion_final`; `contratacion.py::alta` → `contratacion` (se quitó el checkbox
`avisar_whatsapp`, redundante con la regla configurada); `solicitar_documentos` →
`solicitud_documentos`; `recordatorio_documentos` y `contratacion.py::recordatorio` (con su
detalle específico de documentos pendientes/rechazados, vía `extra`) → ambos
`recordatorio_documentos`.

**Router nuevo** `app/routers/notificaciones.py` (solo admin): `GET /notificaciones/reglas`
(siembra perezosa de las 10 filas si faltan, todas apagadas), `PATCH
/notificaciones/reglas/{evento}`, `GET /notificaciones/historial`. Registrado en `main.py`.

**Script de siembra** `scripts/sembrar_reglas_notificacion.py` (nuevo, NO ejecutado —
requiere `--forzar` + confirmación interactiva): siembra las reglas que replican el
comportamiento de hoy por cada Cuenta existente (p. ej. `entrevista_agendada` →
Candidato Correo+WhatsApp y Entrevistador Correo; los 4 eventos que no existían antes de
Fase D y todo lo de Cliente arrancan apagados). Idempotente.

**Frontend**:
- `lib/api.ts`: tipos `ReglaNotificacion`/`EventoNotificacion`, `fetchReglasNotificacion`,
  `actualizarReglaNotificacion`, `modificarEntrevistaHumana`, `cancelarEntrevistaHumana`;
  tipos de retorno de `solicitarDocumentosCandidato`/`recordatorioDocumentosCandidato`/
  `marcarEntrevistaHumanaRealizada`/`recordatorioEntrevistaHumana` actualizados a
  `{ resultados: ResultadoNotificacion[], candidato }` (antes `{ enviado, candidato }`).
- `app/dashboard/configuracion/page.tsx`: nueva tarjeta "Notificaciones" — grilla de 10
  eventos × columnas Candidato/Entrevistador/Cliente (Correo y WhatsApp cada una); las
  columnas de Cliente se ocultan por completo si la Cuenta no tiene ningún Cliente activo.
- `app/dashboard/candidatos/page.tsx`: 2 acciones nuevas en el panel de Entrevista Humana,
  "Modificar" (modal con fecha/modalidad/liga/ubicación/teléfono/comentario) y "Cancelar"
  (confirmación, badge "Cancelada"); campo WhatsApp opcional agregado al formulario de
  entrevistador externo en "Programar entrevista".
- `serial.py`: se agregó `cancelada` a la serialización de `EntrevistaHumana` (faltaba,
  necesario para que el frontend oculte Modificar/Cancelar en una ronda ya cancelada).

**Verificación realizada**:
- Backend: import-check de todos los archivos tocados; `configure_mappers()` OK; script de
  siembra compila (`py_compile`), no se ejecutó. Prueba funcional completa con `TestClient`
  contra una base descartable nueva (nunca `redhuman.db`): los 10 eventos con reglas
  encendidas (verificando que el dato de contacto real llega — `Usuario.correo/telefono`
  para entrevistador interno, `correo_externo`/`whatsapp_externo` para externo,
  `ClienteContacto` para Cliente), el caso "vacante sin Cliente" (cero envíos a Cliente sin
  importar la regla), la transición única de `candidato_apto` (no se repite si ya era
  `True`), los 2 endpoints nuevos (incluyendo 409 al modificar/cancelar una ronda ya
  cancelada o realizada), y reglas apagadas (cero filas nuevas en `NotificacionEnviada`).
  Todo en verde.
- Frontend: `tsc --noEmit` y `next build` limpios (19 rutas). Prueba con servidores reales
  (`uvicorn` + `next dev`, ambos contra una base nueva): login real, páginas
  `/dashboard/configuracion` y `/dashboard/candidatos` responden 200 con sesión, y los
  endpoints `GET/PATCH /notificaciones/reglas` y `GET /notificaciones/historial` responden
  correctamente a través del servidor real (no solo `TestClient`). **Limitación honesta**:
  no se probó el clic-a-clic de la grilla de checkboxes ni de los modales Modificar/
  Cancelar en un navegador real (no hay herramienta de automatización de navegador
  disponible en este entorno) — la cobertura de esa capa es `tsc`/`build` limpios más
  revisión manual del código, no una prueba de interacción real. Servidores y base de
  prueba ya detenidos/borrados.

### Siguiente paso
1. El usuario revisa el código de Fase D (o pide una prueba manual en navegador de la
   grilla de Configuración → Notificaciones y de Modificar/Cancelar en la ficha del
   candidato).
2. Commit y deploy cuando se apruebe, seguido de `scripts/sembrar_reglas_notificacion.py`
   en producción (siembra reglas que replican el comportamiento de hoy, cero regresión).
3. Sigue Fase F: agente global "Pregunta a Red Human" (Fase E es transversal, ya se viene
   verificando en cada fase).

## Puntos 2, 27 y 28 — implementados 2026-09-11 (CÓDIGO LISTO, sin commit/deploy)

### Punto 27 — Selector de Cuenta multi-cuenta

**Backend:**
- `routers/auth.py::usuario_dict()`: ahora incluye `cuentas: [{id, nombreComercial}]` — lista
  de Cuentas activas del usuario. Se lee de la relación `u.cuentas` (lazy load de SQLAlchemy).
- `routers/cuentas.py` (nuevo): `GET /cuentas/actual`, `PATCH /cuentas/actual`,
  `POST /cuentas/actual/logo`. Solo admin. Registra en bitácora.
- `main.py`: registra el nuevo router `cuentas`.

**Frontend:**
- `lib/api.ts`: `headersCuenta()` inyecta `X-Cuenta-Id` en TODAS las peticiones (get y enviar)
  leyendo `localStorage("rh-cuenta-id")`; `UsuarioRH` gana campo `cuentas`.
- `components/sesion.tsx`: `cuentaActualId` (leído de localStorage + validado vs la lista del
  usuario); `cambiarCuenta(id)` persiste en localStorage y navega al Tablero.
- `components/dashboard/shell.tsx`: `SelectorCuenta` en dos variantes (sidebar dentro de
  `TarjetaUsuario`, topbar antes del ThemeToggle) — invisible si el usuario solo tiene 1 Cuenta.

**Regla cumplida**: usuario con 1 Cuenta = ningún selector, interfaz idéntica a hoy.

### Punto 2 — Reorganización de Configuración en 6 secciones

`app/dashboard/configuracion/page.tsx` reorganizado en:
1. **Cuenta y Portal** — formulario editable (nombre_comercial, razón_social, contacto,
   correo, WhatsApp) + upload de logo. Usa `GET/PATCH /cuentas/actual` y `POST /cuentas/actual/logo`.
2. **Usuarios y permisos** — lista de usuarios de la Cuenta; crear/editar inline.
   Usa `GET/POST/PATCH /auth/usuarios` ya existentes.
3. **Clientes y contactos** — tarjeta existente, sin cambio funcional.
4. **Plantillas** — solo un enlace a Vacantes → "Plantillas" (no se duplica la gestión).
5. **Notificaciones** — grilla existente de Fase D, sin cambio funcional.
6. **Modo prueba** — toggle + botón de borrado agrupados juntos.

Toda la funcionalidad existente se preserva sin ningún cambio de comportamiento.

### Punto 28 — Auditoría de simplificación

Estado verificado contra el código real:
- ✅ **Selector de Cuenta**: no aparece si el usuario tiene 1 Cuenta (`cuentas.length <= 1`).
- ✅ **Selector de Cliente en Vacantes/Candidatos**: oculto con `{clientes.length > 0 && ...}`
  en `vacantes/page.tsx` líneas 308, 790, 859 — correcto.
- ✅ **Selector de Cliente en Notificaciones**: columnas de Cliente ocultas con
  `{hayClienteActivo && ...}` — correcto.
- ⚠️ **Datos demo hardcodeados en shell.tsx**: los badges de nav (Vacantes "24", Candidatos
  "1.8k", Entrevistas "12", Onboarding "3") son valores estáticos de demostración. No son
  funcionales pero tampoco bloquean ningún flujo — son estética de demo, no filtros. Pendiente
  de conectar a datos reales en Fase F o cuando se construya la API de conteos de tablero.
- ✅ **"Grupo Carbe" en data.ts**: solo en los datos de ejemplo del array `vacantes[]` y
  `candidatos[]`, que son datos de fallback cuando la API no responde. No se muestra a
  producción si la API está activa.
- ✅ **"Grupo Carbe" en configuracion/page.tsx**: es solo el `placeholder` del campo
  nombre_comercial — texto de ayuda, no un valor por defecto real.
- ✅ **Herencia automática de Cuenta**: `cuenta_actual` en `deps.py` la inyecta automáticamente
  en todos los endpoints — no se pide al usuario.
- ✅ **No repetición de captura**: nombre de empresa candidato-visible se resuelve en el backend
  (`nombre_empresa_candidato(v)`) — el frontend no captura ese campo.
- ✅ **Vista previa no obligatoria**: solo un botón opcional en DetalleVacante, no bloquea publicar.
- ✅ **Opcionalidad de plantillas**: creación de vacante desde cero funciona sin plantilla.

**Único pendiente real de simplificación** (fuera del alcance de esta sesión):
Conectar los badges de nav a datos reales de la API en vez de valores hardcoded. Se anota
aquí pero no se toca ahora porque requiere un endpoint nuevo de conteos que no forma parte
de ninguna fase actualmente planeada.

### Verificación realizada (2026-09-11)
- Backend: `py_compile` en `auth.py`, `cuentas.py`, `main.py` — exit code 0, sin errores.
- Frontend: `tsc --noEmit` — exit code 0, sin errores de tipo.
- Frontend: `next build` — exit code 0, 19 rutas generadas (mismas que antes + tamaño
  esperable: `configuracion` subió de ~3 kB a ~8.9 kB por las 2 secciones nuevas).

### Siguiente paso (histórico — ver Fase F abajo)
1. El usuario revisa los cambios de los Puntos 2 y 27 (especialmente probar el selector de
   Cuenta si existe más de una en el entorno de prueba).
2. Commit y deploy cuando se apruebe.
3. El único punto técnico pendiente de limpieza es conectar los badges de navegación
   (Vacantes/Candidatos/Entrevistas/Onboarding) a conteos reales de la API — anotado como
   deuda técnica, no es urgente para operación.

## Fase F — Agente global "Pregunta a Red Human" completada — 2026-09-11 (CÓDIGO LISTO, sin commit/deploy)

Punto 29, la pieza más grande de la reestructuración. Investigación + arquitectura propuesta
y aprobada primero (sin código), luego plan de implementación completo aprobado en plan mode,
luego construida. Ver el hilo de la sesión para el reporte de investigación completo
(inventario de funciones por módulo, hallazgo de que `Usuario.ve_equipo`/`reporta_a_id`
existen como columnas pero no se aplican en ningún query real) y las 7 decisiones de negocio
(Q1-Q7) confirmadas por el usuario antes de planear.

**Decisiones de negocio confirmadas (no volver a preguntar):**
1. Visibilidad: el agente hereda el alcance real de hoy (toda la Cuenta activa vía
   `cuenta_actual`), SIN filtrar por responsable/equipo — ver deuda técnica abajo.
2. "Consulta global" = sumar entre las Cuentas a las que el usuario YA tiene acceso, con
   toggle explícito `alcance: "cuenta" | "todas_mis_cuentas"` — nunca cruza a una Cuenta ajena.
3. Sin mecanismo de envío a un destinatario específico: el agente respeta el mecanismo de
   Fase D tal cual (dispara el evento completo según la regla configurada; si el destinatario
   pedido no está activado, se lo explica al usuario).
4. Toda tool de búsqueda regresa conteo total + muestra de 10 (`MUESTRA_MAXIMA`) + navegación
   "Ver todos", nunca vuelca una tabla completa al modelo.
5. Desambiguación obligatoria si una búsqueda matchea 2+ entidades — nunca adivina.
6. El texto de la conversación NO se persiste en el backend (privacidad) — vive solo en
   memoria de React (`ProveedorAgente`), se pierde al recargar. Las ACCIONES ejecutadas sí
   quedan en la bitácora de siempre (`registrar()`), igual que si se hubiera usado el botón.
7. Tope diario de mensajes por usuario desde el arranque (`UsoAgente`, 60/día por defecto,
   `config.py::agente_limite_mensajes_dia`).

**Arquitectura implementada:**
- `app/services/agente.py` (nuevo): catálogo de ~22 tools de LECTURA + ~30 de ESCRITURA, cada
  una un wrapper delgado que llama EN PROCESO la misma función del router correspondiente
  (`candidatos.listar`, `vacantes.crear`, `contratacion.alta`, etc. — los decoradores
  `@router.get/post/patch` no envuelven la función, se pueden llamar directo pasando
  `db`/`u`/`cuenta` ya resueltos). Cero base de datos ni lógica de negocio paralela.
- Separación dura lectura/escritura: el modelo ejecuta tools de lectura directo, pero las de
  escritura NUNCA se ejecutan dentro del loop — en cuanto el modelo pide una, se corta, se
  arma `accionPropuesta` con un resumen determinista (Python, no texto libre del modelo) y se
  regresa sin tocar la base. Solo `POST /agente/ejecutar` (un clic real de "Confirmar" en el
  panel) ejecuta de verdad, revalidando el permiso del tool server-side.
- Contexto "dónde está parado el usuario": como Vacantes/Candidatos manejan la selección con
  estado de React local (no rutas `/vacantes/[codigo]`), se agregó el hook
  `useAnunciarContextoAgente` que cada página llama cuando cambia su selección; el backend
  prerresuelve esa ficha completa y la mete al system prompt antes de la primera ronda.
- `models.py::UsoAgente` — única tabla nueva, un contador `(usuario_id, fecha) -> mensajes`,
  nunca guarda texto.
- `candidatos.py::listar()` ganó el filtro `nombre` (LIKE, mismo patrón que `busqueda` de
  vacantes) — necesario para resolver nombres propios en lenguaje natural.
- Router nuevo `app/routers/agente.py`: `POST /agente/preguntar`, `POST /agente/ejecutar`,
  `GET /agente/uso`. Registrado en `main.py`.
- Frontend: `components/dashboard/agente/` (nuevo) — `proveedor.tsx` (Context con la
  conversación en memoria + `useAnunciarContextoAgente`), `barra.tsx` (botón "✨ Pregunta a
  Red Human…" en el topbar, sustituye el buscador decorativo), `panel.tsx` (panel lateral con
  mensajes, tarjetas de acción con Confirmar/Cancelar, navegación, chips contextuales por
  pantalla). Montado en `app/dashboard/layout.tsx` (`ProveedorAgente`) y `shell.tsx`
  (`BarraAgente`/`PanelAgente`) — NO es un módulo aparte, vive en todas las pantallas del
  dashboard. `lib/api.ts`: tipos + `preguntarAgente`/`ejecutarAccionAgente`/`fetchUsoAgente`.

**Bug real encontrado y corregido durante la verificación con el modelo real** (importante,
documentado para no repetirlo en tools futuras): al principio, los parámetros opcionales de
las tools de lectura usaban JSON `"type": "boolean"`/`"string"` simple. El modelo real
(`gpt-5.6-luna`) rellenaba TODOS los parámetros opcionales con valores de relleno (`""`, `0`,
`false`) en vez de omitirlos — y esos valores de relleno SÍ filtraban de verdad (ej.
`consentimiento=false` enviado sin que el usuario preguntara nada de consentimiento escondía
candidatos reales; `cliente_id=0` devolvía 0 resultados siempre). Solución aplicada: todas las
tools de LECTURA ahora usan JSON Schema "strict" real de OpenAI — tipos nullable
(`["string","null"]` etc.) + `required` listando TODAS las propiedades + `"strict": true` —
así el modelo manda `null` explícito cuando un filtro no aplica, en vez de inventar un valor.
Los 3 filtros tri-estado más riesgosos (`consentimiento`/`apto`/`duplicados` en
`buscar_candidatos`, `activo` en `listar_colaboradores`) además se expusieron como enum
`"si"/"no"` en vez de booleano puro, con un traductor `_si_no()` del lado del servidor. Las
tools de ESCRITURA no se tocaron con este mismo rigor porque tienen la confirmación humana
como red de seguridad (un argumento de relleno ahí como mucho ensucia el resumen visible antes
de confirmar, nunca esconde resultados en silencio).

**Verificación realizada:**
- Backend: import-check completo, `configure_mappers()` OK. Suite determinista con
  `TestClient` contra una base descartable (con `OPENAI_API_KEY` forzada a vacío para no
  gastar llamadas reales en la regresión automática): las 22 tools de lectura ejecutan sin
  excepción, el filtro `nombre` nuevo funciona, `pipeline_cuenta` coincide exactamente con
  `GET /metricas/pipeline` (misma fuente, cero conteos paralelos), muestra representativa de
  escrituras por módulo (candidatos, vacantes, clientes, requisiciones, notificaciones) vía
  `POST /agente/ejecutar` real, permisos (`usuario_decisor` vs `usuario_admin`, revalidados
  server-side, 403 si se intenta saltar), `/agente/preguntar` en modo demo NUNCA muta la base,
  límite diario dispara 429 al superarse, `alcance=todas_mis_cuentas` nunca mezcla una Cuenta
  ajena. Todo en verde.
- **Pasada manual deliberada con el modelo real** (única vez que se gastaron llamadas reales
  a OpenAI, a propósito, fuera de la suite automática): los 4 verbos del punto 29 probados
  literalmente contra una base de prueba (despacho legal demo, vacante "Abogado Corporativo"
  con candidatos aptos/no aptos, dos candidatos llamados "Jorge") — Consultar ("¿cuántos
  candidatos aptos...?") contó correcto: 2; Encontrar ("vacantes sin candidatos") encontró la
  única vacante vacía; Analizar ("¿por qué no avanzan?") dio una respuesta con evidencia real
  citando score y motivo de descarte de cada candidato; Ejecutar ("agenda entrevista con
  Jorge...") desambiguó correctamente entre los 2 Jorges y pidió los datos faltantes (modalidad,
  entrevistador) antes de proponer nada — nunca adivinó. También se probó el comportamiento
  contextual (pregunta "¿quién es el mejor candidato?" con el contexto de una vacante ya
  prerresuelto, sin volver a preguntar) y el caso Q3 (pedir un recordatorio dirigido solo al
  entrevistador: el agente explicó la limitación real del mecanismo en vez de inventar un
  atajo). Esta pasada fue la que encontró y permitió corregir el bug de "strict mode" descrito
  arriba.
- Frontend: `tsc --noEmit` y `next build` limpios (19 rutas, mismas de antes). Prueba con
  servidores reales (`uvicorn` + `next dev` contra una base nueva): login real, las 4 páginas
  tocadas (`/dashboard`, `/vacantes`, `/candidatos`, `/configuracion`) responden 200 con
  sesión y compilan sin error en el log del dev server, `GET /agente/uso` y
  `POST /agente/preguntar` responden correctamente a través del servidor real. **Limitación
  honesta** (igual que en fases anteriores): no hay navegador real disponible en este entorno
  para probar clic-a-clic del panel (abrir/cerrar, mandar un mensaje desde la UI, confirmar
  una tarjeta de acción) — esa capa se cubre con `tsc`/`build` limpios, el smoke test de
  servidores reales, y la pasada manual del backend con el modelo real ya descrita arriba.
  Servidores y bases de prueba ya detenidos/borrados.

### Deuda técnica documentada — "Mío/Mi equipo" nunca implementado (decisión Q1)

`Usuario.ve_equipo` y `Usuario.reporta_a_id` existen como columnas desde Fase A pero **no se
leen en ningún query de ningún router** — hoy cualquier Usuario de una Cuenta ve todos los
candidatos/vacantes de esa Cuenta, sin importar quién es el responsable o si "ve equipo" está
activo. El agente de Fase F hereda ese mismo alcance real (decisión Q1: no construir una
lógica de visibilidad nueva que nunca existió). Igual que los badges de nav del punto 28, esto
queda anotado como un ticket aparte — implementar "Mío/Mi equipo" de verdad en los endpoints
de lectura (mínimo candidatos/vacantes) es trabajo nuevo, no reparación de Fase F.

### Siguiente paso (histórico — Fase D/F y Puntos 2/27/28 ya se comitearon y desplegaron,
### confirmado contra `git log`/`git status` al arrancar la siguiente sesión de trabajo)
1. ~~El usuario revisa el código de Fase F~~ — hecho, comiteado (`5e176a5` y anteriores) y en
   producción junto con Fase D y los Puntos 2/27/28.
2. Correr `scripts/sembrar_reglas_notificacion.py` en producción sigue pendiente (Fase D, sin
   relación con Fase F) — verificar con el usuario si ya se corrió.
3. Fase E (simplificación) es transversal y ya se viene verificando en cada fase — no queda
   ningún entregable aparte pendiente salvo la deuda técnica de "Mío/Mi equipo" anotada arriba.

## 6 correcciones de UI y datos reportadas por Raúl — completadas 2026-09-11 (CÓDIGO LISTO, sin commit/deploy)

Con A-F ya en producción, Raúl reportó 6 problemas puntuales sobre la ficha de candidato y
vacantes. Investigación completa contra el código real (yo directo + 2 forks en paralelo para
los puntos 1 y 4) antes de proponer nada; plan completo aprobado en plan mode. **Ninguno tocó
`models.py` ni `migraciones.py`** — cero cambios de esquema, tal como pidió el usuario
explícitamente; toda la información nueva vive en las columnas `JSON` que ya existían
(`Candidato.analisis`, `cv_datos`, `Archivo.extraccion`).

**Decisiones de negocio confirmadas por el usuario (no volver a preguntar):**
1. "Afinidad" y "Recomendación de Red Human" (síntesis de CV+Prefiltro+Entrevista IA+Entrevista
   Humana) se calculan con una función determinista en Python, **sin ninguna llamada nueva a
   IA** — se recalcula al vuelo en cada lectura, nunca se persiste.
2. El hallazgo de que WhatsApp nunca descarga archivos adjuntos (un CV mandado por WhatsApp
   como documento se pierde en silencio) **queda fuera de este lote**, documentado como deuda
   técnica aparte (ver abajo) — es una integración nueva, no un ajuste de UI/datos.

**Punto 1 — Botón "Publicar" no reflejaba el estado**: el bloque "Distribuir en/Regenerar/
Publicar" en `vacantes/page.tsx::DetalleVacante` no chequeaba `v.estado` — se mostraba
accionable aunque la vacante ya estuviera Publicada. Fix: se oculta por completo cuando
`estado === "Publicada"` o `"Cerrada"`, mostrando un indicador no-accionable "Publicada ✓"; el
toggle "Cerrar/Reabrir vacante" que ya existía (y ya reactivaba correctamente el flujo de
Publicar al reabrir) no se tocó.

**Punto 2 — "N/D" en análisis de CV pese a tener CV cargado**: 3 causas reales, las 3
corregidas:
- El "N/D" era un fallback de `serial.py` (`c.experiencia or "N/D"`) leakeando a la ficha —
  la nueva pestaña Resumen (Punto 3) ya no lee ese campo, usa `cv_datos` directo.
- **Bug real de pérdida de datos**: `_aplicar_cv()` reemplazaba `c.analisis` completo en vez
  de hacer merge — reprocesar un CV borraba `respuestas_prefiltro` ya guardadas. Corregido con
  el mismo patrón de merge que ya usaba el código del prefiltro.
- **No había forma de reintentar un análisis fallido**: `_procesar_cv` llamaba a la IA antes
  de guardar el `Archivo` — si fallaba, se perdía el archivo. Ahora el archivo SIEMPRE se
  guarda (con nota de error si la IA falló) y hay un endpoint nuevo
  `POST /candidatos/{codigo}/archivos/{archivo_id}/reanalizar` (botón "Reintentar análisis")
  que relee el archivo de disco sin pedirle al usuario que lo vuelva a subir.
- `ia.py::CVExtraido` ganó 3 campos (`resumen_profesional` 3-5 líneas, `experiencia_relevante`,
  `conocimientos_relevantes`) que antes no existían y que el Punto 3.B necesitaba.
- Estados en la ficha (sin CV / analizando / error+reintentar / analizado) se derivan en el
  frontend de si hay un `Archivo` tipo=cv y si `cvDatos` trae señales reales — sin columna de
  estado nueva.

**Punto 3 — Rediseño completo de la pestaña "Resumen"** (el cambio más grande): reemplaza por
completo `PestanaResumen` en `candidatos/page.tsx` con las 7 secciones A-G pedidas (Datos
principales, Perfil extraído del CV, Prefiltro con conteo de criterios, Afinidad con la
vacante, Fortalezas principales, Puntos por validar, Recomendación de Red Human destacada).
Nuevo helper `serial.py::_sintesis_global(c)` (llamado solo en `candidato_dict(detalle=True)`)
calcula `prefiltroResumen`, `afinidadGlobal`, `sintesisAfinidad`, `fortalezasPrincipales`,
`puntosPorValidar`, `recomendacionRedHuman`, `recomendacionMotivo` — todo determinista,
documentado con su fórmula exacta:
- **Afinidad**: `c.score` (CV/Prefiltro) solo; promediado con el match de Entrevista IA si la
  hay; ajustado 50/50 hacia 100 o hacia 0 según el resultado de Entrevista Humana si la hay
  (la señal más autoritativa). Cada fuente usada se cita en `sintesisAfinidad`.
- **Recomendación**: reusa el "más reciente gana" de `resultado_apto` (Fase C/D) — `False` en
  cualquier etapa posterior al prefiltro o `recomendacion == "no_avanzar"` → "No avanzar";
  `resultado_apto` True + Entrevista Humana aprobada + "avanzar" → "Avanzar a contratación";
  compatible pero sin Entrevista Humana completa (o "segunda_entrevista") → "Realizar
  entrevista humana"; aún en Prefiltro → sin recomendación.
- **Fortalezas/Puntos por validar**: unión deduplicada (máx. 4) de lo que cada etapa YA
  calificó (`requisitos_cumplidos`/`brechas` del CV, criterios cumple/no-cumple del prefiltro,
  `fortalezas`/`riesgos` de la Entrevista IA) — prioridad a la señal más reciente.
La pestaña Evaluaciones no se tocó (ya cumplía el rol de "análisis detallado") — Resumen solo
la referencia con "Ver detalle en Evaluaciones →", nunca duplica un bloque completo. El
indicador `EstadoBadge` del header del modal ahora antepone "Prefiltro: " (nuevo prop
`prefijo`, opcional, no afecta los otros 2 usos compactos del componente).

**Punto 4 — Contraste de chips**: causa raíz encontrada por el fork — `--brand-ink: #ffffff`
(blanco fijo) combinado a mano con `bg-brand-soft/40` (rosa casi blanco en tema claro) en 2
chips ad-hoc de Habilidades que no usaban el componente `Badge` ya existente y correcto
(`components/ui.tsx::toneMap`, `bg-{tono}-soft` + `text-{tono}`, usado en toda la plataforma
sin este problema). Corregidos los 2 únicos casos reales:
`candidatos/page.tsx` (CV y documentos) y `onboarding/page.tsx` (duplicado ahí).

**Punto 5 — El CV debe alimentar la evaluación**: confirmado que
`ia.py::evaluar_entrevista()` (Entrevista IA/avatar) ya recibía solo `titulo, requisitos,
transcript` — nunca CV — no se tocó. Lo que faltaba (afinidad/recomendación integrando todas
las fuentes con origen identificable) es exactamente `_sintesis_global()` del Punto 3, mismo
trabajo. "Recalcular cuando el CV se carga después" se cumple gratis: nada se persiste, cada
lectura recalcula con los datos más recientes.

**Punto 6 — Overflow**: los únicos 2 `truncate` problemáticos reales (puesto/empresa-periodo
en la Resumen vieja) quedaron reemplazados de raíz por el rediseño del Punto 3, construido sin
`truncate` ni alturas fijas desde el inicio (`break-words`, `whitespace-pre-wrap`, contenedores
que crecen con el contenido).

### Deuda técnica documentada — CVs recibidos por WhatsApp se pierden en silencio

`services/whatsapp.py::parsear_webhook`/`_texto_de_meta` nunca descargan archivos adjuntos —
un documento/CV mandado por WhatsApp se reduce a su caption (si tiene) y el archivo real nunca
se guarda ni se analiza; no hay ninguna referencia a `media_id`/descarga de medios en todo el
backend. Decisión explícita del usuario: fuera del lote de estas 6 correcciones (es una
integración nueva — descarga de media vía Graph API de Meta —, no un ajuste de UI/datos).
Pendiente como ticket aparte.

### Verificación realizada (2026-09-11)
- Backend: import-check de los 3 archivos tocados (`ia.py`, `candidatos.py`, `serial.py`).
  `TestClient` contra una base descartable (con `OPENAI_API_KEY` forzada a vacío en la
  regresión automática): merge de `analisis` ya no borra `respuestas_prefiltro` al reprocesar
  un CV; `_procesar_cv` guarda el `Archivo` aunque `ia.extraer_cv` truene (mockeado); el
  endpoint de reanálisis relee el archivo de disco y actualiza `cvDatos`; los 3 campos nuevos
  de `CVExtraido` llegan hasta la respuesta; `_sintesis_global` probado con las 4
  combinaciones de señales (solo CV, +Entrevista IA, +Entrevista Humana aprobada, +Entrevista
  Humana no aprobada) confirmando que `afinidadGlobal`/`recomendacionRedHuman` dan el valor
  esperado en cada caso; regresión de `POST /vacantes/{codigo}/publicar` sin cambios. Todo en
  verde.
- Frontend: `tsc --noEmit` y `next build` limpios (19 rutas). Prueba con servidores reales
  (`uvicorn`+`next dev` contra una base nueva): login real, las 4 páginas tocadas responden
  200; se subió un CV real a través del servidor real y se confirmó en la respuesta que
  `respuestas_prefiltro` sobrevive, los 3 campos nuevos de `cvDatos` llegan, y
  `prefiltroResumen`/`afinidadGlobal`/`sintesisAfinidad`/`fortalezasPrincipales`/
  `puntosPorValidar` se calculan correctamente; el endpoint de reanálisis respondió 200; la
  vacante sembrada como "Publicada" se confirmó con ese estado vía `GET /vacantes/{codigo}`.
  **Limitación honesta** (igual que en fases anteriores): sin navegador real disponible en
  este entorno, no se probó clic-a-clic del botón "Publicar"/"Reintentar análisis" ni el
  contraste visual de los chips en ambos temas — esa capa se cubre con `tsc`/`build` limpios,
  el smoke test de servidores reales, y la revisión manual del código (incluida la cita exacta
  de la causa raíz de cada punto). Servidores y base de prueba ya detenidos/borrados.

### Fórmula de Afinidad/Recomendación (Punto 3.D/3.G) — APROBADA explícitamente por el
### usuario, 2026-09-11, con ejemplos numéricos — no volver a preguntar ni resimular

Se le presentó la fórmula exacta de `_sintesis_global()` más 3 ejemplos numéricos paso a paso
(solo Prefiltro; Prefiltro+Entrevista IA; las 3 fuentes con Entrevista Humana aprobada) y una
pregunta explícita sobre el peso de la Entrevista Humana en el promedio acumulado (~50% del
acumulado en cada paso, no 33% parejo entre las 3 fuentes). **Confirmó tal cual está
implementada, sin cambios**: el peso ~50% de la Entrevista Humana es intencional y coherente
con el principio de human-in-the-loop que ya rige el resto del sistema (LFPDPPP, decisiones
firmadas por una persona) — una persona real evaluando debe pesar más que el análisis
automático de CV o de la Entrevista IA/avatar. Código de `serial.py::_sintesis_global` sigue
exactamente como se implementó, cero cambios derivados de esta conversación.

### Siguiente paso
1. El usuario, si puede, prueba en navegador: publicar una vacante y ver el botón cambiar de
   estado; subir un CV y ver la nueva pestaña Resumen; el contraste del chip de Habilidades en
   tema claro y oscuro. La fórmula de Afinidad/Recomendación ya no requiere revisión — aprobada.
2. Commit y deploy cuando se apruebe.
3. Decidir si el hallazgo de CVs por WhatsApp entra a un backlog formal (ya documentado arriba
   con el diagnóstico completo, listo para investigar-planear cuando se priorice).



## Fase 2 — Candidato (persona) / Postulación (proceso) — CERRADA 2026-09-11 (comiteada `24acfd7` y desplegada)

### Qué pasó
Un agente anterior (Gemini 3.7 Flash) dejó la Fase 2 a medias y con 7 errores que rompían en
runtime (columna `es_prueba` pisada por una `@property`, 8 endpoints serializando una
`Postulacion` con `candidato_dict`, etapa `"Nuevo"` invisible en el Kanban, colisión de
códigos `P-`, expedientes que perdían `candidato_id`, job de no-show y liga del entrevistador
escribiendo en la persona en vez de la postulación) y una regla de WhatsApp inventada y no
aplicada ("solo una activa, tomar la más reciente"). Se auditó, se reescribió la capa
completa sobre `Postulacion` como única fuente de verdad y se verificó de punta a punta.

### Estado final (comiteado en `24acfd7`, 27 archivos)
- `models.py`: `Candidato` = persona (identidad + `postulacion_conversacion_id`); sus columnas
  de proceso quedan como LEGADO solo para la migración. `Postulacion` = proceso (etapa, estado,
  score, chat, entrevistas, expediente, consentimiento, videollamada) con `activa`,
  `motivo_cierre`, `cerrada_en`, `origen`, `espera_respuesta`, `cerrar()`.
- `routers/candidatos.py` reescrito: `_por_codigo` → siempre `Postulacion` (acepta `C-####`);
  `crear_postulacion` / `postulacion_para_vacante` únicos puntos de creación; `guardar_mensaje`
  único punto de escritura de mensajes; endpoint `/reiniciar` (Punto 8) reemplaza a
  `/liberar-telefono`.
- `routers/webhooks.py` reescrito con ruteo por contexto de conversación (docstring del módulo).
- `serial.py`: `postulacion_dict` (tarjeta), `candidato_dict` (persona), `entrevista_dict` /
  `expediente_dict` con `candidatoId` = código `P-` (lo que se manda a `/candidatos/{codigo}`).
- `migraciones.py::migrar_postulaciones` + `scripts/migrar_postulaciones.py` (idempotente,
  probado 2 veces contra copia de la base real: 11 postulaciones, 6 mensajes, 4 expedientes).
- `main.py`: la API **se niega a arrancar** si hay candidatos sin postulación.
- Frontend: `reiniciarPostulacionPrueba`, tipos, chips "Cerrada"/"En chat"/código de persona,
  historial de postulaciones en la pestaña Resumen, toggle "Mostrar cerradas".
- `scripts/verificar_fase2.py`: 56 comprobaciones en verde (modo demo, base desechable).
- `CLAUDE.md`: sección "Fase 2" con las reglas para futuros agentes.

### Decisiones de negocio — TODAS cerradas, ninguna pendiente de aprobación del usuario

**A. Decididas por el usuario (no volver a preguntar):**
- P4 Kanban: una tarjeta por Postulación.
- P5 Expediente: pertenece a la Postulación (una persona puede tener varios en el tiempo).
- P1 Ruteo WhatsApp: "contexto de conversación + preguntar" — sí hay postulaciones
  simultáneas; el puntero `postulacion_conversacion_id` decide; con ambigüedad el agente
  manda lista interactiva con SUS vacantes en curso y nunca adivina.
- Reaplicar: activa para esa vacante → se reutiliza; cerrada (descartado / contratado /
  reinicio_prueba) → postulación nueva, la vieja queda como historial.
- Migración: los candidatos sin vacante también reciben postulación (sin vacante).
- Consentimiento WhatsApp: elegir vacante del menú NUNCA es consentimiento; siempre aviso de
  privacidad + "Sí"/"Acepto" explícito (palabra completa, `_es_aceptacion`) antes del prefiltro.
  Excepción aceptada: si la postulación ya tenía consentimiento por otro medio (RH, `/aplicar`)
  no se vuelve a pedir.
- B1 (corregido a petición del usuario): el puntero de conversación lo mueve SOLO el candidato
  (mensaje entrante enrutado o selección explícita en la lista); un mensaje saliente/proactivo
  de RH o del sistema (plantilla de inicio, aviso de apto, recordatorio, notificación) NUNCA
  lo mueve. `reiniciar` tampoco lo fija: el webhook enruta el siguiente mensaje a la nueva.
- B4 (corregido a petición del usuario): `GET /candidatos` regresa solo activas por defecto;
  toggle "Mostrar cerradas" (`mostrar_cerradas=true`) o filtro `activa=` explícito.

**B. Decididas por el agente (Claude) y presentadas al usuario; aceptadas sin cambios:**
- B2 `descartar` cierra la postulación (`motivo="descartado"`); el `no_cumple` de la IA NO la
  cierra (LFPDPPP: solo RH cierra); mover de etapa una cerrada la reabre.
- B3 Alta de colaborador cierra la postulación como `contratado`.
- B5 Consentimiento es por postulación, no por persona.
- B6 `asignar` (reasignar vacante) modifica la misma postulación; 409 si ya hay activa para la
  vacante destino.
- B7 Modo Prueba con conversación fría (60 min): se reutiliza la persona, se cierra la
  postulación (`prueba_expirada`) y se abre una sin vacante; `reiniciar` exige Modo Prueba.

**C. Decisiones de implementación (agente), aceptadas:**
- C1 Archivos/CV son de la persona; el score del CV se calcula para la postulación procesada.
- C2 `ingresar` y carga masiva de CV sin vacante crean postulación sin vacante.
- C3 `id`/`candidatoId` en la API = `P-####`; `C-####` se acepta y resuelve a conversación →
  última activa → última.
- C4 Bitácora: eventos de proceso con `entidad="postulacion"`; persona en `detalle`.
- C5 Migración manual (script con confirmación) — y la API se niega a arrancar sin ella.
- C6 Migración liga huérfanos (mensajes/entrevistas/expediente) a la postulación inicial y fija
  ahí el puntero de conversación.
- C7 Métricas cuentan postulaciones; "por fuente" usa la fuente de la persona.
- C8 Filtro "duplicados" = personas duplicadas (2 postulaciones de la misma persona NO lo son).
- C9 Liga pública del entrevistador sin postulación → 409 "corre la migración".
- C10 Lista "¿sobre cuál vacante?": máx. 10, solo las que esperan respuesta, ids `P-####`.
- C11 Se eliminaron los fallbacks "si no hay postulaciones, lee candidatos" y el
  `verificar_multi_postulacion.py` del agente anterior.
- C12 Herramientas del agente "Pregunta a Red Human" piden `P-####`.
- C13 `Postulacion.espera_respuesta`: Prefiltro sin terminar, Entrevista IA apta sin cita, u
  Onboarding; Evaluación / Entrevista Humana / Contratación no esperan chat (RH tiene el control).

### Garantía de despliegue (punto 3 del cierre)
No existe camino por el que el código nuevo sirva peticiones sobre una base sin migrar:
`main.py::lifespan` cuenta candidatos sin postulación y lanza `RuntimeError` → uvicorn aborta el
arranque (probado: copia real sin migrar → "SE NEGÓ A ARRANCAR"; tras correr el script → 200 en
`/salud`). Base nueva vacía → `seed.py` crea las postulaciones en la misma transacción. Único
supuesto: uvicorn con lifespan (el default; `--lifespan off` no se usa en este proyecto).

### Orden de despliegue
1. `git commit` cuando el usuario apruebe el diff.
2. En producción, ANTES de reiniciar la API: `python scripts/migrar_postulaciones.py --forzar`
   (desde `red-human-api/`; crea la tabla/columnas y migra los datos; idempotente).
3. Reiniciar la API. Si se olvida el paso 2, no arranca y el log dice exactamente qué correr.
4. Frontend: `next build` normal.

### Siguiente paso
Nada pendiente de negocio para Fase 2. Deuda conocida fuera de alcance: CVs adjuntos por
WhatsApp (ya documentada arriba) y ruteo de WhatsApp por Cuenta (`_cuenta_unica` sigue
exigiendo exactamente 1 Cuenta activa).


## 5 pantallas administrativas de Configuración (Puntos 9-13) — CERRADAS 2026-09-11 (comiteadas `47a4a8b` y desplegadas)

Investigación previa contra el código real (2 agentes de exploración: backend y frontend) con
inventario "existe vs falta" por punto; plan completo aprobado en plan mode antes de escribir
código. Fase 2 ya estaba comiteada y desplegada (`24acfd7`) al empezar.

**Decisiones de negocio confirmadas por el usuario (no volver a preguntar):**
1. Cuentas: un Administrador solo ve/administra las Cuentas a las que está vinculado
   (`usuario_cuentas`); al crear una queda vinculado automáticamente. NUNCA super-admin global.
2. "Nombre de la cuenta" = columna nueva `Cuenta.nombre` (identificador interno, listados y
   selector); `nombre_comercial` = lo que ven candidatos/portal; `razon_social` opcional.
3. Plantillas: UN solo formulario compartido para "Nueva vacante" y "Nueva plantilla"
   (`components/dashboard/vacantes/formulario-contenido.tsx`), todo editable + "Generar con IA".
4. Modo Prueba: la ventana de nueva sesión (antes constante 60 min) es configurable
   (`ConfiguracionSistema.modo_prueba_ventana_min`, 5–1440).

**Decisiones de implementación del agente (aceptadas con el plan):**
- Cliente gana `razon_social`/`nombre_comercial`; el candidato ve `nombre_comercial or nombre`
  (`Cliente.nombre_visible`, usado por `serial.nombre_empresa_candidato`). Contacto gana `apellidos`.
- "+ Agregar usuario" en la ficha de cuenta: si el correo ya existe se VINCULA (sin tocar rol ni
  contraseña); si no, se crea (helper `auth.crear_usuario_basico`, `debe_cambiar_pass=True`) con
  contraseña temporal que se muestra una sola vez. No se puede desvincular uno mismo ni al último
  administrador activo de la cuenta.
- La ficha de una cuenta distinta a la actual muestra sus Clientes en solo lectura con "Cambiar a
  esta cuenta" para administrarlos; "Usuarios y permisos" (cuenta actual) se conserva.
- Plantilla: "Eliminar" sigue siendo desactivar (vacantes creadas desde ella conservan
  `plantilla_id`); "Guardar como plantilla" ahora lo copia el servidor
  (`POST /plantillas/desde-vacante/{codigo}`, con alcance General/Cliente) usando la lista única
  `models.CAMPOS_PLANTILLA` (18 campos, también para `POST /plantillas/{id}/duplicar`). "Usar
  plantilla" precarga TODOS los campos (antes solo 5). La gestión de plantillas se quitó de
  Vacantes (botón "Plantillas", `GestionPlantillas`, `FormularioPlantilla`).
- Notificaciones: `disparar(..., override=)` sustituye la regla SOLO en esa llamada; `NotificarIn`
  viaja como `notificar` en 10 endpoints manuales (programar/modificar/cancelar/realizada/
  recordatorio/resultado de entrevista humana, solicitar/recordatorio de documentos, alta y
  recordatorio de contratación). Bitácora guarda `notificar_override`. `GET /notificaciones/reglas`
  pasó a `usuario_actual` (lectura para precargar la línea); `PUT /notificaciones/reglas` en bloque
  para el botón "Guardar configuración de notificaciones" (la grilla ya no guarda por checkbox).
  Los automáticos (`candidato_apto`, no-show, liga externa del entrevistador) siguen 100% con la
  regla — verificado en prueba.
- Modo Prueba: el borrado también limpia `NotificacionEnviada` de las personas de prueba; un
  `Colaborador` dado de alta desde una prueba NO se borra (se reporta como "conservados"). El
  botón "Reiniciar prueba" solo se muestra con Modo Prueba activo o sobre postulación de prueba
  (el backend ya lo exigía con 409).
- Selector de Cuenta: `<PorCuenta>` (layout) remonta todo el dashboard con `key={cuentaActualId}`
  (así `/dashboard` también se recarga y la conversación en memoria del agente se limpia);
  `modoPrueba` se relee al cambiar de cuenta; el selector muestra `nombre || nombreComercial`.

**Bug heredado de Fase 2 encontrado y corregido:** `contratacion.recordatorio` seguía pasando
`e.candidato` (persona) a `disparar`, que desde Fase 2 espera una Postulación (`c.vacante` ya no
existe en la persona) — tronaba con AttributeError. Ahora usa `e.postulacion`.

**Esquema (aditivo, `sincronizar()` lo aplica al arrancar; SIN script de datos):**
`cuentas.nombre`, `clientes.razon_social`, `clientes.nombre_comercial`, `cliente_contactos.apellidos`,
`plantillas.ubicacion`, `plantillas.actualizada_en`, `configuracion_sistema.modo_prueba_ventana_min`.
Verificado contra una copia de `redhuman.db`: agrega exactamente esas 7 columnas.

**Archivos:** backend `models.py`, `serial.py` (+`clienteId` en `vacante_dict`), `routers/cuentas.py`
(reescrito), `routers/auth.py`, `routers/clientes.py` (reescrito), `routers/plantillas.py`,
`routers/notificaciones.py`, `services/notificaciones.py`, `routers/candidatos.py`,
`routers/contratacion.py`, `routers/configuracion.py` (reescrito), `services/configuracion.py`,
`routers/webhooks.py`; nuevo `scripts/verificar_config_admin.py`. Frontend `lib/api.ts`,
`lib/data.ts`, `components/sesion.tsx`, `components/dashboard/shell.tsx`, `app/dashboard/layout.tsx`,
nuevos `components/dashboard/{campos,linea-notificar,confirmacion-accion,por-cuenta}.tsx` y
`components/dashboard/vacantes/formulario-contenido.tsx`; `app/dashboard/configuracion/page.tsx`
(reescrito), `app/dashboard/vacantes/page.tsx`, `app/dashboard/candidatos/page.tsx`,
`app/dashboard/onboarding/page.tsx`. `CLAUDE.md` con las reglas nuevas.

**Verificación realizada:**
- Backend: `pyflakes` limpio; `scripts/verificar_config_admin.py` — 52 comprobaciones en verde
  (`TestClient`, modo demo, base desechable): Cuentas (crear→vinculación, aislamiento 404, agregar
  nuevo/vincular existente, guards de desvinculación), Clientes+contactos (CRUD, validaciones,
  aislamiento por cuenta), Plantillas (desde-vacante copia 18 campos, duplicar, ubicación,
  actualizada, eliminar, vacante con contenido manual sin IA), Notificaciones (lectura no-admin,
  PUT en bloque, override enciende/apaga sin tocar la regla, automático sin override, alta y
  recordatorio de contratación), Modo Prueba (ventana respetada por el webhook, borrado limpia
  notificaciones y no toca reales). Regresión `verificar_fase2.py`: 56/56 sin cambios.
- Frontend: `tsc --noEmit` y `next build` limpios (19 rutas). Smoke con servidores reales
  (`uvicorn` + `next start` contra base nueva): login real; `/cuentas`, `/cuentas/actual`,
  `/clientes`, `/plantillas`, `/notificaciones/reglas`, `/configuracion` → 200; crear cliente y
  segunda cuenta; aislamiento por `X-Cuenta-Id`; las 5 páginas tocadas → 200 con sesión / 307 sin
  ella; endpoint con body `notificar` aceptado a través del servidor real. **Limitación honesta**
  (igual que en fases anteriores): sin navegador real, no se probó clic-a-clic (modales, línea
  "Notificar", toggle de Cuenta). Servidores y base de prueba detenidos/borrados.

### Siguiente paso (histórico — comiteado en `47a4a8b` y desplegado; ver Fase 4 abajo)
Pendiente conocido sin cambio: `sembrar_reglas_notificacion.py` de Fase D (verificar si ya corrió
en producción).


## Fase 4 — Comportamiento y evaluación de la Entrevista IA (avatar) — CERRADA 2026-09-11 (comiteada `8b45d18` y desplegada)

Fuente: documento "Cambios integrados – Red Human" (no está en el repo); se trabajó con las 6
reglas transcritas por el usuario. El guion de ejemplo del documento **todavía no se ha
entregado**: cuando llegue se incorpora como referencia de TONO en `ia.prompt_entrevistador`
(nunca literal). Plan completo aprobado en plan mode antes de escribir código.

### Hotfix bloqueante encontrado (regresión de Fase 2, causada por este mismo agente)
`routers/entrevistas.py` (`publica`, `_system_prompt`, `sesion`) y `routers/contratacion.py`
(carta de intención) leían `c.vacante` sobre un `Candidato`, atributo que dejó de existir en
`24acfd7`. Efecto real en producción: `GET /entrevistas/publica/{token}`, `POST …/sesion` y
`POST …/turno` respondían **500** → la liga de entrevista estaba caída desde el deploy de Fase 2;
la carta de intención también tronaba. Corregido: `_contexto(e)` → `(postulación, vacante,
empresa)` desde `e.postulacion`; `_html_carta_intencion` usa `e.postulacion.vacante`. Cobertura
nueva en `verificar_fase2.py` (agendar → liga pública → consentimiento → sesión → turnos → finalizar).

### Decisiones tomadas por el usuario en esta sesión (no volver a preguntar)
1. Alma se presenta como **"de Red Human"** y entrevista "para el puesto de X en {empresa
   resuelta}". La empresa siempre sale de la regla Cliente-visible / nombre comercial de la Cuenta.
2. El campo libre **"Empresa" de Nueva vacante se eliminó**: el generador resuelve el nombre en
   el servidor (`POST /vacantes/generar` recibe `cliente_id` + `mostrar_cliente_candidato` y
   devuelve `empresa`); `Vacante.empresa` se rellena siempre con el nombre resuelto.
3. Punto 4 (cierre automático): en este lote va la **propuesta documentada + spike técnico** con
   la clave real (sin tocar producción). Sí entraron las piezas independientes de la señal.
4. Punto 3: prompt redactado con las reglas transcritas; el guion de ejemplo llega después.

### Qué se implementó por punto
- **P1 Identidad de la empresa.** `serial.nombre_empresa(cuenta, cliente, mostrar)` (misma regla
  que `nombre_empresa_candidato`, sin necesitar una Vacante). `POST /vacantes/generar` ignora el
  texto libre `empresa` (compatibilidad) y usa la regla; `crear`/`actualizar` fijan `v.empresa` con
  la regla (en update: `flush + refresh` antes de recalcular, si no las relaciones no están
  cargadas). Entrevista: saludo, `GET /publica.empresa` y system prompt usan la empresa resuelta.
  Frontend: `FormularioContenidoVacante` recibe `clienteId`/`mostrarCliente` (Vacantes y
  Configuración → Plantillas) y muestra "Contenido generado a nombre de X".
- **P2 Identidad del candidato y datos concretos.** `candidatos.nombre_ficha(p)`: primer nombre
  de la ficha; `wa_nombre` (perfil de WhatsApp) solo si la ficha trae placeholder
  ("Candidato…"/"TMP"). Aplicado en prefiltro/agenda/onboarding y en la entrevista. El prompt
  recibe ubicación/modalidad/sueldo/beneficios/área con la regla "usa estos datos, no hables en
  genérico; lo que no esté aquí lo confirma RH". Tras B1 (Fase 2) + el hotfix, **no queda vector
  de cruce entre candidatos**: el system prompt se arma por request y por token desde
  `e.postulacion`, sin caches ni globales en `ia.py`/`avatar.py`/`entrevistas.py`.
- **P3 Comportamiento y lenguaje.** `ia.mensaje_inicial_entrevista` = "Hola {N}, soy Alma, de Red
  Human. {N}, cuando estés listo comenzamos. Dime, ¿estás listo?". `ia.prompt_entrevistador`
  (nuevo, keyword-only): protocolo de inicio (afirmativo → primera pregunta de inmediato; negativo
  → "Tómate tu tiempo, avísame cuando estés listo" y esperar; nunca re-preguntar tras afirmativo),
  silencio ("{N}, no te escuché. ¿Estás listo?"), prohibido numerar ("Pregunta 1/2…"), frases
  cortas, UNA pregunta principal por intervención, general → profundizar, no repetir lo
  respondido, entrevistadora no lectora, guion = temas de referencia (no hay que agotarlo),
  despedida fija `DESPEDIDA_ENTREVISTA` = "Con esto terminamos la entrevista" (debe abrir el
  último mensaje: «{DESPEDIDA}, {N}.»). `guion_entrevista` ahora produce `temas` (5–7) +
  `preguntas` de referencia + `enfoque`; `temas_de_guion()` da compatibilidad con guiones viejos.
  Modo texto: mismo prompt, `TurnoEntrevista.terminada` se conserva; demo mode respeta el
  protocolo (no → esperar; sí → pregunta). Silencio en avatar (cliente, `talk()` del SDK): tras
  `SESSION_READY`, 12 s sin `USER_SPEECH_STARTED` y sin turno del candidato → "{N}, no te escuché.
  ¿Estás listo?"; a media entrevista 25 s → "{N}, no te escuché. ¿Me repites tu respuesta?"; máximo
  2 avisos por silencio; se pausa mientras habla. **Supuesto ajustable**: la regla solo define la
  frase del inicio; la variante intermedia y los tiempos (12/25 s) son míos.
- **P4 Cierre automático — implementado lo independiente de la señal + propuesta + spike.**
  Ver subsección aparte abajo.
- **P5 Conocimiento profundo.** `ia.EvaluacionEntrevista.perfil: PerfilProfundo` con 10
  dimensiones (`motivadores, estilo_trabajo, valores, decisiones, aprendizaje, resiliencia,
  objetivos, riesgos, compatibilidad, relacion_jefatura`), cada una `{evaluado, conclusion,
  evidencia[]}` (citas), + `areas_desarrollo`. `evaluar_entrevista` recibe perfil ideal, temas y
  enfoque. Regla dura en entrevistador Y evaluador (`DATOS_SENSIBLES_PROHIBIDOS`): estado civil,
  hijos/familia, religión, salud/embarazo, orientación, con quién vive, edad → no preguntar; si
  el candidato lo menciona, no registrarlo ni usarlo. Se guarda en `Entrevista.evaluacion` (JSON,
  sin cambio de esquema); evaluaciones anteriores traen `perfil = null` y la UI lo tolera.
  Frontend: `components/dashboard/perfil-profundo.tsx` (`PerfilProfundoVista`, colapsable con
  evidencia) usado en Candidatos → Evaluaciones y en el tablero de Entrevistas (con riesgos,
  evidencia, cierre y # de respuestas).
- **P6 Enfoque de entrevista.** `Vacante.enfoque_entrevista` y `Plantilla.enfoque_entrevista`
  (String 30, default `profesional`; valores `ENFOQUES_ENTREVISTA = profesional |
  profesional_personal`, en `CAMPOS_PLANTILLA`). Cambia automáticamente guion, prompt y
  evaluador (`ENFOQUE_ENTREVISTA_TEMAS`). Frontend: sección "Entrevista IA" con `Selector` en el
  formulario compartido (Nueva vacante y Plantillas) y editable en el detalle de la vacante
  (aplica a entrevistas que se agenden después — el guion se genera al agendar).

### Punto 4 — cierre automático: lo que ya está, la propuesta y el spike
**Principio (del usuario):** nunca ejecutar una transición de estado importante sin una señal
explícita que el backend pueda verificar.

Ya implementado (independiente de la señal):
- `Entrevista.cierre` (String 20: `herramienta | marcador | texto | manual | desconexion |
  tiempo`), `iniciada_en`, `finalizada_en`, `intentos_previos` (JSON). Estado nuevo `interrumpida`.
- `POST /sesion` exige consentimiento (403) y rechaza entrevistas cerradas (409); fija `en_curso` +
  `iniciada_en`. `POST /turno` 403 si no está `en_curso`.
- `POST /finalizar` recibe `{transcript, cierre}`: idempotente si ya cerró (devuelve el registro,
  NO pisa el cierre verificado); 409 si no está `en_curso`; 403 sin consentimiento; transcript
  tope 400 mensajes. `_cierre_verificado`: `herramienta|marcador|texto` solo se aceptan si el
  último mensaje de Alma contiene `DESPEDIDA_ENTREVISTA`, si no se degrada a `manual`. Con
  `cierre` fuera de `CIERRES_COMPLETOS` (desconexión/tiempo) y `< MIN_TURNOS_CANDIDATO = 2` →
  `interrumpida` sin evaluar (RH puede reabrir). En los demás casos evalúa (con perfil), mueve
  la postulación a Evaluación y manda el WhatsApp de agradecimiento (mencionando la empresa).
- `POST /entrevistas/{codigo}/reabrir` (decisor, misma Cuenta, 404 si otra): archiva
  `{estado, cierre, iniciada_en, finalizada_en, transcript, evaluacion}` en `intentos_previos`,
  resetea, vuelve a `programada`, postulación Evaluación → Entrevista IA, bitácora.
- Cliente (`app/entrevista/[token]/page.tsx`): un solo `cerrar(cierre)`; manda `texto` (modo
  texto, `terminada`), `marcador` (avatar: último mensaje de Alma contiene la despedida → espera
  6 s y cierra), `manual` (botón), `desconexion` (`CONNECTION_CLOSED`). Pantalla "interrumpida".
  El tablero muestra "Interrumpida" + botón "Reabrir" (solo decisores).

Propuesta de señal primaria (pendiente del spike):
- Client tool `terminar_entrevista` declarada inline en `personaConfig.tools` (`type: "client"`),
  que el LLM invoca DESPUÉS de la despedida. El SDK la recibe con `registerToolCallHandler`; el
  cliente llama `/finalizar` con `cierre: "herramienta"` y luego `stopStreaming()`. El servidor
  verifica igual (despedida en el transcript). Si Anam NO reenvía tools a un LLM custom
  (`ANAM_LLM_ID` = nuestro endpoint de OpenAI; no está documentado), la señal primaria queda el
  **marcador** ya implementado, y `voiceDetectionOptions.silenceBeforeSessionEndSeconds` cubre el
  abandono. En ambos casos el candidato no pulsa nada.

Spike (lo corre el usuario, con la clave real, sin tocar producción):
1. `cd red-human-api && .venv/Scripts/python.exe scripts/spike_anam_tools.py` → pide 3 session
   tokens (control / tools + voiceDetectionOptions con llmId / tools sin llmId) y reporta qué
   acepta la API. Copia el token del caso 2.
2. Abre `scripts/spike_anam_tools.html` en el navegador (doble clic; usa el SDK desde esm.sh),
   pega el token, "Conectar", di «sí, listo», contesta y espera la despedida.
3. Resultado: si aparece `TOOL_CALL_STARTED` / `HANDLER terminar_entrevista` → implementar la
   tool como señal primaria (lote corto: `persona_config(extras={"tools": [...]})` ya acepta
   extras; cliente `registerToolCallHandler` → `cerrar("herramienta")`). Si solo llega la
   despedida sin tool → se queda el marcador (ya funciona) y se ajustan `voiceDetectionOptions`.
   Anotar aquí el resultado.

### Esquema
Columnas nuevas (las agrega `sincronizar()` al arrancar, verificado sobre copia de la base):
`vacantes.enfoque_entrevista`, `plantillas.enfoque_entrevista`, `entrevistas.cierre`,
`entrevistas.iniciada_en`, `entrevistas.finalizada_en`, `entrevistas.intentos_previos`. Sin
migración de datos: las entrevistas viejas quedan con `cierre = ""` y evaluación sin `perfil`.

### Archivos tocados (git status)
Backend: `app/models.py`, `app/serial.py`, `app/services/ia.py`, `app/services/entrevistas.py`,
`app/services/avatar.py` (`persona_config(extras)`, `avatar_activo` exige `ANAM_LLM_ID`),
`app/routers/entrevistas.py`, `app/routers/vacantes.py`, `app/routers/plantillas.py`,
`app/routers/candidatos.py` (`nombre_ficha`), `app/routers/contratacion.py` (hotfix),
`scripts/verificar_fase2.py`, nuevos `scripts/verificar_entrevista_ia.py`,
`scripts/spike_anam_tools.py`, `scripts/spike_anam_tools.html`.
Frontend: `lib/api.ts`, `lib/data.ts`, `app/entrevista/[token]/page.tsx`,
`app/dashboard/entrevistas/page.tsx`, `app/dashboard/vacantes/page.tsx`,
`app/dashboard/candidatos/page.tsx`, `app/dashboard/configuracion/page.tsx`,
`components/dashboard/vacantes/formulario-contenido.tsx`, nuevo `components/dashboard/perfil-profundo.tsx`.
Docs: `CLAUDE.md`, este archivo.

### Verificación realizada (2026-09-11)
- `scripts/verificar_entrevista_ia.py` (nuevo, TestClient demo, base desechable): **49 OK** —
  hotfix (5 endpoints públicos responden), empresa resuelta en `/publica` y en `/vacantes/generar`
  (ignora texto libre), system prompt con empresa/nombre de ficha/datos concretos/temas sin
  numerar/protocolo/sensibles, enfoque Vacante → Plantilla → guion → prompt → evaluador, guardas de
  `finalizar` (409 programada, 403 sin consentimiento, degradación a `manual`, `interrumpida` con
  desconexión y <2 turnos, idempotencia), `turno` 403 tras cierre, `reabrir` archiva y vuelve a
  `programada`, perfil con 10 dimensiones, `nombre_ficha`.
- Regresión: `verificar_fase2.py` **61 OK** (56 + liga pública), `verificar_config_admin.py` **52 OK**.
- `pyflakes app`: solo 3 avisos preexistentes en HEAD (no míos). `tsc --noEmit` y `next build`
  limpios (19 rutas).
- `sincronizar()` sobre copia de `redhuman.db` (vía `import app.main`): agrega exactamente las 6
  columnas de Fase 4 (más las de fases anteriores que la base local no tenía).
- Smoke con API real (`uvicorn` demo, base nueva + `migrar_cuentas.py --forzar`): login →
  `/vacantes/generar` con `empresa: "TEXTO LIBRE"` devuelve "Grupo Carbe" → vacante con
  `profesional_personal` (temas incluyen "Objetivos personales y visión de futuro") → entrevista
  inmediata → `/publica` (candidato "Laura", empresa resuelta) → `finalizar` antes de sesión 409 →
  consentimiento → sesión (saludo exacto del documento, `nombre`) → "todavía no" → "Tómate tu
  tiempo…" → "sí, lista" → primera pregunta → 8 turnos → despedida con `terminada` → `finalizar`
  `cierre=texto` → `evaluada`, perfil 10 dims (5 evaluadas en demo) → `turno` 403 → `reabrir` →
  `programada`, `intentosPrevios = 1`. **Limitación honesta:** sin navegador real no se probó el
  avatar (silencio con `talk()`, marcador, desconexión) ni el clic-a-clic de las pantallas;
  el modo avatar depende además del spike. Servidor y base de prueba detenidos/borrados.

### Siguiente paso (Fase 4 ya desplegada en `8b45d18`)
1. Correr el spike de Anam (instrucciones arriba); anotar el resultado aquí y decidir el lote corto
   de la tool `terminar_entrevista`.
2. Entregar el guion de ejemplo del documento → ajustar el tono de `prompt_entrevistador`
   (referencia, no literal) y validar los tiempos de silencio (12/25 s) con una entrevista real.


## Bug urgente WhatsApp — "Sí, empezar ahora" sin respuesta — corregido 2026-09-11 (CÓDIGO LISTO, pendiente de commit/deploy inmediato)

**Síntoma:** el candidato recibe la plantilla de inicio (`inicio_entrevista_rh`, se manda tras
postular por web), presiona el botón "Sí, empezar ahora" y el agente no contesta nada.

**Investigación (sin asumir la causa), contra el código real + reproducción con la API real en
demo:**
1. Texto del botón en Meta: no se pudo leer — Graph respondió **error 190, token caducado el
   25-Ago-2026** para el `META_WHATSAPP_TOKEN` del `.env` LOCAL (no es de System User; el README
   pide uno sin caducidad). Como la plantilla sí llega en producción, el token de producción debe
   ser otro; **revisar igual** (`/salud` + log `[whatsapp] Meta rechazó ... 190`). Para el flujo web
   el texto del botón es irrelevante: la postulación ya trae `consentimiento=True` + vacante y el
   webhook manda cualquier respuesta directo al prefiltro.
2. `_es_aceptacion` (fix de Fase 2, palabra completa) solo se consulta cuando
   `p.consentimiento` es False (flujo iniciado por WhatsApp); el botón llega como `type: "button"`
   y `_texto_de_meta` saca `button.text`; "sí" es palabra completa. **No rompió nada.**
3. Fase 4 solo cambió `nombre_ficha(p)` en la ruta del prefiltro. **No interfiere** (reproducido).
4. Reproducción (`/postular` → plantilla → payload `button` de Meta → webhook): para una persona
   nueva **funciona** (200, `turno_prefiltro`, primera pregunta). Fallas reales encontradas:

**Causa A (reproducida — encaja con "no responde nada" y "dejó de funcionar recientemente"):**
`webhooks._cuenta_unica` respondía **HTTP 500 a TODO mensaje entrante si había ≠ 1 Cuenta activa**.
Desde `47a4a8b` (Punto 9) crear una 2ª Cuenta es un clic en Configuración → Cuentas. Meta reintenta
el 500 y luego lo descarta: el candidato no recibe nada y su mensaje ni siquiera queda en el
tablero. **Fix (decisión del usuario, opción a):** `_cuenta_whatsapp(db, numero_receptor)` —
enruta por número (`metadata.display_phone_number` de Meta ↔ `Cuenta.whatsapp_comunicacion`); si
nadie coincide y hay 1 activa → esa; si hay varias → la más antigua con aviso `[webhook] ⚠️` en el
log. Nunca 500, nunca candidato sin respuesta. `parsear_webhook` expone `numero_receptor`.

**Causa B (reproducida, Modo Prueba):** cada postulación web de prueba crea una persona nueva sin
`wa_id`; `_buscar_o_crear_candidato` buscaba primero por `wa_id` → encontraba la persona de la
prueba ANTERIOR → la respuesta al botón caía en la postulación vieja y el proceso nuevo nunca
arrancaba (pregunta fuera de contexto o menú de vacantes). **Fix:** una sola consulta
`wa_id OR teléfono`, la persona más reciente gana.

**Cobertura:** `verificar_fase2.py` sección 12 (`meta_boton_plantilla`, formato `button` real de
Meta): botón tras postular por web arranca el prefiltro; Causa B (2ª postulación de prueba mismo
teléfono → va a la nueva); Causa A (2 Cuentas activas → 200 y responde; ruteo por número a la
Cuenta B). **67 OK**; `verificar_entrevista_ia.py` 49 OK, `verificar_config_admin.py` 52 OK.

**Para confirmar en producción tras el deploy:** Configuración → Cuentas (¿más de una Activa?);
log del servidor `grep "webhooks/whatsapp\|\[webhook\] ⚠️\|Meta rechazó"`; capturar el número de
WhatsApp Business en `whatsapp_comunicacion` de la Cuenta que opera el WABA para que el ruteo sea
exacto. Archivos: `app/routers/webhooks.py`, `app/services/whatsapp.py`, `scripts/verificar_fase2.py`.
Sin cambio de esquema ni script de datos.
