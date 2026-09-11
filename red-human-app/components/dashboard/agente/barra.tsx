"use client";

import { Sparkles } from "lucide-react";
import { useAgente } from "./proveedor";

/** Barra permanente "✨ Pregunta a Red Human…" (punto 29) — vive en el topbar del dashboard,
 * visible desde cualquier pantalla. Al hacer clic abre el panel lateral; NO es un módulo de
 * chat aparte, solo un botón con pinta de barra de búsqueda. */
export function BarraAgente() {
  const { abrir } = useAgente();
  return (
    <>
      {/* Pantallas sm+: barra completa, donde antes vivía el buscador decorativo. */}
      <button
        onClick={abrir}
        className="relative hidden h-10 max-w-md flex-1 items-center gap-2.5 rounded-xl border border-border-soft bg-surface-2 px-3.5 text-left text-sm text-ink-3 outline-none transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand focus:border-brand sm:flex"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-brand" />
        <span className="truncate">Pregunta a Red Human…</span>
      </button>
      {/* Móvil: la barra permanente sigue disponible como icono, nunca desaparece del todo. */}
      <button
        onClick={abrir}
        aria-label="Pregunta a Red Human"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2 sm:hidden"
      >
        <Sparkles className="h-5 w-5 text-brand" />
      </button>
    </>
  );
}
