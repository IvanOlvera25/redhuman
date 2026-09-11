"use client";

/* Sala pública de entrevista con agente IA (módulo 3.10).
   Con ANAM_API_KEY en la API → video con avatar; sin clave → chat de texto
   con el mismo agente. La evaluación final la revisa una persona de RH. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ShieldCheck,
  Sparkles,
  Send,
  Phone,
  Video,
  MessageCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Logo, Button, Card, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  fetchEntrevistaPublica,
  consentirEntrevista,
  iniciarEntrevista,
  turnoEntrevista,
  finalizarEntrevista,
  type CierreEntrevista,
  type EntrevistaPublica,
} from "@/lib/api";

type Fase = "cargando" | "no_disponible" | "consentimiento" | "conectando" | "sala" | "finalizando" | "fin" | "interrumpida";
type Msg = { rol: "assistant" | "user"; texto: string };

/* Fase 4 (Punto 3) — silencio. La regla del documento define la frase del inicio; la variante
   intermedia es un supuesto ajustable. Los tiempos son conservadores para no interrumpir a
   alguien que está pensando. */
const SILENCIO_INICIO_SEG = 12;
const SILENCIO_ENTREVISTA_SEG = 25;
const MAX_AVISOS_SILENCIO = 2;
/* Despedida fija de Alma — debe coincidir con ia.DESPEDIDA_ENTREVISTA en el backend (fallback
   "marcador" del cierre automático; el servidor la verifica de todos modos). */
const DESPEDIDA = "con esto terminamos la entrevista";

export default function SalaEntrevista() {
  const params = useParams();
  const token = String(params?.token ?? "");

  const [fase, setFase] = useState<Fase>("cargando");
  const [info, setInfo] = useState<EntrevistaPublica | null>(null);
  const [acepto, setAcepto] = useState(false);
  const [modo, setModo] = useState<"avatar" | "texto">("texto");
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);

  const anamRef = useRef<{ stopStreaming?: () => Promise<void>; talk?: (t: string) => Promise<void> } | null>(null);
  const transcriptRef = useRef<Msg[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  // evita finalizar dos veces: el clic manual en "Terminar" también dispara CONNECTION_CLOSED
  // como efecto de stopStreaming(), así que ambos caminos se guardan con la misma bandera.
  const finalizadoRef = useRef(false);
  const nombreRef = useRef("");
  const silencioRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; avisos: number; hablando: boolean }>({ timer: null, avisos: 0, hablando: false });

  useEffect(() => {
    // precalienta el chunk del SDK del avatar; el clic solo tiene que iniciar el stream
    import("@anam-ai/js-sdk").catch(() => {});
    fetchEntrevistaPublica(token).then((i) => {
      if (!i) return setFase("no_disponible");
      setInfo(i);
      nombreRef.current = i.candidato;
      if (i.estado === "completada" || i.estado === "evaluada") return setFase("fin");
      if (i.estado === "interrumpida") return setFase("interrumpida");
      setFase("consentimiento");
    });
  }, [token]);

  /** Cierre único (Fase 4): cualquiera de los caminos (automático, botón, desconexión) pasa por aquí
   * UNA sola vez; el servidor verifica `cierre` contra el transcript y decide evaluada/interrumpida. */
  const cerrar = useCallback(
    async (cierre: CierreEntrevista, conTranscript: boolean) => {
      if (finalizadoRef.current) return;
      finalizadoRef.current = true;
      if (silencioRef.current.timer) clearTimeout(silencioRef.current.timer);
      setFase("finalizando");
      try {
        await anamRef.current?.stopStreaming?.();
      } catch {}
      const r = await finalizarEntrevista(token, conTranscript ? transcriptRef.current : undefined, cierre);
      setFase(r.ok && r.data.estado === "interrumpida" ? "interrumpida" : "fin");
    },
    [token],
  );

  /** Silencio (avatar): si la persona no habla, Alma repite la frase del documento; máximo 2 veces.
   * Antes del primer turno del candidato pregunta si está listo; después, pide repetir la respuesta. */
  const programarAvisoSilencio = useCallback(() => {
    const st = silencioRef.current;
    if (st.timer) clearTimeout(st.timer);
    const sinTurnoCandidato = !transcriptRef.current.some((m) => m.rol === "user");
    const seg = sinTurnoCandidato ? SILENCIO_INICIO_SEG : SILENCIO_ENTREVISTA_SEG;
    st.timer = setTimeout(async () => {
      if (finalizadoRef.current || st.hablando || st.avisos >= MAX_AVISOS_SILENCIO) return;
      st.avisos += 1;
      const nombre = nombreRef.current || "";
      const frase = sinTurnoCandidato
        ? `${nombre}, no te escuché. ¿Estás listo?`
        : `${nombre}, no te escuché. ¿Me repites tu respuesta?`;
      try {
        await anamRef.current?.talk?.(frase);
      } catch {}
      programarAvisoSilencio();
    }, seg * 1000);
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [mensajes, pensando]);

  const empezar = useCallback(async () => {
    setFase("conectando");
    const ok = await consentirEntrevista(token);
    if (!ok.ok) return setFase("no_disponible");
    const sesion = await iniciarEntrevista(token);
    if (!sesion.ok) return setFase("no_disponible");
    const s = sesion.data;

    if (s.modo === "avatar" && s.session_token) {
      try {
        const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
        const client = createClient(s.session_token);
        const anam = client as unknown as {
          stopStreaming?: () => Promise<void>;
          talk?: (t: string) => Promise<void>;
          addListener: (ev: string, cb: (...args: any[]) => void) => void;
        };
        anamRef.current = anam;
        if (s.nombre) nombreRef.current = s.nombre;
        anam.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (historial: { role: string; content: string }[]) => {
          transcriptRef.current = historial.map((m) => ({
            rol: m.role === "persona" ? "assistant" : "user",
            texto: m.content,
          }));
          setMensajes(transcriptRef.current.slice(-4));
          // Cierre automático (Fase 4, Punto 4 — fallback "marcador"): Alma se despide con una frase
          // fija; el servidor verifica que esté en el transcript antes de aceptar el cierre.
          const ultimo = transcriptRef.current[transcriptRef.current.length - 1];
          if (ultimo?.rol === "assistant" && ultimo.texto.toLowerCase().includes(DESPEDIDA)) {
            if (silencioRef.current.timer) clearTimeout(silencioRef.current.timer);
            // deja que termine de decir la despedida antes de cortar el stream
            setTimeout(() => cerrar("marcador", true), 6000);
          }
        });
        // Silencio: se reprograma cada vez que la persona termina de hablar; se pausa mientras habla.
        anam.addListener(AnamEvent.USER_SPEECH_STARTED, () => {
          silencioRef.current.hablando = true;
          if (silencioRef.current.timer) clearTimeout(silencioRef.current.timer);
        });
        anam.addListener(AnamEvent.USER_SPEECH_ENDED, () => {
          silencioRef.current.hablando = false;
          silencioRef.current.avisos = 0;
          programarAvisoSilencio();
        });
        anam.addListener(AnamEvent.SESSION_READY, () => programarAvisoSilencio());
        // Respaldo: si Anam corta la conexión (timeout de ANAM_MAX_SESION_SEG, falla de red) sin
        // que hubiera cierre automático ni botón, igual se cierra — el servidor lo registra como
        // "desconexion" y, si casi no hubo turnos, la deja como interrumpida para que RH la reabra.
        anam.addListener(AnamEvent.CONNECTION_CLOSED, () => cerrar("desconexion", true));
        setModo("avatar");
        setFase("sala");
        // el elemento <video id="avatar-video"> ya está montado al entrar a "sala"
        setTimeout(() => client.streamToVideoElement("avatar-video"), 0);
        return;
      } catch (err) {
        // si el avatar falla en el navegador, seguimos por texto
        console.error("❌ Error inicializando Anam:", err);
      }
    }

    setModo("texto");
    const iniciales = (s.mensajes ?? []).map((m) => ({ rol: m.rol as Msg["rol"], texto: m.texto }));
    setMensajes(iniciales);
    transcriptRef.current = iniciales;
    setFase("sala");
  }, [token]);

  const enviar = useCallback(async () => {
    const t = texto.trim();
    if (!t || pensando) return;
    setTexto("");
    setMensajes((m) => [...m, { rol: "user", texto: t }]);
    setPensando(true);
    const turno = await turnoEntrevista(token, t);
    setPensando(false);
    if (!turno.ok) {
      setMensajes((m) => [...m, { rol: "assistant", texto: `No pude procesar tu respuesta: ${turno.error}` }]);
      return;
    }
    const r = turno.data;
    setMensajes((m) => [...m, { rol: "assistant", texto: r.respuesta }]);
    // Cierre automático en modo texto: la IA marcó `terminada` y se despidió; el servidor verifica.
    if (r.terminada) await cerrar("texto", false);
  }, [texto, pensando, token, cerrar]);

  const terminar = useCallback(() => cerrar("manual", modo === "avatar"), [cerrar, modo]);

  return (
    <main className="min-h-svh bg-bg">
      <link rel="preconnect" href="https://api.anam.ai" />
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10">
        {fase === "cargando" && (
          <div className="grid place-items-center py-24 text-ink-3">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {fase === "no_disponible" && (
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-bold">Liga no disponible</h1>
            <p className="mt-2 text-sm text-ink-2">
              Esta entrevista no existe o ya no está activa. Verifica la liga que recibiste o contacta al equipo de RH.
            </p>
          </Card>
        )}

        {fase === "consentimiento" && info && (
          <>
            <div className="text-center">
              <Badge tone="good" dot>
                Entrevista · {info.empresa}
              </Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl">
                Hola {info.candidato.split(" ")[0]}, tu entrevista para {info.puesto}
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
                Conversarás con <b className="text-ink">Alma</b>, nuestra entrevistadora virtual
                {info.avatar_disponible ? " en video" : " por chat"}. Dura alrededor de 10 minutos y puedes hacerla
                desde tu celular o computadora.
              </p>
            </div>

            <Card className="mt-6 p-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-human" />
                <div className="text-sm leading-relaxed text-ink-2">
                  <p className="font-semibold text-ink">Antes de empezar, es importante que sepas:</p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-4">
                    <li>Alma es una <b>inteligencia artificial</b>, no una persona.</li>
                    <li>La conversación se <b>graba y transcribe</b> para que el equipo de RH la revise.</li>
                    <li>
                      La IA solo genera una recomendación: <b>la decisión final siempre la toma una persona</b> del
                      equipo de RH.
                    </li>
                    <li>No se te pedirán datos sensibles (salud, religión, estado civil).</li>
                  </ul>
                </div>
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border-soft p-4 transition hover:border-brand/40">
                <input
                  type="checkbox"
                  checked={acepto}
                  onChange={(e) => setAcepto(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--brand,#ee4444)]"
                />
                <span className="text-sm text-ink-2">
                  Acepto participar en esta entrevista con IA y autorizo la grabación y el tratamiento de mis
                  respuestas para este proceso de selección.
                </span>
              </label>

              <Button className="mt-5 w-full" disabled={!acepto} onClick={empezar}>
                {info.avatar_disponible ? <Video className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                Comenzar entrevista
              </Button>
            </Card>
          </>
        )}

        {fase === "conectando" && (
          <div className="grid place-items-center gap-3 py-24 text-ink-2">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
            <p className="text-sm">Preparando tu entrevista…</p>
          </div>
        )}

        {(fase === "sala" || fase === "finalizando") && (
          <Card className="overflow-hidden">
            {modo === "avatar" ? (
              <div className="relative aspect-video bg-[#151517]">
                <video id="avatar-video" autoPlay playsInline className="h-full w-full object-cover" />
                <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 font-mono text-[11px] text-white/90 backdrop-blur">
                  <Sparkles className="h-3 w-3" /> Alma · IA en video
                </span>
                <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
                  {mensajes.slice(-2).map((m, i) => (
                    <p key={i} className="text-[13px] leading-snug text-white/90">
                      <b>{m.rol === "assistant" ? "Alma: " : "Tú: "}</b>
                      {m.texto}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div ref={chatRef} className="h-[26rem] space-y-3 overflow-y-auto p-5">
                {mensajes.map((m, i) => (
                  <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        m.rol === "user" ? "bg-brand text-white" : "bg-surface-2 text-ink",
                      )}
                    >
                      {m.rol === "assistant" && (
                        <span className="mb-0.5 flex items-center gap-1 font-mono text-[10px] font-semibold text-brand">
                          <Sparkles className="h-3 w-3" /> ALMA
                        </span>
                      )}
                      {m.texto}
                    </div>
                  </div>
                ))}
                {pensando && (
                  <div className="flex items-center gap-2 text-ink-3">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                    <span className="text-xs italic">Alma está escribiendo…</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-border-faint p-4">
              {modo === "texto" && (
                <>
                  <input
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && enviar()}
                    placeholder="Escribe tu respuesta…"
                    disabled={fase === "finalizando"}
                    className="h-11 flex-1 rounded-xl border border-border-soft bg-surface px-4 text-sm outline-none transition focus:border-brand"
                  />
                  <Button size="sm" onClick={enviar} disabled={!texto.trim() || fase === "finalizando"}>
                    <Send className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={terminar}
                disabled={fase === "finalizando"}
                className={cn(modo === "avatar" && "ml-auto")}
              >
                {fase === "finalizando" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Phone className="h-4 w-4 rotate-[135deg]" />
                )}
                Terminar entrevista
              </Button>
            </div>

            <div className="flex items-center gap-2.5 border-t border-border-faint bg-human-soft/40 px-5 py-2.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-human" />
              <p className="text-[12px] text-ink-3">
                Conversación grabada con tu consentimiento. La decisión final la toma una persona de RH.
              </p>
            </div>
          </Card>
        )}

        {fase === "interrumpida" && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-warn/10">
              <Phone className="h-7 w-7 rotate-[135deg] text-warn" />
            </span>
            <h1 className="font-display mt-4 text-2xl font-bold">La entrevista se interrumpió</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
              Se perdió la conexión antes de que pudiéramos platicar. No te preocupes: el equipo de RH
              {info ? ` de ${info.empresa}` : ""} puede reabrir esta misma liga para que la retomes.
            </p>
          </Card>
        )}

        {fase === "fin" && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good/10">
              <CheckCircle2 className="h-7 w-7 text-good" />
            </span>
            <h1 className="font-display mt-4 text-2xl font-bold">¡Gracias por tu entrevista!</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
              Tus respuestas quedaron registradas. El equipo de RH{info ? ` de ${info.empresa}` : ""} las revisará y te
              contactará muy pronto con el siguiente paso. 😊
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}
