"use client";

/* Menú de tres puntos «…» para acciones SECUNDARIAS (regla de UI 2026-09-16: una sola acción principal
   visible por contexto; el resto vive aquí). Se cierra al hacer clic fuera, con Escape, al hacer scroll
   o al cambiar el tamaño de la ventana.

   2026-09-17: el menú se pinta en un React Portal sobre <body> con posición FIJA calculada a partir del
   botón. Antes era `absolute` dentro del contenedor y cualquier `overflow-hidden` de un modal/tarjeta
   (la ficha del candidato, las tarjetas del Kanban) lo recortaba o lo escondía por completo según la
   etapa. Abre hacia abajo si cabe; si no, hacia arriba; nunca se sale de la ventana. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const ANCHO_MIN = 200;
const MARGEN = 8;

export function MenuAcciones({ acciones, etiqueta = "Más acciones", className }: { acciones: AccionMenu[]; etiqueta?: string; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; arriba: boolean } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Calcula dónde va el menú respecto al botón, dentro de la ventana. */
  const posicionar = () => {
    const b = botonRef.current?.getBoundingClientRect();
    if (!b) return;
    const altoMenu = menuRef.current?.offsetHeight ?? Math.min(44 * acciones.length + 8, 360);
    const anchoMenu = Math.max(menuRef.current?.offsetWidth ?? ANCHO_MIN, ANCHO_MIN);
    const espacioAbajo = window.innerHeight - b.bottom - MARGEN;
    const arriba = espacioAbajo < altoMenu && b.top - MARGEN > altoMenu;
    const top = arriba ? b.top - altoMenu - 4 : b.bottom + 4;
    let left = b.right - anchoMenu; // alineado a la derecha del botón
    left = Math.max(MARGEN, Math.min(left, window.innerWidth - anchoMenu - MARGEN));
    setPos({ top: Math.max(MARGEN, top), left, arriba });
  };

  useLayoutEffect(() => {
    if (abierto) posicionar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, acciones.length]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || botonRef.current?.contains(t)) return;
      setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    const cerrar = () => setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", cerrar);
    // scroll en cualquier contenedor (captura): el menú es fijo, así que se cierra en vez de quedar flotando
    document.addEventListener("scroll", cerrar, true);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", cerrar);
      document.removeEventListener("scroll", cerrar, true);
    };
  }, [abierto]);

  if (acciones.length === 0) return null;

  const menu = abierto && typeof document !== "undefined" && (
    <div
      ref={menuRef}
      role="menu"
      aria-label={etiqueta}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: ANCHO_MIN, zIndex: 1000 }}
      className={cn(
        "overflow-hidden rounded-xl border border-border-soft bg-bg py-1 shadow-2xl",
        pos ? "animate-in fade-in duration-100" : "invisible",
        pos?.arriba ? "origin-bottom-right" : "origin-top-right",
      )}
      onClick={(e) => e.stopPropagation()}
    >
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
            "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
            a.peligrosa ? "text-bad hover:bg-bad-soft" : "text-ink hover:bg-surface-2",
          )}
        >
          {a.icono && <span className="grid h-4 w-4 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">{a.icono}</span>}
          {a.etiqueta}
        </button>
      ))}
    </div>
  );

  return (
    <div className={cn("relative shrink-0", className)} onClick={(e) => e.stopPropagation()}>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-ink",
          abierto && "bg-surface-2 text-ink",
        )}
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        title={etiqueta}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
