import { TrendingUp, TrendingDown, Minus, Target, Sparkles, ArrowRight } from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { CompetenciasRadar } from "@/components/dashboard/charts";
import { competencias, kpisDesempeno, equipoDesempeno, brechas } from "@/lib/phase2";
import { cn } from "@/lib/utils";

const tendIcon = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;
const tendColor = { up: "text-good", down: "text-bad", flat: "text-ink-3" } as const;

export default function Desempeno() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Desempeño y productividad" subtitle="Competencias y KPIs contra el perfil del puesto · brechas y desarrollo.">
        <Badge tone="brand" dot>Ciclo 2026-S2</Badge>
      </PageHeader>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Radar */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-bold">Competencias del equipo</h3>
              <p className="text-sm text-ink-3">Promedio actual vs. meta del puesto</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" /> Actual</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-human" /> Meta</span>
            </div>
          </div>
          <div className="mt-2">
            <CompetenciasRadar data={competencias} />
          </div>
        </Card>

        {/* KPIs vs meta */}
        <Card className="p-5">
          <h3 className="font-display text-lg font-bold">KPIs vs. metas</h3>
          <p className="text-sm text-ink-3">Resultados reales del periodo</p>
          <div className="mt-5 space-y-4">
            {kpisDesempeno.map((k) => {
              const pct = Math.min(100, (k.actual / k.meta) * 100);
              return (
                <div key={k.kpi}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-ink-2">{k.kpi}</span>
                    <span className="font-mono text-sm font-bold tabular">
                      {k.actual}
                      <span className="text-ink-3">{k.unidad}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn("h-full rounded-full", k.tone === "good" ? "bg-good" : k.tone === "warn" ? "bg-warn" : "bg-brand")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-ink-3">meta: {k.meta}{k.unidad}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Equipo */}
        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b border-border-faint p-5">
            <h3 className="font-display text-lg font-bold">Desempeño por colaborador</h3>
            <p className="text-sm text-ink-3">Evaluación con competencias y KPIs</p>
          </div>
          <div className="divide-y divide-border-faint">
            {equipoDesempeno.map((e) => {
              const Icon = tendIcon[e.tendencia as keyof typeof tendIcon];
              return (
                <div key={e.nombre} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface-2/50">
                  <Avatar name={e.nombre} tone={e.tono} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{e.nombre}</p>
                    <p className="truncate text-xs text-ink-3">{e.puesto}</p>
                  </div>
                  <Icon className={cn("h-4 w-4", tendColor[e.tendencia as keyof typeof tendColor])} />
                  <div className="w-28">
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="text-ink-3">score</span>
                      <span className="font-mono font-bold tabular">{e.score}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className={cn("h-full rounded-full", e.score >= 80 ? "bg-good" : e.score >= 65 ? "bg-warn" : "bg-bad")} style={{ width: `${e.score}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Brechas + recomendaciones */}
        <Card className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-human/10 blur-2xl" />
          <div className="relative">
            <Eyebrow>
              <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Brechas detectadas</span>
            </Eyebrow>
            <div className="mt-4 space-y-3">
              {brechas.map((b) => (
                <div key={b.competencia} className="rounded-xl border border-border-soft bg-surface p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{b.competencia}</span>
                    <Badge tone="warn">−{b.brecha} pts</Badge>
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 text-[13px] text-ink-2">
                    <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" /> {b.accion}
                  </p>
                </div>
              ))}
            </div>
            <Button href="/dashboard/capacitacion" variant="secondary" size="sm" className="mt-4 w-full">
              Asignar capacitación <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
