"use client";

/* Fase 4 (Punto 5): conocimiento profundo del candidato tras la Entrevista IA.
   10 dimensiones, cada una con conclusión + evidencia (citas del candidato). La IA solo
   describe; nunca contiene datos sensibles (el evaluador tiene prohibido registrarlos). */

import { useState } from "react";
import { ChevronDown, Quote } from "lucide-react";
import { Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DIMENSIONES_PERFIL, type PerfilProfundo } from "@/lib/api";

export function PerfilProfundoVista({ perfil, compacto = false }: { perfil: PerfilProfundo; compacto?: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const evaluadas = DIMENSIONES_PERFIL.filter((d) => perfil[d.clave]?.evaluado);

  return (
    <div>
      <div className="flex items-center justify-between">
        <Eyebrow>Conocimiento profundo</Eyebrow>
        <span className="font-mono text-[11px] text-ink-3">
          {evaluadas.length}/{DIMENSIONES_PERFIL.length} dimensiones cubiertas
        </span>
      </div>
      <div className={cn("mt-2 divide-y divide-border-faint rounded-xl border border-border-soft", compacto && "text-xs")}>
        {DIMENSIONES_PERFIL.map((d) => {
          const dim = perfil[d.clave];
          const open = abierta === d.clave;
          const sinDatos = !dim || !dim.evaluado;
          const conEvidencia = !sinDatos && (dim.evidencia?.length ?? 0) > 0;
          return (
            <div key={d.clave}>
              <button
                type="button"
                onClick={() => setAbierta(open ? null : d.clave)}
                className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition hover:bg-surface-2/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{d.etiqueta}</span>
                    {sinDatos && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">No evaluado</span>}
                  </span>
                  {!sinDatos && (
                    <span className={cn("mt-0.5 block text-xs leading-relaxed text-ink-2", !open && "line-clamp-2")}>
                      {dim.conclusion}
                    </span>
                  )}
                </span>
                {conEvidencia && (
                  <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-ink-3 transition", open && "rotate-180")} />
                )}
              </button>
              {open && conEvidencia && (
                <ul className="space-y-1.5 px-3.5 pb-3">
                  {dim.evidencia.map((cita, i) => (
                    <li key={i} className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs italic leading-relaxed text-ink-2">
                      <Quote className="mt-0.5 h-3 w-3 shrink-0 text-ink-3" /> {cita}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
