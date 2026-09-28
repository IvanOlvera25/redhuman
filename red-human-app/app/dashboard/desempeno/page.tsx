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
import { AsistenteCrearEvaluacion } from "@/components/dashboard/desempeno/asistente-crear";
import { EditorCriterios, criteriosParaGuardar } from "@/components/dashboard/desempeno/editor-criterios";
import { SelectorParticipantes, type SeleccionParticipantes } from "@/components/dashboard/desempeno/selector-participantes";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import {
  agregarParticipantesDesempeno,
  ajustarCriterioDesempeno,
  cerrarCicloDesempeno,
  editarCicloDesempeno,
  fetchCiclosDesempeno,
  fetchEvaluacionDesempeno,
  fetchResultadosCiclo,
  guardarEvaluacionDesempeno,
  iniciarCicloDesempeno,
  type CicloDesempeno,
  type CriterioDesempeno,
  type EvaluacionDesempeno,
  type ResultadoDesempeno,
  type ResultadosCiclo,
} from "@/lib/api";

type Aviso = AvisoRH;

const ESTADO_TONO: Record<string, "neutral" | "brand" | "good"> = { borrador: "neutral", en_curso: "brand", cerrada: "good" };
const ESTADO_LABEL: Record<string, string> = { borrador: "Borrador", en_curso: "En curso", cerrada: "Cerrada" };
const ESTADO_PERSONA: Record<string, string> = { pendiente: "Pendiente", en_proceso: "En proceso", completada: "Completada" };
const TONO_PERSONA: Record<string, "neutral" | "brand" | "good"> = { pendiente: "neutral", en_proceso: "brand", completada: "good" };

export default function Desempeno() {
  const puedeDecidir = usePuedeDecidir();
  const [ciclos, setCiclos] = useState<CicloDesempeno[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);   // código del ciclo en detalle
  const [crear, setCrear] = useState<{ equipo?: string; ids?: string[] } | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [otra, setOtra] = useState<SeleccionParticipantes["paraOtraEvaluacion"]>([]);

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
          <Button size="sm" onClick={() => setCrear({})}>
            <Plus className="h-4 w-4" /> Crear evaluación
          </Button>
        )}
      </PageHeader>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}
      {otra.length > 0 && (
        <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 border-warn/30 bg-warn-soft/30 p-4 text-sm">
          <span>Quedó pendiente crear otra evaluación para: {otra.map((o) => `${o.nombre} (${o.puesto || "sin puesto"})`).join(", ")}.</span>
          <Button size="sm" onClick={() => { setCrear({ equipo: otra[0]?.puesto ?? "", ids: otra.map((o) => o.id) }); setOtra([]); }}>Crear evaluación para ellos</Button>
        </Card>
      )}

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
            <Button className="mt-5" onClick={() => setCrear({})}>
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
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2">{c.criterios.length} criterios</span>
                {c.equipo && <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2">{c.equipo}</span>}
                {c.generadoConIa && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-2 py-1 font-semibold text-brand">
                    <Sparkles className="h-3 w-3" /> con IA
                  </span>
                )}
              </div>
              <div className="mt-auto pt-4">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-ink-3">{c.completadas} de {c.participantes} completadas</span>
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
        <AsistenteCrearEvaluacion
          inicial={crear}
          onClose={() => setCrear(null)}
          onCreada={(c, pendientesOtra) => {
            setCrear(null);
            setOtra(pendientesOtra);
            setAviso({ tono: "ok", texto: `Evaluación «${c.nombre}» creada en Borrador. Revísala e iníciala cuando esté lista.` });
            void recargar();
            if (!pendientesOtra.length) setAbierto(c.id);
          }}
        />
      )}
    </div>
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

  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [editarCriterios, setEditarCriterios] = useState(false);

  async function iniciarCiclo() {
    setOcupado("iniciar");
    const r = await iniciarCicloDesempeno(codigo);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: "Evaluación iniciada: ya se pueden capturar resultados." });
    void recargar();
  }

  async function cerrarCiclo(aunConPendientes: boolean) {
    setOcupado("cerrar");
    const r = await cerrarCicloDesempeno(codigo, aunConPendientes);
    setOcupado("");
    setConfirmarCierre(false);
    if (!r.ok) {
      if (!aunConPendientes && r.error.includes("sin completar")) return setConfirmarCierre(true);
      return setAviso({ tono: "error", texto: r.error });
    }
    setAviso({ tono: "ok", texto: "Evaluación cerrada: los resultados quedan como histórico." });
    void recargar();
  }

  if (!datos) {
    return <div className="mx-auto max-w-7xl px-4 py-16 text-center text-ink-3"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  }

  const c = datos.ciclo;
  const pendientes = datos.pendientes;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={onVolver} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 transition hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Todas las evaluaciones
      </button>

      <PageHeader title={c.nombre} subtitle={`${c.id}${c.periodo ? ` · ${c.periodo}` : ""} · creada por ${c.creadoPor || "RH"}`}>
        <Badge tone={ESTADO_TONO[c.estado] ?? "neutral"} dot>{ESTADO_LABEL[c.estado] ?? c.estado}</Badge>
        {puedeDecidir && c.estado !== "cerrada" && (
          <>
            <Button size="sm" variant="outline" onClick={() => setAgregar(true)}>
              <UserPlus className="h-4 w-4" /> Agregar colaboradores
            </Button>
            {c.estado === "borrador" && (
              <Button size="sm" variant="outline" onClick={() => setEditarCriterios(true)}>Editar criterios</Button>
            )}
            {c.estado === "borrador" ? (
              <Button size="sm" onClick={iniciarCiclo} disabled={ocupado === "iniciar"}>
                {ocupado === "iniciar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Iniciar evaluación
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => cerrarCiclo(false)} disabled={ocupado === "cerrar"}>Cerrar evaluación</Button>
            )}
          </>
        )}
      </PageHeader>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {/* Resumen */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Colaboradores" valor={String(datos.total)} pie={`${datos.completadas} completadas`} icono={<Users className="h-4 w-4" />} />
        <Kpi etiqueta="Avance" valor={`${datos.avance}%`} pie="completadas ÷ incluidas" icono={<ClipboardList className="h-4 w-4" />} />
        <Kpi etiqueta="Promedio" valor={datos.promedio === null ? "—" : `${datos.promedio}%`} pie="solo resultados válidos" icono={<TrendingUp className="h-4 w-4" />} />
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
                        <Badge tone={TONO_PERSONA[e.estado] ?? "neutral"} dot>{ESTADO_PERSONA[e.estado] ?? e.estado}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        {e.calificacion === null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold tabular">{e.calificacion}%</span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className={cn("h-full rounded-full", e.calificacion >= 80 ? "bg-good" : e.calificacion >= 60 ? "bg-warn" : "bg-bad")}
                                style={{ width: `${Math.min(100, e.calificacion)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {e.estado === "completada" || c.estado !== "en_curso" || !puedeDecidir ? (
                          <Button size="sm" variant="outline" onClick={() => abrirEvaluacion(e)}>Ver</Button>
                        ) : (
                          <Button size="sm" onClick={() => abrirEvaluacion(e)}>Evaluar</Button>
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

      {editarCriterios && (
        <ModalEditarCriterios
          ciclo={c}
          onClose={() => setEditarCriterios(false)}
          onGuardado={() => { setEditarCriterios(false); setAviso({ tono: "ok", texto: "Criterios guardados." }); void recargar(); }}
        />
      )}

      {agregar && (
        <ModalParticipantes
          codigo={codigo}
          equipo={c.equipo}
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

      {confirmarCierre && (
        <ModalMarco titulo="Cerrar evaluación" subtitulo={`${pendientes.length} persona(s) sin completar quedarán fuera del promedio. Una evaluación cerrada no se reabre.`} onClose={() => setConfirmarCierre(false)}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmarCierre(false)}>Cancelar</Button>
            <Button size="sm" onClick={() => cerrarCiclo(true)} disabled={ocupado === "cerrar"}>Cerrar de todos modos</Button>
          </div>
        </ModalMarco>
      )}

      {evaluando && (
        <ModalEvaluar
          evaluacion={evaluando}
          ciclo={c}
          soloLectura={evaluando.estado === "completada" || c.estado !== "en_curso" || !puedeDecidir}
          onClose={() => setEvaluando(null)}
          onGuardado={(msg) => { setEvaluando(null); setAviso({ tono: "ok", texto: msg }); void recargar(); }}
        />
      )}
    </div>
  );
}

/* ---------- Criterios del borrador ---------- */

function ModalEditarCriterios({ ciclo, onClose, onGuardado }: { ciclo: CicloDesempeno; onClose: () => void; onGuardado: () => void }) {
  const [criterios, setCriterios] = useState<CriterioDesempeno[]>(ciclo.criterios.map((x) => ({ ...x })));
  const [pesos, setPesos] = useState(ciclo.pesosPersonalizados);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    const limpios = criteriosParaGuardar(criterios, pesos);
    if (!limpios.length) return setError("Captura al menos un criterio.");
    setOcupado(true);
    const r = await editarCicloDesempeno(ciclo.id, { criterios: limpios, pesosPersonalizados: pesos });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onGuardado();
  }

  return (
    <ModalMarco titulo="Criterios de la evaluación" subtitulo={`${ciclo.equipo || "Sin puesto"} · solo editable en Borrador`} onClose={onClose} ancho="max-w-4xl">
      <EditorCriterios criterios={criterios} onCambio={setCriterios} pesosPersonalizados={pesos} onPesosPersonalizados={setPesos} />
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado}>{ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Guardar criterios</Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- Agregar colaboradores y evaluadores (roster maestro) ---------- */

function ModalParticipantes({ codigo, equipo, yaDentro, onClose, onListo }: {
  codigo: string; equipo: string; yaDentro: string[]; onClose: () => void; onListo: (n: number, faltantes: string[]) => void;
}) {
  const [sel, setSel] = useState<SeleccionParticipantes>({ ids: [], evaluadores: {}, paraOtraEvaluacion: [] });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    setOcupado(true);
    setError("");
    const r = await agregarParticipantesDesempeno(codigo, sel.ids, sel.evaluadores);
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onListo(r.data.evaluaciones.length, r.data.noEncontrados);
  }

  return (
    <ModalMarco titulo="Agregar colaboradores y evaluadores" subtitulo="Del roster de la empresa. El evaluador es un usuario del sistema." onClose={onClose} ancho="max-w-3xl">
      <SelectorParticipantes equipo={equipo} yaDentro={yaDentro} valor={sel} onCambio={setSel} />
      {sel.paraOtraEvaluacion.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-3">Para {sel.paraOtraEvaluacion.map((o) => o.nombre).join(", ")}: crea otra evaluación desde «Crear evaluación».</p>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={!sel.ids.length || ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Agregar a la evaluación
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- Paso 3: evaluar (una tarjeta por criterio, texto completo, sin scroll horizontal) ---------- */

/** Mismo cálculo que el backend (`services/desempeno_calculo`): solo para mostrar la vista previa. */
function cumplimientoLocal(c: CriterioDesempeno, r: ResultadoDesempeno | undefined): number | null {
  if (!r || r.no_aplica) return null;
  if (c.tipo === "descriptivo") {
    const v = r.valoracion;
    return v === null || v === undefined || v < 1 || v > 5 ? null : ((v - 1) / 4) * 100;
  }
  const real = r.real === "" || r.real === null || r.real === undefined ? null : Number(r.real);
  const meta = c.meta === null || c.meta === undefined ? null : Number(c.meta);
  if (real === null || Number.isNaN(real) || meta === null || Number.isNaN(meta)) return null;
  if (c.sentido === "menor_es_mejor") return real <= 0 ? 100 : Math.max(0, Math.min(100, (meta / real) * 100));
  if (meta <= 0) return real >= meta ? 100 : 0;
  return Math.max(0, Math.min(100, (real / meta) * 100));
}

function ModalEvaluar({ evaluacion, ciclo, soloLectura, onClose, onGuardado }: {
  evaluacion: EvaluacionDesempeno; ciclo: CicloDesempeno; soloLectura: boolean; onClose: () => void; onGuardado: (msg: string) => void;
}) {
  const [criterios, setCriterios] = useState<CriterioDesempeno[]>(evaluacion.criterios ?? ciclo.criterios);
  const [ajustando, setAjustando] = useState<{ id: string; valor: string; motivo: string } | null>(null);

  async function guardarAjuste() {
    if (!ajustando) return;
    const c = criterios.find((x) => x.id === ajustando.id);
    if (!c) return;
    setError("");
    const r = await ajustarCriterioDesempeno(evaluacion.id, {
      criterioId: c.id, motivo: ajustando.motivo,
      ...(c.tipo === "medible" ? { meta: ajustando.valor === "" ? null : Number(ajustando.valor) } : { esperado: ajustando.valor }),
    });
    if (!r.ok) return setError(r.error);
    setCriterios(r.data.criterios ?? criterios);
    setAjustando(null);
  }
  const [res, setRes] = useState<Record<string, ResultadoDesempeno>>(() => {
    const inicial: Record<string, ResultadoDesempeno> = {};
    for (const r of evaluacion.resultados ?? []) if (r.criterio_id) inicial[r.criterio_id] = r;
    return inicial;
  });
  const [brechas, setBrechas] = useState(evaluacion.brechas.length ? evaluacion.brechas : [{ tema: "", brecha: "", accion_sugerida: "" }]);
  const [comentarios, setComentarios] = useState(evaluacion.comentarios ?? "");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");

  const set = (id: string, cambio: Partial<ResultadoDesempeno>) => setRes({ ...res, [id]: { ...(res[id] ?? { criterio_id: id }), ...cambio, criterio_id: id } });
  const pesos = useMemo(() => Object.fromEntries(criterios.map((c) => [c.id, ciclo.pesosPersonalizados ? Number(c.peso ?? 0) : 1])), [criterios, ciclo.pesosPersonalizados]);
  const preview = useMemo(() => {
    let suma = 0;
    let total = 0;
    for (const c of criterios) {
      const v = cumplimientoLocal(c, res[c.id]);
      if (v === null) continue;
      suma += v * pesos[c.id];
      total += pesos[c.id];
    }
    return total > 0 ? Math.round((suma / total) * 10) / 10 : null;
  }, [criterios, res, pesos]);

  async function guardar(completar: boolean) {
    setOcupado(completar ? "completar" : "guardar");
    setError("");
    const r = await guardarEvaluacionDesempeno(evaluacion.id, {
      resultados: criterios.map((c) => res[c.id] ?? { criterio_id: c.id }),
      brechas: brechas.filter((b) => (b.tema ?? "").trim()),
      comentarios,
      completar,
    });
    setOcupado("");
    if (!r.ok) return setError(r.error);
    onGuardado(completar
      ? `Evaluación de ${evaluacion.colaborador} completada${r.data.calificacion !== null ? ` · ${r.data.calificacion}%` : ""}.`
      : `Borrador guardado · ${evaluacion.colaborador} queda «${ESTADO_PERSONA[r.data.estado]}».`);
  }

  return (
    <ModalMarco
      titulo={`Evaluar a ${evaluacion.colaborador}`}
      subtitulo={`${[evaluacion.area, evaluacion.puesto].filter(Boolean).join(" · ") || "Sin puesto"} · ${ciclo.nombre}`}
      onClose={onClose}
      ancho="max-w-3xl"
    >
      <ol className="flex flex-col gap-3">
        {criterios.map((c, i) => {
          const r = res[c.id];
          const v = cumplimientoLocal(c, r);
          return (
            <li key={c.id} className={cn("rounded-2xl border p-4", r?.no_aplica ? "border-border-faint bg-surface-2/40" : "border-border-soft")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    <span className="mr-1.5 font-mono text-[11px] text-ink-3">{i + 1}.</span>{c.nombre}
                    {c.ajustado && <Badge tone="warn" className="ml-2">Ajuste individual</Badge>}
                  </p>
                  {(c.tipo === "descriptivo" ? c.esperado || c.descripcion : c.descripcion) && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{c.tipo === "descriptivo" ? c.esperado || c.descripcion : c.descripcion}</p>
                  )}
                  <p className="mt-1 text-[11px] text-ink-3">
                    {c.tipo === "medible"
                      ? `Medible · meta ${c.meta ?? "sin capturar"}${c.unidad ? ` ${c.unidad}` : ""} · ${c.sentido === "menor_es_mejor" ? "menor es mejor" : "mayor es mejor"} · ${c.formula || "Real ÷ Meta"}`
                      : "Descriptivo · valoración 1 a 5 (1 = 0 %, 5 = 100 %)"}
                    {ciclo.pesosPersonalizados && ` · peso ${c.peso ?? 0} %`}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm font-bold tabular">{v === null ? "—" : `${Math.round(v * 10) / 10}%`}</span>
              </div>

              {!soloLectura && (ajustando?.id === c.id ? (
                <div className="mt-3 grid gap-2 rounded-xl bg-surface-2/60 p-3 sm:grid-cols-5">
                  <input
                    value={ajustando.valor}
                    onChange={(e) => setAjustando({ ...ajustando, valor: e.target.value })}
                    type={c.tipo === "medible" ? "number" : "text"}
                    placeholder={c.tipo === "medible" ? "Meta para esta persona" : "Qué se espera de esta persona"}
                    className={cn(inputCls, "sm:col-span-2")}
                  />
                  <input value={ajustando.motivo} onChange={(e) => setAjustando({ ...ajustando, motivo: e.target.value })} placeholder="Motivo del ajuste (obligatorio)" className={cn(inputCls, "sm:col-span-2")} />
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={guardarAjuste}>Guardar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAjustando(null)}>×</Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAjustando({ id: c.id, valor: String(c.tipo === "medible" ? c.meta ?? "" : c.esperado ?? ""), motivo: "" })}
                  className="mt-2 text-[11px] font-semibold text-brand hover:underline"
                >
                  Ajustar {c.tipo === "medible" ? "meta" : "criterio"} solo para esta persona
                </button>
              ))}
              {c.ajustado && c.motivo_ajuste && <p className="mt-1 text-[11px] text-warn">Ajuste individual: {c.motivo_ajuste}</p>}

              {!r?.no_aplica && (
                c.tipo === "medible" ? (
                  <label className="mt-3 flex max-w-xs flex-col gap-1.5">
                    <span className="text-xs font-medium text-ink-2">Resultado real{c.unidad ? ` (${c.unidad})` : ""}</span>
                    <input
                      type="number"
                      disabled={soloLectura}
                      value={r?.real ?? ""}
                      onChange={(e) => set(c.id, { real: e.target.value === "" ? null : Number(e.target.value) })}
                      className={inputCls}
                    />
                  </label>
                ) : (
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-5">
                    {(c.escala ?? []).map((n) => (
                      <button
                        key={n.valor}
                        type="button"
                        disabled={soloLectura}
                        onClick={() => set(c.id, { valoracion: n.valor })}
                        className={cn(
                          "rounded-xl border px-2 py-2 text-left text-[12px] leading-snug transition",
                          r?.valoracion === n.valor ? "border-brand bg-brand-soft text-ink ring-2 ring-brand/20" : "border-border-soft hover:border-brand/40",
                        )}
                      >
                        <b className="font-mono">{n.valor}</b> · {n.significado}
                      </button>
                    ))}
                  </div>
                )
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-[12px] text-ink-2">
                  <input type="checkbox" disabled={soloLectura} checked={Boolean(r?.no_aplica)} onChange={(e) => set(c.id, { no_aplica: e.target.checked })} className="h-4 w-4 rounded border-border-soft text-brand" />
                  No aplica
                </label>
                {r?.no_aplica && (
                  <input
                    disabled={soloLectura}
                    value={r.motivo_no_aplica ?? ""}
                    onChange={(e) => set(c.id, { motivo_no_aplica: e.target.value })}
                    placeholder="Motivo (obligatorio)"
                    className={cn(inputCls, "min-w-0 flex-1")}
                  />
                )}
              </div>
              <input
                disabled={soloLectura}
                value={r?.comentario ?? ""}
                onChange={(e) => set(c.id, { comentario: e.target.value })}
                placeholder="Comentario (opcional)"
                className={cn(inputCls, "mt-2")}
              />
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-sm text-ink-2">Calificación (solo resultados válidos; vacío no cuenta como cero)</span>
        <span className="font-display text-2xl font-bold tabular">{preview === null ? "—" : `${preview}%`}</span>
      </div>

      {!soloLectura && (
        <>
          <ListaEditable
            titulo="Brechas y acciones"
            filas={brechas}
            onCambio={setBrechas}
            nuevo={() => ({ tema: "", brecha: "", accion_sugerida: "" })}
            render={(b, setB) => (
              <>
                <input value={b.tema ?? ""} onChange={(e) => setB({ ...b, tema: e.target.value })} placeholder="Tema (ej. Atención a cliente)" className={cn(inputCls, "sm:col-span-2")} />
                <input value={b.brecha ?? ""} onChange={(e) => setB({ ...b, brecha: e.target.value })} placeholder="Qué falta" className={cn(inputCls, "sm:col-span-1")} />
                <input value={b.accion_sugerida ?? ""} onChange={(e) => setB({ ...b, accion_sugerida: e.target.value })} placeholder="Acción sugerida" className={cn(inputCls, "sm:col-span-2")} />
              </>
            )}
          />
          <Campo label="Comentarios de la evaluación">
            <textarea value={comentarios} onChange={(e) => setComentarios(e.target.value)} rows={3} placeholder="Notas para la conversación de retroalimentación…" className="w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </Campo>
        </>
      )}

      {error && <p className="mt-3 whitespace-pre-line text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={Boolean(ocupado)}>{soloLectura ? "Cerrar" : "Cancelar"}</Button>
        {!soloLectura && (
          <>
            <Button variant="secondary" size="sm" onClick={() => guardar(false)} disabled={Boolean(ocupado)}>
              {ocupado === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar borrador
            </Button>
            <Button size="sm" onClick={() => guardar(true)} disabled={Boolean(ocupado)}>
              {ocupado === "completar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Completar evaluación
            </Button>
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        Solo se completa con todos los criterios aplicables capturados. La evaluación la firma una persona: Red Human solo calcula.
      </p>
    </ModalMarco>
  );
}
