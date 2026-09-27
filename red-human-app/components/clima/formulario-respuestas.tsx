"use client";

/* Formulario de respuestas de clima (Clima v2, 2026-09-27) — el MISMO que ve el colaborador en su liga
   (`/clima/[token]`) y el que usa RH en «Probar encuesta»: así la prueba es exactamente la experiencia real.
   Preguntas en su orden, con el nombre de la dimensión como encabezado al cambiar. Compatible con Modo
   Tótem (botones grandes). No valida identidad: eso lo decide quien lo usa. */

import { cn } from "@/lib/utils";
import type { PreguntaClima } from "@/lib/api";
import { Card } from "@/components/ui";

export function FormularioRespuestas({
  preguntas, respuestas, onCambio, totem = false,
}: {
  preguntas: PreguntaClima[];
  respuestas: Record<string, unknown>;
  onCambio: (r: Record<string, unknown>) => void;
  totem?: boolean;
}) {
  const ordenadas = [...preguntas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  return (
    <div className="flex flex-col gap-4">
      {ordenadas.map((p, i) => {
        const nuevaDimension = i === 0 || ordenadas[i - 1].dimension !== p.dimension;
        return (
          <div key={p.id} className="flex flex-col gap-2">
            {nuevaDimension && p.dimension && (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-ink-3 totem:text-base">{p.dimension}</p>
            )}
            <Card className="p-5">
              <p className="text-sm font-semibold text-ink totem:text-xl">{p.texto}</p>

              {p.tipo === "escala" && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const activo = respuestas[p.id] === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onCambio({ ...respuestas, [p.id]: n })}
                          aria-pressed={activo}
                          className={cn(
                            "grid place-items-center rounded-xl border font-bold transition active:scale-95",
                            totem ? "min-h-16 min-w-16 text-2xl" : "h-12 w-12 text-base",
                            activo ? "border-brand bg-brand text-white shadow-sm" : "border-border-soft bg-surface text-ink-2 hover:border-brand/40",
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-3 totem:text-base">1 = totalmente en desacuerdo · 5 = totalmente de acuerdo</p>
                </div>
              )}

              {p.tipo === "opcion" && (
                <div className="mt-3 flex flex-col gap-2">
                  {(p.opciones ?? []).map((o) => {
                    const activo = respuestas[p.id] === o;
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => onCambio({ ...respuestas, [p.id]: o })}
                        aria-pressed={activo}
                        className={cn(
                          "rounded-xl border px-4 py-3 text-left text-sm transition active:scale-[0.99] totem:min-h-16 totem:text-xl",
                          activo ? "border-brand bg-brand-soft text-ink ring-2 ring-brand/30" : "border-border-soft bg-surface hover:border-brand/40",
                        )}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}

              {p.tipo === "abierta" && (
                <textarea
                  value={String(respuestas[p.id] ?? "")}
                  onChange={(e) => onCambio({ ...respuestas, [p.id]: e.target.value })}
                  rows={3}
                  placeholder="Escribe lo que quieras compartir…"
                  className="mt-3 w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 totem:text-xl"
                />
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

export function contarContestadas(respuestas: Record<string, unknown>) {
  return Object.values(respuestas).filter((v) => v !== "" && v !== null && v !== undefined).length;
}
