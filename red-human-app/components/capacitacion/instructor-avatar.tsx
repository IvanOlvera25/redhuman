"use client";

/* Instructor con avatar para la sala de capacitación (restaurado 2026-09-18). Convive con el contenido
   escrito del módulo: el avatar (Anam) lo explica y responde dudas por voz; si no hay avatar (o falla),
   el mismo panel funciona como chat de texto con el instructor. Nunca bloquea el avance del curso. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send, Sparkles, Video, MessageCircle, Square } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { iniciarInstructorCurso, preguntarInstructorCurso } from "@/lib/api";

type Msg = { rol: "user" | "assistant"; texto: string };
const ESPERA_AVATAR_SEG = 25;

export function InstructorAvatar({ token, modulo, titulo, autoIniciar = false }: { token: string; modulo: number; titulo: string; autoIniciar?: boolean }) {
  const [estado, setEstado] = useState<"inactivo" | "conectando" | "avatar" | "texto">("inactivo");
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [micActivo, setMicActivo] = useState(true);
  const [aviso, setAviso] = useState("");
  const anamRef = useRef<{ stopStreaming?: () => Promise<void>; talk?: (t: string) => Promise<void> } | null>(null);
  const microfonoRef = useRef<MediaStream | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const detener = useCallback(async () => {
    try {
      await anamRef.current?.stopStreaming?.();
    } catch {}
    anamRef.current = null;
    microfonoRef.current?.getTracks().forEach((t) => t.stop());
    microfonoRef.current = null;
  }, []);

  // al cambiar de módulo (o desmontar) se cierra la sesión anterior
  useEffect(() => {
    setEstado("inactivo");
    setMensajes([]);
    setAviso("");
    return () => {
      void detener();
    };
  }, [modulo, detener]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [mensajes, pensando]);

  // 2026-09-19 (Instructor IA): el avatar arranca solo al entrar al módulo — la persona no lee primero un documento.
  useEffect(() => {
    if (!autoIniciar) return;
    const t = setTimeout(() => {
      if (estadoRef.current === "inactivo") void iniciar(false);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoIniciar, modulo]);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  async function iniciar(forzarTexto = false) {
    setEstado("conectando");
    setAviso("");
    const r = await iniciarInstructorCurso(token, modulo);
    if (!r.ok) {
      setEstado("inactivo");
      return setAviso(r.error);
    }
    const iniciales = (r.data.mensajes ?? []).map((m) => ({ rol: m.rol === "assistant" ? "assistant" : "user", texto: m.texto }) as Msg);
    setMensajes(iniciales);
    if (forzarTexto || r.data.modo !== "avatar" || !r.data.session_token) {
      setEstado("texto");
      return;
    }
    try {
      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      const client = createClient(r.data.session_token);
      const anam = client as unknown as {
        streamToVideoElement: (id: string, stream?: MediaStream) => Promise<void>;
        stopStreaming: () => Promise<void>;
        talk?: (t: string) => Promise<void>;
        addListener: (ev: string, cb: (...args: unknown[]) => void) => void;
      };
      anamRef.current = anam;
      let listo = false;
      anam.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (historial: unknown) => {
        const h = (historial as { role: string; content: string }[]) ?? [];
        if (h.length) setMensajes(h.map((m) => ({ rol: m.role === "persona" ? "assistant" : "user", texto: m.content })));
      });
      anam.addListener(AnamEvent.SESSION_READY, () => {
        listo = true;
      });
      anam.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        if (anamRef.current) setAviso("El video del instructor se cerró. Puedes seguir preguntando por texto.");
        setEstado("texto");
      });
      try {
        microfonoRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        microfonoRef.current = null; // sin micrófono el avatar igual explica; las dudas van por texto
      }
      setEstado("avatar");
      await new Promise((res) => setTimeout(res, 50));
      await anam.streamToVideoElement("instructor-video", microfonoRef.current ?? undefined);
      setTimeout(() => {
        if (!listo && anamRef.current) {
          setAviso("El video tardó demasiado; seguimos con el instructor por texto.");
          void detener();
          setEstado("texto");
        }
      }, ESPERA_AVATAR_SEG * 1000);
    } catch (e) {
      console.warn("Avatar del instructor no disponible:", e);
      await detener();
      setEstado("texto");
    }
  }

  async function preguntar() {
    const t = texto.trim();
    if (!t || pensando) return;
    setTexto("");
    if (estado === "avatar" && anamRef.current?.talk) {
      // con avatar la pregunta escrita se la "dice" al avatar para que responda en voz
      setMensajes((m) => [...m, { rol: "user", texto: t }]);
      try {
        await anamRef.current.talk(t);
        return;
      } catch {}
    }
    setMensajes((m) => [...m, { rol: "user", texto: t }]);
    setPensando(true);
    const r = await preguntarInstructorCurso(token, modulo, t);
    setPensando(false);
    if (!r.ok) return setAviso(r.error);
    setMensajes((m) => [...m, { rol: "assistant", texto: r.data.respuesta }]);
  }

  function alternarMic() {
    setMicActivo((v) => {
      microfonoRef.current?.getAudioTracks().forEach((tr) => (tr.enabled = !v));
      return !v;
    });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border-faint px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-brand" /> Instructor Red Human
        </span>
        {estado === "avatar" && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={alternarMic} title={micActivo ? "Silenciar micrófono" : "Activar micrófono"} className={cn("grid h-8 w-8 place-items-center rounded-lg transition", micActivo ? "bg-surface-2 text-ink" : "bg-warn-soft text-warn")}>
              {micActivo ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => { void detener(); setEstado("texto"); }} title="Cerrar video" className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-ink transition hover:bg-bad-soft hover:text-bad">
              <Square className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {estado === "inactivo" && (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Video className="h-6 w-6" /></span>
          <p className="text-sm text-ink-2">Deja que el instructor te explique «{titulo}» en video y pregúntale lo que quieras.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => iniciar(false)}><Video className="h-4 w-4" /> Ver al instructor</Button>
            <Button size="sm" variant="outline" onClick={() => iniciar(true)}><MessageCircle className="h-4 w-4" /> Preguntar por texto</Button>
          </div>
          {aviso && <p className="text-xs text-warn">{aviso}</p>}
        </div>
      )}

      {estado === "conectando" && (
        <div className="grid place-items-center gap-2 px-5 py-10 text-ink-3">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
          <p className="text-xs">Conectando con el instructor…</p>
        </div>
      )}

      {estado === "avatar" && (
        <div className="relative aspect-video bg-[#151517]">
          <video id="instructor-video" autoPlay playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
            {mensajes.slice(-2).map((m, i) => (
              <p key={i} className="text-[12px] leading-snug text-white/90">
                <b>{m.rol === "assistant" ? "Instructor: " : "Tú: "}</b>{m.texto}
              </p>
            ))}
          </div>
        </div>
      )}

      {estado === "texto" && (
        <div ref={chatRef} className="max-h-72 min-h-[9rem] space-y-2 overflow-y-auto p-4">
          {mensajes.map((m, i) => (
            <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed", m.rol === "user" ? "bg-brand text-white" : "bg-surface-2 text-ink")}>{m.texto}</div>
            </div>
          ))}
          {pensando && <p className="text-xs italic text-ink-3">El instructor está escribiendo…</p>}
        </div>
      )}

      {(estado === "avatar" || estado === "texto") && (
        <div className="flex items-center gap-2 border-t border-border-faint p-3">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && preguntar()}
            placeholder="Pregúntale al instructor…"
            className="h-10 flex-1 rounded-xl border border-border-soft bg-bg px-3 text-sm outline-none focus:border-brand"
          />
          <Button size="sm" onClick={preguntar} disabled={!texto.trim() || pensando}><Send className="h-4 w-4" /></Button>
        </div>
      )}
      {aviso && estado !== "inactivo" && <p className="border-t border-border-faint px-4 py-2 text-xs text-warn">{aviso}</p>}
    </div>
  );
}
