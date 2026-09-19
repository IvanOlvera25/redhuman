"use client";

/* Capacitación — módulo UNIVERSAL (2026-09-16).
   Una sola acción principal: «+ Nuevo curso» (Tema, contexto opcional, adjuntos, duración → «Generar curso con
   IA»). El curso generado se abre en su ficha con secciones contraídas. Abajo, el tablero ÚNICO de seguimiento
   (colaboradores, candidatos y externos) con filtros. Sin módulos separados de evaluaciones ni encuestas. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, GraduationCap, Loader2, Paperclip, Plus, Sparkles, X } from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { usePuedeDecidir } from "@/components/sesion";
import { usePolling } from "@/lib/use-polling";
import {
  archivarCurso,
  fetchCapacitacionKpis,
  fetchCursos,
  fetchTableroCapacitacion,
  generarCurso,
  type AsignacionCurso,
  type CapacitacionKpis,
  type Curso,
  type TipoAsignacionCurso,
  type ModalidadCurso,
  etiquetaEstadoCurso,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ETIQUETA_TIPO: Record<TipoAsignacionCurso, string> = { colaborador: "Colaborador", candidato: "Candidato", externo: "Externo" };
const ETIQUETA_ESTADO: Record<AsignacionCurso["estado"], string> = { pendiente: "Pendiente", en_curso: "En curso", completado: "Completado" };

export default function Capacitacion() {
  const router = useRouter();
  const puedeDecidir = usePuedeDecidir();
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [kpis, setKpis] = useState<CapacitacionKpis | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const recargar = useCallback(async () => {
    const [c, k] = await Promise.all([fetchCursos(), fetchCapacitacionKpis()]);
    if (c) setCursos(c);
    if (k) setKpis(k);
    setCargando(false);
  }, []);
  useEffect(() => {
    recargar();
  }, [recargar]);
  usePolling(recargar);

  async function archivar(c: Curso) {
    if (!window.confirm(`¿Archivar el curso «${c.titulo}»? Deja de asignarse; las asignaciones y resultados se conservan.`)) return;
    const r = await archivarCurso(c.id);
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `Curso «${c.titulo}» archivado.` });
    recargar();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Capacitación" subtitle="Un solo tipo de curso: la IA genera objetivo, módulos y evaluación; se asigna a colaboradores, candidatos o externos.">
        {puedeDecidir && (
          <Button onClick={() => setNuevo(true)}>
            <Plus className="h-4 w-4" /> Nuevo curso
          </Button>
        )}
      </PageHeader>

      {aviso && <div className="mt-4"><Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso></div>}

      {kpis && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Cursos publicados", String(kpis.cursosActivos)],
            ["Personas en formación", String(kpis.enFormacion)],
            ["Finalización", `${kpis.tasaFinalizacion}%`],
            ["Aprobación", `${kpis.tasaAprobacion}%`],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
              <p className="font-display mt-1 text-2xl font-bold tabular">{value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Cursos */}
      <section className="mt-8">
        <Eyebrow>Cursos</Eyebrow>
        {cargando ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-border-soft bg-surface-2/60" />)}
          </div>
        ) : cursos.length === 0 ? (
          <Card className="mt-3 flex flex-col items-center gap-2 p-10 text-center">
            <GraduationCap className="h-8 w-8 text-ink-3" />
            <p className="text-sm font-medium text-ink-2">Aún no hay cursos.</p>
            <p className="max-w-sm text-xs text-ink-3">Crea el primero: escribe el tema, adjunta material si tienes y la IA genera el curso completo con su evaluación.</p>
          </Card>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cursos.map((c) => (
              <Card key={c.id} hover className="flex cursor-pointer flex-col gap-3 p-5" onClick={() => router.push(`/dashboard/capacitacion/${c.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.titulo}</p>
                    <p className="truncate text-xs text-ink-3">{c.categoria || "General"} · {c.modalidad === "instructor_ia" ? "Instructor IA" : "Autoguiado"} · {c.duracion || `${c.duracionHoras} h`} · {c.modulos} módulos · {c.preguntas} preguntas</p>
                  </div>
                  <Badge tone={c.estado === "Publicado" ? "good" : "neutral"} dot>{etiquetaEstadoCurso(c.estado)}</Badge>
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-ink-2">{c.objetivo}</p>
                <div className="mt-auto flex items-center justify-between border-t border-border-faint pt-3 text-[11px] text-ink-3">
                  <span>{c.asignados} asignados · {c.completados} completados · {c.aprobados} aprobados</span>
                  {puedeDecidir && (
                    <MenuAcciones
                      etiqueta={`Acciones de ${c.titulo}`}
                      acciones={[
                        { etiqueta: "Abrir", icono: <BookOpen />, onClick: () => router.push(`/dashboard/capacitacion/${c.id}`) },
                        { etiqueta: "Archivar", icono: <X />, peligrosa: true, onClick: () => archivar(c) },
                      ]}
                    />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Tablero cursos={cursos} />

      {nuevo && (
        <NuevoCurso
          onClose={() => setNuevo(false)}
          onGenerado={(c) => {
            setNuevo(false);
            recargar();
            router.push(`/dashboard/capacitacion/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Nuevo curso: solo Tema, contexto opcional, adjuntos y duración ---------------- */
function NuevoCurso({ onClose, onGenerado }: { onClose: () => void; onGenerado: (c: Curso) => void }) {
  const [tema, setTema] = useState("");
  const [contexto, setContexto] = useState("");
  const [duracion, setDuracion] = useState("15 min");
  const [modalidad, setModalidad] = useState<ModalidadCurso>("instructor_ia");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function generar() {
    if (!tema.trim()) return setError("Escribe el tema del curso.");
    if (!duracion.trim()) return setError("Indica la duración (ej. 5 min, 15 min, 1 h).");
    setGenerando(true);
    setError("");
    const r = await generarCurso({ tema: tema.trim(), duracion: duracion.trim(), modalidad, contexto: contexto.trim(), archivos });
    setGenerando(false);
    if (!r.ok) return setError(r.error);
    onGenerado(r.data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !generando && onClose()}>
      <Card className="max-h-[92dvh] w-full max-w-lg overflow-y-auto p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Nuevo curso</h2>
            <p className="mt-1 text-sm text-ink-2">La IA genera el objetivo, los módulos y la evaluación final a partir de esto.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Tema *</span>
            <input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej. Atención al cliente en sucursal" className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </label>
          {/* 2026-09-19 (Bloque 4): antes de generar, cómo se imparte */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">¿Cómo quieres impartir este curso? *</span>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "instructor_ia", titulo: "Instructor IA", detalle: "El avatar explica en voz alta, responde dudas y avanza módulo por módulo." },
                { id: "autoguiado", titulo: "Autoguiado", detalle: "La persona lee contenido breve y visual a su ritmo." },
              ] as { id: ModalidadCurso; titulo: string; detalle: string }[]).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setModalidad(o.id)}
                  className={cn("rounded-xl border p-3 text-left transition", modalidad === o.id ? "border-brand bg-brand-soft" : "border-border-soft hover:border-brand/40")}
                >
                  <p className="text-sm font-semibold text-ink">{o.titulo}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{o.detalle}</p>
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Contexto (opcional)</span>
            <textarea value={contexto} onChange={(e) => setContexto(e.target.value)} rows={2} placeholder="Para quién es, tono, qué enfatizar…" className="rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">Duración *</span>
              <input value={duracion} onChange={(e) => setDuracion(e.target.value)} placeholder="5 min, 15 min, 1 h, 2 horas…" list="duraciones-curso" className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
              <datalist id="duraciones-curso">
                {["5 min", "10 min", "15 min", "30 min", "45 min", "1 h", "1 h 30 min", "2 h", "4 h"].map((d) => <option key={d} value={d} />)}
              </datalist>
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">Adjuntar archivos (PDF, texto)</span>
              <input ref={inputRef} type="file" multiple accept=".pdf,.txt,.md,.csv" className="hidden" onChange={(e) => setArchivos(Array.from(e.target.files ?? []).slice(0, 5))} />
              <Button type="button" variant="outline" size="sm" className="h-11 justify-start" onClick={() => inputRef.current?.click()}>
                <Paperclip className="h-4 w-4" /> {archivos.length ? `${archivos.length} archivo(s)` : "Elegir archivos"}
              </Button>
            </div>
          </div>
          {archivos.length > 0 && <p className="text-[11px] text-ink-3">{archivos.map((f) => f.name).join(" · ")}</p>}
          {error && <p className="text-sm font-semibold text-bad">{error}</p>}
          <Button className="mt-1 w-full" onClick={generar} disabled={generando}>
            {generando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generando ? "Generando curso…" : "Generar curso con IA"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Tablero único de seguimiento ---------------- */
function Tablero({ cursos }: { cursos: Curso[] }) {
  const [filas, setFilas] = useState<AsignacionCurso[]>([]);
  const [tipo, setTipo] = useState<TipoAsignacionCurso | "">("");
  const [estado, setEstado] = useState("");
  const [curso, setCurso] = useState("");
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    const d = await fetchTableroCapacitacion({ tipo, estado, curso });
    if (d) setFilas(d);
    setCargando(false);
  }, [tipo, estado, curso]);
  useEffect(() => {
    recargar();
  }, [recargar]);
  usePolling(recargar);

  const sel = "h-9 rounded-xl border border-border-soft bg-surface px-3 text-xs outline-none focus:border-brand";

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow className="mr-auto">Seguimiento</Eyebrow>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAsignacionCurso | "")} className={sel}>
          <option value="">Todos</option>
          <option value="colaborador">Colaboradores</option>
          <option value="candidato">Candidatos</option>
          <option value="externo">Externos</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className={sel}>
          <option value="">Cualquier estado</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_curso">En curso</option>
          <option value="completado">Completado</option>
        </select>
        <select value={curso} onChange={(e) => setCurso(e.target.value)} className={sel}>
          <option value="">Todos los cursos</option>
          {cursos.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
        </select>
      </div>
      <Card className="mt-3 overflow-x-auto p-0">
        {cargando ? (
          <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-ink-3" /></div>
        ) : filas.length === 0 ? (
          <p className="p-6 text-sm text-ink-3">Sin asignaciones con estos filtros.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border-faint text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-4 py-2.5 font-medium">Persona</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium">Curso</th>
                <th className="px-4 py-2.5 font-medium">Avance</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-faint">
              {filas.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{a.persona}</p>
                    <p className="text-[11px] text-ink-3">{a.vacante ? `Vacante: ${a.vacante}` : a.organizacion || a.correo || a.telefono || a.id}</p>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone={a.tipo === "candidato" ? "brand" : a.tipo === "externo" ? "warn" : "neutral"}>{ETIQUETA_TIPO[a.tipo]}</Badge></td>
                  <td className="px-4 py-2.5 text-ink-2">{a.cursoTitulo}</td>
                  <td className="px-4 py-2.5 text-ink-2">{a.moduloActual}/{a.totalModulos} módulos</td>
                  <td className="px-4 py-2.5"><Badge tone={a.estado === "completado" ? "good" : a.estado === "en_curso" ? "brand" : "neutral"} dot>{ETIQUETA_ESTADO[a.estado]}</Badge></td>
                  <td className="px-4 py-2.5">
                    {a.calificacion === null ? <span className="text-ink-3">—</span> : (
                      <span className={a.aprobado ? "font-semibold text-good" : "font-semibold text-bad"}>{a.aprobado ? "Aprobado" : "No aprobado"} · {a.calificacion}%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
