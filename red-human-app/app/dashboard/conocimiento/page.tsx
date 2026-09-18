"use client";

/* Base de conocimiento con RAG (2026-09-18). Antes era un Q&A de maqueta (respuestas quemadas por
   palabras clave). Ahora: documentos reales de la Cuenta (políticas, procesos, manuales) → fragmentos con
   embedding → cada pregunta se responde SOLO con esa evidencia, estructurada (respuesta, pasos, fuentes
   citadas, confianza). Sin evidencia lo dice y RH ve qué política falta documentar. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, CornerDownLeft, FileText, Loader2, Plus, RefreshCw, Search, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { usePuedeDecidir } from "@/components/sesion";
import { cn } from "@/lib/utils";
import {
  eliminarDocumentoConocimiento,
  fetchConsultasConocimiento,
  fetchDocumentosConocimiento,
  fetchEstadoConocimiento,
  preguntarConocimiento,
  reindexarDocumentoConocimiento,
  subirDocumentosConocimiento,
  type DocumentoConocimiento,
  type EstadoConocimiento,
  type RespuestaConocimiento,
} from "@/lib/api";

type Msg = { rol: "user" | "assistant"; texto: string; detalle?: RespuestaConocimiento };

const SUGERENCIAS = [
  "¿Cuántos días de vacaciones me corresponden?",
  "¿Cómo solicito un permiso sin goce de sueldo?",
  "¿Cuál es la política de home office?",
  "¿Qué pasos sigo para pedir una constancia laboral?",
];

const TIPO_NOMBRE: Record<string, string> = { politica: "Política", proceso: "Proceso", manual: "Manual", reglamento: "Reglamento", faq: "FAQ", otro: "Otro" };

export default function Conocimiento() {
  const puedeDecidir = usePuedeDecidir();
  const [docs, setDocs] = useState<DocumentoConocimiento[] | null>(null);
  const [estado, setEstado] = useState<EstadoConocimiento | null>(null);
  const [consultas, setConsultas] = useState<{ id: number; pregunta: string; sinEvidencia: boolean; usuario: string }[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pensando, setPensando] = useState(false);
  const [cargar, setCargar] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const recargar = useCallback(async () => {
    const [d, e, c] = await Promise.all([fetchDocumentosConocimiento(), fetchEstadoConocimiento(), fetchConsultasConocimiento()]);
    setDocs(d ?? []);
    if (e) setEstado(e);
    setConsultas((c ?? []).slice(0, 8));
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pensando]);

  async function preguntar(texto?: string) {
    const q = (texto ?? input).trim();
    if (!q || pensando) return;
    setInput("");
    const historial = msgs.slice(-6).map((m) => ({ rol: m.rol, texto: m.texto }));
    setMsgs((m) => [...m, { rol: "user", texto: q }]);
    setPensando(true);
    const r = await preguntarConocimiento(q, historial);
    setPensando(false);
    if (!r.ok) return setMsgs((m) => [...m, { rol: "assistant", texto: `No pude consultar la base: ${r.error}` }]);
    setMsgs((m) => [...m, { rol: "assistant", texto: r.data.respuesta, detalle: r.data }]);
    void recargar();
  }

  async function eliminar(d: DocumentoConocimiento) {
    if (!window.confirm(`¿Quitar «${d.titulo}» de la base de conocimiento? Dejará de usarse en las respuestas.`)) return;
    const r = await eliminarDocumentoConocimiento(d.id);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `«${d.titulo}» eliminado.` });
    void recargar();
  }

  async function reindexar(d: DocumentoConocimiento) {
    const r = await reindexarDocumentoConocimiento(d.id);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `«${d.titulo}» reindexado (${r.data.fragmentos} fragmentos).` });
    void recargar();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Base de conocimiento" subtitle="Respuestas con evidencia: cada respuesta sale de los documentos de tu empresa y cita su fuente.">
        {puedeDecidir && (
          <Button size="sm" onClick={() => setCargar(true)}>
            <Plus className="h-4 w-4" /> Cargar documento
          </Button>
        )}
      </PageHeader>

      {aviso && (
        <div className={cn("mt-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm", aviso.tono === "ok" ? "border-good/30 bg-good-soft/40 text-good" : "border-bad/30 bg-bad-soft/40 text-bad")}>
          <span>{aviso.texto}</span>
          <button onClick={() => setAviso(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ---------- Documentos ---------- */}
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <Eyebrow>Motor</Eyebrow>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="font-display text-xl font-bold">{estado?.documentos ?? "—"}</p>
                <p className="text-[11px] text-ink-3">documentos</p>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="font-display text-xl font-bold">{estado?.fragmentos ?? "—"}</p>
                <p className="text-[11px] text-ink-3">fragmentos indexados</p>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-2">
              {estado?.semantico ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-good" /> Búsqueda semántica (embeddings) + redacción con IA</>
              ) : estado?.iaActiva ? (
                <><AlertTriangle className="h-3.5 w-3.5 text-warn" /> IA activa; carga documentos para indexar</>
              ) : (
                <><AlertTriangle className="h-3.5 w-3.5 text-warn" /> Sin OPENAI_API_KEY: búsqueda por palabras clave (respuesta extractiva)</>
              )}
            </p>
            {Boolean(estado?.consultasSinEvidencia) && (
              <p className="mt-2 text-[12px] text-warn">{estado!.consultasSinEvidencia} pregunta(s) sin evidencia: políticas por documentar.</p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-faint px-4 py-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold"><BookOpen className="h-4 w-4 text-brand" /> Documentos</span>
              <button onClick={() => recargar()} className="grid h-7 w-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" title="Actualizar"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            {docs === null ? (
              <div className="grid place-items-center py-10 text-ink-3"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : docs.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-semibold text-ink">Todavía no hay documentos.</p>
                <p className="mt-1 text-xs text-ink-3">Carga el reglamento interno, políticas de vacaciones, procesos de RH… (PDF con texto, TXT o Markdown).</p>
                {puedeDecidir && <Button size="sm" variant="outline" className="mt-3" onClick={() => setCargar(true)}><Upload className="h-4 w-4" /> Cargar</Button>}
              </div>
            ) : (
              <ul className="max-h-[420px] divide-y divide-border-faint overflow-y-auto">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-start gap-2.5 px-4 py-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-3"><FileText className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink" title={d.titulo}>{d.titulo}</p>
                      <p className="text-[11px] text-ink-3">
                        {TIPO_NOMBRE[d.tipo] ?? d.tipo} · {d.fragmentos} fragmentos{d.conEmbeddings ? "" : " · sin embeddings"}
                      </p>
                    </div>
                    {puedeDecidir && (
                      <MenuAcciones
                        acciones={[
                          { etiqueta: "Reindexar", icono: <RefreshCw />, onClick: () => reindexar(d) },
                          { etiqueta: "Eliminar", icono: <Trash2 />, peligrosa: true, onClick: () => eliminar(d) },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {consultas.length > 0 && (
            <Card className="p-4">
              <Eyebrow>Últimas preguntas</Eyebrow>
              <ul className="mt-2 space-y-1.5">
                {consultas.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5 text-[12px] text-ink-2">
                    {c.sinEvidencia ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" /> : <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-good" />}
                    <button className="text-left hover:text-brand" onClick={() => preguntar(c.pregunta)}>{c.pregunta}</button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ---------- Chat ---------- */}
        <Card className="flex h-[680px] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border-faint px-4 py-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink"><Sparkles className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-semibold">Asistente de la empresa</p>
              <p className="text-[11px] text-ink-3">Responde solo con lo que está documentado · cita la fuente</p>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {msgs.length === 0 && (
              <div className="grid place-items-center py-10 text-center">
                <Search className="h-6 w-6 text-ink-3" />
                <p className="mt-2 text-sm font-semibold text-ink">Pregunta sobre políticas, procesos o prestaciones</p>
                <p className="mt-1 max-w-sm text-xs text-ink-3">Ejemplos:</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {SUGERENCIAS.map((s) => (
                    <button key={s} onClick={() => preguntar(s)} className="rounded-full border border-border-soft bg-surface px-3 py-1.5 text-xs text-ink-2 transition hover:border-brand/40 hover:text-brand">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed", m.rol === "user" ? "bg-brand text-white" : "bg-surface-2 text-ink")}>
                  {m.rol === "assistant" && m.detalle && (
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={m.detalle.sin_evidencia ? "warn" : m.detalle.confianza === "alta" ? "good" : m.detalle.confianza === "media" ? "brand" : "neutral"} dot>
                        {m.detalle.sin_evidencia ? "Sin evidencia documentada" : `Confianza ${m.detalle.confianza}`}
                      </Badge>
                      <span className="font-mono text-[10px] text-ink-3">{m.detalle.modo === "semantico" ? "búsqueda semántica" : m.detalle.modo === "lexico" ? "palabras clave" : m.detalle.modo}</span>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{m.texto}</p>
                  {m.detalle && m.detalle.pasos.length > 0 && (
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">
                      {m.detalle.pasos.map((p, k) => <li key={k}>{p}</li>)}
                    </ol>
                  )}
                  {m.detalle && m.detalle.fuentes.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-border-faint pt-2">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Fuentes</p>
                      {m.detalle.fuentes.map((f, k) => (
                        <p key={k} className="text-[12px] text-ink-2">
                          <FileText className="mr-1 inline h-3 w-3 text-brand" /><b className="text-ink">{f.documento}</b>: «{f.cita}»
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex items-center gap-2 text-ink-3">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                <span className="text-xs italic">Buscando en los documentos…</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-border-faint p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && preguntar()}
              placeholder="Escribe tu pregunta…"
              className="h-11 flex-1 rounded-xl border border-border-soft bg-bg px-4 text-sm outline-none transition focus:border-brand"
            />
            <Button size="sm" onClick={() => preguntar()} disabled={!input.trim() || pensando}>
              {pensando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="flex items-center gap-1 border-t border-border-faint bg-surface-2/40 px-4 py-1.5 text-[11px] text-ink-3"><CornerDownLeft className="h-3 w-3" /> Enter para enviar</p>
        </Card>
      </div>

      {cargar && <ModalCargar tipos={estado?.tipos ?? ["politica", "proceso", "manual", "reglamento", "faq", "otro"]} onClose={() => setCargar(false)} onListo={(n) => { setCargar(false); setAviso({ tono: "ok", texto: `${n} documento(s) indexado(s).` }); void recargar(); }} />}
    </div>
  );
}

function ModalCargar({ tipos, onClose, onListo }: { tipos: string[]; onClose: () => void; onListo: (n: number) => void }) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("politica");
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const listo = archivos.length > 0 || (texto.trim().length > 0 && titulo.trim().length > 0);

  async function guardar() {
    setOcupado(true);
    setError("");
    const r = await subirDocumentosConocimiento({ titulo, tipo, texto, archivos });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onListo(r.data.length);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={() => !ocupado && onClose()}>
      <Card className="flex h-[100dvh] w-full max-w-xl flex-col overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Cargar a la base de conocimiento</h2>
            <p className="mt-1 text-sm text-ink-2">PDF con texto, TXT o Markdown — o pega el texto directo. Se indexa al instante.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-ink-2">Título {archivos.length > 1 ? "(se usa el nombre de cada archivo)" : ""}</span>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Política de vacaciones 2026" className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand">
              {tipos.map((t) => <option key={t} value={t}>{TIPO_NOMBRE[t] ?? t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Archivos</span>
            <input type="file" multiple accept=".pdf,.txt,.md,.markdown,.csv" onChange={(e) => setArchivos(Array.from(e.target.files ?? []))} className="text-xs" />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-ink-2">O pega el texto de la política / proceso</span>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} placeholder="Ej. Los colaboradores tienen derecho a 12 días de vacaciones al cumplir el primer año…" className="rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand" />
          </label>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button size="sm" onClick={guardar} disabled={!listo || ocupado}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {ocupado ? "Indexando…" : "Cargar e indexar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
