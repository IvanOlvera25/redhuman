"use client";

/* Punto 12 — confirmación ligera de una acción que dispara notificación.

   Reemplaza a los `window.confirm` de los botones (Marcar realizada, Recordatorio, Cancelar,
   Solicitar documentos, Dar de alta…): un panel pequeño con el mensaje, la línea
   "Notificar: … · Editar" precargada con la configuración predeterminada, y Confirmar/Cancelar.
   NO es una pantalla completa de confirmación. */

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import type { EventoNotificacion, NotificarAccion } from "@/lib/api";
import { LineaNotificar, useNotificarAccion } from "./linea-notificar";

export function ConfirmacionAccion({
  titulo,
  texto,
  evento,
  hayEntrevistador = true,
  hayCliente = false,
  etiquetaConfirmar = "Confirmar",
  tono = "brand",
  onCancelar,
  onConfirmar,
}: {
  titulo: string;
  texto?: string;
  evento: EventoNotificacion;
  hayEntrevistador?: boolean;
  hayCliente?: boolean;
  etiquetaConfirmar?: string;
  tono?: "brand" | "bad";
  onCancelar: () => void;
  /** Recibe el ajuste de notificación de esta acción; debe resolver cuando termine. */
  onConfirmar: (notificar: NotificarAccion) => Promise<void> | void;
}) {
  const { value, setValue } = useNotificarAccion(evento);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    try {
      await onConfirmar(value);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancelar}>
      <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-bold">{titulo}</h3>
        {texto && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{texto}</p>}
        <LineaNotificar className="mt-3.5" value={value} onChange={setValue} hayEntrevistador={hayEntrevistador} hayCliente={hayCliente} />
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button className={tono === "bad" ? "flex-1 bg-bad hover:bg-bad/90" : "flex-1"} onClick={confirmar} disabled={ocupado}>
            {ocupado ? "Enviando…" : etiquetaConfirmar}
          </Button>
        </div>
      </Card>
    </div>
  );
}
