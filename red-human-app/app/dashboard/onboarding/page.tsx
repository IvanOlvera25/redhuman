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
  X,
  Plus,
  Download,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso, Dropzone, pesoLegible } from "@/components/dashboard/subida";
import { nuevosIngresos, type DocExpediente, type EstadoDoc, type NuevoIngreso } from "@/lib/phase2";
import {
  agregarDocumento,
  autorizarAlta,
  enviarRecordatorio,
  fetchExpedientes,
  marcarDocumento,
  subirDocumento,
  urlDocumento,
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
   Detalle del expediente
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
  const yo = useNombreRH();
  const puedeDecidir = usePuedeDecidir();

  const exigeApi = () => {
    setAviso({ tono: "warn", texto: "Levanta la API para operar el expediente con datos reales." });
    return false;
  };

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
    setAviso({ tono: "ok", texto: `Alta autorizada por ${yo} y registrada en la bitácora ✓` });
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

  const bloqueoAlta =
    n.estado === "alta"
      ? "Este expediente ya fue dado de alta."
      : n.progreso < 100
        ? `Faltan documentos: ${(n.pendientes ?? []).join(", ") || "por definir"}.`
        : (n.sinConfirmar?.length ?? 0) > 0
          ? `Confirma como RH los documentos validados por la IA: ${n.sinConfirmar!.join(", ")}.`
          : "";

  return (
    <Card className="overflow-hidden">
      {/* Encabezado */}
      <div className="flex flex-col gap-4 border-b border-border-faint p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="scale-110">
            <Avatar name={n.nombre} tone={n.tono} />
          </div>
          <div className="ml-1 min-w-0">
            <h2 className="font-display truncate text-xl font-bold">{n.nombre}</h2>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
              <span>{n.puesto}</span>
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {n.ubicacion}
              </span>
              <span className="flex items-center gap-1 text-human">
                <CalendarClock className="h-3 w-3" /> {n.ingreso}
              </span>
              {n.candidatoId && (
                <a
                  href="/dashboard/candidatos"
                  className="flex items-center gap-1 text-brand transition hover:underline"
                >
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

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        {/* Checklist de documentos */}
        <div>
          <div className="flex items-center justify-between">
            <Eyebrow>Expediente · {n.progreso}%</Eyebrow>
            {(n.porRevisar?.length ?? 0) > 0 && (
              <span className="font-mono text-[10px] text-warn">{n.porRevisar!.length} por revisar</span>
            )}
          </div>

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

          {live && puedeDecidir && n.estado !== "alta" && (
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
        </div>

        {/* Proceso + acciones */}
        <div className="flex flex-col gap-4">
          <div>
            <Eyebrow>Proceso de integración</Eyebrow>
            <ol className="relative ml-1 mt-3 space-y-3 border-l border-border-soft pl-5">
              {[
                { t: `Seleccionado por ${n.seleccionadoPor || "RH"}`, done: true },
                { t: "Solicitud de documentos enviada", done: true },
                { t: "Documentos recibidos y validados por IA", done: n.progreso === 100 },
                { t: "Confirmación humana de cada documento", done: Boolean(n.listoParaAlta) || n.estado === "alta" },
                {
                  t: n.altaAutorizadaPor ? `Alta autorizada por ${n.altaAutorizadaPor}` : "Alta como colaborador",
                  done: n.estado === "alta",
                },
              ].map((s, i) => (
                <li key={i} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full border-2 border-surface",
                      s.done ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-3",
                    )}
                  >
                    {s.done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <p className={cn("text-sm", s.done ? "font-medium" : "text-ink-3")}>{s.t}</p>
                </li>
              ))}
            </ol>
          </div>

          {(n.score ?? 0) > 0 && (
            <Card className="p-3.5">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                <Sparkles className="h-3 w-3" /> Viene del pipeline
              </span>
              <p className="mt-1.5 text-[13px] text-ink-2">
                Match de prefiltro <b className="text-ink">{n.score}</b>
                {n.entrevistaMatch != null && (
                  <>
                    {" "}
                    · entrevista <b className="text-ink">{n.entrevistaMatch}</b> ({n.entrevistaRecomendacion})
                  </>
                )}
              </p>
            </Card>
          )}

          <div className="flex items-start gap-2.5 rounded-xl border border-human/25 bg-human-soft/50 p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-human" />
            <p className="text-[13px] leading-relaxed text-ink-2">
              <b className="text-ink">RH autoriza el alta.</b> El agente prepara el expediente y valida los
              documentos; la decisión final la firma {yo}.
            </p>
          </div>

          {aviso && <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso>}

          {bloqueoAlta && n.estado !== "alta" && (
            <p className="text-[12px] leading-relaxed text-ink-3">{bloqueoAlta}</p>
          )}

          <div className="flex gap-2.5">
            <Button variant="outline" className="flex-1" size="sm" onClick={recordatorio} disabled={Boolean(ocupado)}>
              <Send className="h-4 w-4" />
              {ocupado === "recordatorio" ? "Enviando…" : "Recordatorio"}
            </Button>
            <Button
              className="flex-1"
              size="sm"
              disabled={Boolean(ocupado) || !n.listoParaAlta || n.estado === "alta"}
              onClick={alta}
            >
              <FileCheck2 className="h-4 w-4" />
              {n.estado === "alta" ? "Alta completada ✓" : ocupado === "alta" ? "Dando de alta…" : "Dar de alta como colaborador"}
            </Button>
          </div>

          {live && (
            <button
              onClick={onRecargar}
              className="self-end font-mono text-[11px] text-ink-3 transition hover:text-brand"
            >
              actualizar
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Un documento del checklist ---------------- */
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
          <span className="block truncate text-sm font-medium">
            {d.nombre}
            {d.obligatorio === false && <span className="ml-1.5 text-[10px] font-normal text-ink-3">(opcional)</span>}
          </span>
          {d.subido && <span className="font-mono text-[10px] text-ink-3">{d.subido}</span>}
        </span>
        {necesitaConfirmar && <span className="shrink-0 font-mono text-[10px] text-warn">confirmar</span>}
        <Badge tone={c.tone}>{c.label}</Badge>
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

          {d.revisadoPor && (
            <p className="font-mono text-[10px] text-ink-3">revisado por {d.revisadoPor}</p>
          )}
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
