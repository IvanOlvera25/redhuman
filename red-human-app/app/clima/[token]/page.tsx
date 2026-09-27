"use client";

/* Sala pública de la encuesta de clima — Clima v2 (2026-09-27). Sin sesión.

   Dos tipos de liga (los resuelve el servidor):
   · PERSONAL — la que recibe cada colaborador invitado: responde una sola vez y no se le pide nada más.
     Si la encuesta es anónima, el servidor solo marca «ya respondió» en una tabla aparte y la respuesta NO
     guarda quién la dio (ni la hora, solo el día).
   · EXTERNA — la liga compartida para personas fuera de la empresa (solo si la encuesta la acepta): sus
     respuestas se reportan aparte y no suman a la participación; en una encuesta identificada se pide
     nombre (y correo opcional).
   Compatible con Modo Tótem (`?totem=1`). */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, EyeOff, Loader2, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { FormularioRespuestas, contarContestadas } from "@/components/clima/formulario-respuestas";
import { useTotem } from "@/lib/use-totem";
import { cn } from "@/lib/utils";
import { fetchMedicionPublica, responderClimaPublica, type MedicionClimaPublica } from "@/lib/api";

export default function SalaClima() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const totem = useTotem();
  const [m, setM] = useState<MedicionClimaPublica | null>(null);
  const [estado, setEstado] = useState<"cargando" | "no_disponible" | "formulario" | "enviada">("cargando");
  const [respuestas, setRespuestas] = useState<Record<string, unknown>>({});
  const [externoNombre, setExternoNombre] = useState("");
  const [externoCorreo, setExternoCorreo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchMedicionPublica(token).then((d) => {
      if (!d) return setEstado("no_disponible");
      setM(d);
      setEstado("formulario");
    });
  }, [token]);

  const contestadas = contarContestadas(respuestas);
  const pideNombre = Boolean(m && m.tipoLiga === "externa" && !m.anonima);
  const inputCls = cn(
    "w-full rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20",
    totem ? "min-h-16 text-xl" : "h-11",
  );

  async function enviar() {
    if (!m) return;
    if (contestadas === 0) return setError("Contesta al menos una pregunta.");
    if (pideNombre && !externoNombre.trim()) return setError("Esta encuesta es identificada: escribe tu nombre.");
    setOcupado(true);
    setError("");
    const r = await responderClimaPublica(token, { respuestas, externoNombre, externoCorreo });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    setEstado("enviada");
  }

  const motivoCerrado = !m
    ? ""
    : m.yaRespondio
      ? "Ya respondiste esta encuesta. ¡Gracias por tu tiempo!"
      : !m.abierta
        ? "Esta encuesta no está recibiendo respuestas (todavía no abre o ya cerró)."
        : !m.aceptaRespuestas
          ? "Esta encuesta es solo para colaboradores invitados: usa la liga personal que te llegó por correo o WhatsApp."
          : "";

  return (
    <main className={cn("sala-publica min-h-svh bg-bg", totem && "totem")}>
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 totem:max-w-none totem:px-10 totem:py-6">
          <Logo size={totem ? "lg" : "md"} />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10 totem:max-w-none totem:px-10">
        {estado === "cargando" && <div className="grid place-items-center py-24 text-ink-3"><Loader2 className="h-6 w-6 animate-spin" /></div>}

        {estado === "no_disponible" && (
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-bold">Liga no disponible</h1>
            <p className="mt-2 text-sm text-ink-2">Esta encuesta no existe o la liga fue dada de baja. Pide una liga nueva a Recursos Humanos.</p>
          </Card>
        )}

        {m && estado === "formulario" && (
          <>
            <div className="text-center">
              <Badge tone={m.anonima ? "good" : "brand"} dot>{m.anonima ? "Respuestas anónimas" : "Encuesta identificada"}</Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl totem:text-4xl">{m.titulo}</h1>
              {m.descripcion && <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-2 totem:text-xl">{m.descripcion}</p>}
            </div>

            <Card className={cn("mt-5 flex items-start gap-3 p-4", m.anonima ? "border-good/30 bg-good-soft/30" : "border-brand/25 bg-brand-soft/30")}>
              {m.anonima ? <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-good" /> : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />}
              <p className="text-[13px] leading-relaxed text-ink-2 totem:text-lg">
                {m.aviso}
                {m.anonima && m.tipoLiga === "personal" && " Solo registramos que ya contestaste, para no enviarte recordatorios."}
              </p>
            </Card>

            {motivoCerrado ? (
              <Card className="mt-4 border-warn/30 bg-warn-soft/30 p-5 text-sm text-warn totem:text-xl">{motivoCerrado}</Card>
            ) : (
              <>
                <div className="mt-5">
                  <FormularioRespuestas preguntas={m.preguntas} respuestas={respuestas} onCambio={setRespuestas} totem={totem} />
                </div>

                {pideNombre && (
                  <Card className="mt-4 p-5">
                    <p className="text-sm font-semibold text-ink totem:text-xl">¿Quién contesta?</p>
                    <p className="mt-1 text-[12px] text-ink-3 totem:text-base">Esta encuesta es identificada: tus respuestas quedan ligadas a tu nombre.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-ink-2">Nombre completo</span>
                        <input value={externoNombre} onChange={(e) => setExternoNombre(e.target.value)} className={inputCls} />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-ink-2">Correo (opcional)</span>
                        <input value={externoCorreo} onChange={(e) => setExternoCorreo(e.target.value)} type="email" className={inputCls} />
                      </label>
                    </div>
                  </Card>
                )}

                {error && <p className="mt-4 text-sm font-semibold text-bad">{error}</p>}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-3 totem:text-base">{contestadas} de {m.preguntas.length} contestadas</span>
                  <Button className={cn("totem:min-h-16 totem:rounded-2xl totem:text-xl", !totem && "min-w-40")} onClick={enviar} disabled={ocupado}>
                    {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 totem:h-6 totem:w-6" />} Enviar respuestas
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {estado === "enviada" && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-good-soft text-good"><CheckCircle2 className="h-8 w-8" /></span>
            <h1 className="font-display mt-4 text-2xl font-bold totem:text-4xl">¡Gracias por contestar!</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2 totem:text-xl">
              {m?.anonima
                ? "Tus respuestas se guardaron de forma anónima: nadie puede saber que fueron tuyas."
                : "Tus respuestas quedaron registradas. Recursos Humanos les dará seguimiento."}
            </p>
            <p className="mt-4 text-xs text-ink-3">Ya puedes cerrar esta ventana.</p>
          </Card>
        )}
      </div>
    </main>
  );
}
