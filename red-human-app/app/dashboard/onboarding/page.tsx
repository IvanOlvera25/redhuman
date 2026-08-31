"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileCheck2,
  Clock,
  FileText,
  Send,
  ShieldCheck,
  Check,
  CalendarClock,
  MapPin,
  ChevronRight,
  ChevronDown,
  X,
  Plus,
  Download,
  ExternalLink,
  Sparkles,
  UserCheck,
  MessageCircle,
  Video,
} from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso, Dropzone, pesoLegible } from "@/components/dashboard/subida";
import { nuevosIngresos, type DocExpediente, type EstadoDoc, type NuevoIngreso } from "@/lib/phase2";
import type { Candidato } from "@/lib/data";
import {
  actualizarPreparacion,
  agregarDocumento,
  autorizarAlta,
  enviarRecordatorio,
  fetchCandidato,
  fetchExpedientes,
  fetchMensajes,
  marcarDocumento,
  solicitarDocumentosCandidato,
  subirDocumento,
  urlDocumento,
  type MensajePrefiltro,
} from "@/lib/api";
import { useNombreRH, usePuedeDecidir } from "@/components/sesion";
import { cn } from "@/lib/utils";

const docConfig: Record<
  EstadoDoc,
  { tone: "good" | "warn" | "neutral" | "bad"; label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  recibido: { tone: "good", label: "Recibido", icon: Check },
  revision: { tone: "warn", label: "En revisión", icon: Clock },
  rechazado: { tone: "bad", label: "Rechazado", icon: X },
  pendiente: { tone: "neutral", label: "Pendiente", icon: FileText },
};

const iconoFondo: Record<EstadoDoc, string> = {
  recibido: "bg-good-soft text-good",
  revision: "bg-warn-soft text-warn",
  rechazado: "bg-bad-soft text-bad",
  pendiente: "bg-surface-2 text-ink-3",
};

type AvisoEstado = { tono: "ok" | "error" | "warn" | "info"; texto: string } | null;

export default function Onboarding() {
  const [datos, setDatos] = useState<NuevoIngreso[]>(nuevosIngresos);
  const [selId, setSelId] = useState<string>(nuevosIngresos[0].id);
  const [live, setLive] = useState(false);
  const [aviso, setAviso] = useState<AvisoEstado>(null);

  const sel = datos.find((d) => d.id === selId) ?? datos[0];

  const recargar = useCallback(async () => {
    const e = await fetchExpedientes();
    if (e && e.length) {
      setDatos(e);
      setLive(true);
      setSelId((actual) => (e.some((x) => x.id === actual) ? actual : e[0].id));
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /** Aplica el expediente que devuelve la API tras cualquier mutación. */
  const aplicar = useCallback((actualizado: NuevoIngreso) => {
    setDatos((prev) => prev.map((d) => (d.id === actualizado.id ? actualizado : d)));
  }, []);

  const pendientes = datos.reduce((acc, n) => acc + n.documentos.filter((d) => d.estado !== "recibido").length, 0);
  const listos = datos.filter((n) => n.listoParaAlta).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Onboarding e integración"
        subtitle="Expedientes de nuevo ingreso · el agente solicita, revisa y da seguimiento."
      >
        {live && (
          <Badge tone="good" dot>
            API en vivo
          </Badge>
        )}
        {listos > 0 && (
          <Badge tone="good" dot>
            {listos} listo(s) para alta
          </Badge>
        )}
        <Badge tone="warn" dot>
          {pendientes} documentos pendientes
        </Badge>
      </PageHeader>

      <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Lista */}
        <div className="flex flex-col gap-3">
          {datos.map((n) => {
            const active = n.id === sel.id;
            return (
              <button
                key={n.id}
                onClick={() => setSelId(n.id)}
                className={cn(
                  "card-hover rounded-2xl border bg-surface p-4 text-left",
                  active ? "border-brand ring-1 ring-brand/30" : "border-border-soft",
                )}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={n.nombre} tone={n.tono} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{n.nombre}</p>
                    <p className="truncate text-xs text-ink-3">{n.puesto}</p>
                  </div>
                  <ChevronRight className={cn("h-4 w-4", active ? "text-brand" : "text-ink-3")} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn("h-full rounded-full transition-all", n.progreso === 100 ? "bg-good" : "bg-brand")}
                      style={{ width: `${n.progreso}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] font-semibold tabular">{n.progreso}%</span>
                </div>
                {n.estado === "alta" && (
                  <p className="mt-2 font-mono text-[10px] text-good">✓ alta autorizada</p>
                )}
              </button>
            );
          })}
        </div>

        <Expediente
          key={sel.id}
          n={sel}
          live={live}
          aviso={aviso}
          setAviso={setAviso}
          onActualizado={aplicar}
          onRecargar={recargar}
        />
      </div>
    </div>
  );
}

/* ============================================================
   Detalle del expediente — 6 bloques, de arriba hacia abajo
   ============================================================ */
function Expediente({
  n,
  live,
  aviso,
  setAviso,
  onActualizado,
  onRecargar,
}: {
  n: NuevoIngreso;
  live: boolean;
  aviso: AvisoEstado;
  setAviso: (a: AvisoEstado) => void;
  onActualizado: (n: NuevoIngreso) => void;
  onRecargar: () => void;
}) {
  const [ocupado, setOcupado] = useState("");
  const [nuevoDoc, setNuevoDoc] = useState("");
  const [verEvaluacion, setVerEvaluacion] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const yo = useNombreRH();
  const puedeDecidir = usePuedeDecidir();

  const exigeApi = () => {
    setAviso({ tono: "warn", texto: "Levanta la API para operar el expediente con datos reales." });
    return false;
  };

  const soloLectura = !live || !puedeDecidir || n.estado === "alta";

  async function solicitarFaltantes() {
    if (!live || !n.candidatoId) return exigeApi();
    setOcupado("solicitar");
    const r = await solicitarDocumentosCandidato(n.candidatoId);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: "Solicitud de documentos enviada por WhatsApp." });
  }

  async function recordatorio() {
    if (!live || !n.expedienteId) return exigeApi();
    setOcupado("recordatorio");
    const r = await enviarRecordatorio(n.expedienteId);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso(
      r.data.enviado
        ? { tono: "ok", texto: `Recordatorio enviado por ${r.data.pendientes?.length ?? 0} documento(s) pendiente(s).` }
        : { tono: "info", texto: r.data.detalle ?? "Sin documentos pendientes 🎉" },
    );
    onActualizado(r.data.expediente);
  }

  async function alta() {
    if (!live || !n.expedienteId) return exigeApi();
    setOcupado("alta");
    const r = await autorizarAlta(n.expedienteId);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `Alta autorizada por ${yo} y registrada en la bitácora ✓ — movido a Colaboradores.` });
    onActualizado(r.data.expediente);
  }

  async function agregar() {
    if (!live || !n.expedienteId || !nuevoDoc.trim()) return;
    setOcupado("agregar");
    const r = await agregarDocumento(n.expedienteId, nuevoDoc.trim(), true);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setNuevoDoc("");
    setAviso({ tono: "ok", texto: `«${nuevoDoc.trim()}» agregado al expediente.` });
    onActualizado(r.data);
  }

  async function actualizarPrep(campo: "contrato" | "altaAdministrativa" | "equipoAccesos", valor: string) {
    if (!live || !n.expedienteId) return exigeApi();
    setOcupado(`prep-${campo}`);
    const r = await actualizarPreparacion(n.expedienteId, { [campo]: valor });
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    onActualizado(r.data);
  }

  const bloqueoAlta =
    n.estado === "alta"
      ? "Este expediente ya fue dado de alta."
      : n.progreso < 100
        ? `Faltan documentos: ${(n.pendientes ?? []).join(", ") || "por definir"}.`
        : (n.sinConfirmar?.length ?? 0) > 0
          ? `Confirma como RH los documentos validados por la IA: ${n.sinConfirmar!.join(", ")}.`
          : "";

  const recibidos = n.documentos.filter((d) => d.estado === "recibido").length;
  const evaluacion = n.evaluacion;
  const brechas = evaluacion?.brechas ?? [];
  const resultado = brechas.length > 0 ? "Apto con observaciones" : "Apto";

  return (
    <Card className="overflow-hidden">
      {/* ============ BLOQUE 1 — Encabezado ============ */}
      <div className="flex flex-col gap-4 border-b border-border-faint p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="scale-110">
            <Avatar name={n.nombre} tone={n.tono} />
          </div>
          <div className="ml-1 min-w-0">
            <div className="flex items-center gap-2">
              <Eyebrow>Onboarding</Eyebrow>
            </div>
            <h2 className="font-display truncate text-xl font-bold">{n.nombre}</h2>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
              <span>{n.puesto}</span>
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {n.ubicacionTrabajo || n.ubicacion}
              </span>
              <span className="flex items-center gap-1 text-human">
                <CalendarClock className="h-3 w-3" /> {n.ingreso}
              </span>
              <span className="flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> Responsable: {n.seleccionadoPor || "RH"}
              </span>
              {n.candidatoId && (
                <a href="/dashboard/candidatos" className="flex items-center gap-1 text-brand transition hover:underline">
                  <ExternalLink className="h-3 w-3" /> {n.candidatoId}
                </a>
              )}
            </div>
          </div>
        </div>
        {n.estado === "alta" ? (
          <Badge tone="good" dot>
            Alta autorizada
          </Badge>
        ) : n.listoParaAlta ? (
          <Badge tone="good" dot>
            Listo para alta
          </Badge>
        ) : n.progreso === 100 ? (
          <Badge tone="warn" dot>
            Falta confirmación de RH
          </Badge>
        ) : (
          <Badge tone="warn" dot>
            En integración
          </Badge>
        )}
      </div>

      {/* Condiciones de contratación — capturadas en la etapa Contratación, se mantienen visibles aquí */}
      {(n.sueldo || n.tipoContratacion || n.jefeDirecto) && (
        <div className="flex flex-wrap gap-2 border-b border-border-faint bg-surface-2/40 px-5 py-3">
          {n.sueldo && (
            <span className="rounded-lg border border-border-soft bg-surface px-2.5 py-1 font-mono text-xs text-brand">
              {n.sueldo}
            </span>
          )}
          {n.tipoContratacion && (
            <span className="rounded-lg border border-border-soft bg-surface px-2.5 py-1 text-xs text-ink-2">
              {n.tipoContratacion}
            </span>
          )}
          {n.jefeDirecto && (
            <span className="rounded-lg border border-border-soft bg-surface px-2.5 py-1 text-xs text-ink-2">
              Jefe directo: {n.jefeDirecto}
            </span>
          )}
        </div>
      )}

      {/* ============ BLOQUE 2 — Resumen de evaluación ============ */}
      <div className="border-b border-border-faint p-5">
        <Eyebrow>Resumen de evaluación</Eyebrow>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="font-display text-2xl font-bold tabular">{evaluacion?.score ?? n.score ?? 0}</span>
          <Badge tone={resultado === "Apto" ? "good" : "warn"} dot>
            {resultado}
          </Badge>
          {brechas.length > 0 && (
            <span className="text-xs text-ink-3">
              {brechas.length} punto{brechas.length !== 1 ? "s" : ""} pendiente{brechas.length !== 1 ? "s" : ""}
            </span>
          )}
          {n.entrevistaMatch != null && (
            <span className="text-xs text-ink-3">
              · entrevista {n.entrevistaMatch} ({n.entrevistaRecomendacion})
            </span>
          )}
        </div>

        <button
          onClick={() => setVerEvaluacion((x) => !x)}
          className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", verEvaluacion && "rotate-180")} />
          {verEvaluacion ? "Ocultar evaluación completa" : "Ver evaluación completa"}
        </button>

        {verEvaluacion && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {evaluacion?.evidencia && (
              <p className="text-[13px] leading-relaxed text-ink-2 sm:col-span-2">{evaluacion.evidencia}</p>
            )}
            {(evaluacion?.requisitosCumplidos?.length ?? 0) > 0 && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-good">Requisitos cumplidos</span>
                <ul className="mt-1.5 space-y-1">
                  {evaluacion!.requisitosCumplidos.map((x, i) => (
                    <li key={i} className="text-xs text-ink-2">
                      • {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brechas.length > 0 && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-warn">Puntos pendientes</span>
                <ul className="mt-1.5 space-y-1">
                  {brechas.map((x, i) => (
                    <li key={i} className="text-xs text-ink-2">
                      • {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(evaluacion?.alertas?.length ?? 0) > 0 && (
              <div className="sm:col-span-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Alertas del CV</span>
                <ul className="mt-1.5 space-y-1">
                  {evaluacion!.alertas.map((x, i) => (
                    <li key={i} className="text-xs text-ink-3">
                      • {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============ BLOQUE 3 — Expediente de ingreso ============ */}
      <div className="border-b border-border-faint p-5">
        <div className="flex items-center justify-between">
          <Eyebrow>Expediente de ingreso</Eyebrow>
          {(n.porRevisar?.length ?? 0) > 0 && (
            <span className="font-mono text-[10px] text-warn">{n.porRevisar!.length} por revisar</span>
          )}
        </div>
        <p className="mt-1.5 text-sm font-semibold text-ink">
          Expediente {n.progreso}% — {recibidos} de {n.documentos.length} documentos recibidos
        </p>

        <div className="mt-3 space-y-2">
          {n.documentos.map((d) => (
            <Documento
              key={d.nombre}
              d={d}
              expedienteId={n.expedienteId}
              live={live && puedeDecidir && n.estado !== "alta"}
              setAviso={setAviso}
              onActualizado={onActualizado}
            />
          ))}
        </div>

        {!soloLectura && (
          <div className="mt-3 flex gap-2">
            <input
              value={nuevoDoc}
              onChange={(e) => setNuevoDoc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && agregar()}
              placeholder="Pedir otro documento…"
              className="h-9 flex-1 rounded-lg border border-border-soft bg-surface px-3 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <Button size="sm" variant="outline" onClick={agregar} disabled={!nuevoDoc.trim() || Boolean(ocupado)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        {!soloLectura && (
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Button variant="outline" size="sm" onClick={solicitarFaltantes} disabled={Boolean(ocupado)}>
              <MessageCircle className="h-4 w-4" />
              {ocupado === "solicitar" ? "Enviando…" : "Solicitar documentos faltantes"}
            </Button>
            <Button variant="outline" size="sm" onClick={recordatorio} disabled={Boolean(ocupado)}>
              <Send className="h-4 w-4" />
              {ocupado === "recordatorio" ? "Enviando…" : "Enviar recordatorio"}
            </Button>
          </div>
        )}
      </div>

      {/* ============ BLOQUE 4 — Preparación de ingreso ============ */}
      <div className="border-b border-border-faint p-5">
        <Eyebrow>Preparación de ingreso</Eyebrow>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <TogglePrep
            label="Contrato"
            valor={n.contrato ?? "Pendiente"}
            opciones={["Pendiente", "Firmado"]}
            onChange={(v) => actualizarPrep("contrato", v)}
            disabled={soloLectura || Boolean(ocupado)}
          />
          <TogglePrep
            label="Alta administrativa"
            valor={n.altaAdministrativa ?? "Pendiente"}
            opciones={["Pendiente", "Realizada"]}
            onChange={(v) => actualizarPrep("altaAdministrativa", v)}
            disabled={soloLectura || Boolean(ocupado)}
          />
          <TogglePrep
            label="Equipo y accesos"
            valor={n.equipoAccesos ?? "Pendiente"}
            opciones={["Pendiente", "Listo", "No aplica"]}
            onChange={(v) => actualizarPrep("equipoAccesos", v)}
            disabled={soloLectura || Boolean(ocupado)}
          />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
          <CalendarClock className="h-3.5 w-3.5" /> Fecha prevista de ingreso: {n.ingreso}
        </p>
      </div>

      {/* ============ BLOQUE 5 — Acción final ============ */}
      <div className="border-b border-border-faint p-5">
        {aviso && (
          <div className="mb-3">
            <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>
              {aviso.texto}
            </Aviso>
          </div>
        )}
        {bloqueoAlta && n.estado !== "alta" && (
          <p className="mb-3 text-[12px] leading-relaxed text-ink-3">{bloqueoAlta}</p>
        )}

        {/* Siempre visible y habilitado en Onboarding — el progreso de documentos ya no lo
            oculta ni lo deshabilita. Si faltan documentos obligatorios, el backend rechaza
            la petición (409) y el mensaje aparece arriba en {aviso}; el botón nunca desaparece. */}
        <Button size="lg" className="w-full" disabled={Boolean(ocupado) || n.estado === "alta"} onClick={alta}>
          <FileCheck2 className="h-5 w-5" />
          {n.estado === "alta" ? "Alta completada ✓" : ocupado === "alta" ? "Dando de alta…" : "DAR DE ALTA COMO COLABORADOR"}
        </Button>

        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-human/25 bg-human-soft/50 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-human" />
          <p className="text-[13px] leading-relaxed text-ink-2">
            <b className="text-ink">RH autoriza el alta.</b> El agente prepara el expediente y valida los documentos;
            la decisión final la firma {yo}. Al confirmar, el registro se mueve a Colaboradores.
          </p>
        </div>

        {live && (
          <button onClick={onRecargar} className="mt-2 font-mono text-[11px] text-ink-3 transition hover:text-brand">
            actualizar
          </button>
        )}
      </div>

      {/* ============ BLOQUE 6 — Historial del candidato (colapsable) ============ */}
      <div>
        <button
          onClick={() => setVerHistorial((x) => !x)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm font-semibold text-ink-2 transition hover:bg-surface-2/50"
        >
          <span>Historial del candidato (CV, chats, entrevistas)</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", verHistorial && "rotate-180")} />
        </button>
        {verHistorial && <HistorialCandidato candidatoId={n.candidatoId} />}
      </div>
    </Card>
  );
}

/* ---------------- Toggle de 2-3 estados (bloque 4) ---------------- */
function TogglePrep({
  label,
  valor,
  opciones,
  onChange,
  disabled,
}: {
  label: string;
  valor: string;
  opciones: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <div className="mt-1.5 flex gap-1 rounded-xl border border-border-soft bg-surface-2/60 p-1">
        {opciones.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            disabled={disabled}
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
              valor === o ? "bg-surface text-brand shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Bloque 6: historial completo, carga perezosa ---------------- */
function HistorialCandidato({ candidatoId }: { candidatoId?: string }) {
  const [candidato, setCandidato] = useState<Candidato | null>(null);
  const [mensajes, setMensajes] = useState<MensajePrefiltro[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!candidatoId) {
      setCargando(false);
      return;
    }
    Promise.all([fetchCandidato(candidatoId), fetchMensajes(candidatoId)]).then(([c, m]) => {
      if (c) setCandidato(c);
      if (m) setMensajes(m);
      setCargando(false);
    });
  }, [candidatoId]);

  if (cargando) return <div className="border-t border-border-faint p-5 text-xs text-ink-3">Cargando historial…</div>;
  if (!candidato) return <div className="border-t border-border-faint p-5 text-xs text-ink-3">Sin datos adicionales.</div>;

  const cv = (candidato.cvDatos || {}) as Record<string, unknown>;
  const habilidades = (cv.habilidades as string[]) || [];
  const estudios = (cv.estudios as string[]) || [];
  const resumen = (cv.experiencia_resumen as string) || candidato.experiencia;

  return (
    <div className="flex flex-col gap-5 border-t border-border-faint p-5">
      {/* CV */}
      <div>
        <Eyebrow>Currículum</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{resumen || "Sin resumen de experiencia disponible."}</p>
        {habilidades.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {habilidades.map((h, i) => (
              <span key={i} className="rounded-md bg-brand-soft/50 px-2 py-0.5 text-[11px] text-brand-ink">
                {h}
              </span>
            ))}
          </div>
        )}
        {estudios.length > 0 && (
          <ul className="mt-2 space-y-1">
            {estudios.map((e, i) => (
              <li key={i} className="text-xs text-ink-3">
                • {e}
              </li>
            ))}
          </ul>
        )}
        {candidato.listaArchivos?.some((a) => a.tipo === "cv") && (
          <div className="mt-2 flex flex-wrap gap-2">
            {candidato.listaArchivos
              .filter((a) => a.tipo === "cv")
              .map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded-lg border border-border-soft px-2.5 py-1 text-[11px] text-ink-2">
                  <FileText className="h-3.5 w-3.5" /> {a.nombre}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Entrevistas */}
      {(candidato.entrevistas?.length ?? 0) > 0 && (
        <div>
          <Eyebrow>Entrevistas</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {candidato.entrevistas!.map((e) => {
              const ev = e.evaluacion as { recomendacion?: string; match_perfil?: number } | null;
              return (
                <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface px-3 py-2 text-xs">
                  <Video className="h-3.5 w-3.5 text-ink-3" />
                  <span className="font-medium">{e.tipo}</span>
                  <span className="text-ink-3">· {e.estado}</span>
                  {ev?.recomendacion && <span className="text-ink-3">· {ev.recomendacion} ({ev.match_perfil ?? 0})</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chat de WhatsApp */}
      <div>
        <Eyebrow>Chat de WhatsApp ({mensajes.length})</Eyebrow>
        {mensajes.length === 0 ? (
          <p className="mt-2 text-xs text-ink-3">Sin mensajes registrados.</p>
        ) : (
          <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-border-soft bg-surface-2/40 p-3">
            {mensajes.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed",
                  m.rol === "assistant" ? "self-start bg-surface text-ink-2" : "self-end bg-brand text-brand-ink",
                )}
              >
                {m.texto}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Un documento del checklist (Bloque 3) ---------------- */
function Documento({
  d,
  expedienteId,
  live,
  setAviso,
  onActualizado,
}: {
  d: DocExpediente;
  expedienteId?: number;
  live: boolean;
  setAviso: (a: AvisoEstado) => void;
  onActualizado: (n: NuevoIngreso) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const c = docConfig[d.estado];

  // Vista simplificada que pide el bloque 3: Recibido / Pendiente / No aplica.
  const noAplica = d.obligatorio === false;
  const badgeLabel = noAplica ? "No aplica" : d.estado === "recibido" ? "Recibido" : "Pendiente";
  const badgeTone: "good" | "warn" | "neutral" = noAplica ? "neutral" : d.estado === "recibido" ? "good" : "warn";

  async function subir(archivos: File[]) {
    if (!expedienteId) return;
    setCargando(true);
    setAviso(null);
    const r = await subirDocumento(expedienteId, d.nombre, archivos[0]);
    setCargando(false);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    const est = r.data.documento.estado;
    setAviso({
      tono: est === "recibido" ? "ok" : est === "rechazado" ? "error" : "warn",
      texto: `${d.nombre}: ${est === "recibido" ? "validado por la IA" : r.data.documento.notas}`,
    });
    onActualizado(r.data.expediente);
  }

  async function marcar(estado: string, recibidoFisico = false) {
    if (!expedienteId) return;
    setCargando(true);
    const r = await marcarDocumento(expedienteId, {
      tipo: d.nombre,
      estado,
      recibidoFisico,
    });
    setCargando(false);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `${d.nombre} marcado como ${estado}.` });
    onActualizado(r.data);
  }

  const v = d.validacion;
  const necesitaConfirmar = d.estado === "recibido" && !d.revisadoPor;

  return (
    <div className="rounded-xl border border-border-soft bg-surface">
      <button
        onClick={() => live && setAbierto((x) => !x)}
        className={cn("flex w-full items-center gap-3 p-3 text-left", live && "cursor-pointer")}
      >
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", iconoFondo[d.estado])}>
          <c.icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{d.nombre}</span>
          {d.subido && <span className="font-mono text-[10px] text-ink-3">{d.subido}</span>}
        </span>
        {necesitaConfirmar && <span className="shrink-0 font-mono text-[10px] text-warn">confirmar</span>}
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
      </button>

      {abierto && live && (
        <div className="flex flex-col gap-3 border-t border-border-faint p-3">
          {d.notas && <p className="text-[12px] leading-relaxed text-ink-2">{d.notas}</p>}

          {v && (
            <div className="flex flex-wrap gap-1.5">
              <Check3 label="tipo" valor={v.coincideTipo} />
              <Check3 label="legible" valor={v.legible} />
              <Check3 label="completo" valor={v.completo} />
              <Check3 label="vigente" valor={v.vigente} />
              <Check3 label="titular" valor={v.coincideTitular} />
            </div>
          )}

          <Dropzone
            compacto
            cargando={cargando}
            onArchivos={subir}
            titulo={d.tieneArchivo ? "Reemplazar archivo" : `Subir ${d.nombre}`}
          />

          <div className="flex flex-wrap items-center gap-2">
            {d.tieneArchivo && expedienteId && (
              <a
                href={urlDocumento(expedienteId, d.nombre)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border-soft px-2.5 py-1.5 text-[12px] text-ink-2 transition hover:border-brand hover:text-brand"
              >
                <Download className="h-3.5 w-3.5" /> Ver {d.tamano ? `(${pesoLegible(d.tamano)})` : ""}
              </a>
            )}
            {d.estado !== "recibido" || necesitaConfirmar ? (
              <button
                onClick={() => marcar("recibido", !d.tieneArchivo)}
                disabled={cargando}
                className="inline-flex items-center gap-1 rounded-lg border border-good/30 bg-good-soft px-2.5 py-1.5 text-[12px] font-medium text-good transition hover:brightness-105 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {d.tieneArchivo ? "Confirmar recibido" : "Recibido en físico"}
              </button>
            ) : null}
            {d.estado !== "rechazado" && (
              <button
                onClick={() => marcar("rechazado")}
                disabled={cargando}
                className="inline-flex items-center gap-1 rounded-lg border border-bad/30 px-2.5 py-1.5 text-[12px] font-medium text-bad transition hover:bg-bad-soft disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Pedir de nuevo
              </button>
            )}
          </div>

          {d.revisadoPor && <p className="font-mono text-[10px] text-ink-3">revisado por {d.revisadoPor}</p>}
        </div>
      )}
    </div>
  );
}

/** Semáforo de una comprobación de la IA: sí / no / no aplica. */
function Check3({ label, valor }: { label: string; valor?: boolean | null }) {
  const estilo =
    valor === true
      ? "bg-good-soft text-good"
      : valor === false
        ? "bg-bad-soft text-bad"
        : "bg-surface-2 text-ink-3";
  const marca = valor === true ? "✓" : valor === false ? "✗" : "–";
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[10px]", estilo)}>
      {marca} {label}
    </span>
  );
}
