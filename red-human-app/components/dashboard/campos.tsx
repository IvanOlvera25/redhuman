"use client";

/* Primitivos de formulario compartidos por Vacantes y Configuración (Puntos 9-13).
   Antes vivían duplicados dentro de vacantes/page.tsx; el formulario único de
   vacante/plantilla (formulario-contenido.tsx) y las fichas de Configuración los reutilizan. */

import * as React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  full,
  type = "text",
  ayuda,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
  type?: string;
  ayuda?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {ayuda && <span className="text-xs leading-relaxed text-ink-3">{ayuda}</span>}
    </label>
  );
}

export function Selector({
  label,
  value,
  onChange,
  opciones,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opciones: string[] | { valor: string; texto: string }[];
}) {
  const ops = opciones.map((o) => (typeof o === "string" ? { valor: o, texto: o } : o));
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      >
        {ops.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToggleSiNo({
  label,
  ayuda,
  valor,
  onChange,
}: {
  label: string;
  ayuda?: string;
  valor: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="mt-1.5 flex gap-2">
        {[
          { texto: "Sí", val: true },
          { texto: "No", val: false },
        ].map((o) => (
          <button
            key={o.texto}
            type="button"
            onClick={() => onChange(o.val)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-[13px] font-medium transition",
              valor === o.val ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/40",
            )}
          >
            {o.texto}
          </button>
        ))}
      </div>
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}

export function Area({
  label,
  value,
  onChange,
  rows = 3,
  ayuda,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  ayuda?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-2">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}

/** Lista de renglones de texto (responsabilidades, beneficios, requisitos deseables…). */
export function ListaEditable({
  label,
  items,
  onChange,
  placeholder,
  ayuda,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  ayuda?: string;
}) {
  const [nuevo, setNuevo] = React.useState("");
  const agregar = () => {
    const t = nuevo.trim();
    if (!t) return;
    onChange([...items, t]);
    setNuevo("");
  };
  return (
    <div>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <input
              value={it}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              className="h-10 flex-1 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="button"
              aria-label="Quitar"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="mt-2 text-ink-3 hover:text-bad"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex gap-2">
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregar();
            }
          }}
          placeholder={placeholder ?? "Escribe y presiona Enter"}
          className="h-10 flex-1 rounded-xl border border-dashed border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button type="button" variant="outline" size="sm" onClick={agregar}>
          <Plus className="h-3.5 w-3.5" /> Agregar
        </Button>
      </div>
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}

/** Modal centrado genérico (fichas y formularios de Configuración). */
export function Modal({
  titulo,
  subtitulo,
  onClose,
  children,
  ancho = "max-w-2xl",
  pie,
}: {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: React.ReactNode;
  ancho?: string;
  pie?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <Card className={cn("flex max-h-[92vh] w-full flex-col overflow-hidden p-0", ancho)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-soft px-6 py-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold text-ink">{titulo}</h3>
            {subtitulo && <p className="mt-0.5 text-[13px] text-ink-2">{subtitulo}</p>}
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-lg p-1 text-ink-3 hover:bg-surface hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {pie && <div className="flex flex-wrap justify-end gap-3 border-t border-border-soft px-6 py-4">{pie}</div>}
      </Card>
    </div>
  );
}

export function BotonEliminar({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title ?? "Eliminar"} className="rounded-lg p-1.5 text-ink-3 transition hover:bg-bad/10 hover:text-bad">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
