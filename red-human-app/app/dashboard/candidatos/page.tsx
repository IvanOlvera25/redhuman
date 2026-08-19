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
  const [live, setLive] = useState(false);
  const [carga, setCarga] = useState(false);

  const recargar = useCallback(async (abrir?: string) => {
    const c = await fetchCandidatos();
    if (c && c.length) {
      setDatos(c);
      setLive(true);
      if (abrir) {
        const detalle = await fetchCandidato(abrir);
        if (detalle) setSel(detalle);
      }
    }
  }, []);

  useEffect(() => {
    recargar();
    fetchVacantes().then((v) => v && setVacantes(v.filter((x) => x.estado === "Publicada")));
  }, [recargar]);

  async function abrir(c: Candidato) {
    setSel(c); // respuesta inmediata con lo que ya tenemos
    if (!live) return;
    const detalle = await fetchCandidato(c.id);
    if (detalle) setSel(detalle);
  }

  const sinConsentimiento = datos.filter((c) => c.consentimiento === false).length;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Candidatos" subtitle="Pipeline de selección · prefiltrado por el agente con evidencia.">
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
          const cols = datos.filter((c) => c.etapa === etapa);
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
                    className="card-hover group rounded-xl border border-border-soft bg-surface p-3.5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <ScoreRing score={c.score} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{c.nombre}</p>
                        <p className="truncate text-xs text-ink-3">{c.puesto || "Sin vacante asignada"}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <EstadoBadge estado={c.estado} />
                      <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3">
                        {c.fuente === "WhatsApp" && <MessageCircle className="h-3 w-3" />}
                        {c.fuente}
                      </span>
                    </div>
                    {/* señales que conectan con los otros módulos */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(c.archivos ?? 0) > 0 && <Pastilla icon={FileText}>{c.archivos} archivo(s)</Pastilla>}
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

      {sel && (
        <DetalleCandidato
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
   Carga masiva de CVs → extracción y match con IA
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
    <Panel titulo="Cargar CVs" eyebrow="Ingesta de prospectos" onClose={onClose}>
      <div className="flex flex-col gap-5 p-6">
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
          Con vacante seleccionada, la IA además califica el CV contra los requisitos y deja la evidencia. La
          decisión de avanzar sigue siendo tuya.
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
                        {(r.avisos ?? []).map((a, j) => (
                          <p key={j} className="mt-1.5 text-[12px] leading-relaxed text-warn">
                            ⚠ {a}
                          </p>
                        ))}
                        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{r.candidato.evidencia}</p>
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
    </Panel>
  );
}

/* ============================================================
   Drawer de detalle del candidato
   ============================================================ */
function DetalleCandidato({
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
  const [tab, setTab] = useState<"perfil" | "archivos" | "prefiltro">("perfil");
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
    <Panel titulo={c.nombre} eyebrow={c.id} onClose={onClose} ancho="max-w-2xl">
      <div className="flex flex-col gap-5 p-6">
        {/* Identidad */}
        <div className="flex items-center gap-4">
          <div className="scale-125">
            <Avatar name={c.nombre} tone={c.tono} />
          </div>
          <div className="ml-2 min-w-0 flex-1">
            <p className="truncate text-sm text-ink-2">{c.puesto || "Sin vacante asignada"}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <EstadoBadge estado={c.estado} />
              <span className="font-mono text-[11px]" style={{ color: etapaColor[c.etapa] }}>
                {c.etapa}
              </span>
            </div>
          </div>
          <div className="text-center">
            <div className="scale-110">
              <ScoreRing score={c.score} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-ink-3">MATCH</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Info icon={MapPin} v={c.ubicacion} />
          <Info icon={Briefcase} v={c.experiencia} />
          <Info icon={MessageCircle} v={c.telefono || c.fuente} />
        </div>

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

        {/* Pestañas */}
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(
            [
              ["perfil", "Perfil"],
              ["archivos", `Archivos${c.archivos ? ` (${c.archivos})` : ""}`],
              ["prefiltro", "Conversación"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition",
                tab === k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "perfil" && <Perfil c={c} />}
        {tab === "archivos" && <Archivos c={c} live={live} onCambio={onCambio} setAviso={setAviso} />}
        {tab === "prefiltro" && <Conversacion c={c} live={live} onCambio={onCambio} />}

        {/* HITL */}
        <div className="flex items-start gap-3 rounded-2xl border border-human/25 bg-human-soft/60 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-human" />
          <p className="text-[13px] leading-relaxed text-ink-2">
            <b className="text-ink">Decisión humana requerida.</b> El agente recomienda, {yo || "RH"} aprueba.
            Ninguna decisión adversa es automática (LFPDPPP 2025).
          </p>
        </div>

        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={2}
          placeholder="Comentario de la decisión (queda en la bitácora)…"
          className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        {/* Acciones */}
        {puedeDecidir && (
        <div className="sticky bottom-0 -mx-6 flex flex-col gap-2.5 border-t border-border-soft bg-bg px-6 py-4">
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => decidir("descartar")}
              disabled={Boolean(ocupado)}
            >
              <ThumbsDown className="h-4 w-4" /> Descartar
            </Button>
            <Button className="flex-1" onClick={() => decidir("avanzar")} disabled={Boolean(ocupado)}>
              <ThumbsUp className="h-4 w-4" /> Avanzar etapa
            </Button>
          </div>

          {/* Puente al Módulo 2 */}
          {c.expedienteId != null ? (
            <a
              href="/dashboard/onboarding"
              className="flex items-center justify-center gap-2 rounded-xl border border-good/30 bg-good-soft px-4 py-2.5 text-[13px] font-semibold text-good transition hover:brightness-105"
            >
              <UserCheck className="h-4 w-4" />
              Expediente al {c.expedienteProgreso ?? 0}% · ir a contratación
            </a>
          ) : (
            <Button
              variant="secondary"
              onClick={() => setSeleccionar(true)}
              disabled={Boolean(ocupado) || !live}
              className="w-full"
            >
              <UserCheck className="h-4 w-4" /> Seleccionar y crear expediente
            </Button>
          )}
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
    </Panel>
  );
}

function Perfil({ c }: { c: Candidato }) {
  const a = c.analisis ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Evidencia del agente
          </span>
        </Eyebrow>
        <Card className="mt-2.5 p-4">
          <p className="text-[15px] leading-relaxed text-ink-2">{c.evidencia}</p>
          {a.origen && (
            <p className="mt-2 font-mono text-[10px] uppercase text-ink-3">
              origen: {a.origen} {a.ia === false && "· modo demo"}
            </p>
          )}
        </Card>
      </div>

      {(a.requisitos_cumplidos?.length || a.brechas?.length) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {a.requisitos_cumplidos?.length ? (
            <Card className="p-3.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-good">Cumple</p>
              <ul className="mt-2 space-y-1.5">
                {a.requisitos_cumplidos.map((x, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-ink-2">
                    ✓ {x}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {a.brechas?.length ? (
            <Card className="p-3.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-warn">Brechas</p>
              <ul className="mt-2 space-y-1.5">
                {a.brechas.map((x, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-ink-2">
                    ⚠ {x}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}

      {c.entrevistaEstado === "evaluada" && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Entrevista con IA</span>
            <Badge tone={c.entrevistaRecomendacion === "avanzar" ? "good" : c.entrevistaRecomendacion === "no_avanzar" ? "bad" : "warn"}>
              {c.entrevistaRecomendacion}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-ink-2">
            Match de la entrevista: <b className="text-ink">{c.entrevistaMatch}</b> / 100 ·{" "}
            <a href="/dashboard/entrevistas" className="text-brand hover:underline">
              ver evaluación completa
            </a>
          </p>
        </Card>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold">Proceso</h3>
        <ol className="relative ml-1 space-y-4 border-l border-border-soft pl-5">
          {[
            { t: "Aplicó a la vacante", d: c.aplicado, done: true, icon: FileText },
            {
              t: "Prefiltro del agente",
              d: c.prefiltroCompleto ? "completado" : "en curso",
              done: Boolean(c.prefiltroCompleto),
              icon: Sparkles,
            },
            {
              t: "Entrevista con IA",
              d: c.entrevistaEstado ?? "pendiente",
              done: c.entrevistaEstado === "evaluada",
              icon: Video,
            },
            {
              t: "Expediente de contratación",
              d: c.expedienteId != null ? `${c.expedienteProgreso ?? 0}% completo` : "pendiente",
              done: c.expedienteId != null,
              icon: UserCheck,
            },
          ].map((s, i) => (
            <li key={i} className="relative">
              <span
                className={cn(
                  "absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full border-2 border-bg",
                  s.done ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-3",
                )}
              >
                <s.icon className="h-3 w-3" />
              </span>
              <p className={cn("text-sm font-medium", !s.done && "text-ink-3")}>{s.t}</p>
              <p className="font-mono text-[11px] text-ink-3">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Archivos({
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
  const [cargando, setCargando] = useState(false);
  const lista = c.listaArchivos ?? [];

  async function subir(archivos: File[]) {
    setCargando(true);
    setAviso(null);
    const r = await subirArchivoCandidato(c.id, archivos[0], "cv");
    setCargando(false);
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return;
    }
    setAviso({ tono: "ok", texto: "CV procesado: datos y match actualizados." });
    if (r.data.candidato) onCambio(r.data.candidato);
  }

  return (
    <div className="flex flex-col gap-3">
      {live && puedeDecidir && <Dropzone compacto onArchivos={subir} cargando={cargando} titulo="Subir CV o anexo" />}

      {lista.length === 0 && !cargando && (
        <p className="py-6 text-center text-sm text-ink-3">Este prospecto todavía no tiene archivos.</p>
      )}

      {lista.map((a) => (
        <Card key={a.id} className="flex items-center gap-3 p-3">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
              a.estado === "recibido" ? "bg-good-soft text-good" : "bg-warn-soft text-warn",
            )}
          >
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{a.nombre}</p>
            <p className="font-mono text-[11px] text-ink-3">
              {a.tipo} · {pesoLegible(a.tamano)} · {a.subido} · {a.subidoPor}
            </p>
            {a.notas && <p className="mt-1 text-[12px] leading-relaxed text-warn">⚠ {a.notas}</p>}
          </div>
          <a
            href={urlArchivoCandidato(c.id, a.id)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg p-2 text-ink-3 transition hover:bg-surface-2 hover:text-brand"
            aria-label={`Descargar ${a.nombre}`}
          >
            <Download className="h-4 w-4" />
          </a>
        </Card>
      ))}
    </div>
  );
}

function Conversacion({ c, live, onCambio }: { c: Candidato; live: boolean; onCambio: (c: Candidato) => void }) {
  const [msgs, setMsgs] = useState<MensajePrefiltro[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (live) fetchMensajes(c.id).then((m) => m && setMsgs(m));
  }, [c.id, live]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto("");
    setEnviando(true);
    const r = await enviarPrefiltro(c.id, t, "simulador");
    setEnviando(false);
    if (!r.ok) return;
    const nuevos = await fetchMensajes(c.id);
    if (nuevos) setMsgs(nuevos);
    if (r.data.clasificacion) {
      const actualizado = await fetchCandidato(c.id);
      if (actualizado) onCambio(actualizado);
    }
  }

  if (!live) return <p className="py-6 text-center text-sm text-ink-3">Levanta la API para ver la conversación.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto rounded-xl bg-surface-2/60 p-3">
        {msgs.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-3">
            Sin mensajes. Escribe como si fueras el candidato para probar el prefiltro.
          </p>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
              m.rol === "assistant"
                ? "self-start rounded-bl-md bg-surface text-ink-2"
                : "self-end rounded-br-md bg-brand text-brand-ink",
            )}
          >
            {m.texto}
          </div>
        ))}
        {enviando && (
          <span className="self-start rounded-2xl rounded-bl-md bg-surface px-3.5 py-2 text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder="Responder como el candidato (simulador)…"
          className="h-11 flex-1 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button size="md" onClick={enviar} disabled={enviando || !texto.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Selección → Módulo 2 ---------------- */
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

/* ---------------- Piezas ---------------- */
function Panel({
  titulo,
  eyebrow,
  onClose,
  children,
  ancho = "max-w-xl",
}: {
  titulo: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative flex h-full w-full flex-col overflow-y-auto border-l border-border-soft bg-bg shadow-2xl",
          ancho,
        )}
      >
        <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border-soft px-6 py-4">
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="font-display truncate text-xl font-bold">{titulo}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
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
