"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, Building2, Briefcase, Filter, X, Sparkles, ArrowRight, Search } from "lucide-react";
import { Logo, Card, Badge, Button } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { fetchVacantesPublicas } from "@/lib/api";
import type { Vacante } from "@/lib/data";
import { cn } from "@/lib/utils";

const MODALIDADES: Vacante["modalidad"][] = ["Presencial", "Híbrido", "Remoto"];

export default function Portal() {
  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ubicacion, setUbicacion] = useState("");
  const [modalidades, setModalidades] = useState<string[]>([]);

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

  const filtradas = useMemo(
    () =>
      vacantes.filter((v) => {
        if (ubicacion && v.ubicacion !== ubicacion) return false;
        if (modalidades.length && !modalidades.includes(v.modalidad)) return false;
        return true;
      }),
    [vacantes, ubicacion, modalidades],
  );

  function toggleModalidad(m: string) {
    setModalidades((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  }

  function limpiar() {
    setUbicacion("");
    setModalidades([]);
  }

  const hayFiltros = Boolean(ubicacion) || modalidades.length > 0;

  return (
    <main className="min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:py-12">
        <Badge tone="brand" dot>
          <Sparkles className="h-3 w-3" /> Bolsa de trabajo
        </Badge>
        <h1 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Vacantes abiertas</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-2">
          Postúlate en unos minutos: revisamos tu información con ayuda de un asistente de IA y el equipo de RH
          te contacta directamente por WhatsApp.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[240px_1fr]">
          {/* Sidebar de filtros */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Filter className="h-4 w-4 text-ink-3" /> Filtros
                </span>
                {hayFiltros && (
                  <button onClick={limpiar} className="flex items-center gap-1 text-xs text-ink-3 hover:text-brand">
                    <X className="h-3 w-3" /> Limpiar
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Ubicación</span>
                <select
                  value={ubicacion}
                  onChange={(e) => setUbicacion(e.target.value)}
                  className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Todas</option>
                  {ubicaciones.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Modalidad</span>
                <div className="flex flex-col gap-1.5">
                  {MODALIDADES.map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        checked={modalidades.includes(m)}
                        onChange={() => toggleModalidad(m)}
                        className="h-4 w-4 rounded border-border-soft accent-[var(--brand)]"
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
            </Card>

            <Badge tone="neutral">
              {filtradas.length} vacante{filtradas.length !== 1 ? "s" : ""}
            </Badge>
          </aside>

          {/* Grid central de vacantes */}
          <div>
            {cargando ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-44 animate-pulse rounded-2xl border border-border-soft bg-surface-2/60" />
                ))}
              </div>
            ) : filtradas.length === 0 ? (
              <Card className="flex flex-col items-center gap-2 p-12 text-center">
                <Search className="h-8 w-8 text-ink-3" />
                <p className="text-sm font-medium text-ink-2">No hay vacantes con estos filtros.</p>
                {hayFiltros && (
                  <Button variant="outline" size="sm" onClick={limpiar}>
                    Quitar filtros
                  </Button>
                )}
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
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
    <Card hover className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] text-ink-3">{v.area || "General"}</p>
          <h3 className="font-display mt-0.5 truncate text-lg font-bold text-ink">{v.titulo}</h3>
        </div>
        {v.sueldo && (
          <span className="shrink-0 rounded-lg bg-brand-soft px-2.5 py-1 font-mono text-xs font-semibold text-brand">
            {v.sueldo}
          </span>
        )}
      </div>

      {v.resumen && <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-2">{v.resumen}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-ink-3" /> {v.empresa}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-ink-3" /> {v.ubicacion || "México"}
        </span>
        <Badge tone="neutral">
          <Briefcase className="h-3 w-3" /> {v.modalidad}
        </Badge>
      </div>

      {/* Postularme NO va a WhatsApp: enlaza a la misma ruta interna que "Copiar liga" en el panel. */}
      <Button href={`/aplicar/${v.slug}`} size="sm" className="mt-1 w-full">
        Postularme <ArrowRight className="h-4 w-4" />
      </Button>
    </Card>
  );
}
