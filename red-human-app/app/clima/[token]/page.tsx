"use client";

/* Sala pública de la encuesta de clima (2026-09-23) — la liga que se comparte con colaboradores y, si la
   medición lo permite, con participantes externos. Sin sesión.

   Privacidad: si la medición es anónima se dice en grande y NO se pide identificación; el servidor además
   nunca guarda quién respondió (LFPDPPP). Si es identificada, la persona pone su código de colaborador o
   sus datos (solo cuando se aceptan externos) antes de enviar. */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, EyeOff, Loader2, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
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
  const [colaboradorId, setColaboradorId] = useState("");
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

  const contestadas = useMemo(
    () => Object.values(respuestas).filter((v) => v !== "" && v !== null && v !== undefined).length,
    [respuestas],
  );
  const inputCls = cn(
    "w-full rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20",
    totem ? "min-h-16 text-xl" : "h-11",
  );

  async function enviar() {
    if (!m) return;
    if (contestadas === 0) return setError("Contesta al menos una pregunta.");
    if (!m.anonima && !colaboradorId.trim() && !externoNombre.trim()) {
      return setError("Esta encuesta es identificada: pon tu código de colaborador o tu nombre.");
    }
    setOcupado(true);
    setError("");
    const r = await responderClimaPublica(token, { respuestas, colaboradorId, externoNombre, externoCorreo });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    setEstado("enviada");
  }

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
            <p className="mt-2 text-sm text-ink-2">Esta encuesta no existe o fue dada de baja. Pide una liga nueva a Recursos Humanos.</p>
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
              <p className="text-[13px] leading-relaxed text-ink-2 totem:text-lg">{m.aviso}</p>
            </Card>

            {!m.abierta && (
              <Card className="mt-4 border-warn/30 bg-warn-soft/30 p-4 text-sm text-warn">
                Esta encuesta todavía no está abierta (o ya se cerró). Si crees que es un error, avísale a Recursos Humanos.
              </Card>
            )}

            <div className="mt-5 flex flex-col gap-4">
              {m.preguntas.map((p, i) => (
                <Card key={p.id} className="p-5">
                  <p className="text-sm font-semibold text-ink totem:text-xl">
                    <span className="mr-1.5 font-mono text-[11px] text-ink-3 totem:text-base">{i + 1}.</span>{p.texto}
                  </p>

                  {p.tipo === "escala" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Array.from({ length: p.escala_max ?? 5 }, (_, k) => k + 1).map((n) => {
                        const activo = respuestas[p.id] === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setRespuestas({ ...respuestas, [p.id]: n })}
                            className={cn(
                              "grid place-items-center rounded-xl border font-bold transition active:scale-95",
                              totem ? "min-h-16 min-w-16 text-2xl" : "h-12 w-12 text-base",
                              activo ? "border-brand bg-brand text-white shadow-sm" : "border-border-soft bg-surface text-ink-2 hover:border-brand/40",
                            )}
                          >
                            {n}
                          </button>
                        );
                      })}
                      <span className="self-center text-[11px] text-ink-3 totem:text-base">1 = nada · {p.escala_max ?? 5} = totalmente</span>
                    </div>
                  )}

                  {p.tipo === "opcion" && (
                    <div className="mt-3 flex flex-col gap-2">
                      {(p.opciones ?? []).map((o) => {
                        const activo = respuestas[p.id] === o;
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setRespuestas({ ...respuestas, [p.id]: o })}
                            className={cn(
                              "rounded-xl border px-4 py-3 text-left text-sm transition active:scale-[0.99] totem:min-h-16 totem:text-xl",
                              activo ? "border-brand bg-brand-soft text-ink ring-2 ring-brand/30" : "border-border-soft bg-surface hover:border-brand/40",
                            )}
                          >
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {p.tipo === "abierta" && (
                    <textarea
                      value={String(respuestas[p.id] ?? "")}
                      onChange={(e) => setRespuestas({ ...respuestas, [p.id]: e.target.value })}
                      rows={3}
                      placeholder="Escribe lo que quieras compartir…"
                      className="mt-3 w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 totem:text-xl"
                    />
                  )}
                </Card>
              ))}
            </div>

            {!m.anonima && (
              <Card className="mt-4 p-5">
                <p className="text-sm font-semibold text-ink">¿Quién contesta?</p>
                <p className="mt-1 text-[12px] text-ink-3">Esta encuesta es identificada: tus respuestas quedan ligadas a ti.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-ink-2">Código de colaborador</span>
                    <input value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value.toUpperCase())} placeholder="COL-1234" className={inputCls} />
                  </label>
                  {m.permiteExternos && (
                    <>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-ink-2">O tu nombre (si no eres de la empresa)</span>
                        <input value={externoNombre} onChange={(e) => setExternoNombre(e.target.value)} placeholder="Nombre completo" className={inputCls} />
                      </label>
                      <label className="flex flex-col gap-1.5 sm:col-span-2">
                        <span className="text-xs font-medium text-ink-2">Correo (opcional)</span>
                        <input value={externoCorreo} onChange={(e) => setExternoCorreo(e.target.value)} type="email" placeholder="correo@empresa.com" className={inputCls} />
                      </label>
                    </>
                  )}
                </div>
              </Card>
            )}

            {error && <p className="mt-4 text-sm font-semibold text-bad">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-ink-3 totem:text-base">{contestadas} de {m.preguntas.length} contestadas</span>
              <Button className={cn("totem:min-h-16 totem:rounded-2xl totem:text-xl", !totem && "min-w-40")} onClick={enviar} disabled={ocupado || !m.abierta}>
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 totem:h-6 totem:w-6" />} Enviar respuestas
              </Button>
            </div>
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
