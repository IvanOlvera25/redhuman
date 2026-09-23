"use client";

/* Piezas compartidas por los módulos de Desempeño, Clima y Base de Conocimiento (2026-09-23).
   Mismo lenguaje visual del resto del dashboard: modales a pantalla completa en móvil, campos de 44 px,
   tablas limpias y avisos en línea. */

import { Loader2, Plus, X } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";

export const inputRH = "h-11 w-full rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

export type AvisoRH = { tono: "ok" | "error" | "warn"; texto: string } | null;

export function AvisoLinea({ aviso, onCerrar }: { aviso: NonNullable<AvisoRH>; onCerrar: () => void }) {
  return (
    <div
      role="alert"
      className={cn(
        "mt-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
        aviso.tono === "ok"
          ? "border-good/30 bg-good-soft/40 text-good"
          : aviso.tono === "warn"
            ? "border-warn/30 bg-warn-soft/40 text-warn"
            : "border-bad/30 bg-bad-soft/40 text-bad",
      )}
    >
      <span>{aviso.texto}</span>
      <button onClick={onCerrar} aria-label="Cerrar"><X className="h-4 w-4" /></button>
    </div>
  );
}

export function ModalMarco({ titulo, subtitulo, onClose, children, ancho = "max-w-2xl" }: {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <Card
        className={cn("flex h-[100dvh] w-full flex-col overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:p-6", ancho)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">{titulo}</h2>
            {subtitulo && <p className="mt-1 text-sm text-ink-2">{subtitulo}</p>}
          </div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 transition hover:bg-surface-2" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </Card>
    </div>
  );
}

export function CampoRH({ label, children, ayuda }: { label: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {ayuda && <span className="text-[11px] text-ink-3">{ayuda}</span>}
    </label>
  );
}

export function KpiRH({ etiqueta, valor, pie, icono }: { etiqueta: string; valor: string; pie?: string; icono?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-2">{etiqueta}</p>
        {icono && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icono}</span>}
      </div>
      <p className="font-display mt-1.5 text-3xl font-extrabold tabular">{valor}</p>
      {pie && <p className="mt-0.5 text-[11px] text-ink-3">{pie}</p>}
    </Card>
  );
}

/** Lista de filas editables (objetivos, KPIs, brechas, preguntas…) con «Agregar» y quitar por fila. */
export function ListaEditable<T>({ titulo, filas, onCambio, nuevo, render, vacio }: {
  titulo: string;
  filas: T[];
  onCambio: (f: T[]) => void;
  nuevo: () => T;
  render: (fila: T, set: (f: T) => void, indice: number) => React.ReactNode;
  vacio?: string;
}) {
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <Eyebrow>{titulo}</Eyebrow>
        <button onClick={() => onCambio([...filas, nuevo()])} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </div>
      {filas.length === 0 && vacio && <p className="mt-2 text-xs text-ink-3">{vacio}</p>}
      <div className="mt-2 flex flex-col gap-2">
        {filas.map((f, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-6">
            {render(f, (nueva) => onCambio(filas.map((x, k) => (k === i ? nueva : x))), i)}
            <button
              onClick={() => onCambio(filas.filter((_, k) => k !== i))}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border-soft text-ink-3 transition hover:border-bad/40 hover:text-bad"
              aria-label="Quitar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="grid place-items-center gap-2 py-12 text-ink-3">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-xs">{texto}</p>
    </div>
  );
}
