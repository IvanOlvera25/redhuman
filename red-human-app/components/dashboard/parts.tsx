"use client";

import { ArrowUpRight } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { Sparkline } from "./charts";
import { cn } from "@/lib/utils";
import type { EstadoPrefiltro } from "@/lib/data";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2.5">{children}</div>}
    </div>
  );
}

const toneColor: Record<string, string> = {
  brand: "var(--brand)",
  good: "var(--good)",
  human: "var(--human)",
};

export function KpiCard({
  label,
  value,
  delta,
  tone = "brand",
  spark,
}: {
  label: string;
  value: string;
  delta: string;
  tone?: string;
  spark: number[];
}) {
  return (
    <Card hover className="overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-ink-2">{label}</p>
        <span className="inline-flex items-center gap-0.5 rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-semibold text-good">
          <ArrowUpRight className="h-3 w-3" /> {delta}
        </span>
      </div>
      <div className="mt-2 font-display text-3xl font-extrabold tracking-tight tabular">{value}</div>
      <div className="mt-3 -mx-1">
        <Sparkline data={spark} color={toneColor[tone] ?? "var(--brand)"} />
      </div>
    </Card>
  );
}

const estadoConfig: Record<EstadoPrefiltro, { tone: "good" | "warn" | "bad" | "neutral"; label: string }> = {
  cumple: { tone: "good", label: "Cumple" },
  revision: { tone: "warn", label: "Requiere revisión" },
  no_cumple: { tone: "bad", label: "No cumple" },
  pendiente: { tone: "neutral", label: "Pendiente" },
};

export function EstadoBadge({ estado }: { estado: EstadoPrefiltro }) {
  const c = estadoConfig[estado];
  return (
    <Badge tone={c.tone} dot>
      {c.label}
    </Badge>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const tone = score >= 80 ? "var(--good)" : score >= 60 ? "var(--warn)" : "var(--bad)";
  const r = 16;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  return (
    <div className="relative grid h-11 w-11 place-items-center">
      <svg className="h-11 w-11 -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="transition-all duration-700"
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-bold tabular" style={{ color: tone }}>
        {score}
      </span>
    </div>
  );
}
