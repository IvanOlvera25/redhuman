"use client";

/* Menú de tres puntos «…» para acciones SECUNDARIAS (regla de UI 2026-09-16: una sola acción principal
   visible por contexto; el resto vive aquí). Se cierra al hacer clic fuera o con Escape. */

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AccionMenu {
  etiqueta: string;
  onClick: () => void;
  icono?: React.ReactNode;
  /** Acción destructiva: se pinta en rojo. */
  peligrosa?: boolean;
  disabled?: boolean;
  title?: string;
}

export function MenuAcciones({ acciones, etiqueta = "Más acciones", className }: { acciones: AccionMenu[]; etiqueta?: string; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  if (acciones.length === 0) return null;

  return (
    <div ref={ref} className={cn("relative shrink-0", className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-ink"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        title={etiqueta}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {abierto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-border-soft bg-bg py-1 shadow-xl">
          {acciones.map((a) => (
            <button
              key={a.etiqueta}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              title={a.title}
              onClick={() => {
                setAbierto(false);
                a.onClick();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
                a.peligrosa ? "text-bad hover:bg-bad-soft" : "text-ink hover:bg-surface-2",
              )}
            >
              {a.icono && <span className="grid h-4 w-4 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">{a.icono}</span>}
              {a.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
