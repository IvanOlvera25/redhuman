"use client";

/* Importar criterios desde Excel/CSV (Desempeño v2, 2026-09-27): el archivo se lee en el servidor y se
   muestra una VISTA PREVIA — columnas detectadas (y las que no se reconocen), cada fila con su tipo y sus
   errores. Nada se guarda hasta que RH confirma «Usar N criterios»: entonces pasan al editor de la
   evaluación o de la plantilla, donde todavía se pueden revisar. */

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { ModalMarco } from "@/components/dashboard/modulos-rh";
import { cn } from "@/lib/utils";
import { urlFormatoCriteriosDesempeno, vistaPreviaCriteriosDesempeno, type CriterioDesempeno, type VistaPreviaCriterios } from "@/lib/api";

export function ImportarCriterios({ onClose, onConfirmar }: { onClose: () => void; onConfirmar: (criterios: CriterioDesempeno[]) => void }) {
  const archivo = useRef<HTMLInputElement>(null);
  const [vista, setVista] = useState<VistaPreviaCriterios | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function leer(f: File | undefined) {
    if (!f) return;
    setNombreArchivo(f.name);
    setOcupado(true);
    setError("");
    const r = await vistaPreviaCriteriosDesempeno(f);
    setOcupado(false);
    if (archivo.current) archivo.current.value = "";
    if (!r.ok) return setError(r.error);
    setVista(r.data);
  }

  return (
    <ModalMarco titulo="Importar criterios desde Excel" subtitulo="Primero ves una vista previa; nada se guarda hasta que confirmes." onClose={onClose} ancho="max-w-5xl">
      <input ref={archivo} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void leer(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => archivo.current?.click()} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} {vista ? "Elegir otro archivo" : "Elegir archivo (.xlsx o .csv)"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.open(urlFormatoCriteriosDesempeno(), "_blank")}><Download className="h-4 w-4" /> Formato de ejemplo</Button>
        {nombreArchivo && <span className="text-xs text-ink-3">{nombreArchivo}</span>}
      </div>

      {vista && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="self-center text-ink-3">Columnas detectadas:</span>
            {vista.columnasDetectadas.map((c) => (
              <Badge key={c} tone={vista.columnasDesconocidas.includes(c) ? "warn" : "good"}>{c}{vista.columnasDesconocidas.includes(c) ? " · se ignora" : ""}</Badge>
            ))}
          </div>
          <p className="text-sm">
            <b className="text-good">{vista.validos.length} criterio(s) válidos</b>
            {vista.conErrores > 0 && <> · <b className="text-bad">{vista.conErrores} fila(s) con error</b> (no se importan)</>}
          </p>
          <div className="scroll-x rounded-2xl border border-border-soft">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
                <tr><th className="px-3 py-2">Fila</th><th className="px-3 py-2">Criterio</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Medición</th><th className="px-3 py-2">Estado</th></tr>
              </thead>
              <tbody className="divide-y divide-border-faint">
                {vista.filas.map((f) => (
                  <tr key={f.fila} className={cn(f.errores.length && "bg-bad-soft/30")}>
                    <td className="px-3 py-2 font-mono text-xs">{f.fila}</td>
                    <td className="px-3 py-2">{f.criterio?.nombre ?? f.valores.nombre ?? "—"}</td>
                    <td className="px-3 py-2 capitalize">{f.criterio?.tipo ?? f.valores.tipo ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-ink-2">
                      {f.criterio?.tipo === "medible"
                        ? `Meta ${f.criterio.meta ?? "sin capturar"} ${f.criterio.unidad ?? ""} · ${f.criterio.sentido === "menor_es_mejor" ? "menor es mejor" : "mayor es mejor"}`
                        : f.criterio?.esperado || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{f.errores.length ? <span className="text-bad">{f.errores.join(" ")}</span> : <span className="text-good">Listo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" disabled={!vista?.validos.length} onClick={() => vista && onConfirmar(vista.validos)}>
          Usar {vista?.validos.length ?? 0} criterio(s)
        </Button>
      </div>
    </ModalMarco>
  );
}
