/* ============================================================
   Cliente de la API de Red Human (FastAPI).

   · Lecturas (`get`): regresan null si el backend no responde, para que las
     pantallas sigan funcionando con los datos de demostración.
   · Mutaciones (`post`/`patch`/`subir`): regresan Resultado<T> con el mensaje
     de error de la API, porque la validación de archivos y las reglas de
     human-in-the-loop tienen que verse en pantalla.
   ============================================================ */

import type {
  Candidato,
  RecomendacionEntrevistaHumana,
  ResultadoEntrevistaHumana,
  TipoEntrevistador,
  Vacante,
} from "@/lib/data";
import type { NuevoIngreso } from "@/lib/phase2";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

const SIN_API = "No se pudo conectar con la API. Verifica que esté corriendo en " + API;

/** Rutas que el candidato usa sin sesión: un 401 ahí no debe mandarnos al login. */
const PUBLICAS = ["/salud", "/auth/yo", "/auth/login", "/vacantes/slug/", "/candidatos/postular", "/entrevistas/publica/"];

/** Un 401 significa que la sesión venció: se manda a login conservando a dónde iba. */
function sesionCaida(ruta: string) {
  if (typeof window === "undefined") return;
  if (PUBLICAS.some((p) => ruta.startsWith(p))) return;
  if (window.location.pathname.startsWith("/login")) return;
  const destino = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${destino}&expirada=1`;
}

/** Cabecera X-Cuenta-Id — se inyecta en cada request cuando el usuario tiene más de una
 * Cuenta activa. El backend la exige solo en ese caso (ver deps.py::cuenta_actual).
 * Devuelve objeto vacío en SSR o cuando no hay Cuenta guardada. */
function headersCuenta(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const id = window.localStorage.getItem("rh-cuenta-id");
  return id ? { "X-Cuenta-Id": id } : {};
}

async function get<T>(ruta: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${ruta}`, {
      cache: "no-store",
      credentials: "include",
      headers: headersCuenta(),
    });
    if (r.status === 401) sesionCaida(ruta);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function detalleError(r: Response): Promise<string> {
  try {
    const cuerpo = await r.json();
    const d = cuerpo?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0]?.msg) return d.map((x: { msg: string }) => x.msg).join(" · ");
  } catch {
    /* respuesta sin JSON */
  }
  return `Error ${r.status} al llamar ${r.url.replace(API, "")}`;
}

async function enviar<T>(ruta: string, init: RequestInit): Promise<Resultado<T>> {
  try {
    // Mezclar los headers del llamador con X-Cuenta-Id; el llamador tiene prioridad sobre
    // todo menos la cabecera de cuenta (Content-Type, etc. no deben ser sobreescritos).
    const headers = {
      ...headersCuenta(),
      ...(init.headers as Record<string, string> | undefined ?? {}),
    };
    const r = await fetch(`${API}${ruta}`, { ...init, credentials: "include", headers });
    if (r.status === 401) sesionCaida(ruta);
    if (!r.ok) return { ok: false, error: await detalleError(r) };
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, error: SIN_API };
  }
}

function post<T>(ruta: string, body: unknown = {}) {
  return enviar<T>(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch<T>(ruta: string, body: unknown) {
  return enviar<T>(ruta, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function subir<T>(ruta: string, form: FormData) {
  return enviar<T>(ruta, { method: "POST", body: form });
}

function eliminar<T>(ruta: string) {
  return enviar<T>(ruta, { method: "DELETE" });
}

export function urlArchivo(ruta: string) {
  return `${API}${ruta}`;
}

/* ============================================================
   Autenticación
   ============================================================ */

export type RolUsuario = "Administrador" | "Usuario";

export interface UsuarioRH {
  id: number;
  correo: string;
  nombre: string;
  puesto: string;
  /** Fase 7A: WhatsApp del perfil (10 dígitos) — se usa al notificar al entrevistador interno. */
  telefono?: string;
  rol: RolUsuario;
  activo: boolean;
  debeCambiarPass: boolean;
  puedeDecidir: boolean;
  ultimoAcceso: string | null;
  /** Lista de Cuentas activas a las que tiene acceso este usuario.
   * Cuando solo hay una, el frontend no muestra ningún selector (regla Fase A). */
  cuentas: { id: number; nombre: string; nombreComercial: string }[];
  /** Fase 2: Cuenta con la que arranca la sesión (null = la primera vinculada). */
  cuentaPredeterminadaId?: number | null;
}

export function login(correo: string, password: string) {
  return post<{ ok: boolean; usuario: UsuarioRH }>("/auth/login", { correo, password });
}

export function logout() {
  return post<{ ok: boolean }>("/auth/logout");
}

export function fetchYo() {
  return get<UsuarioRH>("/auth/yo");
}

export function cambiarPassword(actual: string, nueva: string) {
  return post<{ ok: boolean }>("/auth/cambiar-password", { actual, nueva });
}

export function fetchUsuarios() {
  return get<UsuarioRH[]>("/auth/usuarios");
}

export function crearUsuario(datos: {
  correo: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  rol?: RolUsuario;
  password: string;
}) {
  return post<UsuarioRH>("/auth/usuarios", datos);
}

export function actualizarUsuario(
  id: number,
  cambios: { nombre?: string; puesto?: string; telefono?: string; rol?: RolUsuario; activo?: boolean; password?: string },
) {
  return patch<UsuarioRH>(`/auth/usuarios/${id}`, cambios);
}

/* ============================================================
   Configuración global (solo admin) — hoy solo Modo Prueba
   ============================================================ */

export interface ConfiguracionSistema {
  modoPrueba: boolean;
  /** Punto 13: minutos sin actividad para que una conversación de prueba arranque una sesión nueva. */
  modoPruebaVentanaMin: number;
  /** 2026-09-19: horas antes de la Entrevista Humana para el recordatorio automático (0 = apagado). */
  recordatorioEntrevistaHoras?: number;
  /** Fase 3: recordatorios automáticos de documentos — cada N días, a partir de esta hora (México). */
  recordatorioDocumentosDias: number;
  recordatorioDocumentosHora: number;
  candidatosPrueba: number;
  postulacionesPrueba: number;
}

export function fetchConfiguracion() {
  return get<ConfiguracionSistema>("/configuracion");
}

export function actualizarConfiguracion(cambios: {
  modoPrueba?: boolean;
  modoPruebaVentanaMin?: number;
  recordatorioDocumentosDias?: number;
  recordatorioDocumentosHora?: number;
  recordatorioEntrevistaHoras?: number;
}) {
  return patch<ConfiguracionSistema>("/configuracion", {
    modo_prueba: cambios.modoPrueba,
    modo_prueba_ventana_min: cambios.modoPruebaVentanaMin,
    recordatorio_documentos_dias: cambios.recordatorioDocumentosDias,
    recordatorio_documentos_hora: cambios.recordatorioDocumentosHora,
    recordatorio_entrevista_horas: cambios.recordatorioEntrevistaHoras,
  });
}

export interface ResumenBorradoPrueba {
  candidatos: number;
  postulaciones: number;
  mensajes: number;
  entrevistas: number;
  expedientes: number;
  documentos: number;
  notificaciones: number;
  /** Colaboradores dados de alta desde una prueba: NO se borran, RH decide desde Colaboradores. */
  colaboradoresConservados: number;
}

/** Botón «Eliminar postulaciones de prueba» — borra TODOS los candidatos con es_prueba=True. */
export function eliminarCandidatosPrueba() {
  return post<ResumenBorradoPrueba>("/candidatos/prueba/eliminar");
}

/* ============================================================
   Punto 2 · Cuenta y Portal — datos editables de la Cuenta activa (solo admin)
   ============================================================ */

export interface DatosCuenta {
  id: number;
  /** Punto 9: nombre interno de la cuenta (listados/selector). */
  nombre: string;
  nombreComercial: string;
  razonSocial: string;
  /** Ruta en disco — construir la URL con urlArchivo(logo) para mostrarla. Vacío si no tiene logo. */
  logo: string;
  contactoNombre: string;
  correoComunicacion: string;
  whatsappComunicacion: string;
  whatsappExclusivo?: boolean;
  /** 2026-09-17: portal por Cuenta. */
  slug?: string;
  portalUrl?: string;
  estado: "Activa" | "Inactiva" | "Eliminada";
  esActual: boolean;
  /** Fase 2: Cuenta con la que arranca la sesión de ESTE usuario (por usuario, no global). */
  esPredeterminada?: boolean;
  eliminadaEn?: string | null;
  usuarios: number;
  clientes: number;
}

export interface UsuarioDeCuenta {
  id: number;
  nombre: string;
  correo: string;
  puesto: string;
  telefono?: string;
  rol: RolUsuario;
  activo: boolean;
}

/** Ficha completa (Punto 9): datos generales + usuarios + clientes + portal. */
export interface FichaCuenta extends DatosCuenta {
  usuariosDetalle: UsuarioDeCuenta[];
  clientesDetalle: { id: number; nombre: string; nombreComercial: string; estado: string; contactos: number }[];
  portal: { logo: string; nombreComercial: string; url: string };
}

export type CamposCuenta = {
  nombre?: string;
  nombre_comercial?: string;
  razon_social?: string;
  contacto_nombre?: string;
  correo_comunicacion?: string;
  whatsapp_comunicacion?: string;
  /** 2026-09-17: número de WhatsApp dedicado a esta Cuenta (Premium); por defecto el número es compartido. */
  whatsapp_exclusivo?: boolean;
  estado?: "Activa" | "Inactiva";
};

export function fetchCuentaActual() {
  return get<FichaCuenta>("/cuentas/actual");
}

/** 2026-09-20 (B2): razones sociales con las que la Cuenta puede contratar (Cuenta primero = predeterminada,
 * luego Clientes activos). Única lista válida para «Empresa contratante»; el servidor rechaza texto libre. */
export interface RazonSocial {
  razonSocial: string;
  origen: "cuenta" | "cliente";
  clienteId: number | null;
  predeterminada: boolean;
}
export function fetchRazonesSociales() {
  return get<RazonSocial[]>("/cuentas/actual/razones-sociales");
}

export function actualizarCuenta(cambios: CamposCuenta) {
  return patch<FichaCuenta>("/cuentas/actual", cambios);
}

export function subirLogoCuenta(archivo: File) {
  const form = new FormData();
  form.append("archivo", archivo);
  return subir<FichaCuenta>("/cuentas/actual/logo", form);
}

/** Solo las Cuentas a las que el admin está vinculado (nunca todas las del sistema). */
export function fetchCuentas(incluirEliminadas = false) {
  return get<DatosCuenta[]>(`/cuentas${incluirEliminadas ? "?incluir_eliminadas=true" : ""}`);
}

/** Fase 2: baja lógica (nada se borra; se puede restaurar). No admite la Cuenta actual ni la última activa. */
export function eliminarCuenta(id: number) {
  return eliminar<{ ok: boolean; cuenta: DatosCuenta }>(`/cuentas/${id}`);
}

export function restaurarCuenta(id: number) {
  return post<DatosCuenta>(`/cuentas/${id}/restaurar`);
}

export function marcarCuentaPredeterminada(id: number) {
  return post<{ ok: boolean; cuentaPredeterminadaId: number }>(`/cuentas/${id}/predeterminada`);
}

/* ---------- Fase 2: cargas masivas (CSV/Excel) ---------- */

export type TipoCargaMasiva = "usuarios" | "clientes" | "plantillas";

export interface ResultadoCargaMasiva {
  total: number;
  creados: number;
  errores: number;
  filas: ({ fila: number } & Record<string, unknown>)[];
  fallas: { fila: number; referencia: string; error: string }[];
}

const RUTAS_MASIVO: Record<TipoCargaMasiva, string> = {
  usuarios: "/auth/usuarios/masivo",
  clientes: "/clientes/masivo",
  plantillas: "/plantillas/masivo",
};

export function cargaMasiva(tipo: TipoCargaMasiva, archivo: File) {
  const form = new FormData();
  form.append("archivo", archivo);
  return subir<ResultadoCargaMasiva>(RUTAS_MASIVO[tipo], form);
}

/** CSV de ejemplo con las columnas exactas (autenticado por cookie, como urlArchivo). */
export function urlPlantillaCargaMasiva(tipo: TipoCargaMasiva) {
  return urlArchivo(`${RUTAS_MASIVO[tipo]}/plantilla`);
}

export function crearCuenta(datos: CamposCuenta & { nombre: string }) {
  return post<FichaCuenta>("/cuentas", datos);
}

export function fetchCuenta(id: number) {
  return get<FichaCuenta>(`/cuentas/${id}`);
}

export function actualizarCuentaPorId(id: number, cambios: CamposCuenta) {
  return patch<FichaCuenta>(`/cuentas/${id}`, cambios);
}

export function subirLogoCuentaPorId(id: number, archivo: File) {
  const form = new FormData();
  form.append("archivo", archivo);
  return subir<FichaCuenta>(`/cuentas/${id}/logo`, form);
}

/** «+ Agregar usuario» en la ficha: si el correo ya existe se vincula (nuevo=false); si no, se
 * crea y `passwordTemporal` viene UNA sola vez para que el admin se la comparta. */
export function agregarUsuarioCuenta(cuentaId: number, datos: { nombre?: string; correo: string; rol?: RolUsuario; puesto?: string; telefono?: string; password?: string }) {
  return post<{ usuario: UsuarioDeCuenta; nuevo: boolean; passwordTemporal: string | null; cuenta: FichaCuenta }>(
    `/cuentas/${cuentaId}/usuarios`,
    datos,
  );
}

export function quitarUsuarioCuenta(cuentaId: number, usuarioId: number) {
  return eliminar<FichaCuenta>(`/cuentas/${cuentaId}/usuarios/${usuarioId}`);
}

/* ============================================================
   Fase D · Notificaciones configurables por evento/destinatario/canal (solo admin)
   ============================================================ */

/** Los 11 eventos configurables (puntos 22-26 + Fase 5) — el orden importa para la grilla de
 * Configuración → Notificaciones, mantenerlo igual al de `EVENTOS_NOTIFICACION` en models.py. */
export const EVENTOS_NOTIFICACION = [
  "entrevista_agendada",
  "recordatorio_entrevista",
  "entrevista_modificada",
  "entrevista_cancelada",
  "candidato_apto",
  "entrevista_humana_terminada",
  "entrevista_completada",
  "vacante_publicada",
  "recomendacion_final",
  "contratacion",
  "solicitud_documentos",
  "recordatorio_documentos",
  "instrucciones_ingreso",
] as const;

export type EventoNotificacion = (typeof EVENTOS_NOTIFICACION)[number];

export const NOMBRE_EVENTO_NOTIFICACION: Record<EventoNotificacion, string> = {
  entrevista_agendada: "Entrevista agendada",
  recordatorio_entrevista: "Recordatorio de entrevista",
  entrevista_modificada: "Entrevista modificada",
  entrevista_cancelada: "Entrevista cancelada",
  candidato_apto: "Candidato apto",
  entrevista_humana_terminada: "Entrevista humana terminada",
  entrevista_completada: "Entrevista completada (evaluación registrada)",
  vacante_publicada: "Vacante publicada",
  recomendacion_final: "Recomendación final disponible",
  contratacion: "Contratación",
  solicitud_documentos: "Solicitud de documentos",
  recordatorio_documentos: "Recordatorio de documentos",
  instrucciones_ingreso: "Bienvenida e instrucciones de ingreso (automático al dar de alta)",
};

export interface ReglaNotificacion {
  evento: EventoNotificacion;
  candidatoCorreo: boolean;
  candidatoWhatsapp: boolean;
  entrevistadorCorreo: boolean;
  entrevistadorWhatsapp: boolean;
  clienteCorreo: boolean;
  clienteWhatsapp: boolean;
}

export function fetchReglasNotificacion() {
  return get<ReglaNotificacion[]>("/notificaciones/reglas");
}

/** Punto 12: ajuste de destinatarios/canales SOLO para una acción (línea "Notificar: … · Editar").
 * Un flag ausente/undefined = usar la configuración predeterminada. */
export interface NotificarAccion {
  candidatoCorreo?: boolean;
  candidatoWhatsapp?: boolean;
  entrevistadorCorreo?: boolean;
  entrevistadorWhatsapp?: boolean;
  clienteCorreo?: boolean;
  clienteWhatsapp?: boolean;
  /** Fase 7A: contactos del Cliente elegidos para esta acción (ids de ClienteContacto).
   * undefined = todos los contactos del Cliente; [] = ninguno. */
  clienteContactosIds?: number[];
}

export function notificarSnake(n?: NotificarAccion | null) {
  if (!n) return undefined;
  return {
    candidato_correo: n.candidatoCorreo,
    candidato_whatsapp: n.candidatoWhatsapp,
    entrevistador_correo: n.entrevistadorCorreo,
    entrevistador_whatsapp: n.entrevistadorWhatsapp,
    cliente_correo: n.clienteCorreo,
    cliente_whatsapp: n.clienteWhatsapp,
    cliente_contactos_ids: n.clienteContactosIds,
  };
}

/** Botón «Guardar configuración de notificaciones»: manda la matriz completa en una sola llamada. */
export function guardarReglasNotificacion(reglas: ReglaNotificacion[]) {
  return enviar<ReglaNotificacion[]>("/notificaciones/reglas", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      reglas.map((r) => ({
        evento: r.evento,
        candidato_correo: r.candidatoCorreo,
        candidato_whatsapp: r.candidatoWhatsapp,
        entrevistador_correo: r.entrevistadorCorreo,
        entrevistador_whatsapp: r.entrevistadorWhatsapp,
        cliente_correo: r.clienteCorreo,
        cliente_whatsapp: r.clienteWhatsapp,
      })),
    ),
  });
}

export function actualizarReglaNotificacion(evento: EventoNotificacion, cambios: Omit<ReglaNotificacion, "evento">) {
  return patch<ReglaNotificacion>(`/notificaciones/reglas/${evento}`, {
    candidato_correo: cambios.candidatoCorreo,
    candidato_whatsapp: cambios.candidatoWhatsapp,
    entrevistador_correo: cambios.entrevistadorCorreo,
    entrevistador_whatsapp: cambios.entrevistadorWhatsapp,
    cliente_correo: cambios.clienteCorreo,
    cliente_whatsapp: cambios.clienteWhatsapp,
  });
}

/* ============================================================
   Módulo 1 · Vacantes
   ============================================================ */

export interface BloquePlataforma {
  titulo: string;
  copy: string;
  page: string;
  etiquetas: string[];
}

export interface CriterioFiltro {
  pregunta: string;
  tipo: "si_no" | "numero" | "opcion" | "texto_corto";
  valida: string;
  respuesta_esperada: string;
  descarta: boolean;
}

/** Salida cruda del generador (aún no persistida). */
export interface VacanteGenerada {
  ia: boolean;
  /** Nombre de empresa que usó el generador (resuelto por la regla Cliente/Cuenta). */
  empresa?: string;
  /** Parte 3: texto del sueldo derivado del estructurado capturado (o «A convenir»). */
  sueldo_texto?: string;
  resumen: string;
  descripcion: string;
  perfil_ideal: string;
  responsabilidades: string[];
  requisitos_indispensables: string[];
  requisitos_deseables: string[];
  beneficios: string[];
  palabras_clave: string[];
  seniority: string;
  rango_salarial_sugerido: string;
  avisos_cumplimiento: string[];
  texto_whatsapp: string;
  occ: BloquePlataforma;
  linkedin: BloquePlataforma;
  portal: BloquePlataforma;
  preguntas_filtro: CriterioFiltro[];
  /** 2026-09-16 (prefiltro dual): 2-3 puntos críticos que la IA confirma por WhatsApp. */
  preguntas_filtro_whatsapp?: CriterioFiltro[];
}

/** Parte 3 (2026-09-12): sueldo estructurado. "a_convenir" = sin montos. El texto que se muestra
 * (`Vacante.sueldo`) lo DERIVA el servidor; nunca se captura ni se inventa. */
export type PeriodicidadSueldo = "semanal" | "quincenal" | "mensual" | "anual" | "a_convenir";
export const PERIODICIDADES_SUELDO: { valor: PeriodicidadSueldo; texto: string }[] = [
  { valor: "mensual", texto: "Mensual" },
  { valor: "quincenal", texto: "Quincenal" },
  { valor: "semanal", texto: "Semanal" },
  { valor: "anual", texto: "Anual" },
  { valor: "a_convenir", texto: "A convenir" },
];
export const MONEDAS_SUELDO = ["MXN", "USD"];
/** Los 6 niveles que usa el generador (ia.SENIORITY); se capturan ANTES de generar. */
export const SENIORITIES = ["Sin experiencia", "Junior", "Semi-senior", "Senior", "Jefatura", "Dirección"];

export interface SueldoEstructurado {
  sueldo_desde?: number | null;
  sueldo_hasta?: number | null;
  sueldo_moneda?: string;
  sueldo_periodicidad?: PeriodicidadSueldo | "";
}

/** Ficha capturada por RH ANTES de generar (Parte 3). Es la ÚNICA fuente de condiciones reales:
 * el servidor nunca inventa sueldo/ubicación/modalidad/prestaciones y respeta literal lo capturado. */
export interface DatosVacante extends SueldoEstructurado {
  titulo: string;
  area?: string;
  seniority?: string;
  ubicacion?: string;
  /** Fase 4: ubicación estructurada (Estado / Municipio); el servidor deriva `ubicacion` de aquí. */
  ubicacion_estado?: string;
  ubicacion_municipio?: string;
  modalidad?: string;
  /** Legado: sueldo en texto (agente / vacantes viejas). */
  sueldo?: string;
  /** Guía opcional para Red Human. */
  descripcion?: string;
  requisitos_indispensables?: string[];
  requisitos_deseables?: string[];
  beneficios?: string[];
  /** Legado: indispensables en texto separados por « · ». */
  requisitos?: string;
  /** Deprecado (Fase 4, Punto 1): el servidor ignora el texto libre y resuelve el nombre con la regla. */
  empresa?: string;
  /** Fase 4: la empresa visible se resuelve en el servidor a partir del Cliente y de "mostrar cliente". */
  cliente_id?: number | null;
  mostrar_cliente_candidato?: boolean;
}

export function fetchVacantes(filtros?: {
  estado?: string;
  // --- Fase C: filtros adicionales ---
  busqueda?: string;
  cliente_id?: number;
  responsable_id?: number;
  area?: string;
  ubicacion?: string;
}) {
  const q = new URLSearchParams(
    Object.entries(filtros ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][],
  ).toString();
  return get<Vacante[]>(`/vacantes${q ? `?${q}` : ""}`);
}

/** Bolsa de trabajo pública (/portal): solo vacantes en estado "Publicada", sin sesión. */
/** 2026-09-17: `cuenta` (slug o id) aísla el portal a una Cuenta; sin él es la bolsa global. */
export function fetchVacantesPublicas(cuenta = "") {
  return get<Vacante[]>(`/vacantes/publicas${cuenta ? `?cuenta=${encodeURIComponent(cuenta)}` : ""}`);
}

/** Vistas previas de los correos corporativos de Entrevista Humana (sin enviar). Con `datos` se renderiza el
 * correo EXACTO con el contexto real capturado en el modal (2026-09-18); sin datos, ejemplo de prueba. */
export interface DatosPreviewCorreo {
  evento?: "agendada" | "modificada" | "recordatorio" | "cancelada";
  candidato?: string;
  entrevistador?: string;
  vacante?: string;
  empresa?: string;
  fecha?: string; // «2026-09-24»
  hora?: string; // «10:30»
  modalidad?: string;
  liga?: string;
  ubicacion?: string;
  telefono?: string;
  telefonoCandidato?: string;
  comentario?: string;
  ligaExpediente?: string;
}

export function urlPreviewCorreo(plantilla: "entrevistador" | "candidato", datos?: DatosPreviewCorreo | string) {
  const p = new URLSearchParams();
  if (typeof datos === "string") {
    p.set("modalidad", datos);
  } else if (datos) {
    const mapa: Record<string, string | undefined> = {
      evento: datos.evento, candidato: datos.candidato, entrevistador: datos.entrevistador, vacante: datos.vacante, empresa: datos.empresa,
      fecha: datos.fecha, hora: datos.hora, modalidad: datos.modalidad, liga: datos.liga, ubicacion: datos.ubicacion, telefono: datos.telefono,
      telefono_candidato: datos.telefonoCandidato, comentario: datos.comentario, liga_expediente: datos.ligaExpediente,
    };
    for (const [k, v] of Object.entries(mapa)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  }
  const q = p.toString();
  return `${API}/api/emails/preview/${plantilla}${q ? `?${q}` : ""}`;
}

export function fetchCuentaPublica(cuenta: string) {
  return get<{ id: number; slug: string; nombre: string; logoUrl: string }>(`/vacantes/publicas/cuenta?cuenta=${encodeURIComponent(cuenta)}`);
}

export function fetchVacante(codigo: string) {
  return get<Vacante>(`/vacantes/${codigo}`);
}

export function fetchVacantePorSlug(slug: string) {
  return get<Vacante>(`/vacantes/slug/${slug}`);
}

export function generarVacanteIA(datos: DatosVacante) {
  return post<VacanteGenerada>("/vacantes/generar", datos);
}

export function crearVacante(
  datos: DatosVacante & {
    descripcion?: string;
    resumen?: string;
    perfil_ideal?: string;
    responsabilidades?: string[];
    requisitos_deseables?: string[];
    beneficios?: string[];
    palabras_clave?: string[];
    seniority?: string;
    avisos_cumplimiento?: string[];
    texto_whatsapp?: string;
    preguntas_filtro?: CriterioFiltro[];
    preguntas_filtro_whatsapp?: CriterioFiltro[];
    ubicacion_estado?: string;
    ubicacion_municipio?: string;
    publicaciones?: Record<string, BloquePlataforma>;
    publicar?: boolean;
    plataformas?: string[];
    generar_si_falta?: boolean;
    /* --- Fase B: creación de vacante --- */
    cliente_id?: number | null;
    responsable_id?: number | null;
    colaboradores_ids?: number[];
    mostrar_cliente_candidato?: boolean;
    plantilla_id?: number | null;
    enfoque_entrevista?: EnfoqueEntrevista;
    texto_bolsa?: string;
  },
) {
  return post<Vacante>("/vacantes", datos);
}

/** "Entrevista IA" es el valor interno/base de la etapa; en la interfaz se muestra como
 * «Entrevista Red Human» (Parte 3, decisión visual — sin migración de datos). */
export const ETIQUETA_ETAPA: Record<string, string> = { "Entrevista IA": "Entrevista Red Human" };
export function nombreEtapa(etapa: string): string {
  return ETIQUETA_ETAPA[etapa] ?? etapa;
}

/** Fase 4 (Punto 6): solo 2 niveles, nunca más. */
export type EnfoqueEntrevista = "profesional" | "profesional_personal";
export const ENFOQUES_ENTREVISTA: { valor: EnfoqueEntrevista; texto: string; detalle: string }[] = [
  { valor: "profesional", texto: "Profesional", detalle: "Experiencia, conocimientos, responsabilidades, criterio, decisiones, comunicación, presión, motivadores laborales, estilo de trabajo, objetivos profesionales." },
  { valor: "profesional_personal", texto: "Profesional + personal", detalle: "Lo anterior más objetivos personales no sensibles, prioridades, motivadores amplios, disciplina, valores y visión de futuro." },
];

export function actualizarVacante(codigo: string, cambios: Record<string, unknown>) {
  return patch<Vacante>(`/vacantes/${codigo}`, cambios);
}

/** CRUD (2026-09-15): baja LÓGICA — la vacante pasa a «Eliminada», se retira de portal/WhatsApp y de los
 * tableros; sus postulaciones activas se cierran (motivo vacante_eliminada). Reversible con restaurarVacante. */
export function eliminarVacante(codigo: string) {
  return eliminar<{ ok: boolean; vacante: Vacante; postulacionesCerradas: number }>(`/vacantes/${codigo}`);
}

export function restaurarVacante(codigo: string) {
  return post<Vacante>(`/vacantes/${codigo}/restaurar`);
}

/** CRUD (2026-09-15): baja LÓGICA de la PERSONA (acepta P-#### o C-####): todas sus postulaciones
 * activas se cierran y desaparece del Kanban, búsquedas y deduplicación. Nada se borra físicamente. */
export function eliminarCandidato(codigo: string) {
  return eliminar<{ ok: boolean; candidato: string; postulacionesCerradas: string[] }>(`/candidatos/${codigo}`);
}

/** Cómo verá el candidato esta vacante — funciona aunque siga en Borrador. */
export function fetchVistaPreviaVacante(codigo: string) {
  return get<Vacante>(`/vacantes/${codigo}/vista-previa`);
}

export function regenerarVacante(codigo: string, notas = "") {
  return post<Vacante & { ia: boolean }>(`/vacantes/${codigo}/regenerar`, { notas });
}

export function publicarVacante(codigo: string, plataformas: string[]) {
  return post<Vacante>(`/vacantes/${codigo}/publicar`, { plataformas });
}

export function cerrarVacante(codigo: string) {
  return post<Vacante>(`/vacantes/${codigo}/cerrar`, {});
}

export interface PublicacionLista {
  plataforma: string;
  vacante: string;
  liga: string;
  titulo: string;
  copy: string;
  page: string;
  etiquetas: string[];
  copyConLiga: string;
}

export function fetchPublicacion(codigo: string, plataforma: string) {
  return get<PublicacionLista>(`/vacantes/${codigo}/publicacion/${plataforma}`);
}

/* ============================================================
   Fase B · Clientes (empresas para las que recluta una Cuenta)
   ============================================================ */

export interface ContactoCliente {
  id: number;
  nombre: string;
  apellidos: string;
  nombreCompleto: string;
  puesto: string;
  correo: string;
  telefono: string;
}

export interface Cliente {
  id: number;
  nombre: string;
  razonSocial: string;
  nombreComercial: string;
  /** Lo que ve el candidato: nombre comercial si existe, si no el nombre. */
  nombreVisible: string;
  estado: "Activo" | "Inactivo";
  /** Conteo de contactos; la lista completa solo viene en la ficha (`listaContactos`). */
  contactos: number;
  listaContactos?: ContactoCliente[];
  creado: string;
}

export type CamposCliente = { nombre?: string; razon_social?: string; nombre_comercial?: string; estado?: "Activo" | "Inactivo" };
export type CamposContacto = { nombre: string; apellidos?: string; puesto?: string; correo?: string; telefono?: string };

export function fetchClientes(estado?: string) {
  return get<Cliente[]>(`/clientes${estado ? `?estado=${estado}` : ""}`);
}

export function fetchCliente(id: number) {
  return get<Cliente>(`/clientes/${id}`);
}

export function crearCliente(datos: CamposCliente & { nombre: string }) {
  return post<Cliente>("/clientes", datos);
}

export function actualizarCliente(id: number, cambios: CamposCliente) {
  return patch<Cliente>(`/clientes/${id}`, cambios);
}

export function agregarContactoCliente(clienteId: number, datos: CamposContacto) {
  return post<Cliente>(`/clientes/${clienteId}/contactos`, datos);
}

export function editarContactoCliente(clienteId: number, contactoId: number, datos: CamposContacto) {
  return patch<Cliente>(`/clientes/${clienteId}/contactos/${contactoId}`, datos);
}

export function eliminarContactoCliente(clienteId: number, contactoId: number) {
  return eliminar<Cliente>(`/clientes/${clienteId}/contactos/${contactoId}`);
}

/* ============================================================
   Fase B · Plantillas de vacante
   ============================================================ */

export interface Plantilla {
  id: number;
  nombre: string;
  clienteId: number | null;
  clienteNombre: string | null;
  activa: boolean;
  titulo: string;
  area: string;
  ubicacion: string;
  modalidad: string;
  sueldo: string;
  sueldoDesde?: number | null;
  sueldoHasta?: number | null;
  sueldoMoneda?: string;
  sueldoPeriodicidad?: PeriodicidadSueldo | "";
  requisitos: string;
  descripcion: string;
  resumen: string;
  perfilIdeal: string;
  responsabilidades: string[];
  requisitosDeseables: string[];
  beneficios: string[];
  palabrasClave: string[];
  seniority: string;
  avisosCumplimiento: string[];
  preguntasFiltro: CriterioFiltro[];
  /** Fase 4: prefiltro por WhatsApp independiente + ubicación estructurada. */
  preguntasFiltroWhatsapp?: CriterioFiltro[];
  ubicacionEstado?: string;
  ubicacionMunicipio?: string;
  textoWhatsapp: string;
  textoBolsa: string;
  enfoqueEntrevista?: EnfoqueEntrevista;
  creadoPor: string;
  /** Última actualización (Punto 11); igual a `creada` si nunca se editó. */
  actualizada: string;
  creada: string;
}

export interface DatosPlantilla {
  nombre: string;
  cliente_id?: number | null;
  titulo?: string;
  area?: string;
  ubicacion?: string;
  modalidad?: string;
  sueldo?: string;
  requisitos?: string;
  descripcion?: string;
  resumen?: string;
  perfil_ideal?: string;
  responsabilidades?: string[];
  requisitos_deseables?: string[];
  beneficios?: string[];
  palabras_clave?: string[];
  seniority?: string;
  avisos_cumplimiento?: string[];
  preguntas_filtro?: CriterioFiltro[];
  texto_whatsapp?: string;
  texto_bolsa?: string;
  enfoque_entrevista?: EnfoqueEntrevista;
  sueldo_desde?: number | null;
  sueldo_hasta?: number | null;
  sueldo_moneda?: string;
  sueldo_periodicidad?: PeriodicidadSueldo | "";
}

/** Sin `clienteId`: todas las plantillas activas de la Cuenta. Con `clienteId`: las de ese
 * Cliente primero, luego las generales — el orden de sugerencia para "crear vacante". */
export function fetchPlantillas(clienteId?: number) {
  return get<Plantilla[]>(`/plantillas${clienteId ? `?cliente_id=${clienteId}` : ""}`);
}

export function fetchPlantilla(id: number) {
  return get<Plantilla>(`/plantillas/${id}`);
}

export function crearPlantilla(datos: DatosPlantilla) {
  return post<Plantilla>("/plantillas", datos);
}

export function actualizarPlantilla(id: number, cambios: Partial<DatosPlantilla> & { activa?: boolean }) {
  return patch<Plantilla>(`/plantillas/${id}`, cambios);
}

/** No borra — desactiva (deja de sugerirse, pero las vacantes ya creadas desde ella conservan la referencia). */
export function eliminarPlantilla(id: number) {
  return eliminar<{ ok: boolean }>(`/plantillas/${id}`);
}

export function duplicarPlantilla(id: number) {
  return post<Plantilla>(`/plantillas/${id}/duplicar`);
}

/** «Guardar como plantilla» desde una vacante: el servidor copia los campos compartidos. */
export function guardarVacanteComoPlantilla(codigo: string, nombre: string, clienteId?: number | null) {
  return post<Plantilla>(`/plantillas/desde-vacante/${codigo}`, { nombre, cliente_id: clienteId ?? null });
}

/* ============================================================
   Módulo 1 · Candidatos
   ============================================================ */

export interface ArchivoCandidato {
  id: number;
  tipo: string;
  nombre: string;
  mime: string;
  tamano: number;
  estado: "recibido" | "revision" | "rechazado";
  notas: string;
  subidoPor: string;
  subido: string;
}

export interface ResultadoCV {
  ok: boolean;
  archivo: string;
  error?: string;
  ia?: boolean;
  duplicado?: boolean;
  esCv?: boolean;
  avisos?: string[];
  candidato?: Candidato;
}

export interface CargaCV {
  procesados: number;
  fallidos: number;
  resultados: ResultadoCV[];
}

export function fetchCandidatos(filtros?: {
  vacante?: string;
  etapa?: string;
  estado?: string;
  // --- Fase C: filtros adicionales ---
  fuente?: string;
  cliente_id?: number;
  responsable_id?: number;
  consentimiento?: boolean;
  apto?: boolean;
  duplicados?: boolean;
  score_min?: number;
  score_max?: number;
  /** Fase 2 (B4): por defecto la API solo regresa postulaciones activas. */
  mostrar_cerradas?: boolean;
  activa?: boolean;
}) {
  const q = new URLSearchParams(
    Object.entries(filtros ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return get<Candidato[]>(`/candidatos${q ? `?${q}` : ""}`);
}

export function fetchCandidato(codigo: string) {
  return get<Candidato>(`/candidatos/${codigo}`);
}

/** Carga masiva de CVs: valida, extrae con IA y califica contra la vacante. */
export function subirCVs(archivos: File[], opciones: { vacante?: string; fuente?: string } = {}) {
  const form = new FormData();
  archivos.forEach((a) => form.append("archivos", a));
  if (opciones.vacante) form.append("vacante", opciones.vacante);
  form.append("fuente", opciones.fuente ?? "RH");
  return subir<CargaCV>("/candidatos/cv", form);
}

export function subirArchivoCandidato(codigo: string, archivo: File, tipo = "cv") {
  const form = new FormData();
  form.append("archivo", archivo);
  form.append("tipo", tipo);
  return subir<ResultadoCV & { archivo: ArchivoCandidato }>(`/candidatos/${codigo}/archivos`, form);
}

export function urlArchivoCandidato(codigo: string, archivoId: number) {
  return urlArchivo(`/candidatos/${codigo}/archivos/${archivoId}`);
}

/** Botón "Reintentar análisis" (Punto 2) — relee un CV ya guardado y reintenta la extracción
 * con IA, sin pedirle al usuario que lo vuelva a subir. */
export function reanalizarCvCandidato(codigo: string, archivoId: number) {
  return post<Candidato>(`/candidatos/${codigo}/archivos/${archivoId}/reanalizar`);
}

export function registrarConsentimiento(
  codigo: string,
  datos: { acepta?: boolean; medio?: string; evidencia?: string },
) {
  return post<Candidato>(`/candidatos/${codigo}/consentimiento`, {
    acepta: datos.acepta ?? true,
    medio: datos.medio ?? "verbal",
    evidencia: datos.evidencia ?? "",
  });
}

export function decidirCandidato(codigo: string, accion: "descartar", comentario = "") {
  return post<Candidato>(`/candidatos/${codigo}/decision`, { accion, comentario });
}

/** Botones explícitos del Kanban ("Enviar a X") — mueve la tarjeta a una etapa exacta.
 * `forzarPrueba` (Lote 4): inerte salvo que Modo Prueba esté activo en el servidor. */
/** 2026-09-22 — «Avanzar a Entrevista Humana»: salta la Entrevista Red Human por decisión de RH. No se
 * bloquea por evaluaciones pendientes y deja la leyenda en el historial; nada de lo generado se borra. */
export function avanzarAEntrevistaHumana(codigo: string, motivo = "") {
  return patch<Candidato>(`/candidatos/${codigo}/etapa`, {
    etapa: "Entrevista Humana",
    comentario: motivo,
    manual: true,
    omitir_entrevista_ia: true,
  });
}

export function moverEtapaCandidato(codigo: string, etapa: string, comentario = "", forzarPrueba = false, manual = false) {
  // `manual` (2026-09-16): «Mover a otra etapa» — sin bloqueos de secuencia; lo que se salte queda
  // registrado como «Omitida manualmente» (usuario, fecha, motivo = comentario).
  return patch<Candidato>(`/candidatos/${codigo}/etapa${forzarPrueba ? "?forzar_prueba=true" : ""}`, { etapa, comentario, manual });
}

/** Un resultado de envío por destinatario/canal (Fase D) — ver `resultados` en las respuestas
 * de abajo. `enviado: false` sin más no es un error: puede ser que ese destinatario/canal
 * simplemente no esté configurado en Configuración → Notificaciones. */
export interface ResultadoNotificacion {
  enviado: boolean;
  proveedor?: string;
  detalle?: string;
  /* Fase 7A: quién y por dónde, para mostrar el resultado por canal en el modal */
  destinatario?: "candidato" | "entrevistador" | "cliente";
  canal?: "correo" | "whatsapp";
  destino?: string;
}

const NOMBRE_DESTINATARIO: Record<string, string> = { candidato: "Candidato", entrevistador: "Entrevistador", cliente: "Cliente" };

/** Fase 7A: una línea legible por envío («✓ Correo al candidato (cand@x.mx)» /
 * «✗ WhatsApp al entrevistador — RESEND_API_KEY sin configurar»). Vacío si no hubo destinatarios. */
export function lineasResultados(resultados: ResultadoNotificacion[] | undefined): { ok: boolean; texto: string }[] {
  return (resultados ?? []).map((r) => {
    const canal = r.canal === "correo" ? "Correo" : r.canal === "whatsapp" ? "WhatsApp" : "Aviso";
    const a = r.destinatario ? ` al ${NOMBRE_DESTINATARIO[r.destinatario]?.toLowerCase() ?? r.destinatario}` : "";
    const destino = r.destino ? ` (${r.destino})` : "";
    return r.enviado
      ? { ok: true, texto: `${canal}${a}${destino}: enviado` }
      : { ok: false, texto: `${canal}${a}${destino}: no enviado${r.detalle ? ` — ${r.detalle}` : ""}` };
  });
}

/** Onboarding · Zero-Touch fase 2 — RH detona el mensaje, la IA da seguimiento por WhatsApp.
 * Quién recibe qué (candidato/entrevistador/cliente, correo/WhatsApp) ya no es fijo: lo decide
 * la regla configurada en Configuración → Notificaciones para este evento. */
export function solicitarDocumentosCandidato(codigo: string, notificar?: NotificarAccion) {
  return post<{ resultados: ResultadoNotificacion[]; candidato: Candidato }>(`/candidatos/${codigo}/solicitar-documentos`, {
    notificar: notificarSnake(notificar),
  });
}

export function recordatorioDocumentosCandidato(codigo: string, notificar?: NotificarAccion) {
  return post<{ resultados: ResultadoNotificacion[]; candidato: Candidato }>(`/candidatos/${codigo}/recordatorio-documentos`, {
    notificar: notificarSnake(notificar),
  });
}

export function asignarVacante(codigo: string, vacante: string) {
  return post<Candidato>(`/candidatos/${codigo}/asignar`, { vacante, reevaluar: true });
}

/** SOLO PRUEBAS (Modo Prueba): cierra esta postulación y abre una nueva limpia para la misma
 * persona y vacante, sin tocar teléfono/wa_id — el mismo número vuelve a empezar el flujo.
 * Regresa la postulación NUEVA (más `anterior`/`nueva` con los códigos). */
export function reiniciarPostulacionPrueba(codigo: string) {
  return post<Candidato & { anterior: string; nueva: string }>(`/candidatos/${codigo}/reiniciar`);
}

/* ============================================================
   Entrevista Humana — modal "Programar entrevista" y checkbox "Entrevista realizada"
   ============================================================ */

export type ModalidadEntrevistaHumana = "Presencial" | "Videollamada" | "Llamada";

export function programarEntrevistaHumana(
  codigo: string,
  datos: {
    tipoEntrevistador: TipoEntrevistador;
    entrevistadorUsuarioId?: number | null;
    /** Fase 7A: contacto del Cliente de la vacante; si viene, nombre/correo/WhatsApp salen del contacto. */
    entrevistadorContactoId?: number | null;
    /** Fase 7B: false = «Usar otra liga» aunque la Cuenta tenga Teams conectado. */
    usarTeams?: boolean;
    entrevistadorNombre?: string;
    entrevistadorCorreo?: string;
    entrevistadorWhatsapp?: string;
    fecha: string;
    hora: string;
    modalidad: ModalidadEntrevistaHumana;
    liga?: string;
    ubicacion?: string;
    telefonoContacto?: string;
    comentario?: string;
    notificar?: NotificarAccion;
  },
) {
  return post<{ resultados: ResultadoNotificacion[]; advertencias?: string[]; candidato: Candidato }>(`/candidatos/${codigo}/entrevista-humana`, {
    tipo_entrevistador: datos.tipoEntrevistador,
    entrevistador_usuario_id: datos.entrevistadorUsuarioId ?? null,
    entrevistador_contacto_id: datos.entrevistadorContactoId ?? null,
    usar_teams: datos.usarTeams ?? true,
    entrevistador_nombre: datos.entrevistadorNombre ?? "",
    entrevistador_correo: datos.entrevistadorCorreo ?? "",
    entrevistador_whatsapp: datos.entrevistadorWhatsapp ?? "",
    fecha: datos.fecha,
    hora: datos.hora,
    modalidad: datos.modalidad,
    liga: datos.liga ?? "",
    ubicacion: datos.ubicacion ?? "",
    telefono_contacto: datos.telefonoContacto ?? "",
    comentario: datos.comentario ?? "",
    notificar: notificarSnake(datos.notificar),
  });
}

/** Botón «Modificar» — edita fecha/modalidad/liga/ubicación de la ronda vigente (Fase D,
 * evento "entrevista_modificada"). No aplica si la ronda ya fue cancelada o realizada. */
export function modificarEntrevistaHumana(
  codigo: string,
  datos: {
    fecha: string;
    hora: string;
    modalidad: ModalidadEntrevistaHumana;
    liga?: string;
    ubicacion?: string;
    telefonoContacto?: string;
    comentario?: string;
    notificar?: NotificarAccion;
  },
) {
  return patch<Candidato>(`/candidatos/${codigo}/entrevista-humana`, {
    fecha: datos.fecha,
    hora: datos.hora,
    modalidad: datos.modalidad,
    liga: datos.liga ?? "",
    ubicacion: datos.ubicacion ?? "",
    telefono_contacto: datos.telefonoContacto ?? "",
    comentario: datos.comentario ?? "",
    notificar: notificarSnake(datos.notificar),
  });
}

/** Botón «Cancelar» — Fase D, evento "entrevista_cancelada". No mueve la etapa del candidato:
 * RH agenda otra ronda o mueve la tarjeta a mano según corresponda. */
export function cancelarEntrevistaHumana(codigo: string, notificar?: NotificarAccion) {
  return post<Candidato>(`/candidatos/${codigo}/entrevista-humana/cancelar`, { notificar: notificarSnake(notificar) });
}

/** Ya no pide resultado — solo confirma que la entrevista ocurrió y dispara el correo con la
 * liga pública al entrevistador (ver registrarResultadoEntrevistaHumana para la captura manual).
 * `forzarPrueba` (Lote 4): inerte salvo que Modo Prueba esté activo en el servidor. */
export function marcarEntrevistaHumanaRealizada(codigo: string, forzarPrueba = false, notificar?: NotificarAccion) {
  return post<{ resultados: ResultadoNotificacion[]; candidato: Candidato }>(
    `/candidatos/${codigo}/entrevista-humana/realizada${forzarPrueba ? "?forzar_prueba=true" : ""}`,
    { notificar: notificarSnake(notificar) },
  );
}

/** Respaldo manual de RH (Eje 1: coexiste con la liga del entrevistador) — también sirve para
 * corregir un resultado ya capturado, por eso mismo endpoint para "capturar" y "corregir". */
export function registrarResultadoEntrevistaHumana(
  codigo: string,
  datos: { resultado: ResultadoEntrevistaHumana; recomendacion: RecomendacionEntrevistaHumana; comentario?: string; notificar?: NotificarAccion },
  forzarPrueba = false,
) {
  return post<Candidato>(`/candidatos/${codigo}/entrevista-humana/resultado${forzarPrueba ? "?forzar_prueba=true" : ""}`, {
    resultado: datos.resultado,
    recomendacion: datos.recomendacion,
    comentario: datos.comentario ?? "",
    notificar: notificarSnake(datos.notificar),
  });
}

export function recordatorioEntrevistaHumana(codigo: string, forzarPrueba = false, notificar?: NotificarAccion) {
  return post<{ resultados: ResultadoNotificacion[]; candidato: Candidato }>(
    `/candidatos/${codigo}/entrevista-humana/recordatorio${forzarPrueba ? "?forzar_prueba=true" : ""}`,
    { notificar: notificarSnake(notificar) },
  );
}

/* Liga pública del entrevistador (sin sesión, un solo submit) */

export interface EntrevistaHumanaPublica {
  candidato: string;
  puesto: string;
  fecha: string | null;
  entrevistador?: string;
  modalidad?: string;
  /** 2026-09-19: la liga sigue mostrando el expediente aunque ya se haya evaluado. */
  yaEvaluada?: boolean;
  resultado?: string;
  recomendacion?: string;
  expediente?: {
    candidato: { nombre: string; telefono: string; correo: string; fuente: string };
    vacante: { titulo: string; requisitos: string; perfilIdeal: string; empresa: string };
    etapa: string;
    score: number | null;
    cv: { resumen: string; habilidades: string[]; estudios: string[]; idiomas: string[]; experiencia: (string | { puesto?: string; empresa?: string; periodo?: string })[]; anosExperiencia?: number | null };
    analisis: { requisitosCumplidos: string[]; brechas: string[]; fortalezas: string[]; alertas: string[]; resumen: string };
    entrevistaIA: { matchPerfil: number | null; recomendacion: string; resumen: string; fortalezas: string[]; riesgos: string[]; faltante: string[] } | null;
    capacitacion: { curso: string; aprobado: boolean; calificacion: number }[];
    archivos: { id: number; tipo: string; nombre: string; mime: string }[];
    documentos: { tipo: string; estado: string; obligatorio: boolean }[];
  };
}

export function urlArchivoEntrevistaHumanaPublica(token: string, archivoId: number) {
  return urlArchivo(`/entrevista-humana/publica/${token}/archivo/${archivoId}`);
}

export function fetchEntrevistaHumanaPublica(token: string) {
  return get<EntrevistaHumanaPublica>(`/entrevista-humana/publica/${token}`);
}

export function enviarEvaluacionEntrevistaHumana(
  token: string,
  datos: { resultado: ResultadoEntrevistaHumana; recomendacion: RecomendacionEntrevistaHumana; comentario?: string },
) {
  return post<{ ok: boolean }>(`/entrevista-humana/publica/${token}`, {
    resultado: datos.resultado,
    recomendacion: datos.recomendacion,
    comentario: datos.comentario ?? "",
  });
}

/* ============================================================
   Contratación — condiciones finales (Puesto/Sueldo/Tipo/Fecha/Ubicación/Jefe directo)
   ============================================================ */

export function guardarCondicionesContratacion(
  codigo: string,
  datos: {
    puesto?: string; sueldo?: string; tipoContratacion?: string; fechaIngreso?: string; ubicacion?: string; jefeDirecto?: string; instruccionesIngreso?: string; empresa?: string;
    /** 2026-09-20 (B2): solo «Tiempo determinado»; la fecha de término la calcula el servidor. */
    duracionContrato?: number | null; duracionUnidad?: string;
  },
) {
  // B2: PATCH puro — el servidor solo actualiza el expediente (sin mensajes, sin colaborador, sin cambio de etapa)
  return patch<Candidato>(`/candidatos/${codigo}/condiciones-contratacion`, {
    puesto: datos.puesto ?? "",
    sueldo: datos.sueldo ?? "",
    tipo_contratacion: datos.tipoContratacion ?? "",
    fecha_ingreso: datos.fechaIngreso || null,
    ubicacion: datos.ubicacion ?? "",
    jefe_directo: datos.jefeDirecto ?? "",
    instrucciones_ingreso: datos.instruccionesIngreso ?? "",  // Fase 5: van en la bienvenida automática al alta
    empresa: datos.empresa ?? "",  // 2026-09-19 (Bloque 3)
    duracion_contrato: datos.duracionContrato ?? null,
    duracion_unidad: datos.duracionUnidad ?? "",
  });
}

/** Personas de RH activas (id + nombre), para el select de "Entrevistador interno". */
/** Fase 7A: usuarios activos de la Cuenta con correo y WhatsApp del perfil (Configuración → Usuarios). */
export interface Entrevistador {
  id: number;
  nombre: string;
  correo: string;
  telefono: string;
}

export function fetchEntrevistadores() {
  return get<Entrevistador[]>("/auth/entrevistadores");
}

/** Postulación pública desde /aplicar/[slug]: alta + consentimiento + CV + prefiltro en un paso. */
export function postular(datos: {
  slug: string;
  nombre: string;
  telefono?: string;
  correo?: string;
  consentimiento: boolean;
  respuestas?: { pregunta: string; respuesta: string }[];
  cv?: File | null;
}) {
  const form = new FormData();
  form.append("vacante", datos.slug);
  form.append("nombre", datos.nombre);
  form.append("telefono", datos.telefono ?? "");
  form.append("correo", datos.correo ?? "");
  form.append("consentimiento", String(datos.consentimiento));
  form.append("respuestas", JSON.stringify(datos.respuestas ?? []));
  if (datos.cv) form.append("cv", datos.cv);
  return subir<{
    ok: boolean;
    candidato: string;
    nombre: string;
    nuevo: boolean;
    cv: { procesado: boolean; avisos: string[] };
    clasificacion: { estado: string; score: number; evidencia: string } | null;
  }>("/candidatos/postular", form);
}

export interface MensajePrefiltro {
  rol: "user" | "assistant";
  texto: string;
  canal: string;
  enviado: boolean;
  ts: string;
}

export function fetchMensajes(codigo: string) {
  return get<MensajePrefiltro[]>(`/candidatos/${codigo}/mensajes`);
}

export function enviarPrefiltro(codigo: string, texto: string, canal = "simulador") {
  return post<{
    respuesta: string;
    clasificacion: { estado: string; score: number; evidencia: string } | null;
    ia: boolean;
  }>(`/candidatos/${codigo}/prefiltro`, { texto, canal });
}

/* ============================================================
   Módulo 1 · Entrevistas con agente IA
   ============================================================ */

/** Fase 4 (Punto 5): una dimensión del conocimiento profundo del candidato, con la evidencia
 * (citas del candidato) que la sustenta. `evaluado=false` = la entrevista no la cubrió. */
export interface DimensionPerfil {
  evaluado: boolean;
  conclusion: string;
  evidencia: string[];
}

export const DIMENSIONES_PERFIL: { clave: keyof PerfilProfundo; etiqueta: string }[] = [
  { clave: "motivadores", etiqueta: "Motivadores" },
  { clave: "estilo_trabajo", etiqueta: "Estilo de trabajo" },
  { clave: "valores", etiqueta: "Valores profesionales" },
  { clave: "decisiones", etiqueta: "Criterio y decisiones" },
  { clave: "aprendizaje", etiqueta: "Aprendizaje y errores" },
  { clave: "resiliencia", etiqueta: "Presión y conflicto" },
  { clave: "objetivos", etiqueta: "Objetivos y crecimiento" },
  { clave: "riesgos", etiqueta: "Riesgos" },
  { clave: "compatibilidad", etiqueta: "Compatibilidad con el puesto" },
  { clave: "relacion_jefatura", etiqueta: "Relación con jefatura" },
];

export interface PerfilProfundo {
  motivadores: DimensionPerfil;
  estilo_trabajo: DimensionPerfil;
  valores: DimensionPerfil;
  decisiones: DimensionPerfil;
  aprendizaje: DimensionPerfil;
  resiliencia: DimensionPerfil;
  objetivos: DimensionPerfil;
  riesgos: DimensionPerfil;
  compatibilidad: DimensionPerfil;
  relacion_jefatura: DimensionPerfil;
}

export interface EvaluacionEntrevista {
  resumen: string;
  fortalezas: string[];
  riesgos: string[];
  areas_desarrollo?: string[];
  calif_experiencia: number;
  calif_comunicacion: number;
  match_perfil: number;
  recomendacion: "avanzar" | "revision" | "no_avanzar";
  evidencia: string;
  /** Fase 4: conocimiento profundo; null en evaluaciones previas a Fase 4. */
  perfil?: PerfilProfundo | null;
  /** 2026-09-13: temas que la entrevista no cubrió (corta pero suficiente). */
  faltante?: string[];
  /** 2026-09-13: entrevista parcial — sin score integral. */
  parcial?: boolean;
}

export type CierreEntrevista = "" | "herramienta" | "marcador" | "texto" | "manual" | "desconexion" | "tiempo";

export const NOMBRE_CIERRE: Record<CierreEntrevista, string> = {
  "": "—",
  herramienta: "Automático (avatar)",
  marcador: "Automático (despedida)",
  texto: "Automático (texto)",
  manual: "Botón del candidato",
  desconexion: "Desconexión",
  tiempo: "Tiempo agotado",
};

export interface Entrevista {
  id: string;
  candidatoId: string;
  nombre: string;
  puesto: string;
  tipo: "avatar" | "texto";
  estado: "programada" | "en_curso" | "completada" | "evaluada" | "interrumpida" | "parcial";
  token: string;
  consentimiento: boolean;
  programada: string | null;
  creada: string;
  guion: { enfoque?: string; temas?: string[]; preguntas?: string[] };
  mensajes: number;
  turnosCandidato?: number;
  evaluacion: EvaluacionEntrevista | null;
  tono: number;
  ligaMeet: string;
  /* --- Fase 4: cierre verificable + reapertura --- */
  cierre?: CierreEntrevista;
  /** 2026-09-13: sin_respuestas | desconexion | parcial | "" */
  motivo?: string;
  iniciadaEn?: string | null;
  finalizadaEn?: string | null;
  intentosPrevios?: number;
}

/** Reapertura explícita por RH (Fase 4): archiva el intento anterior y vuelve a `programada`. */
export function reabrirEntrevista(codigo: string, motivo = "") {
  return post<Entrevista>(`/entrevistas/${codigo}/reabrir`, { motivo });
}

export function fetchEntrevistas() {
  return get<Entrevista[]>("/entrevistas");
}

export function agendarEntrevista(candidato: string, avisarWhatsapp = true) {
  return post<Entrevista & { liga: string; ia: boolean }>("/entrevistas", {
    candidato,
    avisar_whatsapp: avisarWhatsapp,
  });
}

export interface MetricasEntrevistas {
  total: number;
  evaluadas: number;
  pendientes: number;
  match_promedio: number;
  recomendaciones: { avanzar: number; revision: number; no_avanzar: number };
  avatar_activo: boolean;
}

export function fetchMetricasEntrevistas() {
  return get<MetricasEntrevistas>("/entrevistas/metricas");
}

export function entrevistaInmediata(datos: {
  nombre: string;
  telefono?: string;
  correo?: string;
  vacante?: string | null;
  avisar_whatsapp?: boolean;
}) {
  return post<Entrevista & { liga: string; ia: boolean }>("/entrevistas/inmediata", datos);
}

/* Sala pública (candidato) */

export interface EntrevistaPublica {
  candidato: string;
  puesto: string;
  empresa: string;
  tipo: string;
  estado: string;
  cierre?: CierreEntrevista;
  /** 2026-09-13: por qué no se evaluó (sin_respuestas | desconexion | parcial). */
  motivo?: string;
  consentimiento: boolean;
  avatar_disponible: boolean;
  duracion_max_seg?: number;
}

/** 2026-09-23 (incidente Expo): manda el diagnóstico del avatar al servidor. En un tótem no se puede
 * abrir la consola del navegador, así que la evidencia viaja al log de la API. Nunca lanza. */
export async function reportarDiagnosticoAvatar(
  token: string,
  datos: { donde: string; modo?: string; motivo?: string; error?: string; ice?: Record<string, unknown>; eventos?: string[] },
) {
  try {
    return await post<{ recibido: boolean; veredicto: string }>(`/entrevistas/publica/${token}/diagnostico`, {
      donde: datos.donde,
      modo: datos.modo ?? "",
      motivo: datos.motivo ?? "",
      error: datos.error ?? "",
      ice: datos.ice ?? {},
      eventos: datos.eventos ?? [],
      navegador: typeof navigator !== "undefined" ? navigator.userAgent : "",
    });
  } catch {
    return { ok: false as const, error: "no se pudo enviar el diagnóstico" };
  }
}

export function fetchEntrevistaPublica(token: string) {
  return get<EntrevistaPublica>(`/entrevistas/publica/${token}`);
}

export function consentirEntrevista(token: string) {
  return post<{ ok: boolean }>(`/entrevistas/publica/${token}/consentimiento`, { acepta: true });
}

/** `forzarTexto` (2026-09-13): el navegador pide modo texto aunque el servidor tenga avatar — se usa
 * cuando el stream de Anam no arranca, para que la sala nunca se quede en negro. */
export function iniciarEntrevista(token: string, forzarTexto = false) {
  return post<{
    modo: "avatar" | "texto";
    nombre?: string;
    session_token?: string;
    mensajes?: { rol: string; texto: string }[];
    motivo?: string; // modo texto: por qué (config del servidor, rechazo de Anam, petición del navegador)
  }>(
    `/entrevistas/publica/${token}/sesion`,
    forzarTexto ? { modo: "texto" } : {},
  );
}

export function turnoEntrevista(token: string, texto: string) {
  return post<{ respuesta: string; terminada: boolean; ia: boolean }>(
    `/entrevistas/publica/${token}/turno`,
    { texto },
  );
}

/** `cierre` (Fase 4, Punto 4): cómo terminó según el navegador; el servidor lo VERIFICA contra el
 * transcript (una despedida declarada sin la frase fija se degrada a `manual`). */
export function finalizarEntrevista(token: string, transcript?: { rol: string; texto: string }[], cierre: CierreEntrevista = "manual") {
  return post<Entrevista>(`/entrevistas/publica/${token}/finalizar`, { transcript: transcript ?? null, cierre });
}

/** 2026-09-17: sincronización incremental del transcript en modo avatar — el servidor siempre tiene lo dicho. */
export function sincronizarTranscript(token: string, transcript: { rol: string; texto: string }[]) {
  return post<{ ok: boolean; estado: string; turnos: number }>(`/entrevistas/publica/${token}/transcript`, { transcript });
}

/** Cierre de emergencia al cerrar la pestaña: `fetch` con `keepalive` sobrevive al unload
 * (sendBeacon no permite JSON cross-origin). Si no llega, el job de inactividad del servidor cierra
 * la entrevista con el transcript ya sincronizado. */
export function finalizarEntrevistaBeacon(token: string, transcript: { rol: string; texto: string }[], cierre: CierreEntrevista) {
  try {
    void fetch(`${API}/entrevistas/publica/${token}/finalizar`, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, cierre }),
    });
    return true;
  } catch {
    return false;
  }
}

/** RH: evaluar una entrevista interrumpida/parcial con las respuestas que sí hubo (2026-09-17). */
export function evaluarEntrevistaConLoQueHay(codigo: string) {
  return post<Entrevista>(`/entrevistas/${codigo}/evaluar`, {});
}

/* ============================================================
   Módulo 1 · Capacitación (Fase 1 — sin avatar todavía)
   ============================================================ */

/* ============================================================
   Capacitación — módulo UNIVERSAL (2026-09-16)
   Un solo tipo de curso (objetivo + módulos + evaluación integrada), asignable a colaboradores, candidatos
   (filtro de una vacante) y externos (liga pública). Un solo tablero de seguimiento.
   ============================================================ */

export type TipoAsignacionCurso = "colaborador" | "candidato" | "externo";

export interface ModuloCurso {
  orden: number;
  titulo: string;
  contenido: string;
}

export interface PreguntaEvaluacion {
  pregunta: string;
  tipo: "opcion" | "vf";
  opciones: string[];
  correcta: number;
  explicacion: string;
}

export interface Curso {
  id: string;
  titulo: string;
  categoria: string;
  duracionHoras: number;
  /** 2026-09-19 (Bloque 4): duración libre y cómo se imparte. */
  duracion?: string;
  modalidad?: ModalidadCurso;
  objetivo: string;
  estado: "Borrador" | "Publicado" | "Archivado";
  obligatorio: boolean;
  creadoPor: string;
  creado: string;
  modulos: number;
  preguntas: number;
  calificacionMinima: number;
  asignados: number;
  completados: number;
  aprobados: number;
  adjuntos: string[];
  /* detalle */
  contexto?: string;
  listaModulos?: ModuloCurso[];
  evaluacion?: PreguntaEvaluacion[];
}

export interface AsignacionCurso {
  id: string;
  cursoId: string;
  cursoTitulo: string;
  tipo: TipoAsignacionCurso;
  persona: string;
  correo: string;
  telefono: string;
  organizacion: string;
  colaboradorId: string | null;
  postulacionId: string | null;
  vacante: string | null;
  estado: "pendiente" | "en_curso" | "completado";
  moduloActual: number;
  totalModulos: number;
  avance: number;
  calificacion: number | null;
  aprobado: boolean | null;
  asignadoPor: string;
  asignado: string;
  asignadoEn: string | null;
  iniciadoEn: string | null;
  completado: string | null;
  token: string;
  liga: string;
}

export interface CapacitacionKpis {
  cursosActivos: number;
  enFormacion: number;
  tasaFinalizacion: number;
  tasaAprobacion: number;
  horasImpartidas: number;
  porTipo: Record<TipoAsignacionCurso, number>;
}

export function fetchCursos() {
  return get<Curso[]>("/capacitacion");
}

export function fetchCurso(codigo: string) {
  return get<Curso>(`/capacitacion/${codigo}`);
}

/** «Generar curso con IA»: solo tema, contexto opcional, adjuntos y duración. */
export type ModalidadCurso = "instructor_ia" | "autoguiado";

export function generarCurso(datos: { tema: string; duracion: string; modalidad: ModalidadCurso; contexto?: string; archivos?: File[] }) {
  const form = new FormData();
  form.append("tema", datos.tema);
  form.append("duracion", datos.duracion);  // 2026-09-19: libre («5 min», «1 h»)
  form.append("modalidad", datos.modalidad);
  form.append("contexto", datos.contexto ?? "");
  for (const f of datos.archivos ?? []) form.append("archivos", f);
  return subir<Curso & { ia: boolean }>("/capacitacion/generar", form);
}

export function editarCurso(
  codigo: string,
  cambios: { titulo?: string; objetivo?: string; categoria?: string; duracionHoras?: number; calificacionMinima?: number; modulos?: { titulo: string; contenido: string }[]; evaluacion?: PreguntaEvaluacion[] },
) {
  return patch<Curso>(`/capacitacion/${codigo}`, {
    titulo: cambios.titulo,
    objetivo: cambios.objetivo,
    categoria: cambios.categoria,
    duracion_horas: cambios.duracionHoras,
    calificacion_minima: cambios.calificacionMinima,
    modulos: cambios.modulos,
    evaluacion: cambios.evaluacion,
  });
}

/** «Finalizar curso» (2026-09-19: Crear → Revisar → Finalizar → Asignar). El estado interno sigue siendo «Publicado». */
export function publicarCurso(codigo: string) {
  return patch<Curso>(`/capacitacion/${codigo}/finalizar`, {});
}
export const finalizarCurso = publicarCurso;

/** Etiqueta visible del estado del curso. */
export function etiquetaEstadoCurso(estado: string) {
  return estado === "Publicado" ? "Finalizado" : estado;
}

export function archivarCurso(codigo: string) {
  return eliminar<{ ok: boolean }>(`/capacitacion/${codigo}`);
}

/** Asignación universal: colaboradores (COL-####), candidatos (P-####) y/o externos (con o sin datos). */
export function asignarCurso(
  codigo: string,
  datos: { colaboradorIds?: string[]; postulacionIds?: string[]; externos?: { nombre?: string; correo?: string; telefono?: string; organizacion?: string }[]; notificar?: boolean },
) {
  return post<{ asignaciones: AsignacionCurso[]; envios: Record<string, unknown>[]; noEncontrados: string[] }>(`/capacitacion/${codigo}/asignar`, {
    colaborador_ids: datos.colaboradorIds ?? [],
    postulacion_ids: datos.postulacionIds ?? [],
    externos: datos.externos ?? [],
    notificar: datos.notificar ?? true,
  });
}

export function fetchAsignacionesCurso(codigo: string) {
  return get<AsignacionCurso[]>(`/capacitacion/${codigo}/asignaciones`);
}

/** Tablero único de seguimiento con filtros. */
export function fetchTableroCapacitacion(filtros?: { tipo?: TipoAsignacionCurso | ""; estado?: string; curso?: string; aprobado?: boolean | null }) {
  const params = new URLSearchParams();
  if (filtros?.tipo) params.set("tipo", filtros.tipo);
  if (filtros?.estado) params.set("estado", filtros.estado);
  if (filtros?.curso) params.set("curso", filtros.curso);
  if (filtros?.aprobado !== undefined && filtros?.aprobado !== null) params.set("aprobado", String(filtros.aprobado));
  const q = params.toString();
  return get<AsignacionCurso[]>(`/capacitacion/asignaciones${q ? `?${q}` : ""}`);
}

export function fetchCapacitacionKpis() {
  return get<CapacitacionKpis>("/capacitacion/kpis");
}

/* ---------- sala pública (liga /capacitacion/[token]) ---------- */

export interface AsignacionPublica {
  persona: string;
  tipo: TipoAsignacionCurso;
  requiereRegistro: boolean;
  curso: string;
  modalidad?: ModalidadCurso;
  duracion?: string;
  objetivo: string;
  categoria: string;
  duracionHoras: number;
  empresa: string;
  estado: "pendiente" | "en_curso" | "completado";
  modulosCompletados: number;
  totalModulos: number;
  modulos: { orden: number; titulo: string; contenido: string; completado: boolean }[];
  totalPreguntas: number;
  preguntasRespondidas: number;
  pregunta: { indice: number; pregunta: string; tipo: "opcion" | "vf"; opciones: string[] } | null;
  resultado: { calificacion: number; aprobado: boolean; aciertos: number; total: number; minimo: number; detalle: { pregunta: string; correcta: boolean; explicacion: string }[] } | null;
}

export function fetchAsignacionPublica(token: string) {
  return get<AsignacionPublica>(`/capacitacion/publica/${token}`);
}

export function registrarExternoCurso(token: string, datos: { nombre: string; correo?: string; telefono?: string }) {
  return post<AsignacionPublica>(`/capacitacion/publica/${token}/registro`, datos);
}

export function avanzarModulo(token: string, modulo: number) {
  return post<AsignacionPublica>(`/capacitacion/publica/${token}/avanzar`, { modulo });
}

/** 2026-09-18: instructor con avatar (Anam) o chat de texto para el módulo en curso. */
export function iniciarInstructorCurso(token: string, modulo: number) {
  return post<{ modo: "avatar" | "texto"; session_token?: string; modulo: number; mensajes: { rol: string; texto: string }[] }>(
    `/capacitacion/publica/${token}/sesion`,
    { modulo },
  );
}

export function preguntarInstructorCurso(token: string, modulo: number, texto: string) {
  return post<{ respuesta: string; ia: boolean; mensajes: { rol: string; texto: string }[] }>(`/capacitacion/publica/${token}/turno`, { modulo, texto });
}

/** PDF del contenido del curso (sala pública / ficha de RH). */
export function urlPdfCursoPublico(token: string) {
  return urlArchivo(`/capacitacion/publica/${token}/pdf`);
}

export function urlPdfCurso(codigo: string) {
  return urlArchivo(`/capacitacion/${codigo}/pdf`);
}

export function responderEvaluacion(token: string, indice: number, respuesta: number) {
  return post<AsignacionPublica & { terminado: boolean; correcta: boolean | null; explicacion: string; siguiente: number | null }>(
    `/capacitacion/publica/${token}/responder`,
    { indice, respuesta },
  );
}

/* ============================================================
   Módulo 2 · Contratación e integración
   ============================================================ */

export function fetchExpedientes() {
  return get<NuevoIngreso[]>("/contratacion/expedientes");
}

export function fetchExpediente(id: number) {
  return get<NuevoIngreso>(`/contratacion/expedientes/${id}`);
}

export interface MetricasContratacion {
  expedientes: number;
  en_integracion: number;
  completos: number;
  altas: number;
  documentos_pendientes: number;
  documentos_por_revisar: number;
  progreso_promedio: number;
  listos_para_alta: { expedienteId: number; nombre: string; puesto: string }[];
}

export function fetchMetricasContratacion() {
  return get<MetricasContratacion>("/contratacion/metricas");
}

export function subirDocumento(expedienteId: number, tipo: string, archivo: File) {
  const form = new FormData();
  form.append("tipo", tipo);
  form.append("archivo", archivo);
  return subir<{
    ia: boolean;
    documento: { tipo: string; estado: string; notas: string };
    expediente: NuevoIngreso;
  }>(`/contratacion/expedientes/${expedienteId}/documentos`, form);
}

export function urlDocumento(expedienteId: number, tipo: string) {
  return urlArchivo(`/contratacion/expedientes/${expedienteId}/documentos/${encodeURIComponent(tipo)}/archivo`);
}

export function marcarDocumento(
  expedienteId: number,
  datos: { tipo: string; estado: string; notas?: string; recibidoFisico?: boolean },
) {
  return post<NuevoIngreso>(`/contratacion/expedientes/${expedienteId}/documentos/estado`, {
    tipo: datos.tipo,
    estado: datos.estado,
    notas: datos.notas ?? "",
    recibido_fisico: datos.recibidoFisico ?? false,
  });
}

export function agregarDocumento(expedienteId: number, tipo: string, obligatorio = true) {
  return post<NuevoIngreso>(`/contratacion/expedientes/${expedienteId}/documentos/agregar`, { tipo, obligatorio });
}

export function enviarRecordatorio(expedienteId: number, notificar?: NotificarAccion) {
  return post<{ enviado: boolean; pendientes?: string[]; detalle?: string; expediente: NuevoIngreso }>(
    `/contratacion/expedientes/${expedienteId}/recordatorio`,
    { notificar: notificarSnake(notificar) },
  );
}

/** `forzarPrueba` (Lote 4): inerte salvo que Modo Prueba esté activo en el servidor — el
 * bloqueo de "expediente ya dado de alta" NUNCA se salta, ni con este flag. */
export function autorizarAlta(expedienteId: number, fechaIngreso?: string, forzarPrueba = false, notificar?: NotificarAccion) {
  return post<{ ok: boolean; expediente: NuevoIngreso; notificaciones?: { destinatario: string; canal: string; destino: string; enviado: boolean; detalle?: string }[] }>(
    `/contratacion/expedientes/${expedienteId}/alta${forzarPrueba ? "?forzar_prueba=true" : ""}`,
    { fecha_ingreso: fechaIngreso ?? null, notificar: notificarSnake(notificar) },
  );
}

/** Liga de descarga de la carta de intención en PDF — mismo patrón que urlDocumento: <a href>
 * autenticado por cookie de sesión, sin manejo de blobs en el frontend. */
/** PDF crudo de la carta (lo embebe la vista /carta/[id]). */
/** 2026-09-19 (Bloque 3): contrato con las condiciones finales (solo con expediente al 100 %). */
export function urlContratoPdf(expedienteId: number) {
  return urlArchivo(`/contratacion/expedientes/${expedienteId}/contrato`);
}

export function enviarCartaIntencion(expedienteId: number, canal: "whatsapp" | "correo") {
  return post<{ canal: string; enviado: boolean; detalle: string }>(`/contratacion/expedientes/${expedienteId}/carta-intencion/enviar`, { canal });
}

export function urlCartaIntencionPdf(expedienteId: number) {
  return urlArchivo(`/contratacion/expedientes/${expedienteId}/carta-intencion`);
}

/** 2026-09-18: la carta se abre en una vista propia (título + favicon de Red Human en la pestaña) en vez
 * del PDF pelón, que el navegador mostraba con el ícono genérico. */
export function urlCartaIntencion(expedienteId: number) {
  return `/carta/${expedienteId}`;
}

/** Botón "Cancelar contratación" — cierra el expediente y regresa al candidato a Entrevista Humana. */
export function cancelarExpediente(expedienteId: number, motivo: string) {
  return post<{ ok: boolean; candidato: string }>(`/contratacion/expedientes/${expedienteId}/cancelar`, { motivo });
}

/* Liga pública del candidato para subir sus documentos (Lote 4) — sin sesión, token como
 * credencial; a diferencia de la de Entrevista Humana, no es de un solo uso. */

export interface DocumentoExpedientePublico {
  tipo: string;
  estado: "pendiente" | "revision" | "recibido" | "rechazado";
  obligatorio: boolean;
}

export interface ExpedientePublico {
  candidato: string;
  puesto: string;
  estado: "integracion" | "completo" | "alta";
  documentos: DocumentoExpedientePublico[];
  /** 2026-09-19: la carta de intención se puede descargar desde la liga pública. */
  cartaDisponible?: boolean;
}

export function urlCartaIntencionPublica(token: string) {
  return urlArchivo(`/expedientes/publica/${token}/carta-intencion`);
}

export function fetchExpedientePublico(token: string) {
  return get<ExpedientePublico>(`/expedientes/publica/${token}`);
}

export function subirDocumentoPublico(token: string, tipo: string, archivo: File) {
  const form = new FormData();
  form.append("tipo", tipo);
  form.append("archivo", archivo);
  return subir<{ ia: boolean; documento: { tipo: string; estado: string; notas: string }; expediente: NuevoIngreso }>(
    `/expedientes/publica/${token}/documentos`,
    form,
  );
}

/** Onboarding · Bloque 4 (Preparación de ingreso) — contrato, alta administrativa, equipo/accesos. */
export function actualizarPreparacion(
  expedienteId: number,
  datos: { contrato?: string; altaAdministrativa?: string; equipoAccesos?: string; documentosHasta?: string },
) {
  return patch<NuevoIngreso>(`/contratacion/expedientes/${expedienteId}/preparacion`, {
    contrato: datos.contrato,
    documentos_hasta: datos.documentosHasta,
    alta_administrativa: datos.altaAdministrativa,
    equipo_accesos: datos.equipoAccesos,
  });
}

/* ============================================================
   Métricas cruzadas y salud
   ============================================================ */

export interface AccionPendiente {
  modulo: 1 | 2;
  tipo: string;
  cantidad: number;
  texto: string;
  ruta: string;
}

export interface Pipeline {
  vacantes: { total: number; publicadas: number; borradores: number };
  candidatos: {
    total: number;
    nuevos_7d: number;
    por_etapa: Record<string, number>;
    por_estado: Record<string, number>;
    por_fuente: Record<string, number>;
    sin_consentimiento: number;
  };
  contratacion: {
    expedientes: number;
    en_integracion: number;
    listos_para_alta: number;
    altas: number;
    documentos_pendientes: number;
    documentos_por_revisar: number;
  };
  embudo: { etapa: string; valor: number; pct: number }[];
  acciones: AccionPendiente[];
}

export function fetchPipeline() {
  return get<Pipeline>("/metricas/pipeline");
}

export function fetchSalud() {
  return get<{
    ok: boolean;
    ia_configurada: boolean;
    whatsapp_configurado: boolean;
    avatar_configurado: boolean;
    modo: string;
  }>("/salud");
}

/* ============================================================
   Módulo 4 · Requisiciones inteligentes
   ============================================================ */

export type MotivoRequisicion = "Crecimiento" | "Reemplazo";
export type EstadoRequisicion =
  | "borrador"
  | "pendiente_autorizacion"
  | "autorizada"
  | "rechazada"
  | "convertida_vacante";

export interface Requisicion {
  id: string;
  solicitanteNombre: string;
  area: string;
  motivo: MotivoRequisicion;
  reemplazoDe: string;
  puesto: string;
  ubicacion: string;
  modalidad: string;
  sueldoPropuesto: string;
  habilidadesRequeridas: string[];
  requisitos: string;
  justificacion: string;
  estado: EstadoRequisicion;
  autorizadaPor: string;
  autorizadaEn: string | null;
  comentarioAutorizacion: string;
  vacante: string | null;
  totalSugerencias: number;
  creadaEn: string;
}

export type EstadoSugerencia =
  | "sugerida"
  | "notificada"
  | "interesado"
  | "no_interesado"
  | "avanzo"
  | "descartada";

export interface SugerenciaMovilidad {
  id: number;
  empleado: {
    id: string;
    nombre: string;
    puestoActual: string;
    area: string;
  };
  porcentajeMatch: number;
  habilidadesCoincidentes: string[];
  habilidadesFaltantes: string[];
  evidencia: string;
  estado: EstadoSugerencia;
  revisadoPor: string;
  creadaEn: string;
}

export interface DatosRequisicion {
  solicitanteNombre?: string;
  area?: string;
  motivo: MotivoRequisicion;
  reemplazoDe?: string;
  puesto: string;
  ubicacion?: string;
  modalidad?: string;
  sueldoPropuesto?: string;
  habilidadesRequeridas?: string[];
  requisitos?: string;
  justificacion?: string;
  enviarAAutorizacion?: boolean;
}

export function fetchRequisiciones(filtros?: { estado?: string; area?: string }) {
  const q = new URLSearchParams(
    Object.entries(filtros ?? {}).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();
  return get<Requisicion[]>(`/requisiciones${q ? `?${q}` : ""}`);
}

export function fetchRequisicion(id: string) {
  return get<Requisicion & { sugerencias: SugerenciaMovilidad[] }>(`/requisiciones/${id}`);
}

export function crearRequisicion(datos: DatosRequisicion) {
  return post<Requisicion>("/requisiciones", {
    solicitante_nombre: datos.solicitanteNombre ?? "",
    area: datos.area ?? "",
    motivo: datos.motivo,
    reemplazo_de: datos.reemplazoDe ?? "",
    puesto: datos.puesto,
    ubicacion: datos.ubicacion ?? "",
    modalidad: datos.modalidad ?? "Presencial",
    sueldo_propuesto: datos.sueldoPropuesto ?? "A convenir",
    habilidades_requeridas: datos.habilidadesRequeridas ?? [],
    requisitos: datos.requisitos ?? "",
    justificacion: datos.justificacion ?? "",
    enviar_a_autorizacion: datos.enviarAAutorizacion ?? false,
  });
}

export function enviarRequisicion(id: string) {
  return post<Requisicion>(`/requisiciones/${id}/enviar`);
}

export function autorizarRequisicion(id: string, comentario = "") {
  return post<Requisicion & { sugerenciasInternas: number }>(`/requisiciones/${id}/autorizar`, { comentario });
}

export function rechazarRequisicion(id: string, comentario = "") {
  return post<Requisicion>(`/requisiciones/${id}/rechazar`, { comentario });
}

export function decidirSugerencia(
  requisicionId: string,
  sugerenciaId: number,
  estado: EstadoSugerencia,
  comentario = "",
) {
  return post<SugerenciaMovilidad>(
    `/requisiciones/${requisicionId}/sugerencias/${sugerenciaId}/decidir`,
    { estado, comentario },
  );
}

export function convertirVacante(id: string, generarContenido = true, notas = "") {
  return post<Requisicion & { vacante: string; ia: boolean }>(`/requisiciones/${id}/convertir-vacante`, {
    generar_contenido: generarContenido,
    notas,
  });
}

/* ============================================================
   Colaboradores — alta al cierre del Onboarding
   ============================================================ */

export interface Colaborador {
  id: string;
  nombre: string;
  correo: string;
  telefono: string;
  puesto: string;
  /** 2026-09-22: área/departamento del roster maestro (permisos de Conocimiento, tableros de Desempeño y Clima). */
  area?: string;
  salario: string;
  empresa: string;
  ubicacion: string;
  jefeDirecto: string;
  estatus: "Activo" | "Inactivo";
  cvNombre: string;
  tieneCv: boolean;
  fechaIngreso: string | null;
  activo: boolean;
  dadoDeAltaPor: string;
  candidatoOrigenId: string | null;
  expedienteId: number | null;
  /** Fase 5: Cliente para el que se contrató (null = directo). */
  clienteId?: number | null;
  clienteNombre?: string | null;
  creado: string;
  /** baja / eliminación lógica (2026-09-15) */
  bajaEn?: string | null;
  bajaMotivo?: string;
  bajaPor?: string;
  eliminadoEn?: string | null;
}

/** 2026-09-15: contador real del sidebar («Agente activo»). */
export function fetchActividadAgente() {
  return get<{ prefiltrando: number; enPrefiltro: number }>("/candidatos/agente/actividad");
}

/** Perfil completo del colaborador (panel de Colaboradores). */
export interface ColaboradorDetalle extends Colaborador {
  tipoContratacion: string;
  instruccionesIngreso: string;
  altaAutorizadaPor: string;
  altaFecha: string | null;
  expediente: NuevoIngreso | null;
  candidatoOrigen: { codigo: string; nombre: string; fuente: string; correo: string; telefono: string; eliminado: boolean } | null;
  vacante: { codigo: string; titulo: string } | null;
}

export function fetchColaborador(codigo: string) {
  return get<ColaboradorDetalle>(`/colaboradores/${codigo}`);
}

/** Baja: activo=false conservando historial (reversible con reactivarColaborador). */
export function darDeBajaColaborador(codigo: string, motivo: string) {
  return post<ColaboradorDetalle>(`/colaboradores/${codigo}/baja`, { motivo });
}

export function reactivarColaborador(codigo: string) {
  return post<ColaboradorDetalle>(`/colaboradores/${codigo}/reactivar`);
}

/** Eliminación LÓGICA total (limpieza de pruebas): desaparece de listados y conteos; la fila se conserva. */
export function eliminarColaborador(codigo: string) {
  return eliminar<{ ok: boolean; colaborador: string }>(`/colaboradores/${codigo}`);
}

/** Fase 5: opciones del filtro por Cliente (solo Clientes con colaboradores; id 0 = directo). */
export function fetchClientesColaboradores() {
  return get<{ id: number; nombre: string; colaboradores: number }[]>("/colaboradores/clientes");
}

export function fetchColaboradores(activo?: boolean, clienteId?: number | null) {
  const params = new URLSearchParams();
  if (activo !== undefined) params.set("activo", String(activo));
  if (clienteId !== undefined && clienteId !== null) params.set("cliente_id", String(clienteId));
  const q = params.toString();
  return get<Colaborador[]>(`/colaboradores${q ? `?${q}` : ""}`);
}

/* ============================================================
   Fase F · Agente global "Pregunta a Red Human" (punto 29)

   Sin persistencia de conversación en el backend (decisión de privacidad, Q6): el frontend
   manda el historial completo en cada pregunta y lo guarda solo en memoria del navegador.
   ============================================================ */

export type PantallaAgente =
  | "tablero" | "vacantes" | "vacante" | "candidatos" | "candidato"
  | "entrevistas" | "onboarding" | "configuracion";

export interface EntidadContextoAgente {
  tipo: "candidato" | "vacante";
  codigo: string;
}

export interface ContextoAgente {
  pantalla: PantallaAgente | string;
  entidad?: EntidadContextoAgente | null;
}

export interface TurnoAgente {
  rol: "user" | "assistant";
  texto: string;
}

export interface AccionPropuestaAgente {
  tool: string;
  argumentos: Record<string, unknown>;
  resumen: string;
}

export interface RespuestaAgente {
  texto: string;
  navegacion: { ruta: string; etiqueta: string }[];
  accionPropuesta: AccionPropuestaAgente | null;
  uso: { mensajesHoy: number; limite: number };
}

export function preguntarAgente(
  mensaje: string,
  historial: TurnoAgente[],
  contexto: ContextoAgente | null,
  alcance: "cuenta" | "todas_mis_cuentas" = "cuenta",
) {
  return post<RespuestaAgente>("/agente/preguntar", { mensaje, historial, contexto, alcance });
}

/** Ejecuta una acción ya confirmada por la persona en el panel — nunca se llama sin que medie
 * un clic explícito de "Confirmar" sobre la tarjeta de `accionPropuesta`. */
export function ejecutarAccionAgente(tool: string, argumentos: Record<string, unknown>) {
  return post<Record<string, unknown>>("/agente/ejecutar", { tool, argumentos });
}

export function fetchUsoAgente() {
  return get<{ mensajesHoy: number; limite: number }>("/agente/uso");
}

/* ============================================================
   Fase 7B · Integraciones — Microsoft Teams / Microsoft 365 (por Cuenta)
   ============================================================ */

export interface IntegracionTeams {
  /** false = el servidor no tiene TEAMS_CLIENT_ID/TENANT_ID/CLIENT_SECRET (modo seguro: liga manual). */
  disponible: boolean;
  conectado: boolean;
  usuarioM365: string;
  nombreM365: string;
  conectadoPor: string;
  conectadoEn: string | null;
  expiraEn: string | null;
  ultimoError: string;
  /** Lo que hay que registrar como Redirect URI en el App Registration de Azure. */
  redirectUri: string;
  scopes: string;
}

export function fetchIntegracionTeams() {
  return get<IntegracionTeams>("/integraciones/teams");
}

/** Regresa la URL de autorización de Microsoft; el llamador navega ahí (window.location). */
export function conectarTeams() {
  return post<{ url: string; redirectUri: string }>("/integraciones/teams/conectar");
}

export function probarTeams() {
  return post<{ ok: boolean; usuarioM365: string; nombreM365: string }>("/integraciones/teams/probar");
}

export function desconectarTeams() {
  return eliminar<{ ok: boolean }>("/integraciones/teams");
}

/* ============================================================
   Base de conocimiento con RAG (2026-09-18)
   ============================================================ */

export interface DocumentoConocimiento {
  id: number;
  titulo: string;
  tipo: string;
  nombreArchivo: string;
  caracteres: number;
  fragmentos: number;
  conEmbeddings: boolean;
  activo: boolean;
  creadoPor: string;
  creadoEn: string | null;
  extracto: string;
  /** 2026-09-22 (permisos): publicado + a qué áreas/puestos se muestra (vacío = toda la empresa). */
  publicado?: boolean;
  areas?: string[];
  puestos?: string[];
}

export interface EstadoConocimiento {
  documentos: number;
  fragmentos: number;
  semantico: boolean;
  iaActiva: boolean;
  consultas: number;
  consultasSinEvidencia: number;
  tipos: string[];
}

export interface RespuestaConocimiento {
  respuesta: string;
  pasos: string[];
  fuentes: { documento: string; cita: string }[];
  confianza: "alta" | "media" | "baja";
  sin_evidencia: boolean;
  ia: boolean;
  modo: string;
  fragmentos: { documentoId: number; documento: string; tipo: string; orden: number; puntaje: number; texto: string }[];
  creadoEn: string;
}

export function fetchDocumentosConocimiento() {
  return get<DocumentoConocimiento[]>("/conocimiento/documentos");
}

export function fetchEstadoConocimiento() {
  return get<EstadoConocimiento>("/conocimiento/estado");
}

export function subirDocumentosConocimiento(datos: { titulo?: string; tipo?: string; texto?: string; archivos?: File[] }) {
  const form = new FormData();
  form.append("titulo", datos.titulo ?? "");
  form.append("tipo", datos.tipo ?? "politica");
  form.append("texto", datos.texto ?? "");
  for (const f of datos.archivos ?? []) form.append("archivos", f);
  return subir<DocumentoConocimiento[]>("/conocimiento/documentos", form);
}

export function eliminarDocumentoConocimiento(id: number) {
  return eliminar<{ ok: boolean }>(`/conocimiento/documentos/${id}`);
}

export function reindexarDocumentoConocimiento(id: number) {
  return post<DocumentoConocimiento>(`/conocimiento/documentos/${id}/reindexar`, {});
}

export function preguntarConocimiento(pregunta: string, historial: { rol: string; texto: string }[] = [], colaboradorId = "") {
  // `colaboradorId` (COL-####) = responder con los permisos de esa persona; vacío = sesión de RH.
  return post<RespuestaConocimiento>("/conocimiento/preguntar", { pregunta, historial, colaborador_id: colaboradorId || null });
}

export function fetchConsultasConocimiento() {
  return get<{ id: number; usuario: string; pregunta: string; sinEvidencia: boolean; modo: string; creadoEn: string | null }[]>("/conocimiento/consultas");
}


/* ============================================================
   Desempeño · Clima · Conocimiento (permisos) — 2026-09-23
   La persona SIEMPRE viene del roster de Colaboradores (base maestra): estos módulos solo mandan
   códigos COL-####; nunca capturan gente.
   ============================================================ */

export interface ObjetivoDesempeno { titulo: string; descripcion?: string; peso?: number }
export interface KpiDesempeno { nombre: string; descripcion?: string; unidad?: string; meta?: string; peso?: number }
export interface CicloDesempeno {
  id: string;
  nombre: string;
  periodo: string;
  descripcion: string;
  puestoObjetivo: string;
  objetivos: ObjetivoDesempeno[];
  kpis: KpiDesempeno[];
  escalaMaxima: number;
  generadoConIa: boolean;
  estado: "borrador" | "en_curso" | "cerrado" | string;
  participantes: number;
  completadas: number;
  avance: number;
  creadoPor: string;
  creado: string;
  creadoEn: string | null;
  cerradoEn: string | null;
  evaluaciones?: EvaluacionDesempeno[];
}
export interface ResultadoDesempeno { tipo: "objetivo" | "kpi" | string; nombre: string; meta?: string; real?: string; logro?: number | null; peso?: number; comentario?: string }
export interface BrechaDesempeno { tema: string; brecha?: string; accion_sugerida?: string }
export interface EvaluacionDesempeno {
  id: string;
  cicloId: string;
  ciclo: string;
  periodo: string;
  colaboradorId: string | null;
  colaborador: string;
  puesto: string;
  area: string;
  evaluador: string;
  estado: "pendiente" | "en_curso" | "completada" | string;
  calificacion: number | null;
  escalaMaxima: number;
  brechas: BrechaDesempeno[];
  creadoEn: string | null;
  completadaEn: string | null;
  resultados?: ResultadoDesempeno[];
  comentarios?: string;
  objetivos?: ObjetivoDesempeno[];
  kpis?: KpiDesempeno[];
}
export interface ResultadosCiclo {
  ciclo: CicloDesempeno;
  total: number;
  completadas: number;
  avance: number;
  promedio: number | null;
  escalaMaxima: number;
  ranking: EvaluacionDesempeno[];
  pendientes: EvaluacionDesempeno[];
  brechas: { tema: string; personas: number; acciones: string[]; colaboradores: string[] }[];
  fortalezas: { tema: string; personas: number; promedio: number }[];
}

export function generarPlanDesempeno(datos: { puesto?: string; periodo?: string; contexto?: string }) {
  return post<{ objetivos: ObjetivoDesempeno[]; kpis: KpiDesempeno[]; generadoConIa: boolean }>("/desempeno/ciclos/generar", {
    puesto: datos.puesto ?? "", periodo: datos.periodo ?? "", contexto: datos.contexto ?? "",
  });
}
export function crearCicloDesempeno(datos: {
  nombre: string; periodo?: string; descripcion?: string; puestoObjetivo?: string;
  objetivos: ObjetivoDesempeno[]; kpis: KpiDesempeno[]; escalaMaxima?: number; generadoConIa?: boolean;
}) {
  return post<CicloDesempeno>("/desempeno/ciclos", {
    nombre: datos.nombre, periodo: datos.periodo ?? "", descripcion: datos.descripcion ?? "",
    puesto_objetivo: datos.puestoObjetivo ?? "", objetivos: datos.objetivos, kpis: datos.kpis,
    escala_maxima: datos.escalaMaxima ?? 100, generado_con_ia: datos.generadoConIa ?? false,
  });
}
export function fetchCiclosDesempeno() {
  return get<CicloDesempeno[]>("/desempeno/ciclos");
}
export function fetchCicloDesempeno(codigo: string) {
  return get<CicloDesempeno>(`/desempeno/ciclos/${codigo}`);
}
export function cambiarEstadoCiclo(codigo: string, estado: "borrador" | "en_curso" | "cerrado") {
  return patch<CicloDesempeno>(`/desempeno/ciclos/${codigo}`, { estado });
}
export function agregarParticipantesDesempeno(codigo: string, colaboradorIds: string[], evaluador = "") {
  return post<{ ciclo: CicloDesempeno; evaluaciones: EvaluacionDesempeno[]; noEncontrados: string[] }>(
    `/desempeno/ciclos/${codigo}/participantes`, { colaborador_ids: colaboradorIds, evaluador },
  );
}
export function fetchEvaluacionDesempeno(codigo: string) {
  return get<EvaluacionDesempeno>(`/desempeno/evaluaciones/${codigo}`);
}
export function guardarEvaluacionDesempeno(codigo: string, datos: { resultados: ResultadoDesempeno[]; brechas?: BrechaDesempeno[]; comentarios?: string; completar?: boolean }) {
  return patch<EvaluacionDesempeno>(`/desempeno/evaluaciones/${codigo}`, {
    resultados: datos.resultados, brechas: datos.brechas ?? [], comentarios: datos.comentarios ?? "", completar: datos.completar ?? false,
  });
}
export function fetchResultadosCiclo(codigo: string) {
  return get<ResultadosCiclo>(`/desempeno/ciclos/${codigo}/resultados`);
}

/* -------------------- Clima -------------------- */

export type TipoPreguntaClima = "escala" | "opcion" | "abierta";
export interface PreguntaClima { id: string; texto: string; tipo: TipoPreguntaClima; opciones?: string[]; escala_max?: number }
export interface MedicionClima {
  id: string;
  titulo: string;
  descripcion: string;
  anonima: boolean;
  permiteExternos: boolean;
  estado: "borrador" | "abierta" | "cerrada" | string;
  preguntas: number;
  respuestas: number;
  liga: string;
  abiertaEn: string | null;
  cierraEn: string | null;
  creadoPor: string;
  creado: string;
  cuestionario?: PreguntaClima[];
}
export interface ResultadosClima {
  medicion: MedicionClima;
  totalRespuestas: number;
  colaboradoresActivos: number;
  participacion: number | null;
  externos: number;
  porPregunta: {
    id: string; texto: string; tipo: TipoPreguntaClima; respuestas: number;
    promedio?: number | null; escalaMax?: number; distribucion?: Record<string, number>; textos?: string[];
  }[];
}

export function crearMedicionClima(datos: { titulo: string; descripcion?: string; preguntas: PreguntaClima[]; anonima: boolean; permiteExternos: boolean; cierraEn?: string }) {
  return post<MedicionClima>("/clima/mediciones", {
    titulo: datos.titulo, descripcion: datos.descripcion ?? "", preguntas: datos.preguntas,
    anonima: datos.anonima, permite_externos: datos.permiteExternos, cierra_en: datos.cierraEn || null,
  });
}
export function fetchMedicionesClima() {
  return get<MedicionClima[]>("/clima/mediciones");
}
export function fetchMedicionClima(codigo: string) {
  return get<MedicionClima>(`/clima/mediciones/${codigo}`);
}
export function cambiarEstadoMedicion(codigo: string, estado: "borrador" | "abierta" | "cerrada") {
  return patch<MedicionClima>(`/clima/mediciones/${codigo}/estado`, { estado });
}
export function regenerarLigaClima(codigo: string) {
  return post<{ liga: string; medicion: MedicionClima }>(`/clima/mediciones/${codigo}/liga`, {});
}
export function invitarAClima(codigo: string, colaboradorIds: string[], mensaje = "") {
  return post<{ liga: string; invitados: { colaborador: string; nombre: string; correo: { enviado: boolean; detalle?: string } | null; whatsapp: { enviado: boolean; detalle?: string } | null }[]; noEncontrados: string[] }>(
    `/clima/mediciones/${codigo}/invitar`, { colaborador_ids: colaboradorIds, mensaje },
  );
}
export function responderClimaInterno(codigo: string, datos: { respuestas: Record<string, unknown>; colaboradorId?: string }) {
  return post<{ guardada: boolean; anonima: boolean }>(`/clima/mediciones/${codigo}/responder`, {
    respuestas: datos.respuestas, colaborador_id: datos.colaboradorId ?? "",
  });
}
export function fetchResultadosClima(codigo: string) {
  return get<ResultadosClima>(`/clima/mediciones/${codigo}/resultados`);
}

/* -------------------- Conocimiento: generación y permisos -------------------- */

export function generarDocumentoConocimiento(datos: { tema: string; tipo?: string; notas?: string }) {
  return post<{ titulo: string; texto: string; avisos: string[]; generadoConIa: boolean }>("/conocimiento/generar", {
    tema: datos.tema, tipo: datos.tipo ?? "politica", notas: datos.notas ?? "",
  });
}
export function fetchAreasConocimiento() {
  return get<{ areas: string[]; puestos: string[] }>("/conocimiento/areas");
}
export function guardarPermisosConocimiento(id: number, datos: { publicado?: boolean; areas?: string[]; puestos?: string[] }) {
  return patch<DocumentoConocimiento>(`/conocimiento/documentos/${id}/permisos`, datos);
}

/* -------------------- Clima: liga pública (sin sesión) -------------------- */

export interface MedicionClimaPublica {
  id: string;
  titulo: string;
  descripcion: string;
  anonima: boolean;
  permiteExternos: boolean;
  abierta: boolean;
  preguntas: PreguntaClima[];
  aviso: string;
}

export function fetchMedicionPublica(token: string) {
  return get<MedicionClimaPublica>(`/clima/publica/${token}`);
}

export function responderClimaPublica(
  token: string,
  datos: { respuestas: Record<string, unknown>; colaboradorId?: string; externoNombre?: string; externoCorreo?: string },
) {
  return post<{ guardada: boolean; anonima: boolean }>(`/clima/publica/${token}/responder`, {
    respuestas: datos.respuestas,
    colaborador_id: datos.colaboradorId ?? "",
    externo_nombre: datos.externoNombre ?? "",
    externo_correo: datos.externoCorreo ?? "",
  });
}
