/* ============================================================
   Datos de ejemplo — Red Human AI · Fase 2
   Onboarding · Capacitación · Desempeño · Clima
   ============================================================ */

/* -------------------- Onboarding (3.11) -------------------- */
export type EstadoDoc = "recibido" | "revision" | "pendiente" | "rechazado";

export interface ValidacionDoc {
  tipoDetectado?: string | null;
  coincideTipo?: boolean | null;
  legible?: boolean | null;
  completo?: boolean | null;
  vigente?: boolean | null;
  coincideTitular?: boolean | null;
  motivoRechazo?: string | null;
}

export interface DocExpediente {
  nombre: string;
  estado: EstadoDoc;
  /* presentes cuando vienen de la API */
  obligatorio?: boolean;
  notas?: string;
  archivo?: string;
  tieneArchivo?: boolean;
  mime?: string;
  tamano?: number;
  subido?: string;
  revisadoPor?: string;
  validacion?: ValidacionDoc | null;
}

export interface NuevoIngreso {
  id: string;
  nombre: string;
  puesto: string;
  ubicacion: string;
  ingreso: string;
  progreso: number;
  tono: number;
  documentos: DocExpediente[];
  /* --- presentes cuando vienen de la API --- */
  expedienteId?: number;
  estado?: "integracion" | "completo" | "alta" | string;
  fechaIngreso?: string | null;
  /* --- condiciones finales de contratación, capturadas en la etapa Contratación --- */
  sueldo?: string;
  tipoContratacion?: string;
  ubicacionTrabajo?: string;
  jefeDirecto?: string;
  /* --- preparación de ingreso (Onboarding, bloque 4) --- */
  contrato?: "Pendiente" | "Firmado";
  altaAdministrativa?: "Pendiente" | "Realizada";
  equipoAccesos?: "Pendiente" | "Listo" | "No aplica";
  pendientes?: string[];
  porRevisar?: string[];
  sinConfirmar?: string[];
  listoParaAlta?: boolean;
  /* puentes hacia el módulo 1 */
  candidatoId?: string;
  telefono?: string;
  correo?: string;
  vacanteId?: string;
  score?: number;
  entrevistaMatch?: number | null;
  entrevistaRecomendacion?: string | null;
  /* --- Bloque 2 (resumen de evaluación) --- */
  evaluacion?: {
    score: number;
    requisitosCumplidos: string[];
    brechas: string[];
    alertas: string[];
    evidencia: string;
  } | null;
  /* trazabilidad HITL */
  seleccionadoPor?: string;
  altaAutorizadaPor?: string;
  altaFecha?: string | null;
  creado?: string;
}

export const nuevosIngresos: NuevoIngreso[] = [
  {
    id: "N-501",
    nombre: "Emiliano Cruz Vega",
    puesto: "Auxiliar de almacén",
    ubicacion: "Monterrey, NL",
    ingreso: "Ingresa el 22 jul",
    progreso: 80,
    tono: 2,
    documentos: [
      { nombre: "INE", estado: "recibido" },
      { nombre: "CURP", estado: "recibido" },
      { nombre: "RFC", estado: "recibido" },
      { nombre: "Comprobante de domicilio", estado: "pendiente" },
      { nombre: "NSS", estado: "revision" },
    ],
  },
  {
    id: "N-502",
    nombre: "Gabriela Ruiz Ponce",
    puesto: "Analista de nómina",
    ubicacion: "Querétaro, QRO",
    ingreso: "Ingresa el 24 jul",
    progreso: 60,
    tono: 1,
    documentos: [
      { nombre: "INE", estado: "recibido" },
      { nombre: "CURP", estado: "recibido" },
      { nombre: "RFC", estado: "revision" },
      { nombre: "Comprobante de domicilio", estado: "pendiente" },
      { nombre: "Título profesional", estado: "pendiente" },
    ],
  },
  {
    id: "N-503",
    nombre: "Luis Ángel Torres",
    puesto: "Desarrollador Full-Stack",
    ubicacion: "Remoto (MX)",
    ingreso: "Ingresa el 1 ago",
    progreso: 100,
    tono: 2,
    documentos: [
      { nombre: "INE", estado: "recibido" },
      { nombre: "CURP", estado: "recibido" },
      { nombre: "RFC", estado: "recibido" },
      { nombre: "Comprobante de domicilio", estado: "recibido" },
      { nombre: "NSS", estado: "recibido" },
    ],
  },
];

/* -------------------- Capacitación (3.14) -------------------- */
export interface Curso {
  id: string;
  titulo: string;
  categoria: string;
  duracion: string;
  modulos: number;
  inscritos: number;
  completado: number;
  estado: "Publicado" | "Borrador";
  obligatorio: boolean;
}

export const cursos: Curso[] = [
  { id: "CUR-01", titulo: "Inducción a Grupo Carbe", categoria: "Onboarding", duracion: "2 h", modulos: 6, inscritos: 142, completado: 88, estado: "Publicado", obligatorio: true },
  { id: "CUR-02", titulo: "Manejo de efectivo y arqueo", categoria: "Operaciones", duracion: "1.5 h", modulos: 4, inscritos: 96, completado: 74, estado: "Publicado", obligatorio: true },
  { id: "CUR-03", titulo: "Atención al cliente y ventas", categoria: "Comercial", duracion: "3 h", modulos: 8, inscritos: 210, completado: 61, estado: "Publicado", obligatorio: false },
  { id: "CUR-04", titulo: "Seguridad e higiene (NOM-035)", categoria: "Cumplimiento", duracion: "2 h", modulos: 5, inscritos: 318, completado: 92, estado: "Publicado", obligatorio: true },
  { id: "CUR-05", titulo: "Prevención de lavado de dinero", categoria: "Cumplimiento", duracion: "1 h", modulos: 3, inscritos: 54, completado: 40, estado: "Publicado", obligatorio: false },
  { id: "CUR-06", titulo: "Liderazgo para supervisores", categoria: "Desarrollo", duracion: "4 h", modulos: 10, inscritos: 0, completado: 0, estado: "Borrador", obligatorio: false },
];

export const capacitacionKpis = [
  { label: "Cursos activos", value: "18", tone: "brand" },
  { label: "Colaboradores en formación", value: "624", tone: "human" },
  { label: "Tasa de finalización", value: "78%", tone: "good" },
  { label: "Horas impartidas (mes)", value: "1,940", tone: "brand" },
];

/* -------------------- Desempeño (3.15) -------------------- */
export const competencias = [
  { competencia: "Conocimiento técnico", valor: 82, meta: 80 },
  { competencia: "Comunicación", valor: 74, meta: 75 },
  { competencia: "Trabajo en equipo", valor: 88, meta: 80 },
  { competencia: "Orientación a resultados", valor: 79, meta: 85 },
  { competencia: "Adaptabilidad", valor: 71, meta: 70 },
  { competencia: "Servicio al cliente", valor: 85, meta: 80 },
];

export const kpisDesempeno = [
  { kpi: "Ventas vs meta", actual: 112, meta: 100, unidad: "%", tone: "good" },
  { kpi: "Satisfacción cliente (CSAT)", actual: 4.6, meta: 4.5, unidad: "/5", tone: "good" },
  { kpi: "Tiempo de atención", actual: 3.8, meta: 3.5, unidad: "min", tone: "warn" },
  { kpi: "Ausentismo", actual: 2.1, meta: 3.0, unidad: "%", tone: "good" },
];

export const equipoDesempeno = [
  { nombre: "Jorge Alberto Ramírez", puesto: "Ejecutivo de ventas", score: 92, tendencia: "up", tono: 0 },
  { nombre: "Gabriela Ruiz Ponce", puesto: "Analista de nómina", score: 87, tendencia: "up", tono: 1 },
  { nombre: "María Fernanda López", puesto: "Cajera de sucursal", score: 81, tendencia: "flat", tono: 1 },
  { nombre: "Emiliano Cruz Vega", puesto: "Auxiliar de almacén", score: 74, tendencia: "up", tono: 2 },
  { nombre: "Ana Sofía Herrera", puesto: "Auxiliar de almacén", score: 63, tendencia: "down", tono: 3 },
];

export const brechas = [
  { competencia: "Orientación a resultados", brecha: 6, accion: "Curso: técnicas de cierre de ventas" },
  { competencia: "Comunicación", brecha: 1, accion: "Taller de comunicación efectiva" },
];

/* -------------------- Clima (3.16) -------------------- */
export const climaScore = 78;

export const climaTrend = [
  { mes: "Feb", score: 71 },
  { mes: "Mar", score: 73 },
  { mes: "Abr", score: 70 },
  { mes: "May", score: 74 },
  { mes: "Jun", score: 76 },
  { mes: "Jul", score: 78 },
];

export const climaDimensiones = [
  { dim: "Ambiente de trabajo", valor: 84 },
  { dim: "Liderazgo", valor: 72 },
  { dim: "Reconocimiento", valor: 68 },
  { dim: "Balance vida-trabajo", valor: 75 },
  { dim: "Crecimiento", valor: 70 },
  { dim: "Compensación", valor: 66 },
];

export type NivelSenal = "alto" | "medio" | "bajo";

export interface SenalClima {
  id: string;
  colaborador: string;
  puesto: string;
  nivel: NivelSenal;
  senal: string;
  detectado: string;
  tono: number;
}

export const climaSenales: SenalClima[] = [
  { id: "S-01", colaborador: "Ana Sofía Herrera", puesto: "Auxiliar de almacén", nivel: "alto", senal: "Menciones repetidas de carga de trabajo y desmotivación en las últimas 2 conversaciones.", detectado: "hace 1 día", tono: 3 },
  { id: "S-02", colaborador: "Roberto Nava", puesto: "Ejecutivo de ventas", nivel: "medio", senal: "Baja en el tono positivo respecto al mes anterior; comentarios sobre reconocimiento.", detectado: "hace 3 días", tono: 0 },
  { id: "S-03", colaborador: "Diana Karen Méndez", puesto: "Cajera de sucursal", nivel: "bajo", senal: "Cambio leve en disponibilidad; sin señales de riesgo por ahora.", detectado: "hace 5 días", tono: 1 },
];

export const climaKpis = [
  { label: "Índice de clima", value: "78", tone: "good" },
  { label: "Participación en pulsos", value: "86%", tone: "brand" },
  { label: "Señales activas", value: "3", tone: "warn" },
  { label: "Rotación (mes)", value: "2.1%", tone: "good" },
];
