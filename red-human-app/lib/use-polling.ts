"use client";

/* Fase 4 (2026-09-15) — Revalidación tipo SWR para los tableros (Kanban, Vacantes, Onboarding,
   Entrevistas): la vista se vuelve a cargar sola cada `intervaloMs` mientras la pestaña está visible,
   y también al volver a la pestaña o a la ventana — sin refresh manual y sin pegarle a la API en
   segundo plano. Sin dependencia externa: el proyecto ya tenía este patrón repetido a mano en dos
   páginas; aquí queda en un solo lugar. */

import { useEffect, useRef } from "react";

// Hotfix concurrencia 2026-09-24: 15 s → 30 s en todos los tableros (al volver a la pestaña se recarga igual).
export const INTERVALO_TABLERO_MS = 30000;

export function usePolling(recargar: () => void | Promise<unknown>, intervaloMs: number = INTERVALO_TABLERO_MS, activo = true) {
  const ref = useRef(recargar);
  ref.current = recargar;

  useEffect(() => {
    if (!activo) return;
    let enCurso = false;
    const tick = async () => {
      if (document.visibilityState !== "visible" || enCurso) return;
      enCurso = true;
      try {
        await ref.current();
      } finally {
        enCurso = false;
      }
    };
    const timer = setInterval(tick, intervaloMs);
    const alVolver = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [intervaloMs, activo]);
}
