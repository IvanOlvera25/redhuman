"use client";

import { useCuentaActualId } from "@/components/sesion";

/* Punto 9 — al cambiar de Cuenta se remonta TODO lo que cuelga del dashboard (agente, shell y la
   página actual): así cada pantalla vuelve a pedir sus datos con la nueva cabecera X-Cuenta-Id
   aunque la ruta no cambie (p. ej. ya estabas en /dashboard), y la conversación del agente
   —que solo vive en memoria— no arrastra contexto de la Cuenta anterior. */
export function PorCuenta({ children }: { children: React.ReactNode }) {
  const cuentaActualId = useCuentaActualId();
  return (
    <div key={cuentaActualId ?? "sin-cuenta"} className="contents">
      {children}
    </div>
  );
}
