"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--ink)",
  boxShadow: "0 8px 30px -12px rgba(0,0,0,.25)",
  padding: "8px 12px",
};

export function Sparkline({ data, color = "var(--brand)" }: { data: number[]; color?: string }) {
  const d = data.map((v, i) => ({ i, v }));
  const id = `spark-${Math.abs(data.reduce((a, b) => a + b, 0))}-${color.length}`;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={d} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ActividadChart({ data }: { data: { dia: string; candidatos: number; entrevistas: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--human)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--human)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="dia" stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={40} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} />
        <Area type="monotone" dataKey="candidatos" name="Candidatos" stroke="var(--brand)" strokeWidth={2.5} fill="url(#gC)" />
        <Area type="monotone" dataKey="entrevistas" name="Entrevistas" stroke="var(--human)" strokeWidth={2.5} fill="url(#gE)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function FuentesDonut({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={3} stroke="none">
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-display text-xl font-bold tabular">{total.toLocaleString("es-MX")}</div>
            <div className="text-[10px] text-ink-3">candidatos</div>
          </div>
        </div>
      </div>
      <ul className="flex-1 space-y-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="flex-1 text-ink-2">{d.name}</span>
            <span className="font-mono text-xs font-semibold text-ink tabular">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TiempoChart({ data }: { data: { mes: string; dias: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -22 }}>
        <XAxis dataKey="mes" stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={36} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} formatter={(v) => [`${v} días`, "Tiempo"]} />
        <Line type="monotone" dataKey="dias" stroke="var(--brand)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--brand)" }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MiniBar({ data }: { data: { dia: string; entrevistas: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="entrevistas" radius={[4, 4, 0, 0]} fill="var(--human)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CompetenciasRadar({
  data,
}: {
  data: { competencia: string; valor: number; meta: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="competencia" tick={{ fill: "var(--ink-3)", fontSize: 11 }} />
        <Radar name="Meta" dataKey="meta" stroke="var(--human)" fill="var(--human)" fillOpacity={0.08} strokeDasharray="4 4" />
        <Radar name="Actual" dataKey="valor" stroke="var(--brand)" fill="var(--brand)" fillOpacity={0.28} strokeWidth={2} />
        <Tooltip contentStyle={tooltipStyle} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ClimaTrend({ data }: { data: { mes: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -22 }}>
        <defs>
          <linearGradient id="gClima" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--good)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--good)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="mes" stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={34} domain={[50, 100]} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} formatter={(v) => [`${v} pts`, "Clima"]} />
        <Area type="monotone" dataKey="score" stroke="var(--good)" strokeWidth={2.5} fill="url(#gClima)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Gauge({ value, size = 160 }: { value: number; size?: number }) {
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const circ = Math.PI * r; // semicircle length
  const off = circ - (value / 100) * circ;
  const tone = value >= 75 ? "var(--good)" : value >= 60 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="relative" style={{ width: size, height: size / 2 + 20 }}>
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        <path
          d={`M 12 ${cy} A ${r} ${r} 0 0 1 ${size - 12} ${cy}`}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d={`M 12 ${cy} A ${r} ${r} 0 0 1 ${size - 12} ${cy}`}
          fill="none"
          stroke={tone}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="font-display text-4xl font-extrabold tabular" style={{ color: tone }}>{value}</div>
        <div className="text-[11px] text-ink-3">índice de clima</div>
      </div>
    </div>
  );
}
