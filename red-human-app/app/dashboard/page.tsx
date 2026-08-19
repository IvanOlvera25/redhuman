import Link from "next/link";
import { ArrowRight, Download, Sparkles, Clock } from "lucide-react";
import { Button, Card, Eyebrow, Avatar } from "@/components/ui";
import { PageHeader, KpiCard, EstadoBadge, ScoreRing } from "@/components/dashboard/parts";
import { ActividadChart, FuentesDonut, TiempoChart } from "@/components/dashboard/charts";
import { kpis, actividadData, fuentesData, tiempoContratacion, funnelData, candidatos } from "@/lib/data";

export default function Tablero() {
  const recientes = candidatos.slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Tablero de control" subtitle="Vista general de reclutamiento y operación · últimos 7 días">
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4" /> Exportar
        </Button>
        <Button href="/dashboard/vacantes" size="sm">
          Nueva vacante <ArrowRight className="h-4 w-4" />
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      {/* Charts grid */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-bold">Actividad</h3>
              <p className="text-sm text-ink-3">Candidatos y entrevistas por día</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" /> Candidatos</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-human" /> Entrevistas</span>
            </div>
          </div>
          <div className="mt-4">
            <ActividadChart data={actividadData} />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-display text-lg font-bold">Fuente de candidatos</h3>
          <p className="text-sm text-ink-3">De dónde llegan</p>
          <div className="mt-6">
            <FuentesDonut data={fuentesData} />
          </div>
        </Card>
      </div>

      {/* Funnel + tiempo + recientes */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Embudo */}
        <Card className="p-5">
          <h3 className="font-display text-lg font-bold">Embudo de selección</h3>
          <p className="text-sm text-ink-3">Conversión por etapa</p>
          <div className="mt-5 space-y-3">
            {funnelData.map((f) => (
              <div key={f.etapa}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-2">{f.etapa}</span>
                  <span className="font-mono font-semibold tabular">{f.valor.toLocaleString("es-MX")}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
                    style={{ width: `${f.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Tiempo de contratación */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-bold">Tiempo de contratación</h3>
              <p className="text-sm text-ink-3">Días promedio</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-1 text-xs font-semibold text-good">
              <Clock className="h-3.5 w-3.5" /> −12 días
            </span>
          </div>
          <div className="mt-4">
            <TiempoChart data={tiempoContratacion} />
          </div>
        </Card>

        {/* Insight IA */}
        <Card className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-brand/10 blur-2xl" />
          <div className="relative">
            <Eyebrow>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Insight del agente
              </span>
            </Eyebrow>
            <p className="mt-3 text-[15px] font-medium leading-relaxed">
              El <b>62%</b> de los candidatos de la vacante de <b>ventas telefónicas</b> llegan por
              WhatsApp y avanzan más rápido a entrevista. Sugerencia: aumentar el presupuesto de
              anuncios Click-to-WhatsApp esta semana.
            </p>
            <Button href="/dashboard/candidatos" variant="secondary" size="sm" className="mt-5">
              Ver candidatos <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Candidatos recientes */}
      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-border-faint p-5">
          <div>
            <h3 className="font-display text-lg font-bold">Candidatos recientes</h3>
            <p className="text-sm text-ink-3">Últimos prefiltrados por el agente</p>
          </div>
          <Link href="/dashboard/candidatos" className="text-sm font-medium text-brand hover:underline">
            Ver todos
          </Link>
        </div>
        <div className="divide-y divide-border-faint">
          {recientes.map((c, i) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface-2/50">
              <ScoreRing score={c.score} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.nombre}</p>
                <p className="truncate text-xs text-ink-3">{c.puesto} · {c.ubicacion}</p>
              </div>
              <span className="hidden font-mono text-[11px] text-ink-3 sm:block">{c.fuente}</span>
              <EstadoBadge estado={c.estado} />
              <span className="hidden w-16 text-right font-mono text-[11px] text-ink-3 md:block">{c.aplicado}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
