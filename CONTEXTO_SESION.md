# Estado del proyecto Red Human AI

## Reestructuración multi-cuenta en curso
Especificación completa en Otros_cambios_2.docx (29 puntos), dividida en 6 fases por 
dependencia real (cada fase depende de que la anterior esté terminada, salvo E que es 
transversal):
- Fase A: Modelo de Cuenta, Cliente, Usuarios y permisos — EN CURSO (investigación)
- Fase B: Vacantes (creación, herencia automática de Cuenta/Cliente, plantillas, vista previa) — PENDIENTE, depende de A
- Fase C: Vistas de Vacantes/Candidatos (tarjetas/lista, filtros, conteos reales por etapa, navegación desde contadores, lógica de "Apto") — PENDIENTE, depende de A y B
- Fase D: Notificaciones configurables por evento/destinatario/canal — PENDIENTE, depende de A, B y de la infraestructura de WhatsApp/correo ya existente
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
Se completaron los 13 puntos de ajustes generales (WhatsApp/agente conversacional, ficha 
del candidato reestructurada en 5 pestañas, historial de entrevistas humanas con liga de 
evaluación por entrevistador, documentos por liga, carta de intención en PDF, Modo Prueba 
no bloqueante) — todos desplegados en producción. Ahora arranca la Fase A de la 
reestructuración multi-cuenta.

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

### Siguiente paso
Diseño del modelo de datos (tablas `cuentas`, `clientes`, `usuario_cuentas`, columnas
`cuenta_id`/`cliente_id` en los modelos del punto 1) propuesto — pendiente de aprobación
explícita del usuario antes de escribir cualquier código. Ver el diseño completo en el
historial de esta conversación (no repetido aquí para no duplicar); una vez aprobado,
volcar el diseño final a esta sección antes de empezar a implementar.
