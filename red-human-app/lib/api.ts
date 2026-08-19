/* ============================================================
   Cliente de la API de Red Human (FastAPI).

   · Lecturas (`get`): regresan null si el backend no responde, para que las
     pantallas sigan funcionando con los datos de demostración.
   · Mutaciones (`post`/`patch`/`subir`): regresan Resultado<T> con el mensaje
     de error de la API, porque la validación de archivos y las reglas de
     human-in-the-loop tienen que verse en pantalla.
   ============================================================ */

import type { Candidato, Vacante } from "@/lib/data";
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

async function get<T>(ruta: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${ruta}`, { cache: "no-store", credentials: "include" });
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
    const r = await fetch(`${API}${ruta}`, { ...init, credentials: "include" });
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

export function urlArchivo(ruta: string) {
  return `${API}${ruta}`;
}

/* ============================================================
   Autenticación
   ============================================================ */

export type RolUsuario = "admin" | "rh" | "lectura";

export interface UsuarioRH {
  id: number;
  correo: string;
  nombre: string;
  puesto: string;
  rol: RolUsuario;
  activo: boolean;
  debeCambiarPass: boolean;
  puedeDecidir: boolean;
  ultimoAcceso: string | null;
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
  rol?: RolUsuario;
  password: string;
}) {
  return post<UsuarioRH>("/auth/usuarios", datos);
}

export function actualizarUsuario(
  id: number,
  cambios: { nombre?: string; puesto?: string; rol?: RolUsuario; activo?: boolean; password?: string },
) {
  return patch<UsuarioRH>(`/auth/usuarios/${id}`, cambios);
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
}

export interface DatosVacante {
  titulo: string;
  area?: string;
  ubicacion?: string;
  sueldo?: string;
  requisitos?: string;
  empresa?: string;
  modalidad?: string;
  notas?: string;
}

export function fetchVacantes() {
  return get<Vacante[]>("/vacantes");
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
    publicaciones?: Record<string, BloquePlataforma>;
    publicar?: boolean;
    plataformas?: string[];
    generar_si_falta?: boolean;
  },
) {
  return post<Vacante>("/vacantes", datos);
}

export function actualizarVacante(codigo: string, cambios: Record<string, unknown>) {
  return patch<Vacante>(`/vacantes/${codigo}`, cambios);
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

export function fetchCandidatos(filtros?: { vacante?: string; etapa?: string; estado?: string }) {
  const q = new URLSearchParams(
    Object.entries(filtros ?? {}).filter(([, v]) => Boolean(v)) as [string, string][],
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

export function decidirCandidato(codigo: string, accion: "avanzar" | "descartar", comentario = "") {
  return post<Candidato>(`/candidatos/${codigo}/decision`, { accion, comentario });
}

export function asignarVacante(codigo: string, vacante: string) {
  return post<Candidato>(`/candidatos/${codigo}/asignar`, { vacante, reevaluar: true });
}

/** Puente Módulo 1 → Módulo 2: abre el expediente de contratación. */
export function seleccionarCandidato(
  codigo: string,
  datos: { fechaIngreso?: string; documentos?: string[]; avisarWhatsapp?: boolean },
) {
  return post<Candidato & { expediente_id: number; expediente: NuevoIngreso }>(
    `/candidatos/${codigo}/seleccionar`,
    {
      fecha_ingreso: datos.fechaIngreso ?? null,
      documentos: datos.documentos ?? [],
      avisar_whatsapp: datos.avisarWhatsapp ?? true,
    },
  );
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

export interface EvaluacionEntrevista {
  resumen: string;
  fortalezas: string[];
  riesgos: string[];
  calif_experiencia: number;
  calif_comunicacion: number;
  match_perfil: number;
  recomendacion: "avanzar" | "revision" | "no_avanzar";
  evidencia: string;
}

export interface Entrevista {
  id: string;
  candidatoId: string;
  nombre: string;
  puesto: string;
  tipo: "avatar" | "texto";
  estado: "programada" | "en_curso" | "completada" | "evaluada";
  token: string;
  consentimiento: boolean;
  programada: string | null;
  creada: string;
  guion: { enfoque?: string; preguntas?: string[] };
  mensajes: number;
  evaluacion: EvaluacionEntrevista | null;
  tono: number;
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
  consentimiento: boolean;
  avatar_disponible: boolean;
}

export function fetchEntrevistaPublica(token: string) {
  return get<EntrevistaPublica>(`/entrevistas/publica/${token}`);
}

export function consentirEntrevista(token: string) {
  return post<{ ok: boolean }>(`/entrevistas/publica/${token}/consentimiento`, { acepta: true });
}

export function iniciarEntrevista(token: string) {
  return post<{ modo: "avatar" | "texto"; session_token?: string; mensajes?: { rol: string; texto: string }[] }>(
    `/entrevistas/publica/${token}/sesion`,
  );
}

export function turnoEntrevista(token: string, texto: string) {
  return post<{ respuesta: string; terminada: boolean; ia: boolean }>(
    `/entrevistas/publica/${token}/turno`,
    { texto },
  );
}

export function finalizarEntrevista(token: string, transcript?: { rol: string; texto: string }[]) {
  return post<Entrevista>(`/entrevistas/publica/${token}/finalizar`, { transcript: transcript ?? null });
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

export function enviarRecordatorio(expedienteId: number) {
  return post<{ enviado: boolean; pendientes?: string[]; detalle?: string; expediente: NuevoIngreso }>(
    `/contratacion/expedientes/${expedienteId}/recordatorio`,
  );
}

export function autorizarAlta(expedienteId: number, fechaIngreso?: string) {
  return post<{ ok: boolean; expediente: NuevoIngreso }>(`/contratacion/expedientes/${expedienteId}/alta`, {
    fecha_ingreso: fechaIngreso ?? null,
    avisar_whatsapp: true,
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
