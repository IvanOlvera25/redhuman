"use client";

/* Liga limitada para la persona EXTERNA que registra el resultado de UNA evaluación (Demo Fraiche, spec §10):
   encargado de tienda, proveedor socioeconómico, médico o franquiciatario. Sin sesión: la liga es la credencial.
   El formulario cambia por `rol` (conclusión / dictamen / decisión, archivo, comentarios). Registrar un resultado
   NUNCA mueve al candidato de etapa: RH revisa y decide (human-in-the-loop). Sin consentimiento del candidato no
   se puede registrar nada. */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Info, Loader2, Lock, MapPin, UserRound, XCircle } from "lucide-react";
import { Badge, Button, Card, Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { FormReferencia } from "@/components/dashboard/evaluaciones/panel-evaluaciones";
import {
  REFERENCIA_VACIA,
  guardarReferenciasResponsable,
  type ReferenciaLaboral,
  fetchEvaluacionExternaPublica,
  marcarEvaluacionExternaNoRealizada,
  registrarResultadoEvaluacionExterna,
  type EvaluacionExternaPublica,
} from "@/lib/api";

type Fase = "cargando" | "no_disponible" | "formulario" | "enviado" | "no_realizada";
type Rol = EvaluacionExternaPublica["rol"];
type Tono = "good" | "warn" | "bad" | "neutral";

const inputCls = "rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

const BUENAS = ["favorable", "apto", "continuar"];
const MEDIAS = ["con_observaciones", "apto_condicionado"];
const MALAS = ["desfavorable", "no_recomendable", "no_continuar", "no_apto"];

// Color del botón de decisión según su valor
function tonoDe(valor: string): Tono {
  if (BUENAS.includes(valor)) return "good";
  if (MEDIAS.includes(valor)) return "warn";
  if (MALAS.includes(valor)) return "bad";
  return "neutral";
}

const claseTono: Record<Tono, string> = {
  good: "border-good/25 bg-good-soft text-good",
  warn: "border-warn/25 bg-warn-soft text-warn",
  bad: "border-bad/25 bg-bad-soft text-bad",
  neutral: "border-brand/25 bg-brand-soft text-brand",
};

// Título de la página según quién evalúa
function tituloPor(rol: Rol, d: EvaluacionExternaPublica) {
  switch (rol) {
    case "encargado": return `Entrevista con ${d.candidato}`;
    case "franquiciatario": return `Candidato presentado: ${d.candidato}`;
    case "socioeconomico": return `Estudio socioeconómico de ${d.candidato}`;
    case "medico": return `Dictamen médico de ${d.candidato}`;
    case "referencias": return `Referencias laborales de ${d.candidato}`;
    default: return `${d.evaluacion} · ${d.candidato}`;
  }
}

function etiquetaDecision(rol: Rol) {
  if (rol === "medico") return "Dictamen";
  if (rol === "franquiciatario") return "Decisión";
  return "Conclusión";
}

function fechaLarga(iso: string | null) {
  if (!iso) return "";
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return iso;
  return f.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });
}

export default function EvaluacionExterna() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [fase, setFase] = useState<Fase>("cargando");
  const [datos, setDatos] = useState<EvaluacionExternaPublica | null>(null);
  const [decision, setDecision] = useState("");
  const [comentarios, setComentarios] = useState("");
  const [resumen, setResumen] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<{ decisionTexto: string; estadoTexto: string; avisos: string[] } | null>(null);
  // Caja «No se realizó…»
  const [abrirNoRealizada, setAbrirNoRealizada] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [noRealizadaTexto, setNoRealizadaTexto] = useState("");

  useEffect(() => {
    fetchEvaluacionExternaPublica(token).then((d) => {
      if (!d) return setFase("no_disponible");
      setDatos(d);
      setFase("formulario");
    });
  }, [token]);

  const rol: Rol = datos?.rol ?? "externo";
  const bloqueado = !!datos && (datos.consentimientoPendiente || datos.cerrada);
  const esSocio = rol === "socioeconomico";
  const esMedico = rol === "medico";
  const tieneOpciones = (datos?.opciones.length ?? 0) > 0;

  // Requeridos: decisión (encargado/médico/franquiciatario); archivo o resumen (socioeconómico)
  const listo = esSocio
    ? !!archivo || resumen.trim().length > 0
    : rol === "externo"
      ? (tieneOpciones ? !!decision : comentarios.trim().length > 0)
      : !!decision;

  async function registrar() {
    if (!listo || bloqueado) return;
    setEnviando(true);
    setError("");
    const r = await registrarResultadoEvaluacionExterna(token, {
      decision: decision || undefined,
      comentarios: comentarios.trim() || undefined,
      resumen: esSocio ? resumen.trim() || undefined : undefined,
      archivo,
    });
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    setResultado({ decisionTexto: r.data.decisionTexto, estadoTexto: r.data.estadoTexto, avisos: r.data.avisos ?? [] });
    setFase("enviado");
  }

  async function noRealizada() {
    if (motivo.trim().length < 3) return;
    setEnviando(true);
    setError("");
    const r = await marcarEvaluacionExternaNoRealizada(token, motivo.trim());
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    setNoRealizadaTexto(r.data.estadoTexto);
    setFase("no_realizada");
  }

  return (
    <main className="sala-publica min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-10">
        {fase === "cargando" && (
          <div className="grid place-items-center py-24 text-ink-3"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}

        {fase === "no_disponible" && (
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-bold">Liga no disponible</h1>
            <p className="mt-2 text-sm text-ink-2">Esta liga no es válida o ya no está disponible. Si crees que es un error, contacta al equipo de RH.</p>
          </Card>
        )}

        {fase === "formulario" && datos && (
          <>
            {/* ===== Encabezado ===== */}
            <div className="text-center">
              <Badge tone="brand" dot>{datos.empresa || "Red Human"} · {datos.evaluacion}</Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl">{tituloPor(rol, datos)}</h1>
              <div className="mx-auto mt-3 flex max-w-md flex-col items-center gap-1 text-sm leading-relaxed text-ink-2">
                {datos.vacante && (
                  <p><ClipboardList className="mr-1 inline h-4 w-4 text-ink-3" />{datos.vacante}{datos.sucursal ? ` · ${datos.sucursal}` : ""}</p>
                )}
                {(datos.citaEn || datos.citaLugar) && (
                  <p>
                    <CalendarClock className="mr-1 inline h-4 w-4 text-ink-3" />
                    {datos.citaEn ? fechaLarga(datos.citaEn) : "Sin fecha"}
                    {datos.citaLugar ? ` · ${datos.citaLugar}` : ""}
                  </p>
                )}
                {datos.responsable && <p className="text-ink-3">Responsable: {datos.responsable}</p>}
              </div>
            </div>

            {datos.instrucciones && (
              <div className="mt-6 flex gap-3 rounded-xl border border-brand/25 bg-brand-soft/40 p-4 text-sm leading-relaxed text-ink-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <p className="whitespace-pre-line">{datos.instrucciones}</p>
              </div>
            )}

            {/* ===== Sobre el candidato (solo experiencia y ubicación) ===== */}
            {datos.resumenCandidato && (
              <Card className="mt-4 p-5">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-3"><UserRound className="h-4 w-4" /> Sobre el candidato</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-ink-3">Experiencia</dt>
                    <dd className="text-ink-2">{datos.resumenCandidato.experiencia || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Ubicación</dt>
                    <dd className="text-ink-2"><MapPin className="mr-1 inline h-3.5 w-3.5 text-ink-3" />{datos.resumenCandidato.ubicacion || "—"}</dd>
                  </div>
                </dl>
              </Card>
            )}

            {/* ===== Avisos de estado ===== */}
            {datos.consentimientoPendiente && (
              <div className="mt-4 flex gap-3 rounded-xl border border-warn/30 bg-warn-soft/40 p-4 text-sm text-ink-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <p>Todavía no hay consentimiento del candidato; RH lo gestiona. No es posible registrar el resultado.</p>
              </div>
            )}
            {datos.cerrada && !datos.consentimientoPendiente && (
              <div className="mt-4 flex gap-3 rounded-xl border border-border-soft bg-surface-2/60 p-4 text-sm text-ink-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                <p>Esta evaluación ya fue cerrada por RH.</p>
              </div>
            )}
            {datos.yaRegistrada && !datos.cerrada && !datos.consentimientoPendiente && (
              <div className="mt-4 flex gap-3 rounded-xl border border-good/30 bg-good-soft/40 p-4 text-sm text-ink-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                <p>Ya registraste un resultado ({datos.estadoTexto}). Puedes corregirlo; el anterior se conserva.</p>
              </div>
            )}

            {rol === "referencias" ? (
              <ReferenciasResponsable token={token} datos={datos} bloqueado={bloqueado} />
            ) : (
              <>
            {/* ===== Formulario ===== */}
            <Card className="mt-4 p-6">
              <fieldset disabled={bloqueado || enviando} className="flex flex-col gap-5">
                {tieneOpciones && (
                  <div>
                    <span className="text-sm font-medium text-ink-2">{etiquetaDecision(rol)}</span>
                    <div className={cn("mt-1.5 grid gap-2", datos.opciones.length === 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3")}>
                      {datos.opciones.map((o) => {
                        const activo = decision === o.valor;
                        return (
                          <button
                            key={o.valor}
                            type="button"
                            onClick={() => setDecision(o.valor)}
                            className={cn(
                              "min-h-11 rounded-xl border px-3 py-2 text-sm font-medium transition totem:min-h-16 totem:text-xl",
                              activo ? claseTono[tonoDe(o.valor)] : "border-border-soft text-ink-2 hover:border-brand/40",
                            )}
                          >
                            {o.texto}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {esSocio && (
                  <>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink-2">Estudio (PDF)</span>
                      <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-border-soft file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink-2">Conclusión y comentarios</span>
                      <textarea value={resumen} onChange={(e) => setResumen(e.target.value)} rows={5} className={inputCls} placeholder="Resultado del estudio, hallazgos y recomendación." />
                    </label>
                  </>
                )}

                {esMedico && (
                  <>
                    {datos.pideArchivo !== false && (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-ink-2">Dictamen (PDF o imagen) <span className="text-ink-3">(opcional)</span></span>
                        <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-border-soft file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink" />
                      </label>
                    )}
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink-2">Comentarios <span className="text-ink-3">(opcional)</span></span>
                      <textarea value={comentarios} onChange={(e) => setComentarios(e.target.value)} rows={4} className={inputCls} />
                    </label>
                    <p className="flex items-start gap-2 text-xs text-ink-3"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La información médica solo la verá el rol autorizado; se guarda cifrada.</p>
                  </>
                )}

                {!esSocio && !esMedico && (
                  <>
                    {datos.pideArchivo && (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-ink-2">Archivo <span className="text-ink-3">(opcional)</span></span>
                        <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-border-soft file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink" />
                      </label>
                    )}
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink-2">Comentarios {(tieneOpciones || rol !== "externo") && <span className="text-ink-3">(opcional)</span>}</span>
                      <textarea value={comentarios} onChange={(e) => setComentarios(e.target.value)} rows={4} className={inputCls} />
                    </label>
                  </>
                )}

                {error && <p className="text-sm font-semibold text-bad">{error}</p>}

                <Button size="lg" className="w-full totem:min-h-16 totem:text-xl" disabled={!listo || bloqueado || enviando} onClick={registrar}>
                  {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Registrar resultado
                </Button>
              </fieldset>

              {/* ===== No se realizó ===== */}
              {!bloqueado && (
                <div className="mt-4 border-t border-border-faint pt-4">
                  {!abrirNoRealizada ? (
                    <button type="button" onClick={() => setAbrirNoRealizada(true)} className="text-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                      No se realizó…
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2 rounded-xl border border-border-soft bg-surface-2/50 p-4">
                      <span className="text-sm font-medium text-ink-2">¿Por qué no se realizó?</span>
                      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className={inputCls} placeholder="Ej. el candidato no se presentó." />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setAbrirNoRealizada(false); setMotivo(""); }} disabled={enviando}>Cancelar</Button>
                        <Button variant="secondary" size="sm" onClick={noRealizada} disabled={enviando || motivo.trim().length < 3}>
                          <XCircle className="h-4 w-4" /> Marcar como no realizada
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
              </>
            )}
          </>
        )}

        {fase === "enviado" && resultado && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good/10">
              <CheckCircle2 className="h-7 w-7 text-good" />
            </span>
            <h1 className="font-display mt-4 text-2xl font-bold">Gracias.</h1>
            <p className="mt-2 text-sm font-semibold text-ink">
              Resultado registrado: {resultado.decisionTexto || "sin decisión"} · {resultado.estadoTexto}
            </p>
            {resultado.avisos.length > 0 && (
              <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-sm text-ink-2">
                {resultado.avisos.map((a, i) => (
                  <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {a}</li>
                ))}
              </ul>
            )}
            <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-ink-3">
              El equipo de RH revisa el resultado y decide el siguiente paso; este registro no mueve al candidato de etapa por sí solo.
            </p>
          </Card>
        )}

        {fase === "no_realizada" && (
          <Card className="p-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-warn/10">
              <XCircle className="h-7 w-7 text-warn" />
            </span>
            <h1 className="font-display mt-4 text-2xl font-bold">Registrado como no realizada</h1>
            <p className="mt-2 text-sm text-ink-2">{noRealizadaTexto ? `Estado: ${noRealizadaTexto}. ` : ""}El equipo de RH lo revisará y, si aplica, volverá a agendar.</p>
          </Card>
        )}
      </div>
    </main>
  );
}

/* 2026-10-02 (Fraiche §10): el responsable captura (si faltan) y VALIDA cada referencia. Capturar no es validar; si
   nadie contesta se marca «No contactada» (no es desfavorable). La conclusión final la registra RH. */
function ReferenciasResponsable({ token, datos, bloqueado }: { token: string; datos: EvaluacionExternaPublica; bloqueado: boolean }) {
  const [filas, setFilas] = useState<ReferenciaLaboral[]>(() =>
    datos.referencias && datos.referencias.length ? datos.referencias.map((r) => ({ ...REFERENCIA_VACIA, ...r })) : [{ ...REFERENCIA_VACIA }],
  );
  const [resumen, setResumen] = useState(datos.referenciasResumen ?? null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const cambiar = (i: number, p: Partial<ReferenciaLaboral>) => setFilas(filas.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <Card className="mt-4 p-6">
      {resumen && <p className="mb-3 text-sm font-semibold text-ink-2">{resumen.texto}</p>}
      <fieldset disabled={bloqueado || enviando} className="flex flex-col gap-4">
        {filas.map((f, i) => (
          <div key={i} className="rounded-2xl border border-border-soft bg-surface-2/40 p-4">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              Referencia {i + 1} {f.estadoTexto && <Badge tone={f.estado === "validada" ? "good" : f.estado === "por_contactar" ? "warn" : "neutral"}>{f.estadoTexto}</Badge>}
              {f.capturada_por === "candidato" && <span className="text-xs font-normal text-ink-3">datos capturados por el candidato</span>}
            </p>
            <FormReferencia f={f} cambiar={(p) => cambiar(i, p)} validar />
          </div>
        ))}
        <Button variant="outline" className="self-start" onClick={() => setFilas([...filas, { ...REFERENCIA_VACIA }])}>Agregar referencia</Button>
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
        {ok && <p className="text-sm font-semibold text-good">{ok}</p>}
        <Button
          size="lg"
          className="w-full totem:min-h-16 totem:text-xl"
          onClick={async () => {
            setEnviando(true);
            setError("");
            setOk("");
            const r = await guardarReferenciasResponsable(token, filas.filter((x) => x.empresa.trim() || x.contacto_nombre.trim()));
            setEnviando(false);
            if (!r.ok) return setError(r.error);
            setFilas(r.data.referencias.map((x) => ({ ...REFERENCIA_VACIA, ...x })));
            setResumen(r.data.resumen);
            setOk(r.data.resumen.completas ? "Referencias validadas. Se avisó a RH para registrar la conclusión." : "Guardado. Puedes volver a esta liga para completar la validación.");
          }}
        >
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Guardar referencias
        </Button>
      </fieldset>
    </Card>
  );
}
