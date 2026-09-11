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
Fase D (notificaciones configurables por evento/destinatario/canal, puntos 22-26)
diseñada, implementada por completo y verificada — ver sección detallada abajo. Código
listo, pendiente de revisión del usuario antes de commit/deploy.

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

### Siguiente paso
1. El usuario revisa los cambios de los Puntos 2 y 27 (especialmente probar el selector de
   Cuenta si existe más de una en el entorno de prueba).
2. Commit y deploy cuando se apruebe.
3. El único punto técnico pendiente de limpieza es conectar los badges de navegación
   (Vacantes/Candidatos/Entrevistas/Onboarding) a conteos reales de la API — anotado como
   deuda técnica, no es urgente para operación.

