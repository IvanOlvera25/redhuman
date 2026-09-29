"use client";

/* Firma electrónica INCRUSTADA (Dropbox Sign, 2026-09-29). Usa `hellosign-embedded`, la biblioteca oficial de
   Dropbox Sign para abrir el modal de firma dentro de NUESTRA interfaz (marca blanca: sin redirigir a otra página).
   El logo y los colores del modal se configuran en la API app de Dropbox Sign (white labeling); aquí solo se abre.
   Se importa de forma dinámica: el paquete toca `window` y no debe entrar al render del servidor. */

type Opciones = {
  clientId: string;
  signUrl: string;
  testMode?: boolean;
  onFirmado?: () => void;
  onCerrado?: () => void;
  onError?: (mensaje: string) => void;
};

type ClienteHelloSign = {
  open: (url: string, opciones?: Record<string, unknown>) => void;
  once: (evento: string, fn: (datos?: unknown) => void) => void;
  off: (evento: string, fn?: (datos?: unknown) => void) => void;
};

let cliente: ClienteHelloSign | null = null;
let clienteDe = "";

export async function abrirFirmaEmbebida({ clientId, signUrl, testMode = false, onFirmado, onCerrado, onError }: Opciones) {
  try {
    const mod = await import("hellosign-embedded");
    const HelloSign = (mod as { default?: unknown }).default ?? mod;
    if (!cliente || clienteDe !== clientId) {
      cliente = new (HelloSign as new (o: { clientId: string }) => ClienteHelloSign)({ clientId });
      clienteDe = clientId;
    }
    const c = cliente;
    for (const ev of ["sign", "close", "error"]) c.off(ev);
    c.once("sign", () => onFirmado?.());
    c.once("close", () => onCerrado?.());
    c.once("error", (e) => onError?.(typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Error en la firma"));
    c.open(signUrl, {
      testMode,
      // en modo prueba Dropbox Sign permite dominios no verificados (localhost); en producción el dominio debe estar
      // registrado en la API app
      skipDomainVerification: testMode,
      allowCancel: true,
      locale: "es_MX",
    });
  } catch (ex) {
    onError?.(ex instanceof Error ? ex.message : "No se pudo abrir la firma electrónica.");
  }
}
