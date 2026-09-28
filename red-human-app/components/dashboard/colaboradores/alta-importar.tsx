"use client";

/* Colaboradores · alta manual, importación básica y edición de datos base (Desempeño v2 · Fase 4,
   2026-09-27). Empleados que ya trabajan en la empresa entran al roster SIN pasar por Vacantes,
   Contratación u Onboarding. Antes de guardar se muestran posibles duplicados y errores; RH confirma.
   Desempeño, Clima y Conocimiento toman de aquí empresa, área, puesto y jefe. */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Save, UserPlus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { CampoRH, ModalMarco, inputRH } from "@/components/dashboard/modulos-rh";
import { cn } from "@/lib/utils";
import {
  altaColaborador, confirmarImportacionColaboradores, editarColaborador, fetchColaboradores, urlFormatoImportacionColaboradores,
  vistaPreviaImportacionColaboradores,
  type AltaColaboradorDatos, type Colaborador, type ColaboradorDetalle, type FilaImportacionColaborador,
} from "@/lib/api";

/** Selector de jefe: SIEMPRE otra persona del roster (su código COL-####). */
function SelectorJefe({ valor, onCambio, excluir }: { valor: string; onCambio: (v: string) => void; excluir?: string }) {
  const [roster, setRoster] = useState<Colaborador[]>([]);
  useEffect(() => {
    fetchColaboradores(true).then((c) => setRoster(c ?? []));
  }, []);
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} className={inputRH}>
      <option value="">Sin jefe registrado</option>
      {roster.filter((c) => c.id !== excluir).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.puesto ? ` · ${c.puesto}` : ""}</option>)}
    </select>
  );
}

export function ModalAltaColaborador({ onClose, onCreado }: { onClose: () => void; onCreado: (c: Colaborador) => void }) {
  const [d, setD] = useState<AltaColaboradorDatos>({ nombre: "", correo: "", telefono: "", puesto: "", area: "", ubicacion: "", jefe: "", fecha_ingreso: "" });
  const [duplicado, setDuplicado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const campo = (k: keyof AltaColaboradorDatos) => ({ value: d[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setD({ ...d, [k]: e.target.value }); setDuplicado(""); } });

  async function guardar(confirmar: boolean) {
    if (!d.nombre.trim()) return setError("El nombre es obligatorio.");
    setOcupado(true);
    setError("");
    const r = await altaColaborador(d, confirmar);
    setOcupado(false);
    if (!r.ok) {
      if (r.error.startsWith("Posible duplicado")) return setDuplicado(r.error);
      return setError(r.error);
    }
    onCreado(r.data);
  }

  return (
    <ModalMarco titulo="Alta manual de colaborador" subtitulo="Para empleados que ya trabajan en la empresa; no pasa por Vacantes, Contratación ni Onboarding." onClose={onClose} ancho="max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoRH label="Nombre completo"><input autoFocus {...campo("nombre")} className={inputRH} /></CampoRH>
        <CampoRH label="Correo"><input type="email" {...campo("correo")} className={inputRH} /></CampoRH>
        <CampoRH label="Teléfono (WhatsApp)"><input {...campo("telefono")} className={inputRH} /></CampoRH>
        <CampoRH label="Puesto"><input {...campo("puesto")} className={inputRH} /></CampoRH>
        <CampoRH label="Área"><input {...campo("area")} className={inputRH} /></CampoRH>
        <CampoRH label="Sede / ubicación"><input {...campo("ubicacion")} className={inputRH} /></CampoRH>
        <CampoRH label="Jefe directo" ayuda="Si tiene usuario en el sistema, se propone como evaluador en Desempeño.">
          <SelectorJefe valor={d.jefe ?? ""} onCambio={(v) => setD({ ...d, jefe: v })} />
        </CampoRH>
        <CampoRH label="Fecha de ingreso (opcional)"><input type="date" {...campo("fecha_ingreso")} className={inputRH} /></CampoRH>
      </div>
      {duplicado && (
        <div className="mt-4 rounded-2xl border border-warn/30 bg-warn-soft/40 p-4 text-sm">
          <p className="flex items-start gap-2 text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {duplicado}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => guardar(true)} disabled={ocupado}>Es otra persona: dar de alta</Button>
        </div>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={() => guardar(false)} disabled={ocupado || Boolean(duplicado)}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Dar de alta
        </Button>
      </div>
    </ModalMarco>
  );
}

export function ModalImportarColaboradores({ onClose, onListo }: { onClose: () => void; onListo: (texto: string) => void }) {
  const archivo = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<FilaImportacionColaborador[] | null>(null);
  const [incluirDup, setIncluirDup] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function leer(f: File | undefined) {
    if (!f) return;
    setOcupado(true);
    setError("");
    const r = await vistaPreviaImportacionColaboradores(f);
    setOcupado(false);
    if (archivo.current) archivo.current.value = "";
    if (!r.ok) return setError(r.error);
    setFilas(r.data.filas);
  }

  const validas = (filas ?? []).filter((f) => !f.errores.length);
  const aImportar = validas.filter((f) => incluirDup || !f.duplicados.length);

  async function confirmar() {
    setOcupado(true);
    const r = await confirmarImportacionColaboradores(validas.map((f) => f.datos), incluirDup);
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onListo(`${r.data.creados.length} colaborador(es) importados.` +
      (r.data.omitidos.length ? ` ${r.data.omitidos.length} omitido(s) por posible duplicado.` : "") +
      (r.data.errores.length ? ` ${r.data.errores.length} con error.` : ""));
  }

  return (
    <ModalMarco titulo="Importar colaboradores" subtitulo="Primero revisas errores y posibles duplicados; nada se guarda hasta que confirmes." onClose={onClose} ancho="max-w-5xl">
      <input ref={archivo} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void leer(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => archivo.current?.click()} disabled={ocupado}>
          {ocupado && !filas ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} {filas ? "Elegir otro archivo" : "Elegir archivo (.xlsx o .csv)"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.open(urlFormatoImportacionColaboradores(), "_blank")}><Download className="h-4 w-4" /> Formato de ejemplo</Button>
      </div>
      {filas && (
        <>
          <div className="mt-4 scroll-x rounded-2xl border border-border-soft">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
                <tr><th className="px-3 py-2">Fila</th><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Puesto · área</th><th className="px-3 py-2">Jefe</th><th className="px-3 py-2">Revisión</th></tr>
              </thead>
              <tbody className="divide-y divide-border-faint">
                {filas.map((f) => (
                  <tr key={f.fila} className={cn(f.errores.length ? "bg-bad-soft/30" : f.duplicados.length ? "bg-warn-soft/30" : "")}>
                    <td className="px-3 py-2 font-mono text-xs">{f.fila}</td>
                    <td className="px-3 py-2">{f.datos.nombre || "—"}<span className="block text-[11px] text-ink-3">{f.datos.correo}</span></td>
                    <td className="px-3 py-2 text-xs">{[f.datos.puesto, f.datos.area].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-xs">{f.datos.jefe || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {f.errores.length > 0 && <span className="text-bad">{f.errores.join(" ")}</span>}
                      {!f.errores.length && f.duplicados.length > 0 && (
                        <span className="text-warn">Posible duplicado: {f.duplicados.map((x) => `${x.nombre} (${x.motivos.join(", ")})`).join("; ")}</span>
                      )}
                      {!f.errores.length && !f.duplicados.length && <Badge tone="good">Listo</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={incluirDup} onChange={(e) => setIncluirDup(e.target.checked)} className="h-4 w-4 rounded border-border-soft text-brand" />
            Importar también los posibles duplicados (son otras personas)
          </label>
        </>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={confirmar} disabled={ocupado || !aImportar.length}>
          {ocupado && filas ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Confirmar e importar {aImportar.length}
        </Button>
      </div>
    </ModalMarco>
  );
}

export function ModalEditarColaborador({ colaborador, onClose, onGuardado }: { colaborador: ColaboradorDetalle; onClose: () => void; onGuardado: (c: ColaboradorDetalle) => void }) {
  const [d, setD] = useState({
    puesto: colaborador.puesto ?? "", area: colaborador.area ?? "", empresa: colaborador.empresa ?? "",
    ubicacion: colaborador.ubicacion ?? "", correo: colaborador.correo ?? "", telefono: colaborador.telefono ?? "", jefe: colaborador.jefeId ?? "",
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const campo = (k: keyof typeof d) => ({ value: d[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value }) });

  async function guardar() {
    setOcupado(true);
    setError("");
    const r = await editarColaborador(colaborador.id, d);
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onGuardado(r.data);
  }

  return (
    <ModalMarco titulo={`Datos de ${colaborador.nombre}`} subtitulo="Base maestra: Desempeño, Clima y Conocimiento toman de aquí empresa, área, puesto y jefe." onClose={onClose} ancho="max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoRH label="Puesto"><input {...campo("puesto")} className={inputRH} /></CampoRH>
        <CampoRH label="Área"><input {...campo("area")} className={inputRH} /></CampoRH>
        <CampoRH label="Empresa"><input {...campo("empresa")} className={inputRH} /></CampoRH>
        <CampoRH label="Sede / ubicación"><input {...campo("ubicacion")} className={inputRH} /></CampoRH>
        <CampoRH label="Correo"><input type="email" {...campo("correo")} className={inputRH} /></CampoRH>
        <CampoRH label="Teléfono"><input {...campo("telefono")} className={inputRH} /></CampoRH>
        <CampoRH label="Jefe directo"><SelectorJefe valor={d.jefe} onCambio={(v) => setD({ ...d, jefe: v })} excluir={colaborador.id} /></CampoRH>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado}>{ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar</Button>
      </div>
    </ModalMarco>
  );
}
