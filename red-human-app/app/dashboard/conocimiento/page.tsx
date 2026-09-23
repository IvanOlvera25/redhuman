"use client";

/* Base de conocimiento con RAG. Dos vistas (2026-09-23):
   1) «Documentos» (RH): cargar archivos, pegar texto o GENERAR el borrador con Red Human, definir quién
      lo ve por área/puesto del roster y publicarlo.
   2) «Consultar» (colaborador): chat donde Red Human responde SOLO con documentos publicados y visibles
      para quien pregunta, citando la fuente. Sin evidencia lo dice y RH ve qué política falta documentar. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, CheckCircle2, CornerDownLeft, Eye, EyeOff, FileText, Loader2, Lock, Plus,
  RefreshCw, Search, Send, Shield, Sparkles, Trash2, Upload, Users, X,
} from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { AvisoLinea, CampoRH, Cargando, ModalMarco, inputRH, type AvisoRH } from "@/components/dashboard/modulos-rh";
import { usePuedeDecidir } from "@/components/sesion";
import { cn } from "@/lib/utils";
import {
  eliminarDocumentoConocimiento,
  fetchAreasConocimiento,
  fetchColaboradores,
  fetchConsultasConocimiento,
  fetchDocumentosConocimiento,
  fetchEstadoConocimiento,
  generarDocumentoConocimiento,
  guardarPermisosConocimiento,
  preguntarConocimiento,
  reindexarDocumentoConocimiento,
  subirDocumentosConocimiento,
  type Colaborador,
  type DocumentoConocimiento,
  type EstadoConocimiento,
  type RespuestaConocimiento,
} from "@/lib/api";

type Msg = { rol: "user" | "assistant"; texto: string; detalle?: RespuestaConocimiento };
type Vista = "documentos" | "consulta";

const SUGERENCIAS = [
  "¿Cuántos días de vacaciones me corresponden?",
  "¿Cómo solicito un permiso sin goce de sueldo?",
  "¿Cuál es la política de home office?",
  "¿Qué pasos sigo para pedir una constancia laboral?",
];

const TIPO_NOMBRE: Record<string, string> = { politica: "Política", proceso: "Proceso", manual: "Manual", reglamento: "Reglamento", faq: "FAQ", otro: "Otro" };

export default function Conocimiento() {
  const puedeDecidir = usePuedeDecidir();
  const [vista, setVista] = useState<Vista>("documentos");
  const [docs, setDocs] = useState<DocumentoConocimiento[] | null>(null);
  const [estado, setEstado] = useState<EstadoConocimiento | null>(null);
  const [consultas, setConsultas] = useState<{ id: number; pregunta: string; sinEvidencia: boolean; usuario: string }[]>([]);
  const [aviso, setAviso] = useState<AvisoRH>(null);
  const [cargar, setCargar] = useState(false);
  const [permisos, setPermisos] = useState<DocumentoConocimiento | null>(null);

  const recargar = useCallback(async () => {
    const [d, e, c] = await Promise.all([fetchDocumentosConocimiento(), fetchEstadoConocimiento(), fetchConsultasConocimiento()]);
    setDocs(d ?? []);
    if (e) setEstado(e);
    setConsultas((c ?? []).slice(0, 8));
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

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

  async function publicar(d: DocumentoConocimiento, publicado: boolean) {
    const r = await guardarPermisosConocimiento(d.id, { publicado });
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: publicado ? `«${d.titulo}» publicado: ya lo usa Red Human para responder.` : `«${d.titulo}» despublicado: deja de usarse en las respuestas.` });
    void recargar();
  }

  const publicados = (docs ?? []).filter((d) => d.publicado !== false).length;
  const tabCls = (v: Vista) => cn(
    "rounded-full px-4 py-2 text-sm font-semibold transition",
    vista === v ? "bg-brand text-brand-ink shadow-sm" : "text-ink-2 hover:bg-surface-2",
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Base de conocimiento" subtitle="Lo que la empresa tiene documentado. Red Human responde solo con lo publicado y cita su fuente.">
        {puedeDecidir && vista === "documentos" && (
          <Button size="sm" onClick={() => setCargar(true)}><Plus className="h-4 w-4" /> Nuevo documento</Button>
        )}
      </PageHeader>

      {/* Dos vistas: administrar vs consultar */}
      <div className="mt-5 inline-flex rounded-full border border-border-soft bg-surface p-1">
        <button className={tabCls("documentos")} onClick={() => setVista("documentos")}>
          <BookOpen className="mr-1.5 inline h-4 w-4" /> Documentos y accesos
        </button>
        <button className={tabCls("consulta")} onClick={() => setVista("consulta")}>
          <Sparkles className="mr-1.5 inline h-4 w-4" /> Consultar a Red Human
        </button>
      </div>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {vista === "documentos" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* Tabla de documentos */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-faint px-5 py-3.5">
              <div>
                <h3 className="font-display text-lg font-bold">Documentos</h3>
                <p className="text-sm text-ink-3">{publicados} publicado(s) de {docs?.length ?? 0} · solo los publicados alimentan las respuestas</p>
              </div>
              <button onClick={() => recargar()} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-surface-2" title="Actualizar">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {docs === null ? (
              <Cargando />
            ) : docs.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><BookOpen className="h-7 w-7" /></span>
                <p className="mt-4 text-sm font-semibold text-ink">Todavía no hay documentos</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-3">
                  Carga el reglamento interno, las políticas de vacaciones o los procesos de RH (PDF con texto, TXT o Markdown),
                  pega el texto directo, o pídele a Red Human que redacte el borrador.
                </p>
                {puedeDecidir && <Button size="sm" className="mt-4" onClick={() => setCargar(true)}><Upload className="h-4 w-4" /> Nuevo documento</Button>}
              </div>
            ) : (
              <div className="scroll-x">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">Documento</th>
                      <th className="px-5 py-2.5 font-semibold">Tipo</th>
                      <th className="px-5 py-2.5 font-semibold">Quién lo ve</th>
                      <th className="px-5 py-2.5 font-semibold">Estado</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-faint">
                    {docs.map((d) => {
                      const publicado = d.publicado !== false;
                      const restringido = Boolean((d.areas ?? []).length || (d.puestos ?? []).length);
                      return (
                        <tr key={d.id} className="align-top transition hover:bg-surface-2/50">
                          <td className="px-5 py-3">
                            <p className="font-semibold text-ink" title={d.titulo}>{d.titulo}</p>
                            <p className="text-[11px] text-ink-3">{d.fragmentos} fragmentos{d.conEmbeddings ? "" : " · sin embeddings"}</p>
                          </td>
                          <td className="px-5 py-3 text-ink-2">{TIPO_NOMBRE[d.tipo] ?? d.tipo}</td>
                          <td className="px-5 py-3">
                            {restringido ? (
                              <div className="flex flex-wrap gap-1">
                                {(d.areas ?? []).map((a) => <span key={a} className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand">{a}</span>)}
                                {(d.puestos ?? []).map((p) => <span key={p} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{p}</span>)}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[12px] text-ink-3"><Users className="h-3.5 w-3.5" /> Toda la empresa</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <Badge tone={publicado ? "good" : "neutral"} dot>{publicado ? "Publicado" : "Borrador"}</Badge>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-2">
                              {puedeDecidir && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => setPermisos(d)}>
                                    <Shield className="h-4 w-4" /> Accesos
                                  </Button>
                                  <Button size="sm" variant={publicado ? "secondary" : "primary"} onClick={() => publicar(d, !publicado)}>
                                    {publicado ? <><EyeOff className="h-4 w-4" /> Despublicar</> : <><Eye className="h-4 w-4" /> Publicar</>}
                                  </Button>
                                  <MenuAcciones
                                    acciones={[
                                      { etiqueta: "Reindexar", icono: <RefreshCw />, onClick: () => reindexar(d) },
                                      { etiqueta: "Eliminar", icono: <Trash2 />, peligrosa: true, onClick: () => eliminar(d) },
                                    ]}
                                  />
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Estado del motor + preguntas sin evidencia */}
          <div className="flex flex-col gap-4">
            <Card className="p-5">
              <Eyebrow>Motor de respuestas</Eyebrow>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="font-display text-xl font-bold">{estado?.documentos ?? "—"}</p>
                  <p className="text-[11px] text-ink-3">documentos</p>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="font-display text-xl font-bold">{estado?.fragmentos ?? "—"}</p>
                  <p className="text-[11px] text-ink-3">fragmentos indexados</p>
                </div>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-2">
                {estado?.semantico ? (
                  <><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" /> Búsqueda semántica (embeddings) + redacción con IA</>
                ) : estado?.iaActiva ? (
                  <><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> IA activa; carga documentos para indexar</>
                ) : (
                  <><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> Sin OPENAI_API_KEY: búsqueda por palabras clave (respuesta extractiva)</>
                )}
              </p>
              {Boolean(estado?.consultasSinEvidencia) && (
                <p className="mt-2 text-[12px] text-warn">{estado!.consultasSinEvidencia} pregunta(s) sin evidencia: políticas por documentar.</p>
              )}
            </Card>

            {consultas.length > 0 && (
              <Card className="p-5">
                <Eyebrow>Últimas preguntas</Eyebrow>
                <ul className="mt-2 space-y-1.5">
                  {consultas.map((c) => (
                    <li key={c.id} className="flex items-start gap-1.5 text-[12px] text-ink-2">
                      {c.sinEvidencia ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" /> : <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-good" />}
                      <span>{c.pregunta}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-ink-3">Las marcadas en ámbar no tenían documento que las respondiera.</p>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <VistaConsulta onNuevaConsulta={() => void recargar()} />
      )}

      {cargar && (
        <ModalNuevoDocumento
          tipos={estado?.tipos ?? ["politica", "proceso", "manual", "reglamento", "faq", "otro"]}
          onClose={() => setCargar(false)}
          onListo={(n) => { setCargar(false); setAviso({ tono: "ok", texto: `${n} documento(s) indexado(s). Define sus accesos y publícalo cuando esté listo.` }); void recargar(); }}
        />
      )}

      {permisos && (
        <ModalPermisos
          doc={permisos}
          onClose={() => setPermisos(null)}
          onGuardado={(texto) => { setPermisos(null); setAviso({ tono: "ok", texto }); void recargar(); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Vista 2 — Consulta tipo chat (con permisos de quien pregunta)
   ============================================================ */

function VistaConsulta({ onNuevaConsulta }: { onNuevaConsulta: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pensando, setPensando] = useState(false);
  const [roster, setRoster] = useState<Colaborador[]>([]);
  const [comoQuien, setComoQuien] = useState("");  // vacío = sesión de RH (ve todo lo publicado)
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchColaboradores(true).then((c) => setRoster(c ?? []));
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pensando]);

  const quien = roster.find((c) => c.id === comoQuien);

  async function preguntar(texto?: string) {
    const q = (texto ?? input).trim();
    if (!q || pensando) return;
    setInput("");
    const historial = msgs.slice(-6).map((m) => ({ rol: m.rol, texto: m.texto }));
    setMsgs((m) => [...m, { rol: "user", texto: q }]);
    setPensando(true);
    const r = await preguntarConocimiento(q, historial, comoQuien);
    setPensando(false);
    if (!r.ok) return setMsgs((m) => [...m, { rol: "assistant", texto: `No pude consultar la base: ${r.error}` }]);
    setMsgs((m) => [...m, { rol: "assistant", texto: r.data.respuesta, detalle: r.data }]);
    onNuevaConsulta();
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card className="flex h-[640px] flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border-faint px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-brand-ink"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Red Human · asistente de la empresa</p>
            <p className="truncate text-[11px] text-ink-3">
              {quien ? `Respondiendo como lo vería ${quien.nombre} (${[quien.area, quien.puesto].filter(Boolean).join(" · ") || "sin área"})` : "Responde solo con lo documentado y publicado · cita la fuente"}
            </p>
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
                    <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Fuentes publicadas</p>
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
              <span className="text-xs italic">Buscando en los documentos publicados…</span>
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
        <p className="flex items-center gap-1 border-t border-border-faint bg-surface-2/40 px-4 py-1.5 text-[11px] text-ink-3">
          <CornerDownLeft className="h-3 w-3" /> Enter para enviar
        </p>
      </Card>

      {/* Probar permisos: ver la base con los ojos de un colaborador */}
      <Card className="h-fit p-5">
        <Eyebrow><span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Ver como</span></Eyebrow>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
          Comprueba qué alcanza a ver cada quien: Red Human responderá solo con los documentos publicados para su
          área o su puesto.
        </p>
        <select value={comoQuien} onChange={(e) => { setComoQuien(e.target.value); setMsgs([]); }} className={cn(inputRH, "mt-3")}>
          <option value="">Recursos Humanos (ve todo lo publicado)</option>
          {roster.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre} — {[c.area, c.puesto].filter(Boolean).join(" · ") || "sin área"}</option>
          ))}
        </select>
        {quien && (
          <p className="mt-3 rounded-xl bg-brand-soft/50 px-3 py-2 text-[12px] text-ink-2">
            Estás preguntando como <b className="text-ink">{quien.nombre}</b>. Cambiar de persona limpia la conversación.
          </p>
        )}
        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
          <Shield className="mt-0.5 h-3 w-3 shrink-0 text-human" />
          Un documento en borrador nunca alimenta una respuesta, aunque esté indexado.
        </p>
      </Card>
    </div>
  );
}

/* ============================================================
   Nuevo documento: archivo · texto pegado · borrador con Red Human
   ============================================================ */

function ModalNuevoDocumento({ tipos, onClose, onListo }: { tipos: string[]; onClose: () => void; onListo: (n: number) => void }) {
  const [modo, setModo] = useState<"archivo" | "texto" | "ia">("archivo");
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("politica");
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [tema, setTema] = useState("");
  const [notas, setNotas] = useState("");
  const [avisosIa, setAvisosIa] = useState<string[]>([]);
  const [generando, setGenerando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const listo = modo === "archivo" ? archivos.length > 0 : texto.trim().length > 0 && titulo.trim().length > 0;

  async function generar() {
    if (!tema.trim()) return setError("Dime de qué trata el documento.");
    setGenerando(true);
    setError("");
    const r = await generarDocumentoConocimiento({ tema, tipo, notas });
    setGenerando(false);
    if (!r.ok) return setError(r.error);
    setTitulo(r.data.titulo || tema);
    setTexto(r.data.texto);
    setAvisosIa(r.data.avisos ?? []);
  }

  async function guardar() {
    setOcupado(true);
    setError("");
    const r = await subirDocumentosConocimiento({ titulo, tipo, texto: modo === "archivo" ? "" : texto, archivos: modo === "archivo" ? archivos : [] });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onListo(r.data.length);
  }

  const tabCls = (m: typeof modo) => cn(
    "flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
    modo === m ? "bg-brand text-brand-ink shadow-sm" : "bg-surface-2 text-ink-2 hover:text-ink",
  );

  return (
    <ModalMarco titulo="Nuevo documento" subtitulo="Cárgalo, pégalo o pídele el borrador a Red Human. Después defines quién lo ve y lo publicas." onClose={onClose} ancho="max-w-2xl">
      <div className="flex gap-2">
        <button className={tabCls("archivo")} onClick={() => setModo("archivo")}><Upload className="mr-1.5 inline h-4 w-4" /> Subir archivo</button>
        <button className={tabCls("texto")} onClick={() => setModo("texto")}><FileText className="mr-1.5 inline h-4 w-4" /> Pegar texto</button>
        <button className={tabCls("ia")} onClick={() => setModo("ia")}><Sparkles className="mr-1.5 inline h-4 w-4" /> Generar con Red Human</button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CampoRH label={`Título${modo === "archivo" && archivos.length > 1 ? " (se usa el nombre de cada archivo)" : ""}`}>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Política de vacaciones 2026" className={inputRH} />
        </CampoRH>
        <CampoRH label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputRH}>
            {tipos.map((t) => <option key={t} value={t}>{TIPO_NOMBRE[t] ?? t}</option>)}
          </select>
        </CampoRH>
      </div>

      {modo === "archivo" && (
        <div className="mt-3">
          <CampoRH label="Archivos" ayuda="PDF con texto, TXT, Markdown o CSV. Se indexan al instante.">
            <input type="file" multiple accept=".pdf,.txt,.md,.markdown,.csv" onChange={(e) => setArchivos(Array.from(e.target.files ?? []))} className="text-sm" />
          </CampoRH>
        </div>
      )}

      {modo === "ia" && (
        <div className="mt-3 rounded-2xl border border-brand/25 bg-brand-soft/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoRH label="¿De qué trata?"><input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej. Política de home office" className={inputRH} /></CampoRH>
            <CampoRH label="Notas de RH (opcional)"><input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Días permitidos, quién autoriza…" className={inputRH} /></CampoRH>
          </div>
          <Button size="sm" variant="secondary" className="mt-3" onClick={generar} disabled={generando}>
            {generando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {generando ? "Redactando…" : "Redactar borrador"}
          </Button>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
            Red Human nunca inventa montos, días ni plazos: lo que no le diste queda como «[por definir]» para que tú lo completes.
          </p>
          {avisosIa.length > 0 && (
            <ul className="mt-2 space-y-1">
              {avisosIa.map((a, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12px] text-warn"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {a}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modo !== "archivo" && (
        <div className="mt-3">
          <CampoRH label="Contenido del documento" ayuda="Revísalo y edítalo antes de guardar: es lo que Red Human usará para responder.">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={12}
              placeholder="Ej. Los colaboradores tienen derecho a 12 días de vacaciones al cumplir el primer año…"
              className="w-full rounded-xl border border-border-soft bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </CampoRH>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={!listo || ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {ocupado ? "Indexando…" : "Guardar e indexar"}
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ============================================================
   Accesos por área / puesto (del roster maestro)
   ============================================================ */

function ModalPermisos({ doc, onClose, onGuardado }: { doc: DocumentoConocimiento; onClose: () => void; onGuardado: (texto: string) => void }) {
  const [opciones, setOpciones] = useState<{ areas: string[]; puestos: string[] } | null>(null);
  const [areas, setAreas] = useState<string[]>(doc.areas ?? []);
  const [puestos, setPuestos] = useState<string[]>(doc.puestos ?? []);
  const [publicado, setPublicado] = useState(doc.publicado !== false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAreasConocimiento().then((o) => setOpciones(o ?? { areas: [], puestos: [] }));
  }, []);

  const abierto = areas.length === 0 && puestos.length === 0;
  const alternar = (lista: string[], set: (v: string[]) => void, valor: string) =>
    set(lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor]);

  async function guardar() {
    setOcupado(true);
    setError("");
    const r = await guardarPermisosConocimiento(doc.id, { publicado, areas, puestos });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onGuardado(`Accesos de «${doc.titulo}» actualizados${publicado ? "" : " (queda en borrador: no se usa para responder)"}.`);
  }

  return (
    <ModalMarco titulo={`Accesos de «${doc.titulo}»`} subtitulo="Las áreas y puestos salen del roster de colaboradores. Sin selección, lo ve toda la empresa." onClose={onClose}>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-soft p-3.5 transition hover:border-brand/40">
        <input type="checkbox" checked={publicado} onChange={(e) => setPublicado(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border-soft text-brand" />
        <span className="text-[13px] text-ink-2">
          <b className="text-ink">Publicado</b> — Red Human puede usarlo para responder. Si lo dejas sin marcar, queda como
          borrador visible solo para RH y nunca aparece en una respuesta.
        </span>
      </label>

      {opciones === null ? (
        <Cargando texto="Leyendo el roster…" />
      ) : (
        <>
          <div className="mt-4">
            <Eyebrow>Áreas que pueden verlo</Eyebrow>
            {opciones.areas.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">Todavía no hay áreas capturadas en el roster de colaboradores.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {opciones.areas.map((a) => (
                  <button
                    key={a}
                    onClick={() => alternar(areas, setAreas, a)}
                    className={cn(
                      "rounded-full border px-3.5 py-2 text-sm font-medium transition",
                      areas.includes(a) ? "border-brand bg-brand text-brand-ink" : "border-border-soft bg-surface text-ink-2 hover:border-brand/40",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <Eyebrow>Puestos que pueden verlo</Eyebrow>
            {opciones.puestos.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">Todavía no hay puestos capturados en el roster.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {opciones.puestos.map((p) => (
                  <button
                    key={p}
                    onClick={() => alternar(puestos, setPuestos, p)}
                    className={cn(
                      "rounded-full border px-3.5 py-2 text-sm font-medium transition",
                      puestos.includes(p) ? "border-brand bg-brand text-brand-ink" : "border-border-soft bg-surface text-ink-2 hover:border-brand/40",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <p className={cn("mt-4 rounded-xl px-3.5 py-2.5 text-[12px]", abierto ? "bg-surface-2 text-ink-2" : "bg-brand-soft/50 text-ink-2")}>
        {abierto
          ? "Sin restricciones: lo verá cualquier colaborador de la empresa."
          : `Solo lo verán quienes estén en ${[areas.length ? `las áreas ${areas.join(", ")}` : "", puestos.length ? `los puestos ${puestos.join(", ")}` : ""].filter(Boolean).join(" o ")}.`}
      </p>

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />} Guardar accesos
        </Button>
      </div>
    </ModalMarco>
  );
}
