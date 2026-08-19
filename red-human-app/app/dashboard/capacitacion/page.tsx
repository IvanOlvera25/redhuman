"use client";

import { useState } from "react";
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
import { cursos, capacitacionKpis, type Curso } from "@/lib/phase2";
import { cn } from "@/lib/utils";

export default function Capacitacion() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Capacitación" subtitle="Crea, asigna e imparte cursos · el agente evalúa hasta comprobar la comprensión.">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Wand2 className="h-4 w-4" /> Generar curso con IA
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {capacitacionKpis.map((k) => (
          <Card key={k.label} className="p-5">
            <p className="text-sm text-ink-2">{k.label}</p>
            <p className="font-display mt-1.5 text-3xl font-extrabold tabular">{k.value}</p>
          </Card>
        ))}
      </div>

      {/* Catálogo */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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

      {open && <GenerarCurso onClose={() => setOpen(false)} />}
    </div>
  );
}

function CursoCard({ c }: { c: Curso }) {
  return (
    <Card hover className="flex flex-col p-5">
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
      <p className="mt-1 text-sm text-ink-3">{c.categoria}</p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-ink-3" /> {c.duracion}</span>
        <span className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4 text-ink-3" /> {c.modulos} módulos</span>
        <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-ink-3" /> {c.inscritos}</span>
      </div>

      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-ink-3">Avance del grupo</span>
          <span className="font-mono font-semibold tabular">{c.completado}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className={cn("h-full rounded-full bg-gradient-to-r", c.completado >= 80 ? "from-good to-good" : "from-brand to-brand-2")} style={{ width: `${c.completado}%` }} />
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Generar curso con IA ---------------- */
function GenerarCurso({ onClose }: { onClose: () => void }) {
  const [tema, setTema] = useState("Servicio al cliente en piso de venta");
  const [duracion, setDuracion] = useState("2 h");
  const [state, setState] = useState<"form" | "loading" | "done">("form");

  const temario = [
    "Bienvenida y objetivos del curso",
    "Principios del servicio al cliente",
    "Protocolo de atención en piso",
    "Manejo de objeciones y quejas",
    "Cierre de venta y post-venta",
    "Evaluación final",
  ];

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
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Tema del curso</span>
            <input value={tema} onChange={(e) => setTema(e.target.value)} className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Duración estimada</span>
            <input value={duracion} onChange={(e) => setDuracion(e.target.value)} className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </label>

          <Button onClick={() => { setState("loading"); setTimeout(() => setState("done"), 1500); }} disabled={state === "loading"} className="w-full">
            {state === "loading" ? (
              <><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink/40 border-t-brand-ink" /> Generando temario…</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generar objetivos y temario</>
            )}
          </Button>

          {state === "done" && (
            <div className="flex flex-col gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-brand" />
                  <span className="text-sm font-semibold">Objetivo del curso</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  Al finalizar, el colaborador aplicará un protocolo de atención al cliente que mejore
                  la experiencia en piso de venta y aumente la conversión, con base en {tema.toLowerCase()}.
                </p>
              </Card>

              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">Temario generado · {duracion}</p>
                <div className="space-y-2">
                  {temario.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-border-soft bg-surface p-3">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft font-mono text-xs font-bold text-brand">{i + 1}</span>
                      <span className="text-sm">{t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-good/25 bg-good-soft px-3.5 py-2.5 text-sm text-good">
                <Check className="h-4 w-4" /> Incluye ejercicios y evaluación con criterios de aprobación.
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={onClose}>Guardar borrador</Button>
                <Button className="flex-1" onClick={onClose}>Enviar a autorización</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
