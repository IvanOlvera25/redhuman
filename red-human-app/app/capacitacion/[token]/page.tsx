"use client";

/* Sala pública de capacitación con agente IA (Fase 2). Con ANAM_API_KEY → avatar en video;
   sin clave → chat de texto con el mismo instructor. El curso se imparte módulo por módulo:
   al terminar cada uno, la persona da clic en "Continuar" (nunca lo decide la IA sola — ver
   el plan de Fase 2) y el backend evalúa sus respuestas antes de pasar al siguiente. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ShieldCheck,
  Sparkles,
  Send,
  Video,
  MessageCircle,
  CheckCircle2,
  Loader2,
  Lock,
  ArrowRight,
} from "lucide-react";
import { Logo, Button, Card, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  fetchAsignacionPublica,
  iniciarSesionCurso,
  turnoCurso,
  avanzarModulo,
  type AsignacionPublica,
} from "@/lib/api";

type Fase = "cargando" | "no_disponible" | "bienvenida" | "conectando" | "sala" | "avanzando" | "fin";
type Msg = { rol: "assistant" | "user"; texto: string };

export default function SalaCapacitacion() {
  const params = useParams();
  const token = String(params?.token ?? "");

  const [fase, setFase] = useState<Fase>("cargando");
  const [info, setInfo] = useState<AsignacionPublica | null>(null);
  const [modo, setModo] = useState<"avatar" | "texto">("texto");
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);

  const anamRef = useRef<{ stopStreaming?: () => Promise<void> } | null>(null);
  const transcriptRef = useRef<Msg[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // precalienta el chunk del SDK del avatar; el clic solo tiene que iniciar el stream
    import("@anam-ai/js-sdk").catch(() => {});
    fetchAsignacionPublica(token).then((i) => {
      if (!i) return setFase("no_disponible");
      setInfo(i);
      setFase(i.estado === "completado" ? "fin" : "bienvenida");
    });
  }, [token]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [mensajes, pensando]);

  const conectarModulo = useCallback(async () => {
    setFase("conectando");
    const sesion = await iniciarSesionCurso(token);
    if (!sesion.ok) return setFase("no_disponible");
    const s = sesion.data;
    setInfo(s);
    transcriptRef.current = [];
    setMensajes([]);

    if (s.modo === "avatar" && s.session_token) {
      try {
        const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
        const client = createClient(s.session_token);
        const anam = client as unknown as {
          stopStreaming?: () => Promise<void>;
          addListener: (ev: string, cb: (...args: any[]) => void) => void;
        };
        anamRef.current = anam;
        anam.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (historial: { role: string; content: string }[]) => {
          transcriptRef.current = historial.map((m) => ({
            rol: m.role === "persona" ? "assistant" : "user",
            texto: m.content,
          }));
          setMensajes(transcriptRef.current.slice(-4));
        });
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
    transcriptRef.current = [...transcriptRef.current, { rol: "user", texto: t }];
    setPensando(true);
    const turno = await turnoCurso(token, t);
    setPensando(false);
    if (!turno.ok) {
      setMensajes((m) => [...m, { rol: "assistant", texto: `No pude procesar tu respuesta: ${turno.error}` }]);
      return;
    }
    setMensajes((m) => [...m, { rol: "assistant", texto: turno.data.respuesta }]);
    transcriptRef.current = [...transcriptRef.current, { rol: "assistant", texto: turno.data.respuesta }];
  }, [texto, pensando, token]);

  const continuarModulo = useCallback(async () => {
    setFase("avanzando");
    try {
      await anamRef.current?.stopStreaming?.();
    } catch {}
    const r = await avanzarModulo(token, modo === "avatar" ? transcriptRef.current : undefined);
    if (!r.ok) {
      setFase("sala");
      return;
    }
    setInfo(r.data);
    if (r.data.estado === "completado") {
      setFase("fin");
      return;
    }
    await conectarModulo();
  }, [token, modo, conectarModulo]);

  const moduloActualInfo = info?.modulos.find((m) => m.orden === info.moduloActual);

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
              Esta capacitación no existe o ya no está activa. Verifica la liga que recibiste o contacta al equipo de RH.
            </p>
          </Card>
        )}

        {info && (fase === "bienvenida" || fase === "sala" || fase === "conectando" || fase === "avanzando") && (
          <ProgresoModulos info={info} />
        )}

        {fase === "bienvenida" && info && (
          <>
            <div className="mt-6 text-center">
              <Badge tone="good" dot>
                Capacitación · {info.empresa}
              </Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl">
                Hola {info.colaborador.split(" ")[0]}, bienvenido(a) a «{info.curso}»
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
                Vas a tomar este curso con <b className="text-ink">tu instructor virtual</b>
                {info.avatarDisponible ? " en video" : " por chat"}, un módulo a la vez. Al terminar cada módulo te va
                a hacer un par de preguntas para verificar que quedó claro.
              </p>
            </div>

            <Card className="mt-6 p-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-human" />
                <p className="text-sm leading-relaxed text-ink-2">
                  Esta sesión se registra para evaluar tu comprensión del curso — el equipo de RH puede revisar tu
                  avance y resultados.
                </p>
              </div>
              <Button className="mt-5 w-full" onClick={conectarModulo}>
                {info.avatarDisponible ? <Video className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                Entendido, comenzar
              </Button>
            </Card>
          </>
        )}

        {fase === "conectando" && (
          <div className="grid place-items-center gap-3 py-16 text-ink-2">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
            <p className="text-sm">Preparando tu módulo…</p>
          </div>
        )}

        {(fase === "sala" || fase === "avanzando") && info && (
          <Card className="mt-4 overflow-hidden">
            {modo === "avatar" ? (
              <div className="relative aspect-video bg-[#151517]">
                <video id="avatar-video" autoPlay playsInline className="h-full w-full object-cover" />
                <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 font-mono text-[11px] text-white/90 backdrop-blur">
                  <Sparkles className="h-3 w-3" /> Instructor · IA en video
                </span>
                <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
                  {mensajes.slice(-2).map((m, i) => (
                    <p key={i} className="text-[13px] leading-snug text-white/90">
                      <b>{m.rol === "assistant" ? "Instructor: " : "Tú: "}</b>
                      {m.texto}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div ref={chatRef} className="h-[24rem] space-y-3 overflow-y-auto p-5">
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
                          <Sparkles className="h-3 w-3" /> INSTRUCTOR
                        </span>
                      )}
                      {m.texto}
                    </div>
                  </div>
                ))}
                {pensando && (
                  <div className="flex items-center gap-2 text-ink-3">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                    <span className="text-xs italic">El instructor está escribiendo…</span>
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
                    disabled={fase === "avanzando"}
                    className="h-11 flex-1 rounded-xl border border-border-soft bg-surface px-4 text-sm outline-none transition focus:border-brand"
                  />
                  <Button size="sm" onClick={enviar} disabled={!texto.trim() || fase === "avanzando"}>
                    <Send className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button
                size="sm"
                onClick={continuarModulo}
                disabled={fase === "avanzando"}
                className={cn(modo === "avatar" && "ml-auto")}
              >
                {fase === "avanzando" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Continuar al siguiente módulo
              </Button>
            </div>

            <div className="flex items-center gap-2.5 border-t border-border-faint bg-human-soft/40 px-5 py-2.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-human" />
              <p className="text-[12px] text-ink-3">
                Módulo {info.moduloActual} de {info.totalModulos}
                {moduloActualInfo ? ` · ${moduloActualInfo.titulo}` : ""} — da clic en "Continuar" cuando tu
                instructor te lo indique.
              </p>
            </div>
          </Card>
        )}

        {fase === "fin" && info && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good/10">
              <CheckCircle2 className="h-7 w-7 text-good" />
            </span>
            <h1 className="font-display mt-4 text-2xl font-bold">¡Curso completado!</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
              Terminaste «{info.curso}». Tus resultados quedaron registrados y el equipo de RH puede revisarlos.
            </p>
            {info.resultadoEvaluacion && (
              <div className="mx-auto mt-6 max-w-md space-y-2 text-left">
                {info.resultadoEvaluacion.modulos.map((m) => (
                  <div key={m.modulo} className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface p-3">
                    {m.comprendio ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-good" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-warn" />
                    )}
                    <span className="text-sm">{m.titulo}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

function ProgresoModulos({ info }: { info: AsignacionPublica }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {info.modulos.map((m) => {
        const actual = m.orden === info.moduloActual && info.estado !== "completado";
        return (
          <span
            key={m.orden}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              m.completado
                ? "bg-good-soft text-good"
                : actual
                  ? "bg-brand-soft text-brand"
                  : "bg-surface-2 text-ink-3",
            )}
          >
            {m.completado ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : actual ? (
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            ) : (
              <Lock className="h-3 w-3" />
            )}
            {m.titulo}
          </span>
        );
      })}
    </div>
  );
}
