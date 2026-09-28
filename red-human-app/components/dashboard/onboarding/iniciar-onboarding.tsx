"use client";

/* Onboarding v2 — Fase 2 (2026-09-28). «Enviar a Onboarding» abre este resumen PRECARGADO con la plantilla que
   aplica (puesto > empresa > predeterminada). «Cambiar selección» ajusta documentos, recursos, responsables y
   curso SOLO para esta persona (la plantilla no cambia). «Iniciar Onboarding» es el único gatillo del cambio de
   etapa: genera tareas, hace la primera solicitud de documentos y avisa a los responsables internos. */

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Loader2, PenLine, Plus, Rocket, X, XCircle } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { CampoRH, ModalMarco, inputRH } from "@/components/dashboard/modulos-rh";
import {
  fetchResumenOnboarding, iniciarOnboarding, lineasResultados,
  type ClavePlazoOnboarding, type DocumentoPlantillaOnboarding, type RecursoPlantillaOnboarding, type ResultadoIniciarOnboarding,
  type ResumenOnboarding, type TipoRecursoOnboarding,
} from "@/lib/api";

const NOMBRE_TAREA: Record<string, string> = {
  documentos: "Documentos completos",
  contrato_firmado: "Contrato firmado",
  alta_imss_nomina: "Alta IMSS / nómina",
  confirmar_ingreso: "Confirmar ingreso",
};
const ORIGEN: Record<string, string> = {
  puesto: "Plantilla del puesto",
  empresa: "Plantilla de la empresa",
  predeterminada: "Configuración predeterminada",
};
const TIPOS_RECURSO: TipoRecursoOnboarding[] = ["correo", "equipo", "accesos", "otro"];

function textoPlazo(dias: number) {
  if (!dias) return "el día de ingreso";
  return dias < 0 ? `${-dias} día${dias === -1 ? "" : "s"} antes` : `${dias} día${dias === 1 ? "" : "s"} después`;
}

export function ModalIniciarOnboarding({ expedienteId, onClose, onIniciado }: {
  expedienteId: number;
  onClose: () => void;
  onIniciado: (r: ResultadoIniciarOnboarding) => void;
}) {
  const [resumen, setResumen] = useState<ResumenOnboarding | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(false);
  const [documentos, setDocumentos] = useState<DocumentoPlantillaOnboarding[]>([]);
  const [recursos, setRecursos] = useState<RecursoPlantillaOnboarding[]>([]);
  const [responsables, setResponsables] = useState<Partial<Record<ClavePlazoOnboarding, string>>>({});
  const [plazos, setPlazos] = useState<Partial<Record<ClavePlazoOnboarding, number>>>({});
  const [curso, setCurso] = useState<number | null>(null);
  const [nuevoDoc, setNuevoDoc] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoIniciarOnboarding | null>(null);

  useEffect(() => {
    fetchResumenOnboarding(expedienteId).then((r) => {
      if (!r) return setError("No se pudo cargar el resumen del Onboarding.");
      setResumen(r);
      const cfg = r.configuracion;
      setDocumentos(cfg.documentos);
      setRecursos(cfg.recursos);
      setResponsables(cfg.responsables);
      setPlazos(cfg.plazos);
      setCurso(cfg.cursoInduccionId);
    });
  }, [expedienteId]);

  // documentos que ya están en el expediente pero no en la plantilla: se pueden volver a incluir al cambiar selección
  const extras = (resumen?.documentosExpediente ?? []).filter((d) => !documentos.some((x) => x.tipo.toLowerCase() === d.tipo.toLowerCase()));
  const excluidosConArchivo = extras.filter((d) => d.tieneArchivo || d.estado === "recibido");

  function alternarDoc(tipo: string, obligatorio = true) {
    setDocumentos((ds) => (ds.some((d) => d.tipo === tipo) ? ds.filter((d) => d.tipo !== tipo) : [...ds, { tipo, obligatorio }]));
  }

  async function iniciar() {
    if (!documentos.length) return setError("Selecciona al menos un documento.");
    setOcupado(true);
    setError("");
    const r = await iniciarOnboarding(expedienteId, {
      documentos, recursos: recursos.filter((x) => x.nombre.trim()), responsables, plazos,
      curso_induccion_id: curso, plantilla_id: resumen?.configuracion.plantillaId ?? null,
    });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    setResultado(r.data);
  }

  if (resultado) {
    const lineas = [
      ...lineasResultados(resultado.solicitudDocumentos).map((l) => ({ ...l, texto: `Solicitud de documentos · ${l.texto}` })),
      ...resultado.avisosResponsables.map((a) => ({
        ok: a.enviado,
        texto: `Aviso a ${a.destinatario}${a.destino ? ` (${a.destino})` : ""}: ${a.enviado ? "enviado" : `no enviado — ${a.detalle}`}`,
      })),
    ];
    return (
      <ModalMarco titulo="Onboarding iniciado" subtitulo="La persona ya está en Onboarding con sus tareas y documentos." onClose={() => onIniciado(resultado)}>
        <ul className="space-y-1.5 text-sm">
          <li>{resultado.tareas.length} tareas generadas ({resultado.tareas.filter((t) => t.fija).length} fijas).</li>
          {resultado.documentosAgregados.length > 0 && <li>Documentos agregados: {resultado.documentosAgregados.join(", ")}.</li>}
          {resultado.documentosNoAplica.length > 0 && <li>Marcados «No aplica»: {resultado.documentosNoAplica.join(", ")}.</li>}
          {resultado.cursoInduccion?.curso && <li>Curso de inducción asignado: {resultado.cursoInduccion.curso}.</li>}
        </ul>
        {lineas.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-xl border border-border-soft bg-surface-2/50 p-3 text-xs">
            {lineas.map((l, i) => (
              <li key={i} className={l.ok ? "text-good" : "text-warn"}>
                {l.ok ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : <XCircle className="mr-1 inline h-3.5 w-3.5" />}
                {l.texto}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex justify-end">
          <Button size="sm" onClick={() => onIniciado(resultado)}>Listo</Button>
        </div>
      </ModalMarco>
    );
  }

  return (
    <ModalMarco titulo="Enviar a Onboarding" subtitulo="Revisa lo que se va a preparar para esta persona." onClose={onClose} ancho="max-w-3xl">
      {!resumen ? (
        error ? <p className="text-sm font-semibold text-bad">{error}</p> : <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={resumen.configuracion.origen === "predeterminada" ? "neutral" : "brand"}>
              {ORIGEN[resumen.configuracion.origen]}{resumen.configuracion.plantilla ? `: ${resumen.configuracion.plantilla}` : ""}
            </Badge>
            {!editando && (
              <Button size="sm" variant="outline" onClick={() => setEditando(true)}><PenLine className="h-4 w-4" /> Cambiar selección</Button>
            )}
          </div>

          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {resumen.requisitos.items.map((it) => (
              <li key={it.clave} className={it.ok ? "flex items-center gap-2 text-sm text-ink-2" : "flex items-center gap-2 text-sm font-semibold text-bad"}>
                {it.ok ? <Check className="h-4 w-4 text-good" /> : <X className="h-4 w-4" />} {it.nombre}
              </li>
            ))}
          </ul>
          {!resumen.requisitos.completos && (
            <p className="mt-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              {resumen.modoPrueba
                ? "Modo Prueba activo: puedes iniciar aunque falten datos."
                : `Para iniciar falta: ${resumen.requisitos.faltan.join(", ")}. Captúralo en las condiciones de contratación.`}
            </p>
          )}

          <h3 className="mt-5 text-sm font-semibold">Documentos ({documentos.length})</h3>
          {editando ? (
            <>
              <ul className="mt-2 divide-y divide-border-faint rounded-xl border border-border-soft">
                {[...documentos.map((d) => ({ tipo: d.tipo, sel: true, obligatorio: d.obligatorio })), ...extras.map((d) => ({ tipo: d.tipo, sel: false, obligatorio: d.obligatorio }))].map((d) => (
                  <li key={d.tipo} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={d.sel} onChange={() => alternarDoc(d.tipo, d.obligatorio)} aria-label={`Incluir ${d.tipo}`} />
                    <span className={d.sel ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-ink-3 line-through"}>{d.tipo}</span>
                    {d.sel && (
                      <label className="flex items-center gap-1.5 text-xs text-ink-2">
                        <input
                          type="checkbox"
                          checked={d.obligatorio}
                          onChange={(e) => setDocumentos((ds) => ds.map((x) => (x.tipo === d.tipo ? { ...x, obligatorio: e.target.checked } : x)))}
                        />
                        Obligatorio
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <input value={nuevoDoc} onChange={(e) => setNuevoDoc(e.target.value)} className={inputRH} placeholder="Agregar documento solo para esta persona" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11"
                  onClick={() => {
                    const t = nuevoDoc.trim();
                    if (t && !documentos.some((d) => d.tipo.toLowerCase() === t.toLowerCase())) setDocumentos([...documentos, { tipo: t, obligatorio: true }]);
                    setNuevoDoc("");
                  }}
                >
                  <Plus className="h-4 w-4" /> Agregar
                </Button>
              </div>
              {extras.length > 0 && (
                <p className="mt-1 text-[11px] text-ink-3">
                  Los documentos del expediente que no incluyas quedan «No aplica» (no se borran){excluidosConArchivo.length ? "; los que ya tienen archivo se conservan." : "."}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-2">
              {documentos.map((d) => `${d.tipo}${d.obligatorio ? "" : " (opcional)"}`).join(" · ")}
              {extras.length > 0 && <span className="block text-[11px] text-ink-3">No incluidos (quedarán «No aplica»): {extras.map((d) => d.tipo).join(", ")}</span>}
            </p>
          )}

          <h3 className="mt-5 text-sm font-semibold">Tareas</h3>
          <datalist id="usuarios-onboarding">{resumen.usuarios.map((x) => <option key={x.id} value={x.nombre} />)}</datalist>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-3">
                  <th className="py-1.5 font-medium">Tarea</th>
                  <th className="py-1.5 font-medium">Responsable</th>
                  <th className="w-36 py-1.5 font-medium">Plazo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-faint">
                {(["contrato_firmado", "alta_imss_nomina", "confirmar_ingreso"] as ClavePlazoOnboarding[]).map((k) => (
                  <tr key={k}>
                    <td className="py-2 pr-3">{NOMBRE_TAREA[k]} <span className="text-[10px] text-ink-3">· fija</span></td>
                    <td className="py-2 pr-3">
                      {editando ? (
                        <input list="usuarios-onboarding" value={responsables[k] ?? ""} onChange={(e) => setResponsables({ ...responsables, [k]: e.target.value })} className={inputRH} />
                      ) : (responsables[k] || <span className="text-ink-3">Sin asignar</span>)}
                    </td>
                    <td className="py-2">
                      {editando ? (
                        <input type="number" value={plazos[k] ?? 0} onChange={(e) => setPlazos({ ...plazos, [k]: Number(e.target.value) || 0 })} className={inputRH} aria-label="Días respecto al ingreso" />
                      ) : textoPlazo(plazos[k] ?? 0)}
                    </td>
                  </tr>
                ))}
                {recursos.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3">
                      {editando ? (
                        <div className="flex gap-2">
                          <input value={r.nombre} onChange={(e) => setRecursos(recursos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} className={inputRH} />
                          <select value={r.tipo} onChange={(e) => setRecursos(recursos.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoRecursoOnboarding } : x)))} className={`${inputRH} w-28`}>
                            {TIPOS_RECURSO.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      ) : <>{r.nombre} <span className="text-[10px] text-ink-3">· {r.tipo}</span></>}
                    </td>
                    <td className="py-2 pr-3">
                      {editando ? (
                        <input list="usuarios-onboarding" value={r.responsable} onChange={(e) => setRecursos(recursos.map((x, j) => (j === i ? { ...x, responsable: e.target.value } : x)))} className={inputRH} />
                      ) : (r.responsable || <span className="text-ink-3">Sin asignar</span>)}
                    </td>
                    <td className="py-2">
                      {editando ? (
                        <div className="flex items-center gap-1">
                          <input type="number" value={r.dias} onChange={(e) => setRecursos(recursos.map((x, j) => (j === i ? { ...x, dias: Number(e.target.value) || 0 } : x)))} className={inputRH} />
                          <button type="button" aria-label="Quitar" onClick={() => setRecursos(recursos.filter((_, j) => j !== i))} className="text-ink-3 hover:text-bad"><X className="h-4 w-4" /></button>
                        </div>
                      ) : textoPlazo(r.dias)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editando && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setRecursos([...recursos, { nombre: "", tipo: "equipo", responsable: "", dias: -1 }])}>
              <Plus className="h-4 w-4" /> Agregar recurso interno
            </Button>
          )}

          <div className="mt-5 max-w-md">
            {editando ? (
              <CampoRH label="Curso de inducción">
                <select value={curso ?? ""} onChange={(e) => setCurso(e.target.value ? Number(e.target.value) : null)} className={inputRH}>
                  <option value="">Sin curso</option>
                  {resumen.cursos.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
                </select>
              </CampoRH>
            ) : (
              <p className="text-sm"><span className="font-semibold">Curso de inducción:</span> {resumen.cursos.find((x) => x.id === curso)?.titulo ?? "Sin curso"}</p>
            )}
          </div>
          <p className="mt-4 text-[11px] text-ink-3">
            Al iniciar se envía la solicitud de documentos al candidato y un correo a cada responsable interno que sea usuario de la Cuenta. Estos cambios aplican solo a esta persona; la plantilla no cambia.
          </p>
        </>
      )}
      {error && resumen && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={iniciar} disabled={ocupado || !resumen?.puedeIniciar}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Iniciar Onboarding
        </Button>
      </div>
    </ModalMarco>
  );
}
