import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}

export function formatMXN(n: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

/** 2026-09-17: recordatorios de documentos en 3 niveles progresivos. */
export const TONO_RECORDATORIO: Record<1 | 2 | 3, { nombre: string; descripcion: string }> = {
  1: { nombre: "ligero", descripcion: "Primer aviso amistoso: «¿cómo vas?», sin fecha ni presión." },
  2: { nombre: "intermedio", descripcion: "Recordatorio estándar: lista lo que falta y la fecha límite; ofrece ayuda." },
  3: { nombre: "definitivo", descripcion: "Último aviso automático: firme pero respetuoso; explica que el ingreso queda en pausa y que RH dará seguimiento." },
};

export function etiquetaRecordatorio(nivel?: number | null, enviados?: number | null) {
  const n = (Math.min(Math.max(nivel ?? 1, 1), 3) as 1 | 2 | 3);
  const agotados = (enviados ?? 0) >= 3;
  return { nivel: n, tono: TONO_RECORDATORIO[n], agotados, texto: agotados ? "Enviar recordatorio (definitivo, de nuevo)" : `Enviar recordatorio (nivel ${n} de 3 · ${TONO_RECORDATORIO[n].nombre})` };
}
