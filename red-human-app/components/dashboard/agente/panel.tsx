"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useAgente, type MensajeAgenteUI } from "./proveedor";

const SUGERENCIAS: Record<string, string[]> = {
  vacante: ["Resume el avance", "¿Quiénes son los mejores candidatos?", "¿Qué está pendiente?"],
  candidato: ["Resúmeme todo lo que ha pasado con este candidato", "¿Cuál es el siguiente paso?"],
  vacantes: ["¿Cuántas vacantes sin candidatos tengo?", "¿Qué vacantes llevan más tiempo abiertas?"],
  candidatos: ["¿Cuántos candidatos aptos tengo pendientes de entrevista humana?", "Muéstrame posibles duplicados"],
  entrevistas: ["¿Cuántas entrevistas tengo agendadas esta semana?"],
  onboarding: ["¿Qué expedientes están listos para alta?"],
  configuracion: ["¿Cómo están configuradas las notificaciones ahorita?"],
  tablero: ["Dame un resumen del día"],
};

function TarjetaAccion({ mensaje, indice }: { mensaje: MensajeAgenteUI; indice: number }) {
  const { confirmarAccion, cancelarAccion } = useAgente();
  const accion = mensaje.accionPropuesta;
  if (!accion) return null;

  return (
    <div className="mt-2 rounded-xl border border-brand/25 bg-brand-soft/60 p-3">
      <p className="text-[13px] leading-relaxed text-ink">{accion.resumen}</p>
      {mensaje.accionEstado === "pendiente" && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => confirmarAccion(indice)}>
            <Check className="h-3.5 w-3.5" /> Confirmar
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => cancelarAccion(indice)}>
            Cancelar
          </Button>
        </div>
      )}
      {mensaje.accionEstado === "confirmando" && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ejecutando…
        </p>
      )}
      {mensaje.accionEstado === "hecha" && <p className="mt-2 text-[12px] font-medium text-good">Hecho ✓</p>}
      {mensaje.accionEstado === "cancelada" && <p className="mt-2 text-[12px] text-ink-3">Cancelado.</p>}
      {mensaje.accionEstado === "error" && (
        <p className="mt-2 text-[12px] text-bad">No se pudo ejecutar: {mensaje.accionError}</p>
      )}
    </div>
  );
}

function Burbuja({ mensaje, indice }: { mensaje: MensajeAgenteUI; indice: number }) {
  const esUsuario = mensaje.rol === "user";
  return (
    <div className={cn("flex", esUsuario ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed", esUsuario ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink")}>
        <p className="whitespace-pre-wrap">{mensaje.texto}</p>
        {mensaje.navegacion && mensaje.navegacion.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mensaje.navegacion.map((n) => (
              <Link
                key={n.ruta}
                href={n.ruta}
                className="rounded-lg border border-border-soft bg-surface px-2.5 py-1 text-[12px] font-medium text-brand hover:underline"
              >
                {n.etiqueta}
              </Link>
            ))}
          </div>
        )}
        {mensaje.accionPropuesta && <TarjetaAccion mensaje={mensaje} indice={indice} />}
      </div>
    </div>
  );
}

export function PanelAgente() {
  const { abierto, cerrar, mensajes, enviando, error, uso, contextoActual, mandarMensaje } = useAgente();
  const [texto, setTexto] = useState("");
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, enviando]);

  if (!abierto) return null;

  const limiteAlcanzado = Boolean(uso && uso.mensajesHoy >= uso.limite);
  const sugerencias = SUGERENCIAS[contextoActual?.pantalla ?? ""] ?? [];

  function enviar() {
    const t = texto;
    setTexto("");
    mandarMensaje(t);
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={cerrar} />
      <div className="relative flex h-full w-full max-w-sm flex-col border-l border-border-soft bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3.5">
          <Sparkles className="h-[18px] w-[18px] text-brand" />
          <h2 className="font-display text-sm font-bold">Pregunta a Red Human</h2>
          <button onClick={cerrar} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {mensajes.length === 0 && (
            <div>
              <p className="text-[13px] leading-relaxed text-ink-2">
                Pregúntame sobre vacantes, candidatos, entrevistas o contratación — o pídeme que ejecute algo
                (siempre te la muestro antes de hacerla).
              </p>
              {sugerencias.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {sugerencias.map((s) => (
                    <button
                      key={s}
                      onClick={() => mandarMensaje(s)}
                      className="rounded-xl border border-border-soft bg-surface-2/60 px-3 py-2 text-left text-[12.5px] text-ink-2 transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {mensajes.map((m, i) => (
              <Burbuja key={i} mensaje={m} indice={i} />
            ))}
            {enviando && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
                </div>
              </div>
            )}
          </div>
          <div ref={finRef} />
        </div>

        {error && <p className="border-t border-border-soft px-4 py-2 text-[12px] text-bad">{error}</p>}

        <div className="border-t border-border-soft p-3">
          {limiteAlcanzado ? (
            <p className="text-center text-[12px] text-ink-3">
              Llegaste al límite de {uso?.limite} preguntas por hoy. Vuelve mañana.
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviar();
                  }
                }}
                placeholder="Escribe tu pregunta…"
                rows={1}
                disabled={enviando}
                className="max-h-28 flex-1 resize-none rounded-xl border border-border-soft bg-surface-2 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-surface disabled:opacity-60"
              />
              <Button size="sm" onClick={enviar} disabled={enviando || !texto.trim()} aria-label="Enviar">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
          {uso && !limiteAlcanzado && (
            <p className="mt-1.5 text-right text-[10.5px] text-ink-3">{uso.mensajesHoy}/{uso.limite} hoy</p>
          )}
        </div>
      </div>
    </div>
  );
}
