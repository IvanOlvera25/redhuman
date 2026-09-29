"use client";

/* Evaluaciones y verificaciones del candidato (2026-09-28). Se agregan desde el menú «…» de la ficha
   («Agregar evaluación o verificación») y NUNCA mueven la columna del pipeline. Consentimientos antes de enviar:
   sin ellos → «En espera de consentimiento». Estudio médico: liga de consentimiento expreso por escrito; el informe
   completo solo lo ve quien tiene permiso (el resto, estado y dictamen). Sin proveedores todavía: el modo Integrada
   se avanza a mano («Simular siguiente paso»). */

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, ClipboardCheck, Copy, FileUp, Loader2, Lock, RefreshCw, Send, SkipForward, Stethoscope, XCircle } from "lucide-react";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { CampoRH, ModalMarco, inputRH } from "@/components/dashboard/modulos-rh";
import {
  TIPOS_EVALUACION, agregarEvaluacionCandidato, avanzarEvaluacionIntegrada, cancelarEvaluacion, cargarResultadoEvaluacion,
  enviarEvaluacion, enviarLigaConsentimientoMedico, fetchEvaluacionesCandidato, fetchPruebasPsicometricas, lineasResultados,
  revisarEvaluacion, sincronizarEvaluacion, urlInformeEvaluacion,
  type EvaluacionCandidato, type ModoPrueba, type PruebaPsicometrica, type TipoEvaluacion,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const PASOS: Record<string, string> = { asignada: "Asignada", enviada: "Enviada", iniciada: "Iniciada", completada: "Completada", resultado_recibido: "Resultado recibido" };

function tonoEstado(e: EvaluacionCandidato): "good" | "warn" | "bad" | "neutral" | "brand" {
  if (e.estado === "revisada") return e.dictamen === "desfavorable" || e.dictamen === "no_apto" ? "bad" : e.dictamen === "con_observaciones" || e.dictamen === "apto_con_restricciones" ? "warn" : "good";
  if (e.estado === "fallida") return "neutral";
  if (e.estado === "en_espera_consentimiento") return "warn";
  if (e.estado === "resultado_recibido") return "brand";
  return "neutral";
}

export function PanelEvaluaciones({ codigo, puesto, live, version }: { codigo: string; puesto?: string; live: boolean; version?: number }) {
  const [lista, setLista] = useState<EvaluacionCandidato[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [resultado, setResultado] = useState<EvaluacionCandidato | null>(null);
  const [revisar, setRevisar] = useState<EvaluacionCandidato | null>(null);
  const [cancelar, setCancelar] = useState<EvaluacionCandidato | null>(null);
  const [agregar, setAgregar] = useState(false);

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
                      {e.pasoIntegrada ? `Integrada: ${PASOS[e.pasoIntegrada] ?? e.pasoIntegrada}` : ""}
                      {e.resultadoCargadoPor ? `${e.pasoIntegrada ? " · " : ""}Resultado cargado por ${e.resultadoCargadoPor}` : ""}
                      {e.revisadaPor ? ` · revisada por ${e.revisadaPor}` : ""}
                      {e.estado === "fallida" && e.motivoFallida ? `Motivo: ${e.motivoFallida}` : ""}
                    </p>
                  </div>
                  <Badge tone={tonoEstado(e)}>{e.estado === "revisada" && e.dictamenTexto ? `Revisada · ${e.dictamenTexto}` : e.estadoTexto}</Badge>
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
                        ...((e.estado === "pendiente" || e.estado === "en_proceso") && !(e.tipo === "medico" && e.informeRestringido)
                          ? [{ etiqueta: "Adjuntar resultado / informe…", icono: <FileUp className="h-4 w-4" />, onClick: () => setResultado(e) }]
                          : []),
                        ...(e.estado === "en_espera_consentimiento" && e.ligaConsentimiento
                          ? [
                              { etiqueta: "Enviar liga de consentimiento", icono: <Send className="h-4 w-4" />, onClick: () => accion(e.id, async () => {
                                const r = await enviarLigaConsentimientoMedico(e.id);
                                if (r.ok) setAviso(lineasResultados(r.data.resultados).map((l) => l.texto).join(" · ") || "Liga generada.");
                                return r;
                              }) },
                              { etiqueta: "Copiar liga de consentimiento", icono: <Copy className="h-4 w-4" />, onClick: () => { void navigator.clipboard?.writeText(e.ligaConsentimiento!); setAviso("Liga copiada."); } },
                            ]
                          : []),
                        ...(e.estado !== "revisada" && e.estado !== "fallida"
                          ? [{ etiqueta: "Marcar fallida / cancelar…", icono: <Ban className="h-4 w-4" />, peligrosa: true, onClick: () => setCancelar(e) }]
                          : []),
                      ]}
                    />
                  )}
                </div>
                {e.claveProveedor && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                    Psicométricas.mx · clave <span className="font-mono">{e.claveProveedor}</span>
                    {e.urlCandidato ? (
                      <button type="button" className="font-semibold text-brand hover:underline" onClick={() => { void navigator.clipboard?.writeText(e.urlCandidato!); setAviso("Liga del candidato copiada."); }}>
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
                {e.informeRestringido ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3"><Lock className="h-3 w-3" /> Informe médico restringido: solo ves el estado y el dictamen.</p>
                ) : (
                  <>
                    {e.resultadoResumen && <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{e.resultadoResumen}</p>}
                    {e.comentarioRevision && <p className="mt-1 text-[12px] text-ink-3">Revisión: {e.comentarioRevision}</p>}
                    {e.tieneInforme && (
                      <a href={urlInformeEvaluacion(e.id)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">
                        Ver informe{e.nombreArchivo ? ` (${e.nombreArchivo})` : ""}
                      </a>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {agregar && <ModalAgregarEvaluacion codigo={codigo} puesto={puesto} onClose={() => setAgregar(false)} onAgregada={() => { setAgregar(false); void cargar(); }} />}
      {resultado && <ModalResultado e={resultado} onClose={() => setResultado(null)} onListo={() => { setResultado(null); void cargar(); }} />}
      {revisar && <ModalRevisar e={revisar} onClose={() => setRevisar(null)} onListo={() => { setRevisar(null); void cargar(); }} />}
      {cancelar && <ModalCancelar e={cancelar} onClose={() => setCancelar(null)} onListo={() => { setCancelar(null); void cargar(); }} />}
    </Card>
  );
}

export function ModalAgregarEvaluacion({ codigo, puesto, onClose, onAgregada }: { codigo: string; puesto?: string; onClose: () => void; onAgregada: (e: EvaluacionCandidato) => void }) {
  const [tipo, setTipo] = useState<TipoEvaluacion | "">("");
  const [pruebas, setPruebas] = useState<PruebaPsicometrica[] | null>(null);
  const [pruebaId, setPruebaId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [modo, setModo] = useState<ModoPrueba>("manual");
  const [url, setUrl] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (tipo === "psicometrica" && pruebas === null) fetchPruebasPsicometricas(false, puesto ?? "").then((p) => setPruebas(p ?? []));
  }, [tipo, pruebas, puesto]);

  async function guardar() {
    if (!tipo) return setError("Elige el tipo.");
    setOcupado(true);
    const r = await agregarEvaluacionCandidato(codigo, tipo === "psicometrica"
      ? { tipo, prueba_id: pruebaId }
      : { tipo, nombre, modo, url, proveedor });
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

function ModalResultado({ e, onClose, onListo }: { e: EvaluacionCandidato; onClose: () => void; onListo: () => void }) {
  const [resumen, setResumen] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <ModalMarco titulo={`Resultado · ${e.nombre}`} subtitulo="Queda registrado quién lo cargó y cuándo." onClose={onClose}>
      <CampoRH label="Resultado (resumen)">
        <textarea value={resumen} onChange={(x) => setResumen(x.target.value)} rows={4} className="rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand" />
      </CampoRH>
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(x) => setArchivo(x.target.files?.[0] ?? null)} />
      <Button variant="outline" size="sm" className="mt-3" onClick={() => ref.current?.click()}><FileUp className="h-4 w-4" /> {archivo ? archivo.name : "Adjuntar informe (PDF o imagen)"}</Button>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" disabled={ocupado || (!resumen.trim() && !archivo)} onClick={async () => {
          setOcupado(true);
          const r = await cargarResultadoEvaluacion(e.id, resumen.trim(), archivo);
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Guardar resultado
        </Button>
      </div>
    </ModalMarco>
  );
}

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

function ModalCancelar({ e, onClose, onListo }: { e: EvaluacionCandidato; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalMarco titulo="Fallida / Cancelada" subtitulo={`«${e.nombre}» queda cerrada. El motivo es obligatorio.`} onClose={onClose}>
      <CampoRH label="Motivo"><input value={motivo} onChange={(x) => setMotivo(x.target.value)} className={inputRH} autoFocus /></CampoRH>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Volver</Button>
        <Button size="sm" disabled={ocupado || !motivo.trim()} onClick={async () => {
          setOcupado(true);
          const r = await cancelarEvaluacion(e.id, motivo.trim());
          setOcupado(false);
          if (!r.ok) return setError(r.error);
          onListo();
        }}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Marcar fallida / cancelada
        </Button>
      </div>
    </ModalMarco>
  );
}
