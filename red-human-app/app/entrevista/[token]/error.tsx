"use client";

/* Límite de error de la sala pública de entrevista (2026-09-13): si algo truena al renderizar,
   el candidato ve un mensaje claro y un botón para reintentar — nunca una pantalla en negro. */

import { useEffect } from "react";
import { Logo, Button, Card } from "@/components/ui";

export default function ErrorSala({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("❌ Error en la sala de entrevista:", error);
  }, [error]);

  return (
    <main className="min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Logo />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Card className="p-8 text-center">
          <h1 className="font-display text-xl font-bold">Algo salió mal al cargar tu entrevista</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            Si la entrevista ya fue completada o interrumpida, pide al equipo de RH que la reabra. Si no, intenta de nuevo.
          </p>
          <Button className="mt-5" onClick={reset}>
            Intentar de nuevo
          </Button>
        </Card>
      </div>
    </main>
  );
}
