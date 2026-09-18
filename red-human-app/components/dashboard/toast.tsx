"use client";

/* Toast (2026-09-18): aviso flotante que no depende del scroll del modal — se usa para advertencias que RH
   NO debe perderse (p. ej. «Entrevista asignada, pero el correo falló»). Se pinta en un portal sobre <body>,
   esquina inferior derecha (centrado abajo en móvil), y se cierra solo o con la X. */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastMsg = { tono: "warn" | "ok" | "error"; texto: string; detalle?: string[] } | null;

export function Toast({ msg, onClose, duracionMs = 9000 }: { msg: ToastMsg; onClose: () => void; duracionMs?: number }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, duracionMs);
    return () => clearTimeout(t);
  }, [msg, onClose, duracionMs]);
  if (!msg || typeof document === "undefined") return null;
  return createPortal(
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-[1100] flex justify-center sm:inset-x-auto sm:right-5 sm:bottom-5 sm:justify-end">
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur",
          msg.tono === "warn" && "border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-950/90 dark:text-amber-100",
          msg.tono === "ok" && "border-good/40 bg-good-soft text-good",
          msg.tono === "error" && "border-bad/40 bg-bad-soft text-bad",
        )}
      >
        {msg.tono === "ok" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1 text-sm leading-snug">
          <p className="font-semibold">{msg.texto}</p>
          {msg.detalle?.map((d, i) => (
            <p key={i} className="mt-1 text-[12px] opacity-90">{d}</p>
          ))}
        </div>
        <button onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg opacity-70 hover:opacity-100" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
