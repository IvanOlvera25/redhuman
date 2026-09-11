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
} from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow, Progress } from "@/components/ui";
import { PageHeader, EstadoBadge, ScoreRing } from "@/components/dashboard/parts";
import { Aviso, Dropzone, pesoLegible } from "@/components/dashboard/subida";
import {
  candidatos as candidatosDemo,
  type Candidato,
  type EntrevistaHumana,
  type EtapaCandidato,
  type RecomendacionEntrevistaHumana,
  type ResultadoEntrevistaHumana,
  type TipoEntrevistador,
  type Vacante,
} from "@/lib/data";
import type { DocExpediente, NuevoIngreso } from "@/lib/phase2";
import {
  autorizarAlta,
  cancelarEntrevistaHumana,
  cancelarExpediente,
  decidirCandidato,
  enviarPrefiltro,
  fetchCandidato,
  fetchCandidatos,
  fetchClientes,
  fetchEntrevistadores,
  fetchExpediente,
  fetchMensajes,
  fetchVacantes,
  guardarCondicionesContratacion,
  liberarTelefonoCandidato,
  marcarEntrevistaHumanaRealizada,
  modificarEntrevistaHumana,
  moverEtapaCandidato,
  programarEntrevistaHumana,
  reanalizarCvCandidato,
  recordatorioDocumentosCandidato,
  recordatorioEntrevistaHumana,
  registrarConsentimiento,
  registrarResultadoEntrevistaHumana,
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
} from "@/lib/api";
import { usePuedeDecidir, useModoPrueba } from "@/components/sesion";
import { useAnunciarContextoAgente } from "@/components/dashboard/agente/proveedor";
import { cn } from "@/lib/utils";

const etapas: EtapaCandidato[] = [
  "Prefiltro",
  "Entrevista IA",
  "Evaluación",
  "Entrevista Humana",
  "Contratación",
  "Onboarding",
];
const etapaColor: Record<EtapaCandidato, string> = {
  Prefiltro: "var(--ink-3)",
  "Entrevista IA": "var(--brand)",
  Evaluación: "var(--human)",
  "Entrevista Humana": "var(--brand-2)",
  Contratación: "var(--warn)",
  Onboarding: "var(--good)",
};

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
  { key: "descartados", label: "Descartados" },
];

const ETAPAS_YA_CONTRATADO: EtapaCandidato[] = ["Contratación", "Onboarding"];

const TIPOS_CONTRATACION = ["Tiempo indeterminado", "Tiempo determinado", "Por obra o proyecto", "Honorarios"];
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

/** "Todos" excluye a los descartados a propósito: son un archivo aparte, no la vista por defecto. */
function coincideEstado(c: Candidato, filtro: FiltroEstado): boolean {
  const yaContratado = ETAPAS_YA_CONTRATADO.includes(c.etapa);
  switch (filtro) {
    case "en_proceso":
      return !yaContratado && (c.estado === "revision" || c.estado === "pendiente");
    case "aptos":
      return !yaContratado && c.estado === "cumple";
    case "contratados":
      return yaContratado;
    case "descartados":
      return c.estado === "no_cumple";
    case "todos":
    default:
      return c.estado !== "no_cumple";
  }
}

function CandidatosContenido() {
  const puedeDecidir = usePuedeDecidir();
  const searchParams = useSearchParams();

  const [sel, setSel] = useState<Candidato | null>(null);
  useAnunciarContextoAgente(
    sel ? { pantalla: "candidato", entidad: { tipo: "candidato", codigo: sel.id } } : { pantalla: "candidatos" },
  );
  const [datos, setDatos] = useState<Candidato[]>(candidatosDemo);
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
    const c = await fetchCandidatos(filtroVacante ? { vacante: filtroVacante } : undefined);
    if (c && c.length) {
      setDatos(c);
      setLive(true);
      if (abrirCodigo) {
        const detalle = await fetchCandidato(abrirCodigo);
        if (detalle) setSel(detalle);
      }
    } else if (c && c.length === 0) {
      setDatos([]);
      setLive(true);
    }
  }, [filtroVacante]);

  useEffect(() => {
    recargar();
    fetchVacantes().then((v) => v && setVacantes(v));
    fetchClientes("Activo").then((cl) => setClientes(cl ?? []));
    fetchEntrevistadores().then((u) => setUsuarios(u ?? []));
  }, [recargar]);

  async function abrir(c: Candidato) {
    setSel(c);
    if (!live) return;
    const detalle = await fetchCandidato(c.id);
    if (detalle) setSel(detalle);
  }

  // Detección de duplicados en el conjunto cargado (por teléfono normalizado a 10 dígitos o correo)
  const duplicadosSet = useMemo(() => {
    const telMap = new Map<string, number>();
    const emailMap = new Map<string, number>();

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
  }, [datos]);

  const sinConsentimiento = datos.filter((c) => c.consentimiento === false).length;

  // Filtrado y ordenamiento compuesto
  const datosFiltrados = useMemo(() => {
    let res = datos.filter((c) => {
      if (filtroVacante && c.vacanteId !== filtroVacante) return false;
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
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border-soft bg-surface-2/60 p-1">
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
              <option value="WhatsApp">WhatsApp</option>
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
            Mostrando etapa enfocada: <strong>{columnaResaltada}</strong>
          </span>
          <button
            onClick={() => setColumnaResaltada(null)}
            className="flex items-center gap-1 font-semibold hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Quitar enfoque
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

      {/* VISTA 1: PIPELINE (Kanban) */}
      {vista === "pipeline" && (
        <div className="mt-6 grid gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {etapas.map((etapa) => {
            const cols = datosFiltrados.filter((c) => c.etapa === etapa);
            const esResaltada = columnaResaltada === etapa;

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
                    <span className={cn("text-sm font-semibold", esResaltada && "text-brand")}>{etapa}</span>
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
                  {cols.map((c) => {
                    const esDup = duplicadosSet.has(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => abrir(c)}
                        className="card-hover group rounded-xl border border-border-soft bg-surface p-3.5 text-left transition-all hover:border-brand/40 hover:shadow-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <ScoreRing score={c.score} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-semibold group-hover:text-brand">{c.nombre}</p>
                              {c.esPrueba && (
                                <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-brand">
                                  Prueba
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
                            {c.fuente === "WhatsApp" ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-good">
                                <MessageCircle className="h-3 w-3" /> WhatsApp
                              </span>
                            ) : (
                              c.fuente
                            )}
                          </span>
                        </div>

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
                    );
                  })}
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
      {vista === "lista" && (
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
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-ink">{c.nombre}</p>
                            {c.esPrueba && (
                              <span className="rounded bg-brand-soft px-1 text-[9px] font-bold text-brand">
                                Prueba
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
                        {c.etapa}
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
                      {c.fuente === "WhatsApp" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-good">
                          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
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
        />
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
type AvisoEstado = { tono: "ok" | "error" | "warn"; texto: string; reintentar?: () => void } | null;

/* ============================================================
   MODAL CENTRADO: Detalle del Candidato (4 pestañas + Contratación condicional)
   ============================================================ */
function ModalCandidato({
  c,
  live,
  onClose,
  onCambio,
}: {
  c: Candidato;
  live: boolean;
  onClose: () => void;
  onCambio: (c: Candidato) => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const modoPrueba = useModoPrueba();
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

  function resolver<T>(r: { ok: true; data: T } | { ok: false; error: string }, exito: string, reintentar?: () => void) {
    setOcupado("");
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error, reintentar });
      return null;
    }
    setAviso({ tono: "ok", texto: exito });
    return r.data;
  }

  async function descartar() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado("descartar");
    const r = await decidirCandidato(c.id, "descartar", comentario);
    const data = resolver(r, "Candidato descartado.");
    if (data) {
      setComentario("");
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
    const data = resolver(
      r, `Enviado a ${etapa}.`,
      modoPrueba && !forzarPrueba ? () => enviarAEtapa(etapa, true) : undefined,
    );
    if (data) {
      setComentario("");
      onCambio(data);
    }
  }

  /** SOLO PRUEBAS: libera teléfono/wa_id para reutilizar el mismo número de WhatsApp en
   * pruebas repetidas sin que el webhook lo asocie a este candidato. No confundir con las
   * acciones normales del flujo — no borra mensajes, CV ni expediente. */
  async function liberarTelefono() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar la acción en la bitácora." });
    if (!window.confirm(`Esto es solo para pruebas: se le va a quitar el teléfono y wa_id a ${c.nombre} (no se borra nada más). ¿Continuar?`)) {
      return;
    }
    setOcupado("liberar-telefono");
    const r = await liberarTelefonoCandidato(c.id);
    const data = resolver(r, "Teléfono liberado — este candidato ya no está asociado a ese número.");
    if (data) onCambio(data);
  }

  /** Onboarding · Zero-Touch fase 2 — RH detona, la IA da seguimiento por WhatsApp. */
  async function solicitarDocumentos() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para enviar mensajes por WhatsApp." });
    setOcupado("solicitar-documentos");
    const r = await solicitarDocumentosCandidato(c.id);
    const data = resolver(r, "Solicitud de documentos enviada por WhatsApp.");
    if (data) onCambio(data.candidato);
  }

  async function enviarRecordatorioDocumentos() {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para enviar mensajes por WhatsApp." });
    setOcupado("recordatorio-documentos");
    const r = await recordatorioDocumentosCandidato(c.id);
    const data = resolver(r, "Recordatorio enviado por WhatsApp.");
    if (data) onCambio(data.candidato);
  }

  /** Botón principal de Onboarding — cierra el ciclo y mueve el registro a Colaboradores.
   * Siempre visible y habilitado mientras esté en Onboarding: si faltan documentos
   * obligatorios, el backend lo rechaza (409) y el motivo se muestra en {aviso}. Con Modo
   * Prueba activo, ese aviso trae un botón "Continuar de todos modos" — salvo que el 409 sea
   * "ya fue dado de alta", que el backend nunca deja saltar (ver contratacion.alta). */
  async function darDeAltaComoColaborador(forzarPrueba = false) {
    if (!live || !c.expedienteId) return setAviso({ tono: "warn", texto: "Levanta la API para dar de alta al candidato." });
    setOcupado("alta");
    const r = await autorizarAlta(c.expedienteId, undefined, forzarPrueba);
    if (!r.ok) {
      setOcupado("");
      return setAviso({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba ? () => darDeAltaComoColaborador(true) : undefined,
      });
    }
    const actualizado = await fetchCandidato(c.id);
    setOcupado("");
    if (actualizado) onCambio(actualizado);
    setAviso({ tono: "ok", texto: "Alta registrada — el candidato se movió a Colaboradores." });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[92vh] rounded-3xl border border-border-soft bg-bg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border-soft px-6 py-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar name={c.nombre} tone={c.tono} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display truncate text-lg sm:text-xl font-bold text-ink">{c.nombre}</h2>
                <span className="font-mono text-xs text-ink-3">{c.id}</span>
              </div>
              <p className="truncate text-xs sm:text-sm text-ink-2">
                {c.puesto || "Sin vacante asignada"} · <b className="text-ink font-semibold">{c.fuente}</b>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <EstadoBadge estado={c.estado} prefijo="Prefiltro: " />
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2 transition"
              aria-label="Cerrar modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Barra de Pestañas Principales (4 base + Contratación condicional) */}
        <div className="border-b border-border-soft bg-surface-2/70 px-6 pt-3">
          <div className="flex gap-2">
            {(
              [
                { id: "resumen", label: "Resumen", icon: User, tone: "brand" },
                { id: "evaluaciones", label: "Evaluaciones", icon: Sparkles, tone: "human" },
                { id: "documentos", label: "CV y documentos", icon: FileText, tone: "brand" },
                { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, tone: "good", badge: c.mensajes },
                ...(c.etapa === "Contratación"
                  ? [{ id: "contratacion", label: "Contratación", icon: Briefcase, tone: "warn" }]
                  : []),
              ] as { id: TabCandidato; label: string; icon: typeof User; tone: string; badge?: number }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition border-b-2",
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
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-5">
          {aviso && (
            <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>
              {aviso.texto}
              {aviso.reintentar && (
                <Button size="sm" variant="outline" className="mt-2" onClick={aviso.reintentar}>
                  <FlaskConical className="h-3.5 w-3.5" /> Continuar de todos modos (modo prueba)
                </Button>
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

          {c.etapa === "Entrevista Humana" && <PanelEntrevistaHumana c={c} live={live} onCambio={onCambio} />}

          {tab === "resumen" && <PestanaResumen c={c} live={live} onCambio={onCambio} setTab={setTab} />}
          {tab === "evaluaciones" && <PestanaEvaluaciones c={c} />}
          {tab === "documentos" && <PestanaDocumentos c={c} live={live} onCambio={onCambio} setAviso={setAviso} />}
          {tab === "whatsapp" && <PestanaWhatsApp c={c} live={live} onCambio={onCambio} />}
          {tab === "contratacion" && c.etapa === "Contratación" && (
            <PanelContratacion c={c} live={live} onCambio={onCambio} setAviso={setAviso} />
          )}
        </div>

        {/* SOLO PRUEBAS: independiente de la etapa — no es parte del flujo normal del candidato. */}
        {puedeDecidir && (
          <div className="border-t border-border-soft bg-surface px-6 py-2">
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={liberarTelefono}
                disabled={Boolean(ocupado)}
                title="Solo para pruebas: quita el teléfono/wa_id de este candidato para reutilizar el número en otra prueba."
                className="text-[11px] text-ink-3 opacity-70 hover:opacity-100"
              >
                <FlaskConical className="h-3.5 w-3.5" /> Liberar número (prueba)
              </Button>
            </div>
          </div>
        )}

        {/* Etapa Prefiltro: solo Descartar — el paso a Entrevista IA es zero-touch, lo dispara
            la IA sola por WhatsApp al completar el prefiltro (no hay botón manual). */}
        {puedeDecidir && c.etapa === "Prefiltro" && (
          <div className="border-t border-border-soft bg-surface px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={descartar}
                disabled={Boolean(ocupado)}
                className="border-bad/30 text-bad hover:bg-bad-soft"
              >
                <ThumbsDown className="h-4 w-4" /> Descartar candidato
              </Button>
            </div>
          </div>
        )}

        {/* Footer Fijo con HITL y Acciones — Prefiltro, Entrevista Humana y Contratación tienen
            su propio panel de acciones; este footer genérico no aplica ahí. */}
        {puedeDecidir &&
          c.etapa !== "Prefiltro" &&
          c.etapa !== "Contratación" &&
          (c.etapa !== "Entrevista Humana" || c.entrevistaHumana?.realizada) && (
          <div className="border-t border-border-soft bg-surface px-6 py-4">
            <div className="flex flex-col gap-3">
              <input
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Nota de decisión para auditoría (opcional)…"
                className="h-10 w-full rounded-xl border border-border-soft bg-bg px-3.5 text-xs sm:text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              />

              <div className="flex flex-wrap items-center gap-2">
                {c.expedienteId == null && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={descartar}
                    disabled={Boolean(ocupado)}
                    className="border-bad/30 text-bad hover:bg-bad-soft"
                  >
                    <ThumbsDown className="h-4 w-4" /> Descartar
                  </Button>
                )}

                {/* Botones explícitos de avance: cada uno dice a dónde manda la tarjeta.
                    "Entrevista Humana" abre el modal de agenda en vez de mover directo. */}
                {siguientesEtapas.map((etapa) => (
                  <Button
                    key={etapa}
                    variant="secondary"
                    size="sm"
                    onClick={() => (etapa === "Entrevista Humana" ? setModalEntrevista(true) : enviarAEtapa(etapa))}
                    disabled={Boolean(ocupado)}
                  >
                    <ThumbsUp className="h-4 w-4" /> Enviar a {etapa}
                  </Button>
                ))}

                {/* Etapa Entrevista Humana: agendar una segunda ronda sin mover la tarjeta. */}
                {c.etapa === "Entrevista Humana" && (
                  <Button variant="outline" size="sm" onClick={() => setModalEntrevista(true)} disabled={Boolean(ocupado)}>
                    <CalendarClock className="h-4 w-4" /> Agendar otra Entrevista Humana
                  </Button>
                )}

                {/* Onboarding · Zero-Touch fase 2: RH detona por WhatsApp, la IA da seguimiento */}
                {c.etapa === "Onboarding" && (
                  <>
                    <Button variant="outline" size="sm" onClick={solicitarDocumentos} disabled={Boolean(ocupado)}>
                      <Send className="h-4 w-4" /> Solicitar documentos
                    </Button>
                    <Button variant="outline" size="sm" onClick={enviarRecordatorioDocumentos} disabled={Boolean(ocupado)}>
                      <RotateCw className="h-4 w-4" /> Enviar recordatorio
                    </Button>
                  </>
                )}

                {c.expedienteId != null && (
                  <a
                    href="/dashboard/onboarding"
                    className="flex items-center gap-1.5 rounded-xl border border-good/30 bg-good-soft px-3 py-2 text-xs font-semibold text-good transition hover:brightness-105"
                  >
                    <UserCheck className="h-4 w-4" /> Expediente ({c.expedienteProgreso ?? 0}%)
                  </a>
                )}
              </div>

              {/* Botón principal — siempre visible en Onboarding, sin importar el estado de los documentos */}
              {c.etapa === "Onboarding" && (
                <Button
                  className="w-full"
                  onClick={() => darDeAltaComoColaborador()}
                  disabled={Boolean(ocupado) || c.expedienteEstado === "alta"}
                >
                  <UserCheck className="h-4 w-4" />
                  {c.expedienteEstado === "alta"
                    ? "Alta completada ✓"
                    : ocupado === "alta"
                      ? "Dando de alta…"
                      : "DAR DE ALTA COMO COLABORADOR"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {modalEntrevista && (
        <ModalProgramarEntrevista
          c={c}
          onClose={() => setModalEntrevista(false)}
          onListo={(actualizado) => {
            setModalEntrevista(false);
            setAviso({ tono: "ok", texto: "Entrevista programada." });
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
  "No avanzar": { card: "border-bad/30 bg-bad-soft/20", texto: "text-bad", icon: XCircle },
};

function PestanaResumen({
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

      {/* B. Perfil extraído del CV */}
      <div>
        <Eyebrow>Perfil extraído del CV</Eyebrow>
        <Card className="mt-2 p-5">
          {estadoCv === "sin_cv" && <p className="text-sm text-ink-3">Currículum no recibido.</p>}

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
      </div>

      {/* C. Prefiltro */}
      <div>
        <Eyebrow>Prefiltro</Eyebrow>
        <Card className="mt-2 p-4">
          {!c.prefiltroResumen ? (
            <p className="text-sm text-ink-3">Prefiltro en curso — todavía no hay criterios evaluados.</p>
          ) : c.prefiltroResumen.incumplidos.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-warn">
                Prefiltro: incumple {c.prefiltroResumen.incumplidos.length} de {c.prefiltroResumen.total} criterios
              </p>
              <ul className="mt-2 space-y-1">
                {c.prefiltroResumen.incumplidos.map((x, i) => (
                  <li key={i} className="break-words text-xs leading-relaxed text-ink-2">• {x}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm font-semibold text-good">
              Prefiltro: Cumple {c.prefiltroResumen.cumple} de {c.prefiltroResumen.total} criterios
            </p>
          )}
        </Card>
      </div>

      {/* D. Afinidad con la vacante */}
      {c.afinidadGlobal != null && (
        <div>
          <Eyebrow>Afinidad con la vacante</Eyebrow>
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
    </div>
  );
}

/* ============================================================
   PESTAÑA 2: Evaluaciones (Luna, avatar, requisitos/brechas, prefiltro, entrevista humana)
   ============================================================ */
function PestanaEvaluaciones({ c }: { c: Candidato }) {
  const a = c.analisis ?? {};
  const ultimaEntrevista = c.entrevistas?.[c.entrevistas.length - 1];
  const evalAvatar = ultimaEntrevista?.evaluacion as
    | { resumen?: string; fortalezas?: string[]; riesgos?: string[] }
    | null
    | undefined;
  const historialEh = c.entrevistasHumanas ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* Tarjeta de Score de Afinidad */}
      <Card className="border-brand/30 bg-brand-soft/20 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand">
              Evaluación de Afinidad de IA (Luna)
            </span>
            <h3 className="font-display text-xl font-bold text-ink">Score de Ajuste: {c.score} / 100</h3>
            <p className="text-xs sm:text-sm text-ink-2 max-w-xl">
              {c.evidencia || "Ajuste preliminar comparado contra los requisitos de la vacante."}
            </p>
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <div className="scale-125">
              <ScoreRing score={c.score} />
            </div>
          </div>
        </div>
      </Card>

      {/* Tarjeta de la evaluación del avatar de entrevista — solo texto descriptivo, sin score:
          el número de afinidad es de Luna (arriba); esto es lo que se habló en la entrevista. */}
      {evalAvatar?.resumen && (
        <Card className="border-human/30 bg-human-soft/20 p-5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-human">
            Evaluación de Entrevista de IA (Avatar)
          </span>
          <p className="mt-2 text-sm leading-relaxed text-ink">{evalAvatar.resumen}</p>

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
              <p className="font-mono text-[11px] uppercase tracking-wider text-warn font-bold">Puntos de atención</p>
              <ul className="mt-1.5 space-y-1">
                {evalAvatar.riesgos!.map((x, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-2">• {x}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Match y recomendación de la entrevista con avatar — antes vivía colapsable dentro del
          footer de decisión; ya con pestaña propia se muestra siempre visible aquí. */}
      {(c.etapa === "Entrevista IA" || c.etapa === "Evaluación") &&
        (c.entrevistaMatch != null || c.entrevistaRecomendacion) && (
        <Card className="p-4">
          <Eyebrow>Evaluación de la entrevista</Eyebrow>
          <div className="mt-2 space-y-1 text-xs text-ink-2">
            {c.entrevistaMatch != null && (
              <p>
                Match de la entrevista: <b className="text-ink">{c.entrevistaMatch}%</b>
              </p>
            )}
            {c.entrevistaRecomendacion && (
              <p>
                Recomendación de la IA: <b className="text-ink">{c.entrevistaRecomendacion}</b>
              </p>
            )}
          </div>
        </Card>
      )}

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
          <Eyebrow>Entrevista Pre-filtro por WhatsApp ({a.respuestas_prefiltro!.length} respuestas)</Eyebrow>
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
                  <p className="text-sm font-semibold text-ink">
                    {eh.entrevistador || "Sin asignar"}
                    {eh.fecha && (
                      <span className="ml-2 font-normal text-ink-3">
                        {new Date(eh.fecha).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    )}
                  </p>
                  {eh.resultado ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={eh.resultado === "aprobado" ? "good" : "bad"} dot>
                        {eh.resultado === "aprobado" ? "Aprobado" : "No aprobado"}
                      </Badge>
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
              </Card>
            ))}
          </div>
        </div>
      )}
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
        Levanta la API en el puerto 8001 para ver el historial y sincronización de WhatsApp en tiempo real.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Header del Chat */}
      <div className="flex items-center justify-between rounded-2xl border border-border-soft bg-surface p-3.5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-good/15 text-good">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {c.telefono ? `WhatsApp: +${c.telefono}` : "Conversación de Pre-filtro"}
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
              Cuando el candidato escriba a tu bot de WhatsApp, las preguntas y respuestas aparecerán aquí en vivo.
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
                  {m.canal === "whatsapp" ? "WhatsApp" : "Simulador"}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-3xl border border-border-soft bg-bg shadow-2xl overflow-hidden">
        <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border-soft px-6 py-4">
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
                {["RH", "OCC", "LinkedIn", "Indeed", "Formulario", "WhatsApp"].map((f) => (
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
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
}) {
  const modoPrueba = useModoPrueba();
  const eh = c.entrevistaHumana;
  const [modalResultado, setModalResultado] = useState(false);
  const [modalModificar, setModalModificar] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<AvisoEstado>(null);
  const [recordando, setRecordando] = useState(false);
  const [avisoRecordatorio, setAvisoRecordatorio] = useState<AvisoEstado>(null);
  const [cancelando, setCancelando] = useState(false);

  /** Botón «Cancelar» (Fase D) — no mueve la tarjeta de etapa: RH agenda otra ronda o mueve la
   * etapa a mano según corresponda. */
  async function cancelar() {
    if (!window.confirm("¿Cancelar esta entrevista? No se mueve la etapa del candidato.")) return;
    setCancelando(true);
    setAviso(null);
    const r = await cancelarEntrevistaHumana(c.id);
    setCancelando(false);
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return;
    }
    onCambio(r.data);
  }

  /** Ya no pide resultado (Lote 3, Eje 2): solo confirma que la entrevista ocurrió y dispara el
   * correo con la liga al entrevistador. `forzarPrueba` (Lote 4): si Modo Prueba está activo y
   * el candidato ya no está en la etapa de Entrevista Humana, el aviso de error trae un botón
   * para reintentar saltando ese bloqueo. */
  async function marcarRealizada(forzarPrueba = false) {
    if (
      !forzarPrueba &&
      !window.confirm(
        "¿Confirmas que la entrevista ya se llevó a cabo? Se le mandará al entrevistador una liga por correo para que registre su evaluación.",
      )
    ) {
      return;
    }
    setMarcando(true);
    setAviso(null);
    const r = await marcarEntrevistaHumanaRealizada(c.id, forzarPrueba);
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
    datos: { resultado: ResultadoEntrevistaHumana; recomendacion: RecomendacionEntrevistaHumana; comentario: string },
    forzarPrueba = false,
  ) {
    setGuardando(true);
    setAviso(null);
    const r = await registrarResultadoEntrevistaHumana(c.id, datos, forzarPrueba);
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

  async function enviarRecordatorio(forzarPrueba = false) {
    setRecordando(true);
    setAvisoRecordatorio(null);
    const r = await recordatorioEntrevistaHumana(c.id, forzarPrueba);
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
        : "No se envió nada — revisa Configuración → Notificaciones para este evento.",
    });
    onCambio(r.data.candidato);
  }

  if (!eh) return null;

  const detalleModalidad =
    eh.modalidad === "Videollamada"
      ? eh.liga && `Liga: ${eh.liga}`
      : eh.modalidad === "Presencial"
        ? eh.ubicacion && `Ubicación: ${eh.ubicacion}`
        : eh.modalidad === "Llamada"
          ? (eh.telefonoContacto || c.telefono) && `Teléfono: ${eh.telefonoContacto || c.telefono}`
          : "";

  const IconoModalidad = eh.modalidad === "Presencial" ? MapPin : eh.modalidad === "Llamada" ? Phone : Video;

  return (
    <Card className="border-[color:var(--brand-2)]/30 bg-surface-2/40 p-4">
      <Eyebrow>Entrevista Humana programada</Eyebrow>
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
            <Badge tone={eh.resultado === "aprobado" ? "good" : "bad"} dot>
              {eh.resultado === "aprobado" ? "Aprobado" : "No aprobado"}
            </Badge>
            {eh.recomendacion && <Badge tone="brand">{RECOMENDACION_LABEL[eh.recomendacion]}</Badge>}
          </>
        ) : eh.realizada ? (
          <span className="text-xs text-ink-3">Esperando evaluación del entrevistador…</span>
        ) : live ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => marcarRealizada()} disabled={marcando}>
              <CheckCircle2 className="h-4 w-4" /> {marcando ? "Enviando…" : "Marcar entrevista realizada"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => enviarRecordatorio()} disabled={recordando}>
              <RotateCw className="h-4 w-4" /> {recordando ? "Enviando…" : "Enviar recordatorio"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setModalModificar(true)}>
              <Pencil className="h-4 w-4" /> Modificar
            </Button>
            <Button size="sm" variant="outline" className="text-bad" onClick={cancelar} disabled={cancelando}>
              <XCircle className="h-4 w-4" /> {cancelando ? "Cancelando…" : "Cancelar"}
            </Button>
          </>
        ) : null}
      </div>

      {/* Respaldo manual de RH (Eje 1) — solo aparece una vez marcada realizada, ya sea para
          capturar el resultado si el entrevistador no ha contestado, o para corregirlo. */}
      {eh.realizada && live && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          {eh.resultado && (
            <span className="text-[11px] text-ink-3">
              Registrado por {eh.resultadoCapturadoPor === "entrevistador" ? "el entrevistador" : "RH"}.
            </span>
          )}
          <button
            onClick={() => setModalResultado(true)}
            disabled={guardando}
            className="text-[11px] font-semibold text-brand hover:underline"
          >
            {eh.resultado ? "Corregir resultado" : "Registrar resultado manualmente"}
          </button>
        </div>
      )}

      {modalResultado && (
        <ModalCerrarEntrevistaHumana
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
  onCancelar,
  onConfirmar,
  cargando,
}: {
  /** Presente cuando ya había un resultado capturado — el modal pasa a modo "corregir" y
   * precarga los valores actuales. */
  inicial?: {
    resultado: ResultadoEntrevistaHumana | null;
    recomendacion: RecomendacionEntrevistaHumana | null;
    comentario: string;
  };
  onCancelar: () => void;
  onConfirmar: (datos: {
    resultado: ResultadoEntrevistaHumana;
    recomendacion: RecomendacionEntrevistaHumana;
    comentario: string;
  }) => void;
  cargando?: boolean;
}) {
  const [resultado, setResultado] = useState<ResultadoEntrevistaHumana | "">(inicial?.resultado ?? "");
  const [recomendacion, setRecomendacion] = useState<RecomendacionEntrevistaHumana | "">(inicial?.recomendacion ?? "");
  const [comentario, setComentario] = useState(inicial?.comentario ?? "");

  const comentarioObligatorio = resultado === "no_aprobado" || recomendacion === "segunda_entrevista";
  const listo = !!resultado && !!recomendacion && (!comentarioObligatorio || comentario.trim().length > 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md p-5">
        <h3 className="font-display text-lg font-bold">{inicial ? "Corregir resultado" : "Registrar resultado de la entrevista"}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {inicial
            ? "Vas a sobreescribir el resultado ya registrado para esta entrevista."
            : "Al confirmar se habilitan los botones «Descartar» y «Enviar a Contratación» para este candidato."}
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
                No aprobado
              </button>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Recomendación</span>
            <select
              value={recomendacion}
              onChange={(e) => setRecomendacion(e.target.value as RecomendacionEntrevistaHumana)}
              className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="" disabled>
                Selecciona una opción
              </option>
              <option value="avanzar">Avanzar</option>
              <option value="no_avanzar">No avanzar</option>
              <option value="segunda_entrevista">Segunda entrevista</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">
              Comentarios{" "}
              {comentarioObligatorio ? (
                <span className="text-bad">(obligatorio)</span>
              ) : (
                <span className="text-ink-3">(opcional)</span>
              )}
            </span>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
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
  onClose,
  onListo,
}: {
  c: Candidato;
  onClose: () => void;
  onListo: (c: Candidato) => void;
}) {
  const [entrevistadores, setEntrevistadores] = useState<{ id: number; nombre: string }[]>([]);
  const [tipoEntrevistador, setTipoEntrevistador] = useState<TipoEntrevistador>("interno");
  const [entrevistadorUsuarioId, setEntrevistadorUsuarioId] = useState<number | null>(null);
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

  useEffect(() => {
    fetchEntrevistadores().then((d) => {
      if (d && d.length) {
        setEntrevistadores(d);
        setEntrevistadorUsuarioId(d[0].id);
      }
    });
  }, []);

  async function programar() {
    if (!fecha || !hora) {
      setError("Completa fecha y hora.");
      return;
    }
    if (tipoEntrevistador === "interno" && !entrevistadorUsuarioId) {
      setError("Selecciona quién entrevista.");
      return;
    }
    if (tipoEntrevistador === "externo" && (!entrevistadorNombre.trim() || !entrevistadorCorreo.trim())) {
      setError("Indica nombre y correo del entrevistador externo.");
      return;
    }
    if (modalidad === "Videollamada" && !liga.trim()) {
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
      tipoEntrevistador,
      entrevistadorUsuarioId: tipoEntrevistador === "interno" ? entrevistadorUsuarioId : null,
      entrevistadorNombre: tipoEntrevistador === "externo" ? entrevistadorNombre : "",
      entrevistadorCorreo: tipoEntrevistador === "externo" ? entrevistadorCorreo : "",
      entrevistadorWhatsapp: tipoEntrevistador === "externo" ? entrevistadorWhatsapp : "",
      fecha,
      hora,
      modalidad,
      liga,
      ubicacion,
      telefonoContacto,
      comentario,
    });
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
        <h3 className="font-display text-lg font-bold">Programar entrevista humana</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Con {c.nombre.split(" ")[0]}. Al guardar, la tarjeta se mueve a Entrevista Humana.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <span className="text-sm font-medium text-ink-2">Entrevistador(a)</span>
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
              <span className="text-sm font-medium text-ink-2">Persona de RH</span>
              <select
                value={entrevistadorUsuarioId ?? ""}
                onChange={(e) => setEntrevistadorUsuarioId(Number(e.target.value))}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {entrevistadores.length === 0 && <option value="">Sin personas de RH activas</option>}
                {entrevistadores.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Nombre</span>
                <input
                  value={entrevistadorNombre}
                  onChange={(e) => setEntrevistadorNombre(e.target.value)}
                  placeholder="Nombre completo"
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Correo</span>
                <input
                  type="email"
                  value={entrevistadorCorreo}
                  onChange={(e) => setEntrevistadorCorreo(e.target.value)}
                  placeholder="correo@empresa.com"
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">WhatsApp (opcional)</span>
                <input
                  value={entrevistadorWhatsapp}
                  onChange={(e) => setEntrevistadorWhatsapp(e.target.value)}
                  placeholder="10 dígitos"
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
            </div>
          )}

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

          {modalidad === "Videollamada" && (
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

        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={programar} disabled={enviando}>
            {enviando ? "Programando…" : "Programar entrevista"}
          </Button>
        </div>
      </Card>
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
  const [fecha, setFecha] = useState(fechaInicial ? fechaInicial.toISOString().slice(0, 10) : "");
  const [hora, setHora] = useState(fechaInicial ? fechaInicial.toTimeString().slice(0, 5) : "");
  const [modalidad, setModalidad] = useState<ModalidadEntrevistaHumana>((eh.modalidad || "Videollamada") as ModalidadEntrevistaHumana);
  const [liga, setLiga] = useState(eh.liga || "");
  const [ubicacion, setUbicacion] = useState(eh.ubicacion || "");
  const [telefonoContacto, setTelefonoContacto] = useState(eh.telefonoContacto || "");
  const [comentario, setComentario] = useState(eh.comentario || "");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    if (!fecha || !hora) {
      setError("Completa fecha y hora.");
      return;
    }
    if (modalidad === "Videollamada" && !liga.trim()) {
      setError("Falta la liga de la videollamada.");
      return;
    }
    if (modalidad === "Presencial" && !ubicacion.trim()) {
      setError("Falta la ubicación de la entrevista.");
      return;
    }
    setEnviando(true);
    setError("");
    const r = await modificarEntrevistaHumana(c.id, { fecha, hora, modalidad, liga, ubicacion, telefonoContacto, comentario });
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
        <h3 className="font-display text-lg font-bold">Modificar entrevista</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Con {c.nombre.split(" ")[0]}. Se avisará según lo configurado en Notificaciones.
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

          {modalidad === "Videollamada" && (
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
        <Badge tone={cargado ? "good" : "neutral"}>{cargado ? "Cargado" : "Pendiente"}</Badge>
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
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
  setAviso: (a: AvisoEstado) => void;
}) {
  const modoPrueba = useModoPrueba();
  const cond = c.expedienteCondiciones;
  const [puesto, setPuesto] = useState(cond?.puesto ?? c.puesto ?? "");
  const [sueldo, setSueldo] = useState(cond?.sueldo ?? "");
  const [tipo, setTipo] = useState(cond?.tipoContratacion ?? "");
  const [fechaIngreso, setFechaIngreso] = useState(cond?.fechaIngreso ? cond.fechaIngreso.slice(0, 10) : "");
  const [ubicacion, setUbicacion] = useState(cond?.ubicacion ?? "");
  const [jefe, setJefe] = useState(cond?.jefeDirecto ?? "");
  const [guardando, setGuardando] = useState(false);
  const [expediente, setExpediente] = useState<NuevoIngreso | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [ocupado, setOcupado] = useState("");

  const cargarExpediente = useCallback(() => {
    if (!c.expedienteId) return;
    fetchExpediente(c.expedienteId).then((e) => e && setExpediente(e));
  }, [c.expedienteId]);

  useEffect(() => {
    cargarExpediente();
  }, [cargarExpediente]);

  async function guardar() {
    setGuardando(true);
    const r = await guardarCondicionesContratacion(c.id, {
      puesto,
      sueldo,
      tipoContratacion: tipo,
      fechaIngreso: fechaIngreso || undefined,
      ubicacion,
      jefeDirecto: jefe,
    });
    setGuardando(false);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: "Condiciones de contratación guardadas." });
    onCambio(r.data);
  }

  async function enviarOnboarding(forzarPrueba = false) {
    setOcupado("onboarding");
    const r = await moverEtapaCandidato(c.id, "Onboarding", "", forzarPrueba);
    setOcupado("");
    if (!r.ok) {
      return setAviso({
        tono: "error", texto: r.error,
        reintentar: modoPrueba && !forzarPrueba ? () => enviarOnboarding(true) : undefined,
      });
    }
    setAviso({ tono: "ok", texto: "Candidato enviado a Onboarding." });
    onCambio(r.data);
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
        <CampoTexto label="Ubicación" value={ubicacion} onChange={setUbicacion} />
        <CampoTexto label="Jefe directo" value={jefe} onChange={setJefe} />
      </div>
      {live && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar condiciones"}
        </Button>
      )}

      <div className="mt-5 border-t border-border-faint pt-4">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Expediente · {c.expedienteProgreso ?? 0}%</Eyebrow>
          <div className="w-32">
            <Progress value={c.expedienteProgreso ?? 0} tone="good" />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {(expediente?.documentos ?? []).map((d) => (
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
          {c.expedienteId != null && (
            <a
              href={urlCartaIntencion(c.expedienteId)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-border-soft bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface-2"
            >
              <FileText className="h-3.5 w-3.5" /> Generar carta de intención
            </a>
          )}
          <Button size="sm" onClick={() => enviarOnboarding()} disabled={Boolean(ocupado)}>
            Enviar a Onboarding
          </Button>
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
