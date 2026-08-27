"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow } from "@/components/ui";
import { PageHeader, EstadoBadge, ScoreRing } from "@/components/dashboard/parts";
import { Aviso, Dropzone, pesoLegible } from "@/components/dashboard/subida";
import { candidatos as candidatosDemo, type Candidato, type EtapaCandidato, type Vacante } from "@/lib/data";
import {
  decidirCandidato,
  enviarPrefiltro,
  fetchCandidato,
  fetchCandidatos,
  fetchMensajes,
  fetchVacantes,
  registrarConsentimiento,
  seleccionarCandidato,
  subirArchivoCandidato,
  subirCVs,
  urlArchivoCandidato,
  type CargaCV,
  type MensajePrefiltro,
} from "@/lib/api";
import { useNombreRH, usePuedeDecidir } from "@/components/sesion";
import { cn } from "@/lib/utils";

const etapas: EtapaCandidato[] = ["Prefiltro", "Entrevista", "Evaluación", "Contratación"];
const etapaColor: Record<EtapaCandidato, string> = {
  Prefiltro: "var(--ink-3)",
  Entrevista: "var(--brand)",
  Evaluación: "var(--human)",
  Contratación: "var(--good)",
};

export default function Candidatos() {
  const puedeDecidir = usePuedeDecidir();
  const [sel, setSel] = useState<Candidato | null>(null);
  const [datos, setDatos] = useState<Candidato[]>(candidatosDemo);
  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [filtroVacante, setFiltroVacante] = useState<string>("");
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
  const datosFiltrados = filtroVacante
    ? datos.filter((c) => c.vacanteId === filtroVacante)
    : datos;
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
        {filtroVacante && (
          <Badge tone="brand" dot>
            {datosFiltrados.length} candidato{datosFiltrados.length !== 1 ? "s" : ""}
          </Badge>
        )}
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
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
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
  const yo = useNombreRH();
  const puedeDecidir = usePuedeDecidir();
  const [tab, setTab] = useState<"perfil_cv" | "whatsapp">("perfil_cv");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error" | "warn"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [comentario, setComentario] = useState("");
  const [seleccionar, setSeleccionar] = useState(false);

  function resolver<T>(r: { ok: true; data: T } | { ok: false; error: string }, exito: string) {
    setOcupado("");
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return null;
    }
    setAviso({ tono: "ok", texto: exito });
    return r.data;
  }

  async function decidir(accion: "avanzar" | "descartar") {
    if (!live) return setAviso({ tono: "warn", texto: "Levanta la API para registrar decisiones en la bitácora." });
    setOcupado(accion);
    const r = await decidirCandidato(c.id, accion, comentario);
    const data = resolver(r, accion === "avanzar" ? `Avanzó a ${r.ok ? r.data.etapa : ""}.` : "Candidato descartado.");
    if (data) {
      setComentario("");
      onCambio(data);
    }
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

          {tab === "perfil_cv" && <PestanaPerfilYCV c={c} live={live} onCambio={onCambio} setAviso={setAviso} />}
          {tab === "whatsapp" && <PestanaWhatsApp c={c} live={live} onCambio={onCambio} />}
        </div>

        {/* Footer Fijo con HITL y Acciones */}
        {puedeDecidir && (
          <div className="border-t border-border-soft bg-surface px-6 py-4">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex-1 w-full">
                <input
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Nota de decisión para auditoría (opcional)…"
                  className="h-10 w-full rounded-xl border border-border-soft bg-bg px-3.5 text-xs sm:text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => decidir("descartar")}
                  disabled={Boolean(ocupado)}
                  className="flex-1 sm:flex-initial"
                >
                  <ThumbsDown className="h-4 w-4 text-bad" /> Descartar
                </Button>

                <Button
                  size="sm"
                  onClick={() => decidir("avanzar")}
                  disabled={Boolean(ocupado)}
                  className="flex-1 sm:flex-initial"
                >
                  <ThumbsUp className="h-4 w-4" /> Avanzar etapa
                </Button>

                {c.expedienteId != null ? (
                  <a
                    href="/dashboard/onboarding"
                    className="flex items-center gap-1.5 rounded-xl border border-good/30 bg-good-soft px-3 py-2 text-xs font-semibold text-good transition hover:brightness-105"
                  >
                    <UserCheck className="h-4 w-4" /> Expediente ({c.expedienteProgreso ?? 0}%)
                  </a>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSeleccionar(true)}
                    disabled={Boolean(ocupado) || !live}
                    className="flex-1 sm:flex-initial"
                  >
                    <UserCheck className="h-4 w-4" /> Seleccionar
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {seleccionar && (
        <Seleccionar
          c={c}
          onClose={() => setSeleccionar(false)}
          onListo={(actualizado) => {
            setSeleccionar(false);
            setAviso({ tono: "ok", texto: "Expediente creado. El agente ya solicitó los documentos." });
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
   MODAL DE SELECCIÓN (MÓDULO 2)
   ============================================================ */
function Seleccionar({
  c,
  onClose,
  onListo,
}: {
  c: Candidato;
  onClose: () => void;
  onListo: (c: Candidato) => void;
}) {
  const yo = useNombreRH();
  const [fecha, setFecha] = useState("");
  const [extra, setExtra] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    setError("");
    const r = await seleccionarCandidato(c.id, {
      fechaIngreso: fecha || undefined,
      documentos: extra
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
      avisarWhatsapp: avisar,
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
        <h3 className="font-display text-lg font-bold">Seleccionar a {c.nombre.split(" ")[0]}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Se abre el expediente de contratación y el agente le pide sus documentos. Queda registrado a nombre de{" "}
          <b className="text-ink">{yo}</b>.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Fecha de ingreso</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Documentos adicionales</span>
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Título profesional, Licencia de conducir…"
              className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <span className="text-xs text-ink-3">
              Además de INE, CURP, RFC, comprobante de domicilio y NSS. Sepáralos con comas.
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={avisar}
              onChange={(e) => setAvisar(e.target.checked)}
              className="h-4 w-4 rounded border-border-soft accent-[var(--brand)]"
            />
            <span className="text-[13px] text-ink-2">Avisarle por WhatsApp y pedirle documentos</span>
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
          <Button className="flex-1" onClick={confirmar} disabled={enviando}>
            {enviando ? "Creando…" : "Confirmar selección"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Info({ icon: Icon, v }: { icon: React.ComponentType<{ className?: string }>; v: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs text-ink-2">
      <Icon className="h-3.5 w-3.5 text-ink-3" /> {v}
    </span>
  );
}
