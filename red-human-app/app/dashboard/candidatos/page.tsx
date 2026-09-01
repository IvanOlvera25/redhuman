"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  GraduationCap,
  Award,
  Globe,
  RotateCw,
  Mail,
  Phone,
  CalendarClock,
  FlaskConical,
  ChevronDown,
} from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow, Progress } from "@/components/ui";
import { PageHeader, EstadoBadge, ScoreRing } from "@/components/dashboard/parts";
import { Aviso, Dropzone, pesoLegible } from "@/components/dashboard/subida";
import { candidatos as candidatosDemo, type Candidato, type EtapaCandidato, type Vacante } from "@/lib/data";
import type { DocExpediente, NuevoIngreso } from "@/lib/phase2";
import {
  autorizarAlta,
  cancelarExpediente,
  decidirCandidato,
  enviarPrefiltro,
  fetchCandidato,
  fetchCandidatos,
  fetchEntrevistadores,
  fetchExpediente,
  fetchMensajes,
  fetchVacantes,
  guardarCondicionesContratacion,
  liberarTelefonoCandidato,
  marcarEntrevistaHumanaRealizada,
  moverEtapaCandidato,
  programarEntrevistaHumana,
  recordatorioDocumentosCandidato,
  registrarConsentimiento,
  solicitarDocumentosCandidato,
  subirArchivoCandidato,
  subirCVs,
  subirDocumento,
  urlArchivoCandidato,
  urlDocumento,
  type CargaCV,
  type MensajePrefiltro,
  type ModalidadEntrevistaHumana,
} from "@/lib/api";
import { usePuedeDecidir } from "@/components/sesion";
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

export default function Candidatos() {
  const puedeDecidir = usePuedeDecidir();
  const [sel, setSel] = useState<Candidato | null>(null);
  const [datos, setDatos] = useState<Candidato[]>(candidatosDemo);
  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [filtroVacante, setFiltroVacante] = useState<string>("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [live, setLive] = useState(false);
  const [carga, setCarga] = useState(false);

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
  }, [recargar]);

  async function abrir(c: Candidato) {
    setSel(c);
    if (!live) return;
    const detalle = await fetchCandidato(c.id);
    if (detalle) setSel(detalle);
  }

  const sinConsentimiento = datos.filter((c) => c.consentimiento === false).length;
  const datosFiltrados = datos.filter(
    (c) => (!filtroVacante || c.vacanteId === filtroVacante) && coincideEstado(c, filtroEstado),
  );
  const vacanteSeleccionada = vacantes.find((v) => v.id === filtroVacante);

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

      {/* Filtro por vacante */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <select
            id="filtro-vacante"
            value={filtroVacante}
            onChange={(e) => setFiltroVacante(e.target.value)}
            className="h-11 min-w-[260px] appearance-none rounded-xl border border-border-soft bg-surface pl-9 pr-8 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">Todas las vacantes</option>
            {vacantes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.titulo}{v.ubicacion ? ` · ${v.ubicacion}` : ""}
              </option>
            ))}
          </select>
        </div>
        {/* Barra de filtro por estado */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border-soft bg-surface-2/60 p-1">
          {FILTROS_ESTADO.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltroEstado(f.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                filtroEstado === f.key
                  ? "bg-surface text-brand shadow-sm"
                  : "text-ink-3 hover:bg-surface/60 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Badge tone="brand" dot>
          {datosFiltrados.length} candidato{datosFiltrados.length !== 1 ? "s" : ""}
        </Badge>
        {filtroVacante && vacanteSeleccionada && (
          <button
            onClick={() => setFiltroVacante("")}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-3 transition hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3 w-3" /> Limpiar filtro
          </button>
        )}
      </div>

      {live && sinConsentimiento > 0 && (
        <div className="mt-4">
          <Aviso tono="warn">
            {sinConsentimiento} candidato(s) sin consentimiento registrado. Sin él no se puede abrir expediente de
            contratación (LFPDPPP 2025).
          </Aviso>
        </div>
      )}

      {/* Kanban */}
      <div className="mt-6 grid gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {etapas.map((etapa) => {
          const cols = datosFiltrados.filter((c) => c.etapa === etapa);
          return (
            <div key={etapa} className="flex flex-col rounded-2xl border border-border-soft bg-surface-2/40 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: etapaColor[etapa] }} />
                  <span className="text-sm font-semibold">{etapa}</span>
                </div>
                <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-3">
                  {cols.length}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {cols.map((c) => (
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
                        <p className="truncate text-sm font-semibold group-hover:text-brand">{c.nombre}</p>
                        <p className="truncate text-xs text-ink-3">{c.puesto || "Sin vacante asignada"}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand">
                            Score CV: {c.score}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <EstadoBadge estado={c.estado} />
                      <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3">
                        {c.fuente === "WhatsApp" ? (
                          <span className="inline-flex items-center gap-1 text-good font-semibold">
                            <MessageCircle className="h-3 w-3" /> WhatsApp
                          </span>
                        ) : (
                          c.fuente
                        )}
                      </span>
                    </div>
                    {/* señales */}
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
                  </button>
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

/* ============================================================
   MODAL CENTRADO: Detalle del Candidato (2 Pestañas)
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
  const [tab, setTab] = useState<"perfil_cv" | "whatsapp">("perfil_cv");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error" | "warn"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [comentario, setComentario] = useState("");
  const [modalEntrevista, setModalEntrevista] = useState(false);
  const [verEvaluacionIA, setVerEvaluacionIA] = useState(false);

  function resolver<T>(r: { ok: true; data: T } | { ok: false; error: string }, exito: string) {
    setOcupado("");
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
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

  /** Botón explícito de avance — PATCH /candidatos/{codigo}/etapa con el destino exacto. */
  async function enviarAEtapa(etapa: EtapaCandidato) {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado(etapa);
    const r = await moverEtapaCandidato(c.id, etapa, comentario);
    const data = resolver(r, `Enviado a ${etapa}.`);
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
   * obligatorios, el backend lo rechaza (409) y el motivo se muestra en {aviso}. */
  async function darDeAltaComoColaborador() {
    if (!live || !c.expedienteId) return setAviso({ tono: "warn", texto: "Levanta la API para dar de alta al candidato." });
    setOcupado("alta");
    const r = await autorizarAlta(c.expedienteId);
    if (!r.ok) {
      setOcupado("");
      return setAviso({ tono: "error", texto: r.error });
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
            <EstadoBadge estado={c.estado} />
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2 transition"
              aria-label="Cerrar modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Barra de Pestañas Principales (2 Pestañas) */}
        <div className="border-b border-border-soft bg-surface-2/70 px-6 pt-3">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("perfil_cv")}
              className={cn(
                "flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition border-b-2",
                tab === "perfil_cv"
                  ? "bg-bg text-brand border-brand shadow-sm"
                  : "border-transparent text-ink-3 hover:text-ink hover:bg-surface/50",
              )}
            >
              <FileText className="h-4 w-4" />
              Perfil y CV
            </button>

            <button
              onClick={() => setTab("whatsapp")}
              className={cn(
                "flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition border-b-2",
                tab === "whatsapp"
                  ? "bg-bg text-good border-good shadow-sm"
                  : "border-transparent text-ink-3 hover:text-ink hover:bg-surface/50",
              )}
            >
              <MessageCircle className="h-4 w-4" />
              Chat de WhatsApp
              {Boolean(c.mensajes) && (
                <span className="rounded-full bg-good/15 px-2 py-0.2 font-mono text-[11px] text-good font-bold">
                  {c.mensajes}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Cuerpo Scrolleable */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-5">
          {aviso && <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso>}

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
          {c.etapa === "Contratación" && <PanelContratacion c={c} live={live} onCambio={onCambio} setAviso={setAviso} />}

          {tab === "perfil_cv" && <PestanaPerfilYCV c={c} live={live} onCambio={onCambio} setAviso={setAviso} />}
          {tab === "whatsapp" && <PestanaWhatsApp c={c} live={live} onCambio={onCambio} />}
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

              {/* Etapa Entrevista IA: resumen en línea de la evaluación del avatar, si ya existe. */}
              {c.etapa === "Entrevista IA" && (c.entrevistaMatch != null || c.entrevistaRecomendacion) && (
                <div>
                  <button
                    onClick={() => setVerEvaluacionIA((x) => !x)}
                    className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", verEvaluacionIA && "rotate-180")} />
                    {verEvaluacionIA ? "Ocultar evaluación" : "Ver evaluación"}
                  </button>
                  {verEvaluacionIA && (
                    <div className="mt-2 rounded-xl border border-border-soft bg-bg p-3 text-xs text-ink-2">
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
                  )}
                </div>
              )}

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
                  onClick={darDeAltaComoColaborador}
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
   PESTAÑA 1: Perfil y CV (Score de Afinidad + Análisis de CV)
   ============================================================ */
function PestanaPerfilYCV({
  c,
  live,
  onCambio,
  setAviso,
}: {
  c: Candidato;
  live: boolean;
  onCambio: (c: Candidato) => void;
  setAviso: (a: { tono: "ok" | "error" | "warn"; texto: string } | null) => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const [cargandoCV, setCargandoCV] = useState(false);

  const cv = (c.cvDatos || {}) as Record<string, unknown>;
  const anios = cv.anios_experiencia as number | undefined;
  const resumen = (cv.experiencia_resumen as string) || c.experiencia;
  const puestoActual = (cv.puesto_actual as string) || "";
  const ultimoEmpleo = (cv.ultimo_empleo as string) || "";
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
      {/* Datos de contacto rápidos */}
      <div className="flex flex-wrap gap-2">
        {c.ubicacion && <Info icon={MapPin} v={c.ubicacion} />}
        {c.telefono && <Info icon={Phone} v={c.telefono} />}
        {c.correo && <Info icon={Mail} v={c.correo} />}
        {c.experiencia && <Info icon={Briefcase} v={c.experiencia} />}
        {c.fuente === "WhatsApp" && <Info icon={MessageCircle} v="Canal: WhatsApp" />}
      </div>

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

      {/* Análisis y Extracción del Currículum */}
      <div>
        <Eyebrow>Análisis y Extracción del Currículum</Eyebrow>
        <Card className="mt-2 p-5">
          <p className="text-sm leading-relaxed text-ink-2">{resumen || "Sin resumen de experiencia disponible."}</p>

          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {anios != null && (
              <div className="rounded-xl bg-surface-2 p-3">
                <span className="block font-mono text-[10px] text-ink-3">Experiencia total</span>
                <span className="text-sm font-bold text-ink">{anios} años</span>
              </div>
            )}
            {puestoActual && (
              <div className="rounded-xl bg-surface-2 p-3">
                <span className="block font-mono text-[10px] text-ink-3">Puesto más reciente</span>
                <span className="truncate text-sm font-bold text-ink">{puestoActual}</span>
              </div>
            )}
            {ultimoEmpleo && (
              <div className="rounded-xl bg-surface-2 p-3 col-span-2 sm:col-span-1">
                <span className="block font-mono text-[10px] text-ink-3">Última empresa / periodo</span>
                <span className="truncate text-sm font-bold text-ink">{ultimoEmpleo}</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Habilidades detectadas */}
      {habilidades.length > 0 && (
        <div>
          <Eyebrow>Habilidades y Competencias ({habilidades.length})</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-2">
            {habilidades.map((h, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand-soft/40 px-3 py-1.5 text-xs font-medium text-brand-ink"
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
  const eh = c.entrevistaHumana;
  const [confirmando, setConfirmando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [error, setError] = useState("");

  async function confirmarRealizada() {
    setMarcando(true);
    setError("");
    const r = await marcarEntrevistaHumanaRealizada(c.id);
    setMarcando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setConfirmando(false);
    onCambio(r.data);
  }

  if (!eh) return null;

  return (
    <Card className="border-[color:var(--brand-2)]/30 bg-surface-2/40 p-4">
      <Eyebrow>Entrevista Humana programada</Eyebrow>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <Info icon={UserCheck} v={`Entrevistador(a): ${eh.entrevistador || "sin asignar"}`} />
        <Info
          icon={CalendarClock}
          v={eh.fecha ? new Date(eh.fecha).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Sin fecha"}
        />
        <Info icon={Video} v={`Modalidad: ${eh.modalidad || "sin definir"}`} />
      </div>
      {eh.comentario && <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{eh.comentario}</p>}

      {error && (
        <div className="mt-3">
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}

      <div className="mt-3.5">
        {eh.realizada ? (
          <Badge tone="good" dot>
            Entrevista realizada
          </Badge>
        ) : live ? (
          <Button size="sm" variant="secondary" onClick={() => setConfirmando(true)} disabled={marcando}>
            <CheckCircle2 className="h-4 w-4" /> Marcar entrevista realizada
          </Button>
        ) : null}
      </div>

      {confirmando && (
        <ModalConfirmar
          titulo="¿La entrevista ya se realizó?"
          texto="Al confirmar se habilitan los botones «Descartar» y «Enviar a Contratación» para este candidato."
          onCancelar={() => setConfirmando(false)}
          onConfirmar={confirmarRealizada}
          cargando={marcando}
        />
      )}
    </Card>
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
  const [entrevistadores, setEntrevistadores] = useState<string[]>([]);
  const [entrevistador, setEntrevistador] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadEntrevistaHumana>("Videollamada");
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetchEntrevistadores().then((d) => {
      if (d && d.length) {
        setEntrevistadores(d);
        setEntrevistador(d[0]);
      }
    });
  }, []);

  async function programar() {
    if (!entrevistador.trim() || !fecha || !hora) {
      setError("Completa entrevistador, fecha y hora.");
      return;
    }
    setEnviando(true);
    setError("");
    const r = await programarEntrevistaHumana(c.id, { entrevistador, fecha, hora, modalidad, comentario });
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
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Entrevistador(a)</span>
            {entrevistadores.length > 0 ? (
              <select
                value={entrevistador}
                onChange={(e) => setEntrevistador(e.target.value)}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {entrevistadores.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={entrevistador}
                onChange={(e) => setEntrevistador(e.target.value)}
                placeholder="Nombre de quien entrevista"
                className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            )}
          </label>

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
  setAviso: (a: { tono: "ok" | "error" | "warn"; texto: string } | null) => void;
}) {
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

  async function enviarOnboarding() {
    setOcupado("onboarding");
    const r = await moverEtapaCandidato(c.id, "Onboarding");
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
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
          <Button size="sm" onClick={enviarOnboarding} disabled={Boolean(ocupado)}>
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
