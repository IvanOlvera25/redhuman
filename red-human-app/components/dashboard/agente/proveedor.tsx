"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ejecutarAccionAgente,
  fetchUsoAgente,
  preguntarAgente,
  type AccionPropuestaAgente,
  type ContextoAgente,
  type TurnoAgente,
} from "@/lib/api";

/* ============================================================
   Fase F · Agente global "Pregunta a Red Human" (punto 29).

   Sin persistencia en el backend (decisión Q6, privacidad): la conversación vive SOLO en este
   estado de React — sobrevive mientras se navega entre pantallas del dashboard (el Provider no
   se desmonta al cambiar de ruta), pero se pierde por completo al recargar o cerrar la pestaña.
   Nunca se guarda en localStorage/sessionStorage a propósito.
   ============================================================ */

export interface MensajeAgenteUI extends TurnoAgente {
  navegacion?: { ruta: string; etiqueta: string }[];
  accionPropuesta?: AccionPropuestaAgente | null;
  /** Solo aplica a mensajes del asistente con accionPropuesta. */
  accionEstado?: "pendiente" | "confirmando" | "hecha" | "cancelada" | "error";
  accionError?: string;
}

interface ContextoProveedor {
  abierto: boolean;
  abrir: () => void;
  cerrar: () => void;
  alternar: () => void;
  mensajes: MensajeAgenteUI[];
  enviando: boolean;
  error: string;
  uso: { mensajesHoy: number; limite: number } | null;
  contextoActual: ContextoAgente | null;
  anunciarContexto: (ctx: ContextoAgente | null) => void;
  mandarMensaje: (texto: string) => Promise<void>;
  confirmarAccion: (indice: number) => Promise<void>;
  cancelarAccion: (indice: number) => void;
}

const AgenteCtx = createContext<ContextoProveedor>({
  abierto: false,
  abrir: () => {},
  cerrar: () => {},
  alternar: () => {},
  mensajes: [],
  enviando: false,
  error: "",
  uso: null,
  contextoActual: null,
  anunciarContexto: () => {},
  mandarMensaje: async () => {},
  confirmarAccion: async () => {},
  cancelarAccion: () => {},
});

export function ProveedorAgente({ children }: { children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeAgenteUI[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [uso, setUso] = useState<{ mensajesHoy: number; limite: number } | null>(null);
  const [contextoActual, setContextoActual] = useState<ContextoAgente | null>(null);
  const mensajesRef = useRef<MensajeAgenteUI[]>([]);
  mensajesRef.current = mensajes;

  useEffect(() => {
    fetchUsoAgente().then((d) => d && setUso(d));
  }, []);

  const anunciarContexto = useCallback((ctx: ContextoAgente | null) => setContextoActual(ctx), []);

  const mandarMensaje = useCallback(
    async (texto: string) => {
      const limpio = texto.trim();
      if (!limpio || enviando) return;
      setError("");
      const historialPrevio: TurnoAgente[] = mensajes.map((m) => ({ rol: m.rol, texto: m.texto }));
      setMensajes((prev) => [...prev, { rol: "user", texto: limpio }]);
      setEnviando(true);
      const r = await preguntarAgente(limpio, historialPrevio, contextoActual);
      setEnviando(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setUso(r.data.uso);
      setMensajes((prev) => [
        ...prev,
        {
          rol: "assistant",
          texto: r.data.texto,
          navegacion: r.data.navegacion,
          accionPropuesta: r.data.accionPropuesta,
          accionEstado: r.data.accionPropuesta ? "pendiente" : undefined,
        },
      ]);
    },
    [mensajes, enviando, contextoActual],
  );

  const confirmarAccion = useCallback(async (indice: number) => {
    const accion = mensajesRef.current[indice]?.accionPropuesta;
    if (!accion) return;
    setMensajes((prev) => prev.map((m, i) => (i === indice ? { ...m, accionEstado: "confirmando" } : m)));
    const r = await ejecutarAccionAgente(accion.tool, accion.argumentos);
    setMensajes((prev) =>
      prev.map((m, i) =>
        i === indice
          ? r.ok
            ? { ...m, accionEstado: "hecha" }
            : { ...m, accionEstado: "error", accionError: r.error }
          : m,
      ),
    );
  }, []);

  const cancelarAccion = useCallback((indice: number) => {
    setMensajes((prev) => prev.map((m, i) => (i === indice ? { ...m, accionEstado: "cancelada" } : m)));
  }, []);

  return (
    <AgenteCtx.Provider
      value={{
        abierto,
        abrir: () => setAbierto(true),
        cerrar: () => setAbierto(false),
        alternar: () => setAbierto((v) => !v),
        mensajes,
        enviando,
        error,
        uso,
        contextoActual,
        anunciarContexto,
        mandarMensaje,
        confirmarAccion,
        cancelarAccion,
      }}
    >
      {children}
    </AgenteCtx.Provider>
  );
}

export function useAgente() {
  return useContext(AgenteCtx);
}

/** Cada pantalla con una entidad seleccionada (vacante o candidato) llama este hook cuando
 * cambia su selección — así la barra sabe "dónde está parado" el usuario sin volver a
 * preguntarle (punto 29, comportamiento contextual). Limpia el contexto al deseleccionar o
 * desmontar, para no dejar "pegada" una ficha que el usuario ya cerró. */
export function useAnunciarContextoAgente(ctx: ContextoAgente | null) {
  const { anunciarContexto } = useAgente();
  const claveRef = useRef<string>("");

  useEffect(() => {
    const clave = ctx ? `${ctx.pantalla}:${ctx.entidad?.tipo ?? ""}:${ctx.entidad?.codigo ?? ""}` : "";
    if (clave === claveRef.current) return;
    claveRef.current = clave;
    anunciarContexto(ctx);
    return () => {
      // Solo limpia si nadie más volvió a anunciar un contexto distinto mientras tanto.
      claveRef.current = "";
      anunciarContexto(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.pantalla, ctx?.entidad?.tipo, ctx?.entidad?.codigo]);
}
