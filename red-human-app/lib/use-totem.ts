"use client";

import { useEffect, useState } from "react";

/** 2026-09-21 — Modo Tótem (Expo: LCD táctil 55" en vertical, 1080×1920, Windows).
 *
 * Tailwind interpreta 1080 px de ancho como escritorio (`lg`), así que la orientación se decide aquí y con la
 * variante `totem:` de globals.css (retrato ≥ 800×1400, o la clase `.totem` forzada). Regla compartida por las
 * salas públicas de Entrevista y Capacitación:
 *   - `?totem=1` fuerza el modo, `?totem=0` lo apaga;
 *   - si no, retrato (orientation: portrait) con ≥ 800 px de ancho y ≥ 1400 px de alto (un celular NO califica).
 * Se evalúa UNA sola vez al montar: cambiarlo a mitad de sesión desmontaría el <video> del avatar. */
export function esTotem(): boolean {
  if (typeof window === "undefined") return false;
  const forzado = new URLSearchParams(window.location.search).get("totem");
  if (forzado === "1") return true;
  if (forzado === "0") return false;
  const retrato = window.matchMedia("(orientation: portrait)").matches;
  return retrato && window.innerWidth >= 800 && window.innerHeight >= 1400;
}

export function useTotem(): boolean {
  const [totem, setTotem] = useState(false);
  useEffect(() => {
    setTotem(esTotem());
  }, []);
  return totem;
}

/** Periféricos USB (Windows): enumera micrófonos/cámaras para avisar ANTES de iniciar si no hay entrada de
 * audio (el prompt de permisos del navegador sale igual con `getUserMedia`; esto solo diagnostica). */
export async function perifericosDisponibles(): Promise<{ microfonos: number; camaras: number; soportado: boolean }> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return { microfonos: 0, camaras: 0, soportado: false };
  try {
    const lista = await navigator.mediaDevices.enumerateDevices();
    return {
      microfonos: lista.filter((d) => d.kind === "audioinput").length,
      camaras: lista.filter((d) => d.kind === "videoinput").length,
      soportado: true,
    };
  } catch {
    return { microfonos: 0, camaras: 0, soportado: false };
  }
}
