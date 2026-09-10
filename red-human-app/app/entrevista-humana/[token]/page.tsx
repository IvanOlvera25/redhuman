"use client";

/* Liga pública del entrevistador (Lote 3). Contraparte liviana de app/entrevista/[token] y
   app/capacitacion/[token]: ahí el token abre una sesión completa con el avatar; aquí no hay
   nada que conversar, es un solo formulario de un solo submit — sin avatar, sin SDK, sin
   consentimiento. */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Logo, Button, Card, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  fetchEntrevistaHumanaPublica,
  enviarEvaluacionEntrevistaHumana,
  type EntrevistaHumanaPublica,
} from "@/lib/api";
import type { ResultadoEntrevistaHumana, RecomendacionEntrevistaHumana } from "@/lib/data";

type Fase = "cargando" | "no_disponible" | "formulario" | "enviado";

export default function EvaluacionEntrevistaHumana() {
  const params = useParams();
  const token = String(params?.token ?? "");

  const [fase, setFase] = useState<Fase>("cargando");
  const [info, setInfo] = useState<EntrevistaHumanaPublica | null>(null);
  const [resultado, setResultado] = useState<ResultadoEntrevistaHumana | "">("");
  const [recomendacion, setRecomendacion] = useState<RecomendacionEntrevistaHumana | "">("");
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetchEntrevistaHumanaPublica(token).then((i) => {
      if (!i) return setFase("no_disponible");
      setInfo(i);
      setFase("formulario");
    });
  }, [token]);

  const comentarioObligatorio = resultado === "no_aprobado" || recomendacion === "segunda_entrevista";
  const listo = !!resultado && !!recomendacion && (!comentarioObligatorio || comentario.trim().length > 0);

  async function enviar() {
    if (!listo) return;
    setEnviando(true);
    setError("");
    const r = await enviarEvaluacionEntrevistaHumana(token, {
      resultado: resultado as ResultadoEntrevistaHumana,
      recomendacion: recomendacion as RecomendacionEntrevistaHumana,
      comentario,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setFase("enviado");
  }

  return (
    <main className="min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-10">
        {fase === "cargando" && (
          <div className="grid place-items-center py-24 text-ink-3">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {fase === "no_disponible" && (
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-bold">Liga no disponible</h1>
            <p className="mt-2 text-sm text-ink-2">
              Esta evaluación ya fue registrada o la liga no es válida. Si crees que es un error, contacta al equipo
              de RH.
            </p>
          </Card>
        )}

        {fase === "formulario" && info && (
          <>
            <div className="text-center">
              <Badge tone="brand" dot>
                Evaluación de entrevista
              </Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl">
                Tu entrevista con {info.candidato}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
                {info.puesto && `Para la vacante de ${info.puesto}. `}Ayúdanos a registrar tu evaluación — te toma
                menos de un minuto.
              </p>
            </div>

            <Card className="mt-6 p-6">
              <div className="flex flex-col gap-4">
                <div>
                  <span className="text-sm font-medium text-ink-2">Resultado</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setResultado("aprobado")}
                      className={`h-11 rounded-xl border text-sm font-medium transition ${
                        resultado === "aprobado" ? "border-good/25 bg-good-soft text-good" : "border-border-soft text-ink-2"
                      }`}
                    >
                      Aprobado
                    </button>
                    <button
                      type="button"
                      onClick={() => setResultado("no_aprobado")}
                      className={`h-11 rounded-xl border text-sm font-medium transition ${
                        resultado === "no_aprobado" ? "border-bad/25 bg-bad-soft text-bad" : "border-border-soft text-ink-2"
                      }`}
                    >
                      No aprobado
                    </button>
                  </div>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Recomendación</span>
                  <select
                    value={recomendacion}
                    onChange={(e) => setRecomendacion(e.target.value as RecomendacionEntrevistaHumana)}
                    className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  >
                    <option value="" disabled>
                      Selecciona una opción
                    </option>
                    <option value="avanzar">Avanzar</option>
                    <option value="no_avanzar">No avanzar</option>
                    <option value="segunda_entrevista">Segunda entrevista</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink-2">
                    Comentarios{" "}
                    {comentarioObligatorio ? (
                      <span className="text-bad">(obligatorio)</span>
                    ) : (
                      <span className="text-ink-3">(opcional)</span>
                    )}
                  </span>
                  <textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    rows={4}
                    className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>

                {error && <p className="text-sm text-bad">{error}</p>}

                <Button className="w-full" disabled={!listo || enviando} onClick={enviar}>
                  {enviando ? "Enviando…" : "Enviar evaluación"}
                </Button>
              </div>
            </Card>
          </>
        )}

        {fase === "enviado" && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good/10">
              <CheckCircle2 className="h-7 w-7 text-good" />
            </span>
            <h1 className="font-display mt-4 text-2xl font-bold">¡Gracias por tu evaluación!</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
              Tu evaluación quedó registrada. El equipo de RH la tomará en cuenta para el siguiente paso del proceso.
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}
