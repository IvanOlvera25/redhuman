import { AlertTriangle, ShieldCheck, ArrowUpRight, Bell } from "lucide-react";
import { Card, Badge, Button, Avatar, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Gauge, ClimaTrend } from "@/components/dashboard/charts";
import {
  climaScore,
  climaTrend,
  climaDimensiones,
  climaSenales,
  climaKpis,
  type NivelSenal,
} from "@/lib/phase2";
import { cn } from "@/lib/utils";

const nivelConfig: Record<NivelSenal, { tone: "bad" | "warn" | "neutral"; label: string }> = {
  alto: { tone: "bad", label: "Riesgo alto" },
  medio: { tone: "warn", label: "Riesgo medio" },
  bajo: { tone: "neutral", label: "Riesgo bajo" },
};

export default function Clima() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Clima y experiencia" subtitle="El agente escucha señales tempranas de desmotivación o intención de salida.">
        <Badge tone="brand" dot>Pulsos activos</Badge>
      </PageHeader>

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {climaKpis.map((k) => (
          <Card key={k.label} className="p-5">
            <p className="text-sm text-ink-2">{k.label}</p>
            <p className="font-display mt-1.5 text-3xl font-extrabold tabular">{k.value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Gauge */}
        <Card className="flex flex-col items-center justify-center p-5">
          <h3 className="font-display self-start text-lg font-bold">Índice de clima</h3>
          <div className="my-4">
            <Gauge value={climaScore} size={200} />
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-1 text-xs font-semibold text-good">
            <ArrowUpRight className="h-3.5 w-3.5" /> +2 pts vs. mes anterior
          </span>
        </Card>

        {/* Tendencia */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-display text-lg font-bold">Tendencia del clima</h3>
          <p className="text-sm text-ink-3">Últimos 6 meses</p>
          <div className="mt-4">
            <ClimaTrend data={climaTrend} />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Dimensiones */}
        <Card className="p-5">
          <h3 className="font-display text-lg font-bold">Dimensiones</h3>
          <p className="text-sm text-ink-3">Percepción del colaborador</p>
          <div className="mt-5 space-y-3.5">
            {climaDimensiones.map((d) => (
              <div key={d.dim}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-2">{d.dim}</span>
                  <span className="font-mono font-semibold tabular">{d.valor}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn("h-full rounded-full", d.valor >= 75 ? "bg-good" : d.valor >= 68 ? "bg-brand" : "bg-warn")}
                    style={{ width: `${d.valor}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Señales */}
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border-faint p-5">
            <div>
              <h3 className="font-display text-lg font-bold">Señales tempranas</h3>
              <p className="text-sm text-ink-3">Detectadas por el agente en conversaciones</p>
            </div>
            <Badge tone="warn" dot>
              <Bell className="h-3 w-3" /> {climaSenales.length} activas
            </Badge>
          </div>

          <div className="divide-y divide-border-faint">
            {climaSenales.map((s) => {
              const c = nivelConfig[s.nivel];
              return (
                <div key={s.id} className="flex items-start gap-4 px-5 py-4 transition hover:bg-surface-2/50">
                  <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl", s.nivel === "alto" ? "bg-bad-soft text-bad" : s.nivel === "medio" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-3")}>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{s.colaborador}</span>
                      <span className="text-xs text-ink-3">· {s.puesto}</span>
                      <Badge tone={c.tone}>{c.label}</Badge>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{s.senal}</p>
                    <p className="mt-1 font-mono text-[10px] text-ink-3">{s.detectado}</p>
                  </div>
                  <Button size="sm" variant="outline" className="hidden shrink-0 sm:inline-flex">Intervenir</Button>
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2.5 border-t border-border-faint bg-human-soft/40 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-human" />
            <p className="text-[13px] leading-relaxed text-ink-2">
              <b className="text-ink">RH decide la intervención.</b> El agente detecta y alerta; la acción con la
              persona la define y ejecuta RH. Datos tratados conforme a la LFPDPPP.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
