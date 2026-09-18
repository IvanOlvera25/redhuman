"use client";

/* Vista de la Carta de Intención (2026-09-18). Antes el botón abría el PDF crudo de la API y la pestaña
   del navegador salía con el ícono genérico («mundito gris») y sin título. Esta ruta de la app hereda
   el favicon de Red Human (app/icon.svg), pone título propio y embebe el PDF (inline) con acciones de
   descarga e impresión. Requiere sesión (la API valida la cookie al servir el PDF). */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Logo, Button } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { urlCartaIntencionPdf } from "@/lib/api";

export default function VistaCarta() {
  const params = useParams();
  const id = Number(params?.id ?? 0);
  const [titulo, setTitulo] = useState("Carta de intención · Red Human");
  const src = id ? urlCartaIntencionPdf(id) : "";

  useEffect(() => {
    document.title = titulo;
  }, [titulo]);

  useEffect(() => {
    setTitulo(`Carta de intención · Expediente ${id} · Red Human`);
  }, [id]);

  return (
    <main className="flex h-svh flex-col bg-bg">
      <header className="glass flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size="sm" />
          <span className="hidden truncate border-l border-border-soft pl-3 text-sm font-semibold text-ink sm:inline">Carta de intención de contratación</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.history.length > 1 ? window.history.back() : window.close()}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Volver</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => (document.getElementById("carta-pdf") as HTMLIFrameElement | null)?.contentWindow?.print()}>
            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Imprimir</span>
          </Button>
          <a
            href={src}
            download={`carta-intencion-${id}.pdf`}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Descargar</span>
          </a>
          <ThemeToggle />
        </div>
      </header>
      {src ? (
        <iframe id="carta-pdf" title="Carta de intención" src={src} className="min-h-0 flex-1 w-full bg-surface-2" />
      ) : (
        <p className="p-8 text-center text-sm text-ink-3">Expediente no válido.</p>
      )}
    </main>
  );
}
