"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapPin,
  Building2,
  Briefcase,
  Banknote,
  Filter,
  X,
  Sparkles,
  ArrowRight,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Logo, Card, Badge, Button, Eyebrow } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { fetchVacantesPublicas } from "@/lib/api";
import type { Vacante } from "@/lib/data";
import { cn } from "@/lib/utils";

const MODALIDADES: Vacante["modalidad"][] = ["Presencial", "Híbrido", "Remoto"];

const formatoMXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/** Saca el número más alto que aparezca en un texto de sueldo libre (p. ej. "$9,500 – 11,000" -> 11500).
 *  null cuando no hay ningún número (p. ej. "A convenir") — esas vacantes nunca se descartan por sueldo,
 *  porque no hay forma de saber si cumplen el filtro o no. */
function sueldoMaximo(sueldo?: string): number | null {
  if (!sueldo) return null;
  const numeros = (sueldo.match(/[\d,]+/g) ?? [])
    .map((n) => parseInt(n.replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return numeros.length ? Math.max(...numeros) : null;
}

export default function Portal() {
  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ubicacion, setUbicacion] = useState("");
  const [area, setArea] = useState("");
  const [modalidades, setModalidades] = useState<string[]>([]);
  const [sueldoMin, setSueldoMin] = useState(0);

  useEffect(() => {
    fetchVacantesPublicas().then((v) => {
      setVacantes(v ?? []);
      setCargando(false);
    });
  }, []);

  const ubicaciones = useMemo(
    () => Array.from(new Set(vacantes.map((v) => v.ubicacion).filter(Boolean))).sort(),
    [vacantes],
  );

  const areas = useMemo(
    () => Array.from(new Set(vacantes.map((v) => v.area).filter(Boolean))).sort(),
    [vacantes],
  );

  /** Techo del slider: el sueldo más alto entre las vacantes activas, redondeado a $5,000 (mínimo $60,000). */
  const sueldoTope = useMemo(() => {
    const valores = vacantes.map((v) => sueldoMaximo(v.sueldo)).filter((n): n is number => n !== null);
    if (!valores.length) return 60000;
    return Math.max(60000, Math.ceil(Math.max(...valores) / 5000) * 5000);
  }, [vacantes]);

  const filtradas = useMemo(
    () =>
      vacantes.filter((v) => {
        if (ubicacion && v.ubicacion !== ubicacion) return false;
        if (area && v.area !== area) return false;
        if (modalidades.length && !modalidades.includes(v.modalidad)) return false;
        if (sueldoMin > 0) {
          const max = sueldoMaximo(v.sueldo);
          if (max !== null && max < sueldoMin) return false;
        }
        return true;
      }),
    [vacantes, ubicacion, area, modalidades, sueldoMin],
  );

  function toggleModalidad(m: string) {
    setModalidades((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  }

  function limpiar() {
    setUbicacion("");
    setArea("");
    setModalidades([]);
    setSueldoMin(0);
  }

  const hayFiltros = Boolean(ubicacion) || Boolean(area) || modalidades.length > 0 || sueldoMin > 0;

  return (
    <main className="min-h-svh bg-bg">
      <header className="glass sticky top-0 z-30 border-b border-border-soft">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden border-b border-border-soft">
        <div className="grid-bg pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(ellipse_60%_55%_at_50%_0%,rgba(238,68,68,0.12),transparent_70%)]" />

        <div className="relative mx-auto max-w-4xl px-5 py-16 text-center sm:py-24">
          <Badge tone="brand" dot className="mx-auto">
            <Sparkles className="h-3 w-3" /> Bolsa de trabajo · Red Human AI
          </Badge>

          <h1 className="font-display mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Encuentra tu <span className="brand-gradient-text">próxima oportunidad</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-2 sm:text-lg">
            Postúlate en minutos: un asistente de IA revisa tu perfil y el equipo de Recursos Humanos
            te contacta directo por WhatsApp — sin filas, sin esperas.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs sm:text-sm">
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <Briefcase className="h-4 w-4 text-brand" />
              <b className="text-ink">{vacantes.length}</b> vacante{vacantes.length !== 1 ? "s" : ""} abierta
              {vacantes.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <Zap className="h-4 w-4 text-brand" /> Respuesta en menos de 24 h
            </span>
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <ShieldCheck className="h-4 w-4 text-good" /> Datos protegidos (LFPDPPP)
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* Sidebar de filtros */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <Card className="border-border-soft p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Filter className="h-4 w-4 text-brand" /> Filtros
                </span>
                {hayFiltros && (
                  <button
                    onClick={limpiar}
                    className="flex items-center gap-1 text-xs font-medium text-ink-3 transition hover:text-brand"
                  >
                    <X className="h-3 w-3" /> Limpiar
                  </button>
                )}
              </div>

              <div className="mt-5 flex flex-col gap-1.5">
                <Eyebrow className="text-[10px] text-ink-3">Ubicación</Eyebrow>
                <select
                  value={ubicacion}
                  onChange={(e) => setUbicacion(e.target.value)}
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Todas</option>
                  {ubicaciones.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5 flex flex-col gap-1.5">
                <Eyebrow className="text-[10px] text-ink-3">Área / Departamento</Eyebrow>
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Todas</option>
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <Eyebrow className="text-[10px] text-ink-3">Modalidad</Eyebrow>
                <div className="flex flex-col gap-1.5">
                  {MODALIDADES.map((m) => {
                    const activa = modalidades.includes(m);
                    return (
                      <button
                        key={m}
                        onClick={() => toggleModalidad(m)}
                        className={cn(
                          "flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition",
                          activa
                            ? "border-brand/40 bg-brand-soft text-brand"
                            : "border-border-soft bg-surface text-ink-2 hover:border-brand/30 hover:bg-surface-2",
                        )}
                      >
                        {m}
                        <span
                          className={cn(
                            "h-4 w-4 shrink-0 rounded-md border transition",
                            activa ? "border-brand bg-brand" : "border-border-soft",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Eyebrow className="text-[10px] text-ink-3">Sueldo mínimo</Eyebrow>
                  <span className="font-mono text-xs font-semibold text-brand">
                    {sueldoMin > 0 ? formatoMXN.format(sueldoMin) : "Cualquiera"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={sueldoTope}
                  step={1000}
                  value={sueldoMin}
                  onChange={(e) => setSueldoMin(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--brand)]"
                />
                <div className="flex items-center justify-between font-mono text-[10px] text-ink-3">
                  <span>$0</span>
                  <span>{formatoMXN.format(sueldoTope)}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-3">
                  Referencial: incluye vacantes con sueldo “A convenir”.
                </p>
              </div>
            </Card>

            <Badge tone="neutral" className="mx-auto sm:mx-0">
              {filtradas.length} vacante{filtradas.length !== 1 ? "s" : ""} encontrada
              {filtradas.length !== 1 ? "s" : ""}
            </Badge>
          </aside>

          {/* Grid central de vacantes */}
          <div>
            {cargando ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="shimmer h-52 rounded-2xl border border-border-soft bg-surface-2/60"
                  />
                ))}
              </div>
            ) : filtradas.length === 0 ? (
              <Card className="flex flex-col items-center gap-3 p-16 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-ink-3">
                  <Search className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">No hay vacantes con estos filtros.</p>
                  <p className="mt-1 text-xs text-ink-3">Prueba quitando alguno de los filtros aplicados.</p>
                </div>
                {hayFiltros && (
                  <Button variant="outline" size="sm" onClick={limpiar}>
                    Quitar filtros
                  </Button>
                )}
              </Card>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {filtradas.map((v) => (
                  <VacanteCard key={v.id} v={v} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function VacanteCard({ v }: { v: Vacante }) {
  return (
    <Card
      className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border-soft p-5 shadow-md transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-xl"
    >
      {/* halo de marca en la esquina, sutil, solo visible en hover */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-brand">
            {v.area || "General"}
          </p>
          <h3 className="font-display mt-1 truncate text-lg font-bold text-ink">{v.titulo}</h3>
        </div>
      </div>

      {v.resumen && <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-2">{v.resumen}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">
          <Building2 className="h-3 w-3" /> {v.empresa}
        </Badge>
        <Badge tone="neutral">
          <MapPin className="h-3 w-3" /> {v.ubicacion || "México"}
        </Badge>
        <Badge tone="brand">
          <Briefcase className="h-3 w-3" /> {v.modalidad}
        </Badge>
        {v.sueldo && (
          <Badge tone="good">
            <Banknote className="h-3 w-3" /> {v.sueldo}
          </Badge>
        )}
      </div>

      {/* Postularme NO va a WhatsApp: enlaza a la misma ruta interna que "Copiar liga" en el panel. */}
      <Button
        href={`/aplicar/${v.slug}`}
        className="mt-1 w-full transition-transform duration-300 group-hover:scale-[1.02]"
      >
        Postularme <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
      </Button>
    </Card>
  );
}
