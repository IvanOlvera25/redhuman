"use client";

/* Estado REAL de los avisos de una actividad (Fraiche, cambios integrados 2026-10-02 §1, §2, §9, §12): por
   destinatario y canal — Enviado / Pendiente (falta vincular su chat; se entrega solo al vincularlo) / Fallido
   (con el motivo) — más «Copiar liga» y «Reenviar». Se usa en IPV Red Human, entrevistas humanas y evaluaciones. */

import { useState } from "react";
import { CheckCircle2, Clock, Copy, RotateCw, XCircle } from "lucide-react";
import { lineasEnvios } from "@/lib/api";
import type { EnvioAviso } from "@/lib/data";
import { cn } from "@/lib/utils";

/** Solo el último lote (mismo minuto) — lo que pasó en el envío más reciente. */
function ultimoLote(envios: EnvioAviso[] | undefined): EnvioAviso[] {
  const lista = envios ?? [];
  if (!lista.length) return [];
  const clave = (lista[lista.length - 1].fecha || "").slice(0, 16);
  return lista.filter((e) => (e.fecha || "").slice(0, 16) === clave);
}

export function EstadoEnvios({
  envios,
  ligas = [],
  reenvios = [],
  titulo = "Avisos",
  compacto = false,
}: {
  envios?: EnvioAviso[];
  /** Ligas que se pueden copiar: [{etiqueta, url}] — cada destinatario tiene la SUYA. */
  ligas?: { etiqueta: string; url?: string | null }[];
  /** Botones «Reenviar…»: [{etiqueta, onClick}] (p. ej. al candidato / al entrevistador). */
  reenvios?: { etiqueta: string; onClick: () => Promise<void> | void }[];
  titulo?: string;
  compacto?: boolean;
}) {
  const [copiada, setCopiada] = useState("");
  const [enviando, setEnviando] = useState("");
  const lote = ultimoLote(envios);
  const lineas = lineasEnvios(lote);
  const fecha = lote[0]?.fecha ? new Date(lote[0].fecha).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "";
  const ligasValidas = ligas.filter((l) => l.url);
  if (!lineas.length && !ligasValidas.length && !reenvios.length) return null;

  return (
    <div className={cn("rounded-xl border border-border-soft bg-surface-2/50", compacto ? "p-2.5" : "p-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          {titulo}
          {fecha ? ` · ${fecha}` : ""}
          {lote[0]?.por ? ` · ${lote[0].por}` : ""}
        </p>
      </div>
      {lineas.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {lineas.map((l, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug">
              {l.estado === "enviado" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
              ) : l.estado === "pendiente" ? (
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />
              )}
              <span className={cn("min-w-0 break-words", l.estado === "enviado" ? "text-ink-2" : l.estado === "pendiente" ? "text-warn" : "text-bad")}>
                {l.texto.replace(/ Liga para vincularlo: \S+/, "")}
                {l.ligaVinculo && (
                  <button
                    type="button"
                    className="ml-1 font-semibold text-brand hover:underline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(l.ligaVinculo!);
                      setCopiada(l.ligaVinculo!);
                    }}
                  >
                    {copiada === l.ligaVinculo ? "Liga de vinculación copiada" : "Copiar liga de vinculación"}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[12px] text-ink-3">Aún no se ha enviado ningún aviso.</p>
      )}
      {(ligasValidas.length > 0 || reenvios.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ligasValidas.map((l) => (
            <button
              key={l.etiqueta}
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(l.url!);
                setCopiada(l.url!);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-soft bg-bg px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-surface-2"
            >
              <Copy className="h-3.5 w-3.5" /> {copiada === l.url ? "Copiada" : l.etiqueta}
            </button>
          ))}
          {reenvios.map((r) => (
            <button
              key={r.etiqueta}
              type="button"
              disabled={Boolean(enviando)}
              onClick={async () => {
                setEnviando(r.etiqueta);
                try {
                  await r.onClick();
                } finally {
                  setEnviando("");
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-soft bg-bg px-2.5 text-[12px] font-semibold text-brand hover:bg-brand-soft/40 disabled:opacity-50"
            >
              <RotateCw className={cn("h-3.5 w-3.5", enviando === r.etiqueta && "animate-spin")} /> {enviando === r.etiqueta ? "Enviando…" : r.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
