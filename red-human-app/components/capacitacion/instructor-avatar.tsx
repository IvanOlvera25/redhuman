"use client";

/* Instructor con avatar para la sala de capacitación (restaurado 2026-09-18). Convive con el contenido
   escrito del módulo: el avatar (Anam) lo explica y responde dudas por voz; si no hay avatar (o falla),
   el mismo panel funciona como chat de texto con el instructor. Nunca bloquea el avance del curso. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send, Sparkles, Video, MessageCircle, Square } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { iniciarInstructorCurso, preguntarInstructorCurso } from "@/lib/api";
import { instrumentarWebRTC, resumenRedActual, sondearStun } from "@/lib/diagnostico-avatar";

type Msg = { rol: "user" | "assistant"; texto: string };
const ESPERA_AVATAR_SEG = 25;

/** `totem` (2026-09-21): LCD vertical — el video ocupa la mayor parte de la pantalla (tamaño real, `object-cover`,
 * centrado), controles de micrófono/cerrar siempre visibles y con área táctil ≥ 64 px, letra grande. */
export function InstructorAvatar({ token, modulo, titulo, autoIniciar = false, totem = false }: { token: string; modulo: number; titulo: string; autoIniciar?: boolean; totem?: boolean }) {
  const [estado, setEstado] = useState<"inactivo" | "conectando" | "avatar" | "texto">("inactivo");
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [micActivo, setMicActivo] = useState(true);
  const [aviso, setAviso] = useState("");
  const anamRef = useRef<{ stopStreaming?: () => Promise<void>; talk?: (t: string) => Promise<void> } | null>(null);
  /* 2026-09-23 (incidente Expo): todo lo del avatar queda en consola con prefijo [instructor]; lo que
     huele a falla va como console.error. `?debug=1` en la liga del curso además lo muestra en pantalla. */
  const depurar = typeof window !== "undefined" && ["1", "true", "red"].includes((new URLSearchParams(window.location.search).get("debug") ?? "").toLowerCase());
  const [diagnostico, setDiagnostico] = useState<string[]>([]);
  const restaurarWebRTCRef = useRef<null | (() => void)>(null);
  const log = useCallback((linea: string) => {
    const malo = /FALLA|ERROR|falló|CLOSED|failed|disconnected|ICE ERROR/i.test(linea);
    (malo ? console.error : console.info)("[instructor]", linea);
    setDiagnostico((d) => [...d, `${new Date().toISOString().slice(11, 19)} ${linea}`].slice(-25));
  }, []);
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
      restaurarWebRTCRef.current = instrumentarWebRTC(log);
      void sondearStun(log).then((r) => {
        if (!r.srflx) setAviso("La red de este lugar bloquea el video (WebRTC): seguimos con el instructor por texto.");
      });
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
      anam.addListener(AnamEvent.CONNECTION_CLOSED, (...args: unknown[]) => {
        log(`CONNECTION_CLOSED code=${String(args[0] ?? "?")} reason=${String(args[1] ?? "")}`);
        if (anamRef.current) setAviso("El video del instructor se cerró. Puedes seguir preguntando por texto.");
        restaurarWebRTCRef.current?.();
        restaurarWebRTCRef.current = null;
        setEstado("texto");
      });
      anam.addListener("SERVER_WARNING", (msg: unknown) => log("SERVER_WARNING: " + JSON.stringify(msg)));
      for (const ev of ["CONNECTION_ESTABLISHED", "SESSION_READY", "VIDEO_PLAY_STARTED", "MIC_PERMISSION_DENIED"]) {
        anam.addListener(ev, () => log(ev));
      }
      try {
        microfonoRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error("❌ [instructor] Micrófono no disponible:", err);
        log(`getUserMedia falló: ${(err as Error)?.name ?? ""} ${(err as Error)?.message ?? String(err)}`);
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
      const err = e as Error;
      console.error("❌ [instructor] Avatar no disponible:", err);
      const red = resumenRedActual();
      log(`FALLA init SDK: ${err?.name ?? ""} ${err?.message ?? String(e)} · ICE host=${red.candidatos.host} srflx=${red.candidatos.srflx} relay=${red.candidatos.relay}`);
      setAviso(`El video del instructor no pudo iniciar (${err?.name || "error"}: ${err?.message || String(e)}). Seguimos por texto.`);
      restaurarWebRTCRef.current?.();
      restaurarWebRTCRef.current = null;
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
      <div className={cn("flex items-center justify-between gap-2 border-b border-border-faint px-4 py-2.5", totem && "px-5 py-3")}>
        <span className={cn("flex items-center gap-1.5 text-sm font-semibold text-ink", totem && "text-lg")}>
          <Sparkles className={cn("h-4 w-4 text-brand", totem && "h-5 w-5")} /> Instructor Red Human
        </span>
        {estado === "avatar" && (
          /* controles SIEMPRE visibles (sin hover): en tótem son botones táctiles con etiqueta */
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={alternarMic}
              aria-pressed={micActivo}
              title={micActivo ? "Silenciar micrófono" : "Activar micrófono"}
              className={cn(
                "grid place-items-center rounded-lg transition active:scale-95",
                totem ? "min-h-16 min-w-16 gap-1 px-4 text-sm font-semibold" : "h-8 w-8",
                micActivo ? "bg-surface-2 text-ink" : "bg-warn-soft text-warn",
              )}
            >
              {micActivo ? <Mic className={totem ? "h-7 w-7" : "h-4 w-4"} /> : <MicOff className={totem ? "h-7 w-7" : "h-4 w-4"} />}
              {totem && (micActivo ? "Silenciar" : "Activar mic")}
            </button>
            <button
              type="button"
              onClick={() => { void detener(); setEstado("texto"); }}
              title="Cerrar video"
              className={cn("grid place-items-center rounded-lg bg-surface-2 text-ink transition hover:bg-bad-soft hover:text-bad active:scale-95", totem ? "min-h-16 min-w-16 gap-1 px-4 text-sm font-semibold" : "h-8 w-8")}
            >
              <Square className={totem ? "h-7 w-7" : "h-4 w-4"} />
              {totem && "Cerrar video"}
            </button>
          </div>
        )}
      </div>

      {estado === "inactivo" && (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Video className="h-6 w-6" /></span>
          <p className="text-sm text-ink-2">Deja que el instructor te explique «{titulo}» en video y pregúntale lo que quieras.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size={totem ? "lg" : "sm"} className={cn(totem && "min-h-16 rounded-2xl px-8 text-xl")} onClick={() => iniciar(false)}><Video className={totem ? "h-6 w-6" : "h-4 w-4"} /> Ver al instructor</Button>
            <Button size={totem ? "lg" : "sm"} variant="outline" className={cn(totem && "min-h-16 rounded-2xl px-8 text-xl")} onClick={() => iniciar(true)}><MessageCircle className={totem ? "h-6 w-6" : "h-4 w-4"} /> Preguntar por texto</Button>
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
        /* Tótem: el instructor a tamaño real — el contenedor toma la mayor parte del alto de la pantalla y el
           <video> lo llena con object-cover (sin barras negras, avatar centrado). Escritorio/móvil: 16:9. */
        <div className={cn("relative bg-[#151517]", totem ? "h-[62svh] min-h-[560px]" : "aspect-video")}>
          <video id="instructor-video" autoPlay playsInline className="absolute inset-0 h-full w-full object-cover object-center" />
          <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8", totem && "space-y-2 px-6 pb-6 pt-16")}>
            {mensajes.slice(-2).map((m, i) => (
              <p key={i} className={cn("text-[12px] leading-snug text-white/90", totem && "text-2xl")}>
                <b className={cn(totem && (m.rol === "assistant" ? "text-brand" : "text-white/60"))}>{m.rol === "assistant" ? "Instructor: " : "Tú: "}</b>{m.texto}
              </p>
            ))}
          </div>
        </div>
      )}

      {estado === "texto" && (
        <div ref={chatRef} className={cn("max-h-72 min-h-[9rem] space-y-2 overflow-y-auto p-4", totem && "max-h-[50svh] min-h-[14rem]")}>
          {mensajes.map((m, i) => (
            <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed", totem && "text-xl", m.rol === "user" ? "bg-brand text-white" : "bg-surface-2 text-ink")}>{m.texto}</div>
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
            className={cn("h-10 flex-1 rounded-xl border border-border-soft bg-bg px-3 text-sm outline-none focus:border-brand", totem && "min-h-16 text-xl")}
          />
          <Button size="sm" className={cn(totem && "min-h-16 min-w-20 rounded-2xl")} onClick={preguntar} disabled={!texto.trim() || pensando}><Send className={totem ? "h-7 w-7" : "h-4 w-4"} /></Button>
        </div>
      )}
      {aviso && estado !== "inactivo" && <p className="border-t border-border-faint px-4 py-2 text-xs text-warn">{aviso}</p>}
      {depurar && diagnostico.length > 0 && (
        <div className="border-t border-amber-500/50 bg-amber-500/10 px-4 py-2 font-mono text-[10px] leading-snug text-ink">
          <p className="font-bold">DIAGNÓSTICO DEL INSTRUCTOR (?debug=1)</p>
          <ul className="mt-1 max-h-32 overflow-y-auto">
            {diagnostico.map((l, i) => <li key={i} className="break-all">{l}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
