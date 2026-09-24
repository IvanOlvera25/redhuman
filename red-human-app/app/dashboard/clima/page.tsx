"use client";

/* Módulo de Clima laboral (2026-09-23). Crear encuesta (anónima o identificada) → invitar colaboradores
   del roster y/o generar liga externa → dashboard de resultados por dimensión con hallazgos.

   REGLA DE ORO: los participantes internos SON los colaboradores del roster; aquí nunca se captura gente.
   Privacidad: en una medición anónima no se guarda ni se muestra quién respondió (LFPDPPP). */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BarChart3, Check, Copy, Eye, EyeOff, Link2, Loader2, MessageSquare, Play, Plus, Search,
  Send, ShieldCheck, Square, Users,
} from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { AvisoLinea, CampoRH, Cargando, KpiRH, ListaEditable, ModalMarco, inputRH, type AvisoRH } from "@/components/dashboard/modulos-rh";
import { usePuedeDecidir } from "@/components/sesion";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import {
  cambiarEstadoMedicion,
  crearMedicionClima,
  fetchColaboradores,
  fetchMedicionClima,
  fetchMedicionesClima,
  fetchResultadosClima,
  invitarAClima,
  regenerarLigaClima,
  type Colaborador,
  type MedicionClima,
  type PreguntaClima,
  type ResultadosClima,
  type TipoPreguntaClima,
} from "@/lib/api";

const ESTADO_TONO: Record<string, "neutral" | "good" | "brand"> = { borrador: "neutral", abierta: "good", cerrada: "brand" };
const ESTADO_LABEL: Record<string, string> = { borrador: "Borrador", abierta: "Abierta", cerrada: "Cerrada" };

/** Cuestionario base para arrancar rápido: las 6 dimensiones clásicas de clima, en escala 1-5. */
const PLANTILLA_BASE: PreguntaClima[] = [
  { id: "p1", texto: "Me siento a gusto en mi equipo de trabajo", tipo: "escala", escala_max: 5 },
  { id: "p2", texto: "Tengo claro lo que se espera de mí en mi puesto", tipo: "escala", escala_max: 5 },
  { id: "p3", texto: "Mi jefe directo me da retroalimentación útil", tipo: "escala", escala_max: 5 },
  { id: "p4", texto: "Cuento con las herramientas para hacer bien mi trabajo", tipo: "escala", escala_max: 5 },
  { id: "p5", texto: "Veo oportunidades de crecer en la empresa", tipo: "escala", escala_max: 5 },
  { id: "p6", texto: "¿Qué cambiarías para que trabajar aquí sea mejor?", tipo: "abierta" },
];

export default function Clima() {
  const puedeDecidir = usePuedeDecidir();
  const [mediciones, setMediciones] = useState<MedicionClima[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [crear, setCrear] = useState(false);
  const [aviso, setAviso] = useState<AvisoRH>(null);

  const recargar = useCallback(async () => {
    const m = await fetchMedicionesClima();
    setMediciones(m ?? []);
  }, []);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  usePolling(recargar);

  if (abierta) {
    return <DetalleMedicion codigo={abierta} puedeDecidir={puedeDecidir} onVolver={() => { setAbierta(null); void recargar(); }} />;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Clima laboral" subtitle="Encuestas anónimas o identificadas para los colaboradores, con liga externa opcional y resultados por dimensión.">
        {puedeDecidir && <Button size="sm" onClick={() => setCrear(true)}><Plus className="h-4 w-4" /> Nueva encuesta</Button>}
      </PageHeader>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {mediciones === null ? (
        <Cargando />
      ) : mediciones.length === 0 ? (
        <Card className="mt-6 p-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><BarChart3 className="h-7 w-7" /></span>
          <h2 className="font-display mt-4 text-xl font-bold">Todavía no hay mediciones de clima</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            Crea una encuesta —puedes partir del cuestionario base—, ábrela e invita a tu equipo. Las respuestas
            anónimas no guardan quién contestó.
          </p>
          {puedeDecidir && <Button className="mt-5" onClick={() => setCrear(true)}><Plus className="h-4 w-4" /> Crear la primera encuesta</Button>}
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mediciones.map((m) => (
            <button
              key={m.id}
              onClick={() => setAbierta(m.id)}
              className="card-hover group flex flex-col rounded-2xl border border-border-soft bg-surface p-5 text-left transition-all hover:border-brand/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold group-hover:text-brand">{m.titulo}</p>
                  <p className="font-mono text-[11px] text-ink-3">{m.id} · {m.preguntas} preguntas</p>
                </div>
                <Badge tone={ESTADO_TONO[m.estado] ?? "neutral"} dot>{ESTADO_LABEL[m.estado] ?? m.estado}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold", m.anonima ? "bg-human-soft text-human" : "bg-surface-2 text-ink-2")}>
                  {m.anonima ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {m.anonima ? "Anónima" : "Identificada"}
                </span>
                {m.permiteExternos && <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2">Acepta externos</span>}
              </div>
              <div className="mt-auto flex items-baseline justify-between pt-4">
                <span className="text-xs text-ink-3">{m.respuestas} respuesta(s)</span>
                <span className="text-[11px] text-ink-3">{m.creado}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {crear && (
        <ModalCrearMedicion
          onClose={() => setCrear(false)}
          onCreada={(m) => { setCrear(false); void recargar(); setAbierta(m.id); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Crear encuesta
   ============================================================ */

function ModalCrearMedicion({ onClose, onCreada }: { onClose: () => void; onCreada: (m: MedicionClima) => void }) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [anonima, setAnonima] = useState(true);
  const [permiteExternos, setPermiteExternos] = useState(false);
  const [preguntas, setPreguntas] = useState<PreguntaClima[]>(PLANTILLA_BASE);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    const limpias = preguntas
      .filter((p) => p.texto.trim())
      .map((p, i) => ({ ...p, id: p.id || `p${i + 1}`, texto: p.texto.trim() }));
    if (!titulo.trim()) return setError("Ponle título a la encuesta.");
    if (!limpias.length) return setError("Captura al menos una pregunta.");
    setOcupado(true);
    setError("");
    const r = await crearMedicionClima({ titulo, descripcion, preguntas: limpias, anonima, permiteExternos });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onCreada(r.data);
  }

  return (
    <ModalMarco titulo="Nueva encuesta de clima" subtitulo="Define cómo se responde y qué vas a preguntar. Puedes editar el cuestionario base." onClose={onClose} ancho="max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoRH label="Título"><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Clima 2026 · Sucursal Centro" className={inputRH} /></CampoRH>
        <CampoRH label="Descripción (opcional)"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Para qué es y hasta cuándo está abierta" className={inputRH} /></CampoRH>
      </div>

      {/* Anónima vs identificada — decisión visible y explicada */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setAnonima(true)}
          className={cn("rounded-2xl border p-4 text-left transition", anonima ? "border-brand bg-brand-soft/40 ring-2 ring-brand/20" : "border-border-soft bg-surface hover:border-brand/40")}
        >
          <span className="flex items-center gap-2 text-sm font-bold"><EyeOff className="h-4 w-4 text-human" /> Anónima</span>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
            No se guarda quién respondió, ni siquiera si la persona entra con su liga. Da respuestas más honestas.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setAnonima(false)}
          className={cn("rounded-2xl border p-4 text-left transition", !anonima ? "border-brand bg-brand-soft/40 ring-2 ring-brand/20" : "border-border-soft bg-surface hover:border-brand/40")}
        >
          <span className="flex items-center gap-2 text-sm font-bold"><Eye className="h-4 w-4 text-brand" /> Identificada</span>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
            Cada respuesta queda ligada a la persona. Útil para dar seguimiento uno a uno; se le avisa antes de contestar.
          </p>
        </button>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border-soft p-3.5 transition hover:border-brand/40">
        <input type="checkbox" checked={permiteExternos} onChange={(e) => setPermiteExternos(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border-soft text-brand" />
        <span className="text-[13px] text-ink-2">
          <b className="text-ink">Permitir participantes externos</b> por la liga pública (proveedores, personal de agencia…).
          Sus respuestas se guardan con el nombre que escriban; nunca se crea un colaborador.
        </span>
      </label>

      <ListaEditable
        titulo="Preguntas"
        filas={preguntas}
        onCambio={setPreguntas}
        nuevo={() => ({ id: `p${preguntas.length + 1}`, texto: "", tipo: "escala" as TipoPreguntaClima, escala_max: 5 })}
        render={(p, set) => (
          <>
            <input value={p.texto} onChange={(e) => set({ ...p, texto: e.target.value })} placeholder="Redacta la pregunta" className={cn(inputRH, "sm:col-span-3")} />
            <select
              value={p.tipo}
              onChange={(e) => {
                const tipo = e.target.value as TipoPreguntaClima;
                set({ ...p, tipo, escala_max: tipo === "escala" ? (p.escala_max ?? 5) : undefined, opciones: tipo === "opcion" ? (p.opciones ?? ["Buena", "Regular", "Mala"]) : undefined });
              }}
              className={cn(inputRH, "sm:col-span-1")}
            >
              <option value="escala">Escala 1-5</option>
              <option value="opcion">Opción múltiple</option>
              <option value="abierta">Respuesta abierta</option>
            </select>
            {p.tipo === "opcion" ? (
              <input
                value={(p.opciones ?? []).join(", ")}
                onChange={(e) => set({ ...p, opciones: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder="Opciones separadas por coma"
                className={cn(inputRH, "sm:col-span-1")}
              />
            ) : (
              <span className="hidden sm:block" />
            )}
          </>
        )}
      />

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Crear encuesta
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ============================================================
   Detalle: invitar, liga externa y resultados
   ============================================================ */

function DetalleMedicion({ codigo, puedeDecidir, onVolver }: { codigo: string; puedeDecidir: boolean; onVolver: () => void }) {
  const [medicion, setMedicion] = useState<MedicionClima | null>(null);
  const [datos, setDatos] = useState<ResultadosClima | null>(null);
  const [aviso, setAviso] = useState<AvisoRH>(null);
  const [invitar, setInvitar] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const [copiada, setCopiada] = useState(false);

  const recargar = useCallback(async () => {
    const [m, r] = await Promise.all([fetchMedicionClima(codigo), fetchResultadosClima(codigo)]);
    if (m) setMedicion(m);
    if (r) setDatos(r);
  }, [codigo]);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  usePolling(recargar);

  async function cambiarEstado(estado: "abierta" | "cerrada") {
    setOcupado("estado");
    const r = await cambiarEstadoMedicion(codigo, estado);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setMedicion(r.data);
    setAviso({ tono: "ok", texto: estado === "abierta" ? "Encuesta abierta: ya puede recibir respuestas." : "Encuesta cerrada: los resultados quedan congelados." });
    void recargar();
  }

  async function nuevaLiga() {
    setOcupado("liga");
    const r = await regenerarLigaClima(codigo);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setMedicion(r.data.medicion);
    setAviso({ tono: "warn", texto: "Liga nueva generada: la anterior dejó de funcionar." });
  }

  async function copiarLiga() {
    if (!medicion) return;
    try {
      await navigator.clipboard.writeText(medicion.liga);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      setAviso({ tono: "warn", texto: "No pude copiar automáticamente; copia la liga a mano." });
    }
  }

  if (!medicion || !datos) return <div className="mx-auto max-w-7xl px-4 py-16"><Cargando /></div>;

  const escalas = datos.porPregunta.filter((p) => p.tipo === "escala");
  const abiertas = datos.porPregunta.filter((p) => p.tipo === "abierta");
  const opciones = datos.porPregunta.filter((p) => p.tipo === "opcion");
  const indice = escalas.length
    ? Math.round((escalas.reduce((a, p) => a + ((p.promedio ?? 0) / (p.escalaMax ?? 5)) * 100, 0) / escalas.length))
    : null;
  const focos = escalas.filter((p) => p.promedio !== null && p.promedio !== undefined && (p.promedio / (p.escalaMax ?? 5)) < 0.7);
  const fuertes = escalas.filter((p) => p.promedio !== null && p.promedio !== undefined && (p.promedio / (p.escalaMax ?? 5)) >= 0.8);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={onVolver} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 transition hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Todas las encuestas
      </button>

      <PageHeader title={medicion.titulo} subtitle={`${medicion.id} · ${medicion.preguntas} preguntas · ${medicion.anonima ? "respuestas anónimas" : "respuestas identificadas"}`}>
        <Badge tone={ESTADO_TONO[medicion.estado] ?? "neutral"} dot>{ESTADO_LABEL[medicion.estado] ?? medicion.estado}</Badge>
        {puedeDecidir && medicion.estado !== "abierta" && (
          <Button size="sm" onClick={() => cambiarEstado("abierta")} disabled={ocupado === "estado"}><Play className="h-4 w-4" /> Abrir encuesta</Button>
        )}
        {puedeDecidir && medicion.estado === "abierta" && (
          <>
            <Button size="sm" onClick={() => setInvitar(true)}><Send className="h-4 w-4" /> Invitar colaboradores</Button>
            <Button size="sm" variant="secondary" onClick={() => cambiarEstado("cerrada")} disabled={ocupado === "estado"}><Square className="h-4 w-4" /> Cerrar</Button>
          </>
        )}
      </PageHeader>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {/* Liga externa */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow><span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Liga para contestar</span></Eyebrow>
            <p className="mt-1.5 truncate font-mono text-xs text-ink-2" title={medicion.liga}>{medicion.liga}</p>
            <p className="mt-1 text-[11px] text-ink-3">
              {medicion.permiteExternos
                ? "Abierta a colaboradores y a participantes externos (proveedores, agencia…)."
                : "Solo para colaboradores del roster; un externo que la abra no podrá enviar respuestas."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copiarLiga}>
              {copiada ? <Check className="h-4 w-4 text-good" /> : <Copy className="h-4 w-4" />} {copiada ? "Copiada" : "Copiar liga"}
            </Button>
            {puedeDecidir && (
              <Button size="sm" variant="secondary" onClick={nuevaLiga} disabled={ocupado === "liga"}>
                {ocupado === "liga" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Generar liga externa nueva
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Indicadores */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiRH etiqueta="Índice de clima" valor={indice === null ? "—" : `${indice}%`} pie="promedio de las escalas" icono={<BarChart3 className="h-4 w-4" />} />
        <KpiRH etiqueta="Respuestas" valor={String(datos.totalRespuestas)} pie={`${datos.externos} externas`} icono={<MessageSquare className="h-4 w-4" />} />
        <KpiRH etiqueta="Participación" valor={datos.participacion === null ? "—" : `${datos.participacion}%`} pie={`sobre ${datos.colaboradoresActivos} colaboradores activos`} icono={<Users className="h-4 w-4" />} />
        <KpiRH etiqueta="Focos de atención" valor={String(focos.length)} pie="dimensiones por debajo del 70%" icono={<ShieldCheck className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Dimensiones */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-display text-lg font-bold">Dimensiones</h3>
          <p className="text-sm text-ink-3">Promedio por pregunta de escala</p>
          {escalas.length === 0 ? (
            <p className="mt-4 text-sm text-ink-3">Esta encuesta no tiene preguntas de escala.</p>
          ) : (
            <div className="mt-5 space-y-4">
              {escalas.map((p) => {
                const max = p.escalaMax ?? 5;
                const pct = p.promedio ? (p.promedio / max) * 100 : 0;
                return (
                  <div key={p.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 text-ink-2">{p.texto}</span>
                      <span className="shrink-0 font-mono font-bold tabular">{p.promedio ?? "—"}<span className="text-ink-3">/{max}</span></span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                      <div className={cn("h-full rounded-full", pct >= 80 ? "bg-good" : pct >= 70 ? "bg-brand" : "bg-warn")} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] text-ink-3">{p.respuestas} respuesta(s)</p>
                  </div>
                );
              })}
            </div>
          )}

          {opciones.length > 0 && (
            <div className="mt-6 space-y-4 border-t border-border-faint pt-5">
              {opciones.map((p) => (
                <div key={p.id}>
                  <p className="text-sm text-ink-2">{p.texto}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(p.distribucion ?? {}).map(([op, n]) => (
                      <span key={op} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
                        {op}: <b className="font-mono tabular">{n}</b>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Hallazgos */}
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <Eyebrow>Hallazgos</Eyebrow>
            {datos.totalRespuestas === 0 ? (
              <p className="mt-3 text-sm text-ink-3">Aún no hay respuestas. Invita a tu equipo o comparte la liga.</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {focos.map((p) => (
                  <div key={p.id} className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3">
                    <p className="text-[13px] font-semibold text-warn">Foco de atención</p>
                    <p className="mt-0.5 text-[13px] text-ink-2">{p.texto}</p>
                    <p className="mt-1 font-mono text-[11px] text-ink-3">{p.promedio}/{p.escalaMax ?? 5}</p>
                  </div>
                ))}
                {fuertes.map((p) => (
                  <div key={p.id} className="rounded-xl border border-good/30 bg-good-soft/40 p-3">
                    <p className="text-[13px] font-semibold text-good">Fortaleza</p>
                    <p className="mt-0.5 text-[13px] text-ink-2">{p.texto}</p>
                    <p className="mt-1 font-mono text-[11px] text-ink-3">{p.promedio}/{p.escalaMax ?? 5}</p>
                  </div>
                ))}
                {focos.length === 0 && fuertes.length === 0 && (
                  <p className="text-sm text-ink-3">Sin señales marcadas: todas las dimensiones están en rango medio.</p>
                )}
              </div>
            )}
          </Card>

          {abiertas.map((p) => (
            <Card key={p.id} className="p-5">
              <Eyebrow>{p.texto}</Eyebrow>
              {(p.textos ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-ink-3">Sin comentarios todavía.</p>
              ) : (
                <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {(p.textos ?? []).map((t, i) => (
                    <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink-2">«{t}»</li>
                  ))}
                </ul>
              )}
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-3">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-human" />
                {medicion.anonima ? "Comentarios anónimos: no se guarda quién los escribió." : "Encuesta identificada: el detalle por persona vive en la bitácora."}
              </p>
            </Card>
          ))}
        </div>
      </div>

      {invitar && (
        <ModalInvitar
          codigo={codigo}
          onClose={() => setInvitar(false)}
          onListo={(texto, tono) => { setInvitar(false); setAviso({ tono, texto }); void recargar(); }}
        />
      )}
    </div>
  );
}

/* ---------- Invitar colaboradores del roster ---------- */

function ModalInvitar({ codigo, onClose, onListo }: {
  codigo: string; onClose: () => void; onListo: (texto: string, tono: "ok" | "warn" | "error") => void;
}) {
  const [roster, setRoster] = useState<Colaborador[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchColaboradores(true).then((c) => setRoster(c ?? []));
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (roster ?? []).filter((c) => !q || c.nombre.toLowerCase().includes(q) || (c.puesto ?? "").toLowerCase().includes(q) || (c.area ?? "").toLowerCase().includes(q));
  }, [roster, busqueda]);
  const todos = filtrados.length > 0 && filtrados.every((c) => sel.includes(c.id));

  async function enviar() {
    setOcupado(true);
    setError("");
    const r = await invitarAClima(codigo, sel, mensaje);
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    const fallidos = r.data.invitados.filter((i) => !(i.correo?.enviado || i.whatsapp?.enviado));
    onListo(
      `Invitación enviada a ${r.data.invitados.length - fallidos.length} de ${r.data.invitados.length} colaborador(es).` +
      (fallidos.length ? ` No salió para: ${fallidos.map((f) => f.nombre).join(", ")} (revisa correo/WhatsApp).` : ""),
      fallidos.length ? "warn" : "ok",
    );
  }

  return (
    <ModalMarco titulo="Invitar colaboradores" subtitulo="Se les manda la liga por correo y WhatsApp, con lo que cada quien tenga en el roster." onClose={onClose}>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, puesto o área…" className={cn(inputRH, "pl-9")} />
      </label>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-ink-3">{sel.length} seleccionado(s) de {filtrados.length}</span>
        <button
          onClick={() => setSel(todos ? sel.filter((x) => !filtrados.some((c) => c.id === x)) : [...new Set([...sel, ...filtrados.map((c) => c.id)])])}
          className="text-xs font-semibold text-brand hover:underline"
        >
          {todos ? "Quitar todos" : "Seleccionar todos"}
        </button>
      </div>

      <div className="mt-2 max-h-[40vh] overflow-y-auto rounded-2xl border border-border-soft">
        {roster === null ? (
          <Cargando texto="Cargando el roster…" />
        ) : filtrados.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">No hay colaboradores activos que coincidan.</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {filtrados.map((c) => {
              const marcado = sel.includes(c.id);
              return (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-surface-2/60">
                    <input type="checkbox" checked={marcado} onChange={() => setSel(marcado ? sel.filter((x) => x !== c.id) : [...sel, c.id])} className="h-4 w-4 rounded border-border-soft text-brand" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{c.nombre}</p>
                      <p className="truncate text-[11px] text-ink-3">
                        {[c.area, c.puesto].filter(Boolean).join(" · ") || "Sin puesto"}
                        {c.correo ? ` · ${c.correo}` : ""}{c.telefono ? ` · ${c.telefono}` : ""}
                      </p>
                    </div>
                    {!c.correo && !c.telefono && <span className="shrink-0 text-[11px] font-semibold text-warn">Sin contacto</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <CampoRH label="Nota para el mensaje (opcional)" ayuda="Se agrega al aviso antes de la liga.">
          <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej. Nos ayuda muchísimo que la contestes esta semana." className={inputRH} />
        </CampoRH>
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={enviar} disabled={!sel.length || ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar invitación
        </Button>
      </div>
    </ModalMarco>
  );
}
