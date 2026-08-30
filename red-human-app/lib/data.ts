/* ============================================================
   Datos de ejemplo — Red Human AI (Fase 1)
   Realistas para México. Sustituir por API real en producción.
   ============================================================ */

export type EstadoPrefiltro = "cumple" | "revision" | "no_cumple" | "pendiente";
export type FuenteCandidato = "Formulario" | "WhatsApp" | "OCC" | "LinkedIn" | "Indeed" | "RH";

export type EtapaCandidato =
  | "Prefiltro"
  | "Entrevista IA"
  | "Evaluación"
  | "Entrevista Humana"
  | "Contratación"
  | "Onboarding";

export interface RespuestaPrefiltro {
  criterio?: string;
  pregunta?: string;
  respuesta?: string;
  cumple?: boolean | null;
}

export interface Candidato {
  id: string;
  nombre: string;
  puesto: string;
  vacanteId: string;
  fuente: FuenteCandidato;
  estado: EstadoPrefiltro;
  etapa: EtapaCandidato;
  score: number; // 0-100 match con el perfil
  experiencia: string;
  ubicacion: string;
  aplicado: string; // fecha relativa
  tono: number;
  evidencia: string;
  /* --- presentes cuando vienen de la API --- */
  telefono?: string;
  correo?: string;
  consentimiento?: boolean;
  prefiltroCompleto?: boolean;
  /* puentes hacia los otros módulos */
  expedienteId?: number | null;
  expedienteProgreso?: number | null;
  expedienteEstado?: string | null;
  entrevistaId?: string | null;
  entrevistaEstado?: string | null;
  entrevistaMatch?: number | null;
  entrevistaRecomendacion?: string | null;
  archivos?: number;
  mensajes?: number;
  /* solo en el detalle (GET /candidatos/{codigo}) */
  cvDatos?: Record<string, unknown>;
  analisis?: {
    origen?: string;
    ia?: boolean;
    requisitos_cumplidos?: string[];
    brechas?: string[];
    alertas?: string[];
    datos_faltantes?: string[];
    respuestas_prefiltro?: RespuestaPrefiltro[];
    [key: string]: unknown;
  };
  listaArchivos?: {
    id: number;
    tipo: string;
    nombre: string;
    mime: string;
    tamano: number;
    estado: "recibido" | "revision" | "rechazado";
    notas: string;
    subidoPor: string;
    subido: string;
  }[];
  vacante?: { id: string; titulo: string; requisitos: string; preguntas: string[] } | null;
  entrevistas?: { id: string; estado: string; tipo: string; token: string; evaluacion: unknown; creada: string }[];
  consentimientoFecha?: string | null;
}

export interface BloquePublicacion {
  titulo: string;
  copy: string;
  page: string;
  etiquetas: string[];
}

export interface Vacante {
  id: string;
  titulo: string;
  area: string;
  empresa: string;
  ubicacion: string;
  modalidad: "Presencial" | "Híbrido" | "Remoto";
  sueldo: string;
  estado: "Publicada" | "Borrador" | "En revisión" | "Cerrada";
  candidatos: number;
  nuevos: number;
  publicada: string;
  plataformas: string[];
  /* --- presentes cuando vienen de la API --- */
  slug?: string;
  descripcion?: string;
  requisitos?: string;
  preguntas_filtro?: string[];
  resumen?: string;
  perfilIdeal?: string;
  responsabilidades?: string[];
  requisitosDeseables?: string[];
  beneficios?: string[];
  palabrasClave?: string[];
  seniority?: string;
  avisosCumplimiento?: string[];
  publicaciones?: Record<string, BloquePublicacion>;
  textoWhatsapp?: string;
  textoBolsa?: string;
  criterios?: {
    pregunta: string;
    tipo: string;
    valida: string;
    respuesta_esperada: string;
    descarta: boolean;
  }[];
  embudo?: { etapas?: Record<string, number>; estados?: Record<string, number> };
  creada?: string;
  actualizada?: string;
}

export const kpis = [
  { label: "Vacantes activas", value: "24", delta: "+3", tone: "brand", spark: [8, 10, 9, 12, 14, 13, 16] },
  { label: "Candidatos este mes", value: "1,842", delta: "+18%", tone: "good", spark: [900, 1050, 1200, 1300, 1500, 1680, 1842] },
  { label: "Prefiltros por IA", value: "1,204", delta: "+22%", tone: "human", spark: [400, 560, 700, 820, 980, 1100, 1204] },
  { label: "Contrataciones", value: "63", delta: "+9", tone: "good", spark: [30, 38, 41, 47, 52, 58, 63] },
];

export const funnelData = [
  { etapa: "Candidatos", valor: 1842, pct: 100 },
  { etapa: "Prefiltro IA", valor: 1204, pct: 65 },
  { etapa: "Entrevista IA", valor: 486, pct: 26 },
  { etapa: "Evaluación", valor: 320, pct: 17 },
  { etapa: "Entrevista Humana", valor: 210, pct: 11 },
  { etapa: "Contratación", valor: 98, pct: 5 },
  { etapa: "Onboarding", valor: 63, pct: 3 },
];

export const fuentesData = [
  { name: "WhatsApp", value: 742, color: "var(--brand)" },
  { name: "Formulario", value: 486, color: "var(--human)" },
  { name: "OCC", value: 312, color: "var(--brand-2)" },
  { name: "LinkedIn", value: 201, color: "#8b8c90" },
  { name: "Indeed", value: 101, color: "#c9cacd" },
];

export const actividadData = [
  { dia: "Lun", candidatos: 210, entrevistas: 42 },
  { dia: "Mar", candidatos: 268, entrevistas: 55 },
  { dia: "Mié", candidatos: 312, entrevistas: 61 },
  { dia: "Jue", candidatos: 289, entrevistas: 58 },
  { dia: "Vie", candidatos: 341, entrevistas: 72 },
  { dia: "Sáb", candidatos: 198, entrevistas: 31 },
  { dia: "Dom", candidatos: 124, entrevistas: 18 },
];

export const tiempoContratacion = [
  { mes: "Feb", dias: 21 },
  { mes: "Mar", dias: 18 },
  { mes: "Abr", dias: 16 },
  { mes: "May", dias: 14 },
  { mes: "Jun", dias: 11 },
  { mes: "Jul", dias: 9 },
];

export const vacantes: Vacante[] = [
  {
    id: "VAC-1042",
    titulo: "Cajero(a) de sucursal",
    area: "Operaciones",
    empresa: "Grupo Carbe",
    ubicacion: "Guadalajara, JAL",
    modalidad: "Presencial",
    sueldo: "$9,500 – 11,000",
    estado: "Publicada",
    candidatos: 184,
    nuevos: 12,
    publicada: "hace 3 días",
    plataformas: ["WhatsApp", "OCC", "Portal"],
  },
  {
    id: "VAC-1041",
    titulo: "Ejecutivo(a) de ventas telefónicas",
    area: "Comercial",
    empresa: "Grupo Carbe",
    ubicacion: "CDMX",
    modalidad: "Híbrido",
    sueldo: "$12,000 + comisiones",
    estado: "Publicada",
    candidatos: 246,
    nuevos: 28,
    publicada: "hace 5 días",
    plataformas: ["WhatsApp", "LinkedIn", "Indeed"],
  },
  {
    id: "VAC-1040",
    titulo: "Auxiliar de almacén",
    area: "Logística",
    empresa: "Distribuidora Norte",
    ubicacion: "Monterrey, NL",
    modalidad: "Presencial",
    sueldo: "$8,800 – 10,200",
    estado: "Publicada",
    candidatos: 132,
    nuevos: 7,
    publicada: "hace 1 semana",
    plataformas: ["WhatsApp", "OCC"],
  },
  {
    id: "VAC-1039",
    titulo: "Analista de nómina",
    area: "Recursos Humanos",
    empresa: "Grupo Carbe",
    ubicacion: "Querétaro, QRO",
    modalidad: "Híbrido",
    sueldo: "$18,000 – 22,000",
    estado: "En revisión",
    candidatos: 41,
    nuevos: 4,
    publicada: "borrador",
    plataformas: ["Portal"],
  },
  {
    id: "VAC-1038",
    titulo: "Desarrollador(a) Full-Stack",
    area: "Tecnología",
    empresa: "Grupo Carbe",
    ubicacion: "Remoto (MX)",
    modalidad: "Remoto",
    sueldo: "$45,000 – 60,000",
    estado: "Publicada",
    candidatos: 89,
    nuevos: 9,
    publicada: "hace 2 días",
    plataformas: ["LinkedIn", "Portal"],
  },
  {
    id: "VAC-1037",
    titulo: "Supervisor(a) de piso",
    area: "Operaciones",
    empresa: "Retail Bajío",
    ubicacion: "León, GTO",
    modalidad: "Presencial",
    sueldo: "$16,500 – 19,000",
    estado: "Borrador",
    candidatos: 0,
    nuevos: 0,
    publicada: "borrador",
    plataformas: [],
  },
];

export const candidatos: Candidato[] = [
  { id: "C-8801", nombre: "María Fernanda López", puesto: "Cajero(a) de sucursal", vacanteId: "VAC-1042", fuente: "WhatsApp", estado: "cumple", etapa: "Entrevista IA", score: 92, experiencia: "3 años en retail", ubicacion: "Guadalajara", aplicado: "hace 2 h", tono: 1, evidencia: "Cumple escolaridad, disponibilidad de horario y experiencia en manejo de efectivo." },
  { id: "C-8802", nombre: "Jorge Alberto Ramírez", puesto: "Ejecutivo(a) de ventas", vacanteId: "VAC-1041", fuente: "LinkedIn", estado: "cumple", etapa: "Evaluación", score: 88, experiencia: "5 años en call center", ubicacion: "CDMX", aplicado: "hace 4 h", tono: 0, evidencia: "Supera meta de experiencia; buen manejo de objeciones en el prefiltro por voz." },
  { id: "C-8803", nombre: "Ana Sofía Herrera", puesto: "Auxiliar de almacén", vacanteId: "VAC-1040", fuente: "OCC", estado: "revision", etapa: "Prefiltro", score: 71, experiencia: "1 año", ubicacion: "Monterrey", aplicado: "hace 6 h", tono: 3, evidencia: "Experiencia limítrofe al mínimo requerido. Requiere validación de disponibilidad de turno nocturno." },
  { id: "C-8804", nombre: "Luis Ángel Torres", puesto: "Desarrollador Full-Stack", vacanteId: "VAC-1038", fuente: "LinkedIn", estado: "cumple", etapa: "Onboarding", score: 95, experiencia: "6 años, React/Node", ubicacion: "Remoto", aplicado: "hace 1 día", tono: 2, evidencia: "Stack alineado con el perfil; portafolio verificado; pretensión salarial dentro de rango." },
  { id: "C-8805", nombre: "Diana Karen Méndez", puesto: "Cajero(a) de sucursal", vacanteId: "VAC-1042", fuente: "WhatsApp", estado: "revision", etapa: "Prefiltro", score: 64, experiencia: "6 meses", ubicacion: "Zapopan", aplicado: "hace 3 h", tono: 1, evidencia: "Actitud positiva pero experiencia por debajo del mínimo. Sugerido para revisión humana." },
  { id: "C-8806", nombre: "Roberto Carlos Nava", puesto: "Ejecutivo(a) de ventas", vacanteId: "VAC-1041", fuente: "Indeed", estado: "no_cumple", etapa: "Prefiltro", score: 38, experiencia: "Sin experiencia comercial", ubicacion: "Toluca", aplicado: "hace 5 h", tono: 0, evidencia: "No cumple requisito indispensable de experiencia en ventas ni disponibilidad de horario." },
  { id: "C-8807", nombre: "Gabriela Ruiz Ponce", puesto: "Analista de nómina", vacanteId: "VAC-1039", fuente: "Formulario", estado: "cumple", etapa: "Onboarding", score: 84, experiencia: "4 años, IMSS/ISR", ubicacion: "Querétaro", aplicado: "hace 8 h", tono: 1, evidencia: "Domina timbrado, IMSS e ISR; conocimiento de sistema de nómina confirmado." },
  { id: "C-8808", nombre: "Emiliano Cruz Vega", puesto: "Auxiliar de almacén", vacanteId: "VAC-1040", fuente: "WhatsApp", estado: "cumple", etapa: "Onboarding", score: 90, experiencia: "2 años", ubicacion: "Monterrey", aplicado: "hace 1 día", tono: 2, evidencia: "Cumple todos los requisitos; expediente en integración, pendiente comprobante de domicilio." },
  { id: "C-8809", nombre: "Valeria Jiménez Soto", puesto: "Desarrollador Full-Stack", vacanteId: "VAC-1038", fuente: "LinkedIn", estado: "cumple", etapa: "Entrevista Humana", score: 87, experiencia: "4 años, Next.js", ubicacion: "Remoto", aplicado: "hace 2 días", tono: 1, evidencia: "Fuerte en frontend; a validar experiencia en backend distribuido." },
  { id: "C-8810", nombre: "Héctor Manuel Ríos", puesto: "Cajero(a) de sucursal", vacanteId: "VAC-1042", fuente: "WhatsApp", estado: "no_cumple", etapa: "Prefiltro", score: 29, experiencia: "N/D", ubicacion: "Tlaquepaque", aplicado: "hace 1 h", tono: 0, evidencia: "No completó el prefiltro; sin disponibilidad para el horario de la vacante." },
  { id: "C-8811", nombre: "Fernando Castillo Prado", puesto: "Cajero(a) de sucursal", vacanteId: "VAC-1042", fuente: "OCC", estado: "cumple", etapa: "Contratación", score: 91, experiencia: "4 años en retail", ubicacion: "Guadalajara", aplicado: "hace 10 h", tono: 3, evidencia: "Entrevista humana con RH concluida; oferta en preparación, aún sin expediente abierto." },
];

export const knowledgeBase = [
  { id: "KB-01", titulo: "Solicitud de vacaciones", categoria: "Prestaciones", vigencia: "v3 · vigente", accesos: 1284 },
  { id: "KB-02", titulo: "Proceso de nómina y fechas de pago", categoria: "Nómina", vigencia: "v5 · vigente", accesos: 2140 },
  { id: "KB-03", titulo: "Permisos y ausencias justificadas", categoria: "Políticas", vigencia: "v2 · vigente", accesos: 863 },
  { id: "KB-04", titulo: "Prestaciones superiores a la ley", categoria: "Prestaciones", vigencia: "v4 · vigente", accesos: 1547 },
  { id: "KB-05", titulo: "Reglamento interior de trabajo", categoria: "Políticas", vigencia: "v1 · vigente", accesos: 692 },
  { id: "KB-06", titulo: "Alta en el IMSS y seguro de gastos", categoria: "Prestaciones", vigencia: "v2 · vigente", accesos: 1103 },
];

export const chatSugerencias = [
  "¿Cuántos días de vacaciones me tocan este año?",
  "¿Cuándo es el próximo día de pago?",
  "¿Cómo solicito un permiso por asuntos personales?",
  "¿Qué prestaciones superiores a la ley tengo?",
];

export const conversacionDemo = [
  {
    rol: "user" as const,
    texto: "Hola, quiero saber cuántos días de vacaciones me corresponden. Entré a la empresa en marzo de 2023.",
  },
  {
    rol: "assistant" as const,
    texto:
      "¡Hola! Con gusto te ayudo. Ingresaste en marzo de 2023, así que llevas 2 años cumplidos. Conforme a la reforma de la Ley Federal del Trabajo, en tu segundo año cumplido te corresponden 14 días de vacaciones, y para tu tercer año subirá a 16 días.",
    fuente: "KB-01 · Solicitud de vacaciones (v3)",
  },
  {
    rol: "user" as const,
    texto: "Perfecto. ¿Y cómo las solicito?",
  },
  {
    rol: "assistant" as const,
    texto:
      "Puedes solicitarlas directamente por aquí: dime las fechas que quieres y genero tu solicitud con folio para que tu jefe(a) la autorice. También puedo revisar tu saldo actual de días disponibles antes de continuar. ¿Qué fechas tienes en mente?",
  },
];
