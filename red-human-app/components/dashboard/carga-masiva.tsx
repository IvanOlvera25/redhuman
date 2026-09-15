"use client";

/* Fase 2 (2026-09-15) — Carga masiva desde CSV/Excel para Usuarios, Clientes y Plantillas.

   Un solo componente: botón «Carga masiva» → modal con (1) liga para descargar el CSV de ejemplo
   con las columnas exactas, (2) selector de archivo .csv/.xlsx, (3) resultado fila por fila
   (creadas y fallas con su motivo). El backend valida cada fila con las MISMAS reglas que el alta
   individual y crea las que sí pasan; aquí solo se muestra lo que regresó. */

import { useRef, useState } from "react";
import { Download, Loader2, Upload, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { Aviso } from "@/components/dashboard/subida";
import { cargaMasiva, urlPlantillaCargaMasiva, type ResultadoCargaMasiva, type TipoCargaMasiva } from "@/lib/api";

const TITULOS: Record<TipoCargaMasiva, string> = {
  usuarios: "usuarios",
  clientes: "clientes",
  plantillas: "plantillas",
};

const COLUMNAS: Record<TipoCargaMasiva, string> = {
  usuarios: "correo, nombre, puesto, telefono, rol (Usuario/Administrador), password (opcional: si va vacía se genera una temporal)",
  clientes: "nombre, razon_social, nombre_comercial, estado y opcionalmente contacto_nombre, contacto_apellidos, contacto_puesto, contacto_correo, contacto_telefono",
  plantillas: "nombre, cliente (nombre del Cliente o vacío = General), titulo, area, ubicacion, modalidad, sueldo_desde, sueldo_hasta, sueldo_moneda, sueldo_periodicidad, seniority, requisitos, requisitos_deseables, responsabilidades, beneficios, descripcion, enfoque_entrevista — listas separadas por « | »",
};

export function BotonCargaMasiva({ tipo, onTerminado }: { tipo: TipoCargaMasiva; onTerminado?: () => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
        <Upload className="h-4 w-4" /> Carga masiva
      </Button>
      {abierto && (
        <ModalCargaMasiva
          tipo={tipo}
          onClose={(huboCambios) => {
            setAbierto(false);
            if (huboCambios) onTerminado?.();
          }}
        />
      )}
    </>
  );
}

function ModalCargaMasiva({ tipo, onClose }: { tipo: TipoCargaMasiva; onClose: (huboCambios: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<ResultadoCargaMasiva | null>(null);

  async function procesar() {
    if (!archivo) return;
    setSubiendo(true);
    setError("");
    const r = await cargaMasiva(tipo, archivo);
    setSubiendo(false);
    if (!r.ok) return setError(r.error);
    setResultado(r.data);
  }

  const huboCambios = (resultado?.creados ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => onClose(huboCambios)}>
      <Card className="w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold">Carga masiva de {TITULOS[tipo]}</h2>
            <p className="mt-1 text-sm text-ink-2">
              Sube un archivo <b>.csv</b> o <b>.xlsx</b> con una fila por registro. La primera fila son los nombres de las columnas.
            </p>
          </div>
          <button type="button" onClick={() => onClose(huboCambios)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-border-soft bg-surface p-3 text-[12px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">Columnas</p>
          <p className="mt-1">{COLUMNAS[tipo]}</p>
          <a href={urlPlantillaCargaMasiva(tipo)} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-brand hover:underline">
            <Download className="h-3.5 w-3.5" /> Descargar CSV de ejemplo
          </a>
        </div>

        {!resultado && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={subiendo}>
              <Upload className="h-4 w-4" /> {archivo ? archivo.name : "Elegir archivo"}
            </Button>
            <Button size="sm" onClick={procesar} disabled={!archivo || subiendo}>
              {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {subiendo ? "Procesando…" : "Procesar archivo"}
            </Button>
          </div>
        )}

        {error && <div className="mt-4"><Aviso tono="error" onCerrar={() => setError("")}>{error}</Aviso></div>}

        {resultado && (
          <div className="mt-4">
            <Aviso tono={resultado.errores === 0 ? "ok" : resultado.creados === 0 ? "error" : "warn"}>
              {resultado.creados} de {resultado.total} fila(s) creadas
              {resultado.errores > 0 ? ` · ${resultado.errores} con error (abajo el motivo por fila).` : "."}
            </Aviso>
            {resultado.fallas.length > 0 && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-bad/30">
                <table className="w-full text-[12px]">
                  <thead className="bg-bad-soft text-left text-[11px] uppercase tracking-wide text-bad">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Fila</th>
                      <th className="px-3 py-1.5 font-medium">Referencia</th>
                      <th className="px-3 py-1.5 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.fallas.map((f) => (
                      <tr key={f.fila} className="border-t border-border-faint">
                        <td className="px-3 py-1.5 font-mono">{f.fila}</td>
                        <td className="px-3 py-1.5">{f.referencia}</td>
                        <td className="px-3 py-1.5 text-ink-2">{f.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tipo === "usuarios" && resultado.filas.some((f) => f.passwordTemporal) && (
              <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-[12px] text-ink">
                <p className="font-semibold">Contraseñas temporales (se muestran UNA sola vez — compártelas de forma segura):</p>
                <ul className="mt-1 font-mono">
                  {resultado.filas
                    .filter((f) => f.passwordTemporal)
                    .map((f) => (
                      <li key={f.fila}>
                        {String(f.correo)} → {String(f.passwordTemporal)}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setResultado(null); setArchivo(null); }}>
                Subir otro archivo
              </Button>
              <Button size="sm" onClick={() => onClose(huboCambios)}>Listo</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
