"use client";

/* Módulo de Desempeño (2026-09-23). Flujo completo en una pantalla, con el mismo lenguaje del resto de
   la plataforma: Crear evaluación → Seleccionar colaboradores (roster maestro) → Evaluar → Resultados
   (brechas y fortalezas) → Acciones (asignar capacitación).

   REGLA DE ORO: las personas SIEMPRE salen de Colaboradores; aquí nunca se captura gente. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Loader2, Plus, Search, Sparkles, Target,
  TrendingUp, Trophy, UserPlus, Users, X,
} from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { AvisoLinea, CampoRH as Campo, Cargando, KpiRH as Kpi, ListaEditable, ModalMarco, inputRH as inputCls, type AvisoRH } from "@/components/dashboard/modulos-rh";
import { usePuedeDecidir } from "@/components/sesion";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import {
  agregarParticipantesDesempeno,
  cambiarEstadoCiclo,
  crearCicloDesempeno,
  fetchCiclosDesempeno,
  fetchColaboradores,
  fetchEvaluacionDesempeno,
  fetchResultadosCiclo,
  generarPlanDesempeno,
  guardarEvaluacionDesempeno,
  type CicloDesempeno,
  type Colaborador,
  type EvaluacionDesempeno,
  type KpiDesempeno,
  type ObjetivoDesempeno,
  type ResultadoDesempeno,
  type ResultadosCiclo,
} from "@/lib/api";

type Aviso = AvisoRH;

const ESTADO_TONO: Record<string, "neutral" | "brand" | "good"> = { borrador: "neutral", en_curso: "brand", cerrado: "good" };
const ESTADO_LABEL: Record<string, string> = { borrador: "Borrador", en_curso: "En curso", cerrado: "Cerrado" };

export default function Desempeno() {
  const puedeDecidir = usePuedeDecidir();
  const [ciclos, setCiclos] = useState<CicloDesempeno[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);   // código del ciclo en detalle
  const [crear, setCrear] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const recargar = useCallback(async () => {
    const c = await fetchCiclosDesempeno();
    setCiclos(c ?? []);
  }, []);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  usePolling(recargar);

  if (abierto) {
    return <DetalleCiclo codigo={abierto} onVolver={() => { setAbierto(null); void recargar(); }} puedeDecidir={puedeDecidir} />;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Desempeño"
        subtitle="Evaluaciones por periodo sobre el roster de colaboradores: objetivos y KPIs, resultados, brechas y plan de acción."
      >
        {puedeDecidir && (
          <Button size="sm" onClick={() => setCrear(true)}>
            <Plus className="h-4 w-4" /> Crear evaluación
          </Button>
        )}
      </PageHeader>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {ciclos === null ? (
        <div className="mt-10 grid place-items-center text-ink-3"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : ciclos.length === 0 ? (
        <Card className="mt-6 p-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Target className="h-7 w-7" /></span>
          <h2 className="font-display mt-4 text-xl font-bold">Todavía no hay evaluaciones</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            Crea la evaluación del periodo con sus objetivos y KPIs —Red Human puede proponerlos— y después elige
            a quién de tu equipo vas a evaluar.
          </p>
          {puedeDecidir && (
            <Button className="mt-5" onClick={() => setCrear(true)}>
              <Plus className="h-4 w-4" /> Crear la primera evaluación
            </Button>
          )}
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ciclos.map((c) => (
            <button
              key={c.id}
              onClick={() => setAbierto(c.id)}
              className="card-hover group flex flex-col rounded-2xl border border-border-soft bg-surface p-5 text-left transition-all hover:border-brand/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold group-hover:text-brand">{c.nombre}</p>
                  <p className="font-mono text-[11px] text-ink-3">{c.id}{c.periodo ? ` · ${c.periodo}` : ""}</p>
                </div>
                <Badge tone={ESTADO_TONO[c.estado] ?? "neutral"} dot>{ESTADO_LABEL[c.estado] ?? c.estado}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2">{c.objetivos.length} objetivos</span>
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2">{c.kpis.length} KPIs</span>
                {c.generadoConIa && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-2 py-1 font-semibold text-brand">
                    <Sparkles className="h-3 w-3" /> con IA
                  </span>
                )}
              </div>
              <div className="mt-auto pt-4">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-ink-3">{c.completadas} de {c.participantes} evaluados</span>
                  <span className="font-mono font-bold tabular">{c.avance}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${c.avance}%` }} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {crear && (
        <ModalCrearCiclo
          onClose={() => setCrear(false)}
          onCreado={(c) => { setCrear(false); setAviso({ tono: "ok", texto: `Evaluación «${c.nombre}» creada. Ahora elige a quién vas a evaluar.` }); void recargar(); setAbierto(c.id); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Paso 1 — Crear evaluación (captura manual o propuesta de Red Human)
   ============================================================ */

function ModalCrearCiclo({ onClose, onCreado }: { onClose: () => void; onCreado: (c: CicloDesempeno) => void }) {
  const [nombre, setNombre] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [puesto, setPuesto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [objetivos, setObjetivos] = useState<ObjetivoDesempeno[]>([{ titulo: "", descripcion: "", peso: 0 }]);
  const [kpis, setKpis] = useState<KpiDesempeno[]>([{ nombre: "", unidad: "", meta: "", peso: 0 }]);
  const [conIa, setConIa] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const limpios = {
    objetivos: objetivos.filter((o) => o.titulo.trim()),
    kpis: kpis.filter((k) => k.nombre.trim()),
  };
  const pesoTotal = [...limpios.objetivos, ...limpios.kpis].reduce((a, x) => a + Number(x.peso || 0), 0);

  async function generar() {
    setGenerando(true);
    setError("");
    const r = await generarPlanDesempeno({ puesto, periodo, contexto: descripcion });
    setGenerando(false);
    if (!r.ok) return setError(r.error);
    setObjetivos(r.data.objetivos.length ? r.data.objetivos : objetivos);
    setKpis(r.data.kpis.length ? r.data.kpis : kpis);
    setConIa(r.data.generadoConIa);
  }

  async function guardar() {
    if (!nombre.trim()) return setError("Ponle nombre a la evaluación.");
    if (!limpios.objetivos.length && !limpios.kpis.length) return setError("Captura al menos un objetivo o un KPI.");
    setGuardando(true);
    setError("");
    const r = await crearCicloDesempeno({
      nombre, periodo, descripcion, puestoObjetivo: puesto,
      objetivos: limpios.objetivos, kpis: limpios.kpis, generadoConIa: conIa,
    });
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    onCreado(r.data);
  }

  return (
    <ModalMarco titulo="Crear evaluación de desempeño" subtitulo="Define el periodo y lo que se va a evaluar. Red Human puede proponerlo y tú lo editas." onClose={onClose} ancho="max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Nombre de la evaluación"><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Desempeño 2026-S2" className={inputCls} /></Campo>
        <Campo label="Periodo"><input value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="Ej. 2026-S2 · Q3 2026 · Anual 2026" className={inputCls} /></Campo>
        <Campo label="Puesto o equipo (contexto para la IA)"><input value={puesto} onChange={(e) => setPuesto(e.target.value)} placeholder="Ej. Cajeros de sucursal" className={inputCls} /></Campo>
        <Campo label="Notas (opcional)"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué quieres reforzar este periodo" className={inputCls} /></Campo>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/25 bg-brand-soft/40 p-3.5">
        <Button size="sm" variant="secondary" onClick={generar} disabled={generando}>
          {generando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generando ? "Proponiendo…" : "Proponer con Red Human"}
        </Button>
        <span className="text-[12px] text-ink-2">
          Red Human sugiere objetivos y KPIs para ese puesto. Tú los editas, borras o agregas —nunca inventa metas numéricas que no le diste.
        </span>
      </div>

      <ListaEditable
        titulo="Objetivos"
        filas={objetivos}
        onCambio={setObjetivos}
        nuevo={() => ({ titulo: "", descripcion: "", peso: 0 })}
        render={(o, set) => (
          <>
            <input value={o.titulo} onChange={(e) => set({ ...o, titulo: e.target.value })} placeholder="Objetivo observable" className={cn(inputCls, "sm:col-span-3")} />
            <input value={o.descripcion ?? ""} onChange={(e) => set({ ...o, descripcion: e.target.value })} placeholder="Cómo se observa (opcional)" className={cn(inputCls, "sm:col-span-2")} />
            <input type="number" min={0} max={100} value={o.peso ?? 0} onChange={(e) => set({ ...o, peso: Number(e.target.value) })} placeholder="%" className={inputCls} />
          </>
        )}
      />

      <ListaEditable
        titulo="KPIs"
        filas={kpis}
        onCambio={setKpis}
        nuevo={() => ({ nombre: "", unidad: "", meta: "", peso: 0 })}
        render={(k, set) => (
          <>
            <input value={k.nombre} onChange={(e) => set({ ...k, nombre: e.target.value })} placeholder="Indicador medible" className={cn(inputCls, "sm:col-span-2")} />
            <input value={k.unidad ?? ""} onChange={(e) => set({ ...k, unidad: e.target.value })} placeholder="Unidad (%, pzas…)" className={inputCls} />
            <input value={k.meta ?? ""} onChange={(e) => set({ ...k, meta: e.target.value })} placeholder="Meta" className={cn(inputCls, "sm:col-span-2")} />
            <input type="number" min={0} max={100} value={k.peso ?? 0} onChange={(e) => set({ ...k, peso: Number(e.target.value) })} placeholder="%" className={inputCls} />
          </>
        )}
      />

      <p className={cn("mt-3 text-xs", pesoTotal === 100 ? "text-good" : "text-ink-3")}>
        Peso total: <b className="font-mono tabular">{pesoTotal}%</b> {pesoTotal === 100 ? "· perfecto" : "· lo ideal es que sume 100 (si no, la calificación se promedia parejo)"}
      </p>

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Crear y elegir colaboradores
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ============================================================
   Pasos 2-5 — Participantes · Evaluar · Resultados · Acciones
   ============================================================ */

function DetalleCiclo({ codigo, onVolver, puedeDecidir }: { codigo: string; onVolver: () => void; puedeDecidir: boolean }) {
  const [datos, setDatos] = useState<ResultadosCiclo | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [agregar, setAgregar] = useState(false);
  const [evaluando, setEvaluando] = useState<EvaluacionDesempeno | null>(null);
  const [ocupado, setOcupado] = useState("");

  const recargar = useCallback(async () => {
    const r = await fetchResultadosCiclo(codigo);
    if (r) setDatos(r);
  }, [codigo]);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  usePolling(recargar);

  async function abrirEvaluacion(e: EvaluacionDesempeno) {
    const completa = await fetchEvaluacionDesempeno(e.id);
    setEvaluando(completa ?? e);
  }

  async function cerrarCiclo() {
    if (!datos) return;
    setOcupado("cerrar");
    const r = await cambiarEstadoCiclo(codigo, datos.ciclo.estado === "cerrado" ? "en_curso" : "cerrado");
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: r.data.estado === "cerrado" ? "Evaluación cerrada: los resultados quedan como histórico." : "Evaluación reabierta." });
    void recargar();
  }

  if (!datos) {
    return <div className="mx-auto max-w-7xl px-4 py-16 text-center text-ink-3"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  }

  const c = datos.ciclo;
  const pendientes = datos.pendientes;
  const escala = datos.escalaMaxima || 100;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={onVolver} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 transition hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Todas las evaluaciones
      </button>

      <PageHeader title={c.nombre} subtitle={`${c.id}${c.periodo ? ` · ${c.periodo}` : ""} · creada por ${c.creadoPor || "RH"}`}>
        <Badge tone={ESTADO_TONO[c.estado] ?? "neutral"} dot>{ESTADO_LABEL[c.estado] ?? c.estado}</Badge>
        {puedeDecidir && (
          <>
            <Button size="sm" variant="outline" onClick={() => setAgregar(true)}>
              <UserPlus className="h-4 w-4" /> Agregar colaboradores
            </Button>
            <Button size="sm" variant="secondary" onClick={cerrarCiclo} disabled={ocupado === "cerrar"}>
              {c.estado === "cerrado" ? "Reabrir" : "Cerrar evaluación"}
            </Button>
          </>
        )}
      </PageHeader>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {/* Resumen */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Colaboradores" valor={String(datos.total)} pie={`${datos.completadas} evaluados`} icono={<Users className="h-4 w-4" />} />
        <Kpi etiqueta="Avance" valor={`${datos.avance}%`} pie="de las evaluaciones" icono={<ClipboardList className="h-4 w-4" />} />
        <Kpi etiqueta="Calificación promedio" valor={datos.promedio === null ? "—" : `${datos.promedio}`} pie={`sobre ${escala}`} icono={<TrendingUp className="h-4 w-4" />} />
        <Kpi etiqueta="Brechas detectadas" valor={String(datos.brechas.length)} pie="temas por reforzar" icono={<Target className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Personas */}
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border-faint p-5">
            <div>
              <h3 className="font-display text-lg font-bold">Colaboradores en esta evaluación</h3>
              <p className="text-sm text-ink-3">Del roster de la empresa · una evaluación por persona</p>
            </div>
          </div>
          {datos.total === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-semibold text-ink">Aún no eliges a quién evaluar.</p>
              <p className="mt-1 text-xs text-ink-3">Elige del roster de colaboradores activos.</p>
              {puedeDecidir && <Button size="sm" className="mt-4" onClick={() => setAgregar(true)}><UserPlus className="h-4 w-4" /> Seleccionar colaboradores</Button>}
            </div>
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Colaborador</th>
                    <th className="px-5 py-2.5 font-semibold">Área / puesto</th>
                    <th className="px-5 py-2.5 font-semibold">Estado</th>
                    <th className="px-5 py-2.5 font-semibold">Calificación</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-faint">
                  {[...datos.ranking, ...pendientes].map((e) => (
                    <tr key={e.id} className="transition hover:bg-surface-2/50">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-ink">{e.colaborador}</p>
                        <p className="font-mono text-[11px] text-ink-3">{e.colaboradorId}</p>
                      </td>
                      <td className="px-5 py-3 text-ink-2">{[e.area, e.puesto].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-5 py-3">
                        <Badge tone={e.estado === "completada" ? "good" : e.estado === "en_curso" ? "brand" : "neutral"} dot>
                          {e.estado === "completada" ? "Evaluado" : e.estado === "en_curso" ? "En curso" : "Pendiente"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        {e.calificacion === null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold tabular">{e.calificacion}</span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className={cn("h-full rounded-full", e.calificacion >= escala * 0.8 ? "bg-good" : e.calificacion >= escala * 0.6 ? "bg-warn" : "bg-bad")}
                                style={{ width: `${Math.min(100, (e.calificacion / escala) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {puedeDecidir && (
                          <Button size="sm" variant={e.estado === "completada" ? "outline" : "primary"} onClick={() => abrirEvaluacion(e)}>
                            {e.estado === "completada" ? "Ver / corregir" : "Evaluar"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Brechas y fortalezas + acciones */}
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <Eyebrow><span className="inline-flex items-center gap-1.5"><Target className="h-3.5 w-3.5" /> Brechas por reforzar</span></Eyebrow>
            {datos.brechas.length === 0 ? (
              <p className="mt-3 text-sm text-ink-3">Sin brechas registradas todavía. Se llenan al evaluar a cada persona.</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {datos.brechas.map((b) => (
                  <div key={b.tema} className="rounded-xl border border-border-soft bg-surface p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{b.tema}</span>
                      <Badge tone="warn">{b.personas} {b.personas === 1 ? "persona" : "personas"}</Badge>
                    </div>
                    {b.acciones.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
                        {b.acciones.map((a, i) => <li key={i} className="flex items-start gap-1.5"><ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-brand" /> {a}</li>)}
                      </ul>
                    )}
                    <p className="mt-2 truncate text-[11px] text-ink-3" title={b.colaboradores.join(", ")}>{b.colaboradores.join(", ")}</p>
                  </div>
                ))}
              </div>
            )}
            {/* Acciones: el plan de capacitación nace de las brechas */}
            <Button href="/dashboard/capacitacion" variant="secondary" size="sm" className="mt-4 w-full">
              Asignar capacitación <ArrowRight className="h-4 w-4" />
            </Button>
          </Card>

          <Card className="p-5">
            <Eyebrow><span className="inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> Fortalezas del equipo</span></Eyebrow>
            {datos.fortalezas.length === 0 ? (
              <p className="mt-3 text-sm text-ink-3">Aparecen solas: son los objetivos y KPIs con 85% de logro o más.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {datos.fortalezas.map((f) => (
                  <li key={f.tema} className="flex items-center justify-between gap-2 rounded-xl bg-good-soft/50 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink">{f.tema}</span>
                    <span className="shrink-0 font-mono text-xs font-bold text-good tabular">{f.promedio}% · {f.personas}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {agregar && (
        <ModalParticipantes
          codigo={codigo}
          yaDentro={[...datos.ranking, ...pendientes].map((e) => e.colaboradorId ?? "")}
          onClose={() => setAgregar(false)}
          onListo={(n, faltantes) => {
            setAgregar(false);
            setAviso({
              tono: faltantes.length ? "warn" : "ok",
              texto: `${n} colaborador(es) agregados a la evaluación.${faltantes.length ? ` No encontrados o inactivos: ${faltantes.join(", ")}.` : ""}`,
            });
            void recargar();
          }}
        />
      )}

      {evaluando && (
        <ModalEvaluar
          evaluacion={evaluando}
          ciclo={c}
          onClose={() => setEvaluando(null)}
          onGuardado={(msg) => { setEvaluando(null); setAviso({ tono: "ok", texto: msg }); void recargar(); }}
        />
      )}
    </div>
  );
}

/* ---------- Paso 2: seleccionar del roster ---------- */

function ModalParticipantes({ codigo, yaDentro, onClose, onListo }: {
  codigo: string; yaDentro: string[]; onClose: () => void; onListo: (n: number, faltantes: string[]) => void;
}) {
  const [roster, setRoster] = useState<Colaborador[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchColaboradores(true).then((c) => setRoster(c ?? []));
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (roster ?? []).filter((c) => !q || c.nombre.toLowerCase().includes(q) || (c.puesto ?? "").toLowerCase().includes(q) || (c.area ?? "").toLowerCase().includes(q));
  }, [roster, busqueda]);

  async function guardar() {
    setOcupado(true);
    setError("");
    const r = await agregarParticipantesDesempeno(codigo, sel);
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onListo(r.data.evaluaciones.length, r.data.noEncontrados);
  }

  return (
    <ModalMarco titulo="Seleccionar colaboradores" subtitulo="Del roster de la empresa. Si alguien no aparece, se da de alta primero desde Contratación." onClose={onClose}>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, puesto o área…" className={cn(inputCls, "pl-9")} />
      </label>

      <div className="mt-3 max-h-[46vh] overflow-y-auto rounded-2xl border border-border-soft">
        {roster === null ? (
          <div className="grid place-items-center py-10 text-ink-3"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtrados.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">No hay colaboradores activos que coincidan.</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {filtrados.map((c) => {
              const dentro = yaDentro.includes(c.id);
              const marcado = sel.includes(c.id);
              return (
                <li key={c.id}>
                  <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 transition", dentro ? "opacity-50" : "hover:bg-surface-2/60")}>
                    <input
                      type="checkbox"
                      disabled={dentro}
                      checked={marcado}
                      onChange={() => setSel(marcado ? sel.filter((x) => x !== c.id) : [...sel, c.id])}
                      className="h-4 w-4 rounded border-border-soft text-brand"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{c.nombre}</p>
                      <p className="truncate text-[11px] text-ink-3">{[c.area, c.puesto].filter(Boolean).join(" · ") || "Sin puesto"} · {c.id}</p>
                    </div>
                    {dentro && <span className="shrink-0 text-[11px] font-semibold text-good">Ya está</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-3">{sel.length} seleccionado(s)</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button size="sm" onClick={guardar} disabled={!sel.length || ocupado}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Agregar a la evaluación
          </Button>
        </div>
      </div>
    </ModalMarco>
  );
}

/* ---------- Paso 3: evaluar ---------- */

function ModalEvaluar({ evaluacion, ciclo, onClose, onGuardado }: {
  evaluacion: EvaluacionDesempeno; ciclo: CicloDesempeno; onClose: () => void; onGuardado: (msg: string) => void;
}) {
  const base: ResultadoDesempeno[] = useMemo(() => {
    if (evaluacion.resultados?.length) return evaluacion.resultados;
    const objs = (evaluacion.objetivos ?? ciclo.objetivos).map((o) => ({ tipo: "objetivo" as const, nombre: o.titulo, meta: "", real: "", logro: null, peso: o.peso ?? 0, comentario: "" }));
    const kp = (evaluacion.kpis ?? ciclo.kpis).map((k) => ({ tipo: "kpi" as const, nombre: k.nombre, meta: k.meta ?? "", real: "", logro: null, peso: k.peso ?? 0, comentario: "" }));
    return [...objs, ...kp];
  }, [evaluacion, ciclo]);

  const [filas, setFilas] = useState<ResultadoDesempeno[]>(base);
  const [brechas, setBrechas] = useState(evaluacion.brechas.length ? evaluacion.brechas : [{ tema: "", brecha: "", accion_sugerida: "" }]);
  const [comentarios, setComentarios] = useState(evaluacion.comentarios ?? "");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");

  const escala = ciclo.escalaMaxima || 100;
  const preview = useMemo(() => {
    const conLogro = filas.filter((f) => f.logro !== null && f.logro !== undefined);
    if (!conLogro.length) return null;
    const pesos = conLogro.reduce((a, f) => a + Number(f.peso || 0), 0);
    const val = pesos > 0
      ? conLogro.reduce((a, f) => a + Number(f.logro) * Number(f.peso || 0), 0) / pesos
      : conLogro.reduce((a, f) => a + Number(f.logro), 0) / conLogro.length;
    return Math.round((val * escala) / 100 * 10) / 10;
  }, [filas, escala]);

  async function guardar(completar: boolean) {
    setOcupado(completar ? "completar" : "guardar");
    setError("");
    const r = await guardarEvaluacionDesempeno(evaluacion.id, {
      resultados: filas,
      brechas: brechas.filter((b) => (b.tema ?? "").trim()),
      comentarios,
      completar,
    });
    setOcupado("");
    if (!r.ok) return setError(r.error);
    onGuardado(completar
      ? `Evaluación de ${evaluacion.colaborador} completada${r.data.calificacion !== null ? ` · ${r.data.calificacion}/${escala}` : ""}.`
      : `Avance guardado en la evaluación de ${evaluacion.colaborador}.`);
  }

  return (
    <ModalMarco
      titulo={`Evaluar a ${evaluacion.colaborador}`}
      subtitulo={`${[evaluacion.area, evaluacion.puesto].filter(Boolean).join(" · ") || "Sin puesto"} · ${ciclo.nombre}`}
      onClose={onClose}
      ancho="max-w-3xl"
    >
      <div className="scroll-x rounded-2xl border border-border-soft">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2 font-semibold">Objetivo / KPI</th>
              <th className="px-3 py-2 font-semibold">Meta</th>
              <th className="px-3 py-2 font-semibold">Real</th>
              <th className="px-3 py-2 font-semibold">Logro %</th>
              <th className="px-3 py-2 font-semibold">Peso</th>
              <th className="px-3 py-2 font-semibold">Comentario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-faint">
            {filas.map((f, i) => {
              const set = (nueva: ResultadoDesempeno) => setFilas(filas.map((x, k) => (k === i ? nueva : x)));
              return (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <p className="text-sm font-medium text-ink">{f.nombre}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-3">{f.tipo}</p>
                  </td>
                  <td className="px-3 py-2"><input value={f.meta ?? ""} onChange={(e) => set({ ...f, meta: e.target.value })} className="h-10 w-24 rounded-lg border border-border-soft bg-surface px-2 text-sm outline-none focus:border-brand" /></td>
                  <td className="px-3 py-2"><input value={f.real ?? ""} onChange={(e) => set({ ...f, real: e.target.value })} className="h-10 w-24 rounded-lg border border-border-soft bg-surface px-2 text-sm outline-none focus:border-brand" /></td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min={0} max={120}
                      value={f.logro ?? ""}
                      onChange={(e) => set({ ...f, logro: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-10 w-20 rounded-lg border border-border-soft bg-surface px-2 text-sm outline-none focus:border-brand"
                    />
                  </td>
                  <td className="px-3 py-2"><input type="number" min={0} max={100} value={f.peso ?? 0} onChange={(e) => set({ ...f, peso: Number(e.target.value) })} className="h-10 w-16 rounded-lg border border-border-soft bg-surface px-2 text-sm outline-none focus:border-brand" /></td>
                  <td className="px-3 py-2"><input value={f.comentario ?? ""} onChange={(e) => set({ ...f, comentario: e.target.value })} placeholder="Opcional" className="h-10 w-44 rounded-lg border border-border-soft bg-surface px-2 text-sm outline-none focus:border-brand" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-sm text-ink-2">Calificación calculada (promedio ponderado)</span>
        <span className="font-display text-2xl font-bold tabular">{preview === null ? "—" : `${preview} / ${escala}`}</span>
      </div>

      <ListaEditable
        titulo="Brechas y acciones"
        filas={brechas}
        onCambio={setBrechas}
        nuevo={() => ({ tema: "", brecha: "", accion_sugerida: "" })}
        render={(b, set) => (
          <>
            <input value={b.tema ?? ""} onChange={(e) => set({ ...b, tema: e.target.value })} placeholder="Tema (ej. Atención a cliente)" className={cn(inputCls, "sm:col-span-2")} />
            <input value={b.brecha ?? ""} onChange={(e) => set({ ...b, brecha: e.target.value })} placeholder="Qué falta" className={cn(inputCls, "sm:col-span-1")} />
            <input value={b.accion_sugerida ?? ""} onChange={(e) => set({ ...b, accion_sugerida: e.target.value })} placeholder="Acción sugerida (ej. curso de servicio)" className={cn(inputCls, "sm:col-span-2")} />
          </>
        )}
      />

      <Campo label="Comentarios de la evaluación">
        <textarea value={comentarios} onChange={(e) => setComentarios(e.target.value)} rows={3} placeholder="Notas para la conversación de retroalimentación…" className="w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
      </Campo>

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={Boolean(ocupado)}>Cancelar</Button>
        <Button variant="secondary" size="sm" onClick={() => guardar(false)} disabled={Boolean(ocupado)}>
          {ocupado === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar avance
        </Button>
        <Button size="sm" onClick={() => guardar(true)} disabled={Boolean(ocupado)}>
          {ocupado === "completar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Completar evaluación
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        La evaluación la firma una persona de RH o la jefatura: Red Human solo propone el marco y calcula.
      </p>
    </ModalMarco>
  );
}
