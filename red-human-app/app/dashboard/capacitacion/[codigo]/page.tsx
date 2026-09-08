"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { Card, Badge, Button, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import {
  fetchCurso,
  fetchColaboradores,
  publicarCurso,
  asignarCurso,
  fetchReporteCurso,
  type Curso,
  type ReporteCurso,
  type Colaborador,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export default function DetalleCurso() {
  const params = useParams();
  const codigo = String(params?.codigo ?? "");

  const [curso, setCurso] = useState<Curso | null>(null);
  const [reporte, setReporte] = useState<ReporteCurso | null>(null);
  const [cargando, setCargando] = useState(true);
  const [publicando, setPublicando] = useState(false);
  const [asignarAbierto, setAsignarAbierto] = useState(false);
  const [error, setError] = useState("");

  async function cargar() {
    const [c, rep] = await Promise.all([fetchCurso(codigo), fetchReporteCurso(codigo)]);
    if (c) setCurso(c);
    if (rep) setReporte(rep);
    setCargando(false);
  }

  useEffect(() => {
    if (codigo) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  async function publicar() {
    setPublicando(true);
    setError("");
    const r = await publicarCurso(codigo);
    setPublicando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCurso(r.data);
  }

  if (cargando) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-ink-3">
        Cargando curso…
      </div>
    );
  }

  if (!curso) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Aviso tono="error">No se encontró el curso «{codigo}».</Aviso>
        <Link href="/dashboard/capacitacion" className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand">
          <ArrowLeft className="h-4 w-4" /> Volver a Capacitación
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/dashboard/capacitacion" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Capacitación
      </Link>

      <PageHeader title={curso.titulo} subtitle={curso.categoria || "Sin categoría"}>
        {curso.obligatorio && <Badge tone="human">Obligatorio</Badge>}
        <Badge tone={curso.estado === "Publicado" ? "good" : "neutral"} dot>{curso.estado}</Badge>
        {curso.estado === "Borrador" && (
          <Button size="sm" onClick={publicar} disabled={publicando}>
            {publicando ? "Publicando…" : "Publicar"}
          </Button>
        )}
        {curso.estado === "Publicado" && (
          <Button size="sm" onClick={() => setAsignarAbierto(true)}>
            <Send className="h-4 w-4" /> Asignar
          </Button>
        )}
      </PageHeader>

      {error && (
        <div className="mt-4">
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-ink-3" /> {curso.duracionHoras} h</span>
        <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-ink-3" /> {curso.modulos} módulos</span>
        <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-ink-3" /> {curso.asignados} asignado(s) · {curso.completados} completado(s)</span>
      </div>

      <Card className="mt-5 p-4">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold">Objetivo del curso</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{curso.objetivo}</p>
      </Card>

      <div className="mt-5">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">Temario</p>
        <div className="space-y-3">
          {(curso.listaModulos ?? []).map((m) => (
            <Card key={m.orden} className="p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft font-mono text-xs font-bold text-brand">{m.orden}</span>
                <h3 className="font-display text-base font-bold">{m.titulo}</h3>
              </div>
              <p className="mt-2 pl-11 text-sm leading-relaxed text-ink-2">{m.contenido}</p>
              {m.preguntasVerificacion.length > 0 && (
                <div className="mt-3 space-y-1.5 pl-11">
                  {m.preguntasVerificacion.map((p, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-ink-3">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                      <span>{p.pregunta}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {reporte && reporte.totalAsignados > 0 && <SeccionProgreso reporte={reporte} />}

      {asignarAbierto && (
        <ModalAsignar
          codigo={codigo}
          yaAsignados={new Set((reporte?.colaboradores ?? []).map((c) => c.colaboradorId))}
          onClose={() => setAsignarAbierto(false)}
          onListo={() => {
            setAsignarAbierto(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completado: "Completado",
};

function SeccionProgreso({ reporte }: { reporte: ReporteCurso }) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function alternar(id: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-6">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">Progreso</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Asignados", v: reporte.totalAsignados },
          { l: "Completados", v: reporte.completados },
          { l: "En curso", v: reporte.enCurso },
          { l: "Pendientes", v: reporte.pendientes },
        ].map((s) => (
          <Card key={s.l} className="p-4 text-center">
            <div className="font-display text-2xl font-bold tabular">{s.v}</div>
            <div className="mt-0.5 text-xs text-ink-3">{s.l}</div>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-sm text-ink-2">Tasa de finalización</p>
          <p className="font-display mt-1 text-2xl font-bold tabular">{reporte.tasaFinalizacion}%</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-2">Duración promedio real</p>
          <p className="font-display mt-1 text-2xl font-bold tabular">
            {reporte.duracionPromedioHoras != null ? `${reporte.duracionPromedioHoras} h` : "—"}
          </p>
        </Card>
      </div>

      {reporte.porModulo.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">Comprensión por módulo</p>
          <div className="space-y-2">
            {reporte.porModulo.map((m) => (
              <div key={m.orden} className="rounded-xl border border-border-soft bg-surface p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{m.orden}. {m.titulo}</span>
                  <span className="font-mono text-xs text-ink-3">
                    {m.comprendioPct != null ? `${m.comprendioPct}% comprendió · ${m.totalEvaluados} evaluado(s)` : "Sin datos todavía"}
                  </span>
                </div>
                {m.comprendioPct != null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn("h-full rounded-full", m.comprendioPct >= 70 ? "bg-good" : "bg-warn")}
                      style={{ width: `${m.comprendioPct}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold">Colaboradores asignados</p>
        <div className="space-y-2">
          {reporte.colaboradores.map((c) => {
            const abierto = expandidos.has(c.asignacionId);
            return (
              <div key={c.asignacionId} className="rounded-xl border border-border-soft bg-surface">
                <button
                  onClick={() => c.resultadoEvaluacion && alternar(c.asignacionId)}
                  className={cn(
                    "flex w-full items-center justify-between p-3 text-left text-sm",
                    c.resultadoEvaluacion && "hover:bg-surface-2",
                  )}
                >
                  <span className="font-medium">{c.colaboradorNombre}</span>
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    {c.estado === "completado" && <CheckCircle2 className="h-3.5 w-3.5 text-good" />}
                    {ESTADO_LABEL[c.estado] ?? c.estado}
                    {c.estado !== "pendiente" && ` · módulo ${c.moduloActual}`}
                  </span>
                </button>
                {abierto && c.resultadoEvaluacion && (
                  <div className="space-y-1.5 border-t border-border-faint px-3 py-2.5">
                    {c.resultadoEvaluacion.modulos.map((m) => (
                      <div key={m.modulo} className="flex items-start gap-2 text-xs text-ink-2">
                        {m.comprendio ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                        ) : (
                          <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-warn" />
                        )}
                        <span>
                          <b>{m.titulo}:</b> {m.comentario}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ModalAsignar({
  codigo,
  yaAsignados,
  onClose,
  onListo,
}: {
  codigo: string;
  yaAsignados: Set<string>;
  onClose: () => void;
  onListo: () => void;
}) {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchColaboradores(true).then((c) => {
      if (c) setColaboradores(c);
      setCargando(false);
    });
  }, []);

  const filtrados = colaboradores.filter(
    (c) => !busqueda.trim() || normalizarTexto(c.nombre).includes(normalizarTexto(busqueda)),
  );

  function alternar(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function asignar() {
    if (seleccion.size === 0) {
      setError("Selecciona al menos un colaborador.");
      return;
    }
    setEnviando(true);
    setError("");
    const r = await asignarCurso(codigo, Array.from(seleccion));
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onListo();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="flex max-h-[80vh] w-full max-w-md flex-col p-5">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow>Asignar curso</Eyebrow>
            <h3 className="font-display text-lg font-bold">Selecciona colaboradores</h3>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre…"
            className="h-11 w-full rounded-xl border border-border-soft bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
          {cargando && (
            <div className="flex items-center justify-center py-8 text-ink-3">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!cargando && filtrados.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-3">Sin colaboradores activos que coincidan.</p>
          )}
          {filtrados.map((c) => {
            const asignado = yaAsignados.has(c.id);
            return (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-soft bg-surface px-3 py-2.5 text-sm hover:border-brand/40"
              >
                <input
                  type="checkbox"
                  checked={seleccion.has(c.id)}
                  onChange={() => alternar(c.id)}
                  className="h-4 w-4 rounded border-border-soft"
                />
                <span className="flex-1">
                  <span className="font-medium">{c.nombre}</span>
                  <span className="block text-xs text-ink-3">{c.puesto}</span>
                </span>
                {asignado && <Badge tone="neutral">Ya asignado</Badge>}
              </label>
            );
          })}
        </div>

        {error && (
          <div className="mt-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        )}

        <div className="mt-4 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={asignar} disabled={enviando || seleccion.size === 0}>
            {enviando ? "Asignando…" : `Asignar (${seleccion.size})`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
