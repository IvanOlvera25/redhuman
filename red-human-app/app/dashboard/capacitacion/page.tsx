"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GraduationCap,
  Users,
  Clock,
  Wand2,
  X,
  Check,
  Sparkles,
  BookOpen,
  Award,
  Plus,
} from "lucide-react";
import { Card, Badge, Button, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import { fetchCursos, fetchCapacitacionKpis, generarCurso, type Curso, type CapacitacionKpis } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function Capacitacion() {
  const [open, setOpen] = useState(false);
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [kpis, setKpis] = useState<CapacitacionKpis | null>(null);
  const [cargando, setCargando] = useState(true);

  async function recargar() {
    const [c, k] = await Promise.all([fetchCursos(), fetchCapacitacionKpis()]);
    if (c) setCursos(c);
    if (k) setKpis(k);
    setCargando(false);
  }

  useEffect(() => {
    recargar();
  }, []);

  const tarjetasKpi = [
    { label: "Cursos activos", value: kpis?.cursosActivos ?? 0 },
    { label: "Colaboradores en formación", value: kpis?.colaboradoresEnFormacion ?? 0 },
    { label: "Tasa de finalización", value: `${kpis?.tasaFinalizacionGlobal ?? 0}%` },
    { label: "Horas impartidas", value: kpis?.horasImpartidas ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Capacitación" subtitle="Crea, asigna e imparte cursos · el agente evalúa hasta comprobar la comprensión.">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Wand2 className="h-4 w-4" /> Generar curso con IA
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tarjetasKpi.map((k) => (
          <Card key={k.label} className="p-5">
            <p className="text-sm text-ink-2">{k.label}</p>
            <p className="font-display mt-1.5 text-3xl font-extrabold tabular">{k.value}</p>
          </Card>
        ))}
      </div>

      {/* Catálogo */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!cargando && cursos.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-ink-3">
            Todavía no hay cursos. Genera el primero con IA.
          </p>
        )}
        {cursos.map((c) => (
          <CursoCard key={c.id} c={c} />
        ))}

        <button
          onClick={() => setOpen(true)}
          className="group grid min-h-[200px] place-items-center rounded-2xl border border-dashed border-border-soft text-ink-3 transition hover:border-brand hover:text-brand"
        >
          <span className="flex flex-col items-center gap-2">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 transition group-hover:bg-brand-soft">
              <Plus className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium">Crear curso</span>
          </span>
        </button>
      </div>

      {open && (
        <GenerarCurso
          onClose={() => setOpen(false)}
          onListo={() => {
            setOpen(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

function CursoCard({ c }: { c: Curso }) {
  const avance = c.asignados > 0 ? Math.round((c.completados / c.asignados) * 100) : 0;
  return (
    <Link href={`/dashboard/capacitacion/${c.id}`}>
      <Card hover className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="flex gap-1.5">
            {c.obligatorio && <Badge tone="human">Obligatorio</Badge>}
            <Badge tone={c.estado === "Publicado" ? "good" : "neutral"} dot>{c.estado}</Badge>
          </div>
        </div>

        <h3 className="font-display mt-4 text-lg font-bold leading-snug">{c.titulo}</h3>
        <p className="mt-1 text-sm text-ink-3">{c.categoria || "Sin categoría"}</p>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
          <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-ink-3" /> {c.duracionHoras} h</span>
          <span className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4 text-ink-3" /> {c.modulos} módulos</span>
          <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-ink-3" /> {c.asignados}</span>
        </div>

        <div className="mt-auto pt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-ink-3">Avance del grupo</span>
            <span className="font-mono font-semibold tabular">{avance}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className={cn("h-full rounded-full bg-gradient-to-r", avance >= 80 ? "from-good to-good" : "from-brand to-brand-2")} style={{ width: `${avance}%` }} />
          </div>
        </div>
      </Card>
    </Link>
  );
}

/* ---------------- Generar curso con IA ---------------- */
function GenerarCurso({ onClose, onListo }: { onClose: () => void; onListo: () => void }) {
  const [tema, setTema] = useState("");
  const [duracionHoras, setDuracionHoras] = useState(2);
  const [categoria, setCategoria] = useState("");
  const [obligatorio, setObligatorio] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");
  const [curso, setCurso] = useState<Curso | null>(null);

  async function generar() {
    if (!tema.trim()) {
      setError("Escribe el tema del curso.");
      return;
    }
    setGenerando(true);
    setError("");
    const r = await generarCurso({ tema, duracionHoras, categoria, obligatorio });
    setGenerando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCurso(r.data);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border-soft bg-bg shadow-2xl">
        <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border-soft px-6 py-4">
          <div>
            <Eyebrow>Generador de cursos</Eyebrow>
            <h2 className="font-display text-xl font-bold">Nuevo curso con IA</h2>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-6">
          {!curso && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Tema del curso</span>
                <input
                  value={tema}
                  onChange={(e) => setTema(e.target.value)}
                  placeholder="Ej. Seguridad e higiene en almacén"
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Duración estimada (horas)</span>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={duracionHoras}
                    onChange={(e) => setDuracionHoras(Number(e.target.value))}
                    className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Categoría (opcional)</span>
                  <input
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    placeholder="Ej. Cumplimiento"
                    className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={obligatorio} onChange={(e) => setObligatorio(e.target.checked)} className="h-4 w-4 rounded border-border-soft" />
                Obligatorio
              </label>

              {error && <Aviso tono="error">{error}</Aviso>}

              <Button onClick={generar} disabled={generando} className="w-full">
                {generando ? (
                  <><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink/40 border-t-brand-ink" /> Generando temario…</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Generar objetivos y temario</>
                )}
              </Button>
            </>
          )}

          {curso && (
            <div className="flex flex-col gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-brand" />
                  <span className="text-sm font-semibold">Objetivo del curso</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{curso.objetivo}</p>
              </Card>

              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">
                  Temario generado · {curso.duracionHoras} h
                </p>
                <div className="space-y-2">
                  {(curso.listaModulos ?? []).map((m) => (
                    <div key={m.orden} className="rounded-xl border border-border-soft bg-surface p-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft font-mono text-xs font-bold text-brand">{m.orden}</span>
                        <span className="text-sm font-medium">{m.titulo}</span>
                      </div>
                      <p className="mt-2 pl-10 text-xs leading-relaxed text-ink-3">{m.contenido}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-good/25 bg-good-soft px-3.5 py-2.5 text-sm text-good">
                <Check className="h-4 w-4" /> Incluye ejercicios y evaluación con criterios de aprobación.
              </div>

              <Button className="w-full" onClick={onListo}>Listo — quedó guardado como borrador</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
