"use client";

/* Editor ÚNICO del cuestionario de clima (Clima v2, 2026-09-27): lo usan el Borrador de una encuesta y
   Configuración → Plantillas de clima (mismo patrón que el formulario compartido de vacantes).
   Dimensiones con nombre y orden; preguntas con texto, tipo (escala 1-5 | opción múltiple | abierta),
   dimensión y orden (flechas ↑ ↓). El orden visual es el que se guarda (`orden` = posición). */

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { inputRH } from "@/components/dashboard/modulos-rh";
import { cn } from "@/lib/utils";
import type { PreguntaClima, TipoPreguntaClima } from "@/lib/api";

export const TIPOS_CLIMA: { valor: TipoPreguntaClima; texto: string }[] = [
  { valor: "escala", texto: "Escala 1-5" },
  { valor: "opcion", texto: "Opción múltiple" },
  { valor: "abierta", texto: "Abierta" },
];

const nuevoId = () => `p${Math.random().toString(36).slice(2, 8)}`;

/** Deja `orden` = posición y quita preguntas vacías (lo que se manda al guardar). */
export function cuestionarioParaGuardar(preguntas: PreguntaClima[]): PreguntaClima[] {
  return preguntas
    .filter((p) => p.texto.trim())
    .map((p, i) => ({
      ...p,
      texto: p.texto.trim(),
      orden: i + 1,
      opciones: p.tipo === "opcion" ? (p.opciones ?? []).map((o) => o.trim()).filter(Boolean) : undefined,
    }));
}

export function EditorCuestionario({
  dimensiones, preguntas, onCambio, soloLectura = false,
}: {
  dimensiones: string[];
  preguntas: PreguntaClima[];
  onCambio: (dimensiones: string[], preguntas: PreguntaClima[]) => void;
  soloLectura?: boolean;
}) {
  const [nuevaDim, setNuevaDim] = useState("");
  const dims = dimensiones.length ? dimensiones : ["General"];

  const setPreguntas = (ps: PreguntaClima[]) => onCambio(dims, ps);
  const cambiar = (i: number, p: PreguntaClima) => setPreguntas(preguntas.map((x, k) => (k === i ? p : x)));
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= preguntas.length) return;
    const copia = [...preguntas];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setPreguntas(copia);
  };

  function agregarDimension() {
    const n = nuevaDim.trim();
    if (!n || dims.some((d) => d.toLowerCase() === n.toLowerCase())) return;
    onCambio([...dims, n], preguntas);
    setNuevaDim("");
  }
  function renombrarDimension(vieja: string, nueva: string) {
    onCambio(dims.map((d) => (d === vieja ? nueva : d)), preguntas.map((p) => (p.dimension === vieja ? { ...p, dimension: nueva } : p)));
  }
  function quitarDimension(d: string) {
    if (dims.length <= 1) return;
    const destino = dims.find((x) => x !== d) as string;
    onCambio(dims.filter((x) => x !== d), preguntas.map((p) => (p.dimension === d ? { ...p, dimension: destino } : p)));
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Dimensiones */}
      <div>
        <p className="text-xs font-medium text-ink-2">Dimensiones</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {dims.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-xl border border-border-soft bg-surface pl-2 pr-1">
              <input
                value={d}
                disabled={soloLectura}
                onChange={(e) => renombrarDimension(d, e.target.value)}
                className="h-8 w-36 bg-transparent text-[13px] font-semibold outline-none"
                aria-label={`Dimensión ${d}`}
              />
              {!soloLectura && dims.length > 1 && (
                <button onClick={() => quitarDimension(d)} className="grid h-6 w-6 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label={`Quitar ${d}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
          {!soloLectura && (
            <span className="inline-flex items-center gap-1">
              <input
                value={nuevaDim}
                onChange={(e) => setNuevaDim(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && agregarDimension()}
                placeholder="Nueva dimensión"
                className="h-8 w-40 rounded-xl border border-dashed border-border-soft bg-transparent px-2 text-[13px] outline-none focus:border-brand"
              />
              <Button size="sm" variant="ghost" onClick={agregarDimension} disabled={!nuevaDim.trim()}><Plus className="h-4 w-4" /></Button>
            </span>
          )}
        </div>
      </div>

      {/* Preguntas en orden */}
      <div>
        <p className="text-xs font-medium text-ink-2">Preguntas ({preguntas.length}) · en el orden en que se contestan</p>
        <ol className="mt-2 flex flex-col gap-2.5">
          {preguntas.map((p, i) => (
            <li key={p.id} className="rounded-2xl border border-border-soft bg-surface p-3">
              <div className="flex items-start gap-2">
                <span className="mt-2.5 w-6 shrink-0 text-right font-mono text-[11px] text-ink-3">{i + 1}.</span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-6">
                  <input
                    value={p.texto}
                    disabled={soloLectura}
                    onChange={(e) => cambiar(i, { ...p, texto: e.target.value })}
                    placeholder={p.tipo === "escala" ? "Afirmación (1 = totalmente en desacuerdo · 5 = totalmente de acuerdo)" : "Pregunta"}
                    className={cn(inputRH, "sm:col-span-6")}
                  />
                  <select
                    value={p.dimension || dims[0]}
                    disabled={soloLectura}
                    onChange={(e) => cambiar(i, { ...p, dimension: e.target.value })}
                    className={cn(inputRH, "sm:col-span-2")}
                    aria-label="Dimensión"
                  >
                    {dims.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    value={p.tipo}
                    disabled={soloLectura}
                    onChange={(e) => {
                      const tipo = e.target.value as TipoPreguntaClima;
                      cambiar(i, { ...p, tipo, opciones: tipo === "opcion" ? (p.opciones?.length ? p.opciones : ["Sí", "No"]) : undefined });
                    }}
                    className={cn(inputRH, "sm:col-span-2")}
                    aria-label="Tipo de respuesta"
                  >
                    {TIPOS_CLIMA.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                  </select>
                  {p.tipo === "opcion" ? (
                    <input
                      value={(p.opciones ?? []).join(" | ")}
                      disabled={soloLectura}
                      onChange={(e) => cambiar(i, { ...p, opciones: e.target.value.split("|").map((x) => x.trimStart()) })}
                      placeholder="Opciones separadas por |"
                      className={cn(inputRH, "sm:col-span-2")}
                    />
                  ) : (
                    <span className="hidden self-center text-[11px] text-ink-3 sm:col-span-2 sm:block">
                      {p.tipo === "escala" ? "Favorable = 4 o 5" : "Comentario libre, sin puntaje"}
                    </span>
                  )}
                </div>
                {!soloLectura && (
                  <div className="flex shrink-0 flex-col gap-1">
                    <button onClick={() => mover(i, -1)} disabled={i === 0} className="grid h-7 w-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => mover(i, 1)} disabled={i === preguntas.length - 1} className="grid h-7 w-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 disabled:opacity-30" aria-label="Bajar"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setPreguntas(preguntas.filter((_, k) => k !== i))} className="grid h-7 w-7 place-items-center rounded-lg text-ink-3 hover:bg-bad-soft hover:text-bad" aria-label="Quitar pregunta"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!soloLectura && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setPreguntas([...preguntas, { id: nuevoId(), texto: "", tipo: "escala", dimension: dims[dims.length - 1], escala_max: 5 }])}
          >
            <Plus className="h-4 w-4" /> Agregar pregunta
          </Button>
        )}
      </div>
    </div>
  );
}
