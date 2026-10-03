"use client";

/* Plazo relativo a la fecha de ingreso (Fraiche, cambios integrados 2026-10-02 §14): en vez de números negativos,
   «Antes del ingreso / Día de ingreso / Después del ingreso» con una cantidad POSITIVA de días y la fecha calculada a
   la vista. Por dentro se sigue guardando un entero (negativo = antes), así la API y los recordatorios no cambian. */

import { cn } from "@/lib/utils";

type Momento = "antes" | "dia" | "despues";

function momentoDe(dias: number): Momento {
  return dias < 0 ? "antes" : dias > 0 ? "despues" : "dia";
}

/** «3 días antes del ingreso» / «Día de ingreso» / «2 días después del ingreso». */
export function textoPlazo(dias: number | null | undefined): string {
  const d = Number(dias ?? 0);
  if (d === 0) return "Día de ingreso";
  const n = Math.abs(d);
  return `${n} día${n === 1 ? "" : "s"} ${d < 0 ? "antes" : "después"} del ingreso`;
}

/** Fecha calculada (dd/mm/aaaa) a partir de la fecha de ingreso (ISO) y el plazo. */
export function fechaDePlazo(fechaIngreso: string | null | undefined, dias: number | null | undefined): string {
  if (!fechaIngreso) return "";
  const base = new Date(`${fechaIngreso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + Number(dias ?? 0));
  return base.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function CampoPlazo({
  dias,
  onChange,
  fechaIngreso,
  className,
  compacto = false,
}: {
  dias: number;
  onChange: (dias: number) => void;
  /** Con fecha de ingreso se muestra la fecha calculada. */
  fechaIngreso?: string | null;
  className?: string;
  compacto?: boolean;
}) {
  const momento = momentoDe(dias);
  const n = Math.abs(dias);
  const fijar = (m: Momento, cantidad: number) => {
    const c = Math.max(0, Math.round(cantidad || 0));
    onChange(m === "dia" ? 0 : m === "antes" ? -Math.max(1, c) : Math.max(1, c));
  };
  const fecha = fechaDePlazo(fechaIngreso, dias);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={momento}
          onChange={(e) => fijar(e.target.value as Momento, n || 1)}
          className="h-10 rounded-xl border border-border-soft bg-surface px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          aria-label="Momento respecto al ingreso"
        >
          <option value="antes">Antes del ingreso</option>
          <option value="dia">Día de ingreso</option>
          <option value="despues">Después del ingreso</option>
        </select>
        {momento !== "dia" && (
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={n || ""}
              onChange={(e) => fijar(momento, Number(e.target.value))}
              className="h-10 w-20 rounded-xl border border-border-soft bg-surface px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              aria-label="Días"
            />
            días
          </label>
        )}
      </div>
      {!compacto && <span className="text-[11px] text-ink-3">{fecha ? `Fecha: ${fecha}` : textoPlazo(dias)}</span>}
    </div>
  );
}
