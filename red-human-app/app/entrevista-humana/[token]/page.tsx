"use client";

/* Liga pública del entrevistador (Lote 3 · mejorada 2026-09-19). Primero el EXPEDIENTE completo del
   candidato (CV extraído y archivo, análisis de Luna, Entrevista Red Human, capacitación, documentos)
   para que el entrevistador vea el proceso antes de evaluar; abajo, el formulario de un solo envío
   (Resultado, Recomendación, Comentarios opcionales). Al enviar, la entrevista queda realizada y
   confirmada y se cierra el ciclo (autocierre en el backend).
   Fraiche (spec §8): si la ronda es IPV (`esIpv`), el formulario es la rúbrica por competencias (misma que
   Red Human): nivel Alto/Medio/Bajo/Sin evidencia + respuesta + evidencia, observaciones sin peso y vista
   previa con `calcularIpv`. La puntuación nunca mueve de etapa por sí sola. */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Award, Bot, Briefcase, CheckCircle2, ChevronDown, FileText, GraduationCap, Loader2, Sparkles, User } from "lucide-react";
import { Logo, Button, Card, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  calcularIpv,
  enviarEvaluacionEntrevistaHumana,
  fetchEntrevistaHumanaPublica,
  urlArchivoEntrevistaHumanaPublica,
  COMPETENCIAS_IPV,
  CONCLUSIONES_IPV,
  EQUIVALENCIAS_IPV_DEFAULT,
  NIVELES_IPV,
  OBSERVACIONES_IPV,
  type EntrevistaHumanaPublica,
} from "@/lib/api";
import type { CalculoIPV, NivelIPV, ResultadoEntrevistaHumana, RecomendacionEntrevistaHumana } from "@/lib/data";

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
  // Fraiche (spec §8): rúbrica IPV por competencia (clave → valor)
  const [nivelesIpv, setNivelesIpv] = useState<Record<string, NivelIPV>>({});
  const [respuestasIpv, setRespuestasIpv] = useState<Record<string, string>>({});
  const [evidenciasIpv, setEvidenciasIpv] = useState<Record<string, string>>({});
  const [observacionesIpv, setObservacionesIpv] = useState<Record<string, string>>({});
  const [resultadoIpvEnviado, setResultadoIpvEnviado] = useState<CalculoIPV | null>(null);

  useEffect(() => {
    fetchEntrevistaHumanaPublica(token).then((i) => {
      if (!i) return setFase("no_disponible");
      setInfo(i);
      setFase("formulario");
    });
  }, [token]);

  // 2026-09-19: la recomendación se propone sola desde el resultado (editable)
  useEffect(() => {
    if (resultado === "aprobado" && !recomendacion) setRecomendacion("avanzar");
    if (resultado === "no_aprobado" && (!recomendacion || recomendacion === "avanzar")) setRecomendacion("no_avanzar");
  }, [resultado]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rúbrica vigente (la manda el servidor; las constantes son el respaldo)
  const esIpv = !!info?.esIpv;
  const competencias = info?.rubricaIpv?.competencias ?? COMPETENCIAS_IPV;
  const observaciones = info?.rubricaIpv?.observaciones ?? OBSERVACIONES_IPV;
  const nivelesCatalogo = info?.rubricaIpv?.niveles ?? NIVELES_IPV;
  const equivalencias = info?.rubricaIpv?.equivalencias ?? EQUIVALENCIAS_IPV_DEFAULT;
  const conclusiones = info?.rubricaIpv?.conclusiones ?? CONCLUSIONES_IPV;
  const previaIpv = esIpv ? calcularIpv(nivelesIpv, equivalencias) : null;

  const listoIpv = competencias.every((c) => !!nivelesIpv[c.clave]);
  const listo = esIpv ? listoIpv : !!resultado && !!recomendacion;

  async function enviar() {
    if (!listo) return;
    setEnviando(true);
    setError("");
    const r = esIpv
      ? await enviarEvaluacionEntrevistaHumana(token, {
          rubrica: { niveles: nivelesIpv, respuestas: respuestasIpv, evidencias: evidenciasIpv, observaciones: observacionesIpv },
          comentario,
        })
      : await enviarEvaluacionEntrevistaHumana(token, {
          resultado: resultado as ResultadoEntrevistaHumana,
          recomendacion: recomendacion as RecomendacionEntrevistaHumana,
          comentario,
        });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResultadoIpvEnviado(r.data.resultadoIpv ?? null);
    setFase("enviado");
  }

  // Texto corto del resultado IPV (puntaje · conclusión, o revisión sin calificación)
  function textoIpv(c: CalculoIPV | null | undefined) {
    if (!c) return "";
    if (c.puntaje == null) return `Requiere revisión: sin evidencia en ${c.sin_evidencia.join(", ") || "alguna competencia"}`;
    return `${c.puntaje} / 100 · ${conclusiones[c.conclusion] || c.conclusion}`;
  }

  const exp = info?.expediente;

  return (
    <main className="min-h-svh bg-bg">
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
            <p className="mt-2 text-sm text-ink-2">La liga no es válida. Si crees que es un error, contacta al equipo de RH.</p>
          </Card>
        )}

        {fase === "formulario" && info && (
          <>
            <div className="text-center">
              <Badge tone="brand" dot>{info.expediente?.vacante.empresa || "Red Human"} · {esIpv ? "Entrevista IPV" : "Entrevista humana"}</Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl">Expediente de {info.candidato}</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
                {info.puesto && `Vacante: ${info.puesto}. `}
                {info.fecha ? `Entrevista el ${new Date(info.fecha).toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" })}. ` : ""}
                Revisa el proceso y registra tu evaluación al final.
              </p>
            </div>

            {/* ===== EXPEDIENTE ===== */}
            {exp && (
              <div className="mt-6 flex flex-col gap-3">
                <Seccion icono={User} titulo="Candidato y vacante" abierto>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <Dato k="Nombre" v={exp.candidato.nombre} />
                    <Dato k="Teléfono" v={exp.candidato.telefono || "—"} />
                    <Dato k="Correo" v={exp.candidato.correo || "—"} />
                    <Dato k="Etapa" v={exp.etapa || "—"} />
                    <Dato k="Vacante" v={exp.vacante.titulo} />
                    <Dato k="Afinidad de CV (Luna)" v={exp.score != null ? `${exp.score}/100` : "Sin CV analizado"} />
                  </dl>
                  {exp.vacante.requisitos && <p className="mt-3 text-xs leading-relaxed text-ink-3"><b className="text-ink-2">Requisitos:</b> {exp.vacante.requisitos}</p>}
                  {exp.vacante.perfilIdeal && <p className="mt-1 text-xs leading-relaxed text-ink-3"><b className="text-ink-2">Perfil ideal:</b> {exp.vacante.perfilIdeal}</p>}
                </Seccion>

                <Seccion icono={FileText} titulo="CV" abierto>
                  {exp.archivos.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {exp.archivos.map((a) => (
                        <a key={a.id} href={urlArchivoEntrevistaHumanaPublica(token, a.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-border-soft bg-surface px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand/40">
                          <FileText className="h-3.5 w-3.5" /> {a.tipo === "cv" ? "Abrir CV" : a.nombre || a.tipo}
                        </a>
                      ))}
                    </div>
                  )}
                  {exp.cv.resumen ? <p className="text-sm leading-relaxed text-ink-2">{exp.cv.resumen}</p> : <p className="text-sm text-ink-3">Sin datos extraídos del CV.</p>}
                  <Lista titulo="Habilidades" items={exp.cv.habilidades} />
                  <Lista titulo="Experiencia" items={exp.cv.experiencia.map((e) => (typeof e === "string" ? e : [e.puesto, e.empresa, e.periodo].filter(Boolean).join(" · ")))} />
                  <Lista titulo="Estudios" items={exp.cv.estudios} />
                  <Lista titulo="Idiomas" items={exp.cv.idiomas} />
                </Seccion>

                <Seccion icono={Sparkles} titulo="Análisis del CV (Luna)">
                  {exp.analisis.resumen && <p className="text-sm leading-relaxed text-ink-2">{exp.analisis.resumen}</p>}
                  <Lista titulo="Requisitos cumplidos" items={exp.analisis.requisitosCumplidos} tono="good" />
                  <Lista titulo="Brechas" items={exp.analisis.brechas} tono="warn" />
                  <Lista titulo="Fortalezas" items={exp.analisis.fortalezas} />
                  <Lista titulo="Alertas" items={exp.analisis.alertas} tono="bad" />
                  {!exp.analisis.resumen && !exp.analisis.requisitosCumplidos.length && !exp.analisis.brechas.length && <p className="text-sm text-ink-3">Sin análisis todavía.</p>}
                </Seccion>

                <Seccion icono={Bot} titulo="Entrevista Red Human (IA)" abierto={Boolean(exp.entrevistaIA)}>
                  {exp.entrevistaIA ? (
                    <>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {exp.entrevistaIA.matchPerfil != null && <Badge tone="brand">Afinidad {exp.entrevistaIA.matchPerfil}/100</Badge>}
                        {exp.entrevistaIA.recomendacion && (
                          <Badge tone={exp.entrevistaIA.recomendacion === "avanzar" ? "good" : exp.entrevistaIA.recomendacion === "no_avanzar" ? "bad" : "warn"}>
                            Recomendación IA: {exp.entrevistaIA.recomendacion.replace("_", " ")}
                          </Badge>
                        )}
                      </div>
                      {exp.entrevistaIA.resumen && <p className="text-sm leading-relaxed text-ink-2">{exp.entrevistaIA.resumen}</p>}
                      <Lista titulo="Fortalezas observadas" items={exp.entrevistaIA.fortalezas} tono="good" />
                      <Lista titulo="Puntos por validar en tu entrevista" items={exp.entrevistaIA.riesgos} tono="warn" />
                      <Lista titulo="No se cubrió" items={exp.entrevistaIA.faltante} tono="bad" />
                    </>
                  ) : (
                    <p className="text-sm text-ink-3">Sin Entrevista Red Human evaluada.</p>
                  )}
                </Seccion>

                {(exp.capacitacion.length > 0 || exp.documentos.length > 0) && (
                  <Seccion icono={GraduationCap} titulo="Capacitación y documentos">
                    {exp.capacitacion.map((k, i) => (
                      <p key={i} className="text-sm text-ink-2">
                        <Award className="mr-1 inline h-3.5 w-3.5 text-brand" /> {k.curso}: {k.aprobado ? "Aprobado" : "No aprobado"} ({k.calificacion}%)
                      </p>
                    ))}
                    {exp.documentos.length > 0 && (
                      <ul className="mt-2 grid gap-1 text-xs text-ink-2 sm:grid-cols-2">
                        {exp.documentos.map((d) => (
                          <li key={d.tipo} className="flex items-center gap-1.5">
                            {d.estado === "recibido" ? <CheckCircle2 className="h-3.5 w-3.5 text-good" /> : <AlertTriangle className="h-3.5 w-3.5 text-warn" />} {d.tipo} · {d.estado}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Seccion>
                )}
              </div>
            )}

            {/* ===== EVALUACIÓN ===== */}
            <Card className="mt-6 p-6">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-brand" />
                <h2 className="font-display text-lg font-bold">Tu evaluación</h2>
              </div>
              {info.yaEvaluada ? (
                <div className="mt-3 rounded-xl border border-good/30 bg-good-soft/40 p-4 text-sm text-ink-2">
                  <CheckCircle2 className="mr-1 inline h-4 w-4 text-good" /> Esta entrevista ya fue evaluada
                  {esIpv && info.resultadoIpv ? ` (IPV: ${textoIpv(info.resultadoIpv)})` : info.resultado ? ` (${info.resultado === "aprobado" ? "Aprobado" : "No aprobado"})` : ""}. Si necesitas corregirla, contacta al equipo de RH.
                </div>
              ) : esIpv ? (
                <div className="mt-4 flex flex-col gap-5">
                  <p className="text-sm leading-relaxed text-ink-2">
                    Entrevista IPV · misma rúbrica que Red Human. Pide un ejemplo concreto por competencia; si no hay evidencia, marca “Sin evidencia”.
                  </p>

                  {/* Competencias con peso */}
                  {competencias.map((c) => (
                    <div key={c.clave} className="rounded-xl border border-border-soft p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{c.nombre}</span>
                        <Badge tone="brand">{c.peso}%</Badge>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-3"><b className="text-ink-2">Situación para preguntar:</b> {c.situacion}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-3"><b className="text-ink-2">Evidencia esperada:</b> {c.evidencia}</p>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {nivelesCatalogo.map((n) => (
                          <button
                            key={n.clave}
                            type="button"
                            onClick={() => setNivelesIpv((v) => ({ ...v, [c.clave]: n.clave }))}
                            className={cn("h-11 rounded-xl border text-sm font-medium transition", nivelesIpv[c.clave] === n.clave ? claseNivel(n.clave) : "border-border-soft text-ink-2")}
                          >
                            {n.nombre}
                          </button>
                        ))}
                      </div>

                      <label className="mt-3 flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-ink-2">Respuesta del candidato</span>
                        <textarea
                          value={respuestasIpv[c.clave] ?? ""}
                          onChange={(e) => setRespuestasIpv((v) => ({ ...v, [c.clave]: e.target.value }))}
                          rows={2}
                          placeholder="Ejemplo concreto que dio el candidato"
                          className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                      </label>
                      <label className="mt-2 flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-ink-2">Evidencia observada</span>
                        <input
                          value={evidenciasIpv[c.clave] ?? ""}
                          onChange={(e) => setEvidenciasIpv((v) => ({ ...v, [c.clave]: e.target.value }))}
                          placeholder="Qué demostró (o por qué no hay evidencia)"
                          className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                      </label>
                    </div>
                  ))}

                  {/* Observaciones: sin peso ni porcentaje */}
                  <div className="rounded-xl border border-border-soft p-4">
                    <p className="text-sm font-semibold text-ink">Observaciones <span className="font-normal text-ink-3">· sin peso ni porcentaje</span></p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      {observaciones.map((o) => (
                        <label key={o.clave} className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium text-ink-2">{o.nombre}</span>
                          <input
                            value={observacionesIpv[o.clave] ?? ""}
                            onChange={(e) => setObservacionesIpv((v) => ({ ...v, [o.clave]: e.target.value }))}
                            className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Vista previa: mismo cálculo que el servidor */}
                  {previaIpv && (
                    <div className={cn("rounded-xl border p-4 text-sm", previaIpv.puntaje == null ? "border-warn/30 bg-warn-soft/40" : "border-brand/25 bg-brand-soft/40")}>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">Vista previa</p>
                      {previaIpv.puntaje == null ? (
                        <p className="mt-1 font-semibold text-ink">
                          <AlertTriangle className="mr-1 inline h-4 w-4 text-warn" />
                          Sin evidencia en: {previaIpv.sin_evidencia.join(", ")} — se pedirá revisión, sin calificación
                        </p>
                      ) : (
                        <p className="font-display mt-1 text-xl font-bold text-ink">{previaIpv.puntaje} / 100 · {conclusiones[previaIpv.conclusion] || previaIpv.conclusion}</p>
                      )}
                      <p className="mt-1 text-xs text-ink-3">80–100 Recomendable · 60–79 Bajo reserva · menos de 60 No recomendable</p>
                      <ul className="mt-2 grid gap-0.5 text-xs text-ink-2 sm:grid-cols-2">
                        {previaIpv.detalle.map((d) => (
                          <li key={d.clave}>
                            {d.nombre} · {nombreNivel(d.nivel, nivelesCatalogo)} · {d.puntos == null ? "—" : `${d.puntos} pts`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Comentarios <span className="text-ink-3">(opcional)</span></span>
                    <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={4} className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
                  </label>

                  {error && <p className="text-sm text-bad">{error}</p>}

                  <Button className="w-full" disabled={!listo || enviando} onClick={enviar}>
                    {enviando ? "Guardando…" : "Guardar evaluación IPV"}
                  </Button>
                  {!listoIpv && <p className="text-center text-xs text-ink-3">Marca un nivel en las {competencias.length} competencias para guardar.</p>}
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  <div>
                    <span className="text-sm font-medium text-ink-2">Resultado</span>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setResultado("aprobado")} className={cn("h-11 rounded-xl border text-sm font-medium transition", resultado === "aprobado" ? "border-good/25 bg-good-soft text-good" : "border-border-soft text-ink-2")}>
                        Aprobado
                      </button>
                      <button type="button" onClick={() => setResultado("no_aprobado")} className={cn("h-11 rounded-xl border text-sm font-medium transition", resultado === "no_aprobado" ? "border-bad/25 bg-bad-soft text-bad" : "border-border-soft text-ink-2")}>
                        Rechazado
                      </button>
                    </div>
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Recomendación</span>
                    <select value={recomendacion} onChange={(e) => setRecomendacion(e.target.value as RecomendacionEntrevistaHumana)} className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
                      <option value="" disabled>Selecciona una opción</option>
                      <option value="avanzar">Avanzar</option>
                      <option value="no_avanzar">No avanzar</option>
                      <option value="segunda_entrevista">Segunda entrevista</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Comentarios <span className="text-ink-3">(opcional)</span></span>
                    <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={4} className="rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
                  </label>

                  {error && <p className="text-sm text-bad">{error}</p>}

                  <Button className="w-full" disabled={!listo || enviando} onClick={enviar}>
                    {enviando ? "Guardando…" : "Guardar evaluación"}
                  </Button>
                </div>
              )}
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
              La entrevista quedó confirmada como realizada y tu evaluación registrada. El equipo de RH ya fue notificado y tomará la decisión final.
            </p>
            {esIpv && (
              <>
                {resultadoIpvEnviado && (
                  <p className={cn("mx-auto mt-4 inline-block rounded-xl border px-4 py-2 text-sm font-semibold", resultadoIpvEnviado.puntaje == null ? "border-warn/30 bg-warn-soft/40 text-ink" : "border-brand/25 bg-brand-soft/40 text-ink")}>
                    {textoIpv(resultadoIpvEnviado)}
                  </p>
                )}
                <p className="mx-auto mt-3 max-w-md text-xs text-ink-3">La decisión final la toma RH; ninguna puntuación mueve de etapa por sí sola.</p>
              </>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

function Seccion({ icono: Icono, titulo, abierto = false, children }: { icono: typeof User; titulo: string; abierto?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(abierto);
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Icono className="h-4 w-4 text-brand" /> {titulo}</span>
        <ChevronDown className={cn("h-4 w-4 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border-faint px-5 py-4">{children}</div>}
    </Card>
  );
}

// Fraiche (spec §8): tono del botón de nivel seleccionado (alto=good, medio=warn, bajo=bad, sin evidencia=neutral)
function claseNivel(n: NivelIPV) {
  if (n === "alto") return "border-good/25 bg-good-soft text-good";
  if (n === "medio") return "border-warn/25 bg-warn-soft text-warn";
  if (n === "bajo") return "border-bad/25 bg-bad-soft text-bad";
  return "border-ink-3 bg-surface-2 text-ink";
}

function nombreNivel(n: NivelIPV, catalogo: { clave: NivelIPV; nombre: string }[]) {
  return catalogo.find((x) => x.clave === n)?.nombre ?? n;
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}

function Lista({ titulo, items, tono }: { titulo: string; items: string[]; tono?: "good" | "warn" | "bad" }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <p className={cn("font-mono text-[10px] font-bold uppercase tracking-wider", tono === "good" ? "text-good" : tono === "warn" ? "text-warn" : tono === "bad" ? "text-bad" : "text-ink-3")}>{titulo}</p>
      <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
        {items.slice(0, 12).map((x, i) => <li key={i}>• {x}</li>)}
      </ul>
    </div>
  );
}
