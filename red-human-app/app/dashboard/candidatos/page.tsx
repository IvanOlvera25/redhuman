"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  X,
  MapPin,
  Briefcase,
  MessageCircle,
  Video,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  FileText,
  FileCheck2,
  Sparkles,
  UploadCloud,
  Download,
  UserCheck,
  AlertTriangle,
  Send,
  Loader2,
  CheckCircle2,
  Filter,
  Search,
  GraduationCap,
  Award,
  Globe,
  RotateCw,
  Mail,
  Phone,
  CalendarClock,
  FlaskConical,
  User,
  LayoutGrid,
  List,
  ChevronDown,
  Building2,
  Clock,
  ArrowUpDown,
  Copy,
  Pencil,
  XCircle,
  RefreshCw,
  Trash2,
  ArrowRightLeft,
  Route,
  Store,
  Handshake,
  Database,
  FileDown,
} from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow, Progress } from "@/components/ui";
import { PageHeader, EstadoBadge, ScoreRing } from "@/components/dashboard/parts";
import { PerfilProfundoVista } from "@/components/dashboard/perfil-profundo";
import { Aviso, Dropzone, pesoLegible } from "@/components/dashboard/subida";
import {
  type CalculoIPV,
  type Candidato,
  type EnvioAviso,
  type EntrevistaHumana,
  type EtapaCandidato,
  type NivelIPV,
  type RubricaIPV,
  type RecomendacionEntrevistaHumana,
  type ResultadoEntrevistaHumana,
  type TipoEntrevistador,
  type Vacante,
  type AccionSiguiente,
  type ActividadRuta,
} from "@/lib/data";
import type { DocExpediente, NuevoIngreso } from "@/lib/phase2";
import {
  autorizarAlta,
  eliminarCandidato,
  cancelarEntrevistaHumana,
  cancelarExpediente,
  decidirCandidato,
  enviarPrefiltro,
  fetchCandidato,
  fetchCandidatos,
  urlPreviewCorreo,
  urlContratoPdf,
  enviarCartaIntencion,
  enviarContrato,
  reenviarIpvRedHuman,
  lineasEnvios,
  type EvaluacionCandidato,
  reenviarAvisoEntrevistaHumana,
  cambiarCompartirEntrevista,
  reabrirEntrevista,
  agendarEntrevista,
  urlCartaIntencionPdf,
  fetchClientes,
  fetchEntrevistadores,
  evaluarEntrevistaConLoQueHay,
  fetchExpediente,
  fetchMensajes,
  fetchVacantes,
  guardarCondicionesContratacion,
  fetchRazonesSociales,
  type RazonSocial,
  reiniciarPostulacionPrueba,
  type NotificarAccion,
  marcarEntrevistaHumanaRealizada,
  modificarEntrevistaHumana,
  moverEtapaCandidato,
  avanzarAEntrevistaHumana,
  programarEntrevistaHumana,
  reanalizarCvCandidato,
  recordatorioDocumentosCandidato,
  recordatorioEntrevistaHumana,
  registrarConsentimiento,
  registrarResultadoEntrevistaHumana,
  programarIpvRedHuman,
  calcularIpv,
  fetchConfiguracion,
  COMPETENCIAS_IPV,
  OBSERVACIONES_IPV,
  NIVELES_IPV,
  CONCLUSIONES_IPV,
  EQUIVALENCIAS_IPV_DEFAULT,
  solicitarDocumentosCandidato,
  subirArchivoCandidato,
  subirCVs,
  subirDocumento,
  urlArchivoCandidato,
  urlCartaIntencion,
  urlDocumento,
  type CargaCV,
  type Cliente,
  type MensajePrefiltro,
  type ModalidadEntrevistaHumana,
  type PerfilProfundo,
  nombreEtapa,
  columnaDe,
  confirmarContratacionFranquicia,
  confirmarIngresoFranquicia,
  actualizarDomicilio,
  fetchCliente,
  fetchIntegracionTeams,
  lineasResultados,
  type ContactoCliente,
  type Entrevistador,
  type ResultadoNotificacion,
  // Fraiche (spec §11-13): ruta visible, franquicia, alta SAP y ficha para presentar
  type PasoFraiche,
  type PasoRuta,
  type DatosAltaSap,
  ESTADOS_FRANQUICIA,
  SECCIONES_FICHA,
  moverPasoCandidato,
  presentarFranquiciatario,
  actualizarFranquicia,
  fetchDatosAltaSap,
  capturarDatosAltaSap,
  confirmarDatosAltaSap,
  urlFichaPresentacion,
  generarFichaPresentacion,
} from "@/lib/api";
import { usePuedeDecidir, useModoPrueba, useAmbientePrueba } from "@/components/sesion";
import { useAnunciarContextoAgente } from "@/components/dashboard/agente/proveedor";
import { ConfirmacionAccion } from "@/components/dashboard/confirmacion-accion";
import { LineaNotificar, useNotificarAccion } from "@/components/dashboard/linea-notificar";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { EstadoEnvios } from "@/components/dashboard/estado-envios";
import { ModalIniciarOnboarding } from "@/components/dashboard/onboarding/iniciar-onboarding";
import { PanelTareasOnboarding } from "@/components/dashboard/onboarding/tareas-onboarding";
import { ModalAgregarEvaluacion, PanelEvaluaciones } from "@/components/dashboard/evaluaciones/panel-evaluaciones";
import { ClipboardCheck as IconoEvaluacion, PenLine as IconoFirma } from "lucide-react";
import { abrirFirmaEmbebida } from "@/lib/firma-embebida";
import { asegurarExpediente, crearFirmaDocumento, fetchEstadoFirmas, fetchFirmasExpediente, type FirmaDocumento } from "@/lib/api";
import { SwitchModoPrueba } from "@/components/dashboard/switch-modo-prueba";
import { Toast, type ToastMsg } from "@/components/dashboard/toast";
import { INTERVALO_TABLERO_MS, usePolling } from "@/lib/use-polling";
import { cn, etiquetaRecordatorio } from "@/lib/utils";

import { CANAL } from "@/lib/canal";
/** Pipeline Fraiche v2 (2026-10-01): cinco columnas — Prefiltro → Filtro Red Human → Filtro humano → Contratación →
 * Onboarding. «Evaluación» ya no es columna (la Evaluación integral es un resultado en la tarjeta y la ficha). */
const etapas: EtapaCandidato[] = [
  "Prefiltro",
  "Entrevista IA",
  "Entrevista Humana",
  "Contratación",
  "Onboarding",
];
const TONO_INTEGRAL: Record<string, "good" | "warn" | "bad" | "neutral"> = { apto: "good", en_proceso: "neutral", no_apto: "bad" };
const TEXTO_INTEGRAL: Record<string, string> = { apto: "Apto", en_proceso: "En proceso", no_apto: "No cumple" };
const etapaColor: Record<EtapaCandidato, string> = {
  Prefiltro: "var(--ink-3)",
  "Entrevista IA": "var(--brand)",
  Evaluación: "var(--human)",
  "Entrevista Humana": "var(--brand-2)",
  Contratación: "var(--warn)",
  Onboarding: "var(--good)",
};

/** Fraiche (spec §11): ruta visible de Tienda propia (11 pasos). La etapa interna de cada paso solo sirve para
 * el deep-link `?etapa=`; si algún candidato trae `ruta`, se toma de ahí (fuente: el servidor). */
const RUTA_TIENDA_PROPIA: PasoRuta[] = [
  { clave: "nuevo", nombre: "Nuevo", etapa: "Prefiltro" },
  { clave: "prefiltro_web", nombre: "Prefiltro web", etapa: "Prefiltro" },
  { clave: "filtro_whatsapp", nombre: `Filtro por ${CANAL}`, etapa: "Prefiltro" },
  { clave: "entrevista_inicial", nombre: "Entrevista inicial", etapa: "Entrevista IA" },
  { clave: "ipv", nombre: "Entrevista IPV", etapa: "Entrevista IA" },
  { clave: "psicometria", nombre: "Psicometría", etapa: "Evaluación" },
  { clave: "evaluaciones_adicionales", nombre: "Evaluaciones adicionales", etapa: "Evaluación" },
  { clave: "referencias", nombre: "Referencias", etapa: "Entrevista Humana" },
  { clave: "documentacion", nombre: "Documentación", etapa: "Contratación" },
  { clave: "listo_alta", nombre: "Listo para alta", etapa: "Onboarding" },
  { clave: "listo_sap", nombre: "Listo para SAP", etapa: "Onboarding" },
];
/** Último paso de la ruta de Franquicia (la contratación la hace el franquiciatario). */
const PASO_PRESENTACION: PasoRuta = { clave: "presentacion", nombre: "Presentación al franquiciatario", etapa: "Entrevista Humana" };
/** Pasos que solo existen en Tienda propia (la ruta de franquicia tiene 7). */
const PASOS_SOLO_TIENDA: PasoFraiche[] = ["evaluaciones_adicionales", "referencias", "documentacion", "listo_alta", "listo_sap"];
const DESTINO_NOMBRE: Record<string, string> = { tienda_propia: "Tienda propia", franquicia: "Franquicia" };
const TEXTO_ACEPTADO_FRANQUICIA = "La postulación sigue a Contratación, donde registras la confirmación de contratación del franquiciatario";

/** Zero-touch: la IA ya avanzó sola al candidato hasta aquí; esto es solo el siguiente
 * checkpoint humano al que RH puede mandarlo con un botón explícito (no "cualquier etapa
 * futura" — cada etapa tiene un único destino manual). "Entrevista Humana" abre el modal de
 * agenda (no hace PATCH directo); el resto va por PATCH /candidatos/{codigo}/etapa. Prefiltro,
 * Entrevista IA y Onboarding no tienen destino manual aquí — Prefiltro solo descarta (la IA
 * dispara Entrevista IA sola), Entrevista IA solo descarta, y a Onboarding solo se llega con
 * el botón "Enviar a Onboarding" de la propia etapa Contratación. */
const SIGUIENTE_ETAPA_MANUAL: Partial<Record<EtapaCandidato, EtapaCandidato[]>> = {
  Evaluación: ["Entrevista Humana"],
  "Entrevista Humana": ["Contratación"],
};

type FiltroEstado = "todos" | "en_proceso" | "aptos" | "contratados" | "descartados";

const FILTROS_ESTADO: { key: FiltroEstado; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "en_proceso", label: "En proceso" },
  { key: "aptos", label: "Aptos" },
  { key: "contratados", label: "Contratados" },
  { key: "descartados", label: "No cumple" },  // recomendación del prefiltro; descartar sigue siendo decisión de RH
];

const ETAPAS_YA_CONTRATADO: EtapaCandidato[] = ["Contratación", "Onboarding"];

/** 2026-09-22 — «Avanzar a Entrevista Humana» (omitir la Entrevista Red Human). Solo tiene sentido
 * mientras el candidato está en Prefiltro o en la propia Entrevista Red Human. */
const ETAPAS_AVANCE_DIRECTO: EtapaCandidato[] = ["Prefiltro", "Entrevista IA"];
const TEXTO_AVANCE_DIRECTO = "Este candidato avanzará a Entrevista Humana y se omitirá la Entrevista Red Human";
/** Fraiche (spec §8): etapas en las que se puede programar la Entrevista IPV (Red Human o entrevistador humano). */
const ETAPAS_IPV: EtapaCandidato[] = ["Entrevista IA", "Evaluación", "Entrevista Humana"];
const NIVEL_IPV_LABEL: Record<string, string> = Object.fromEntries(NIVELES_IPV.map((n) => [n.clave, n.nombre]));
function tonoConclusionIpv(conclusion: CalculoIPV["conclusion"]): "good" | "warn" | "bad" | "neutral" {
  return conclusion === "recomendable" ? "good" : conclusion === "bajo_reserva" ? "warn" : conclusion === "no_recomendable" ? "bad" : "neutral";
}
function tonoNivelIpv(nivel: NivelIPV | ""): "good" | "warn" | "bad" | "neutral" {
  return nivel === "alto" ? "good" : nivel === "medio" ? "warn" : nivel === "bajo" ? "bad" : "neutral";
}

const TIPOS_CONTRATACION = ["Tiempo indeterminado", "Tiempo determinado", "Por obra o proyecto", "Honorarios"];
// 2026-09-20 (B3): formato de la trazabilidad de documentos
function fechaHoraCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function canalLegible(canal: string): string {
  return canal
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => ({ whatsapp: CANAL, correo: "Correo", liga: "Liga pública", rh: "RH (tablero)", fisico: "Entrega física" }[x] ?? x))
    .join(" + ") || "—";
}
// 2026-09-20 (B2): «Tiempo determinado» pide duración + unidad; la fecha de término se calcula (aquí solo como
// vista previa; la que vale es la del servidor, `expedienteCondiciones.fechaTermino`).
const UNIDADES_DURACION = ["días", "meses", "años"] as const;
function fechaTerminoLocal(fechaIngreso: string, duracion: number, unidad: string): string {
  if (!fechaIngreso || !duracion || duracion <= 0) return "";
  const [y, m, d] = fechaIngreso.split("-").map(Number);
  if (!y || !m || !d) return "";
  let fin: Date;
  if (unidad === "días") fin = new Date(Date.UTC(y, m - 1, d + duracion));
  else {
    const meses = unidad === "años" ? duracion * 12 : duracion;
    const total = m - 1 + meses;
    const anio = y + Math.floor(total / 12);
    const mes = total % 12;
    const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    fin = new Date(Date.UTC(anio, mes, Math.min(d, ultimo)));
  }
  return fin.toISOString().slice(0, 10);
}
const MODALIDADES_ENTREVISTA_HUMANA: ModalidadEntrevistaHumana[] = ["Presencial", "Videollamada", "Llamada"];

/** Usado tanto por PanelEntrevistaHumana (agenda/resultado) como por PestanaEvaluaciones
 * (vista de solo lectura del mismo resultado) — una sola fuente para el label. */
const RECOMENDACION_LABEL: Record<RecomendacionEntrevistaHumana, string> = {
  avanzar: "Avanzar",
  no_avanzar: "No avanzar",
  segunda_entrevista: "Segunda entrevista",
};

/** Clases completas y estáticas por tono de pestaña — Tailwind necesita ver el nombre de la
 * clase literal en el código para generarla; un template literal tipo `text-${tone}` no
 * funciona (ver toneMap en components/ui.tsx, mismo patrón). */
const TAB_TONE_ACTIVA: Record<string, string> = {
  brand: "bg-bg text-brand border-brand shadow-sm",
  human: "bg-bg text-human border-human shadow-sm",
  good: "bg-bg text-good border-good shadow-sm",
  warn: "bg-bg text-warn border-warn shadow-sm",
};
const TAB_TONE_BADGE: Record<string, string> = {
  brand: "bg-brand/15 text-brand",
  human: "bg-human/15 text-human",
  good: "bg-good/15 text-good",
  warn: "bg-warn/15 text-warn",
};

/** Quita acentos y pasa a minúsculas para que "jose" encuentre "José" en la búsqueda por nombre. */
function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Formatea una fecha ISO a formato corto legible (ej. "10 sep, 14:30") */
function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

/** HOTFIX 2026-09-22 — «Todos» muestra TODAS las postulaciones cargadas, incluidas las que el agente
 * marcó «no cumple». `Postulacion.estado` es solo la RECOMENDACIÓN del prefiltro: la postulación sigue
 * ACTIVA y en su etapa hasta que una persona de RH la descarte (LFPDPPP/HITL), y así la cuenta el backend
 * (`services/conteos.py`, B4). Ocultarlas aquí dejaba tarjetas invisibles en Prefiltro mientras el contador
 * de la vacante decía 3, 5, 12… Las cerradas siguen fuera hasta activar «Mostrar cerradas» (eso lo filtra
 * la API, no esta función); el chip «No cumple» sigue disponible para revisarlas aparte. */
function coincideEstado(c: Candidato, filtro: FiltroEstado): boolean {
  const yaContratado = ETAPAS_YA_CONTRATADO.includes(c.etapa);
  // Pipeline v2: un requisito obligatorio «No cumple» prevalece (la tarjeta sigue en su columna; se aparta con este filtro)
  const noCumple = c.estado === "no_cumple" || c.avance?.integral?.conclusion === "no_apto";
  switch (filtro) {
    case "en_proceso":
      return !yaContratado && !noCumple && (c.estado === "revision" || c.estado === "pendiente" || c.avance?.integral?.conclusion === "en_proceso");
    case "aptos":
      return !yaContratado && !noCumple && c.estado === "cumple";
    case "contratados":
      return yaContratado;
    case "descartados":
      return noCumple;
    case "todos":
    default:
      return true;
  }
}

function CandidatosContenido() {
  const puedeDecidir = usePuedeDecidir();
  const modoPrueba = useModoPrueba();
  const searchParams = useSearchParams();

  const [sel, setSel] = useState<Candidato | null>(null);
  // 2026-09-22: «Avanzar a Entrevista Humana» desde la tarjeta del Kanban (misma confirmación que la ficha)
  const [avanceKanban, setAvanceKanban] = useState<Candidato | null>(null);
  const [avanzando, setAvanzando] = useState(false);
  useAnunciarContextoAgente(
    sel ? { pantalla: "candidato", entidad: { tipo: "candidato", codigo: sel.id } } : { pantalla: "candidatos" },
  );
  // 2026-09-15 (arranque en vivo): el tablero NUNCA arranca con datos de ejemplo — antes se pintaban
  // las tarjetas demo un instante («flasheo») hasta que llegaba la respuesta real.
  const [datos, setDatos] = useState<Candidato[]>([]);
  const [cargando, setCargando] = useState(true);
  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: number; nombre: string }[]>([]);

  // Filtros principales
  const [filtroVacante, setFiltroVacante] = useState<string>("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [live, setLive] = useState(false);
  const [carga, setCarga] = useState(false);

  // Fase C: Vistas, URL params y filtros avanzados
  const [vista, setVista] = useState<"pipeline" | "lista">("pipeline");
  // Pipeline v2 (2026-10-01): un solo Kanban de cinco columnas + filtro Todas / Tienda propia / Franquicia
  const [fTienda, setFTienda] = useState<"" | "tienda_propia" | "franquicia">("");
  const [columnaResaltada, setColumnaResaltada] = useState<string | null>(null);
  const [filtrosAvanzados, setFiltrosAvanzados] = useState(false);
  const [fCliente, setFCliente] = useState<number | "">("");
  const [fResponsable, setFResponsable] = useState<number | "">("");
  const [fFuente, setFFuente] = useState<string>("");
  const [fConsentimiento, setFConsentimiento] = useState<"todos" | "con" | "sin">("todos");
  const [fApto, setFApto] = useState<"todos" | "apto" | "no_apto" | "sin_evaluar">("todos");
  const [fScoreMin, setFScoreMin] = useState<number | "">("");
  const [fScoreMax, setFScoreMax] = useState<number | "">("");
  const [fDuplicados, setFDuplicados] = useState(false);
  // Fase 2 (B4): las postulaciones cerradas (descartado/contratado/reinicio) no se cargan salvo
  // que RH lo pida explícitamente — es un parámetro de la API, no un filtro local.
  const [mostrarCerradas, setMostrarCerradas] = useState(false);
  const [orden, setOrden] = useState<"actividad" | "fecha" | "score" | "nombre">("actividad");

  // Inicialización desde URL params y localStorage
  useEffect(() => {
    const vParam = searchParams.get("vacante");
    if (vParam) setFiltroVacante(vParam);

    const eParam = searchParams.get("etapa");
    if (eParam && etapas.includes(eParam as EtapaCandidato)) {
      setColumnaResaltada(eParam);
      setTimeout(() => {
        const el = document.getElementById(`columna-etapa-${eParam.replace(/\s/g, "-")}`);
        if (el) el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }, 200);
    }

    const guardada = localStorage.getItem("rh-candidatos-vista");
    if (guardada === "pipeline" || guardada === "lista") {
      setVista(guardada);
    }
  }, [searchParams]);

  const cambiarVista = (nueva: "pipeline" | "lista") => {
    setVista(nueva);
    try {
      localStorage.setItem("rh-candidatos-vista", nueva);
    } catch {}
  };

  const recargar = useCallback(async (abrirCodigo?: string) => {
    const c = await fetchCandidatos({
      ...(filtroVacante ? { vacante: filtroVacante } : {}),
      ...(mostrarCerradas ? { mostrar_cerradas: true } : {}),
    });
    if (c) {
      setDatos(c);
      setLive(true);
      if (abrirCodigo && c.length) {
        const detalle = await fetchCandidato(abrirCodigo);
        if (detalle) setSel(detalle);
      }
    }
    setCargando(false);
  }, [filtroVacante, mostrarCerradas]);

  useEffect(() => {
    recargar();
    fetchVacantes().then((v) => v && setVacantes(v));
    fetchClientes("Activo").then((cl) => setClientes(cl ?? []));
    fetchEntrevistadores().then((u) => setUsuarios(u ?? []));
  }, [recargar]);
  // Fase 4: el Kanban se revalida solo (WhatsApp, IA y otros usuarios mueven tarjetas) — se pausa
  // mientras hay una ficha abierta para no pisar lo que RH está editando.
  usePolling(() => recargar(), INTERVALO_TABLERO_MS, sel === null);

  async function abrir(c: Candidato) {
    setSel(c);
    if (!live) return;
    const detalle = await fetchCandidato(c.id);
    if (detalle) setSel(detalle);
  }

  // Detección de duplicados en el conjunto cargado (por teléfono normalizado a 10 dígitos o correo).
  // 2026-09-16 (Modo Prueba flexible): con Modo Prueba activo repetir teléfono/correo es lo esperado
  // (cada alta es una persona independiente), así que no se marca nada como «Duplicado».
  const duplicadosSet = useMemo(() => {
    const telMap = new Map<string, number>();
    const emailMap = new Map<string, number>();
    if (modoPrueba) return new Set<string>();

    for (const c of datos) {
      const t = c.telefono ? c.telefono.replace(/\D/g, "").slice(-10) : "";
      if (t.length >= 7) telMap.set(t, (telMap.get(t) ?? 0) + 1);
      const m = c.correo ? c.correo.trim().toLowerCase() : "";
      if (m) emailMap.set(m, (emailMap.get(m) ?? 0) + 1);
    }

    const dups = new Set<string>();
    for (const c of datos) {
      const t = c.telefono ? c.telefono.replace(/\D/g, "").slice(-10) : "";
      const m = c.correo ? c.correo.trim().toLowerCase() : "";
      if ((t.length >= 7 && (telMap.get(t) ?? 0) > 1) || (m && (emailMap.get(m) ?? 0) > 1)) {
        dups.add(c.id);
      }
    }
    return dups;
  }, [datos, modoPrueba]);

  const sinConsentimiento = datos.filter((c) => c.consentimiento === false).length;

  // Filtrado y ordenamiento compuesto
  const datosFiltrados = useMemo(() => {
    let res = datos.filter((c) => {
      if (filtroVacante && c.vacanteId !== filtroVacante) return false;
      if (columnaResaltada && columnaDe(c.etapa) !== columnaDe(columnaResaltada)) return false;  // B4: ?etapa= es un filtro exacto
      if (fTienda && (c.avance?.destino || c.destino) !== fTienda) return false;
      if (!coincideEstado(c, filtroEstado)) return false;
      if (
        busqueda.trim() &&
        !normalizarTexto(c.nombre).includes(normalizarTexto(busqueda)) &&
        !normalizarTexto(c.id).includes(normalizarTexto(busqueda))
      ) {
        return false;
      }
      if (fCliente !== "") {
        const v = vacantes.find((vac) => vac.id === c.vacanteId);
        const cliObj = clientes.find((cl) => cl.id === fCliente);
        const cliNombre = cliObj?.nombre;
        if (cliNombre && c.clienteVacante !== cliNombre && v?.cliente !== cliNombre) {
          return false;
        }
      }
      if (fResponsable !== "") {
        const v = vacantes.find((vac) => vac.id === c.vacanteId);
        const uObj = usuarios.find((u) => u.id === fResponsable);
        const uNombre = uObj?.nombre;
        if (uNombre && v?.responsable !== uNombre) {
          return false;
        }
      }
      if (fFuente && c.fuente !== fFuente) return false;
      if (fConsentimiento === "con" && c.consentimiento !== true) return false;
      if (fConsentimiento === "sin" && c.consentimiento !== false) return false;
      if (fApto === "apto" && c.resultadoApto !== true) return false;
      if (fApto === "no_apto" && c.resultadoApto !== false) return false;
      if (fApto === "sin_evaluar" && c.resultadoApto != null) return false;
      if (fScoreMin !== "" && (c.score ?? 0) < Number(fScoreMin)) return false;
      if (fScoreMax !== "" && (c.score ?? 0) > Number(fScoreMax)) return false;
      if (fDuplicados && !duplicadosSet.has(c.id)) return false;
      return true;
    });

    res = [...res].sort((a, b) => {
      if (orden === "actividad") {
        const ta = a.ultimaActividadEn ? new Date(a.ultimaActividadEn).getTime() : a.aplicado ? new Date(a.aplicado).getTime() : 0;
        const tb = b.ultimaActividadEn ? new Date(b.ultimaActividadEn).getTime() : b.aplicado ? new Date(b.aplicado).getTime() : 0;
        return tb - ta;
      }
      if (orden === "fecha") {
        const ta = a.aplicado ? new Date(a.aplicado).getTime() : 0;
        const tb = b.aplicado ? new Date(b.aplicado).getTime() : 0;
        return tb - ta;
      }
      if (orden === "score") {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      if (orden === "nombre") {
        return a.nombre.localeCompare(b.nombre);
      }
      return 0;
    });

    return res;
  }, [
    columnaResaltada,
    fTienda,
    datos,
    filtroVacante,
    filtroEstado,
    busqueda,
    fCliente,
    fResponsable,
    fFuente,
    fConsentimiento,
    fApto,
    fScoreMin,
    fScoreMax,
    fDuplicados,
    orden,
    vacantes,
    clientes,
    duplicadosSet,
  ]);

  const vacanteSeleccionada = vacantes.find((v) => v.id === filtroVacante);
  const totalFiltrosAvanzadosActivos =
    (fCliente !== "" ? 1 : 0) +
    (fResponsable !== "" ? 1 : 0) +
    (fFuente ? 1 : 0) +
    (fConsentimiento !== "todos" ? 1 : 0) +
    (fApto !== "todos" ? 1 : 0) +
    (fScoreMin !== "" || fScoreMax !== "" ? 1 : 0) +
    (fDuplicados ? 1 : 0);

  const limpiarTodosLosFiltros = () => {
    setFiltroVacante("");
    setFiltroEstado("todos");
    setBusqueda("");
    setFCliente("");
    setFResponsable("");
    setFFuente("");
    setFConsentimiento("todos");
    setFApto("todos");
    setFScoreMin("");
    setFScoreMax("");
    setFDuplicados(false);
    setColumnaResaltada(null);
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Candidatos" subtitle="Pipeline de selección · prefiltrado por el agente con evidencia y extracción de CV.">
        {live && (
          <Badge tone="good" dot>
            API en vivo
          </Badge>
        )}
        <Badge tone="brand" dot>
          <Sparkles className="h-3 w-3" /> Agente activo
        </Badge>
        {puedeDecidir && (
          <Button size="sm" onClick={() => setCarga(true)}>
            <UploadCloud className="h-4 w-4" /> Cargar CVs
          </Button>
        )}
      </PageHeader>

      {/* Barra principal de control: selector de vista, vacante, búsqueda, estado y filtros */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Toggle de vista (Pipeline vs Lista) */}
          <div className="flex items-center rounded-xl border border-border-soft bg-surface p-1 shadow-sm">
            <button
              id="candidatos-vista-pipeline"
              onClick={() => cambiarVista("pipeline")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                vista === "pipeline"
                  ? "bg-brand text-white shadow-sm"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink",
              )}
              title="Vista de Pipeline (Kanban)"
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Pipeline
            </button>
            <button
              id="candidatos-vista-lista"
              onClick={() => cambiarVista("lista")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                vista === "lista"
                  ? "bg-brand text-white shadow-sm"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink",
              )}
              title="Vista en Lista detallada"
            >
              <List className="h-3.5 w-3.5" /> Lista
            </button>
          </div>

          {/* Pipeline v2 (2026-10-01): la vacante determina la ruta — filtro Todas / Tienda propia / Franquicia */}
          <div className="flex items-center rounded-xl border border-border-soft bg-surface p-1 shadow-sm" role="group" aria-label="Tipo de tienda">
            {([["", "Todas"], ["tienda_propia", "Tienda propia"], ["franquicia", "Franquicia"]] as const).map(([valor, texto]) => (
              <button
                key={valor || "todas"}
                onClick={() => setFTienda(valor)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  fTienda === valor ? "bg-brand text-white shadow-sm" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {texto}
              </button>
            ))}
          </div>

          {/* Filtro por vacante */}
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <select
              id="filtro-vacante"
              value={filtroVacante}
              onChange={(e) => setFiltroVacante(e.target.value)}
              className="h-10 min-w-[240px] appearance-none rounded-xl border border-border-soft bg-surface pl-9 pr-8 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Todas las vacantes</option>
              {vacantes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.titulo}{v.cliente ? ` · ${v.cliente}` : ""}{v.ubicacion ? ` (${v.ubicacion})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Búsqueda por nombre o código */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className="h-10 min-w-[220px] rounded-xl border border-border-soft bg-surface pl-9 pr-8 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Barra de filtro por estado */}
          <div className="scroll-x max-w-full items-center gap-1 rounded-xl border border-border-soft bg-surface-2/60 p-1">
            {FILTROS_ESTADO.map((f) => (
              <button
                key={f.key}
                onClick={() => setFiltroEstado(f.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                  filtroEstado === f.key
                    ? "bg-surface text-brand shadow-sm"
                    : "text-ink-3 hover:bg-surface/60 hover:text-ink",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Botón desplegable de filtros avanzados */}
          <button
            onClick={() => setFiltrosAvanzados((prev) => !prev)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition",
              filtrosAvanzados || totalFiltrosAvanzadosActivos > 0
                ? "border-brand bg-brand-soft text-brand"
                : "border-border-soft bg-surface text-ink-2 hover:border-brand/40",
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            Filtros
            {totalFiltrosAvanzadosActivos > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] text-white">
                {totalFiltrosAvanzadosActivos}
              </span>
            )}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", filtrosAvanzados && "rotate-180")} />
          </button>
        </div>

        {/* Contador y Orden */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-3">
            <ArrowUpDown className="h-3.5 w-3.5" />
            <select
              value={orden}
              onChange={(e) => setOrden(e.target.value as typeof orden)}
              className="rounded-lg border border-border-soft bg-surface px-2 py-1 text-xs font-medium text-ink outline-none focus:border-brand"
            >
              <option value="actividad">Última actividad</option>
              <option value="fecha">Fecha aplicación</option>
              <option value="score">Mayor Score CV</option>
              <option value="nombre">Nombre (A-Z)</option>
            </select>
          </div>
          <Badge tone="brand" dot>
            {datosFiltrados.length} candidato{datosFiltrados.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Panel desplegable de Filtros Avanzados (Fase C) */}
      {filtrosAvanzados && (
        <Card className="mt-3 grid gap-3 border-border-soft bg-surface/90 p-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Cliente */}
          {clientes.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Cliente
              </label>
              <select
                value={fCliente}
                onChange={(e) => setFCliente(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
              >
                <option value="">Todos los clientes</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Responsable */}
          {usuarios.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Responsable
              </label>
              <select
                value={fResponsable}
                onChange={(e) => setFResponsable(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
              >
                <option value="">Todos los responsables</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Fuente */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Fuente
            </label>
            <select
              value={fFuente}
              onChange={(e) => setFFuente(e.target.value)}
              className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
            >
              <option value="">Todas las fuentes</option>
              <option value={CANAL}>{CANAL}</option>
              <option value="OCC">OCC</option>
              <option value="LinkedIn">LinkedIn</option>
              <option value="Portal">Portal</option>
              <option value="Carga CV">Carga CV</option>
            </select>
          </div>

          {/* Apto (Punto 21) */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Resultado Apto
            </label>
            <select
              value={fApto}
              onChange={(e) => setFApto(e.target.value as typeof fApto)}
              className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
            >
              <option value="todos">Todos los resultados</option>
              <option value="apto">Apto (Sí)</option>
              <option value="no_apto">No apto (No)</option>
              <option value="sin_evaluar">Sin evaluar</option>
            </select>
          </div>

          {/* Score CV (Rango) */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Score CV (%)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Mín"
                value={fScoreMin}
                onChange={(e) => setFScoreMin(e.target.value === "" ? "" : Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
              />
              <span className="text-xs text-ink-3">-</span>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Máx"
                value={fScoreMax}
                onChange={(e) => setFScoreMax(e.target.value === "" ? "" : Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
              />
            </div>
          </div>

          {/* Consentimiento */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Consentimiento
            </label>
            <select
              value={fConsentimiento}
              onChange={(e) => setFConsentimiento(e.target.value as typeof fConsentimiento)}
              className="w-full rounded-lg border border-border-soft bg-surface p-2 text-xs outline-none focus:border-brand"
            >
              <option value="todos">Todos</option>
              <option value="con">Con consentimiento</option>
              <option value="sin">Sin consentimiento</option>
            </select>
          </div>

          {/* Duplicados */}
          <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between border-t border-border-faint pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="f-duplicados"
                  checked={fDuplicados}
                  onChange={(e) => setFDuplicados(e.target.checked)}
                  className="h-4 w-4 rounded border-border-soft text-brand focus:ring-brand"
                />
                <label htmlFor="f-duplicados" className="cursor-pointer text-xs font-medium text-ink-2">
                  Solo duplicados ({duplicadosSet.size})
                </label>
                <input
                  type="checkbox"
                  id="f-cerradas"
                  checked={mostrarCerradas}
                  onChange={(e) => setMostrarCerradas(e.target.checked)}
                  className="ml-4 h-4 w-4 rounded border-border-soft text-brand focus:ring-brand"
                />
                <label
                  htmlFor="f-cerradas"
                  title="Incluye postulaciones descartadas, contratadas o reiniciadas (quedan como historial de la persona)"
                  className="cursor-pointer text-xs font-medium text-ink-2"
                >
                  Mostrar cerradas
                </label>
              </div>
              {totalFiltrosAvanzadosActivos > 0 && (
                <button
                  onClick={limpiarTodosLosFiltros}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Limpiar todos los filtros
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Avisos */}
      {columnaResaltada && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-brand/40 bg-brand-soft/40 px-4 py-2 text-xs text-brand">
          <span>
            Filtro por etapa: <strong>{nombreEtapa(columnaResaltada)}</strong>
            {filtroVacante ? <> · vacante <strong>{filtroVacante}</strong></> : null} · {datosFiltrados.length} candidato(s)
          </span>
          <button
            onClick={() => setColumnaResaltada(null)}
            className="flex items-center gap-1 font-semibold hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtro de etapa
          </button>
        </div>
      )}

      {live && sinConsentimiento > 0 && (
        <div className="mt-4">
          <Aviso tono="warn">
            {sinConsentimiento} candidato(s) sin consentimiento registrado. Sin él no se puede abrir expediente de
            contratación (LFPDPPP 2025).
          </Aviso>
        </div>
      )}

      {/* Estado de carga: esqueleto neutro (nunca tarjetas de ejemplo) hasta la primera respuesta real */}
      {cargando && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-busy="true">
          {etapas.map((etapa) => (
            <div key={etapa} className="rounded-2xl border border-border-soft bg-surface p-3">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
              <div className="mt-3 h-20 animate-pulse rounded-xl bg-surface-2/60" />
            </div>
          ))}
        </div>
      )}

      {/* VISTA 1: PIPELINE — cinco columnas (Pipeline v2); las actividades de cada ruta viven dentro de cada columna */}
      {!cargando && vista === "pipeline" && (
        <div className={cn("mt-6 grid gap-4", columnaResaltada ? "grid-cols-1 sm:max-w-md" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5")}>
          {etapas.filter((etapa) => !columnaResaltada || etapa === columnaDe(columnaResaltada)).map((etapa) => {
            const cols = datosFiltrados.filter((c) => columnaDe(c.etapa) === etapa);
            const esResaltada = Boolean(columnaResaltada) && columnaDe(columnaResaltada!) === etapa;

            return (
              <div
                key={etapa}
                id={`columna-etapa-${etapa.replace(/\s/g, "-")}`}
                className={cn(
                  "flex flex-col rounded-2xl border p-3 transition-all duration-300",
                  esResaltada
                    ? "border-brand bg-brand/5 ring-2 ring-brand/30 shadow-md"
                    : "border-border-soft bg-surface-2/40",
                )}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: etapaColor[etapa] }} />
                    <span className={cn("text-sm font-semibold", esResaltada && "text-brand")}>{nombreEtapa(etapa)}</span>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-mono text-[11px]",
                      esResaltada ? "bg-brand text-white font-bold" : "bg-surface text-ink-3",
                    )}
                  >
                    {cols.length}
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {cols.map((c) => (
                    <TarjetaKanban key={c.id} c={c} esDup={duplicadosSet.has(c.id)} puedeDecidir={puedeDecidir} mostrarDestino onAbrir={abrir} onAvance={setAvanceKanban} />
                  ))}
                  {cols.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border-soft py-8 text-center text-xs text-ink-3">
                      Sin candidatos
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VISTA 2: LISTA (Fase C) */}
      {!cargando && vista === "lista" && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border-soft bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft bg-surface-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3 text-left">Candidato</th>
                <th className="px-4 py-3 text-left">Vacante</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Etapa</th>
                <th className="px-4 py-3 text-left">Resultado Apto</th>
                <th className="px-4 py-3 text-left">Score CV</th>
                <th className="px-4 py-3 text-left">Fuente</th>
                <th className="px-4 py-3 text-left">Última Actividad</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-faint">
              {datosFiltrados.map((c) => {
                const esDup = duplicadosSet.has(c.id);
                return (
                  <tr
                    key={c.id}
                    onClick={() => abrir(c)}
                    className="cursor-pointer transition hover:bg-brand-soft/30"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.nombre} tone={c.tono} />
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-ink">{c.nombre}</p>
                            {c.esPrueba && (
                              <span className="rounded bg-brand-soft px-1 text-[9px] font-bold text-brand">
                                Prueba
                              </span>
                            )}
                            {c.yaAplicoAntes && (
                              <span
                                title={`Este candidato tiene ${c.totalPostulaciones} postulaciones`}
                                className="rounded bg-blue-500/10 px-1 text-[9px] font-bold text-blue-600"
                              >
                                🔄 Ya aplicó antes
                              </span>
                            )}
                            {c.activa === false && (
                              <span
                                title={`Postulación cerrada (${c.motivoCierre || "sin motivo"})`}
                                className="rounded bg-ink-3/10 px-1 text-[9px] font-bold uppercase text-ink-3"
                              >
                                Cerrada
                              </span>
                            )}
                            {esDup && (
                              <span
                                title="Posible candidato duplicado"
                                className="rounded bg-warn-soft px-1 text-[9px] font-bold text-warn"
                              >
                                Duplicado
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-[11px] text-ink-3">{c.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      <p className="font-medium text-ink">{c.puesto || "—"}</p>
                      <p className="font-mono text-[11px] text-ink-3">{c.vacanteId}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      {c.clienteVacante || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: `${etapaColor[c.etapa]}18`,
                          color: etapaColor[c.etapa],
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: etapaColor[c.etapa] }} />
                        {nombreEtapa(c.etapa)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.resultadoApto === true && (
                        <Badge tone="good" dot>
                          Apto
                        </Badge>
                      )}
                      {c.resultadoApto === false && (
                        <Badge tone="bad" dot>
                          No apto
                        </Badge>
                      )}
                      {c.resultadoApto == null && (
                        <span className="text-xs text-ink-3">Sin evaluar</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-ink">
                        {c.score != null ? `${c.score}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      {(c.fuente === "WhatsApp" || c.fuente === "Telegram") ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-good">
                          <MessageCircle className="h-3.5 w-3.5" /> {CANAL}
                        </span>
                      ) : (
                        c.fuente || "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-3">
                      {c.ultimaActividadEn ? fechaCorta(c.ultimaActividadEn) : c.aplicado ? fechaCorta(c.aplicado) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="secondary" onClick={() => abrir(c)}>
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {datosFiltrados.length === 0 && (
            <div className="py-12 text-center text-sm text-ink-3">Sin candidatos con estos filtros.</div>
          )}
        </div>
      )}

      {carga && (
        <CargarCVs
          vacantes={vacantes}
          onClose={() => setCarga(false)}
          onListo={(codigo) => {
            recargar(codigo);
          }}
        />
      )}

      {/* Modal Centrado de Detalle del Candidato */}
      {sel && (
        <ModalCandidato
          c={sel}
          live={live}
          onClose={() => setSel(null)}
          onCambio={(actualizado) => {
            setSel(actualizado);
            recargar();
          }}
          onEliminado={() => {
            // CRUD: la persona ya no existe para el sistema → volver al tablero
            setSel(null);
            recargar();
          }}
        />
      )}

      {/* 2026-09-22: confirmación de «Avanzar a Entrevista Humana» desde la tarjeta del Kanban */}
      {avanceKanban && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !avanzando && setAvanceKanban(null)}>
          <div className="w-full max-w-md rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">Avanzar a Entrevista Humana</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{TEXTO_AVANCE_DIRECTO}.</p>
            <p className="mt-2 text-xs text-ink-3">
              {avanceKanban.nombre} · queda registrado en el historial del expediente; lo ya generado se conserva.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAvanceKanban(null)} disabled={avanzando}>Cancelar</Button>
              <Button
                size="sm"
                disabled={avanzando}
                onClick={async () => {
                  setAvanzando(true);
                  const r = await avanzarAEntrevistaHumana(avanceKanban.id);
                  setAvanzando(false);
                  if (!r.ok) return;
                  setAvanceKanban(null);
                  if (sel?.id === r.data.id) setSel(r.data);
                  recargar();
                }}
              >
                {avanzando ? "Avanzando…" : "Avanzar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Candidatos() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-ink-3">Cargando candidatos…</div>}>
      <CandidatosContenido />
    </Suspense>
  );
}

/** Tarjeta del Kanban (misma en las vistas «Etapas» y «Ruta Fraiche»; `mostrarDestino` solo en la ruta).
 * El menú «…» va FUERA del botón de la tarjeta (no se anidan botones). */
function TarjetaKanban({
  c,
  esDup,
  puedeDecidir,
  mostrarDestino = false,
  onAbrir,
  onAvance,
}: {
  c: Candidato;
  esDup: boolean;
  puedeDecidir: boolean;
  mostrarDestino?: boolean;
  onAbrir: (c: Candidato) => void;
  onAvance: (c: Candidato) => void;
}) {
  return (
    /* 2026-09-22: el menú «…» va FUERA del botón de la tarjeta (no se anidan botones);
       solo aparece donde tiene sentido avanzar directo a Entrevista Humana. */
    <div className="relative">
    <button
      onClick={() => onAbrir(c)}
      className="card-hover group w-full rounded-xl border border-border-soft bg-surface p-3.5 text-left transition-all hover:border-brand/40 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          <ScoreRing score={c.score} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="truncate text-sm font-semibold group-hover:text-brand">{c.nombre}</p>
            {c.esPrueba && (
              <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-brand">
                Prueba
              </span>
            )}
            {c.yaAplicoAntes && (
              <span
                title={`Este candidato tiene ${c.totalPostulaciones} postulaciones`}
                className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-blue-600"
              >
                🔄 Ya aplicó antes
              </span>
            )}
            {c.activa === false && (
              <span
                title={`Postulación cerrada (${c.motivoCierre || "sin motivo"}) — queda como historial de la persona`}
                className="shrink-0 rounded bg-ink-3/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-ink-3"
              >
                Cerrada
              </span>
            )}
            {esDup && (
              <span
                title="Posible candidato duplicado (coincide teléfono o correo)"
                className="shrink-0 rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn"
              >
                Duplicado
              </span>
            )}
            {mostrarDestino && (c.avance?.destino || c.destino) && (c.avance ? Boolean(c.avance.ruta) : true) && (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide",
                  c.destino === "franquicia" ? "bg-human-soft text-human" : "bg-good-soft text-good",
                )}
              >
                {c.avance?.ruta || DESTINO_NOMBRE[c.destino ?? ""] || c.destino}
              </span>
            )}
            {mostrarDestino && c.destino === "franquicia" && (c.avance?.franquiciaEstadoTexto || c.franquiciaEstadoTexto) && (
              <span className="shrink-0 rounded bg-human/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-human">
                {c.avance?.franquiciaEstadoTexto || c.franquiciaEstadoTexto}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-ink-3">
            {c.puesto || "Sin vacante"}
            {c.clienteVacante ? ` · ${c.clienteVacante}` : ""}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand">
              Score CV: {c.score}%
            </span>
          </div>
        </div>
      </div>

      {/* Estado y Apto (Fase C) */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <EstadoBadge estado={c.estado} />
          {c.resultadoApto === true && (
            <span className="rounded-md bg-good-soft px-1.5 py-0.5 text-[10px] font-bold text-good">
              Apto
            </span>
          )}
          {c.resultadoApto === false && (
            <span className="rounded-md bg-bad-soft px-1.5 py-0.5 text-[10px] font-bold text-bad">
              No apto
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3">
          {(c.fuente === "WhatsApp" || c.fuente === "Telegram") ? (
            <span className="inline-flex items-center gap-1 font-semibold text-good">
              <MessageCircle className="h-3 w-3" /> {CANAL}
            </span>
          ) : (
            c.fuente
          )}
        </span>
      </div>

      {/* Pipeline v2: Evaluación integral (resultado acumulado) y siguiente acción según la ruta */}
      {c.avance && c.activa !== false && (
        <div className="mt-2 rounded-lg bg-surface-2/70 px-2 py-1.5 text-[11px] leading-snug">
          <span className={cn("font-semibold", c.avance.integral.conclusion === "no_apto" ? "text-bad" : c.avance.integral.conclusion === "apto" ? "text-good" : "text-ink-2")}>
            {TEXTO_INTEGRAL[c.avance.integral.conclusion] ?? ""}
          </span>
          {c.avance.siguienteAccion?.texto && <span className="text-ink-3"> · {c.avance.siguienteAccion.texto}</span>}
        </div>
      )}

      {/* Señales */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(c.archivos ?? 0) > 0 && (
          <Pastilla icon={FileText} tono="neutral">
            {c.archivos} CV/doc
          </Pastilla>
        )}
        {(c.mensajes ?? 0) > 0 && (
          <Pastilla icon={MessageCircle} tono="good">
            {c.mensajes} msgs
          </Pastilla>
        )}
        {c.entrevistaEstado === "evaluada" && (
          <Pastilla icon={Video}>match {c.entrevistaMatch ?? "—"}</Pastilla>
        )}
        {c.expedienteId != null && (
          <Pastilla icon={UserCheck} tono="good">
            expediente {c.expedienteProgreso ?? 0}%
          </Pastilla>
        )}
        {c.consentimiento === false && (
          <Pastilla icon={AlertTriangle} tono="warn">
            sin consentimiento
          </Pastilla>
        )}
      </div>

      {/* Fecha última actividad / aplicación */}
      {(c.ultimaActividadEn || c.aplicado) && (
        <div className="mt-2.5 flex items-center gap-1 border-t border-border-faint pt-2 text-[10px] text-ink-3">
          <Clock className="h-3 w-3" />
          <span>
            {c.ultimaActividadEn
              ? `Actividad ${fechaCorta(c.ultimaActividadEn)}`
              : `Aplicó ${fechaCorta(c.aplicado)}`}
          </span>
        </div>
      )}
    </button>
    </div>
  );
}

function Pastilla({
  icon: Icon,
  children,
  tono = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  tono?: "neutral" | "good" | "warn";
}) {
  const tonos = {
    neutral: "bg-surface-2 text-ink-3",
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]", tonos[tono])}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

type TabCandidato = "resumen" | "evaluaciones" | "documentos" | "whatsapp" | "contratacion";

/** `reintentar` (Lote 4): presente solo en avisos de error de acciones que pueden toparse con
 * un bloqueo de estado forzable — el botón "Continuar de todos modos" solo se pinta si además
 * Modo Prueba está activo (ver useModoPrueba). */
type AvisoEstado = { tono: "ok" | "error" | "warn"; texto: string; reintentar?: () => void; accion?: { texto: string; onClick: () => void } } | null;

/* ============================================================
   MODAL CENTRADO: Detalle del Candidato (4 pestañas + Contratación condicional)
   ============================================================ */
/** Texto del aviso tras una acción que notifica: qué salió y por qué canal, o que la regla
 * no tenía nada activo (Punto 12). */
function resumenEnvio(r: { ok: boolean; data?: { resultados?: { enviado: boolean }[] } }, base: string): string {
  const resultados = r.ok ? r.data?.resultados ?? [] : [];
  const enviados = resultados.filter((x) => x.enviado).length;
  if (resultados.length === 0) return `${base} No había ningún destinatario activo — revisa la línea «Notificar» o Configuración → Notificaciones.`;
  return enviados === 0 ? `${base} Ningún envío se completó (revisa los datos de contacto).` : `${base} ${enviados} envío(s) realizados.`;
}

function ModalCandidato({
  c,
  live,
  onClose,
  onCambio,
  onEliminado,
}: {
  c: Candidato;
  live: boolean;
  onClose: () => void;
  onCambio: (c: Candidato) => void;
  onEliminado?: () => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const modoPrueba = useModoPrueba();
  const ambientePrueba = useAmbientePrueba();
  // CRUD (2026-09-15): eliminar candidato (baja lógica de la persona) con confirmación
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState("");
  async function eliminarPersona() {
    setEliminando(true);
    setErrorEliminar("");
    const r = await eliminarCandidato(c.id);
    setEliminando(false);
    if (!r.ok) return setErrorEliminar(r.error);
    setConfirmarEliminar(false);
    onEliminado?.();
  }
  const [tab, setTab] = useState<TabCandidato>(() => (c.etapa === "Contratación" ? "contratacion" : "resumen"));
  // Si el candidato ENTRA a Contratación mientras el modal ya está abierto (p.ej. RH lo mueve
  // de etapa sin cerrar la ficha), salta solo a esa pestaña para que no se pierda entre las
  // demás — sin esto, seguiría en "resumen" hasta que el usuario la buscara a mano.
  const etapaAnterior = useRef(c.etapa);
  useEffect(() => {
    if (c.etapa === "Contratación" && etapaAnterior.current !== "Contratación") {
      setTab("contratacion");
    }
    etapaAnterior.current = c.etapa;
  }, [c.etapa]);
  const [aviso, setAviso] = useState<AvisoEstado>(null);
  const [ocupado, setOcupado] = useState("");
  const [comentario, setComentario] = useState("");
  const [modalEntrevista, setModalEntrevista] = useState(false);
  // Fraiche (spec §8): la misma agenda sirve para la ronda IPV con entrevistador humano; el
  // selector «Red Human o humano» vive en ModalElegirIpv.
  const [entrevistaEsIpv, setEntrevistaEsIpv] = useState(false);
  const [eligiendoIpv, setEligiendoIpv] = useState(false);
  function abrirAgendaIpvHumana() {
    setEligiendoIpv(false);
    setEntrevistaEsIpv(true);
    setModalEntrevista(true);
  }

  function resolver<T>(r: { ok: true; data: T } | { ok: false; error: string }, exito: string, reintentar?: () => void) {
    setOcupado("");
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error, reintentar });
      return null;
    }
    setAviso({ tono: "ok", texto: exito });
    return r.data;
  }

  /** 2026-09-17: Descartar pasa SIEMPRE por confirmación con motivo (HITL, queda en bitácora). Con
   * expediente abierto (Contratación/Onboarding) el backend lo cancela en la misma decisión. */
  const [confirmarDescartar, setConfirmarDescartar] = useState<null | { motivo: string }>(null);
  const [toast, setToast] = useState<ToastMsg>(null);

  function descartar() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setConfirmarDescartar({ motivo: comentario });
  }

  async function descartarConfirmado() {
    if (!confirmarDescartar) return;
    setOcupado("descartar");
    const r = await decidirCandidato(c.id, "descartar", confirmarDescartar.motivo.trim());
    const data = resolver(r, "Candidato descartado.");
    if (data) {
      setComentario("");
      setConfirmarDescartar(null);
      onCambio(data);
    }
  }

  /** Botón explícito de avance — PATCH /candidatos/{codigo}/etapa con el destino exacto.
   * `forzarPrueba` (Lote 4): si el primer intento falla y Modo Prueba está activo, el aviso de
   * error trae un botón "Continuar de todos modos" que reintenta con el flag en true. */
  async function enviarAEtapa(etapa: EtapaCandidato, forzarPrueba = false) {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado(etapa);
    const r = await moverEtapaCandidato(c.id, etapa, comentario, forzarPrueba);
    setOcupado("");
    if (!r.ok) {
      // 2026-10-02 (§11): si falta una validación obligatoria se dice cuál y se ofrece ir a resolverla; el botón se conserva
      setAviso({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba ? () => enviarAEtapa(etapa, true) : undefined,
        accion: /falta/i.test(r.error) ? { texto: "Ver qué falta", onClick: () => verAvance() } : undefined,
      });
      return;
    }
    setComentario("");
    onCambio(r.data);
    setTab(etapa === "Contratación" || etapa === "Onboarding" ? "contratacion" : "resumen");
    const sig = r.data.avance?.siguienteAccion?.texto;
    setAviso({ tono: "ok", texto: `Movido a ${nombreEtapa(etapa)}.${sig ? ` Siguiente: ${sig}.` : ""}` });
  }
  /** Lleva al bloque «Avance» del Resumen (qué falta y cómo resolverlo). */
  function verAvance() {
    setTab("resumen");
    setTimeout(() => document.getElementById("ficha-avance")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  /** MODO PRUEBA (Punto 8): cierra la postulación actual y crea una nueva limpia para la misma
   * vacante, conservando teléfono y wa_id para volver a probar el flujo desde cero. */
  async function reiniciarPrueba() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar la acción en la bitácora." });
    if (!window.confirm(`¿Reiniciar la prueba de ${c.nombre} en «${c.puesto || "esta vacante"}»? Se reinician respuestas, resultados, etapa, citas y conversación SOLO de esta postulación (la anterior queda como historial). La persona y su vínculo con ${CANAL} se conservan.`)) {
      return;
    }
    setOcupado("reiniciar-prueba");
    const r = await reiniciarPostulacionPrueba(c.id);
    const data = resolver(r, `Prueba reiniciada: el candidato vuelve a empezar desde el primer paso por ${CANAL}.`);
    if (data) onCambio(data);
  }

  // Punto 12: cada acción que notifica pasa por una confirmación ligera con la línea
  // "Notificar: … · Editar"; el ajuste viaja como `notificar` solo para esa acción.
  const [confirmacion, setConfirmacion] = useState<null | "solicitar" | "recordatorio" | "alta">(null);
  // 2026-09-16 (control manual de RH): «Mover a otra etapa» — selector simple + motivo opcional
  const [moverA, setMoverA] = useState<null | { etapa: EtapaCandidato | ""; motivo: string }>(null);
  // Fraiche (spec §11-13): «Mover en la ruta…», «Presentar al franquiciatario» y «Generar ficha para presentar»
  const [moverPaso, setMoverPaso] = useState<null | { paso: PasoFraiche | ""; comentario: string }>(null);
  const [presentarAbierto, setPresentarAbierto] = useState(false);
  const [fichaAbierta, setFichaAbierta] = useState(false);
  const esFranquicia = c.destino === "franquicia";
  async function moverEnRuta() {
    if (!moverPaso?.paso) return;
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado("mover-paso");
    const r = await moverPasoCandidato(c.id, moverPaso.paso, moverPaso.comentario.trim());
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    const nombre = (c.ruta ?? []).find((x) => x.clave === moverPaso.paso)?.nombre ?? moverPaso.paso;
    setMoverPaso(null);
    onCambio(r.data);
    setAviso({ tono: "ok", texto: `Movido a «${nombre}» en la ruta.` });
  }
  /** Tras generar la ficha o presentar al franquiciatario: recarga la ficha (historial, evaluaciones). */
  async function refrescarFicha(texto?: string) {
    const actualizado = await fetchCandidato(c.id);
    if (actualizado) onCambio(actualizado);
    if (texto) setAviso({ tono: "ok", texto });
  }
  // Evaluaciones (2026-09-28): «Agregar evaluación o verificación» — nunca mueve la columna del pipeline
  const [agregarEval, setAgregarEval] = useState(false);
  const [tipoEvalInicial, setTipoEvalInicial] = useState<string>("");
  const [versionEval, setVersionEval] = useState(0);
  // Pipeline v2 (2026-10-01): franquicia — RH registra la contratación y el ingreso confirmados por el franquiciatario
  const [confirmarFranquicia, setConfirmarFranquicia] = useState<null | "contratacion" | "ingreso">(null);
  const [notaFranquicia, setNotaFranquicia] = useState("");
  const esRutaFranquicia = (c.avance?.destino || "") === "franquicia";
  const esRutaTienda = (c.avance?.destino || "") === "tienda_propia";
  // 2026-10-02 (§12): Entrevista humana e IPV SIEMPRE visibles en «Agregar evaluación» (aunque ya haya entrevistas o
  // el candidato esté en etapas posteriores); en franquicia, la presentación al franquiciatario.
  const antesDeFiltroHumano = c.etapa === "Prefiltro" || c.etapa === "Entrevista IA";
  const accionesRutaEval = [
    { etiqueta: "Entrevista humana", descripcion: antesDeFiltroHumano ? "Reclutamiento, encargado o franquiciatario · pasa a Filtro humano" : "Reclutamiento, encargado o franquiciatario · adicional",
      onClick: () => { setAgregarEval(false); setModalEntrevista(true); } },
    ...(esRutaFranquicia
      ? [{ etiqueta: "Presentación al franquiciatario", descripcion: "Entrevista y decisión del franquiciatario", onClick: () => { setAgregarEval(false); setPresentarAbierto(true); } }]
      : [{ etiqueta: "Entrevista IPV", descripcion: "Red Human (recomendada) o entrevistador humano", onClick: () => { setAgregarEval(false); setEligiendoIpv(true); } }]),
  ];
  async function registrarFranquicia() {
    if (!confirmarFranquicia) return;
    setOcupado("franquicia");
    const r = confirmarFranquicia === "contratacion" ? await confirmarContratacionFranquicia(c.id, notaFranquicia.trim()) : await confirmarIngresoFranquicia(c.id, notaFranquicia.trim());
    const data = resolver(r, confirmarFranquicia === "contratacion" ? "Contratación confirmada por el franquiciatario." : "Ingreso confirmado por el franquiciatario: proceso cerrado.");
    if (data) {
      setConfirmarFranquicia(null);
      setNotaFranquicia("");
      onCambio(data);
    }
  }
  /** Pipeline v2: la acción principal sale del avance que calcula la API (ruta + pendientes). */
  function ejecutarSiguiente(acc: AccionSiguiente) {
    switch (acc.tipo) {
      case "mover":
        if (acc.etapa) void enviarAEtapa(acc.etapa as EtapaCandidato);
        return;
      case "agregar_evaluacion":
        if (acc.evaluacion === "entrevista_humana") return setModalEntrevista(true);
        if (acc.evaluacion === "ipv") return acc.modo === "humano" ? abrirAgendaIpvHumana() : setEligiendoIpv(true);
        if (acc.evaluacion === "presentacion_franquiciatario") return setPresentarAbierto(true);
        setTipoEvalInicial(acc.evaluacion ?? "");
        return setAgregarEval(true);
      case "revisar_evaluacion":
      case "esperar_resultado":
      case "registrar_decision_franquiciatario":
        return setTab("evaluaciones");
      case "confirmar_contratacion_franquicia":
        return setConfirmarFranquicia("contratacion");
      case "confirmar_ingreso_franquicia":
        return setConfirmarFranquicia("ingreso");
      case "expediente":
      case "preparar_alta_sap":
        return setTab("contratacion");
      case "esperar_chat":
        return setTab("whatsapp");
      case "no_cumple":
        return descartar();
      default:
        return;
    }
  }
  /** 2026-10-01: desde un resultado resumido se abre SU evaluación dentro de la ficha. */
  function verEvaluacion(ancla: string) {
    setTab("evaluaciones");
    setTimeout(() => document.getElementById(ancla)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }
  const ACCIONES_SIN_BOTON = new Set(["esperar", "esperar_entrevista", "ninguna", "alta", "invitar_entrevista_red_human", "reabrir_entrevista", "registrar_entrevista", "revisar_prefiltro"]);
  const accionSiguiente = c.avance?.siguienteAccion;
  const botonSiguiente = puedeDecidir && c.activa !== false && accionSiguiente && !ACCIONES_SIN_BOTON.has(accionSiguiente.tipo) ? accionSiguiente : null;
  // 2026-10-02 (§3/§11): la barra fija ejecuta la siguiente acción desde CUALQUIER pestaña.
  const [autoIniciarOnboarding, setAutoIniciarOnboarding] = useState(false);
  const limpiarAutoIniciar = useCallback(() => setAutoIniciarOnboarding(false), []);
  function verEntrevistasHumanas() {
    setTimeout(() => document.getElementById("entrevistas-humanas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
  async function invitarRedHuman() {
    setOcupado("invitar");
    const r = await agendarEntrevista(c.id, true);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    await refrescarFicha(`Entrevista Red Human programada; la liga se envió al candidato por ${CANAL}.`);
  }
  async function reabrirRedHuman(codigo?: string) {
    if (!codigo) return;
    setOcupado("reabrir");
    const r = await reabrirEntrevista(codigo, "Reabierta desde la ficha");
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    await refrescarFicha("Entrevista Red Human reabierta con la misma liga.");
  }
  type BotonBarra = { texto: string; onClick?: () => void; espera?: boolean; disabled?: boolean; title?: string };
  const principal: BotonBarra | null = (() => {
    if (!puedeDecidir || c.activa === false) return null;
    const a = accionSiguiente;
    if (!a) return null;
    switch (a.tipo) {
      case "alta":
        if (esFranquicia) return { texto: a.texto, espera: true };
        return {
          texto: c.expedienteEstado === "alta" ? "Alta completada ✓" : (c.expedienteProgreso ?? 0) < 100 && modoPrueba ? `Dar de alta (Modo Prueba · ${c.expedienteProgreso ?? 0}%)` : "Dar de alta como colaborador",
          onClick: () => setConfirmacion("alta"),
          disabled: c.expedienteEstado === "alta" || ((c.expedienteProgreso ?? 0) < 100 && !modoPrueba),
          title: (c.expedienteProgreso ?? 0) < 100 && !modoPrueba ? "Completa y valida el expediente al 100% (o activa Modo Prueba) para dar de alta." : undefined,
        };
      case "mover":
        if (a.etapa === "Onboarding" && !esRutaFranquicia) return { texto: "Pasar a Onboarding", onClick: () => { setTab("contratacion"); setAutoIniciarOnboarding(true); } };
        return { texto: a.texto, onClick: () => a.etapa && void enviarAEtapa(a.etapa as EtapaCandidato) };
      case "registrar_entrevista":
        return { texto: a.texto, onClick: verEntrevistasHumanas };
      case "invitar_entrevista_red_human":
        return { texto: a.texto, onClick: () => void invitarRedHuman() };
      case "reabrir_entrevista":
        return { texto: a.texto, onClick: () => void reabrirRedHuman(a.codigo) };
      case "revisar_prefiltro":
        return { texto: a.texto, onClick: () => verEvaluacion("eval-prefiltro") };
      case "esperar_chat":
        return { texto: a.texto, espera: true, onClick: () => setTab("whatsapp") };
      case "esperar_resultado":
        return { texto: a.texto, espera: true, onClick: () => setTab("evaluaciones") };
      case "esperar_entrevista":
      case "esperar":
      case "ninguna":
        return { texto: a.texto || "Sin acciones pendientes", espera: true };
      default:
        return { texto: a.tipo === "no_cumple" ? "Descartar candidato…" : a.texto, onClick: () => ejecutarSiguiente(a) };
    }
  })();
  // 2026-09-22: confirmación de «Avanzar a Entrevista Humana» (omite la Entrevista Red Human)
  const [avanceDirecto, setAvanceDirecto] = useState(false);
  async function confirmarAvanceDirecto() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado("avance-directo");
    const r = await avanzarAEntrevistaHumana(c.id);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAvanceDirecto(false);
    onCambio(r.data);
    setAviso({ tono: "ok", texto: "Candidato en Entrevista Humana. La Entrevista Red Human quedó registrada como omitida manualmente." });
  }
  async function moverManual() {
    if (!moverA?.etapa || !moverA.motivo.trim()) return;
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado("mover");
    const r = await moverEtapaCandidato(c.id, moverA.etapa, moverA.motivo, false, true);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    const omitidas = (r.data.actividadesOmitidas ?? []).filter((o) => o.hacia === moverA.etapa).map((o) => nombreEtapa(o.actividad));
    setMoverA(null);
    onCambio(r.data);
    setAviso({ tono: "ok", texto: `Movido a ${nombreEtapa(moverA.etapa)}.${omitidas.length ? ` Omitido manualmente: ${omitidas.join(", ")}.` : ""}` });
  }
  const notificarAltaRef = useRef<NotificarAccion | undefined>(undefined);

  /** Onboarding · Zero-Touch fase 2 — RH detona, la IA da seguimiento por WhatsApp. */
  async function solicitarDocumentos(notificar?: NotificarAccion) {
    if (!live) return setAviso({ tono: "warn", texto: `Levanta la API para enviar mensajes por ${CANAL}.` });
    setOcupado("solicitar-documentos");
    const r = await solicitarDocumentosCandidato(c.id, notificar);
    const data = resolver(r, resumenEnvio(r, "Solicitud de documentos enviada."));
    if (data) onCambio(data.candidato);
  }

  async function enviarRecordatorioDocumentos(notificar?: NotificarAccion) {
    if (!live) return setAviso({ tono: "warn", texto: `Levanta la API para enviar mensajes por ${CANAL}.` });
    setOcupado("recordatorio-documentos");
    const r = await recordatorioDocumentosCandidato(c.id, notificar);
    const data = resolver(r, resumenEnvio(r, "Recordatorio enviado."));
    if (data) onCambio(data.candidato);
  }

  /** Botón principal de Onboarding — cierra el ciclo y mueve el registro a Colaboradores.
   * Siempre visible y habilitado mientras esté en Onboarding: si faltan documentos
   * obligatorios, el backend lo rechaza (409) y el motivo se muestra en {aviso}. Con Modo
   * Prueba activo, ese aviso trae un botón "Continuar de todos modos" — salvo que el 409 sea
   * "ya fue dado de alta", que el backend nunca deja saltar (ver contratacion.alta). */
  async function darDeAltaComoColaborador(forzarPrueba = false, notificar?: NotificarAccion) {
    if (!live || !c.expedienteId) return setAviso({ tono: "warn", texto: "Levanta la API para dar de alta al candidato." });
    if (notificar) notificarAltaRef.current = notificar;
    setOcupado("alta");
    const r = await autorizarAlta(c.expedienteId, undefined, forzarPrueba, notificarAltaRef.current);
    if (!r.ok) {
      setOcupado("");
      // 2026-09-15: sin documentos adjuntos el backend responde 400 y NO se puede forzar ni en Modo
      // Prueba — no se ofrece «Continuar de todos modos», solo el aviso rojo con el motivo.
      const sinDocumentos = /no tiene documentos adjuntos/i.test(r.error);
      return setAviso({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba && !sinDocumentos ? () => darDeAltaComoColaborador(true) : undefined,
      });
    }
    const actualizado = await fetchCandidato(c.id);
    setOcupado("");
    if (actualizado) onCambio(actualizado);
    // Fase 5: qué salió (bienvenida + instrucciones de ingreso al candidato; aviso al Cliente)
    const envios = r.data.notificaciones ?? [];
    const ok = envios.filter((x) => x.enviado).map((x) => `${x.destinatario} por ${x.canal}`);
    const fallidos = envios.filter((x) => !x.enviado).map((x) => `${x.destinatario} por ${x.canal}${x.detalle ? ` (${x.detalle})` : ""}`);
    setAviso({
      tono: fallidos.length && !ok.length ? "warn" : "ok",
      texto:
        "Alta registrada — el candidato se movió a Colaboradores." +
        (ok.length ? ` Bienvenida enviada: ${ok.join(", ")}.` : "") +
        (fallidos.length ? ` No salió: ${fallidos.join("; ")}.` : ""),
    });
  }

  async function consentir() {
    setOcupado("consentimiento");
    const r = await registrarConsentimiento(c.id, {
      medio: "verbal",
      evidencia: "Consentimiento confirmado por RH durante el contacto con la persona candidata.",
    });
    const data = resolver(r, "Consentimiento registrado en la bitácora.");
    if (data) onCambio(data);
  }

  const siguientesEtapas = SIGUIENTE_ETAPA_MANUAL[c.etapa] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-md animate-in fade-in duration-200 sm:p-6">
      <div
        className="relative flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden border border-border-soft bg-bg shadow-2xl animate-in zoom-in-95 duration-200 sm:h-auto sm:max-h-[92vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="glass sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border-soft px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar name={c.nombre} tone={c.tono} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display truncate text-lg sm:text-xl font-bold text-ink">{c.nombre}</h2>
                <span className="font-mono text-xs text-ink-3" title="Postulación">{c.id}</span>
                {c.candidatoCodigo && (
                  <span className="font-mono text-[10px] text-ink-3" title="Persona (maestro de identidad)">
                    · {c.candidatoCodigo}
                  </span>
                )}
                {c.yaAplicoAntes && (
                  <span
                    title={`Esta persona tiene ${c.totalPostulaciones} postulaciones en diferentes vacantes`}
                    className="rounded bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-600"
                  >
                    🔄 {c.totalPostulaciones} postulaciones
                  </span>
                )}
                {c.activa === false && (
                  <span
                    title={`Cerrada: ${c.motivoCierre || "sin motivo"}. Mover de etapa la reabre.`}
                    className="rounded bg-ink-3/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-ink-3"
                  >
                    Cerrada · {c.motivoCierre || "—"}
                  </span>
                )}
                {c.enConversacion && c.yaAplicoAntes && (
                  <span
                    title={`El ${CANAL} de esta persona está conversando sobre ESTA postulación`}
                    className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700"
                  >
                    💬 En chat
                  </span>
                )}
              </div>
              <p className="truncate text-xs sm:text-sm text-ink-2">
                {c.puesto || "Sin vacante asignada"} · <b className="text-ink font-semibold">{c.fuente}</b>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {live && puedeDecidir && (
              <Button
                size="sm"
                variant="outline"
                className="border-bad/40 text-bad hover:bg-bad-soft"
                onClick={() => setConfirmarEliminar(true)}
                disabled={eliminando}
              >
                <Trash2 className="h-4 w-4" /> Eliminar candidato
              </Button>
            )}
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2 transition"
              aria-label="Cerrar modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Fraiche (spec §11): ruta visible por destino — una línea, se desliza en móvil */}
        {/* 2026-10-01: etapas alineadas al pipeline estándar (cinco columnas); Telegram, Entrevista Red Human y la
            presentación al franquiciatario son actividades dentro de su columna (ver «Avance» en el Resumen). */}
        <div className="flex items-center gap-2 border-b border-border-soft bg-surface px-4 py-1.5 sm:px-6">
          <RutaStepper ruta={etapas.map((e) => ({ clave: e, nombre: nombreEtapa(e) }))} paso={columnaDe(c.etapa)} />
        </div>

        {confirmarEliminar && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !eliminando && setConfirmarEliminar(false)}>
            <div className="w-full max-w-md rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bad-soft text-bad">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold">¿Estás seguro de que deseas eliminar a este candidato?</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">
                    <b>{c.nombre}</b> desaparecerá del tablero y de las búsquedas; todas sus postulaciones activas se cerrarán
                    {c.totalPostulaciones && c.totalPostulaciones > 1 ? ` (tiene ${c.totalPostulaciones})` : ""}. Nada se borra físicamente:
                    su historial (entrevistas, expediente, mensajes) se conserva y la acción queda en la bitácora.
                  </p>
                  {errorEliminar && <p className="mt-2 text-sm font-semibold text-bad">{errorEliminar}</p>}
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmarEliminar(false)} disabled={eliminando}>
                  Cancelar
                </Button>
                <Button size="sm" className="bg-bad text-white hover:bg-bad/90" onClick={eliminarPersona} disabled={eliminando}>
                  <Trash2 className="h-4 w-4" /> {eliminando ? "Eliminando…" : "Sí, eliminar candidato"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Barra de Pestañas Principales (4 base + Contratación condicional) */}
        <div className="border-b border-border-soft bg-surface-2/70 pt-3">
          {/* 2026-09-17 (móvil): las pestañas se deslizan con el dedo (scroll-x) en vez de recortarse */}
          <div className="scroll-x gap-2 px-4 sm:px-6">
            {(
              [
                { id: "resumen", label: "Resumen", icon: User, tone: "brand" },
                { id: "evaluaciones", label: "Evaluaciones", icon: Sparkles, tone: "human" },
                { id: "documentos", label: "CV y documentos", icon: FileText, tone: "brand" },
                { id: "whatsapp", label: CANAL, icon: MessageCircle, tone: "good", badge: c.mensajes },
                // 2026-09-17: la pestaña del expediente (checklist de documentos) vive en Contratación Y
                // Onboarding — antes desaparecía al pasar a Onboarding y RH ya no veía qué faltaba.
                ...(c.etapa === "Contratación" || c.etapa === "Onboarding"
                  ? [{ id: "contratacion", label: c.etapa === "Onboarding" ? "Expediente" : "Contratación", icon: Briefcase, tone: "warn" }]
                  : []),
              ] as { id: TabCandidato; label: string; icon: typeof User; tone: string; badge?: number }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-xl px-3 py-2.5 text-sm font-semibold transition border-b-2 sm:px-4",
                  tab === t.id ? TAB_TONE_ACTIVA[t.tone] : "border-transparent text-ink-3 hover:text-ink hover:bg-surface/50",
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                {Boolean(t.badge) && (
                  <span className={cn("rounded-full px-2 py-0.2 font-mono text-[11px] font-bold", TAB_TONE_BADGE[t.tone])}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Cuerpo Scrolleable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-5">
          {aviso && (
            <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>
              {aviso.texto}
              {(aviso.reintentar || aviso.accion) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {aviso.accion && (
                    <Button size="sm" variant="outline" onClick={aviso.accion.onClick}>{aviso.accion.texto}</Button>
                  )}
                  {aviso.reintentar && (
                    <Button size="sm" variant="outline" onClick={aviso.reintentar}>
                      <FlaskConical className="h-3.5 w-3.5" /> Continuar de todos modos (modo prueba)
                    </Button>
                  )}
                </div>
              )}
            </Aviso>
          )}

          {c.consentimiento === false && (
            <Card className="border-warn/30 bg-warn-soft/40 p-4">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <div className="flex-1">
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    <b className="text-ink">Sin consentimiento registrado.</b> La LFPDPPP exige consentimiento
                    explícito antes de tratar los datos del candidato o abrir su expediente.
                  </p>
                  {live && (
                    <Button size="sm" variant="outline" className="mt-3" onClick={consentir} disabled={Boolean(ocupado)}>
                      Registrar consentimiento
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Fraiche (spec §12): ruta de franquicia — presentar, estado y ficha; sin documentación ni alta */}
          {false && esFranquicia && (
            <PanelFranquicia
              c={c}
              live={live}
              ocupado={Boolean(ocupado)}
              onPresentar={() => setPresentarAbierto(true)}
              onFicha={() => setFichaAbierta(true)}
              onCambio={onCambio}
              setAviso={setAviso}
            />
          )}

          {/* 2026-10-02 (§12): cada entrevista (reclutamiento, IPV humana, encargado, franquiciatario) con su agenda,
              resultado y avisos propios — visibles en cualquier etapa mientras sigan abiertas */}
          {(() => {
            const todas = c.entrevistasHumanas?.length ? c.entrevistasHumanas : c.entrevistaHumana ? [c.entrevistaHumana] : [];
            const vivas = todas.filter((x) => !x.cancelada && !x.resultado);
            const ultima = todas[todas.length - 1];
            const mostrar = vivas.length ? vivas : c.etapa === "Entrevista Humana" && ultima && !ultima.cancelada ? [ultima] : [];
            if (!mostrar.length) return null;
            return (
              <div id="entrevistas-humanas" className="flex flex-col gap-3">
                {mostrar.map((x, i) => (
                  <PanelEntrevistaHumana key={x.id ?? `eh-${i}`} c={c} eh={x} live={live} onCambio={onCambio} onNuevaIpv={abrirAgendaIpvHumana} />
                ))}
              </div>
            );
          })()}

          {tab === "resumen" && (
            <PestanaResumen c={c} live={live} onCambio={onCambio} setTab={setTab} boton={botonSiguiente} ocupado={Boolean(ocupado)}
              onAccion={ejecutarSiguiente} onVerEvaluacion={verEvaluacion} puedeDecidir={puedeDecidir} />
          )}
          {tab === "evaluaciones" && (
            <PestanaEvaluaciones
              c={c}
              live={live}
              onCambio={onCambio}
              versionEval={versionEval}
              onProgramarIpv={(modo) => (modo === "humano" ? abrirAgendaIpvHumana() : setEligiendoIpv(true))}
              accionesRuta={accionesRutaEval}
            />
          )}
          {tab === "documentos" && <PestanaDocumentos c={c} live={live} onCambio={onCambio} setAviso={setAviso} />}
          {tab === "whatsapp" && <PestanaWhatsApp c={c} live={live} onCambio={onCambio} />}
          {tab === "contratacion" && (c.etapa === "Contratación" || c.etapa === "Onboarding") && (
            <PanelContratacion
              c={c}
              live={live}
              onCambio={onCambio}
              setAviso={setAviso}
              onDocumentos={setConfirmacion}
              onDescartar={descartar}
              accionesExtra={[]}
              autoIniciarOnboarding={autoIniciarOnboarding}
              onAutoIniciado={limpiarAutoIniciar}
            />
          )}
        </div>

        {/* MODO PRUEBA (Punto 8): independiente de la etapa — reinicia la postulación sin borrar teléfono.
            Solo visible con Modo Prueba activo o sobre una postulación de prueba (el backend lo exige). */}
        {puedeDecidir && (modoPrueba || ambientePrueba || c.esPrueba) && (
          <div className="border-t border-border-soft bg-surface px-6 py-2">
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={reiniciarPrueba}
                disabled={Boolean(ocupado)}
                title="Modo Prueba (Punto 8): cierra la postulación actual y crea una nueva limpia para volver a probar desde cero."
                className="text-[11px] text-ink-3 hover:text-brand hover:bg-brand-soft/40 transition"
              >
                <RotateCw className="h-3.5 w-3.5" /> Reiniciar prueba
              </Button>
            </div>
          </div>
        )}

        {/* 2026-10-02 (Fraiche §3/§11): BARRA FIJA al pie de la ficha, visible desde cualquier pestaña y en cualquier
            etapa: UN botón principal con la siguiente acción según la ruta y el avance + «Más acciones ⋯». Programar
            una evaluación (modales) nunca la oculta. */}
        {puedeDecidir && (
          <div className="shrink-0 border-t border-border-soft bg-surface px-4 py-3 sm:px-6">
            {c.etapa === "Onboarding" && !esFranquicia && aviso && aviso.tono !== "ok" && (
              <div role="alert" className="mb-2 flex items-start gap-2 rounded-xl border border-bad/40 bg-bad-soft px-3 py-2 text-xs font-semibold text-bad">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{aviso.texto}</span>
              </div>
            )}
            {c.etapa === "Onboarding" && !esFranquicia && principal && accionSiguiente?.tipo === "alta" && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] text-ink-3">
                  Expediente al <b className={cn("font-mono", (c.expedienteProgreso ?? 0) >= 100 ? "text-good" : "text-warn")}>{c.expedienteProgreso ?? 0}%</b>
                  {(c.expedienteProgreso ?? 0) < 100 && !modoPrueba ? " · el alta exige 100% validado" : ""}
                </span>
                <SwitchModoPrueba />
              </div>
            )}
            <div className="flex items-center gap-2">
              {principal ? (
                principal.espera ? (
                  <button
                    type="button"
                    onClick={principal.onClick}
                    disabled={!principal.onClick}
                    className="flex min-h-10 flex-1 items-center gap-2 rounded-xl border border-border-soft bg-surface-2 px-3 py-2 text-left text-[13px] text-ink-2 enabled:hover:bg-surface-2/70"
                    title={principal.onClick ? "Ver" : undefined}
                  >
                    <Clock className="h-4 w-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 truncate">{principal.texto}</span>
                  </button>
                ) : (
                  <Button className="min-h-10 flex-1" onClick={principal.onClick} disabled={Boolean(ocupado) || principal.disabled} title={principal.title}>
                    {ocupado && ocupado !== "" && !principal.disabled ? "Procesando…" : principal.texto}
                  </Button>
                )
              ) : (
                <span className="flex-1 text-[12px] text-ink-3">{c.activa === false ? "Postulación cerrada" : ""}</span>
              )}
              <MenuAcciones
                conTexto
                etiqueta="Más acciones"
                acciones={[
                  { etiqueta: "Agregar evaluación", icono: <IconoEvaluacion />, onClick: () => { setTipoEvalInicial(""); setAgregarEval(true); }, disabled: Boolean(ocupado) || c.activa === false },
                  { etiqueta: "Movimiento excepcional…", icono: <ArrowRightLeft />, onClick: () => setMoverA({ etapa: "", motivo: "" }), disabled: Boolean(ocupado) },
                  { etiqueta: "Generar ficha para presentar", icono: <FileDown />, onClick: () => setFichaAbierta(true), disabled: Boolean(ocupado) },
                  ...(c.etapa === "Onboarding" && !esFranquicia
                    ? [
                        { etiqueta: "Solicitar documentos", icono: <Send />, onClick: () => setConfirmacion("solicitar"), disabled: Boolean(ocupado) },
                        { etiqueta: etiquetaRecordatorio(c.recordatorioNivel, c.recordatoriosEnviados).texto, icono: <RotateCw />, onClick: () => setConfirmacion("recordatorio"), disabled: Boolean(ocupado) },
                      ]
                    : []),
                  { etiqueta: "Descartar candidato…", icono: <ThumbsDown />, peligrosa: true, onClick: descartar, disabled: Boolean(ocupado) || c.activa === false },
                ]}
              />
            </div>
          </div>
        )}
      </div>

      {confirmarDescartar && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !ocupado && setConfirmarDescartar(null)}>
            <div className="w-full max-w-md rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display text-lg font-bold text-bad">Descartar candidato</h3>
              <p className="mt-1 text-sm text-ink-2">
                La postulación de <b className="text-ink">{c.nombre}</b> se cierra como descartada y queda en el historial con tu nombre.
                {c.expedienteId != null ? " Su expediente de contratación se cancela." : ""}
              </p>
              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Motivo{c.expedienteId != null ? " (obligatorio)" : ""}</span>
                <input
                  autoFocus
                  value={confirmarDescartar.motivo}
                  onChange={(e) => setConfirmarDescartar({ motivo: e.target.value })}
                  placeholder="Ej. no cumple el requisito de disponibilidad"
                  className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmarDescartar(null)} disabled={ocupado === "descartar"}>Cancelar</Button>
                <Button
                  size="sm"
                  className="bg-bad text-white hover:bg-bad/90"
                  onClick={descartarConfirmado}
                  disabled={ocupado === "descartar" || (c.expedienteId != null && !confirmarDescartar.motivo.trim())}
                >
                  <ThumbsDown className="h-4 w-4" /> {ocupado === "descartar" ? "Descartando…" : "Sí, descartar"}
                </Button>
              </div>
            </div>
          </div>
        )}
      {avanceDirecto && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => ocupado !== "avance-directo" && setAvanceDirecto(false)}>
          <div className="w-full max-w-md rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">Avanzar a Entrevista Humana</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{TEXTO_AVANCE_DIRECTO}.</p>
            <p className="mt-2 text-xs text-ink-3">
              Queda registrado en el historial del expediente ({c.nombre}); lo que ya se generó (chat, análisis de CV, entrevista parcial) se conserva.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAvanceDirecto(false)} disabled={ocupado === "avance-directo"}>Cancelar</Button>
              <Button size="sm" onClick={confirmarAvanceDirecto} disabled={ocupado === "avance-directo"}>
                {ocupado === "avance-directo" ? "Avanzando…" : "Avanzar"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {agregarEval && (
        <ModalAgregarEvaluacion
          codigo={c.id}
          puesto={c.puesto}
          tipoInicial={(tipoEvalInicial || "") as never}
          excluir={esRutaFranquicia ? ["psicometrica", "medico", "socioeconomico"] : []}
          accionesRuta={accionesRutaEval}
          onClose={() => setAgregarEval(false)}
          onAgregada={(ev) => {
            setAgregarEval(false);
            setVersionEval((x) => x + 1);
            setTab("evaluaciones");
            const extra = ev as EvaluacionCandidato & { evaluaciones?: EvaluacionCandidato[]; omitidas?: string[]; envios?: EnvioAviso[] };
            const nombres = (extra.evaluaciones ?? [ev]).map((x) => `«${x.nombre}»`).join(", ");
            const envios = lineasEnvios(extra.envios ?? ev.envios);
            setAviso({
              tono: envios.some((l) => l.estado === "fallido") ? "warn" : "ok",
              texto: `${nombres} agregada${(extra.evaluaciones?.length ?? 1) > 1 ? "s" : ""}. El candidato sigue en ${nombreEtapa(c.etapa)}.`
                + (extra.omitidas?.length ? ` Ya estaban asignadas: ${extra.omitidas.join("; ")}.` : "")
                + (envios.length ? ` Avisos: ${envios.map((l) => `${l.estado === "enviado" ? "✓" : l.estado === "pendiente" ? "…" : "✗"} ${l.texto}`).join(" · ")}` : ""),
            });
          }}
        />
      )}
      {confirmarFranquicia && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => ocupado !== "franquicia" && setConfirmarFranquicia(null)}>
          <div className="w-full max-w-md rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">
              {confirmarFranquicia === "contratacion" ? "Confirmación de contratación del franquiciatario" : "Ingreso confirmado por el franquiciatario"}
            </h3>
            <p className="mt-2 text-sm text-ink-2">
              {confirmarFranquicia === "contratacion"
                ? "Registra que el franquiciatario confirmó la contratación. Fraiche no arma expediente, kit de precontratación ni alta SAP en esta ruta."
                : "Registra que el franquiciatario confirmó el ingreso. La postulación se cierra y cuenta como ingreso de franquicia (nunca de tienda propia)."}
            </p>
            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">Comentario (opcional)</span>
              <input value={notaFranquicia} onChange={(e) => setNotaFranquicia(e.target.value)} placeholder="Ej. confirmó por teléfono"
                className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmarFranquicia(null)} disabled={ocupado === "franquicia"}>Cancelar</Button>
              <Button size="sm" onClick={registrarFranquicia} disabled={ocupado === "franquicia"}>{ocupado === "franquicia" ? "Guardando…" : "Registrar"}</Button>
            </div>
          </div>
        </div>
      )}
      {moverA && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !ocupado && setMoverA(null)}>
            <div className="w-full max-w-md rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display text-lg font-bold">Movimiento excepcional</h3>
              <p className="mt-1 text-sm text-ink-2">
                Para retrocesos y saltos. Las evaluaciones y el historial se conservan; mover la tarjeta NO aprueba ni omite sola sus pendientes:
                lo que se salte queda registrado como «Omitida manualmente» con tu nombre y el motivo.
              </p>
              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Etapa destino</span>
                <select
                  value={moverA.etapa}
                  onChange={(e) => setMoverA({ ...moverA, etapa: e.target.value as EtapaCandidato | "" })}
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Elige…</option>
                  {(["Prefiltro", "Entrevista IA", "Entrevista Humana", "Contratación", "Onboarding"] as EtapaCandidato[])
                    .filter((e) => e !== c.etapa)
                    .map((e) => (
                      <option key={e} value={e}>{nombreEtapa(e)}</option>
                    ))}
                </select>
              </label>
              {moverA.etapa && (c.avance?.pendientes?.length ?? 0) > 0 && (
                <div className="mt-3 rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-[12px] text-ink-2">
                  <b className="text-warn">Pendientes que seguirán visibles:</b> {(c.avance?.pendientes ?? []).join(" · ")}
                </div>
              )}
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Motivo (obligatorio)</span>
                <input
                  value={moverA.motivo}
                  onChange={(e) => setMoverA({ ...moverA, motivo: e.target.value })}
                  placeholder="Ej. el candidato ya fue entrevistado por el cliente"
                  className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setMoverA(null)} disabled={ocupado === "mover"}>Cancelar</Button>
                <Button size="sm" onClick={moverManual} disabled={!moverA.etapa || !moverA.motivo.trim() || ocupado === "mover"}>
                  {ocupado === "mover" ? "Moviendo…" : moverA.etapa ? `Confirmar: mover a ${nombreEtapa(moverA.etapa)}` : "Confirmar"}
                </Button>
              </div>
            </div>
          </div>
        )}
      {moverPaso && (
        <ModalMoverPaso
          c={c}
          valor={moverPaso}
          ocupado={ocupado === "mover-paso"}
          onChange={setMoverPaso}
          onClose={() => setMoverPaso(null)}
          onMover={moverEnRuta}
        />
      )}
      {fichaAbierta && (
        <ModalFichaPresentacion
          c={c}
          onClose={() => setFichaAbierta(false)}
          onGenerada={(destinatario) => {
            setFichaAbierta(false);
            void refrescarFicha(`Ficha generada para ${destinatario}; quedó registrado en el historial.`);
          }}
        />
      )}
      {presentarAbierto && (
        <ModalPresentarFranquiciatario
          c={c}
          onClose={() => setPresentarAbierto(false)}
          onPresentado={(actualizado) => {
            onCambio(actualizado);
          }}
        />
      )}
        {confirmacion === "solicitar" && (
          <ConfirmacionAccion
            titulo="Solicitar documentos"
            texto={`Se le pedirá a ${c.nombre.split(" ")[0]} que suba sus documentos con la liga pública del expediente.`}
            evento="solicitud_documentos"
            hayEntrevistador={false}
            hayCliente={Boolean(c.clienteVacante)}
            clienteId={c.clienteIdVacante ?? null}
            etiquetaConfirmar="Enviar"
            onCancelar={() => setConfirmacion(null)}
            onConfirmar={async (n) => {
              setConfirmacion(null);
              await solicitarDocumentos(n);
            }}
          />
        )}
        {confirmacion === "recordatorio" && (
          <ConfirmacionAccion
            titulo={`Enviar recordatorio de documentos · nivel ${etiquetaRecordatorio(c.recordatorioNivel, c.recordatoriosEnviados).nivel} de 3 (${etiquetaRecordatorio(c.recordatorioNivel, c.recordatoriosEnviados).tono.nombre})`}
            texto={`${etiquetaRecordatorio(c.recordatorioNivel, c.recordatoriosEnviados).tono.descripcion} Incluye los documentos que siguen pendientes en el expediente.`}
            evento="recordatorio_documentos"
            hayEntrevistador={false}
            hayCliente={Boolean(c.clienteVacante)}
            clienteId={c.clienteIdVacante ?? null}
            etiquetaConfirmar="Enviar"
            onCancelar={() => setConfirmacion(null)}
            onConfirmar={async (n) => {
              setConfirmacion(null);
              await enviarRecordatorioDocumentos(n);
            }}
          />
        )}
        {confirmacion === "alta" && (
          <ConfirmacionAccion
            titulo="Dar de alta como colaborador"
            texto="RH autoriza el alta: el registro se mueve a Colaboradores y la postulación queda cerrada como contratada."
            evento="contratacion"
            hayEntrevistador={false}
            hayCliente={Boolean(c.clienteVacante)}
            clienteId={c.clienteIdVacante ?? null}
            etiquetaConfirmar="Dar de alta"
            onCancelar={() => setConfirmacion(null)}
            onConfirmar={async (n) => {
              setConfirmacion(null);
              // Modo Prueba activo con expediente incompleto → forzar directo (sin el segundo clic de «Continuar»)
              await darDeAltaComoColaborador(modoPrueba && (c.expedienteProgreso ?? 0) < 100, n);
            }}
          />
        )}
      <Toast msg={toast} onClose={() => setToast(null)} />
      {eligiendoIpv && (
        <ModalElegirIpv c={c} onClose={() => setEligiendoIpv(false)} onHumano={abrirAgendaIpvHumana} onCambio={onCambio} />
      )}
      {modalEntrevista && (
        <ModalProgramarEntrevista
          c={c}
          esIpv={entrevistaEsIpv}
          onClose={() => {
            setModalEntrevista(false);
            setEntrevistaEsIpv(false);
          }}
          onListo={(actualizado, resultados, advertencias) => {
            setModalEntrevista(false);
            setEntrevistaEsIpv(false);
            // Fase 7A: el resultado por canal ya no es silencioso — se muestra qué salió y qué no (y por qué)
            const lineas = lineasResultados(resultados);
            const fallidos = lineas.filter((l) => !l.ok);
            // 2026-09-18: además un toast amarillo flotante si algún correo/WhatsApp no salió (no se pierde con el scroll)
            const correoFallo = resultados.some((r) => r.canal === "correo" && !r.enviado && r.destino);
            if (advertencias?.length || correoFallo) {
              setToast({
                tono: "warn",
                texto: correoFallo ? "Entrevista asignada, pero el correo falló. Verifica la API Key o el Dominio" : "Entrevista asignada con avisos",
                detalle: advertencias ?? [],
              });
            }
            setAviso({
              tono: fallidos.length ? "warn" : "ok",
              texto: lineas.length
                ? `Entrevista programada. ${lineas.map((l) => `${l.ok ? "✓" : "✗"} ${l.texto}`).join(" · ")}`
                : "Entrevista programada. No había ningún destinatario activo — revisa la línea «Notificar» o Configuración → Notificaciones.",
            });
            onCambio(actualizado);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   PESTAÑA 1: Resumen — síntesis y decisión rápida (Punto 3, secciones A-G)

   Distribución (Punto 3): aquí solo va la síntesis para decidir sin entrar a las demás
   pestañas — el análisis detallado sigue viviendo en Evaluaciones, nunca se duplica un
   bloque completo, solo se referencia con "Ver detalle en Evaluaciones →".
   ============================================================ */

type EstadoAnalisisCv = "sin_cv" | "analizando" | "error" | "analizado";

/** Punto 2: sin columna de estado nueva — se deriva de si hay un Archivo tipo=cv y si
 * `cvDatos` trae señales reales de una extracción (nunca "N/D": vacío es vacío). */
function estadoAnalisisCv(c: Candidato, enVuelo: boolean): EstadoAnalisisCv {
  if (enVuelo) return "analizando";
  const tieneCv = (c.listaArchivos ?? []).some((a) => a.tipo === "cv");
  if (!tieneCv) return "sin_cv";
  const cv = c.cvDatos ?? {};
  const tieneExtraccion = Boolean(
    cv.resumen_profesional || cv.experiencia_resumen || cv.puesto_actual || (cv.habilidades && cv.habilidades.length),
  );
  return tieneExtraccion ? "analizado" : "error";
}

const TONOS_RECOMENDACION: Record<string, { card: string; texto: string; icon: typeof CheckCircle2 }> = {
  "Avanzar a contratación": { card: "border-good/30 bg-good-soft/20", texto: "text-good", icon: CheckCircle2 },
  "Realizar entrevista humana": { card: "border-warn/30 bg-warn-soft/20", texto: "text-warn", icon: UserCheck },
  "Realizar Entrevista Red Human": { card: "border-brand/30 bg-brand-soft/20", texto: "text-brand", icon: UserCheck },
  "Reintentar Entrevista Red Human": { card: "border-warn/30 bg-warn-soft/20", texto: "text-warn", icon: RotateCw },
  "No avanzar": { card: "border-bad/30 bg-bad-soft/20", texto: "text-bad", icon: XCircle },
};

/** 2026-09-13: status legible de la Entrevista Red Human (bloque propio en Resumen y Evaluaciones). */
function textoEntrevistaStatus(s: NonNullable<Candidato["entrevistaStatus"]>): { titulo: string; detalle: string; tono: "good" | "warn" | "bad" | "neutral" } {
  switch (s.estado) {
    case "evaluada":
      return { titulo: "Entrevista Red Human realizada y evaluada", detalle: s.faltante.length ? `No se cubrió: ${s.faltante.join(", ")}.` : "", tono: "good" };
    case "interrumpida":
      return {
        titulo: s.motivo === "sin_respuestas" ? "Entrevista Red Human sin respuestas" : "Entrevista Red Human interrumpida",
        detalle: s.motivo === "sin_respuestas" ? "El candidato no contestó. No se generó evaluación ni score. Acción: reintentar." : "Se cortó antes de terminar. No se generó evaluación. Acción: reintentar.",
        tono: "bad",
      };
    case "parcial":
      return { titulo: "Entrevista Red Human parcial", detalle: `${s.motivoIa ? s.motivoIa + " " : ""}Sin score integral.${s.faltante.length ? ` Faltó: ${s.faltante.join(", ")}.` : ""} Acción: reintentar.`, tono: "warn" };
    case "en_curso":
      return { titulo: "Entrevista Red Human en curso", detalle: "", tono: "neutral" };
    case "completada":
      return { titulo: "Entrevista Red Human completada, evaluando…", detalle: "", tono: "neutral" };
    default:
      return { titulo: "Entrevista Red Human programada", detalle: "Aún no se realiza.", tono: "neutral" };
  }
}

/* ============================================================
   RESUMEN (2026-10-01 «Fraiche: ficha y resumen del candidato»): encabezado con contacto → Recomendación →
   Resultados (una sola vez) → Siguiente acción (un botón) → Avance (actividades) → Fortalezas (≤3) → Por validar (≤3)
   → «Ver detalle» cerrado con la explicación completa.
   ============================================================ */
const ESTADO_LISTA_TONO: Record<string, string> = { hecha: "text-good", en_curso: "text-warn", pendiente: "text-ink-3", no_aplica: "text-ink-3" };

function PestanaResumen({
  c, live, onCambio, setTab, boton, ocupado, onAccion, onVerEvaluacion, puedeDecidir,
}: {
  c: Candidato; live: boolean; onCambio: (c: Candidato) => void; setTab: (t: TabCandidato) => void;
  boton: AccionSiguiente | null; ocupado: boolean; onAccion: (a: AccionSiguiente) => void; onVerEvaluacion: (ancla: string) => void; puedeDecidir: boolean;
}) {
  const av = c.avance;
  const rf = c.resumenFicha;
  const sinCv = !(c.listaArchivos ?? []).some((a) => a.tipo === "cv");
  const [editDom, setEditDom] = useState<string | null>(null);
  const [guardandoDom, setGuardandoDom] = useState(false);
  async function guardarDomicilio() {
    if (editDom === null) return;
    setGuardandoDom(true);
    const r = await actualizarDomicilio(c.id, editDom.trim());
    setGuardandoDom(false);
    if (r.ok) {
      setEditDom(null);
      onCambio(r.data);
    }
  }
  const lugar = c.sucursalVacante || c.clienteVacante || "";

  // Recomendación: un requisito obligatorio No cumple prevalece; si no, la de Red Human; si no, el estado integral
  const integral = av?.integral;
  const noApto = integral?.conclusion === "no_apto";
  const tituloRec = noApto ? "No cumple un requisito obligatorio" : c.recomendacionRedHuman || (integral?.conclusion === "apto" ? "Apto para avanzar" : "En proceso");
  const tono = noApto ? TONOS_RECOMENDACION["No avanzar"] : (c.recomendacionRedHuman && TONOS_RECOMENDACION[c.recomendacionRedHuman]) || (integral?.conclusion === "apto"
    ? TONOS_RECOMENDACION["Avanzar a contratación"] : { card: "border-border-soft bg-surface-2/40", texto: "text-ink", icon: Clock });
  const conclusion = noApto ? integral!.texto : (rf?.recomendacionBreve || (integral?.conclusion === "apto" ? integral.texto : ""));

  // Resultados (una sola vez): prefiltro y afinidad de Entrevista Red Human
  const pr = c.prefiltroResumen;
  const pw = c.prefiltroWeb;
  const resultadoPrefiltro = pr?.resultado ?? pw?.resultado ?? null;
  const textoPrefiltro = resultadoPrefiltro === "cumple" ? "Cumple" : resultadoPrefiltro === "no_cumple" ? "No cumple" : resultadoPrefiltro === "revision" ? "Por validar" : "En curso";
  const criterios = pr?.total ? ` · ${pr.cumple} de ${pr.total} criterios${(pr.porValidar?.length ?? 0) ? `, ${pr.porValidar!.length} por validar` : ""}` : pw?.evaluadas ? ` · ${pw.cumplidos} de ${pw.evaluadas} criterios` : "";
  const afinidad = rf?.afinidadEntrevista;

  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado + contacto */}
      <div>
        <p className="text-base font-semibold text-ink">
          {c.nombre} <span className="font-normal text-ink-2">· {c.puesto || "Sin vacante"}{lugar ? ` · ${lugar}` : ""}</span>
          {av?.ruta ? <span className="ml-2 align-middle"><Badge tone={av.destino === "franquicia" ? "human" : "good"}>{av.ruta}</Badge></span> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          {c.telefono && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-ink-3" />{c.telefono}</span>}
          {c.correo && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5 text-ink-3" />{c.correo}</span>}
          {editDom === null ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-ink-3" />{c.domicilio || c.ubicacion || "Sin domicilio"}
              {live && puedeDecidir && <button type="button" onClick={() => setEditDom(c.domicilio || c.ubicacion || "")} className="ml-0.5 text-brand hover:underline">editar</button>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <input autoFocus value={editDom} onChange={(e) => setEditDom(e.target.value)} className="h-7 w-64 rounded-lg border border-border-soft bg-surface px-2 text-[12px]" />
              <button type="button" onClick={guardarDomicilio} disabled={guardandoDom} className="font-semibold text-brand">{guardandoDom ? "…" : "Guardar"}</button>
              <button type="button" onClick={() => setEditDom(null)} className="text-ink-3">Cancelar</button>
            </span>
          )}
          {sinCv && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-3">CV no recibido</span>}
        </div>
      </div>

      {/* Recomendación */}
      <Card className={cn("p-4", tono.card)}>
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">Recomendación</p>
        <p className={cn("font-display text-lg font-bold", tono.texto)}>{tituloRec}</p>
        {conclusion && <p className="mt-0.5 text-sm text-ink-2">{conclusion}</p>}
      </Card>

      {/* Resultados */}
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Resultados</Eyebrow>
        <button type="button" onClick={() => onVerEvaluacion("eval-prefiltro")} className="flex items-center justify-between rounded-xl border border-border-soft px-3 py-2 text-left text-sm hover:border-brand/50">
          <span>Prefiltro: <b className={resultadoPrefiltro === "cumple" ? "text-good" : resultadoPrefiltro === "no_cumple" ? "text-bad" : "text-warn"}>{textoPrefiltro}</b><span className="text-ink-3">{criterios}</span></span>
          <span className="text-[11px] text-brand">Ver evaluación →</span>
        </button>
        <button type="button" onClick={() => onVerEvaluacion(afinidad != null ? "eval-afinidad" : "eval-entrevista")} className="flex items-center justify-between rounded-xl border border-border-soft px-3 py-2 text-left text-sm hover:border-brand/50">
          <span>Afinidad de Entrevista Red Human: <b>{afinidad != null ? `${afinidad}/100` : "No evaluado"}</b></span>
          <span className="text-[11px] text-brand">Ver evaluación →</span>
        </button>
      </div>

      {/* Siguiente acción — 2026-10-02 (§3): el botón vive en la barra fija al pie de la ficha (visible en todas las pestañas) */}
      {av?.siguienteAccion?.texto && (
        <div className="rounded-xl border border-brand/30 bg-brand-soft/30 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Siguiente acción</p>
          <p className="mt-1 text-sm font-semibold text-ink">{boton?.tipo === "no_cumple" ? "Descartar candidato (decide RH)" : av.siguienteAccion.texto}</p>
          {boton?.tipo === "no_cumple" && <p className="mt-1 text-[12px] text-ink-2">{av.siguienteAccion.texto}</p>}
          {(av.faltaParaAvanzar?.length ?? 0) > 0 && av.siguienteColumna && (
            <p className="mt-1.5 text-[12px] text-warn">Para pasar a {nombreEtapa(av.siguienteColumna)} falta: {av.faltaParaAvanzar!.join("; ")}</p>
          )}
          {puedeDecidir && <p className="mt-1 text-[11px] text-ink-3">Usa el botón principal de la barra inferior.</p>}
        </div>
      )}

      {/* Avance — actividades de la ruta con su estado real */}
      {(av?.lista?.length ?? 0) > 0 && (
        <div id="ficha-avance">
          <Eyebrow>Avance</Eyebrow>
          <ul className="mt-1.5 divide-y divide-border-faint rounded-xl border border-border-soft">
            {av!.lista!.map((a) => (
              <li key={a.clave} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                <span className="min-w-0 truncate"><b className="text-ink">{a.nombre}</b>{a.estado !== "pendiente" && a.resultado ? <span className={cn("ml-1.5", a.tono === "bad" ? "text-bad" : "text-ink-3")}>· {a.resultado}</span> : null}</span>
                <span className={cn("shrink-0 text-[11px] font-semibold", a.noCumple ? "text-bad" : ESTADO_LISTA_TONO[a.estado])}>{a.estadoTexto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fortalezas / Por validar (máx. 3, una línea) */}
      {(rf?.fortalezas?.length ?? 0) > 0 && (
        <div>
          <Eyebrow>Fortalezas</Eyebrow>
          <ul className="mt-1 space-y-0.5">{rf!.fortalezas.map((f, i) => <li key={i} className="truncate text-sm text-ink-2"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-good" />{f}</li>)}</ul>
        </div>
      )}
      {((rf?.porValidar?.length ?? 0) > 0 || (rf?.noEvaluados?.length ?? 0) > 0) && (
        <div>
          <Eyebrow>Por validar</Eyebrow>
          <ul className="mt-1 space-y-0.5">
            {rf!.porValidar.map((f, i) => <li key={i} className="truncate text-sm text-ink-2"><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warn" />{f}</li>)}
            {rf!.noEvaluados.slice(0, Math.max(0, 3 - rf!.porValidar.length)).map((f, i) => <li key={`ne${i}`} className="truncate text-sm text-ink-3">No evaluado: {f}</li>)}
          </ul>
        </div>
      )}

      {/* Ver detalle — cerrado al inicio */}
      <details className="rounded-xl border border-border-soft">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-brand">Ver detalle</summary>
        <div className="border-t border-border-soft p-3">
          <DetalleResumen c={c} live={live} onCambio={onCambio} setTab={setTab} />
          {(c.historialDomicilio?.length ?? 0) > 0 && (
            <div className="mt-4">
              <Eyebrow>Historial de domicilio</Eyebrow>
              <ul className="mt-1 space-y-0.5 text-[12px] text-ink-2">
                {c.historialDomicilio!.map((h, i) => <li key={i}>{fechaCorta(h.fecha)} · {h.por} ({h.origen}): «{h.anterior || "—"}» → «{h.nuevo}»</li>)}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/** Evaluaciones · Prefiltro: preguntas, respuestas y estado de CADA criterio (web y por mensaje). Los datos informativos
 * (adeudo con BBVA) se muestran aparte y no cuentan como criterio. */
function SeccionPrefiltroDetalle({ c }: { c: Candidato }) {
  const pw = c.prefiltroWeb;
  const pr = c.prefiltroResumen;
  if (!pw && !pr && !(c.respuestasWeb?.length)) return null;
  const marca = (e: string) => (e === "cumple" ? "✓" : e === "no_cumple" ? "✗" : "?");
  const color = (e: string) => (e === "cumple" ? "text-good" : e === "no_cumple" ? "text-bad" : "text-warn");
  return (
    <Card id="eval-prefiltro" className="p-5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand">Prefiltro</span>
      {pw && (
        <div className="mt-2">
          <p className="text-sm font-semibold">Formulario: {pw.etiqueta}{pw.evaluadas ? ` (${pw.cumplidos} de ${pw.evaluadas} criterios)` : ""}</p>
          {pw.motivo && <p className="text-xs text-ink-2">{pw.motivo}</p>}
          <ul className="mt-1.5 space-y-1">
            {pw.detalle.map((d, i) => (
              <li key={i} className="text-xs text-ink-2">
                <span className={cn("mr-1 font-mono", d.cumple === true ? "text-good" : d.cumple === false ? "text-bad" : "text-warn")}>{d.cumple === true ? "✓" : d.cumple === false ? "✗" : "?"}</span>
                {d.pregunta} <b>«{d.respuesta || "sin respuesta"}»</b>{d.cumple == null ? <span className="text-ink-3"> · Por validar</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pr && (pr.detalle?.length ?? 0) > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">Por mensaje: {pr.cumple} de {pr.total} criterios cumplidos{(pr.porValidar?.length ?? 0) ? ` · ${pr.porValidar!.length} por validar` : ""}{(pr.incumplidos?.length ?? 0) ? ` · ${pr.incumplidos.length} no cumple` : ""}</p>
          <ul className="mt-1.5 space-y-1">
            {pr.detalle!.map((d, i) => (
              <li key={i} className="text-xs text-ink-2">
                <span className={cn("mr-1 font-mono", color(d.estado))}>{marca(d.estado)}</span>
                <b>{d.criterio}</b>: «{d.respuesta || "sin respuesta"}»{d.estado === "por_validar" ? <span className="text-warn"> · Por validar: {d.motivo}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.adeudoBbva && <p className="mt-2 text-xs text-ink-3">Adeudo con BBVA: <b>{c.adeudoBbva}</b> · dato informativo: no es criterio de aprobación ni provoca descarte o revisión.</p>}
    </Card>
  );
}

function DetalleResumen({
  c,
  live,
  onCambio,
  setTab,
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
  setTab: (t: TabCandidato) => void;
}) {
  const [reanalizando, setReanalizando] = useState(false);
  const [errorCv, setErrorCv] = useState("");
  const cv = c.cvDatos ?? {};
  const estadoCv = estadoAnalisisCv(c, reanalizando);
  const ultimoCv = [...(c.listaArchivos ?? [])].reverse().find((a) => a.tipo === "cv");

  async function reintentarAnalisis() {
    if (!ultimoCv) return;
    setReanalizando(true);
    setErrorCv("");
    const r = await reanalizarCvCandidato(c.id, ultimoCv.id);
    setReanalizando(false);
    if (!r.ok) {
      setErrorCv(r.error);
      return;
    }
    onCambio(r.data);
  }

  // --- A. Datos principales — aprovecha automáticamente la extracción del CV, nunca "N/D". ---
  const datosPrincipales: { icon: typeof MapPin; v: string }[] = [];
  if (c.ubicacion) datosPrincipales.push({ icon: MapPin, v: c.ubicacion });
  if (c.telefono) datosPrincipales.push({ icon: Phone, v: c.telefono });
  if (c.correo) datosPrincipales.push({ icon: Mail, v: c.correo });
  if (cv.puesto_actual) datosPrincipales.push({ icon: Briefcase, v: cv.puesto_actual });
  if (cv.ultimo_empleo) datosPrincipales.push({ icon: Building2, v: cv.ultimo_empleo });
  if (cv.anios_experiencia != null) datosPrincipales.push({ icon: CalendarClock, v: `${cv.anios_experiencia} años de experiencia` });
  datosPrincipales.push({ icon: Globe, v: `Canal: ${c.fuente}` });

  const tonoRecomendacion = c.recomendacionRedHuman ? TONOS_RECOMENDACION[c.recomendacionRedHuman] : null;

  return (
    <div className="flex flex-col gap-5">
      {/* A. Datos principales */}
      <div className="flex flex-wrap gap-2">
        {datosPrincipales.map((d, i) => (
          <Info key={i} icon={d.icon} v={d.v} />
        ))}
      </div>

      {/* B. Perfil extraído del CV — sin tarjeta vacía cuando no hay CV (2026-10-01) */}
      {estadoCv !== "sin_cv" && <div>
        <Eyebrow>Perfil extraído del CV</Eyebrow>
        <Card className="mt-2 p-5">

          {estadoCv === "analizando" && (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando currículum…
            </p>
          )}

          {estadoCv === "error" && (
            <div>
              <p className="text-sm text-bad">No fue posible analizar el currículum.</p>
              {live && ultimoCv && (
                <Button size="sm" variant="outline" className="mt-3" onClick={reintentarAnalisis} disabled={reanalizando}>
                  <RefreshCw className={cn("h-3.5 w-3.5", reanalizando && "animate-spin")} />
                  {reanalizando ? "Reintentando…" : "Reintentar análisis"}
                </Button>
              )}
              {errorCv && <p className="mt-2 text-xs text-bad">{errorCv}</p>}
            </div>
          )}

          {estadoCv === "analizado" && (
            <div className="flex flex-col gap-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">
                {cv.resumen_profesional || cv.experiencia_resumen}
              </p>

              {Boolean(cv.experiencia_relevante) && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Experiencia relevante para esta vacante</p>
                  <p className="mt-1 break-words text-sm leading-relaxed text-ink-2">{cv.experiencia_relevante}</p>
                </div>
              )}

              {Boolean(cv.estudios?.length) && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Formación principal</p>
                  <ul className="mt-1.5 space-y-1">
                    {cv.estudios!.slice(0, 3).map((e, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm leading-relaxed text-ink-2">
                        <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" /> <span className="break-words">{e}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Boolean(cv.conocimientos_relevantes?.length) && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Conocimientos relevantes para la vacante</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {cv.conocimientos_relevantes!.map((h, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand/25 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand"
                      >
                        <Award className="h-3.5 w-3.5 text-brand" /> {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {live && ultimoCv && (
                <button
                  onClick={reintentarAnalisis}
                  disabled={reanalizando}
                  className="self-start text-[11px] font-semibold text-brand hover:underline disabled:opacity-50"
                >
                  {reanalizando ? "Reanalizando…" : "Reanalizar con el CV más reciente"}
                </button>
              )}
            </div>
          )}
        </Card>
      </div>}

      {/* C. Prefiltro — SOLO filtro de entrada (Cumple / No cumple), sin score (2026-09-13) */}
      <div>
        <Eyebrow>Prefiltro de entrada</Eyebrow>
        <Card className="mt-2 p-4">
          {/* Fraiche (spec §5): clasificación del formulario web con motivo visible + respuestas */}
          {c.prefiltroWeb && (
            <div className="mb-3 rounded-xl border border-border-soft bg-surface-2/60 p-3">
              <p
                className={cn(
                  "text-sm font-semibold",
                  c.prefiltroWeb.resultado === "cumple" ? "text-good" : c.prefiltroWeb.resultado === "revision" ? "text-warn" : "text-bad",
                )}
              >
                Prefiltro web: {c.prefiltroWeb.etiqueta}
                {c.prefiltroWeb.evaluadas ? ` (${c.prefiltroWeb.cumplidos} de ${c.prefiltroWeb.evaluadas} criterios)` : ""}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{c.prefiltroWeb.motivo}</p>
              {c.prefiltroWeb.detalle.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {c.prefiltroWeb.detalle.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-ink-2">
                      <span className={cn("mt-0.5 shrink-0 font-mono text-[10px]", d.cumple === true ? "text-good" : d.cumple === false ? (d.descarta ? "text-bad" : "text-warn") : "text-ink-3")}>
                        {d.cumple === true ? "✓" : d.cumple === false ? "✗" : "·"}
                      </span>
                      <span className="break-words">
                        {d.pregunta} <b>«{d.respuesta || "sin respuesta"}»</b>
                        {d.descarta && <span className="text-ink-3"> · eliminatoria</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!c.prefiltroWeb && (c.respuestasWeb?.length ?? 0) > 0 && (
            <ul className="mb-3 space-y-1">
              {c.respuestasWeb!.map((r, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-2">• {r.pregunta} <b>«{r.respuesta || "sin respuesta"}»</b></li>
              ))}
            </ul>
          )}
          {/* Fraiche (spec §6): resultado del filtro por WhatsApp con su siguiente acción + captura BBVA */}
          {c.prefiltroWhatsapp && (
            <p
              className={cn(
                "mb-1 text-sm font-semibold",
                c.prefiltroWhatsapp.resultado === "cumple" ? "text-good" : c.prefiltroWhatsapp.resultado === "revision" ? "text-warn" : "text-bad",
              )}
            >
              Filtro {CANAL}: {c.prefiltroWhatsapp.etiqueta}
            </p>
          )}
          {c.adeudoBbva && (
            <p className="mb-2 text-xs text-ink-2">
              Adeudo con BBVA: <b>{c.adeudoBbva}</b> <span className="text-ink-3">· captura informativa, no afecta el resultado</span>
            </p>
          )}
          {!c.prefiltroResumen ? (
            <p className="text-sm text-ink-3">{c.prefiltroWeb ? `Filtro por ${CANAL} en curso.` : "Prefiltro en curso — todavía no hay criterios evaluados."}</p>
          ) : c.prefiltroResumen.resultado === "no_cumple" || c.prefiltroResumen.incumplidos.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-warn">
                Prefiltro: No cumple{c.prefiltroResumen.total ? ` (incumple ${c.prefiltroResumen.incumplidos.length} de ${c.prefiltroResumen.total} criterios)` : ""}
              </p>
              <ul className="mt-2 space-y-1">
                {c.prefiltroResumen.incumplidos.map((x, i) => (
                  <li key={i} className="break-words text-xs leading-relaxed text-ink-2">• {x}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm font-semibold text-good">
              Prefiltro: Cumple{c.prefiltroResumen.total ? ` (${c.prefiltroResumen.cumple} de ${c.prefiltroResumen.total} criterios)` : ""}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-3">Filtro básico de entrada; no forma parte de la evaluación integral.</p>
          {(c.inconsistencias?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-xl border border-warn/40 bg-warn-soft/40 p-3">
              <p className="text-xs font-semibold text-warn">Respuestas distintas entre el formulario web y {CANAL} — RH decide (no se descartó automáticamente):</p>
              <ul className="mt-1.5 space-y-1">
                {c.inconsistencias!.map((i, k) => (
                  <li key={k} className="text-xs leading-relaxed text-ink-2">
                    <b>{i.criterio}</b>: web «{i.web}» · {CANAL} «{i.whatsapp}»
                    {i.aclarada ? <span className="text-good"> · aclaró: «{i.aclaracion}»</span> : <span className="text-ink-3"> · pendiente de aclarar</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {(c.capacitacion?.length ?? 0) > 0 && (
        <div>
          <Eyebrow>Capacitación (filtro de la vacante)</Eyebrow>
          <Card className="mt-2 p-4">
            <ul className="space-y-1">
              {c.capacitacion!.map((k) => (
                <li key={k.asignacion} className="text-sm">
                  <span className={k.aprobado ? "font-semibold text-good" : "font-semibold text-bad"}>{k.aprobado ? "Aprobado" : "No aprobado"} · {k.calificacion}%</span>
                  <span className="text-ink-2"> — {k.titulo}</span>
                  <span className="text-[11px] text-ink-3"> · {fechaCorta(k.fecha)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {(c.actividadesOmitidas?.length ?? 0) > 0 && (
        <p className="text-[11px] text-ink-3">
          Omitido manualmente: {c.actividadesOmitidas!.map((o) => `${nombreEtapa(o.actividad)} (${o.usuario}, ${fechaCorta(o.fecha)}${o.motivo ? `: ${o.motivo}` : ""})`).join(" · ")}
        </p>
      )}

      {/* 2026-09-22: historial del expediente — decisiones humanas registradas (nunca se borran) */}
      {(c.historial?.length ?? 0) > 0 && (
        <div>
          <Eyebrow>Historial del expediente</Eyebrow>
          <ul className="mt-2 space-y-1.5">
            {c.historial!.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-ink-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span>
                  {h.texto}
                  {h.motivo ? <span className="text-ink-3"> · {h.motivo}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* C2. Status de la Entrevista Red Human (2026-09-13) */}
      {c.entrevistaStatus && (
        <div>
          <Eyebrow>Entrevista Red Human</Eyebrow>
          <Card className="mt-2 p-4">
            {(() => {
              const st = textoEntrevistaStatus(c.entrevistaStatus);
              return (
                <>
                  <p className={cn("text-sm font-semibold", st.tono === "good" ? "text-good" : st.tono === "warn" ? "text-warn" : st.tono === "bad" ? "text-bad" : "text-ink")}>{st.titulo}</p>
                  {st.detalle && <p className="mt-1 text-xs leading-relaxed text-ink-2">{st.detalle}</p>}
                  <p className="mt-1 text-[11px] text-ink-3">
                    {c.entrevistaStatus.turnosCandidato} respuestas{c.entrevistaStatus.intentosPrevios ? ` · ${c.entrevistaStatus.intentosPrevios} intento(s) previo(s)` : ""}
                    {c.entrevistaStatus.accionSiguiente === "reintentar" ? " · Reintentar desde el tablero de Entrevistas (botón «Reintentar»)." : ""}
                  </p>
                </>
              );
            })()}
          </Card>
        </div>
      )}

      {/* D. Evaluación integral (Análisis de CV + Entrevista Red Human) — solo con entrevista válida */}
      {c.afinidadGlobal != null && c.evaluacionIntegral && (
        <div>
          <Eyebrow>Evaluación integral · Afinidad con la vacante</Eyebrow>
          <Card className="mt-2 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <ScoreRing score={c.afinidadGlobal} />
              <p className="font-display text-lg font-bold text-ink">Afinidad: {c.afinidadGlobal}/100</p>
            </div>
            {c.sintesisAfinidad && <p className="mt-3 break-words text-sm leading-relaxed text-ink-2">{c.sintesisAfinidad}</p>}
            <button onClick={() => setTab("evaluaciones")} className="mt-3 text-[11px] font-semibold text-brand hover:underline">
              Ver detalle en Evaluaciones →
            </button>
          </Card>
        </div>
      )}

      {/* E. Fortalezas principales */}
      {Boolean(c.fortalezasPrincipales?.length) && (
        <div>
          <Eyebrow>Fortalezas principales</Eyebrow>
          <Card className="mt-2 border-good/30 bg-good-soft/20 p-4">
            <ul className="space-y-1.5">
              {c.fortalezasPrincipales!.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm leading-relaxed text-ink-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> <span className="break-words">{f}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* F. Puntos por validar — solo lo que requiere intervención humana */}
      {Boolean(c.puntosPorValidar?.length) && (
        <div>
          <Eyebrow>Puntos por validar</Eyebrow>
          <Card className="mt-2 border-warn/30 bg-warn-soft/20 p-4">
            <ul className="space-y-1.5">
              {c.puntosPorValidar!.map((p, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm leading-relaxed text-ink-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> <span className="break-words">{p}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* G. Recomendación de Red Human — destacada */}
      {c.recomendacionRedHuman && tonoRecomendacion && (
        <Card className={cn("p-5", tonoRecomendacion.card)}>
          <div className="flex items-start gap-3">
            <tonoRecomendacion.icon className={cn("mt-0.5 h-6 w-6 shrink-0", tonoRecomendacion.texto)} />
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">Recomendación de Red Human</p>
              <p className={cn("font-display text-lg font-bold", tonoRecomendacion.texto)}>{c.recomendacionRedHuman}</p>
              {c.recomendacionMotivo && (
                <p className="mt-1.5 break-words text-sm leading-relaxed text-ink-2">{c.recomendacionMotivo}</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* H. Fase 2 — otras postulaciones de la misma persona (historial, más reciente primero) */}
      {(c.historialPostulaciones?.length ?? 0) > 0 && (
        <div>
          <Eyebrow>Otras postulaciones de esta persona</Eyebrow>
          <Card className="mt-2 divide-y divide-border-soft p-0">
            {c.historialPostulaciones!.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{h.puesto || "Sin vacante asignada"}</p>
                  <p className="font-mono text-[10px] text-ink-3">
                    {h.id} · {h.creado}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-2">{h.etapa}</span>
                  {h.activa ? (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-700">En curso</span>
                  ) : (
                    <span className="rounded bg-ink-3/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-ink-3">
                      Cerrada · {h.motivoCierre || "—"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PESTAÑA 2: Evaluaciones (Luna, avatar, requisitos/brechas, prefiltro, entrevista humana)
   ============================================================ */
function PestanaEvaluaciones({
  c,
  live,
  onCambio,
  versionEval = 0,
  onProgramarIpv,
  accionesRuta,
}: {
  c: Candidato;
  live?: boolean;
  onCambio?: (c: Candidato) => void;
  versionEval?: number;
  /** 2026-10-02 (§12): Entrevista humana / IPV / Presentación siempre visibles en «Agregar evaluación». */
  accionesRuta?: { etiqueta: string; descripcion?: string; onClick: () => void }[];
  /** Fraiche (spec §8): «elegir» abre el selector Red Human / humano; «humano» agenda directo la IPV humana. */
  onProgramarIpv?: (modo: "elegir" | "humano") => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const [verTranscript, setVerTranscript] = useState(false);
  const [evaluando, setEvaluando] = useState(false);
  const [errorEval, setErrorEval] = useState("");
  /** 2026-09-17: entrevista interrumpida/parcial CON respuestas → RH puede evaluarla con lo que hay. */
  async function evaluarConLoQueHay() {
    if (!c.entrevistaStatus) return;
    setEvaluando(true);
    setErrorEval("");
    const r = await evaluarEntrevistaConLoQueHay(c.entrevistaStatus.codigo);
    setEvaluando(false);
    if (!r.ok) return setErrorEval(r.error);
    const ficha = await fetchCandidato(c.id);
    if (ficha && onCambio) onCambio(ficha);
  }
  const a = c.analisis ?? {};
  const hayCv = Boolean(a.requisitos_cumplidos?.length || a.brechas?.length || a.fortalezas_cv?.length || c.cvDatos?.resumen_profesional);
  const ultimaEntrevista = c.entrevistas?.[c.entrevistas.length - 1];
  // 2026-09-13: solo una entrevista EVALUADA alimenta la Evaluación Integral (interrumpida/parcial no)
  const evalAvatar = (ultimaEntrevista?.estado === "evaluada" ? ultimaEntrevista?.evaluacion : null) as
    | { resumen?: string; fortalezas?: string[]; riesgos?: string[]; areas_desarrollo?: string[]; perfil?: PerfilProfundo | null; match_perfil?: number; recomendacion?: string; faltante?: string[] }
    | null
    | undefined;
  const historialEh = c.entrevistasHumanas ?? [];
  // Fraiche (spec §7): transcripción de la sesión más reciente que la tenga (la inicial se conserva aunque haya IPV aparte)
  const transcript = [...(c.entrevistas ?? [])].reverse().find((e) => e.transcript?.length)?.transcript ?? [];
  // Fraiche (spec §8): resultados IPV en orden cronológico — Red Human primero y luego cada ronda humana;
  // una segunda IPV es un registro nuevo y la primera sigue visible.
  const ipvRedHuman = [...(c.entrevistas ?? [])].reverse().find((e) => e.evaluacionIpv);
  const rondasIpv = [...historialEh].reverse().filter((eh) => eh.esIpv);
  const hayIpv = Boolean(ipvRedHuman) || rondasIpv.length > 0;
  const ipvPendiente = rondasIpv.some((eh) => !eh.cancelada && !eh.resultadoIpv && !eh.resultado);
  const ultimaRondaIpv = [...rondasIpv].reverse().find((eh) => eh.resultadoIpv);
  const sugiereNuevaIpv = Boolean(ultimaRondaIpv ? ultimaRondaIpv.sugiereNuevaIpv : ipvRedHuman?.sugiereNuevaIpv);

  return (
    <div className="flex flex-col gap-5">
      {/* ===== 0) PREFILTRO — preguntas, respuestas y criterios (2026-10-01: el detalle vive en Evaluaciones) ===== */}
      <SeccionPrefiltroDetalle c={c} />

      {/* ===== 1) ANÁLISIS DE CV — disponible desde el inicio (independiente del prefiltro) ===== */}
      <Card id="eval-cv" className="border-brand/30 bg-brand-soft/20 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand">1 · Análisis de CV</span>
            {hayCv ? (
              <>
                <h3 className="font-display text-xl font-bold text-ink">Ajuste del CV: {c.score} / 100</h3>
                <p className="text-xs sm:text-sm text-ink-2 max-w-xl">{c.evidencia || "Ajuste preliminar comparado contra los requisitos de la vacante."}</p>
              </>
            ) : (
              <>
                <h3 className="font-display text-xl font-bold text-ink">Sin CV analizado</h3>
                <p className="text-xs sm:text-sm text-ink-2 max-w-xl">Sube el CV en Documentos para obtener el análisis (experiencia relevante, fortalezas, brechas y compatibilidad).</p>
              </>
            )}
          </div>
          {hayCv && (
            <div className="flex items-center gap-3 self-start sm:self-auto">
              <div className="scale-125">
                <ScoreRing score={c.score} />
              </div>
            </div>
          )}
        </div>
        {hayCv && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(a.experiencia_relevante_cv || c.cvDatos?.experiencia_relevante) && (
              <div className="sm:col-span-2">
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink-3">Experiencia relevante</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-2">{a.experiencia_relevante_cv || c.cvDatos?.experiencia_relevante}</p>
              </div>
            )}
            {Boolean(a.fortalezas_cv?.length) && (
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-good">Fortalezas</p>
                <ul className="mt-1 space-y-1">{a.fortalezas_cv!.map((x, i) => <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>)}</ul>
              </div>
            )}
            {Boolean(a.brechas?.length) && (
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-warn">Brechas / requisitos no acreditados</p>
                <ul className="mt-1 space-y-1">{a.brechas!.map((x, i) => <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>)}</ul>
              </div>
            )}
            {a.compatibilidad_cv && (
              <div className="sm:col-span-2">
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink-3">Compatibilidad</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-2">{a.compatibilidad_cv}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ===== 2) STATUS DE LA ENTREVISTA RED HUMAN ===== */}
      <Card id="eval-entrevista" className="p-5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-human">2 · Entrevista Red Human</span>
        {c.entrevistaStatus ? (
          (() => {
            const st = textoEntrevistaStatus(c.entrevistaStatus);
            return (
              <>
                <h3 className={cn("font-display mt-1 text-lg font-bold", st.tono === "good" ? "text-good" : st.tono === "warn" ? "text-warn" : st.tono === "bad" ? "text-bad" : "text-ink")}>{st.titulo}</h3>
                {st.detalle && <p className="mt-1 text-xs leading-relaxed text-ink-2">{st.detalle}</p>}
                <p className="mt-1 text-[11px] text-ink-3">
                  {c.entrevistaStatus.turnosCandidato} respuestas del candidato
                  {c.entrevistaStatus.intentosPrevios ? ` · ${c.entrevistaStatus.intentosPrevios} intento(s) previo(s)` : ""}
                  {c.entrevistaStatus.accionSiguiente === "reintentar" ? " · Acción siguiente: Reintentar Entrevista Red Human (tablero de Entrevistas → «Reintentar»)." : ""}
                </p>
                {puedeDecidir && live && c.entrevistaStatus.accionSiguiente === "reintentar" && (c.entrevistaStatus.turnosUtiles ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={evaluarConLoQueHay} disabled={evaluando}>
                      <Sparkles className="h-4 w-4" /> {evaluando ? "Evaluando…" : `Evaluar con lo que hay (${c.entrevistaStatus.turnosUtiles} respuestas)`}
                    </Button>
                    {errorEval && <span className="text-xs text-bad">{errorEval}</span>}
                  </div>
                )}
              </>
            );
          })()
        ) : (
          <p className="mt-1 text-sm text-ink-3">Todavía no hay Entrevista Red Human para esta postulación.</p>
        )}
        {/* Fraiche (spec §7): transcripción plegada (cerrada por defecto) */}
        {transcript.length > 0 && (
          <div className="mt-3 border-t border-border-soft pt-3">
            <button
              type="button"
              onClick={() => setVerTranscript((v) => !v)}
              aria-expanded={verTranscript}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", verTranscript && "rotate-180")} /> Transcripción ({transcript.length} mensajes)
            </button>
            {verTranscript && (
              <div className="mt-2.5 max-h-80 space-y-2 overflow-y-auto pr-1">
                {transcript.map((m, i) => (
                  <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed", m.rol === "user" ? "bg-brand-soft text-ink" : "bg-surface-2 text-ink-2")}>
                      <p className="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">{m.rol === "user" ? "Candidato" : "Red Human"}</p>
                      {m.texto}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Tarjeta de la evaluación del avatar de entrevista — solo texto descriptivo, sin score:
          el número de afinidad es de Luna (arriba); esto es lo que se habló en la entrevista. */}
      {/* ===== 3) EVALUACIÓN INTEGRAL (Análisis de CV + Entrevista Red Human) — solo con entrevista válida ===== */}
      {evalAvatar?.resumen && (
        <Card id="eval-afinidad" className="border-human/30 bg-human-soft/20 p-5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-human">
            3 · Afinidad de Entrevista Red Human
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {evalAvatar.match_perfil != null && <ScoreRing score={evalAvatar.match_perfil} />}
            <div>
              {evalAvatar.match_perfil != null && <p className="font-display text-lg font-bold text-ink">Afinidad de Entrevista Red Human: {evalAvatar.match_perfil}/100</p>}
              {evalAvatar.recomendacion && (
                <p className="text-xs text-ink-2">
                  Recomendación preliminar: <b className="text-ink">{evalAvatar.recomendacion === "avanzar" ? "avanzar" : evalAvatar.recomendacion === "no_avanzar" ? "no avanzar" : "revisión humana"}</b> — la decisión final es de RH.
                </p>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink">{evalAvatar.resumen}</p>
          {Boolean(evalAvatar.faltante?.length) && (
            <p className="mt-2 text-xs leading-relaxed text-warn">La entrevista no cubrió: {evalAvatar.faltante!.join(", ")} — validar en la Entrevista Humana.</p>
          )}

          {Boolean(evalAvatar.fortalezas?.length) && (
            <div className="mt-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-good font-bold">Fortalezas observadas</p>
              <ul className="mt-1.5 space-y-1">
                {evalAvatar.fortalezas!.map((x, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>
                ))}
              </ul>
            </div>
          )}

          {Boolean(evalAvatar.riesgos?.length) && (
            <div className="mt-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-warn font-bold">Puntos por validar</p>
              <ul className="mt-1.5 space-y-1">
                {evalAvatar.riesgos!.map((x, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>
                ))}
              </ul>
            </div>
          )}

          {Boolean(evalAvatar.areas_desarrollo?.length) && (
            <div className="mt-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-brand font-bold">Áreas de desarrollo</p>
              <ul className="mt-1.5 space-y-1">
                {evalAvatar.areas_desarrollo!.map((x, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Fase 4 (Punto 5): conocimiento profundo con evidencia; solo existe en evaluaciones nuevas. */}
          {evalAvatar.perfil && (
            <div className="mt-4">
              <PerfilProfundoVista perfil={evalAvatar.perfil} />
            </div>
          )}
        </Card>
      )}

      {/* ===== 4) ENTREVISTA IPV (Fraiche, spec §8) — misma rúbrica para Red Human y el entrevistador humano ===== */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-human">4 · Entrevista IPV</span>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-3">
              Misma rúbrica de 6 competencias para Red Human y el entrevistador humano. Ningún puntaje mueve la etapa ni descarta por sí solo: decide RH.
            </p>
          </div>
          {puedeDecidir && live && onProgramarIpv && !ipvPendiente && (
            hayIpv ? (
              <Button size="sm" variant={sugiereNuevaIpv ? "primary" : "outline"} onClick={() => onProgramarIpv("humano")}>
                <UserCheck className="h-4 w-4" /> Programar nueva IPV humana
              </Button>
            ) : (
              <Button size="sm" onClick={() => onProgramarIpv("elegir")}>
                <Sparkles className="h-4 w-4" /> Programar IPV
              </Button>
            )
          )}
        </div>
        {!hayIpv && <p className="mt-3 text-sm text-ink-3">Todavía no hay Entrevista IPV para esta postulación.</p>}
        {/* 2026-10-02 (§1/§5): IPV Red Human aún sin evaluar → estado del envío de su liga + Copiar / Reenviar */}
        {(c.entrevistas ?? []).filter((e) => (e.fase === "ipv" || e.fase === "inicial_ipv") && !e.evaluacionIpv && e.estado !== "cancelada").slice(-1).map((e) => (
          <div key={e.id} className="mt-3 rounded-xl border border-human/25 bg-human-soft/20 p-3">
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
              <Badge tone="human">IPV Red Human</Badge>
              <span>Filtro Red Human · responsable: Red Human (IA) · {e.estado === "evaluada" ? "evaluada" : e.estado === "interrumpida" || e.estado === "parcial" ? "interrumpida (se puede reabrir)" : "esperando al candidato"}</span>
            </p>
            {live && puedeDecidir && (
              <div className="mt-2">
                <EstadoEnvios
                  compacto
                  titulo="Liga al candidato"
                  envios={e.envios}
                  ligas={[{ etiqueta: "Copiar liga", url: e.liga }]}
                  reenvios={[{ etiqueta: "Reenviar", onClick: async () => {
                    const r = await reenviarIpvRedHuman(c.id, e.id);
                    if (r.ok) onCambio?.(r.data.candidato);
                  } }]}
                />
              </div>
            )}
          </div>
        ))}
        {ipvRedHuman?.evaluacionIpv && (
          <ResultadoIpvVista
            titulo="IPV Red Human · Filtro Red Human"
            rubrica={ipvRedHuman.evaluacionIpv}
            calculo={ipvRedHuman.evaluacionIpv.calculo}
            evaluador={ipvRedHuman.evaluacionIpv.evaluador}
            fecha={ipvRedHuman.evaluacionIpv.evaluada_en ?? ipvRedHuman.creada}
          />
        )}
        {rondasIpv.map((eh, i) =>
          eh.resultadoIpv ? (
            <ResultadoIpvVista
              key={i}
              titulo={`IPV humana ${rondasIpv.length > 1 ? i + 1 : ""} · Filtro humano`.replace("  ", " ")}
              rubrica={eh.rubrica}
              calculo={eh.resultadoIpv}
              evaluador={eh.entrevistador}
              fecha={eh.evaluadaEn ?? eh.fecha}
            />
          ) : (
            <div key={i} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2 text-xs text-ink-2">
              <Badge tone="human">IPV humana</Badge>
              <span>
                {eh.entrevistador || "Sin asignar"}
                {eh.fecha ? ` · ${fechaHoraCorta(eh.fecha)}` : ""}
              </span>
              <Badge tone={eh.cancelada ? "bad" : "neutral"}>{eh.cancelada ? "Cancelada" : eh.realizada ? "Esperando rúbrica" : "Programada"}</Badge>
            </div>
          ),
        )}
        {sugiereNuevaIpv && (
          <p className="mt-3 text-xs leading-relaxed text-warn">
            La última conclusión fue «{CONCLUSIONES_IPV[(ultimaRondaIpv?.resultadoIpv ?? ipvRedHuman?.evaluacionIpv?.calculo)?.conclusion ?? ""] ?? "Bajo reserva"}»: se sugiere programar una nueva IPV con entrevistador humano. La decisión sigue siendo de RH.
          </p>
        )}
      </Card>

      {/* Requisitos Cumplidos vs Brechas */}
      {(a.requisitos_cumplidos?.length || a.brechas?.length) ? (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {Boolean(a.requisitos_cumplidos?.length) && (
            <Card className="border-good/30 bg-good-soft/20 p-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-good font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Requisitos Cumplidos ({a.requisitos_cumplidos!.length})
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {a.requisitos_cumplidos!.map((x, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-2 flex items-start gap-1.5">
                    <span className="text-good font-bold">•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {Boolean(a.brechas?.length) && (
            <Card className="border-warn/30 bg-warn-soft/20 p-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-warn font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Brechas o Puntos por Validar ({a.brechas!.length})
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {a.brechas!.map((x, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-2 flex items-start gap-1.5">
                    <span className="text-warn font-bold">•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      ) : null}

      {/* Respuestas Estructuradas del Pre-filtro (WhatsApp) */}
      {Boolean(a.respuestas_prefiltro?.length) && (
        <div>
          <Eyebrow>Entrevista Pre-filtro por {CANAL} ({a.respuestas_prefiltro!.length} respuestas)</Eyebrow>
          <Card className="mt-2 border-good/30 bg-good-soft/10 p-5">
            <div className="space-y-3">
              {a.respuestas_prefiltro!.map((r, i) => (
                <div key={i} className="rounded-xl border border-border-soft bg-surface p-3.5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-good/15 text-good font-mono text-[11px] font-bold">
                        {i + 1}
                      </span>
                      <p className="font-semibold text-xs sm:text-sm text-ink">{r.criterio || r.pregunta}</p>
                    </div>

                    {r.cumple !== null && r.cumple !== undefined && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                          r.cumple
                            ? "border border-good/30 bg-good-soft text-good"
                            : "border border-bad/30 bg-bad-soft text-bad"
                        )}
                      >
                        {r.cumple ? "Cumple" : "No cumple"}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 rounded-lg bg-surface-2/60 p-2.5 pl-3 border-l-2 border-brand/50">
                    <p className="text-xs leading-relaxed text-ink-2 italic">“{r.respuesta}”</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Historial de Entrevistas Humanas — puede haber varias rondas (ver EntrevistaHumana);
          agendar, marcar realizada y el recordatorio siguen viviendo exclusivamente en
          PanelEntrevistaHumana (acción activa sobre la ronda más reciente, no se duplica
          aquí). Esto es únicamente el historial de solo lectura, más reciente primero. */}
      {historialEh.length > 0 && (
        <div>
          <Eyebrow>Historial de Entrevistas Humanas ({historialEh.length})</Eyebrow>
          <div className="mt-2 flex flex-col gap-2.5">
            {historialEh.map((eh, i) => (
              <Card key={i} className="border-[color:var(--brand-2)]/30 bg-surface-2/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {eh.esIpv ? <Badge tone="human">IPV humana</Badge> : eh.claseNombre ? <Badge tone="neutral">{eh.claseNombre}</Badge> : null}
                    {eh.entrevistador || "Sin asignar"}
                    {eh.fecha && (
                      <span className="font-normal text-ink-3">
                        {new Date(eh.fecha).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    )}
                  </p>
                  {eh.resultado ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {eh.resultadoIpv && (
                        <span className="font-mono text-xs font-bold text-ink">
                          {eh.resultadoIpv.puntaje != null ? `${eh.resultadoIpv.puntaje} / 100` : "Sin puntaje"}
                        </span>
                      )}
                      {eh.resultadoIpv?.conclusion && <Badge tone={tonoConclusionIpv(eh.resultadoIpv.conclusion)} dot>{CONCLUSIONES_IPV[eh.resultadoIpv.conclusion]}</Badge>}
                      {eh.resultadoIpv?.requiere_revision && <Badge tone="warn">Requiere revisión</Badge>}
                      {!eh.resultadoIpv && (
                        <Badge tone={eh.resultado === "aprobado" ? "good" : "bad"} dot>
                          {eh.resultado === "aprobado" ? "Aprobado" : "Rechazado"}
                        </Badge>
                      )}
                      {eh.recomendacion && <Badge tone="brand">{RECOMENDACION_LABEL[eh.recomendacion]}</Badge>}
                    </div>
                  ) : (
                    <Badge tone="neutral">{eh.realizada ? "Esperando evaluación" : "Programada"}</Badge>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-ink-3">
                  {eh.modalidad || "Modalidad sin definir"}
                  {eh.resultado &&
                    ` · Registrado por ${eh.resultadoCapturadoPor === "entrevistador" ? "el entrevistador" : "RH"}`}
                </p>
                {eh.comentario && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{eh.comentario}</p>}
                {eh.sugiereNuevaIpv && puedeDecidir && live && onProgramarIpv && (
                  <button type="button" onClick={() => onProgramarIpv("humano")} className="mt-2 text-[11px] font-semibold text-brand hover:underline">
                    Programar nueva IPV humana
                  </button>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ===== Evaluaciones y verificaciones (2026-09-28): no mueven la columna del pipeline ===== */}
      <div id="eval-validaciones"><PanelEvaluaciones codigo={c.id} puesto={c.puesto} live={Boolean(live) && puedeDecidir} version={versionEval} accionesRuta={accionesRuta} excluir={(c.avance?.destino || "") === "franquicia" ? ["psicometrica", "medico", "socioeconomico"] : []} /></div>
    </div>
  );
}

/* ============================================================
   Fraiche (spec §8): resultado de la Entrevista IPV — vista compartida para Red Human y
   cada ronda humana (puntaje, conclusión, 6 competencias con evidencia, observaciones sin peso).
   ============================================================ */
function ResultadoIpvVista({
  titulo,
  rubrica,
  calculo,
  evaluador,
  fecha,
}: {
  titulo: string;
  rubrica?: RubricaIPV | null;
  calculo: CalculoIPV;
  evaluador?: string | null;
  fecha?: string | null;
}) {
  const detalle = calculo.detalle?.length
    ? calculo.detalle
    : COMPETENCIAS_IPV.map((k) => ({ clave: k.clave, nombre: k.nombre, peso: k.peso, nivel: (rubrica?.niveles?.[k.clave] ?? "sin_evidencia") as NivelIPV, puntos: null }));
  const observaciones = rubrica?.observaciones ?? {};
  const hayObservaciones = OBSERVACIONES_IPV.some((o) => observaciones[o.clave]);
  return (
    <div className="mt-4 rounded-2xl border border-border-soft bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {titulo}
            {evaluador ? <span className="font-normal text-ink-2"> · {evaluador}</span> : null}
          </p>
          {fecha && <p className="text-[11px] text-ink-3">{fechaHoraCorta(fecha)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {calculo.puntaje != null ? (
            <span className="font-display text-3xl font-bold text-ink">
              {calculo.puntaje}
              <span className="text-sm font-normal text-ink-3"> / 100</span>
            </span>
          ) : calculo.puntaje_provisional != null && calculo.peso_pendiente ? (
            <span className="text-sm font-semibold text-warn">
              Provisional: {calculo.puntaje_provisional} pts · {calculo.peso_pendiente} % del peso por validar
            </span>
          ) : (
            <span className="text-sm font-semibold text-warn">Por validar — evidencia insuficiente</span>
          )}
          {calculo.conclusion && (
            <Badge tone={tonoConclusionIpv(calculo.conclusion)} dot>
              {CONCLUSIONES_IPV[calculo.conclusion] ?? calculo.conclusion}
            </Badge>
          )}
        </div>
      </div>
      {calculo.puntaje == null && Boolean(calculo.sin_evidencia?.length) && (
        <p className="mt-2 text-xs leading-relaxed text-warn">
          Por validar — evidencia insuficiente en: {calculo.sin_evidencia.join(", ")}. El resultado es provisional: el peso pendiente no se
          redistribuye ni se asigna «Medio» por falta de información. Valídalo en la entrevista humana.
        </p>
      )}

      <div className="mt-3 divide-y divide-border-soft">
        {detalle.map((d) => {
          const k = COMPETENCIAS_IPV.find((x) => x.clave === d.clave);
          const evidencia = rubrica?.evidencias?.[d.clave];
          const respuesta = rubrica?.respuestas?.[d.clave];
          return (
            <div key={d.clave} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink">
                  {d.nombre} <span className="font-mono text-[10px] font-normal text-ink-3">· {d.peso}%</span>
                </p>
                <div className="flex items-center gap-2">
                  <Badge tone={tonoNivelIpv(d.nivel)}>{NIVEL_IPV_LABEL[d.nivel] ?? d.nivel}</Badge>
                  <span className="w-14 text-right font-mono text-xs text-ink-2">{d.puntos != null ? `${d.puntos} pts` : "—"}</span>
                </div>
              </div>
              {evidencia ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-2"><b className="text-ink">Evidencia:</b> {evidencia}</p>
              ) : k ? (
                <p className="mt-1 text-[11px] text-ink-3">Se busca: {k.evidencia}</p>
              ) : null}
              {respuesta && <p className="mt-0.5 text-xs italic leading-relaxed text-ink-3">“{respuesta}”</p>}
            </div>
          );
        })}
      </div>

      {hayObservaciones && (
        <div className="mt-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
            Observaciones <span className="font-normal normal-case tracking-normal">(sin peso)</span>
          </p>
          <ul className="mt-1 space-y-1">
            {OBSERVACIONES_IPV.filter((o) => observaciones[o.clave]).map((o) => (
              <li key={o.clave} className="text-xs leading-relaxed text-ink-2">
                <b className="text-ink">{o.nombre}:</b> {observaciones[o.clave]}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(() => {
        const extra = (rubrica ?? {}) as { reservas?: string[]; puntos_validar?: string[] };
        if (!extra.reservas?.length && !extra.puntos_validar?.length) return null;
        return (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Boolean(extra.reservas?.length) && (
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-warn">Reservas</p>
                <ul className="mt-1 space-y-0.5">{extra.reservas!.map((x, i) => <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>)}</ul>
              </div>
            )}
            {Boolean(extra.puntos_validar?.length) && (
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand">Validar en la entrevista humana</p>
                <ul className="mt-1 space-y-0.5">{extra.puntos_validar!.map((x, i) => <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>)}</ul>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ============================================================
   Fraiche (spec §8): «Programar IPV» — Red Human (misma sesión o sesión aparte) o entrevistador humano
   ============================================================ */
function ModalElegirIpv({
  c,
  onClose,
  onHumano,
  onCambio,
}: {
  c: Candidato;
  onClose: () => void;
  onHumano: () => void;
  onCambio: (c: Candidato) => void;
}) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState<null | { modo: "misma_sesion" | "sesion_ipv"; liga: string; envios: EnvioAviso[] }>(null);
  // 2026-10-02 (§5): qué modalidades ya existen — la otra es OPCIONAL (RH decide), nunca se exige ni se genera sola
  const mods = (c.avance?.actividades ?? []).find((a) => a.clave === "ipv")?.modalidades ?? [];
  const hayRh = mods.some((m) => m.modo === "red_human");
  const hayHumana = mods.some((m) => m.modo === "humano");
  const etapaPosterior = c.etapa === "Contratación" || c.etapa === "Onboarding";

  async function redHuman() {
    setCargando(true);
    setError("");
    const r = await programarIpvRedHuman(c.id);
    setCargando(false);
    if (!r.ok) return setError(r.error);
    setListo({ modo: r.data.modo, liga: r.data.liga, envios: r.data.envios ?? [] });
    onCambio(r.data.candidato);
  }
  async function reenviar() {
    const r = await reenviarIpvRedHuman(c.id);
    if (!r.ok) return setError(r.error);
    setListo((x) => (x ? { ...x, envios: r.data.envios ?? [] } : x));
    onCambio(r.data.candidato);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !cargando && onClose()}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-border-soft bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-bold">Agregar evaluación · Entrevista IPV</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          Para <b className="text-ink">{c.nombre}</b>. Misma rúbrica de 6 competencias, la aplique Red Human o una persona.
          {(hayRh || hayHumana) && ` Ya tiene ${hayRh && hayHumana ? "IPV Red Human e IPV humana" : hayRh ? "IPV Red Human" : "IPV humana"}: la otra modalidad es opcional y se conservan ambos resultados.`}
        </p>
        {error && <div className="mt-3"><Aviso tono="error" onCerrar={() => setError("")}>{error}</Aviso></div>}

        {listo ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="rounded-xl border border-good/30 bg-good-soft/40 p-3.5 text-[13px] leading-relaxed text-ink-2">
              {listo.modo === "misma_sesion" ? (
                <p><b className="text-ink">Listo.</b> La IPV Red Human continúa en la misma sesión de la Entrevista Red Human pendiente; se le avisó al candidato con su liga.</p>
              ) : (
                <p><b className="text-ink">IPV Red Human creada.</b> La liga se envió automáticamente al candidato por su canal vinculado. La IPV queda en Filtro Red Human{etapaPosterior ? "; el candidato no se regresa de etapa" : ""}.</p>
              )}
            </div>
            <EstadoEnvios
              titulo="Envío de la liga"
              envios={listo.envios}
              ligas={[{ etiqueta: "Copiar liga", url: listo.liga }]}
              reenvios={[{ etiqueta: "Reenviar", onClick: reenviar }]}
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={redHuman}
              disabled={cargando}
              className="flex flex-col items-start gap-1 rounded-2xl border border-human/30 bg-human-soft/30 p-4 text-left transition hover:border-human disabled:opacity-60"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-human">
                {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Red Human
                {!hayHumana && <Badge tone="human">Recomendada</Badge>}
              </span>
              <span className="text-[12px] leading-relaxed text-ink-2">
                IPV Red Human (Filtro Red Human). Se recomienda antes de la entrevista humana; la liga se envía sola al candidato.
              </span>
            </button>
            <button
              type="button"
              onClick={onHumano}
              disabled={cargando}
              className="flex flex-col items-start gap-1 rounded-2xl border border-brand/30 bg-brand-soft/30 p-4 text-left transition hover:border-brand disabled:opacity-60"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-brand">
                <UserCheck className="h-4 w-4" /> Entrevistador humano
              </span>
              <span className="text-[12px] leading-relaxed text-ink-2">
                IPV humana (Filtro humano). Agenda una ronda con la misma rúbrica; el entrevistador la registra desde su liga.
              </span>
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={cargando}>{listo ? "Cerrar" : "Cancelar"}</Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PESTAÑA 3: CV y documentos (habilidades, estudios/idiomas, alertas, archivos)
   ============================================================ */
function PestanaDocumentos({
  c,
  live,
  onCambio,
  setAviso,
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
  setAviso: (a: AvisoEstado) => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const [cargandoCV, setCargandoCV] = useState(false);
  // 2026-09-20 (B3): documentos requeridos del expediente con su trazabilidad (solicitud → recepción)
  const [expediente, setExpediente] = useState<NuevoIngreso | null>(null);
  const cargarExpediente = useCallback(async () => {
    if (!live || !c.expedienteId) return;
    const e = await fetchExpediente(c.expedienteId);
    if (e) setExpediente(e);
  }, [c.expedienteId, live]);
  useEffect(() => {
    void cargarExpediente();
  }, [cargarExpediente]);
  usePolling(cargarExpediente, 20000);

  const cv = (c.cvDatos || {}) as Record<string, unknown>;
  const habilidades = (cv.habilidades as string[]) || [];
  const estudios = (cv.estudios as string[]) || [];
  const idiomas = (cv.idiomas as string[]) || [];
  const a = c.analisis ?? {};
  const alertas = (cv.alertas as string[]) || (a.alertas || []);
  const faltantes = (cv.datos_faltantes as string[]) || (a.datos_faltantes || []);
  const listaArchivos = c.listaArchivos ?? [];

  async function subirCV(archivos: File[]) {
    setCargandoCV(true);
    setAviso(null);
    const r = await subirArchivoCandidato(c.id, archivos[0], "cv");
    setCargandoCV(false);
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return;
    }
    setAviso({ tono: "ok", texto: "CV procesado exitosamente: datos y score de afinidad actualizados." });
    if (r.data.candidato) onCambio(r.data.candidato);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Habilidades detectadas */}
      {habilidades.length > 0 && (
        <div>
          <Eyebrow>Habilidades y Competencias ({habilidades.length})</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-2">
            {habilidades.map((h, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/25 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand"
              >
                <Award className="h-3.5 w-3.5 text-brand" /> {h}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Estudios e Idiomas */}
      {(estudios.length > 0 || idiomas.length > 0) && (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {estudios.length > 0 && (
            <Card className="p-4">
              <Eyebrow>Formación Académica ({estudios.length})</Eyebrow>
              <ul className="mt-2 space-y-1.5">
                {estudios.map((e, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-ink-2">
                    <GraduationCap className="h-4 w-4 text-ink-3 shrink-0" /> {e}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {idiomas.length > 0 && (
            <Card className="p-4">
              <Eyebrow>Idiomas</Eyebrow>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {idiomas.map((idm, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
                  >
                    <Globe className="h-3.5 w-3.5 text-ink-3" /> {idm}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Alertas del CV */}
      {(alertas.length > 0 || faltantes.length > 0) && (
        <div className="rounded-2xl border border-warn/30 bg-warn-soft/30 p-4">
          <div className="flex items-center gap-2 text-warn font-semibold text-xs">
            <AlertTriangle className="h-4 w-4" />
            <span>Focos de atención detectados por la IA en el CV</span>
          </div>
          {alertas.length > 0 && (
            <ul className="mt-2 space-y-1">
              {alertas.map((al, i) => (
                <li key={i} className="text-xs text-warn">• {al}</li>
              ))}
            </ul>
          )}
          {faltantes.length > 0 && (
            <ul className="mt-1 space-y-1">
              {faltantes.map((df, i) => (
                <li key={i} className="text-xs text-ink-3">• Dato faltante: {df}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 2026-09-20 (B3): trazabilidad de los documentos requeridos del expediente */}
      {c.expedienteId != null && (
        <div>
          <Eyebrow>Documentos requeridos · trazabilidad</Eyebrow>
          {!expediente ? (
            <p className="mt-2 text-xs text-ink-3">Cargando expediente…</p>
          ) : (expediente.documentos ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-ink-3">El expediente todavía no tiene documentos requeridos.</p>
          ) : (
            <div className="scroll-x mt-2 rounded-2xl border border-border-soft">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Documento</th>
                    <th className="px-3 py-2 font-semibold">Solicitado</th>
                    <th className="px-3 py-2 font-semibold">Canal</th>
                    <th className="px-3 py-2 font-semibold">Recibido</th>
                    <th className="px-3 py-2 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(expediente.documentos ?? []).map((d) => {
                    const estado = d.estadoSimple ?? (d.estado === "recibido" || (d.estado === "revision" && d.tieneArchivo) ? "Recibido" : d.estado === "rechazado" ? "Rechazado" : "Pendiente");
                    const solicitudes = d.solicitudes ?? [];
                    return (
                      <tr key={d.nombre} className="border-t border-border-soft align-top">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-ink">{d.nombre}</p>
                          {d.obligatorio === false && <p className="text-[11px] text-ink-3">Opcional</p>}
                        </td>
                        <td className="px-3 py-2 text-ink-2">
                          {d.solicitadoEn ? (
                            <>
                              <p>{fechaHoraCorta(d.solicitadoEn)}</p>
                              {solicitudes.length > 1 && (
                                <p className="text-[11px] text-ink-3" title={solicitudes.map((s) => `${s.tipo === "recordatorio" ? "Recordatorio" : "Solicitud"} · ${fechaHoraCorta(s.en)} · ${canalLegible(s.canal)}`).join("\n")}>
                                  +{solicitudes.length - 1} recordatorio{solicitudes.length - 1 === 1 ? "" : "s"} · último {fechaHoraCorta(solicitudes[solicitudes.length - 1].en)}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-ink-3">Sin solicitar</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-2">{d.solicitadoCanal ? canalLegible(d.solicitadoCanal) : "—"}</td>
                        <td className="px-3 py-2 text-ink-2">
                          {d.recibidoEn ? (
                            <>
                              <p>{fechaHoraCorta(d.recibidoEn)}</p>
                              <p className="text-[11px] text-ink-3">por {canalLegible(d.recibidoCanal || "")}{d.archivo ? ` · ${d.archivo}` : ""}</p>
                            </>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              estado === "Recibido" ? "bg-good-soft text-good" : estado === "Rechazado" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn",
                            )}
                          >
                            {estado}
                          </span>
                          {estado === "Recibido" && d.estado === "revision" && <p className="mt-0.5 text-[11px] text-ink-3">En revisión de RH</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Archivos y Descarga de CV */}
      <div>
        <Eyebrow>Documentos Adjuntos</Eyebrow>
        <div className="mt-2 flex flex-col gap-2.5">
          {listaArchivos.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-3 p-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{a.nombre}</p>
                  <p className="font-mono text-[11px] text-ink-3">
                    {a.tipo} · {pesoLegible(a.tamano)} · {a.subido}
                  </p>
                </div>
              </div>

              <a
                href={urlArchivoCandidato(c.id, a.id)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 shrink-0 rounded-xl border border-border-soft bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface hover:text-brand"
              >
                <Download className="h-3.5 w-3.5" /> Descargar
              </a>
            </Card>
          ))}

          {live && puedeDecidir && (
            <Dropzone compacto onArchivos={subirCV} cargando={cargandoCV} titulo="Subir nuevo CV o actualización" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PESTAÑA 2: Chat de WhatsApp (Historial de Pre-filtro con IA)
   ============================================================ */
function VinculoTelegramFicha({ c }: { c: Candidato }) {
  const [copiado, setCopiado] = useState(false);
  const vinculado = Boolean(c.telegramVinculado);
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3.5 text-sm", vinculado ? "border-good/30 bg-good/10" : "border-warn/30 bg-warn/10")}>
      <span className={cn("font-semibold", vinculado ? "text-good" : "text-warn")}>
        {vinculado ? "Telegram vinculado ✓" : "Aún no vincula Telegram"}
      </span>
      <span className="flex-1 text-xs text-ink-2">
        {vinculado
          ? "El agente y los avisos le llegan por Telegram."
          : "Mientras no abra el bot, no le llega ningún mensaje. Mándale esta liga (correo, SMS o en persona): al abrirla queda vinculado."}
      </span>
      <button
        onClick={() => { navigator.clipboard?.writeText(c.ligaTelegram ?? "").then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1800); }); }}
        className="rounded-xl border border-border-soft bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-2"
      >
        {copiado ? "¡Copiada!" : "Copiar liga de Telegram"}
      </button>
    </div>
  );
}

function PestanaWhatsApp({
  c,
  live,
  onCambio,
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
}) {
  const [msgs, setMsgs] = useState<MensajePrefiltro[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cargandoMsgs, setCargandoMsgs] = useState(false);

  const cargar = useCallback(async () => {
    if (!live) return;
    setCargandoMsgs(true);
    const m = await fetchMensajes(c.id);
    if (m) setMsgs(m);
    setCargandoMsgs(false);
  }, [c.id, live]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto("");
    setEnviando(true);
    const r = await enviarPrefiltro(c.id, t, "whatsapp");
    setEnviando(false);
    if (!r.ok) return;
    const nuevos = await fetchMensajes(c.id);
    if (nuevos) setMsgs(nuevos);
    if (r.data.clasificacion) {
      const actualizado = await fetchCandidato(c.id);
      if (actualizado) onCambio(actualizado);
    }
  }

  if (!live) {
    return (
      <div className="py-12 text-center text-sm text-ink-3">
        <MessageCircle className="mx-auto h-8 w-8 text-ink-3/60 mb-2" />
        Levanta la API en el puerto 8001 para ver el historial y sincronización de {CANAL} en tiempo real.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Telegram (2026-10-01): un bot solo escribe a quien ya abrió el chat — estado del vínculo + liga para compartir */}
      {c.ligaTelegram ? <VinculoTelegramFicha c={c} /> : null}
      {/* Header del Chat */}
      <div className="flex items-center justify-between rounded-2xl border border-border-soft bg-surface p-3.5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-good/15 text-good">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {c.telefono ? `${CANAL}: +${c.telefono}` : "Conversación de Pre-filtro"}
            </p>
            <p className="text-xs text-ink-3">
              {c.prefiltroCompleto ? "Prefiltro completado por el agente" : "Agente de IA (Luna) activo"} · {msgs.length} mensajes
            </p>
          </div>
        </div>

        <button
          onClick={cargar}
          disabled={cargandoMsgs}
          className="flex items-center gap-1.5 rounded-xl border border-border-soft bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-3 transition disabled:opacity-50"
          title="Actualizar conversación"
        >
          <RotateCw className={cn("h-3.5 w-3.5", cargandoMsgs && "animate-spin")} />
          Actualizar
        </button>
      </div>

      {/* Feed de Conversación de WhatsApp */}
      <div className="flex max-h-[380px] min-h-[260px] flex-col gap-3 overflow-y-auto rounded-2xl border border-border-soft bg-surface-2/40 p-4">
        {msgs.length === 0 && !cargandoMsgs && (
          <div className="py-12 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-ink-3/40" />
            <p className="mt-2 text-sm font-medium text-ink-3">Aún no hay mensajes en este chat.</p>
            <p className="mt-0.5 text-xs text-ink-3">
              Cuando el candidato escriba a tu bot de {CANAL}, las preguntas y respuestas aparecerán aquí en vivo.
            </p>
          </div>
        )}

        {msgs.map((m, i) => {
          const esIA = m.rol === "assistant";
          return (
            <div
              key={i}
              className={cn(
                "flex flex-col max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-[13px] leading-relaxed shadow-sm",
                esIA
                  ? "self-start rounded-bl-sm border border-border-soft bg-surface text-ink-2"
                  : "self-end rounded-br-sm bg-brand text-brand-ink",
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-[10px]">
                <span className={cn("font-semibold flex items-center gap-1", esIA ? "text-human" : "text-brand-ink/80")}>
                  {esIA ? <Sparkles className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                  {esIA ? "Agente Red Human (Luna)" : (c.nombre || "Candidato")}
                </span>
                <span className={cn("font-mono", esIA ? "text-ink-3" : "text-brand-ink/70")}>
                  {m.canal === "whatsapp" ? CANAL : "Simulador"}
                </span>
              </div>
              <p className="whitespace-pre-wrap">{m.texto}</p>
            </div>
          );
        })}

        {enviando && (
          <div className="self-start rounded-2xl rounded-bl-sm bg-surface p-3 text-ink-3 border border-border-soft shadow-sm">
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
              <span>Luna está procesando la respuesta...</span>
            </div>
          </div>
        )}
      </div>

      {/* Simulador de Chat / Envío Rápido */}
      <div className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder="Escribir mensaje simulado (prueba de pre-filtro)…"
          className="h-11 flex-1 rounded-xl border border-border-soft bg-surface px-3.5 text-xs sm:text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button size="md" onClick={enviar} disabled={enviando || !texto.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   MODAL DE CARGA MASIVA DE CVS
   ============================================================ */
function CargarCVs({
  vacantes,
  onClose,
  onListo,
}: {
  vacantes: Vacante[];
  onClose: () => void;
  onListo: (codigo?: string) => void;
}) {
  const [vacante, setVacante] = useState(vacantes[0]?.id ?? "");
  const [fuente, setFuente] = useState("RH");
  const [cargando, setCargando] = useState(false);
  const [res, setRes] = useState<CargaCV | null>(null);
  const [error, setError] = useState("");

  async function procesar(archivos: File[]) {
    setCargando(true);
    setError("");
    setRes(null);
    const r = await subirCVs(archivos, { vacante: vacante || undefined, fuente });
    setCargando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRes(r.data);
    onListo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-md sm:p-4">
      <div className="relative flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden border border-border-soft bg-bg shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">
        <div className="glass sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border-soft px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <Eyebrow>Ingesta de prospectos</Eyebrow>
            <h2 className="font-display text-lg font-bold text-ink">Cargar CVs con Extracción de IA</h2>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Vacante</span>
              <select
                value={vacante}
                onChange={(e) => setVacante(e.target.value)}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Sin vacante (solo extraer datos)</option>
                {vacantes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.titulo} · {v.ubicacion}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Fuente</span>
              <select
                value={fuente}
                onChange={(e) => setFuente(e.target.value)}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {["RH", "OCC", "LinkedIn", "Indeed", "Formulario", CANAL].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>

          <Aviso tono="info">
            Con vacante seleccionada, el agente Luna extrae los datos del CV y califica automáticamente la afinidad.
          </Aviso>

          <Dropzone
            multiple
            cargando={cargando}
            onArchivos={procesar}
            titulo="Arrastra hasta 20 CVs o haz clic para elegirlos"
          />

          {error && <Aviso tono="error">{error}</Aviso>}

          {res && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Badge tone="good" dot>
                  {res.procesados} procesado(s)
                </Badge>
                {res.fallidos > 0 && (
                  <Badge tone="bad" dot>
                    {res.fallidos} rechazado(s)
                  </Badge>
                )}
              </div>

              {res.resultados.map((r, i) => (
                <Card key={i} className={cn("p-3.5", !r.ok && "border-bad/25 bg-bad-soft/30")}>
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                        r.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad",
                      )}
                    >
                      {r.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-ink-3">{r.archivo}</p>
                      {r.ok && r.candidato ? (
                        <>
                          <button
                            onClick={() => onListo(r.candidato!.id)}
                            className="mt-0.5 text-left text-sm font-semibold hover:text-brand hover:underline"
                          >
                            {r.candidato.nombre}
                            <span className="ml-1.5 font-mono text-xs font-normal text-ink-3">{r.candidato.id}</span>
                          </button>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <EstadoBadge estado={r.candidato.estado} />
                            <span className="font-mono text-[11px] text-ink-3">match {r.candidato.score}</span>
                            {r.duplicado && <Badge tone="warn">ya existía</Badge>}
                          </div>
                        </>
                      ) : (
                        <p className="mt-0.5 text-[13px] leading-relaxed text-bad">{r.error}</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Confirmación genérica (checkbox "Entrevista realizada", etc.)
   ============================================================ */
function ModalConfirmar({
  titulo,
  texto,
  onCancelar,
  onConfirmar,
  cargando,
}: {
  titulo: string;
  texto: string;
  onCancelar: () => void;
  onConfirmar: () => void;
  cargando?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-5">
        <h3 className="font-display text-lg font-bold">{titulo}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{texto}</p>
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={cargando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={onConfirmar} disabled={cargando}>
            {cargando ? "Confirmando…" : "Confirmar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Etapa: Entrevista Humana — datos programados + "Entrevista realizada"
   ============================================================ */
function PanelEntrevistaHumana({
  c,
  live,
  onCambio,
  onNuevaIpv,
  eh: ehProp,
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
  /** Fraiche (spec §8): abre la agenda de una nueva ronda IPV con entrevistador humano. */
  onNuevaIpv?: () => void;
  /** 2026-10-02 (§12): la entrevista de ESTA tarjeta (hay varias); sin ella, la más reciente. */
  eh?: EntrevistaHumana | null;
}) {
  const modoPrueba = useModoPrueba();
  const eh = ehProp ?? c.entrevistaHumana;
  const ehId = eh?.id;
  const [cambiandoCompartir, setCambiandoCompartir] = useState(false);
  const [modalResultado, setModalResultado] = useState(false);
  const [modalModificar, setModalModificar] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<AvisoEstado>(null);
  const [recordando, setRecordando] = useState(false);
  const [avisoRecordatorio, setAvisoRecordatorio] = useState<AvisoEstado>(null);
  const [cancelando, setCancelando] = useState(false);
  // Punto 12: confirmación ligera con la línea "Notificar: … · Editar" antes de cada acción.
  const [confirmacion, setConfirmacion] = useState<null | "realizada" | "recordatorio" | "cancelar">(null);
  const ultimoNotificar = useRef<NotificarAccion | undefined>(undefined);
  const hayCliente = Boolean(c.clienteVacante);

  /** Botón «Cancelar» (Fase D) — no mueve la tarjeta de etapa: RH agenda otra ronda o mueve la
   * etapa a mano según corresponda. */
  async function cancelar(notificar?: NotificarAccion) {
    setCancelando(true);
    setAviso(null);
    const r = await cancelarEntrevistaHumana(c.id, notificar, ehId);
    setCancelando(false);
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return;
    }
    onCambio(r.data);
    avisarResultados("Entrevista cancelada.", r.data.resultados);
  }

  /** Ya no pide resultado (Lote 3, Eje 2): solo confirma que la entrevista ocurrió y dispara el
   * correo con la liga al entrevistador. `forzarPrueba` (Lote 4): si Modo Prueba está activo y
   * el candidato ya no está en la etapa de Entrevista Humana, el aviso de error trae un botón
   * para reintentar saltando ese bloqueo. */
  async function marcarRealizada(forzarPrueba = false, notificar?: NotificarAccion) {
    if (notificar) ultimoNotificar.current = notificar;
    setMarcando(true);
    setAviso(null);
    const r = await marcarEntrevistaHumanaRealizada(c.id, forzarPrueba, ultimoNotificar.current, ehId);
    setMarcando(false);
    if (!r.ok) {
      setAviso({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba ? () => marcarRealizada(true) : undefined,
      });
      return;
    }
    onCambio(r.data.candidato);
  }

  /** Respaldo manual de RH — captura la primera vez o corrige un resultado ya capturado
   * (por RH o por el entrevistador vía su liga). */
  async function guardarResultado(
    datos: { resultado?: ResultadoEntrevistaHumana; recomendacion?: RecomendacionEntrevistaHumana; comentario: string; notificar?: NotificarAccion; rubrica?: RubricaIPV },
    forzarPrueba = false,
  ) {
    setGuardando(true);
    setAviso(null);
    const r = await registrarResultadoEntrevistaHumana(c.id, { ...datos, entrevistaId: ehId }, forzarPrueba);
    setGuardando(false);
    if (!r.ok) {
      setAviso({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba ? () => guardarResultado(datos, true) : undefined,
      });
      return;
    }
    setModalResultado(false);
    onCambio(r.data);
  }

  async function enviarRecordatorio(forzarPrueba = false, notificar?: NotificarAccion) {
    if (notificar) ultimoNotificar.current = notificar;
    setRecordando(true);
    setAvisoRecordatorio(null);
    const r = await recordatorioEntrevistaHumana(c.id, forzarPrueba, ultimoNotificar.current, ehId);
    setRecordando(false);
    if (!r.ok) {
      setAvisoRecordatorio({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba ? () => enviarRecordatorio(true) : undefined,
      });
      return;
    }
    const algunoEnviado = r.data.resultados.some((x) => x.enviado);
    setAvisoRecordatorio({
      tono: algunoEnviado ? "ok" : "warn",
      texto: algunoEnviado
        ? "Recordatorio enviado."
        : "No se envió nada — revisa la línea «Notificar» o Configuración → Notificaciones para este evento.",
    });
    onCambio(r.data.candidato);
  }

  /** Muestra el resultado por destinatario de un aviso (reprogramar, cancelar, reenviar). */
  function avisarResultados(titulo: string, resultados?: { enviado: boolean; destinatario?: string; canal?: string; destino?: string; detalle?: string }[]) {
    const lineas = lineasResultados(resultados as never);
    setAviso({
      tono: lineas.some((l) => !l.ok) ? "warn" : "ok",
      texto: lineas.length ? `${titulo} ${lineas.map((l) => `${l.ok ? "✓" : "✗"} ${l.texto}`).join(" · ")}` : `${titulo} No había destinatarios activos para avisar.`,
    });
  }
  async function reenviar(destinatario: "candidato" | "entrevistador" | "") {
    const r = await reenviarAvisoEntrevistaHumana(c.id, { entrevistaId: ehId, destinatario });
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    onCambio(r.data.candidato);
    avisarResultados("Aviso reenviado.", r.data.resultados);
  }

  if (!eh) return null;

  const detalleModalidad =
    eh.modalidad === "Videollamada"
      ? eh.liga && `${eh.porTeams ? "Reunión de Teams: " : "Liga: "}${eh.liga}`
      : eh.modalidad === "Presencial"
        ? eh.ubicacion && `Ubicación: ${eh.ubicacion}`
        : eh.modalidad === "Llamada"
          ? (eh.telefonoContacto || c.telefono) && `Teléfono: ${eh.telefonoContacto || c.telefono}`
          : "";

  const IconoModalidad = eh.modalidad === "Presencial" ? MapPin : eh.modalidad === "Llamada" ? Phone : Video;

  return (
    <Card className="border-[color:var(--brand-2)]/30 bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>{eh.esIpv ? "IPV humana programada" : `${eh.claseNombre || "Entrevista Humana"} programada`}</Eyebrow>
        {eh.esIpv && <Badge tone="human">IPV humana</Badge>}
        {!eh.esIpv && eh.clase && eh.clase !== "reclutamiento" && <Badge tone={eh.obligatoria ? "warn" : "neutral"}>{eh.obligatoria ? "Obligatoria" : "Adicional"}</Badge>}
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <Info
          icon={UserCheck}
          v={`Entrevistador(a): ${eh.entrevistador || "sin asignar"}${eh.tipo ? ` (${eh.tipo === "interno" ? "interno" : "externo"})` : ""}`}
        />
        <Info
          icon={CalendarClock}
          v={eh.fecha ? new Date(eh.fecha).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Sin fecha"}
        />
        <Info icon={IconoModalidad} v={`Modalidad: ${eh.modalidad || "sin definir"}`} />
        {detalleModalidad && <Info icon={Mail} v={detalleModalidad} />}
      </div>
      {eh.comentario && <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{eh.comentario}</p>}

      {/* 2026-10-04: qué abre la liga del entrevistador (Enviar / Reenviar / Copiar liga respetan esta opción) */}
      {live && !eh.resultado && !eh.cancelada && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <span className="font-semibold">Información a compartir:</span>
          {(["ficha", "ficha_expediente"] as const).map((v) => (
            <button key={v} type="button" disabled={cambiandoCompartir}
              onClick={async () => {
                if ((eh.compartir ?? "ficha") === v) return;
                setCambiandoCompartir(true);
                const r = await cambiarCompartirEntrevista(c.id, v, ehId);
                setCambiandoCompartir(false);
                if (!r.ok) return setAviso({ tono: "error", texto: r.error });
                onCambio(r.data);
                setAviso({ tono: "ok", texto: v === "ficha" ? "La liga del entrevistador ahora solo muestra la ficha." : "La liga del entrevistador ahora incluye «Ver expediente»." });
              }}
              className={`rounded-full border px-3 py-1 font-medium transition ${(eh.compartir ?? "ficha") === v ? "border-brand bg-brand-soft text-brand" : "border-border-soft hover:border-brand/40"}`}>
              {v === "ficha" ? "Solo ficha" : "Ficha + expediente"}
            </button>
          ))}
        </div>
      )}

      {/* 2026-10-02 (§2/§12): estado del envío por destinatario + Copiar liga / Reenviar */}
      {live && !eh.resultado && (
        <div className="mt-3">
          <EstadoEnvios
            titulo="Avisos de la cita"
            envios={eh.envios}
            ligas={[{ etiqueta: "Copiar liga del entrevistador", url: eh.ligaEntrevistador }]}
            reenvios={eh.cancelada ? [] : [
              { etiqueta: "Reenviar al candidato", onClick: () => reenviar("candidato") },
              { etiqueta: "Reenviar al entrevistador", onClick: () => reenviar("entrevistador") },
            ]}
          />
        </div>
      )}

      {aviso && (
        <div className="mt-3">
          <Aviso tono={aviso.tono}>
            {aviso.texto}
            {aviso.reintentar && (
              <Button size="sm" variant="outline" className="mt-2" onClick={aviso.reintentar}>
                <FlaskConical className="h-3.5 w-3.5" /> Continuar de todos modos (modo prueba)
              </Button>
            )}
          </Aviso>
        </div>
      )}

      {avisoRecordatorio && (
        <div className="mt-3">
          <Aviso tono={avisoRecordatorio.tono}>
            {avisoRecordatorio.texto}
            {avisoRecordatorio.reintentar && (
              <Button size="sm" variant="outline" className="mt-2" onClick={avisoRecordatorio.reintentar}>
                <FlaskConical className="h-3.5 w-3.5" /> Continuar de todos modos (modo prueba)
              </Button>
            )}
          </Aviso>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {eh.cancelada ? (
          <Badge tone="bad" dot>Cancelada</Badge>
        ) : eh.resultado ? (
          <>
            {eh.resultadoIpv ? (
              <>
                <span className="font-mono text-sm font-bold text-ink">
                  {eh.resultadoIpv.puntaje != null ? `IPV ${eh.resultadoIpv.puntaje} / 100` : "IPV sin puntaje"}
                </span>
                {eh.resultadoIpv.conclusion && <Badge tone={tonoConclusionIpv(eh.resultadoIpv.conclusion)} dot>{CONCLUSIONES_IPV[eh.resultadoIpv.conclusion]}</Badge>}
                {eh.resultadoIpv.requiere_revision && <Badge tone="warn">Requiere revisión</Badge>}
              </>
            ) : (
              <Badge tone={eh.resultado === "aprobado" ? "good" : "bad"} dot>
                {eh.resultado === "aprobado" ? "Aprobado" : "No aprobado"}
              </Badge>
            )}
            {eh.recomendacion && <Badge tone="brand">{RECOMENDACION_LABEL[eh.recomendacion]}</Badge>}
            {eh.sugiereNuevaIpv && live && onNuevaIpv && (
              <Button size="sm" variant="outline" onClick={onNuevaIpv}>
                <UserCheck className="h-4 w-4" /> Programar nueva IPV humana
              </Button>
            )}
          </>
        ) : live ? (
          <>
            {/* 2026-09-19 (cambios Raúl): UN solo paso — «Entrevista realizada» abre el único modal
                (Resultado + Comentarios opcionales + Guardar). Sin confirmaciones intermedias. */}
            <Button size="sm" onClick={() => setModalResultado(true)} disabled={guardando || marcando}>
              <CheckCircle2 className="h-4 w-4" /> {guardando ? "Guardando…" : eh.realizada ? "Registrar resultado" : "Entrevista realizada"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setModalModificar(true)} title="No se realizó: reprogramar fecha, hora o modalidad">
              <RotateCw className="h-4 w-4" /> No realizada / Reprogramar
            </Button>
            <MenuAcciones
              acciones={[
                { etiqueta: "Reenviar liga de evaluación al entrevistador", icono: <Send />, onClick: () => setConfirmacion("realizada"), disabled: marcando },
                { etiqueta: "Enviar recordatorio", icono: <RotateCw />, onClick: () => setConfirmacion("recordatorio"), disabled: recordando },
                { etiqueta: "Modificar datos", icono: <Pencil />, onClick: () => setModalModificar(true) },
                { etiqueta: "Cancelar entrevista", icono: <XCircle />, peligrosa: true, onClick: () => setConfirmacion("cancelar"), disabled: cancelando },
              ]}
            />
          </>
        ) : null}
      </div>

      {eh.resultado && live && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <span className="text-[11px] text-ink-3">
            Registrado por {eh.resultadoCapturadoPor === "entrevistador" ? "el entrevistador (liga)" : "RH"}.
          </span>
          <button onClick={() => setModalResultado(true)} disabled={guardando} className="text-[11px] font-semibold text-brand hover:underline">
            Corregir resultado
          </button>
        </div>
      )}
      {eh.realizada && !eh.resultado && live && (
        <p className="mt-2 text-[11px] text-ink-3">Esperando la evaluación del entrevistador desde su liga; también puedes registrarla aquí.</p>
      )}

      {confirmacion === "realizada" && (
        <ConfirmacionAccion
          titulo="Reenviar liga de evaluación"
          texto={`Se le manda al entrevistador (correo HTML / ${CANAL}) la liga con el expediente y el formulario de evaluación.`}
          evento="entrevista_humana_terminada"
          hayCliente={hayCliente}
          clienteId={c.clienteIdVacante ?? null}
          etiquetaConfirmar="Enviar liga"
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={async (n) => {
            setConfirmacion(null);
            await marcarRealizada(false, n);
          }}
        />
      )}
      {confirmacion === "recordatorio" && (
        <ConfirmacionAccion
          titulo="Enviar recordatorio de la entrevista"
          evento="recordatorio_entrevista"
          hayCliente={hayCliente}
          clienteId={c.clienteIdVacante ?? null}
          etiquetaConfirmar="Enviar"
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={async (n) => {
            setConfirmacion(null);
            await enviarRecordatorio(false, n);
          }}
        />
      )}
      {confirmacion === "cancelar" && (
        <ConfirmacionAccion
          titulo="¿Cancelar esta entrevista?"
          texto="No se mueve la etapa del candidato; después puedes agendar otra ronda."
          evento="entrevista_cancelada"
          hayCliente={hayCliente}
          clienteId={c.clienteIdVacante ?? null}
          etiquetaConfirmar="Cancelar entrevista"
          tono="bad"
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={async (n) => {
            setConfirmacion(null);
            await cancelar(n);
          }}
        />
      )}
      {modalResultado && (
        <ModalCerrarEntrevistaHumana
          hayCliente={hayCliente}
          clienteId={c.clienteIdVacante ?? null}
          esIpv={Boolean(eh.esIpv)}
          rubricaInicial={eh.rubrica}
          inicial={
            eh.resultado
              ? { resultado: eh.resultado, recomendacion: eh.recomendacion, comentario: eh.comentario }
              : undefined
          }
          onCancelar={() => setModalResultado(false)}
          onConfirmar={guardarResultado}
          cargando={guardando}
        />
      )}

      {modalModificar && (
        <ModalModificarEntrevista
          c={c}
          eh={eh}
          onClose={() => setModalModificar(false)}
          onListo={(datos) => {
            setModalModificar(false);
            onCambio(datos);
            avisarResultados("Entrevista reprogramada; el recordatorio se programó para la nueva cita.", (datos as Candidato & { resultados?: [] }).resultados);
          }}
        />
      )}
    </Card>
  );
}

/* ============================================================
   Modal "Marcar entrevista realizada" — Resultado + Recomendación obligatorios
   ============================================================ */
function ModalCerrarEntrevistaHumana({
  inicial,
  hayCliente = false,
  clienteId,
  esIpv = false,
  rubricaInicial,
  onCancelar,
  onConfirmar,
  cargando,
}: {
  hayCliente?: boolean;
  clienteId?: number | null;
  /** Presente cuando ya había un resultado capturado — el modal pasa a modo "corregir" y
   * precarga los valores actuales. */
  inicial?: {
    resultado: ResultadoEntrevistaHumana | null;
    recomendacion: RecomendacionEntrevistaHumana | null;
    comentario: string;
  };
  /** Fraiche (spec §8): ronda IPV → formulario de rúbrica (el servidor deriva resultado/recomendación). */
  esIpv?: boolean;
  rubricaInicial?: RubricaIPV | null;
  onCancelar: () => void;
  onConfirmar: (datos: {
    resultado?: ResultadoEntrevistaHumana;
    recomendacion?: RecomendacionEntrevistaHumana;
    comentario: string;
    notificar?: NotificarAccion;
    rubrica?: RubricaIPV;
  }) => void;
  cargando?: boolean;
}) {
  const notificar = useNotificarAccion("recomendacion_final");
  const [resultado, setResultado] = useState<ResultadoEntrevistaHumana | "">(inicial?.resultado ?? "");
  const [comentario, setComentario] = useState(inicial?.comentario ?? "");
  const [segunda, setSegunda] = useState(inicial?.recomendacion === "segunda_entrevista");

  // 2026-09-19 (cambios Raúl): un solo paso. La recomendación se deriva del resultado
  // (Aprobado → avanzar, Rechazado → no avanzar; «pedir segunda entrevista» es una casilla opcional).
  const recomendacion: RecomendacionEntrevistaHumana | "" = segunda ? "segunda_entrevista" : resultado === "aprobado" ? "avanzar" : resultado === "no_aprobado" ? "no_avanzar" : "";
  const listo = !!resultado;

  // Fraiche (spec §8): rúbrica IPV — misma que Red Human; vista previa con calcularIpv (el servidor recalcula)
  const [niveles, setNiveles] = useState<Record<string, NivelIPV | "">>(() =>
    Object.fromEntries(COMPETENCIAS_IPV.map((k) => [k.clave, rubricaInicial?.niveles?.[k.clave] ?? ""])),
  );
  const [respuestas, setRespuestas] = useState<Record<string, string>>(() => ({ ...(rubricaInicial?.respuestas ?? {}) }));
  const [evidencias, setEvidencias] = useState<Record<string, string>>(() => ({ ...(rubricaInicial?.evidencias ?? {}) }));
  const [observaciones, setObservaciones] = useState<Record<string, string>>(() => ({ ...(rubricaInicial?.observaciones ?? {}) }));
  const [equivalencias, setEquivalencias] = useState<Record<string, number>>(EQUIVALENCIAS_IPV_DEFAULT);
  useEffect(() => {
    if (!esIpv) return;
    let vivo = true;
    fetchConfiguracion().then((d) => {
      if (vivo && d?.ipvEquivalencias) setEquivalencias(d.ipvEquivalencias);
    });
    return () => {
      vivo = false;
    };
  }, [esIpv]);
  const calculo = useMemo(() => calcularIpv(niveles, equivalencias), [niveles, equivalencias]);
  const listoIpv = COMPETENCIAS_IPV.every((k) => Boolean(niveles[k.clave]));
  const inputIpv = "h-10 w-full rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  function confirmarIpv() {
    onConfirmar({
      comentario,
      notificar: notificar.value,
      rubrica: {
        niveles: Object.fromEntries(COMPETENCIAS_IPV.map((k) => [k.clave, (niveles[k.clave] || "sin_evidencia") as NivelIPV])),
        respuestas,
        evidencias,
        observaciones,
      },
    });
  }

  if (esIpv) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4">
        <Card className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl">
          <div className="shrink-0 border-b border-border-faint px-5 pt-5 pb-3">
            <h3 className="font-display text-lg font-bold">{inicial ? "Corregir rúbrica IPV" : "Entrevista IPV realizada"}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              {inicial ? "Vas a sobreescribir la rúbrica ya registrada." : "Misma rúbrica de 6 competencias que Red Human."} Por competencia: nivel, respuesta y evidencia. «Sin evidencia» no inventa puntaje: deja la ronda en revisión.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            <div className="mt-4 flex flex-col gap-4">
              {COMPETENCIAS_IPV.map((k) => (
                <div key={k.clave} className="rounded-2xl border border-border-soft p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {k.nombre} <span className="font-mono text-[10px] font-normal text-ink-3">· {k.peso}%</span>
                    </p>
                    {niveles[k.clave] && niveles[k.clave] !== "sin_evidencia" && (
                      <span className="font-mono text-xs text-ink-2">{calculo.detalle.find((d) => d.clave === k.clave)?.puntos ?? "—"} pts</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-3">Situación: {k.situacion}. Se busca: {k.evidencia}.</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {NIVELES_IPV.map((n) => (
                      <button
                        key={n.clave}
                        type="button"
                        onClick={() => setNiveles((prev) => ({ ...prev, [k.clave]: n.clave }))}
                        className={cn(
                          "h-9 rounded-xl border text-xs font-medium transition",
                          niveles[k.clave] === n.clave
                            ? n.clave === "alto"
                              ? "border-good/25 bg-good-soft text-good"
                              : n.clave === "medio"
                                ? "border-warn/25 bg-warn-soft text-warn"
                                : n.clave === "bajo"
                                  ? "border-bad/25 bg-bad-soft text-bad"
                                  : "border-ink-3/40 bg-surface-2 text-ink"
                            : "border-border-soft text-ink-2",
                        )}
                      >
                        {n.nombre}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={respuestas[k.clave] ?? ""}
                    onChange={(e) => setRespuestas((prev) => ({ ...prev, [k.clave]: e.target.value }))}
                    rows={2}
                    placeholder="Respuesta del candidato (resumen)…"
                    className="mt-2 w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  <input
                    value={evidencias[k.clave] ?? ""}
                    onChange={(e) => setEvidencias((prev) => ({ ...prev, [k.clave]: e.target.value }))}
                    placeholder="Evidencia observada…"
                    className={cn("mt-2", inputIpv)}
                  />
                </div>
              ))}

              <div className="rounded-2xl border border-border-soft p-3.5">
                <p className="text-sm font-semibold text-ink">
                  Observaciones <span className="font-mono text-[10px] font-normal text-ink-3">· sin peso</span>
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {OBSERVACIONES_IPV.map((o) => (
                    <label key={o.clave} className="flex flex-col gap-1">
                      <span className="text-[12px] font-medium text-ink-2">{o.nombre}</span>
                      <input
                        value={observaciones[o.clave] ?? ""}
                        onChange={(e) => setObservaciones((prev) => ({ ...prev, [o.clave]: e.target.value }))}
                        className={inputIpv}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Vista previa en vivo — el servidor recalcula con las equivalencias vigentes */}
              <div className={cn("rounded-2xl border p-3.5", calculo.puntaje != null ? "border-brand/30 bg-brand-soft/20" : "border-warn/30 bg-warn-soft/30")}>
                {calculo.puntaje != null ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-2xl font-bold text-ink">
                      {calculo.puntaje}
                      <span className="text-sm font-normal text-ink-3"> / 100</span>
                    </span>
                    <Badge tone={tonoConclusionIpv(calculo.conclusion)} dot>{CONCLUSIONES_IPV[calculo.conclusion]}</Badge>
                    <span className="text-[11px] text-ink-3">80–100 Recomendable · 60–79 Bajo reserva · &lt;60 No recomendable</span>
                  </div>
                ) : (
                  <p className="text-sm text-warn">
                    {listoIpv ? `Sin evidencia en: ${calculo.sin_evidencia.join(", ")} → requiere revisión de RH (no se calcula puntaje).` : "Marca el nivel de las 6 competencias para ver el puntaje."}
                  </p>
                )}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Comentarios <span className="text-ink-3">(opcional)</span></span>
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  rows={2}
                  placeholder="Lo que quieras dejar registrado de la entrevista…"
                  className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <LineaNotificar value={notificar.value} onChange={notificar.setValue} hayCliente={hayCliente} clienteId={clienteId ?? null} />
            </div>
          </div>

          <div className="flex shrink-0 gap-3 border-t border-border-faint px-5 py-3">
            <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={cargando}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={confirmarIpv} disabled={cargando || !listoIpv}>
              {cargando ? "Guardando…" : "Guardar rúbrica"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md p-5">
        <h3 className="font-display text-lg font-bold">{inicial ? "Corregir resultado" : "Entrevista realizada"}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {inicial ? "Vas a sobreescribir el resultado ya registrado." : "Registra el resultado y listo: la entrevista queda confirmada y se habilitan los siguientes pasos."}
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <span className="text-sm font-medium text-ink-2">Resultado</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResultado("aprobado")}
                className={`h-10 rounded-xl border text-sm font-medium transition ${
                  resultado === "aprobado" ? "border-good/25 bg-good-soft text-good" : "border-border-soft text-ink-2"
                }`}
              >
                Aprobado
              </button>
              <button
                type="button"
                onClick={() => setResultado("no_aprobado")}
                className={`h-10 rounded-xl border text-sm font-medium transition ${
                  resultado === "no_aprobado" ? "border-bad/25 bg-bad-soft text-bad" : "border-border-soft text-ink-2"
                }`}
              >
                Rechazado
              </button>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Comentarios <span className="text-ink-3">(opcional)</span></span>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              placeholder="Lo que quieras dejar registrado de la entrevista…"
              className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={segunda} onChange={(e) => setSegunda(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
            Pedir una segunda entrevista
          </label>
        </div>

        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={cargando}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            onClick={() =>
              onConfirmar({
                resultado: resultado as ResultadoEntrevistaHumana,
                recomendacion: recomendacion as RecomendacionEntrevistaHumana,
                comentario,
                notificar: notificar.value,
              })
            }
            disabled={cargando || !listo}
          >
            {cargando ? "Guardando…" : "Confirmar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Modal "Programar entrevista" (botón «Enviar a Entrevista Humana»)
   ============================================================ */
function ModalProgramarEntrevista({
  c,
  esIpv = false,
  onClose,
  onListo,
}: {
  c: Candidato;
  /** Fraiche (spec §8): ronda IPV con entrevistador humano (misma rúbrica de 6 competencias que Red Human). */
  esIpv?: boolean;
  onClose: () => void;
  onListo: (c: Candidato, resultados: ResultadoNotificacion[], advertencias?: string[]) => void;
}) {
  const notificar = useNotificarAccion("entrevista_agendada");
  const clienteId = c.clienteIdVacante ?? null;
  const [entrevistadores, setEntrevistadores] = useState<Entrevistador[]>([]);
  const [contactos, setContactos] = useState<ContactoCliente[] | null>(clienteId ? null : []);
  const [tipoEntrevistador, setTipoEntrevistador] = useState<TipoEntrevistador>("interno");
  const [entrevistadorUsuarioId, setEntrevistadorUsuarioId] = useState<number | null>(null);
  // Fase 7A: externo = contacto del Cliente (id) u «Otro entrevistador» (OTRO → captura manual)
  const OTRO = "otro";
  const [contactoSel, setContactoSel] = useState<number | typeof OTRO | "">("");
  const [entrevistadorNombre, setEntrevistadorNombre] = useState("");
  const [entrevistadorCorreo, setEntrevistadorCorreo] = useState("");
  const [entrevistadorWhatsapp, setEntrevistadorWhatsapp] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadEntrevistaHumana>("Videollamada");
  const [liga, setLiga] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [telefonoContacto, setTelefonoContacto] = useState("");
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [preview, setPreview] = useState<null | "entrevistador" | "candidato">(null);
  // 2026-10-02 (§12/§14): entrevistas con encargado y franquiciatario usan ESTE mismo flujo (nunca «Otra»)
  const [clase, setClase] = useState<"reclutamiento" | "encargado" | "franquiciatario">("reclutamiento");
  const [obligatoria, setObligatoria] = useState(false);
  const [enviarFicha] = useState(true);
  // 2026-10-04: «Información a compartir» con el entrevistador (la liga y el correo respetan lo elegido)
  const [compartir, setCompartir] = useState<"ficha" | "ficha_expediente">("ficha");
  const etapaAnterior = c.etapa === "Prefiltro" || c.etapa === "Entrevista IA";
  // Fase 7B: con Teams conectado en la Cuenta la videollamada se crea sola; «Usar otra liga» = excepción
  const [teamsConectado, setTeamsConectado] = useState(false);
  const [otraLiga, setOtraLiga] = useState(false);
  const porTeams = modalidad === "Videollamada" && teamsConectado && !otraLiga;

  useEffect(() => {
    fetchEntrevistadores().then((d) => {
      if (d && d.length) {
        setEntrevistadores(d);
        setEntrevistadorUsuarioId(d[0].id);
      }
    });
    fetchIntegracionTeams().then((t) => setTeamsConectado(Boolean(t?.disponible && t?.conectado)));
  }, []);

  useEffect(() => {
    if (!clienteId) return;
    let vivo = true;
    fetchCliente(clienteId).then((cl) => vivo && setContactos(cl?.listaContactos ?? []));
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  // sin Cliente en la vacante (o sin contactos) el externo va directo a «Otro entrevistador»
  useEffect(() => {
    if (contactos !== null && contactos.length === 0 && contactoSel === "") setContactoSel(OTRO);
  }, [contactos, contactoSel]);

  const internoSel = entrevistadores.find((u) => u.id === entrevistadorUsuarioId) ?? null;
  const contactoElegido = typeof contactoSel === "number" ? (contactos ?? []).find((k) => k.id === contactoSel) ?? null : null;
  const esOtro = contactoSel === OTRO;

  async function programar() {
    if (!fecha || !hora) {
      setError("Completa fecha y hora.");
      return;
    }
    if (tipoEntrevistador === "interno" && !entrevistadorUsuarioId) {
      setError("Selecciona quién entrevista.");
      return;
    }
    if (tipoEntrevistador === "externo" && contactoSel === "") {
      setError("Elige un contacto del Cliente o «+ Otro entrevistador».");
      return;
    }
    if (tipoEntrevistador === "externo" && esOtro && (!entrevistadorNombre.trim() || !entrevistadorCorreo.trim())) {
      setError("Indica nombre y correo del entrevistador.");
      return;
    }
    if (modalidad === "Videollamada" && !porTeams && !liga.trim()) {
      setError("Falta la liga de la videollamada.");
      return;
    }
    if (modalidad === "Presencial" && !ubicacion.trim()) {
      setError("Falta la ubicación de la entrevista.");
      return;
    }
    setEnviando(true);
    setError("");
    const r = await programarEntrevistaHumana(c.id, {
      esIpv,
      clase: esIpv ? "reclutamiento" : clase,
      obligatoria: !esIpv && clase !== "reclutamiento" ? obligatoria : false,
      enviarFicha,
      compartir,
      tipoEntrevistador,
      entrevistadorUsuarioId: tipoEntrevistador === "interno" ? entrevistadorUsuarioId : null,
      entrevistadorContactoId: tipoEntrevistador === "externo" && typeof contactoSel === "number" ? contactoSel : null,
      usarTeams: porTeams,
      entrevistadorNombre: tipoEntrevistador === "externo" && esOtro ? entrevistadorNombre : "",
      entrevistadorCorreo: tipoEntrevistador === "externo" && esOtro ? entrevistadorCorreo : "",
      entrevistadorWhatsapp: tipoEntrevistador === "externo" && esOtro ? entrevistadorWhatsapp : "",
      fecha,
      hora,
      modalidad,
      liga: porTeams ? "" : liga,
      ubicacion,
      telefonoContacto,
      comentario,
      notificar: notificar.value,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onListo(r.data.candidato, r.data.resultados, r.data.advertencias);
  }

  const inputCls = "h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  /** 2026-09-18: nombre del entrevistador según lo capturado (interno del perfil, contacto del Cliente u «Otro»). */
  const nombreEntrevistadorActual =
    tipoEntrevistador === "interno"
      ? entrevistadores.find((e) => e.id === entrevistadorUsuarioId)?.nombre ?? ""
      : typeof contactoSel === "number"
        ? contactos?.find((k) => k.id === contactoSel)?.nombreCompleto ?? ""
        : entrevistadorNombre;
  /** Vista previa con el contexto REAL del candidato y del formulario; cambia en vivo con los inputs. */
  const datosPreview = {
    evento: "agendada" as const,
    candidato: c.nombre,
    entrevistador: nombreEntrevistadorActual,
    vacante: c.puesto || c.vacanteTitulo || "",
    empresa: c.empresaVisible || "",
    fecha,
    hora,
    modalidad,
    liga: modalidad === "Videollamada" ? (porTeams ? "" : liga) : "",
    ubicacion: modalidad === "Presencial" ? ubicacion : "",
    telefono: modalidad === "Llamada" ? telefonoContacto : "",
    telefonoCandidato: c.telefono,
    comentario,
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4">
      {/* 2026-09-18: más ancho, cuerpo con scroll propio y footer fijo — los botones nunca se pierden (web y móvil) */}
      <Card className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="shrink-0 border-b border-border-faint px-5 pt-5 pb-3">
          <h3 className="font-display text-lg font-bold">{esIpv ? "Agregar evaluación · Entrevista IPV (IPV humana)" : "Agregar evaluación · Entrevista humana"}</h3>
          {etapaAnterior ? (
            <p className="mt-1 text-[13px] font-medium leading-relaxed text-warn">
              {esIpv ? "Al programar esta IPV, el candidato se moverá a Filtro humano." : "Al programar esta entrevista, el candidato se moverá a Filtro humano."} Solo se mueve al guardar.
            </p>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">El candidato se queda en {nombreEtapa(c.etapa)}; la entrevista se agrega con su propia agenda y resultado.</p>
          )}
          {esIpv && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-human">
              <Sparkles className="h-3.5 w-3.5" /> Misma rúbrica de 6 competencias que Red Human; el entrevistador la captura desde su liga.
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="mt-4 flex flex-col gap-3">
          {!esIpv && (
            <div>
              <span className="text-sm font-medium text-ink-2">Tipo de entrevista</span>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([
                  ["reclutamiento", "Reclutamiento"],
                  ["encargado", "Con encargado de tienda"],
                  ["franquiciatario", "Con franquiciatario"],
                ] as const).map(([v, t]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setClase(v)}
                    className={`min-h-10 rounded-xl border px-2 text-sm font-medium transition ${clase === v ? "border-brand/25 bg-brand-soft text-brand" : "border-border-soft text-ink-2"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {clase !== "reclutamiento" && (
                <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" checked={obligatoria} onChange={(e) => setObligatoria(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
                  Obligatoria para avanzar (si no, es adicional y no bloquea ni reemplaza la entrevista inicial)
                </label>
              )}
            </div>
          )}
          {/* §12: ficha del candidato para el entrevistador (respeta su acceso: sin datos de contacto, médico ni socioeconómico) */}
          <div className="rounded-xl border border-border-soft bg-surface-2/50 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-2">Información a compartir</span>
            <a
              href={urlFichaPresentacion(c.id, { siguienteAccion: `${esIpv ? "Entrevista IPV" : "Entrevista"} ${fecha ? `el ${fecha} ${hora}` : ""}`.trim() })}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              Ver ficha
            </a>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                ["ficha", "Solo ficha", "Ficha del candidato + formulario de evaluación. El expediente no se puede consultar."],
                ["ficha_expediente", "Ficha + expediente", "Además «Ver expediente»: CV, documentos, respuestas y evaluaciones previas."],
              ] as const).map(([v, t, d]) => (
                <button key={v} type="button" onClick={() => setCompartir(v)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${compartir === v ? "border-brand/40 bg-brand-soft" : "border-border-soft hover:border-brand/30"}`}>
                  <span className={`block text-sm font-semibold ${compartir === v ? "text-brand" : "text-ink"}`}>{t}</span>
                  <span className="block text-[11px] leading-snug text-ink-3">{d}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-3">El correo lleva los datos de la entrevista, la ficha en PDF y el botón «Abrir ficha y evaluar».</p>
          </div>
          <div>
            <span className="text-sm font-medium text-ink-2">Entrevistador</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipoEntrevistador("interno")}
                className={`h-10 rounded-xl border text-sm font-medium transition ${
                  tipoEntrevistador === "interno" ? "border-brand/25 bg-brand-soft text-brand" : "border-border-soft text-ink-2"
                }`}
              >
                Interno
              </button>
              <button
                type="button"
                onClick={() => setTipoEntrevistador("externo")}
                className={`h-10 rounded-xl border text-sm font-medium transition ${
                  tipoEntrevistador === "externo" ? "border-brand/25 bg-brand-soft text-brand" : "border-border-soft text-ink-2"
                }`}
              >
                Externo
              </button>
            </div>
          </div>

          {tipoEntrevistador === "interno" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Entrevistador interno</span>
              <select value={entrevistadorUsuarioId ?? ""} onChange={(e) => setEntrevistadorUsuarioId(Number(e.target.value))} className={inputCls}>
                {entrevistadores.length === 0 && <option value="">Sin entrevistadores activos</option>}
                {entrevistadores.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
              {/* Fase 7A: correo y WhatsApp vienen del perfil (Configuración → Usuarios); nunca se capturan aquí */}
              {internoSel && (
                <span className="text-[12px] leading-relaxed text-ink-3">
                  Se notificará a {internoSel.correo}
                  {internoSel.telefono ? ` · ${CANAL} ${internoSel.telefono}` : ` · sin ${CANAL} en su perfil (agrégalo en Configuración → Usuarios)`}
                </span>
              )}
            </label>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Entrevistador externo</span>
                <select
                  value={contactoSel}
                  onChange={(e) => setContactoSel(e.target.value === OTRO ? OTRO : e.target.value === "" ? "" : Number(e.target.value))}
                  className={inputCls}
                >
                  {contactos === null ? (
                    <option value="">Cargando contactos del Cliente…</option>
                  ) : (
                    <>
                      {contactos.length > 0 && <option value="">Elige un contacto{c.clienteVacante ? ` de ${c.clienteVacante}` : ""}…</option>}
                      {contactos.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.nombre} {k.apellidos ?? ""}
                          {k.puesto ? ` — ${k.puesto}` : ""}
                        </option>
                      ))}
                      <option value={OTRO}>+ Otro entrevistador</option>
                    </>
                  )}
                </select>
                {contactoElegido && (
                  <span className="text-[12px] leading-relaxed text-ink-3">
                    Se notificará a {contactoElegido.correo || "(sin correo registrado)"}
                    {contactoElegido.telefono ? ` · ${CANAL} ${contactoElegido.telefono}` : ""}
                  </span>
                )}
                {contactos !== null && contactos.length === 0 && (
                  <span className="text-[12px] leading-relaxed text-ink-3">
                    {clienteId ? "El Cliente de la vacante no tiene contactos registrados." : "La vacante no tiene Cliente asociado."} Captura al entrevistador aquí.
                  </span>
                )}
              </label>
              {esOtro && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Nombre</span>
                    <input value={entrevistadorNombre} onChange={(e) => setEntrevistadorNombre(e.target.value)} placeholder="Nombre completo" className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Correo</span>
                    <input type="email" value={entrevistadorCorreo} onChange={(e) => setEntrevistadorCorreo(e.target.value)} placeholder="correo@empresa.com" className={inputCls} />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-2">{CANAL} (opcional)</span>
                    <input value={entrevistadorWhatsapp} onChange={(e) => setEntrevistadorWhatsapp(e.target.value)} placeholder="10 dígitos" className={inputCls} />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Fecha</span>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Hora</span>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inputCls} />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Modalidad</span>
            <select value={modalidad} onChange={(e) => setModalidad(e.target.value as ModalidadEntrevistaHumana)} className={inputCls}>
              {MODALIDADES_ENTREVISTA_HUMANA.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {modalidad === "Videollamada" && porTeams && (
            <div className="rounded-xl border border-brand/25 bg-brand-soft/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">Reunión de Microsoft Teams automática.</span> Al programar se crea la reunión, la liga va en el
              correo y {CANAL} de confirmación y se manda la invitación de calendario a candidato y entrevistador.
              <button type="button" onClick={() => setOtraLiga(true)} className="ml-1.5 font-medium text-brand hover:underline">
                Usar otra liga
              </button>
            </div>
          )}
          {modalidad === "Videollamada" && !porTeams && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Liga de la videollamada</span>
              <input value={liga} onChange={(e) => setLiga(e.target.value)} placeholder="https://meet.google.com/…" className={inputCls} />
              {teamsConectado && otraLiga && (
                <button type="button" onClick={() => setOtraLiga(false)} className="self-start text-[12px] font-medium text-brand hover:underline">
                  ← Volver a usar Teams
                </button>
              )}
            </label>
          )}
          {modalidad === "Presencial" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Ubicación / instrucciones</span>
              <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Dirección o cómo llegar" className={inputCls} />
            </label>
          )}
          {modalidad === "Llamada" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Teléfono de contacto (opcional)</span>
              <input
                value={telefonoContacto}
                onChange={(e) => setTelefonoContacto(e.target.value)}
                placeholder={c.telefono || "Si lo dejas vacío, se usa el teléfono del candidato"}
                className={inputCls}
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Comentario (opcional)</span>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={2}
              className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        )}

        <LineaNotificar className="mt-4" value={notificar.value} onChange={notificar.setValue} hayCliente={Boolean(clienteId)} clienteId={clienteId} />
        </div>

        {/* Footer sticky: siempre visible */}
        <div className="shrink-0 border-t border-border-soft bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreview("entrevistador")} disabled={enviando} title="Previsualiza el HTML exacto que recibirán el entrevistador y el candidato">
              <Mail className="h-4 w-4" /> Ver cuerpo del correo
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={enviando}>
                Cancelar
              </Button>
              <Button onClick={programar} disabled={enviando}>
                {enviando ? "Programando…" : "Programar entrevista"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {preview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => setPreview(null)}>
          <Card className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 sm:h-[90vh] sm:max-w-3xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-soft px-4 py-3">
              <div className="scroll-x gap-1 rounded-xl border border-border-soft bg-surface-2/60 p-1">
                {(["entrevistador", "candidato"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPreview(k)}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition", preview === k ? "bg-brand text-white" : "text-ink-2 hover:text-ink")}
                  >
                    {k === "entrevistador" ? "Correo al entrevistador" : "Correo al candidato"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-ink-3 sm:inline">
                  Correo real para {c.nombre.split(" ")[0]} · {modalidad}{fecha ? ` · ${fecha}${hora ? ` ${hora}` : ""}` : " · sin fecha aún"}
                </span>
                <a href={urlPreviewCorreo(preview, datosPreview)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">Abrir en pestaña</a>
                <button onClick={() => setPreview(null)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
              </div>
            </div>
            {/* key = URL: al cambiar fecha/hora/modalidad/liga en el formulario el iframe se vuelve a cargar con los datos precisos */}
            <iframe key={urlPreviewCorreo(preview, datosPreview)} title={`Vista previa · ${preview}`} src={urlPreviewCorreo(preview, datosPreview)} className="min-h-0 w-full flex-1 bg-white" />
          </Card>
        </div>
      )}
    </div>
  );
}


/* ============================================================
   Modal "Modificar" — Fase D, evento "entrevista_modificada"
   ============================================================ */
function ModalModificarEntrevista({
  c,
  eh,
  onClose,
  onListo,
}: {
  c: Candidato;
  eh: EntrevistaHumana;
  onClose: () => void;
  onListo: (c: Candidato) => void;
}) {
  const fechaInicial = eh.fecha ? new Date(eh.fecha) : null;
  // 2026-10-04: fecha LOCAL (toISOString daba el día en UTC: una cita en la tarde-noche aparecía al día siguiente)
  const [fecha, setFecha] = useState(fechaInicial ? `${fechaInicial.getFullYear()}-${String(fechaInicial.getMonth() + 1).padStart(2, "0")}-${String(fechaInicial.getDate()).padStart(2, "0")}` : "");
  const [hora, setHora] = useState(fechaInicial ? fechaInicial.toTimeString().slice(0, 5) : "");
  const [modalidad, setModalidad] = useState<ModalidadEntrevistaHumana>((eh.modalidad || "Videollamada") as ModalidadEntrevistaHumana);
  const [liga, setLiga] = useState(eh.liga || "");
  const [ubicacion, setUbicacion] = useState(eh.ubicacion || "");
  const [telefonoContacto, setTelefonoContacto] = useState(eh.telefonoContacto || "");
  const [comentario, setComentario] = useState(eh.comentario || "");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const notificar = useNotificarAccion("entrevista_modificada");

  async function guardar() {
    if (!fecha || !hora) {
      setError("Completa fecha y hora.");
      return;
    }
    if (modalidad === "Videollamada" && !eh.porTeams && !liga.trim()) {
      setError("Falta la liga de la videollamada.");
      return;
    }
    if (modalidad === "Presencial" && !ubicacion.trim()) {
      setError("Falta la ubicación de la entrevista.");
      return;
    }
    setEnviando(true);
    setError("");
    const r = await modificarEntrevistaHumana(c.id, { fecha, hora, modalidad, liga, ubicacion, telefonoContacto, comentario, notificar: notificar.value, entrevistaId: eh.id });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onListo(r.data);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md p-5">
        <h3 className="font-display text-lg font-bold">Reprogramar entrevista{eh.claseNombre && eh.clase !== "reclutamiento" ? ` · ${eh.claseNombre}` : ""}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Con {c.nombre.split(" ")[0]}. Al guardar se avisa por defecto al candidato y al entrevistador con la nueva fecha, hora, modalidad,
          ubicación o liga e instrucciones; el recordatorio anterior se cancela y se programa el de la nueva cita. Abajo puedes ajustar a quién se avisa solo por esta vez.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Fecha</span>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Hora</span>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Modalidad</span>
            <select
              value={modalidad}
              onChange={(e) => setModalidad(e.target.value as ModalidadEntrevistaHumana)}
              className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {MODALIDADES_ENTREVISTA_HUMANA.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {modalidad === "Videollamada" && eh.porTeams && (
            <p className="rounded-xl border border-brand/25 bg-brand-soft/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">Reunión de Microsoft Teams.</span> La liga se conserva y la reunión de calendario se actualiza con la nueva fecha y hora.
            </p>
          )}
          {modalidad === "Videollamada" && !eh.porTeams && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Liga de la videollamada</span>
              <input
                value={liga}
                onChange={(e) => setLiga(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
          )}
          {modalidad === "Presencial" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Ubicación / instrucciones</span>
              <input
                value={ubicacion}
                onChange={(e) => setUbicacion(e.target.value)}
                placeholder="Dirección o cómo llegar"
                className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
          )}
          {modalidad === "Llamada" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Teléfono de contacto (opcional)</span>
              <input
                value={telefonoContacto}
                onChange={(e) => setTelefonoContacto(e.target.value)}
                placeholder={c.telefono || "Si lo dejas vacío, se usa el teléfono del candidato"}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Comentario (opcional)</span>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={2}
              className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        )}

        <LineaNotificar className="mt-4" value={notificar.value} onChange={notificar.setValue} hayCliente={Boolean(c.clienteVacante)} clienteId={c.clienteIdVacante ?? null} />

        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={enviando}>
            Cerrar
          </Button>
          <Button className="flex-1" onClick={guardar} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Etapa: Contratación — condiciones finales + expediente (6 documentos)
   ============================================================ */
function CampoTexto({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

function CampoSelect({
  label,
  value,
  onChange,
  opciones,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opciones: string[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      >
        <option value="">Selecciona…</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Fila de documento: Pendiente -> Subir documento -> Cargado -> Ver. */
function FilaDocumentoSimple({
  d,
  expedienteId,
  live,
  onActualizado,
}: {
  d: DocExpediente;
  expedienteId?: number;
  live: boolean;
  onActualizado: (e: NuevoIngreso) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const cargado = Boolean(d.tieneArchivo);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !expedienteId) return;
    setSubiendo(true);
    const r = await subirDocumento(expedienteId, d.nombre, file);
    setSubiendo(false);
    if (r.ok) onActualizado(r.data.expediente);
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border-soft bg-surface px-3.5 py-2.5">
      <span className="min-w-0 truncate text-sm">{d.nombre}</span>
      <div className="flex shrink-0 items-center gap-2">
        {d.estadoOnboarding ? (
          <Badge tone={d.estadoOnboarding === "Aprobado" ? "good" : d.estadoOnboarding === "Rechazado" ? "bad" : d.estadoOnboarding === "Por revisar" ? "warn" : "neutral"}>
            {d.estadoOnboarding}
          </Badge>
        ) : (
          <Badge tone={cargado ? "good" : "neutral"}>{cargado ? "Cargado" : "Pendiente"}</Badge>
        )}
        {cargado && expedienteId ? (
          <a
            href={urlDocumento(expedienteId, d.nombre)}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-brand hover:underline"
          >
            Ver
          </a>
        ) : live && expedienteId ? (
          <>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={subiendo}
              className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
            >
              {subiendo ? "Subiendo…" : "Subir documento"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PanelContratacion({
  c,
  live,
  onCambio,
  setAviso,
  onDocumentos,
  onDescartar,
  accionesExtra,
  autoIniciarOnboarding = false,
  onAutoIniciado,
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
  setAviso: (a: AvisoEstado) => void;
  /** 2026-09-15: abre la confirmación «Solicitar documentos» / «Enviar recordatorio» del modal
   * (plantilla de WhatsApp; el candidato responde mandando el archivo por el mismo chat). */
  onDocumentos?: (que: "solicitar" | "recordatorio") => void;
  /** 2026-09-17: «Descartar candidato…» también desde Contratación/Onboarding (menú «…»). */
  onDescartar?: () => void;
  /** Fraiche: acciones del modal que también deben verse aquí («Mover en la ruta…», ficha, mover etapa). */
  accionesExtra?: { etiqueta: string; icono: React.ReactNode; onClick: () => void; disabled?: boolean }[];
  /** 2026-10-02 (§11): el botón principal de la ficha («Pasar a Onboarding») abre aquí el resumen de Iniciar Onboarding. */
  autoIniciarOnboarding?: boolean;
  onAutoIniciado?: () => void;
}) {
  const modoPrueba = useModoPrueba();
  const cond = c.expedienteCondiciones;
  // Fraiche (spec §12): en franquicia no hay documentación, socioeconómico, kit ni alta SAP de Fraiche
  const esFranquicia = c.destino === "franquicia";
  // Fraiche (spec §11): «Preparar alta de colaborador» (datos para SAP SuccessFactors) y su estado
  const [sapAbierto, setSapAbierto] = useState(false);
  const [estadoSap, setEstadoSap] = useState<{ estado: DatosAltaSap["estadoSap"]; texto: string; confirmadoPor: string; confirmadoEn: string | null } | null>(null);
  useEffect(() => {
    if (!live || c.expedienteId == null || esFranquicia) return;
    let vivo = true;
    fetchDatosAltaSap(c.expedienteId).then((d) => {
      if (vivo && d) setEstadoSap({ estado: d.estadoSap, texto: d.estadoSapTexto, confirmadoPor: d.confirmadoPor, confirmadoEn: d.confirmadoEn });
    });
    return () => {
      vivo = false;
    };
  }, [live, c.expedienteId, esFranquicia]);
  const [puesto, setPuesto] = useState(cond?.puesto ?? c.puesto ?? "");
  const [sueldo, setSueldo] = useState(cond?.sueldo ?? "");
  const [tipo, setTipo] = useState(cond?.tipoContratacion ?? "");
  const [fechaIngreso, setFechaIngreso] = useState(cond?.fechaIngreso ? cond.fechaIngreso.slice(0, 10) : "");
  const [ubicacion, setUbicacion] = useState(cond?.ubicacion ?? "");
  const [jefe, setJefe] = useState(cond?.jefeDirecto ?? "");
  const [instrucciones, setInstrucciones] = useState(cond?.instruccionesIngreso ?? "");
  const [empresa, setEmpresa] = useState(cond?.empresa ?? "");
  // B2: Select de razones sociales de la Cuenta (predeterminada = la de la Cuenta); nunca texto libre
  const [razones, setRazones] = useState<RazonSocial[]>([]);
  const [duracion, setDuracion] = useState<string>(cond?.duracionContrato ? String(cond.duracionContrato) : "");
  const [unidad, setUnidad] = useState<string>(cond?.duracionUnidad || "meses");
  const esDeterminado = tipo === "Tiempo determinado";
  const fechaTerminoPreview = esDeterminado ? fechaTerminoLocal(fechaIngreso, Number(duracion), unidad) : "";
  useEffect(() => {
    let vivo = true;
    fetchRazonesSociales().then((lista) => {
      if (!vivo || !lista) return;
      setRazones(lista);
      // precarga la razón social de la Cuenta si el expediente aún no tiene una válida
      setEmpresa((actual) => (actual && lista.some((x) => x.razonSocial === actual) ? actual : lista.find((x) => x.predeterminada)?.razonSocial ?? lista[0]?.razonSocial ?? ""));
    });
    return () => {
      vivo = false;
    };
  }, []);
  const [guardando, setGuardando] = useState(false);
  // 2026-09-19 (Bloque 3): vista previa en la misma pantalla de carta / contrato con 3 acciones
  const [docPreview, setDocPreview] = useState<null | "carta" | "contrato">(null);
  // 2026-09-29: firma electrónica incrustada (Dropbox Sign). Sin llaves en el servidor → vista previa del PDF como antes.
  const [firmaCfg, setFirmaCfg] = useState<{ configurado: boolean; clientId: string | null; testMode: boolean } | null>(null);
  const [firmas, setFirmas] = useState<FirmaDocumento[]>([]);
  const [firmando, setFirmando] = useState<"" | "carta" | "contrato">("");
  const [enviandoDoc, setEnviandoDoc] = useState<"" | "whatsapp" | "correo">("");
  const [resultadoDoc, setResultadoDoc] = useState<{ ok: boolean; texto: string } | null>(null);
  const condicionesListas = Boolean(cond?.completas);
  // Onboarding v2 (Fase 2): «Enviar a Onboarding» exige condiciones + consentimiento de privacidad (salvo Modo Prueba)
  const requisitosOnboarding = condicionesListas && Boolean(c.consentimiento);
  const [iniciarAbierto, setIniciarAbierto] = useState(false);
  const documentosListos = (c.expedienteProgreso ?? 0) >= 100;
  void documentosListos;
  const [expediente, setExpediente] = useState<NuevoIngreso | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [ocupado, setOcupado] = useState("");

  const firmaRef = useRef("");
  const cargarExpediente = useCallback(async () => {
    if (!c.expedienteId) return;
    const e = await fetchExpediente(c.expedienteId);
    if (!e) return;
    setExpediente(e);
    // 2026-09-18 (tiempo real): si cambió algún documento (el candidato subió desde su liga/WhatsApp),
    // se refresca también la ficha (progreso, alta, avisos) sin recargar la página.
    const firma = JSON.stringify((e.documentos ?? []).map((d) => [d.nombre, d.estado]));
    if (firmaRef.current && firma !== firmaRef.current) {
      const ficha = await fetchCandidato(c.id);
      if (ficha) onCambio(ficha);
    }
    firmaRef.current = firma;
  }, [c.expedienteId, c.id, onCambio]);

  useEffect(() => {
    void cargarExpediente();
  }, [cargarExpediente]);
  usePolling(cargarExpediente, 20000);

  // 2026-09-29 (red de seguridad): postulación en Contratación/Onboarding sin expediente (p. ej. carga masiva) →
  // se abre en ese momento para ESA postulación (el backend exige consentimiento y es idempotente).
  const asegurando = useRef(false);
  useEffect(() => {
    if (!live || c.expedienteId != null || asegurando.current) return;
    if (c.etapa !== "Contratación" && c.etapa !== "Onboarding") return;
    asegurando.current = true;
    asegurarExpediente(c.id).then((r) => {
      if (r.ok) onCambio(r.data);
      else setAviso({ tono: "error", texto: r.error });
    });
  }, [live, c.expedienteId, c.etapa, c.id, onCambio, setAviso]);

  const cargarFirmas = useCallback(async () => {
    if (c.expedienteId == null) return;
    setFirmas((await fetchFirmasExpediente(c.expedienteId)) ?? []);
  }, [c.expedienteId]);
  useEffect(() => {
    fetchEstadoFirmas().then((x) => setFirmaCfg(x ?? { configurado: false, clientId: null, testMode: false }));
    void cargarFirmas();
  }, [cargarFirmas]);

  /** «Generar carta de intención» / «Generar contrato»: con Dropbox Sign configurado crea la solicitud y abre el modal
   * de firma incrustado (RH firma aquí; el candidato, en su liga de expediente). Sin él, vista previa del PDF. */
  async function firmarOVer(doc: "carta" | "contrato") {
    setResultadoDoc(null);
    if (!firmaCfg?.configurado || !firmaCfg.clientId || c.expedienteId == null) return setDocPreview(doc);
    setFirmando(doc);
    const r = await crearFirmaDocumento(c.expedienteId, doc);
    setFirmando("");
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return;
    }
    void cargarFirmas();
    if (!r.data.signUrl) {
      setAviso({ tono: "ok", texto: `${r.data.documentoTexto}: tu firma ya está registrada; falta la del candidato (la hace desde su liga de expediente).` });
      return;
    }
    await abrirFirmaEmbebida({
      clientId: firmaCfg.clientId,
      signUrl: r.data.signUrl,
      testMode: firmaCfg.testMode,
      onFirmado: () => {
        setAviso({ tono: "ok", texto: `${r.data.documentoTexto} firmada por ti. El candidato la firma desde su liga de expediente; el PDF final se guarda solo en el expediente.` });
        setTimeout(() => void cargarFirmas(), 1500);
      },
      onError: (m) => setAviso({ tono: "error", texto: `Firma electrónica: ${m}` }),
    });
  }

  async function guardar() {
    if (esDeterminado && (!duracion || Number(duracion) <= 0)) return setAviso({ tono: "error", texto: "Tiempo determinado: captura la duración del contrato (número mayor a cero)." });
    setGuardando(true);
    const r = await guardarCondicionesContratacion(c.id, {
      puesto,
      sueldo,
      tipoContratacion: tipo,
      fechaIngreso: fechaIngreso || undefined,
      ubicacion,
      jefeDirecto: jefe,
      instruccionesIngreso: instrucciones,
      empresa,
      duracionContrato: esDeterminado ? Number(duracion) : null,
      duracionUnidad: esDeterminado ? unidad : "",
    });
    setGuardando(false);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: "Condiciones guardadas. Ya puedes generar la carta, solicitar documentos y preparar el contrato." });
    onCambio(r.data);
  }

  /** WhatsApp / Correo de la carta: trazabilidad en bitácora, aviso mínimo en pantalla. */
  async function enviarCarta(canal: "whatsapp" | "correo") {
    if (!c.expedienteId) return;
    setEnviandoDoc(canal);
    setResultadoDoc(null);
    const r = await enviarCartaIntencion(c.expedienteId, canal);
    setEnviandoDoc("");
    if (!r.ok) return setResultadoDoc({ ok: false, texto: r.error });
    setResultadoDoc({ ok: r.data.enviado, texto: r.data.enviado ? `Carta enviada por ${canal === "whatsapp" ? CANAL : "correo"}.` : `No salió por ${canal}: ${r.data.detalle}` });
  }

  /** Onboarding v2 (Fase 2): abre el resumen; «Iniciar Onboarding» es el único gatillo del cambio de etapa. */
  function enviarOnboarding() {
    setIniciarAbierto(true);
  }
  useEffect(() => {
    if (autoIniciarOnboarding && c.expedienteId != null && c.etapa === "Contratación") {
      setIniciarAbierto(true);
      onAutoIniciado?.();
    }
  }, [autoIniciarOnboarding, c.expedienteId, c.etapa, onAutoIniciado]);
  // 2026-10-02 (Fraiche §13): el contrato se genera en Contratación Y en Onboarding con las MISMAS condiciones
  // guardadas; si falta algo se dice exactamente qué. Los documentos pendientes no lo bloquean.
  const faltanContrato = expediente?.contratoFaltan ?? (condicionesListas ? [] : ["guardar las condiciones de contratación"]);
  const contratoListo = faltanContrato.length === 0 || modoPrueba;
  async function enviarContratoA(canal: "whatsapp" | "correo") {
    if (!c.expedienteId) return;
    setEnviandoDoc(canal);
    setResultadoDoc(null);
    const r = await enviarContrato(c.expedienteId, canal);
    setEnviandoDoc("");
    if (!r.ok) return setResultadoDoc({ ok: false, texto: r.error });
    setResultadoDoc({ ok: r.data.enviado, texto: r.data.enviado ? `Contrato enviado por ${canal === "whatsapp" ? CANAL : "correo"}.` : `No salió por ${canal}: ${r.data.detalle}` });
  }

  async function confirmarCancelacion() {
    if (!c.expedienteId || !motivoCancelar.trim()) return;
    setOcupado("cancelar");
    const r = await cancelarExpediente(c.expedienteId, motivoCancelar.trim());
    if (!r.ok) {
      setOcupado("");
      return setAviso({ tono: "error", texto: r.error });
    }
    const actualizado = await fetchCandidato(c.id);
    setOcupado("");
    setCancelando(false);
    if (actualizado) onCambio(actualizado);
    setAviso({ tono: "ok", texto: "Contratación cancelada; el candidato regresó a Entrevista Humana." });
  }

  return (
    <Card className="border-warn/25 bg-warn-soft/10 p-4">
      <Eyebrow>Condiciones de contratación</Eyebrow>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <CampoTexto label="Puesto" value={puesto} onChange={setPuesto} />
        <CampoTexto label="Sueldo" value={sueldo} onChange={setSueldo} placeholder="$14,000 mensuales" />
        <CampoSelect label="Tipo de contratación" value={tipo} onChange={setTipo} opciones={TIPOS_CONTRATACION} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Fecha de ingreso</span>
          <input
            type="date"
            value={fechaIngreso}
            onChange={(e) => setFechaIngreso(e.target.value)}
            className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        {esDeterminado && (
          <>
            {/* B2: duración (número + unidad) → fecha de término calculada, nunca capturada */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Duración del contrato</span>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={duracion}
                  onChange={(e) => setDuracion(e.target.value)}
                  placeholder="3"
                  className="h-10 w-24 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <select
                  value={unidad}
                  onChange={(e) => setUnidad(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  {UNIDADES_DURACION.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Fecha de término</span>
              <input
                type="date"
                value={fechaTerminoPreview || (cond?.fechaTermino ? cond.fechaTermino.slice(0, 10) : "")}
                readOnly
                disabled
                title="Se calcula automáticamente: fecha de ingreso + duración"
                className="h-10 rounded-xl border border-border-soft bg-surface-2 px-3 text-sm text-ink-2 outline-none"
              />
              <span className="text-[11px] text-ink-3">Calculada: fecha de ingreso + duración.</span>
            </label>
          </>
        )}
        <CampoTexto label="Ubicación" value={ubicacion} onChange={setUbicacion} />
        <CampoTexto label="Jefe directo" value={jefe} onChange={setJefe} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Empresa contratante</span>
          <select
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            {razones.length === 0 && <option value={empresa}>{empresa || "Cargando razones sociales…"}</option>}
            {razones.map((r) => (
              <option key={`${r.origen}-${r.clienteId ?? 0}`} value={r.razonSocial}>
                {r.razonSocial}{r.origen === "cuenta" ? " (Cuenta)" : " (Cliente)"}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-ink-3">Solo razones sociales configuradas en la Cuenta (Configuración → Cuenta / Clientes).</span>
        </label>
        {/* Fase 5: se mandan por WhatsApp/correo automáticamente al dar de alta (evento instrucciones_ingreso) */}
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-ink-2">Instrucciones de ingreso (primer día)</span>
          <textarea
            value={instrucciones}
            onChange={(e) => setInstrucciones(e.target.value)}
            rows={3}
            placeholder="Ej. Preséntate el lunes a las 9:00 en recepción con INE y comprobante de domicilio; pregunta por Laura de RH."
            className="rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <span className="text-[11px] text-ink-3">Al dar de alta, el colaborador recibe automáticamente su bienvenida con estos datos por {CANAL} y correo.</span>
        </label>
      </div>
      {live && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : condicionesListas ? "Guardar cambios" : "Guardar condiciones"}
          </Button>
          <span className="text-[12px] text-ink-3">
            {condicionesListas ? `Condiciones guardadas${cond?.guardadasEn ? ` el ${new Date(cond.guardadasEn).toLocaleDateString("es-MX")}` : ""}.` : "Captura puesto, sueldo, tipo y fecha de ingreso y guarda para habilitar los documentos."}
          </span>
        </div>
      )}

      {/* 2026-09-19 (Bloque 3): flujo lineal — con condiciones guardadas aparecen aquí mismo las acciones */}
      {live && condicionesListas && c.expedienteId != null && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border-soft bg-surface p-3">
          <Button size="sm" variant="outline" onClick={() => void firmarOVer("carta")} disabled={firmando !== ""}
            title={firmaCfg?.configurado ? "Se firma aquí mismo (firma electrónica); el candidato firma desde su liga" : "Vista previa del PDF"}>
            <FileText className="h-4 w-4" /> {firmando === "carta" ? "Preparando firma…" : "Generar carta de intención"}
          </Button>
          {/* Onboarding v2: «Solicitar documentos» ya no vive en Contratación — la primera solicitud la hace «Iniciar Onboarding» */}
          {onDocumentos && c.etapa === "Onboarding" && !esFranquicia && (
            <Button size="sm" variant="outline" onClick={() => onDocumentos("solicitar")} disabled={Boolean(ocupado)}>
              <Send className="h-4 w-4" /> Solicitar documentos
            </Button>
          )}
          {!esFranquicia && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => (expediente?.contratoFirmado ? setDocPreview("contrato") : void firmarOVer("contrato"))}
            disabled={!contratoListo || firmando !== ""}
            title={contratoListo ? "Contrato con las condiciones guardadas: vista previa, descarga y envío (el firmado se conserva en el expediente)" : `Para el contrato falta: ${faltanContrato.join(", ")}`}
          >
            <FileCheck2 className="h-4 w-4" /> {firmando === "contrato" ? "Preparando firma…" : expediente?.contratoFirmado ? "Contrato firmado ✓ · Ver" : firmaCfg?.configurado ? "Generar contrato" : "Generar contrato (borrador)"}
          </Button>
          )}
          {firmaCfg?.configurado && (
            <MenuAcciones
              acciones={[
                { etiqueta: `Ver PDF de la carta (enviar por ${CANAL} / correo)`, icono: <FileText className="h-4 w-4" />, onClick: () => { setResultadoDoc(null); setDocPreview("carta"); } },
                { etiqueta: `Ver PDF del contrato (enviar por ${CANAL} / correo)`, icono: <FileCheck2 className="h-4 w-4" />, onClick: () => { setResultadoDoc(null); setDocPreview("contrato"); }, disabled: !contratoListo },
              ]}
            />
          )}
          {c.etapa === "Contratación" && !esFranquicia && (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => enviarOnboarding()}
              disabled={Boolean(ocupado) || (!requisitosOnboarding && !modoPrueba)}
              title={
                requisitosOnboarding || modoPrueba
                  ? "Revisa el resumen e inicia el Onboarding (única forma de pasar a Onboarding)"
                  : `Falta: ${[!condicionesListas && "condiciones (puesto, sueldo, tipo y fecha de ingreso)", !c.consentimiento && "consentimiento de privacidad"].filter(Boolean).join(" y ")}`
              }
            >
              Enviar a Onboarding
            </Button>
          )}
        </div>
      )}

      {live && condicionesListas && !esFranquicia && !contratoListo && (
        <p className="mt-2 text-[12px] text-warn">Para generar el contrato falta: {faltanContrato.join(", ")}. Complétalo arriba en «Condiciones de contratación» y guarda.</p>
      )}
      {live && !condicionesListas && !esFranquicia && (
        <p className="mt-2 text-[12px] text-ink-3">El contrato se genera aquí (o en Onboarding) en cuanto guardes puesto, sueldo, tipo y fecha de ingreso.</p>
      )}

      {firmas.length > 0 && (
        <div className="mt-3 rounded-xl border border-border-soft bg-surface p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2"><IconoFirma className="h-3.5 w-3.5" /> Firma electrónica</p>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {firmas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-2">
                  {f.documentoTexto}{f.testMode ? " (prueba)" : ""} · {f.firmantes.map((x) => `${x.rol === "rh" ? "RH" : "Candidato"}: ${x.estado === "firmado" ? "firmó" : "pendiente"}`).join(" · ")}
                </span>
                <Badge tone={f.estado === "descargada" ? "good" : f.estado === "cancelada" ? "neutral" : f.estado === "firmada" ? "brand" : "warn"}>
                  {f.estado === "descargada" ? "Firmada · PDF en el expediente" : f.estado === "firmada" ? "Firmada · descargando PDF" : f.estado === "cancelada" ? "Cancelada" : "En firma"}
                </Badge>
              </li>
            ))}
          </ul>
          {firmas.some((f) => f.estado === "enviada" && f.firmantes.some((x) => x.rol === "candidato" && x.estado !== "firmado")) && (
            <p className="mt-2 text-[11px] text-ink-3">El candidato firma desde su liga de expediente (compártela con «Ver PDF de la carta» → {CANAL} o correo).</p>
          )}
        </div>
      )}

      {esFranquicia && (
        <Aviso tono="info">Ruta de franquicia: sin documentación, socioeconómico, kit ni alta SAP de Fraiche. La contratación la realiza el franquiciatario.</Aviso>
      )}

      {/* Fraiche (spec §11): datos para el alta en SAP SuccessFactors — solo tienda propia; nunca se afirma que el alta ya ocurrió */}
      {live && !esFranquicia && c.expedienteId != null && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-soft bg-surface p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2"><Database className="h-3.5 w-3.5" /> Alta en SAP SuccessFactors</p>
            <p className="text-[11px] text-ink-3">
              {estadoSap?.estado === "listo_para_enviar_sap"
                ? `${estadoSap.texto || "Listo para enviar a SAP"}${estadoSap.confirmadoPor ? ` · confirmado por ${estadoSap.confirmadoPor}` : ""} · Conexión con SAP pendiente de configurar`
                : estadoSap?.texto || "Revisa y confirma los datos que se enviarán a SAP (no se envía nada todavía)."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {estadoSap?.estado === "listo_para_enviar_sap" && <Badge tone="good">Listo para enviar a SAP</Badge>}
            <Button size="sm" variant={estadoSap?.estado === "listo_para_enviar_sap" ? "outline" : "primary"} onClick={() => setSapAbierto(true)} disabled={Boolean(ocupado)}>
              <Database className="h-4 w-4" /> Preparar alta de colaborador
            </Button>
          </div>
        </div>
      )}

      {live && c.etapa === "Contratación" && !requisitosOnboarding && !esFranquicia && (
        <p className="mt-3 text-[12px] text-ink-3">
          Para enviar a Onboarding: {[!condicionesListas && "guarda puesto, sueldo, tipo y fecha de ingreso", !c.consentimiento && "registra el consentimiento de privacidad (LFPDPPP)"].filter(Boolean).join(" y ")}.
          {modoPrueba ? " (Modo Prueba activo: puedes enviarlo de todos modos.)" : ""}
        </p>
      )}

      {c.etapa === "Onboarding" && c.expedienteId != null && (
        <div className="mt-5 border-t border-border-faint pt-4">
          <Eyebrow>Tareas de Onboarding</Eyebrow>
          <div className="mt-3">
            <PanelTareasOnboarding expedienteId={c.expedienteId} live={live} onCambio={() => void cargarExpediente()} />
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-border-faint pt-4">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Expediente · {c.expedienteProgreso ?? 0}% aprobado</Eyebrow>
          <div className="w-32">
            <Progress value={c.expedienteProgreso ?? 0} tone="good" />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {(expediente?.documentos ?? []).filter((d) => !d.interno).map((d) => (
            <FilaDocumentoSimple
              key={d.nombre}
              d={d}
              expedienteId={c.expedienteId ?? undefined}
              live={live}
              onActualizado={setExpediente}
            />
          ))}
        </div>
      </div>

      {live && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border-faint pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelando(true)}
            disabled={Boolean(ocupado)}
            className="border-bad/30 text-bad hover:bg-bad-soft"
          >
            Cancelar contratación
          </Button>
          {c.expedienteId != null && onDocumentos && !esFranquicia && (
            <Button size="sm" variant="outline" onClick={() => onDocumentos("recordatorio")} disabled={Boolean(ocupado)} title={etiquetaRecordatorio(c.recordatorioNivel, c.recordatoriosEnviados).tono.descripcion}>
              <RotateCw className="h-4 w-4" /> {etiquetaRecordatorio(c.recordatorioNivel, c.recordatoriosEnviados).texto}
            </Button>
          )}
          {/* 2026-10-02 (§3): «Más acciones» (agregar evaluación, movimiento excepcional, ficha, descartar) vive en la barra fija de la ficha */}
          {onDescartar && (accionesExtra ?? []).length > 0 && <MenuAcciones acciones={accionesExtra ?? []} />}
        </div>
      )}

      {iniciarAbierto && c.expedienteId != null && (
        <ModalIniciarOnboarding
          expedienteId={c.expedienteId}
          onClose={() => setIniciarAbierto(false)}
          onIniciado={(r) => {
            setIniciarAbierto(false);
            onCambio(r.candidato);
            setAviso({ tono: "ok", texto: `Onboarding iniciado: ${r.tareas.length} tareas generadas.` });
          }}
        />
      )}

      {sapAbierto && c.expedienteId != null && (
        <ModalDatosAltaSap
          expedienteId={c.expedienteId}
          onClose={() => setSapAbierto(false)}
          onCambio={(d) => setEstadoSap({ estado: d.estadoSap, texto: d.estadoSapTexto, confirmadoPor: d.confirmadoPor, confirmadoEn: d.confirmadoEn })}
        />
      )}

      {docPreview && c.expedienteId != null && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => !enviandoDoc && setDocPreview(null)}>
          <Card className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 sm:h-[90vh] sm:max-w-3xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-soft px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">{docPreview === "carta" ? "Carta de intención" : "Contrato individual de trabajo"}</p>
                <p className="text-[11px] text-ink-3">Generado con las condiciones guardadas · {puesto} · {sueldo} · {tipo}{fechaIngreso ? ` · ingreso ${fechaIngreso}` : ""}</p>
              </div>
              <button onClick={() => setDocPreview(null)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
            </div>
            <iframe title={docPreview} src={docPreview === "carta" ? urlCartaIntencionPdf(c.expedienteId) : urlContratoPdf(c.expedienteId)} className="min-h-0 w-full flex-1 bg-surface-2" />
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-soft bg-surface px-4 py-3">
              {docPreview === "contrato" ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => enviarContratoA("whatsapp")} disabled={Boolean(enviandoDoc) || !c.telefono} title={c.telefono ? `Manda la liga de su expediente con el contrato por ${CANAL}` : `El candidato no tiene ${CANAL}`}>
                    <MessageCircle className="h-4 w-4" /> {enviandoDoc === "whatsapp" ? "Enviando…" : CANAL}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enviarContratoA("correo")} disabled={Boolean(enviandoDoc) || !c.correo} title={c.correo ? "Correo con el PDF adjunto" : "El candidato no tiene correo"}>
                    <Mail className="h-4 w-4" /> {enviandoDoc === "correo" ? "Enviando…" : "Correo"}
                  </Button>
                </>
              ) : null}
              {docPreview === "carta" ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => enviarCarta("whatsapp")} disabled={Boolean(enviandoDoc) || !c.telefono} title={c.telefono ? `Manda la liga de su expediente con la carta por ${CANAL}` : `El candidato no tiene ${CANAL}`}>
                    <MessageCircle className="h-4 w-4" /> {enviandoDoc === "whatsapp" ? "Enviando…" : CANAL}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enviarCarta("correo")} disabled={Boolean(enviandoDoc) || !c.correo} title={c.correo ? "Correo con el PDF adjunto" : "El candidato no tiene correo"}>
                    <Mail className="h-4 w-4" /> {enviandoDoc === "correo" ? "Enviando…" : "Correo"}
                  </Button>
                </>
              ) : null}
              <a href={docPreview === "carta" ? urlCartaIntencionPdf(c.expedienteId) : urlContratoPdf(c.expedienteId)} download className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-white transition hover:brightness-110">
                <Download className="h-4 w-4" /> Descargar
              </a>
              {resultadoDoc && <span className={cn("text-[12px]", resultadoDoc.ok ? "text-good" : "text-bad")}>{resultadoDoc.texto}</span>}
            </div>
          </Card>
        </div>
      )}

      {cancelando && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-bad/30 bg-bad-soft/40 p-3">
          <input
            value={motivoCancelar}
            onChange={(e) => setMotivoCancelar(e.target.value)}
            placeholder="Motivo de la cancelación…"
            className="h-9 rounded-lg border border-border-soft bg-surface px-3 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCancelando(false)} disabled={ocupado === "cancelar"}>
              Volver
            </Button>
            <Button size="sm" onClick={confirmarCancelacion} disabled={!motivoCancelar.trim() || ocupado === "cancelar"}>
              {ocupado === "cancelar" ? "Cancelando…" : "Confirmar cancelación"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Info({ icon: Icon, v }: { icon: React.ComponentType<{ className?: string }>; v: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs text-ink-2">
      <Icon className="h-3.5 w-3.5 text-ink-3" /> {v}
    </span>
  );
}

/* ============================================================
   Fraiche (spec §11-13) · Ruta visible, franquicia, alta SAP y ficha para presentar
   ============================================================ */

/** Chips de la ruta visible: el paso actual resaltado, los anteriores atenuados; una sola línea con scroll-x. */
function RutaStepper({ ruta, paso }: { ruta: { clave: string; nombre: string }[]; paso?: string }) {
  const actual = ruta.findIndex((p) => p.clave === paso);
  return (
    <div className="scroll-x min-w-0 flex-1 items-center gap-1" style={{ scrollSnapType: "none" }}>
      {ruta.map((p, i) => {
        const esActual = i === actual;
        const hecho = actual >= 0 && i < actual;
        return (
          <span key={p.clave} className="flex items-center gap-1">
            {i > 0 && <span className={cn("h-px w-2", hecho || esActual ? "bg-brand/50" : "bg-border-soft")} />}
            <span
              title={p.nombre}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                esActual
                  ? "border-brand bg-brand text-white shadow-sm"
                  : hecho
                    ? "border-brand/20 bg-brand-soft/60 text-brand/70"
                    : "border-border-soft bg-surface text-ink-3",
              )}
            >
              {p.nombre}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** «Mover en la ruta…»: el reclutador confirma el paso visible; el servidor lo mapea a la etapa interna
 * (409 con mensaje claro si «Listo para alta / SAP» exige Onboarding). */
function ModalMoverPaso({
  c,
  valor,
  ocupado,
  onChange,
  onClose,
  onMover,
}: {
  c: Candidato;
  valor: { paso: PasoFraiche | ""; comentario: string };
  ocupado: boolean;
  onChange: (v: { paso: PasoFraiche | ""; comentario: string }) => void;
  onClose: () => void;
  onMover: () => void;
}) {
  const ruta = c.ruta ?? [];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => !ocupado && onClose()}>
      <div className="flex h-[100dvh] w-full max-w-md flex-col border border-border-soft bg-bg shadow-2xl sm:h-auto sm:max-h-[85vh] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6">
          <h3 className="font-display text-lg font-bold">Mover en la ruta</h3>
          <p className="mt-1 text-sm text-ink-2">
            Ruta de <b className="text-ink">{DESTINO_NOMBRE[c.destino ?? ""] ?? "la vacante"}</b>. El reclutador confirma el movimiento; queda en el historial con tu nombre.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-1.5">
            {ruta.map((p) => {
              const esActual = p.clave === c.paso;
              return (
                <label
                  key={p.clave}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition",
                    esActual ? "cursor-default border-brand/30 bg-brand-soft/40 text-ink-3" : valor.paso === p.clave ? "border-brand bg-brand-soft/60" : "border-border-soft hover:border-brand/40",
                  )}
                >
                  <input
                    type="radio"
                    name="paso-ruta"
                    className="accent-brand"
                    disabled={esActual}
                    checked={valor.paso === p.clave}
                    onChange={() => onChange({ ...valor, paso: p.clave as PasoFraiche })}
                  />
                  <span className="flex-1">{p.nombre}</span>
                  {esActual && <Badge tone="brand">Actual</Badge>}
                </label>
              );
            })}
          </div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Comentario (opcional)</span>
            <input
              value={valor.comentario}
              onChange={(e) => onChange({ ...valor, comentario: e.target.value })}
              placeholder="Ej. ya se aplicó la psicometría en sucursal"
              className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-soft px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button size="sm" onClick={onMover} disabled={!valor.paso || ocupado}>
            <Route className="h-4 w-4" /> {ocupado ? "Moviendo…" : "Mover"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Franquicia (spec §12): presentar al franquiciatario, actualizar su respuesta y generar la ficha. */
/** Pipeline v2 (2026-10-01): avance real — ruta, columna, actividades con resultado y «Revisado por», pendientes,
 * Evaluación integral (resultado acumulado) y siguiente acción. Todo viene de la API (`fraiche_pipeline.avance`). */
function PanelAvance({ c, boton, ocupado, onAccion }: { c: Candidato; boton: AccionSiguiente | null; ocupado: boolean; onAccion: (a: AccionSiguiente) => void }) {
  const av = c.avance!;
  const acts = av.actividades ?? [];
  const columnas = Array.from(new Set(acts.map((a) => a.columna)));
  const icono = (a: ActividadRuta) => (a.estado === "hecha" ? (a.noCumple ? "✗" : "✓") : a.estado === "en_curso" ? "…" : "○");
  const color = (a: ActividadRuta) => (a.tono === "good" ? "text-good" : a.tono === "warn" ? "text-warn" : a.tono === "bad" ? "text-bad" : "text-ink-3");
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Avance del proceso</Eyebrow>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
            {av.ruta && <Badge tone={av.destino === "franquicia" ? "human" : "good"}>{av.ruta}</Badge>}
            <Badge tone="brand">{av.columnaNombre}</Badge>
            {av.franquiciaEstadoTexto && <Badge tone={av.franquiciaEstado === "aceptado" ? "good" : av.franquiciaEstado === "no_aceptado" ? "bad" : "neutral"}>{av.franquiciaEstadoTexto}</Badge>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-ink-3">Evaluación integral</p>
          <Badge tone={TONO_INTEGRAL[av.integral.conclusion] ?? "neutral"}>{TEXTO_INTEGRAL[av.integral.conclusion] ?? av.integral.conclusion}</Badge>
          {av.integral.score != null && <p className="mt-0.5 font-mono text-[11px] text-ink-3">Score CV {av.integral.score}%</p>}
        </div>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">{av.integral.texto}</p>

      <div className="mt-3 rounded-xl border border-border-soft bg-surface-2/50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Siguiente acción</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{av.siguienteAccion?.texto || "—"}</p>
          {boton && (
            <Button size="sm" onClick={() => onAccion(boton)} disabled={ocupado}>
              <ThumbsUp className="h-4 w-4" /> {boton.texto}
            </Button>
          )}
        </div>
        {(av.faltaParaAvanzar?.length ?? 0) > 0 && av.siguienteColumna && (
          <div className="mt-2 text-[12px] text-ink-2">
            <p className="font-semibold text-warn">Para pasar a {nombreEtapa(av.siguienteColumna)} falta:</p>
            <ul className="mt-1 list-disc pl-5">
              {av.faltaParaAvanzar!.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {columnas.map((col) => (
          <div key={col}>
            <p className={cn("text-[11px] font-semibold uppercase tracking-wide", col === av.columna ? "text-brand" : "text-ink-3")}>
              {nombreEtapa(col)}{col === av.columna ? " · columna actual" : ""}
            </p>
            <ul className="mt-1 divide-y divide-border-faint rounded-lg border border-border-faint">
              {acts.filter((a) => a.columna === col).map((a) => (
                <li key={a.clave} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-[12px]">
                  <span className="min-w-0">
                    <span className={cn("mr-1.5 font-mono font-bold", color(a))}>{icono(a)}</span>
                    <b className="text-ink">{a.nombre}</b>
                    {a.resultado && <span className={cn("ml-1.5", color(a))}>{a.resultado}</span>}
                    {a.detalle && <span className="ml-1.5 text-ink-3">· {a.detalle}</span>}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    {a.revisadoPor ? `Revisado por: ${a.revisadoPor}` : a.estado === "hecha" ? "" : "Pendiente"}
                    {a.fecha ? ` · ${fechaCorta(a.fecha)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PanelFranquicia({
  c,
  live,
  ocupado,
  onPresentar,
  onFicha,
  onCambio,
  setAviso,
}: {
  c: Candidato;
  live: boolean;
  ocupado: boolean;
  onPresentar: () => void;
  onFicha: () => void;
  onCambio: (c: Candidato) => void;
  setAviso: (a: AvisoEstado) => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const [estado, setEstado] = useState<"" | keyof typeof ESTADOS_FRANQUICIA>("");
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const sinPresentar = !c.franquiciaEstado;
  const activa = c.activa !== false;

  async function actualizar() {
    if (!estado) return;
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    if (estado === "aceptado" && !window.confirm(`${TEXTO_ACEPTADO_FRANQUICIA}. ¿Continuar?`)) return;
    setGuardando(true);
    const r = await actualizarFranquicia(c.id, estado, comentario.trim());
    setGuardando(false);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setEstado("");
    setComentario("");
    onCambio(r.data);
    setAviso({ tono: "ok", texto: `Franquicia: ${ESTADOS_FRANQUICIA[estado]}.${estado === "aceptado" ? " Ya puede pasar a Contratación." : ""}` });
  }

  return (
    <Card className="border-human/25 bg-human-soft/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Franquicia</Eyebrow>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            {c.clienteVacante ? <>Franquiciatario: <b className="text-ink">{c.clienteVacante}</b>. </> : null}
            Dentro de Filtro humano: entrevista inicial de Reclutamiento → presentación al franquiciatario → su entrevista y decisión. En Contratación y Onboarding
            RH solo registra lo que confirma el franquiciatario. Sin IPV, psicometría, médico, socioeconómico, kit ni alta SAP de Fraiche.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="human"><Handshake className="h-3 w-3" /> Franquicia</Badge>
            <Badge tone={c.avance?.franquiciaEstado === "aceptado" ? "good" : c.avance?.franquiciaEstado === "no_aceptado" ? "bad" : "brand"}>
              {c.avance?.franquiciaEstadoTexto || c.franquiciaEstadoTexto || "Pendiente de presentar"}
            </Badge>
          </div>
        </div>
        {puedeDecidir && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onFicha} disabled={ocupado || !live}>
              <FileDown className="h-4 w-4" /> Generar ficha para presentar
            </Button>
          </div>
        )}
      </div>

      {puedeDecidir && !sinPresentar && (
        <div className="mt-3 grid gap-2 border-t border-border-faint pt-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Actualizar</span>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as typeof estado)}
              disabled={guardando}
              className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Elige…</option>
              {(Object.keys(ESTADOS_FRANQUICIA) as (keyof typeof ESTADOS_FRANQUICIA)[])
                .filter((k) => k !== c.franquiciaEstado)
                .map((k) => (
                  <option key={k} value={k}>{ESTADOS_FRANQUICIA[k]}</option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Comentario (opcional)</span>
            <input
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej. el franquiciatario confirmó por teléfono"
              className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <Button size="sm" onClick={actualizar} disabled={!estado || guardando || ocupado}>
            {guardando ? "Guardando…" : "Actualizar"}
          </Button>
          {estado === "aceptado" && (
            <p className="text-[11px] text-warn sm:col-span-3">{TEXTO_ACEPTADO_FRANQUICIA}.</p>
          )}
        </div>
      )}
    </Card>
  );
}

/** «Presentar al franquiciatario»: contacto del Cliente (o uno nuevo) + liga de la Entrevista con franquiciatario. */
function ModalPresentarFranquiciatario({
  c,
  onClose,
  onPresentado,
}: {
  c: Candidato;
  onClose: () => void;
  onPresentado: (c: Candidato) => void;
}) {
  const [contactos, setContactos] = useState<ContactoCliente[] | null>(null);
  const [contactoId, setContactoId] = useState<number | "otro" | "">("");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [enviarLiga, setEnviarLiga] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<{ liga: string; lineas: { ok: boolean; texto: string }[] } | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (!c.clienteIdVacante) {
      setContactos([]);
      setContactoId("otro");
      return;
    }
    fetchCliente(c.clienteIdVacante).then((cl) => {
      if (!vivo) return;
      const lista = cl?.listaContactos ?? [];
      setContactos(lista);
      setContactoId(lista.length ? lista[0].id : "otro");
    });
    return () => {
      vivo = false;
    };
  }, [c.clienteIdVacante]);

  const esOtro = contactoId === "otro";
  const listo = esOtro ? nombre.trim().length > 0 && (correo.trim().length > 0 || whatsapp.trim().length > 0) : contactoId !== "";

  async function presentar() {
    setEnviando(true);
    setError("");
    const r = await presentarFranquiciatario(c.id, esOtro
      ? { nombre: nombre.trim(), correo: correo.trim(), whatsapp: whatsapp.trim(), enviarLiga }
      : { contactoId: Number(contactoId), enviarLiga });
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    setResultado({ liga: r.data.liga, lineas: lineasResultados(r.data.resultados) });
    onPresentado(r.data.candidato);
  }

  async function copiar() {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado.liga);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => !enviando && onClose()}>
      <div className="flex h-[100dvh] w-full max-w-lg flex-col border border-border-soft bg-bg shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div>
            <h3 className="font-display text-lg font-bold">Presentar al franquiciatario</h3>
            <p className="mt-1 text-sm text-ink-2">
              Se crea la «Entrevista con franquiciatario» de <b className="text-ink">{c.nombre}</b> y se le manda su liga al contacto elegido. El franquiciatario decide y contrata.
            </p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {resultado ? (
            <div className="flex flex-col gap-3">
              <Aviso tono="ok">Candidato presentado. Estado: <b>Presentado</b>.</Aviso>
              {resultado.lineas.length > 0 && (
                <ul className="space-y-1 text-[12px]">
                  {resultado.lineas.map((l) => (
                    <li key={l.texto} className={l.ok ? "text-good" : "text-bad"}>{l.ok ? "✓" : "✗"} {l.texto}</li>
                  ))}
                </ul>
              )}
              <div>
                <span className="text-xs font-medium text-ink-2">Liga para el franquiciatario</span>
                <div className="mt-1 flex gap-2">
                  <input readOnly value={resultado.liga} onFocus={(e) => e.currentTarget.select()} className="h-10 flex-1 rounded-xl border border-border-soft bg-surface-2 px-3 font-mono text-xs outline-none" />
                  <Button size="sm" variant="outline" onClick={copiar}><Copy className="h-4 w-4" /> {copiado ? "Copiada" : "Copiar"}</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {contactos === null ? (
                <p className="text-sm text-ink-3">Cargando contactos del franquiciatario…</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-2">Contacto{c.clienteVacante ? ` · ${c.clienteVacante}` : ""}</span>
                  {contactos.map((k) => (
                    <label key={k.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition", contactoId === k.id ? "border-brand bg-brand-soft/60" : "border-border-soft hover:border-brand/40")}>
                      <input type="radio" name="contacto-franquicia" className="accent-brand" checked={contactoId === k.id} onChange={() => setContactoId(k.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink">{k.nombreCompleto}{k.puesto ? <span className="font-normal text-ink-3"> · {k.puesto}</span> : null}</span>
                        <span className="block truncate text-[11px] text-ink-3">{[k.correo, k.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}</span>
                      </span>
                    </label>
                  ))}
                  <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition", esOtro ? "border-brand bg-brand-soft/60" : "border-border-soft hover:border-brand/40")}>
                    <input type="radio" name="contacto-franquicia" className="accent-brand" checked={esOtro} onChange={() => setContactoId("otro")} />
                    <span className="font-semibold text-ink">Otro contacto</span>
                  </label>
                </div>
              )}
              {esOtro && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <CampoTexto label="Nombre" value={nombre} onChange={setNombre} />
                  <CampoTexto label="Correo" value={correo} onChange={setCorreo} placeholder="nombre@franquicia.mx" />
                  <CampoTexto label={CANAL} value={whatsapp} onChange={setWhatsapp} placeholder="10 dígitos" />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" className="accent-brand" checked={enviarLiga} onChange={(e) => setEnviarLiga(e.target.checked)} />
                Enviar liga ahora (correo y/o {CANAL} según los datos del contacto)
              </label>
              {error && <Aviso tono="error">{error}</Aviso>}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-soft px-6 py-4">
          {resultado ? (
            <Button size="sm" onClick={onClose}>Listo</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={enviando}>Cancelar</Button>
              <Button size="sm" onClick={presentar} disabled={!listo || enviando || contactos === null}>
                <Handshake className="h-4 w-4" /> {enviando ? "Presentando…" : "Presentar"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Campos editables del alta en SAP: personales (bloque `personales`) y del puesto (`campos`). */
const SAP_EDITABLES_PERSONALES = ["curp", "rfc", "nss", "domicilio", "fecha_nacimiento", "genero"];
const SAP_EDITABLES_CAMPOS = ["empresa", "sucursal", "puesto", "jefe", "fecha_ingreso", "tipo_contratacion", "sueldo", "horario", "periodicidad"];

/** «Datos para alta en SAP SuccessFactors»: revisar, completar y confirmar. No envía nada a SAP ni muestra número de empleado. */
function ModalDatosAltaSap({ expedienteId, onClose, onCambio }: { expedienteId: number; onClose: () => void; onCambio: (d: DatosAltaSap) => void }) {
  const [datos, setDatos] = useState<DatosAltaSap | null>(null);
  const [error, setError] = useState("");
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<"" | "guardar" | "confirmar">("");
  const [aviso, setAviso] = useState<AvisoEstado>(null);

  // `onCambio` llega como arrow inline del panel: se guarda en ref para que la carga no se repita en cada render
  const onCambioRef = useRef(onCambio);
  onCambioRef.current = onCambio;
  const cargar = useCallback(async () => {
    const r = await fetchDatosAltaSap(expedienteId);
    if (!r) return setError("No se pudieron cargar los datos del expediente.");
    setDatos(r);
    onCambioRef.current(r);
  }, [expedienteId]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const confirmado = datos?.estadoSap === "listo_para_enviar_sap";
  const hayCambios = Object.keys(cambios).length > 0;
  function editable(bloque: string, campo: string): boolean {
    if (confirmado) return false;
    return bloque === "personales" ? SAP_EDITABLES_PERSONALES.includes(campo) : SAP_EDITABLES_CAMPOS.includes(campo);
  }

  async function guardar() {
    if (!hayCambios) return;
    setOcupado("guardar");
    const personales: Record<string, string> = {};
    const campos: Record<string, string> = {};
    for (const [k, v] of Object.entries(cambios)) {
      const [bloque, campo] = k.split(":");
      (bloque === "personales" ? personales : campos)[campo] = v;
    }
    const r = await capturarDatosAltaSap(expedienteId, { personales, campos });
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setCambios({});
    setDatos(r.data);
    onCambio(r.data);
    setAviso({ tono: "ok", texto: "Cambios guardados en el expediente." });
  }

  async function confirmar() {
    setOcupado("confirmar");
    const r = await confirmarDatosAltaSap(expedienteId);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setDatos(r.data);
    onCambio(r.data);
    setAviso({ tono: "ok", texto: `${r.data.estadoSapTexto || "Listo para enviar a SAP"}. ${r.data.mensaje}` });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => !ocupado && onClose()}>
      <div className="flex h-[100dvh] w-full max-w-3xl flex-col border border-border-soft bg-bg shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-soft px-6 py-4">
          <div>
            <h3 className="font-display text-lg font-bold">Datos para alta en SAP SuccessFactors</h3>
            <p className="mt-1 text-[12px] text-ink-3">Se toman del expediente y del CV; completa lo faltante y confirma. Aquí no se envía nada a SAP.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error && <Aviso tono="error">{error}</Aviso>}
          {!datos && !error && <p className="text-sm text-ink-3">Cargando datos del expediente…</p>}
          {datos && (
            <div className="flex flex-col gap-3">
              {aviso && <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso>}
              {confirmado && (
                <Aviso tono="ok">
                  <b>{datos.estadoSapTexto || "Listo para enviar a SAP"}</b>
                  {datos.confirmadoPor ? ` · confirmado por ${datos.confirmadoPor}${datos.confirmadoEn ? ` el ${fechaHoraCorta(datos.confirmadoEn)}` : ""}` : ""}. {datos.mensaje}
                </Aviso>
              )}
              {!confirmado && datos.faltantes.length > 0 && (
                <Aviso tono="warn">Faltan {datos.faltantes.length} dato(s) para confirmar: {datos.faltantes.join(", ")}.</Aviso>
              )}
              {datos.bloques.map((b) => (
                <Card key={b.clave} className="p-3">
                  <Eyebrow>{b.nombre}</Eyebrow>
                  <div className="mt-2 divide-y divide-border-faint">
                    {b.campos.map((campo) => {
                      const k = `${b.clave}:${campo.clave}`;
                      const valor = cambios[k] ?? campo.valor;
                      const puede = editable(b.clave, campo.clave);
                      return (
                        <div key={campo.clave} className="grid items-center gap-1 py-1.5 sm:grid-cols-[11rem_1fr_auto] sm:gap-3">
                          <span className="text-[12px] font-medium text-ink-2">{campo.nombre}</span>
                          {puede ? (
                            <input
                              value={valor}
                              onChange={(e) => setCambios({ ...cambios, [k]: e.target.value })}
                              placeholder={campo.faltante ? "Captura este dato" : ""}
                              className={cn("h-9 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20", campo.faltante && !valor ? "border-bad/40" : "border-border-soft")}
                            />
                          ) : (
                            <span className={cn("text-sm", valor ? "text-ink" : "text-ink-3")}>{valor || "—"}</span>
                          )}
                          <span className="flex items-center gap-1.5">
                            {campo.faltante && !valor && <Badge tone="bad">Faltante</Badge>}
                            {campo.origen && <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">{campo.origen}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
              {datos.excluye.length > 0 && <p className="text-[11px] text-ink-3">No incluye: {datos.excluye.join(", ")}.</p>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-soft px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={Boolean(ocupado)}>Cerrar</Button>
          {datos && !confirmado && (
            <>
              <Button variant="outline" size="sm" onClick={guardar} disabled={!hayCambios || Boolean(ocupado)}>
                {ocupado === "guardar" ? "Guardando…" : "Guardar cambios"}
              </Button>
              <Button
                size="sm"
                onClick={confirmar}
                disabled={datos.faltantes.length > 0 || hayCambios || Boolean(ocupado)}
                title={datos.faltantes.length ? "Completa los datos faltantes primero" : hayCambios ? "Guarda los cambios antes de confirmar" : "Deja los datos listos para enviar a SAP (no envía nada)"}
              >
                <Database className="h-4 w-4" /> {ocupado === "confirmar" ? "Confirmando…" : "Confirmar datos para alta"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** «Generar ficha para presentar» (spec §13): secciones, observaciones, siguiente acción y destinatario; vista previa + PDF. */
function ModalFichaPresentacion({ c, onClose, onGenerada }: { c: Candidato; onClose: () => void; onGenerada: (destinatario: string) => void }) {
  const [secciones, setSecciones] = useState<string[]>(SECCIONES_FICHA.map((s) => s.clave));
  const [observaciones, setObservaciones] = useState("");
  const [siguienteAccion, setSiguienteAccion] = useState("");
  const [destinatario, setDestinatario] = useState(c.destino === "franquicia" && c.clienteVacante ? c.clienteVacante : "");
  const [srcPreview, setSrcPreview] = useState(() => urlFichaPresentacion(c.id, { secciones: SECCIONES_FICHA.map((s) => s.clave) }));
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");

  // La vista previa se refresca sola (debounce) al cambiar secciones u observaciones
  useEffect(() => {
    const t = setTimeout(() => setSrcPreview(urlFichaPresentacion(c.id, { secciones, observaciones, siguienteAccion })), 600);
    return () => clearTimeout(t);
  }, [c.id, secciones, observaciones, siguienteAccion]);

  function alternar(clave: string) {
    setSecciones((s) => (s.includes(clave) ? s.filter((x) => x !== clave) : SECCIONES_FICHA.map((x) => x.clave).filter((x) => x === clave || s.includes(x))));
  }

  async function generar() {
    if (!destinatario.trim()) return;
    setGenerando(true);
    setError("");
    const r = await generarFichaPresentacion(c.id, { destinatario: destinatario.trim(), secciones, observaciones, siguienteAccion });
    setGenerando(false);
    if (!r.ok) return setError(r.error);
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ficha-${c.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    onGenerada(destinatario.trim());
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => !generando && onClose()}>
      <div className="flex h-[100dvh] w-full max-w-4xl flex-col border border-border-soft bg-bg shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-soft px-6 py-4">
          <div>
            <h3 className="font-display text-lg font-bold">Generar ficha para presentar</h3>
            <p className="mt-1 text-[12px] text-ink-3">{c.nombre} · {c.puesto || "Sin vacante"}. La ficha se registra en el historial con destinatario y fecha.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4 lg:grid-cols-[18rem_1fr]">
          <div className="flex flex-col gap-3">
            <div>
              <span className="text-xs font-medium text-ink-2">Secciones</span>
              <div className="mt-1.5 flex flex-col gap-1">
                {SECCIONES_FICHA.map((s) => (
                  <label key={s.clave} className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" className="accent-brand" checked={secciones.includes(s.clave)} onChange={() => alternar(s.clave)} />
                    {s.nombre}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">Observaciones</span>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
                placeholder="Lo que quieres resaltar al presentarlo…"
                className="rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <CampoTexto label="Siguiente acción" value={siguienteAccion} onChange={setSiguienteAccion} placeholder="Ej. entrevista con el gerente de sucursal" />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">Destinatario <span className="text-bad">*</span></span>
              <input
                value={destinatario}
                onChange={(e) => setDestinatario(e.target.value)}
                placeholder="Ej. Gerente de sucursal Polanco / Franquiciatario"
                className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
            {error && <Aviso tono="error">{error}</Aviso>}
          </div>
          <div className="flex min-h-96 flex-col">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">Vista previa</span>
              <button
                type="button"
                onClick={() => {
                  const base = urlFichaPresentacion(c.id, { secciones, observaciones, siguienteAccion });
                  setSrcPreview(`${base}${base.includes("?") ? "&" : "?"}_=${Date.now()}`);
                }}
                className="flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
              >
                <RefreshCw className="h-3 w-3" /> Actualizar vista previa
              </button>
            </div>
            <iframe key={srcPreview} title="Vista previa de la ficha" src={srcPreview} className="h-96 w-full flex-1 rounded-xl border border-border-soft bg-surface-2" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-soft px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={generando}>Cancelar</Button>
          <Button size="sm" onClick={generar} disabled={!destinatario.trim() || secciones.length === 0 || generando}>
            <FileDown className="h-4 w-4" /> {generando ? "Generando…" : "Generar y descargar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
