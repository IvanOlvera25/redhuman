"use client";

/* Evaluaciones y verificaciones del candidato (2026-09-28). Se agregan desde el menú «…» de la ficha
   («Agregar evaluación o verificación») y NUNCA mueven la columna del pipeline. Consentimientos antes de enviar:
   sin ellos → «En espera de consentimiento». Estudio médico: liga de consentimiento expreso por escrito; el informe
   completo solo lo ve quien tiene permiso (el resto, estado y dictamen). Sin proveedores todavía: el modo Integrada
   se avanza a mano («Simular siguiente paso»).
   Fraiche (spec §9-10): cada evaluación tiene responsable (usuario / contacto del Cliente / otra persona), cita,
   liga limitada para la persona externa, adjuntos, decisión y origen del resultado; el estado del spec
   (`estadoFraiche`) es el principal y el interno queda como texto secundario. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban, CalendarClock, CheckCircle2, ClipboardCheck, Copy, Eye, FileUp, Link2, Loader2, Lock, Plus, RefreshCw, Send, SkipForward,
  Stethoscope, Trash2, UserCog, Users, XCircle,
} from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { CampoRH, ModalMarco, inputRH } from "@/components/dashboard/modulos-rh";
import {
  CAMPOS_EVALUATEST, NOMBRE_EVALUACION_ENCARGADO, NOMBRE_EVALUACION_FRANQUICIATARIO, TIPOS_EVALUACION,
  agregarEvaluacionCandidato, avanzarEvaluacionIntegrada, cancelarEvaluacion, cargarResultadoEvaluacion, editarEvaluacion,
  enviarEvaluacion, enviarLigaConsentimientoMedico, fetchDetalleMedico, fetchEntrevistadores, fetchEvaluacionesCandidato,
  fetchPruebasPsicometricas, guardarReferenciasEvaluacion, ligaExternaEvaluacion, lineasResultados, marcarEvaluacionRealizada,
  revisarEvaluacion, sincronizarEvaluacion, urlAdjuntoEvaluacion, urlInformeEvaluacion,
  type Entrevistador, type EvaluacionCandidato, type EvaluatestResultado, type ModoPrueba, type PruebaPsicometrica,
  type ReferenciaLaboral, type ResponsableEvaluacion, type TipoEvaluacion,
} from "@/lib/api";
import { cn } from "@/lib/utils";

import { CANAL } from "@/lib/canal";
const PASOS: Record<string, string> = { asignada: "Asignada", enviada: "Enviada", iniciada: "Iniciada", completada: "Completada", resultado_recibido: "Resultado recibido" };
const ORIGEN_TEXTO: Record<string, string> = {
  liga_externa: "Por liga externa",
  liga_proveedor_reporte_anonimizado: "Reporte anonimizado del proveedor (liga)",
  manual: "Manual",
  webhook: "Webhook",
};
const RESULTADOS_REFERENCIA: { valor: ReferenciaLaboral["resultado"]; texto: string }[] = [
  { valor: "", texto: "Sin verificar" },
  { valor: "favorable", texto: "Favorable" },
  { valor: "con_observaciones", texto: "Con observaciones" },
  { valor: "desfavorable", texto: "Desfavorable" },
  { valor: "sin_respuesta", texto: "Sin respuesta" },
];
const textareaRH = "w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

/** Contacto del Cliente de la vacante (lo pasa la ficha; sin él se oculta esa opción). */
export interface ContactoEvaluacion { id: number; nombreCompleto: string; correo: string; telefono: string }

function fechaHora(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}
/** ISO → valor de un <input type="datetime-local"> en hora local. */
function aDatetimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function etiquetaDecision(e: EvaluacionCandidato) {
  return e.tipo === "medico" ? "Dictamen" : e.esFranquiciatario ? "Decisión" : "Conclusión";
}
function tonoDictamen(e: EvaluacionCandidato): "good" | "warn" | "bad" {
  return e.dictamen === "desfavorable" || e.dictamen === "no_apto" || e.dictamen === "no_recomendable" || e.dictamen === "no_continuar"
    ? "bad"
    : e.dictamen === "con_observaciones" || e.dictamen === "apto_con_restricciones" || e.dictamen === "apto_condicionado"
      ? "warn"
      : "good";
}
function tonoEstado(e: EvaluacionCandidato): "good" | "warn" | "bad" | "neutral" | "brand" {
  if (e.estado === "revisada") return tonoDictamen(e);
  if (e.estadoFraiche === "realizada_pendiente") return "warn";
  if (e.estadoFraiche === "con_resultado") return "brand";
  return "neutral";
}
function cerrada(e: EvaluacionCandidato) {
  return e.estado === "revisada" || e.estado === "fallida" || e.estadoFraiche === "no_realizada" || e.estadoFraiche === "cancelada";
}
function referenciasVerificadas(refs: ReferenciaLaboral[] | null | undefined) {
  return (refs ?? []).filter((r) => r.resultado && r.resultado !== "sin_respuesta").length;
}

/* ---------- Responsable / cita (bloque compartido por Agregar y Editar) ---------- */
type ModoResponsable = "usuario" | "contacto" | "otro";
interface FormResponsable { modo: ModoResponsable; usuarioId: string; contactoId: string; nombre: string; correo: string; whatsapp: string; cita: string; lugar: string }

function formResponsableDesde(e?: EvaluacionCandidato, contactos?: ContactoEvaluacion[]): FormResponsable {
  const modo: ModoResponsable = e?.responsableUsuarioId ? "usuario" : e?.responsableContactoId && contactos?.length ? "contacto" : "otro";
  return {
    modo,
    usuarioId: e?.responsableUsuarioId ? String(e.responsableUsuarioId) : "",
    contactoId: e?.responsableContactoId ? String(e.responsableContactoId) : "",
    nombre: modo === "otro" ? (e?.responsable ?? "") : "",
    correo: modo === "otro" ? (e?.responsableCorreo ?? "") : "",
    whatsapp: modo === "otro" ? (e?.responsableWhatsapp ?? "") : "",
    cita: aDatetimeLocal(e?.citaEn),
    lugar: e?.citaLugar ?? "",
  };
}
function responsableDesdeForm(f: FormResponsable): ResponsableEvaluacion | undefined {
  if (f.modo === "usuario") return f.usuarioId ? { usuario_id: Number(f.usuarioId) } : undefined;
  if (f.modo === "contacto") return f.contactoId ? { contacto_id: Number(f.contactoId) } : undefined;
  if (!f.nombre.trim() && !f.correo.trim() && !f.whatsapp.trim()) return undefined;
  return { nombre: f.nombre.trim(), correo: f.correo.trim(), whatsapp: f.whatsapp.trim() };
}

function BloqueResponsable({ f, onChange, contactos, clienteNombre }: {
  f: FormResponsable; onChange: (f: FormResponsable) => void; contactos?: ContactoEvaluacion[]; clienteNombre?: string;
}) {
  const [usuarios, setUsuarios] = useState<Entrevistador[] | null>(null);
  useEffect(() => {
    if (f.modo === "usuario" && usuarios === null) fetchEntrevistadores().then((u) => setUsuarios(u ?? []));
  }, [f.modo, usuarios]);
  const set = (p: Partial<FormResponsable>) => onChange({ ...f, ...p });
  const modos: { valor: ModoResponsable; texto: string }[] = [
    { valor: "usuario", texto: "Usuario de la Cuenta" },
    ...(contactos && contactos.length > 0 ? [{ valor: "contacto" as const, texto: clienteNombre ? `Contacto de ${clienteNombre}` : "Contacto del Cliente" }] : []),
    { valor: "otro", texto: "Otra persona" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Responsable de la evaluación</p>
        <div className="flex flex-wrap gap-1.5">
          {modos.map((m) => (
            <button key={m.valor} type="button" onClick={() => set({ modo: m.valor })}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", f.modo === m.valor ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/50")}>
              {m.texto}
            </button>
          ))}
        </div>
      </div>
      {f.modo === "usuario" && (
        <CampoRH label="Usuario">
          {usuarios === null ? <Loader2 className="h-5 w-5 animate-spin text-ink-3" /> : (
            <select value={f.usuarioId} onChange={(x) => set({ usuarioId: x.target.value })} className={inputRH}>
              <option value="">Elige a la persona…</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.correo ? ` · ${u.correo}` : ""}</option>)}
            </select>
          )}
        </CampoRH>
      )}
      {f.modo === "contacto" && contactos && (
        <CampoRH label="Contacto">
          <select value={f.contactoId} onChange={(x) => set({ contactoId: x.target.value })} className={inputRH}>
            <option value="">Elige al contacto…</option>
            {contactos.map((c) => <option key={c.id} value={c.id}>{c.nombreCompleto}{c.correo ? ` · ${c.correo}` : ""}</option>)}
          </select>
        </CampoRH>
      )}
      {f.modo === "otro" && (
        <>
          <CampoRH label="Nombre"><input value={f.nombre} onChange={(x) => set({ nombre: x.target.value })} className={inputRH} /></CampoRH>
          <CampoRH label="Correo"><input type="email" value={f.correo} onChange={(x) => set({ correo: x.target.value })} className={inputRH} /></CampoRH>
          <CampoRH label={CANAL}><input value={f.whatsapp} onChange={(x) => set({ whatsapp: x.target.value })} className={inputRH} placeholder="10 dígitos" /></CampoRH>
        </>
      )}
      <CampoRH label="Cita (fecha y hora)"><input type="datetime-local" value={f.cita} onChange={(x) => set({ cita: x.target.value })} className={inputRH} /></CampoRH>
      <CampoRH label="Lugar"><input value={f.lugar} onChange={(x) => set({ lugar: x.target.value })} className={inputRH} placeholder="Sucursal, consultorio, videollamada…" /></CampoRH>
    </div>
  );
}

/* ---------- Panel ---------- */
export function PanelEvaluaciones({ codigo, puesto, live, version, contactos, clienteNombre }: {
  codigo: string; puesto?: string; live: boolean; version?: number; contactos?: ContactoEvaluacion[]; clienteNombre?: string;
}) {
  const [lista, setLista] = useState<EvaluacionCandidato[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [resultado, setResultado] = useState<EvaluacionCandidato | null>(null);
  const [revisar, setRevisar] = useState<EvaluacionCandidato | null>(null);
  const [cancelar, setCancelar] = useState<EvaluacionCandidato | null>(null);
  const [responsable, setResponsable] = useState<EvaluacionCandidato | null>(null);
  const [referencias, setReferencias] = useState<EvaluacionCandidato | null>(null);
  const [detalleMedico, setDetalleMedico] = useState<EvaluacionCandidato | null>(null);
  const [agregar, setAgregar] = useState(false);
  /* Resultado del último envío de liga externa (líneas por canal + liga para copiar). */
  const [envioLiga, setEnvioLiga] = useState<{ id: string; liga: string; lineas: { ok: boolean; texto: string }[] } | null>(null);

  const cargar = useCallback(async () => setLista((await fetchEvaluacionesCandidato(codigo)) ?? []), [codigo]);
  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  async function accion(id: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, ok = "") {
    setOcupado(id);
    setError("");
    setAviso("");
    const r = await fn();
    setOcupado("");
    if (!r.ok) return setError(r.error);
    if (ok) setAviso(ok);
    void cargar();
  }
  function copiar(texto: string, mensaje: string) {
    void navigator.clipboard?.writeText(texto);
    setAviso(mensaje);
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Eyebrow>Evaluaciones y verificaciones</Eyebrow>
          <p className="mt-1 text-[12px] text-ink-3">Psicométricas, técnicas, referencias, médico y socioeconómico. No mueven la columna del pipeline.</p>
        </div>
        {live && <Button size="sm" variant="outline" onClick={() => setAgregar(true)}><ClipboardCheck className="h-4 w-4" /> Agregar</Button>}
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      {aviso && <p className="mt-3 text-sm text-good">{aviso}</p>}
      <div className="mt-3">
        {lista === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
        ) : lista.length === 0 ? (
          <p className="text-sm text-ink-3">Sin evaluaciones asignadas. Agrégalas desde el menú «…» de la ficha.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((e) => (
              <li key={e.id} className="rounded-xl border border-border-soft bg-surface px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {e.tipo === "medico" && <Stethoscope className="h-3.5 w-3.5 text-ink-3" />} {e.nombre}
                      <span className="font-normal text-ink-3">· {e.tipoTexto} · {e.modoTexto}</span>
                    </p>
                    <p className="truncate text-[11px] text-ink-3">
                      {e.estadoTexto}
                      {e.pasoIntegrada ? ` · Integrada: ${PASOS[e.pasoIntegrada] ?? e.pasoIntegrada}` : ""}
                      {e.resultadoCargadoPor ? ` · Resultado cargado por ${e.resultadoCargadoPor}` : ""}
                      {e.revisadaPor ? ` · revisada por ${e.revisadaPor}` : ""}
                      {e.estado === "fallida" && e.motivoFallida ? ` · Motivo: ${e.motivoFallida}` : ""}
                    </p>
                  </div>
                  <Badge tone={tonoEstado(e)}>{e.estado === "revisada" && e.dictamenTexto ? `Revisada · ${e.dictamenTexto}` : e.estadoFraicheTexto}</Badge>
                  {live && e.estado === "pendiente" && (
                    <Button size="sm" variant="outline" disabled={Boolean(ocupado)} onClick={() => accion(e.id, () => enviarEvaluacion(e.id), `«${e.nombre}» enviada.`)}>
                      {ocupado === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
                    </Button>
                  )}
                  {live && e.estado === "en_proceso" && e.conectadaProveedor && (
                    <Button size="sm" variant="outline" disabled={Boolean(ocupado)} title="Pregunta a Psicométricas.mx si ya terminó (por si su aviso no llegó)"
                      onClick={() => accion(e.id, async () => {
                        const r = await sincronizarEvaluacion(e.id);
                        if (r.ok) setAviso(r.data.sincronizacion === "resultado_recibido" ? "Resultado recibido de Psicométricas.mx." : "El candidato aún no termina sus pruebas.");
                        return r;
                      })}>
                      {ocupado === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Consultar resultado
                    </Button>
                  )}
                  {live && e.estado === "en_proceso" && e.modo === "integrada" && e.siguientePaso && !e.conectadaProveedor && (
                    <Button size="sm" variant="outline" disabled={Boolean(ocupado)} title="Sin proveedor conectado todavía: el paso se registra a mano"
                      onClick={() => accion(e.id, () => avanzarEvaluacionIntegrada(e.id))}>
                      <SkipForward className="h-4 w-4" /> Simular: {PASOS[e.siguientePaso]}
                    </Button>
                  )}
                  {live && e.estado === "resultado_recibido" && (
                    <Button size="sm" onClick={() => setRevisar(e)}><CheckCircle2 className="h-4 w-4" /> Revisar</Button>
                  )}
                  {live && (
                    <MenuAcciones
                      acciones={[
                        ...((e.estado === "pendiente" || e.estado === "en_proceso" || e.estadoFraiche === "realizada_pendiente") && !cerrada(e) && !(e.tipo === "medico" && e.informeRestringido)
                          ? [{ etiqueta: "Adjuntar resultado / informe…", icono: <FileUp className="h-4 w-4" />, onClick: () => setResultado(e) }]
                          : []),
                        ...(!cerrada(e)
                          ? [{ etiqueta: "Enviar liga a la persona externa", icono: <Link2 className="h-4 w-4" />, onClick: () => accion(e.id, async () => {
                              const r = await ligaExternaEvaluacion(e.id, { enviar: true });
                              if (r.ok) setEnvioLiga({ id: e.id, liga: r.data.liga, lineas: lineasResultados(r.data.resultados) });
                              return r;
                            }) }]
                          : []),
                        ...(e.ligaExterna
                          ? [{ etiqueta: "Copiar liga", icono: <Copy className="h-4 w-4" />, onClick: () => copiar(e.ligaExterna!, "Liga de la persona externa copiada.") }]
                          : []),
                        ...(e.estadoFraiche === "pendiente" && !cerrada(e)
                          ? [{ etiqueta: "Marcar realizada (resultado pendiente)", icono: <CheckCircle2 className="h-4 w-4" />, onClick: () => accion(e.id, () => marcarEvaluacionRealizada(e.id), `«${e.nombre}» marcada como realizada; falta el resultado.`) }]
                          : []),
                        ...(!cerrada(e)
                          ? [{ etiqueta: "Editar responsable / cita", icono: <UserCog className="h-4 w-4" />, onClick: () => setResponsable(e) }]
                          : []),
                        ...(e.tipo === "referencias"
                          ? [{ etiqueta: "Referencias laborales…", icono: <Users className="h-4 w-4" />, onClick: () => setReferencias(e) }]
                          : []),
                        ...(e.estado === "en_espera_consentimiento" && e.ligaConsentimiento
                          ? [
                              { etiqueta: "Enviar liga de consentimiento", icono: <Send className="h-4 w-4" />, onClick: () => accion(e.id, async () => {
                                const r = await enviarLigaConsentimientoMedico(e.id);
                                if (r.ok) setAviso(lineasResultados(r.data.resultados).map((l) => l.texto).join(" · ") || "Liga generada.");
                                return r;
                              }) },
                              { etiqueta: "Copiar liga de consentimiento", icono: <Copy className="h-4 w-4" />, onClick: () => copiar(e.ligaConsentimiento!, "Liga copiada.") },
                            ]
                          : []),
                        ...(!cerrada(e)
                          ? [{ etiqueta: "Marcar no realizada / cancelar…", icono: <Ban className="h-4 w-4" />, peligrosa: true, onClick: () => setCancelar(e) }]
                          : []),
                      ]}
                    />
                  )}
                </div>

                {/* Responsable · cita · decisión · origen · referencias */}
                {(e.responsable || e.citaEn || e.citaLugar || e.decision || e.origenResultado || (e.tipo === "referencias" && e.referencias?.length)) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
                    {e.responsable && <span>Responsable: <span className="font-medium text-ink">{e.responsable}</span></span>}
                    {(e.citaEn || e.citaLugar) && (
                      <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3 text-ink-3" /> {fechaHora(e.citaEn)}{e.citaLugar ? `${e.citaEn ? " · " : ""}${e.citaLugar}` : ""}</span>
                    )}
                    {e.decision && e.dictamenTexto && <span>{etiquetaDecision(e)}: <Badge tone={tonoDictamen(e)}>{e.dictamenTexto}</Badge></span>}
                    {e.origenResultado && <span className="rounded-full border border-border-soft px-2 py-0.5 text-[11px] text-ink-3">{ORIGEN_TEXTO[e.origenResultado] ?? e.origenResultado}</span>}
                    {e.tipo === "referencias" && e.referencias && e.referencias.length > 0 && (
                      <span className="text-ink-3">{e.referencias.length} referencia{e.referencias.length === 1 ? "" : "s"} · {referenciasVerificadas(e.referencias)} verificada{referenciasVerificadas(e.referencias) === 1 ? "" : "s"}</span>
                    )}
                  </div>
                ) : null}

                {envioLiga?.id === e.id && (
                  <div className="mt-2 rounded-xl border border-border-soft bg-surface-2 px-3 py-2 text-[12px]">
                    {envioLiga.lineas.length === 0 && <p className="text-ink-3">Liga generada. No había destinatario a quien enviarla.</p>}
                    {envioLiga.lineas.map((l, i) => <p key={i} className={l.ok ? "text-good" : "text-bad"}>{l.ok ? "✓" : "✗"} {l.texto}</p>)}
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-[11px] text-ink-2">{envioLiga.liga}</span>
                      <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" onClick={() => copiar(envioLiga.liga, "Liga copiada.")}><Copy className="h-3 w-3" /> Copiar</button>
                    </p>
                  </div>
                )}

                {e.claveProveedor && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                    Psicométricas.mx · clave <span className="font-mono">{e.claveProveedor}</span>
                    {e.urlCandidato ? (
                      <button type="button" className="font-semibold text-brand hover:underline" onClick={() => copiar(e.urlCandidato!, "Liga del candidato copiada.")}>
                        Copiar liga del candidato
                      </button>
                    ) : (
                      <span className="text-ink-3">(Psicométricas.mx le manda su liga por correo)</span>
                    )}
                  </p>
                )}
                {e.estado === "en_espera_consentimiento" && (
                  <p className="mt-2 text-[12px] text-warn">
                    {e.requiereConsentimientoExpreso
                      ? "Falta el consentimiento EXPRESO y POR ESCRITO del candidato para el estudio médico. Mándale la liga desde «…»."
                      : "Falta el consentimiento de privacidad del candidato. Regístralo en la ficha para poder enviarla."}
                  </p>
                )}

                {/* Resultado */}
                {e.tipo === "medico" ? (
                  e.informeRestringido ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3"><Lock className="h-3 w-3" /> Informe médico restringido: solo ves el estado y el dictamen.</p>
                  ) : (e.estadoFraiche === "con_resultado" || e.estado === "resultado_recibido" || e.estado === "revisada") ? (
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={() => setDetalleMedico(e)}><Eye className="h-4 w-4" /> Ver dictamen completo</Button>
                      <span className="ml-2 text-[11px] text-ink-3">{e.cifrado ? "Cifrado en la base · " : ""}Cada consulta queda en bitácora.</span>
                    </div>
                  ) : null
                ) : (
                  <>
                    {e.evaluatest && <BloqueEvaluatest datos={e.evaluatest} />}
                    {e.origenResultado === "liga_proveedor_reporte_anonimizado" && (
                      <p className="mt-1 text-[11px] text-ink-3">Resultado incorporado por liga del proveedor + reporte anonimizado.</p>
                    )}
                    {e.tipo === "socioeconomico" && e.resumenIa && (
                      <div className="mt-2 rounded-xl border border-brand/20 bg-brand-soft/40 px-3 py-2">
                        <p className="text-[11px] font-semibold text-brand">Propuesta de resumen de Red Human (editable por RH)</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{e.resumenIa}</p>
                      </div>
                    )}
                    {e.resultadoResumen && <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{e.resultadoResumen}</p>}
                    {e.comentarioRevision && <p className="mt-1 text-[12px] text-ink-3">Revisión: {e.comentarioRevision}</p>}
                    {e.tieneInforme && (
                      <a href={urlInformeEvaluacion(e.id)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">
                        Ver informe{e.nombreArchivo ? ` (${e.nombreArchivo})` : ""}
                      </a>
                    )}
                    {e.adjuntos && e.adjuntos.length > 0 && <ListaAdjuntos codigo={e.id} adjuntos={e.adjuntos} />}
                  </>
                )}

                {e.historial && e.historial.length > 0 && <Historial historial={e.historial} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {agregar && <ModalAgregarEvaluacion codigo={codigo} puesto={puesto} contactos={contactos} clienteNombre={clienteNombre} onClose={() => setAgregar(false)} onAgregada={() => { setAgregar(false); void cargar(); }} />}
      {resultado && <ModalResultado e={resultado} onClose={() => setResultado(null)} onListo={() => { setResultado(null); void cargar(); }} />}
      {revisar && <ModalRevisar e={revisar} onClose={() => setRevisar(null)} onListo={() => { setRevisar(null); void cargar(); }} />}
      {cancelar && <ModalCancelar e={cancelar} onClose={() => setCancelar(null)} onListo={() => { setCancelar(null); void cargar(); }} />}
      {responsable && <ModalResponsable e={responsable} contactos={contactos} clienteNombre={clienteNombre} onClose={() => setResponsable(null)} onListo={() => { setResponsable(null); void cargar(); }} />}
      {referencias && <ReferenciasEditor e={referencias} onClose={() => setReferencias(null)} onListo={() => { setReferencias(null); void cargar(); }} />}
      {detalleMedico && <ModalDetalleMedico e={detalleMedico} onClose={() => setDetalleMedico(null)} />}
    </Card>
  );
}

/* ---------- Piezas de la fila ---------- */
function BloqueEvaluatest({ datos }: { datos: EvaluatestResultado }) {
  const pct = (n: number | null) => (n === null || n === undefined ? "—" : `${n} %`);
  const lista = (l: string[]) => (l && l.length ? l.join(", ") : "—");
  return (
    <div className="mt-2 rounded-xl border border-border-soft bg-surface-2 px-3 py-2 text-[12px]">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Reporte Evaluatest (anonimizado)</p>
      <div className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        <p><span className="text-ink-3">Índice Evaluatest de Afinidad:</span> <span className="font-semibold">{pct(datos.indice_afinidad)}</span></p>
        <p><span className="text-ink-3">Etegrity / IGI:</span> <span className="font-semibold">{pct(datos.igi)}</span></p>
        <p className="sm:col-span-2"><span className="text-ink-3">Competencias:</span> {lista(datos.competencias)}</p>
        <p className="sm:col-span-2"><span className="text-ink-3">Fortalezas:</span> {lista(datos.fortalezas)}</p>
        <p className="sm:col-span-2"><span className="text-ink-3">Áreas de oportunidad:</span> {lista(datos.areas_oportunidad)}</p>
        <p className="sm:col-span-2"><span className="text-ink-3">Riesgo:</span> {datos.riesgo || "—"}</p>
      </div>
    </div>
  );
}

function ListaAdjuntos({ codigo, adjuntos }: { codigo: string; adjuntos: EvaluacionCandidato["adjuntos"] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {adjuntos.map((a) => (
        <li key={a.indice}>
          <a href={urlAdjuntoEvaluacion(codigo, a.indice)} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">{a.nombre || `Adjunto ${a.indice + 1}`}</a>
          {a.subido_por && <span className="text-ink-3"> · {a.subido_por}{a.subido_en ? ` · ${fechaHora(a.subido_en)}` : ""}</span>}
        </li>
      ))}
    </ul>
  );
}

function Historial({ historial }: { historial: EvaluacionCandidato["historial"] }) {
  return (
    <details className="mt-2 text-[11px]">
      <summary className="cursor-pointer select-none font-semibold text-ink-3 hover:text-ink">Historial ({historial.length})</summary>
      <ul className="mt-1 flex flex-col gap-1 border-l border-border-soft pl-3">
        {[...historial].reverse().map((h, i) => (
          <li key={i} className="text-ink-2">
            <span className="text-ink-3">{fechaHora(h.fecha)}</span>{h.usuario ? ` · ${h.usuario}` : ""}
            {h.de || h.a ? ` · ${h.de || "—"} → ${h.a || "—"}` : ""}
            {h.detalle ? ` · ${h.detalle}` : ""}
            {h.resultado_anterior && (
              <span className="block text-ink-3">
                Resultado anterior conservado: {Object.entries(h.resultado_anterior).filter(([, v]) => v !== null && v !== "" && v !== undefined).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ") || "—"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ---------- Agregar ---------- */
function ligaPorDefecto(tipo: TipoEvaluacion | "", nombre: string) {
  return tipo === "socioeconomico" || tipo === "medico" || nombre === NOMBRE_EVALUACION_ENCARGADO || nombre === NOMBRE_EVALUACION_FRANQUICIATARIO;
}

export function ModalAgregarEvaluacion({ codigo, puesto, contactos, clienteNombre, onClose, onAgregada }: {
  codigo: string; puesto?: string; contactos?: ContactoEvaluacion[]; clienteNombre?: string; onClose: () => void; onAgregada: (e: EvaluacionCandidato) => void;
}) {
  const [tipo, setTipo] = useState<TipoEvaluacion | "">("");
  const [pruebas, setPruebas] = useState<PruebaPsicometrica[] | null>(null);
  const [pruebaId, setPruebaId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [modo, setModo] = useState<ModoPrueba>("manual");
  const [url, setUrl] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [resp, setResp] = useState<FormResponsable>(() => formResponsableDesde(undefined, contactos));
  /* null = todavía no lo tocó RH: se calcula por tipo/nombre. */
  const [generarLiga, setGenerarLiga] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const liga = generarLiga ?? ligaPorDefecto(tipo, nombre.trim());

  useEffect(() => {
    if (tipo === "psicometrica" && pruebas === null) fetchPruebasPsicometricas(false, puesto ?? "").then((p) => setPruebas(p ?? []));
  }, [tipo, pruebas, puesto]);

  async function guardar() {
    if (!tipo) return setError("Elige el tipo.");
    setOcupado(true);
    const comun = { responsable: responsableDesdeForm(resp), cita: resp.cita || undefined, cita_lugar: resp.lugar.trim() || undefined, generar_liga: liga };
    const r = await agregarEvaluacionCandidato(codigo, tipo === "psicometrica"
      ? { tipo, prueba_id: pruebaId, ...comun }
      : { tipo, nombre, modo, url, proveedor, ...comun });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onAgregada(r.data);
  }

  return (
    <ModalMarco titulo="Agregar evaluación o verificación" subtitulo="La columna del pipeline no cambia. Antes de enviarla se comprueban los consentimientos." onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TIPOS_EVALUACION.map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => { setTipo(t.valor); setError(""); }}
            className={cn("rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition",
              tipo === t.valor ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/50")}
          >
            {t.texto}
          </button>
        ))}
      </div>
      {tipo === "otra" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-3">Entrevistas del proceso:</span>
          {[NOMBRE_EVALUACION_ENCARGADO, NOMBRE_EVALUACION_FRANQUICIATARIO].map((n) => (
            <button key={n} type="button" onClick={() => setNombre(n)}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", nombre === n ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/50")}>
              {n}
            </button>
          ))}
        </div>
      )}
      {tipo === "psicometrica" && (
        <div className="mt-4">
          {pruebas === null ? <Loader2 className="h-5 w-5 animate-spin text-ink-3" /> : pruebas.length === 0 ? (
            <p className="text-sm text-ink-3">No hay pruebas activas. Créalas en Configuración → Pruebas psicométricas.</p>
          ) : (
            <CampoRH label="Prueba del catálogo">
              <select value={pruebaId ?? ""} onChange={(e) => setPruebaId(e.target.value ? Number(e.target.value) : null)} className={inputRH}>
                <option value="">Elige una prueba…</option>
                {pruebas.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.modoTexto}{p.sugerida ? " · sugerida para el puesto" : ""}</option>)}
              </select>
            </CampoRH>
          )}
        </div>
      )}
      {tipo && tipo !== "psicometrica" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CampoRH label="Nombre (opcional)"><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputRH} placeholder={TIPOS_EVALUACION.find((t) => t.valor === tipo)?.texto} /></CampoRH>
          <CampoRH label="Modo">
            <select value={modo} onChange={(e) => setModo(e.target.value as ModoPrueba)} className={inputRH}>
              <option value="manual">Carga manual</option>
              <option value="enlace">Enlace externo</option>
              <option value="integrada">Integrada</option>
            </select>
          </CampoRH>
          {modo === "enlace" && <CampoRH label="Liga"><input value={url} onChange={(e) => setUrl(e.target.value)} className={inputRH} placeholder="https://…" /></CampoRH>}
          {modo !== "manual" && <CampoRH label="Proveedor (opcional)"><input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={inputRH} /></CampoRH>}
          {tipo === "medico" && (
            <p className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[12px] text-warn sm:col-span-2">
              El estudio médico requiere el consentimiento EXPRESO y POR ESCRITO del candidato (liga electrónica). Hasta que lo acepte queda «En espera de consentimiento».
            </p>
          )}
        </div>
      )}
      {tipo && (
        <div className="mt-4 border-t border-border-soft pt-4">
          <BloqueResponsable f={resp} onChange={setResp} contactos={contactos} clienteNombre={clienteNombre} />
          <label className="mt-3 flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={liga} onChange={(x) => setGenerarLiga(x.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
            <span>Generar liga de acceso para la persona externa<span className="block text-[11px] text-ink-3">Liga limitada para registrar el resultado sin entrar al sistema.</span></span>
          </label>
        </div>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado || !tipo || (tipo === "psicometrica" && !pruebaId)}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} Agregar
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- Editar responsable / cita ---------- */
function ModalResponsable({ e, contactos, clienteNombre, onClose, onListo }: {
  e: EvaluacionCandidato; contactos?: ContactoEvaluacion[]; clienteNombre?: string; onClose: () => void; onListo: () => void;
}) {
  const [f, setF] = useState<FormResponsable>(() => formResponsableDesde(e, contactos));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalMarco titulo={`Responsable y cita · ${e.nombre}`} subtitulo="Quién aplica la evaluación, cuándo y dónde. El cambio queda en el historial." onClose={onClose}>
      <BloqueResponsable f={f} onChange={setF} contactos={contactos} clienteNombre={clienteNombre} />
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" disabled={ocupado} onClick={async () => {
          setOcupado(true);
          setError("");
          const r = await editarEvaluacion(e.id, { responsable: responsableDesdeForm(f), cita: f.cita || "", cita_lugar: f.lugar.trim() });
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />} Guardar
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- Resultado ---------- */
function ModalResultado({ e, onClose, onListo }: { e: EvaluacionCandidato; onClose: () => void; onListo: () => void }) {
  const [resumen, setResumen] = useState("");
  const [comentarios, setComentarios] = useState("");
  const [decision, setDecision] = useState("");
  const [evaluatest, setEvaluatest] = useState<Record<string, string>>({});
  const [archivo, setArchivo] = useState<File | null>(null);
  const [avisos, setAvisos] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  /* Los 6 campos de Evaluatest se capturan como texto y se convierten al guardar. */
  function evaluatestDesdeForm(): Partial<EvaluatestResultado> | null {
    if (!e.esEvaluatest) return null;
    const out: Partial<EvaluatestResultado> = {};
    let alguno = false;
    for (const c of CAMPOS_EVALUATEST) {
      const v = (evaluatest[c.clave] ?? "").trim();
      if (!v) continue;
      alguno = true;
      if (c.tipo === "porcentaje") (out as Record<string, unknown>)[c.clave] = Number(v);
      else if (c.tipo === "lista") (out as Record<string, unknown>)[c.clave] = v.split(",").map((s) => s.trim()).filter(Boolean);
      else (out as Record<string, unknown>)[c.clave] = v;
    }
    return alguno ? out : null;
  }
  const puedeGuardar = Boolean(resumen.trim() || archivo || decision || evaluatestDesdeForm());

  if (avisos) {
    return (
      <ModalMarco titulo={`Resultado · ${e.nombre}`} subtitulo="Resultado guardado." onClose={onListo}>
        <ul className="flex flex-col gap-1 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[12px] text-warn">
          {avisos.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
        <div className="mt-5 flex justify-end"><Button size="sm" onClick={onListo}>Listo</Button></div>
      </ModalMarco>
    );
  }

  return (
    <ModalMarco titulo={`Resultado · ${e.nombre}`} subtitulo="Queda registrado quién lo cargó y cuándo." onClose={onClose}>
      {e.dictamenesPosibles.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{etiquetaDecision(e)}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {e.dictamenesPosibles.map((d) => (
              <button key={d.valor} type="button" onClick={() => setDecision(decision === d.valor ? "" : d.valor)}
                className={cn("rounded-xl border px-3 py-2.5 text-sm font-medium transition", decision === d.valor ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/50")}>
                {d.texto}
              </button>
            ))}
          </div>
        </div>
      )}
      <CampoRH label="Resultado (resumen)">
        <textarea value={resumen} onChange={(x) => setResumen(x.target.value)} rows={4} className={textareaRH} />
      </CampoRH>
      <div className="mt-3">
        <CampoRH label="Comentarios (opcional)">
          <textarea value={comentarios} onChange={(x) => setComentarios(x.target.value)} rows={2} className={textareaRH} />
        </CampoRH>
      </div>
      {e.esEvaluatest && (
        <div className="mt-3 rounded-xl border border-border-soft bg-surface-2 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Reporte Evaluatest (anonimizado)</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {CAMPOS_EVALUATEST.map((c) => (
              <div key={c.clave} className={c.tipo === "porcentaje" ? "" : "sm:col-span-2"}>
                <CampoRH label={c.tipo === "porcentaje" ? `${c.nombre} (%)` : c.tipo === "lista" ? `${c.nombre} (separadas por coma)` : c.nombre}>
                  {c.tipo === "porcentaje" ? (
                    <input type="number" min={0} max={100} step={1} value={evaluatest[c.clave] ?? ""} onChange={(x) => setEvaluatest({ ...evaluatest, [c.clave]: x.target.value })} className={inputRH} />
                  ) : (
                    <input value={evaluatest[c.clave] ?? ""} onChange={(x) => setEvaluatest({ ...evaluatest, [c.clave]: x.target.value })} className={inputRH} />
                  )}
                </CampoRH>
              </div>
            ))}
          </div>
        </div>
      )}
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(x) => setArchivo(x.target.files?.[0] ?? null)} />
      <Button variant="outline" size="sm" className="mt-3" onClick={() => ref.current?.click()}><FileUp className="h-4 w-4" /> {archivo ? archivo.name : "Adjuntar informe (PDF o imagen)"}</Button>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" disabled={ocupado || !puedeGuardar} onClick={async () => {
          setOcupado(true);
          setError("");
          const r = await cargarResultadoEvaluacion(e.id, resumen.trim(), archivo, { decision: decision || undefined, evaluatest: evaluatestDesdeForm(), comentarios: comentarios.trim() || undefined });
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          if (r.data.avisos && r.data.avisos.length > 0) return setAvisos(r.data.avisos);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Guardar resultado
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- Dictamen médico completo (solo con permiso; cada consulta queda en bitácora) ---------- */
function ModalDetalleMedico({ e, onClose }: { e: EvaluacionCandidato; onClose: () => void }) {
  type Detalle = NonNullable<Awaited<ReturnType<typeof fetchDetalleMedico>>>;
  /* null = cargando; false = sin permiso o error (403 se registra en bitácora del lado del servidor). */
  const [d, setD] = useState<Detalle | null | false>(null);
  useEffect(() => {
    fetchDetalleMedico(e.id).then((r) => setD(r ?? false));
  }, [e.id]);
  return (
    <ModalMarco titulo={`Dictamen médico · ${e.nombre}`} subtitulo="Cada consulta queda en bitácora." onClose={onClose} ancho="max-w-lg">
      {d === null ? <Loader2 className="h-5 w-5 animate-spin text-ink-3" /> : d === false ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-bad"><Lock className="h-4 w-4" /> No fue posible consultar el dictamen (sin permiso para ver informes médicos).</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="flex items-center gap-2">Dictamen: {d.dictamenTexto ? <Badge tone={tonoDictamen({ ...e, dictamen: d.decision })}>{d.dictamenTexto}</Badge> : <span className="text-ink-3">—</span>}</p>
          {d.resultadoResumen && <p className="leading-relaxed text-ink-2">{d.resultadoResumen}</p>}
          {d.comentarioRevision && <p className="text-[12px] text-ink-3">Revisión: {d.comentarioRevision}</p>}
          {d.notas && <p className="text-[12px] text-ink-3">Notas: {d.notas}</p>}
          {d.revisadaPor && <p className="text-[12px] text-ink-3">Revisada por {d.revisadaPor}{d.revisadaEn ? ` · ${fechaHora(d.revisadaEn)}` : ""}</p>}
          {d.tieneInforme && (
            <a href={urlInformeEvaluacion(e.id)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">Ver informe</a>
          )}
          {d.adjuntos.length > 0 && <ListaAdjuntos codigo={e.id} adjuntos={d.adjuntos} />}
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3"><Lock className="h-3 w-3" /> {d.cifrado ? "Cifrado en la base. " : ""}Cada consulta queda en bitácora.</p>
        </div>
      )}
      <div className="mt-5 flex justify-end"><Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button></div>
    </ModalMarco>
  );
}

/* ---------- Referencias laborales ---------- */
const REFERENCIA_VACIA: ReferenciaLaboral = { contacto: "", empresa: "", puesto: "", telefono: "", fecha_verificacion: "", resultado: "", comentarios: "", responsable: "" };

function ReferenciasEditor({ e, onClose, onListo }: { e: EvaluacionCandidato; onClose: () => void; onListo: () => void }) {
  const [filas, setFilas] = useState<ReferenciaLaboral[]>(() => (e.referencias && e.referencias.length ? e.referencias.map((r) => ({ ...REFERENCIA_VACIA, ...r })) : [{ ...REFERENCIA_VACIA }]));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const cambiar = (i: number, p: Partial<ReferenciaLaboral>) => setFilas(filas.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <ModalMarco titulo={`Referencias laborales · ${e.nombre}`} subtitulo="Quién verificó cada referencia, cuándo y con qué resultado." onClose={onClose} ancho="max-w-4xl">
      <div className="flex flex-col gap-3">
        {filas.map((f, i) => (
          <div key={i} className="rounded-xl border border-border-soft bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Referencia {i + 1}</p>
              <button type="button" className="inline-flex items-center gap-1 text-[11px] text-bad hover:underline" onClick={() => setFilas(filas.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /> Quitar</button>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CampoRH label="Contacto"><input value={f.contacto} onChange={(x) => cambiar(i, { contacto: x.target.value })} className={inputRH} /></CampoRH>
              <CampoRH label="Empresa"><input value={f.empresa} onChange={(x) => cambiar(i, { empresa: x.target.value })} className={inputRH} /></CampoRH>
              <CampoRH label="Puesto"><input value={f.puesto} onChange={(x) => cambiar(i, { puesto: x.target.value })} className={inputRH} /></CampoRH>
              <CampoRH label="Teléfono"><input value={f.telefono} onChange={(x) => cambiar(i, { telefono: x.target.value })} className={inputRH} /></CampoRH>
              <CampoRH label="Fecha de verificación"><input type="date" value={f.fecha_verificacion} onChange={(x) => cambiar(i, { fecha_verificacion: x.target.value })} className={inputRH} /></CampoRH>
              <CampoRH label="Resultado">
                <select value={f.resultado} onChange={(x) => cambiar(i, { resultado: x.target.value as ReferenciaLaboral["resultado"] })} className={inputRH}>
                  {RESULTADOS_REFERENCIA.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
                </select>
              </CampoRH>
              <CampoRH label="Responsable"><input value={f.responsable} onChange={(x) => cambiar(i, { responsable: x.target.value })} className={inputRH} /></CampoRH>
              <div className="sm:col-span-2 lg:col-span-4">
                <CampoRH label="Comentarios"><input value={f.comentarios} onChange={(x) => cambiar(i, { comentarios: x.target.value })} className={inputRH} /></CampoRH>
              </div>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="self-start" onClick={() => setFilas([...filas, { ...REFERENCIA_VACIA }])}><Plus className="h-4 w-4" /> Agregar referencia</Button>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" disabled={ocupado} onClick={async () => {
          setOcupado(true);
          setError("");
          const limpias = filas.filter((f) => Object.values(f).some((v) => String(v ?? "").trim()));
          const r = await guardarReferenciasEvaluacion(e.id, limpias);
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Guardar referencias
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- Revisar ---------- */
function ModalRevisar({ e, onClose, onListo }: { e: EvaluacionCandidato; onClose: () => void; onListo: () => void }) {
  const [dictamen, setDictamen] = useState("");
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalMarco
      titulo={`Revisar · ${e.nombre}`}
      subtitulo={e.tipo === "medico" ? "Transcribe el dictamen del estudio médico." : "Elige el resultado de la revisión."}
      onClose={onClose}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {e.dictamenesPosibles.map((d) => (
          <button key={d.valor} type="button" onClick={() => setDictamen(d.valor)}
            className={cn("rounded-xl border px-3 py-2.5 text-sm font-medium transition", dictamen === d.valor ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/50")}>
            {d.texto}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <CampoRH label="Comentario (opcional)"><input value={comentario} onChange={(x) => setComentario(x.target.value)} className={inputRH} /></CampoRH>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" disabled={ocupado || !dictamen} onClick={async () => {
          setOcupado(true);
          const r = await revisarEvaluacion(e.id, dictamen, comentario.trim());
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Marcar revisada
        </Button>
      </div>
    </ModalMarco>
  );
}

/* ---------- No realizada / cancelar ---------- */
function ModalCancelar({ e, onClose, onListo }: { e: EvaluacionCandidato; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [noRealizada, setNoRealizada] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalMarco titulo="No realizada / Cancelada" subtitulo={`«${e.nombre}» queda cerrada. El motivo es obligatorio.`} onClose={onClose}>
      <CampoRH label="Motivo"><input value={motivo} onChange={(x) => setMotivo(x.target.value)} className={inputRH} autoFocus /></CampoRH>
      <label className="mt-3 flex items-start gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={noRealizada} onChange={(x) => setNoRealizada(x.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
        <span>No realizada (la persona no se presentó)<span className="block text-[11px] text-ink-3">Sin marcar, queda como cancelada.</span></span>
      </label>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Volver</Button>
        <Button size="sm" disabled={ocupado || !motivo.trim()} onClick={async () => {
          setOcupado(true);
          const r = await cancelarEvaluacion(e.id, motivo.trim(), noRealizada);
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {noRealizada ? "Marcar no realizada" : "Marcar cancelada"}
        </Button>
      </div>
    </ModalMarco>
  );
}
