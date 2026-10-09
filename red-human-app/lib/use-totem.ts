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
  if (esPantallaStand()) return false;
  const forzado = new URLSearchParams(window.location.search).get("totem");
  if (forzado === "1") return true;
  if (forzado === "0") return false;
  const retrato = window.matchMedia("(orientation: portrait)").matches;
  return retrato && window.innerWidth >= 800 && window.innerHeight >= 1400;
}

/** 2026-10-08 — Pantalla de stand (85" horizontal 16:9, 1.88 × 1.06 m, montada en alto, NO táctil).
 * Solo por parámetro (`?display=stand85`): un monitor 16:9 de escritorio NO debe caer aquí por tamaño.
 * Tiene prioridad sobre el tótem (son excluyentes). Igual que el tótem, se evalúa UNA vez al montar. */
export function esPantallaStand(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("display") === "stand85";
}

/** Liga de la sala para proyectarla en el stand (botón «Abrir en tele de 85» del tablero de RH). */
export function ligaStand85(liga: string): string {
  const url = new URL(liga, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  url.searchParams.set("display", "stand85");
  url.searchParams.delete("totem");
  return url.toString();
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
