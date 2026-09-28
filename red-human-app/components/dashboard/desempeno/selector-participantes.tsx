"use client";

/* Paso 5 «Seleccionar colaboradores y evaluadores» (Desempeño v2, 2026-09-27) — lo usan el asistente de
   creación y «Agregar colaboradores» del detalle. Personas SIEMPRE del roster maestro. Si alguien tiene un
   puesto distinto al de la evaluación se advierte (podría necesitar otros criterios) y RH decide: aplicar
   los mismos criterios o sacarlo para crear otra evaluación. El evaluador es un Usuario de la Cuenta. */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui";
import { inputRH } from "@/components/dashboard/modulos-rh";
import { cn } from "@/lib/utils";
import { fetchColaboradores, fetchEvaluadoresDesempeno, fetchPropuestaEvaluadores, type Colaborador, type EvaluadorDesempeno, type PropuestaEvaluador } from "@/lib/api";

/** Misma regla que el backend (`routers.desempeno.mismo_puesto`): «Gerentes de proyectos» ≈ «Gerente de proyecto». */
function palabras(texto: string) {
  const plano = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const salida = new Set<string>();
  for (let w of plano.match(/[a-z0-9]+/g) ?? []) {
    if (w.length <= 2 || ["del", "los", "las"].includes(w)) continue;
    if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
    salida.add(w);
  }
  return salida;
}
export function mismoPuesto(equipo: string, puesto: string) {
  const a = palabras(equipo);
  const b = palabras(puesto);
  if (!a.size || !b.size) return true;
  return [...a].every((x) => b.has(x)) || [...b].every((x) => a.has(x));
}

export interface SeleccionParticipantes {
  ids: string[];
  evaluadores: Record<string, number | null>;
  /** Personas de otro puesto que RH decidió sacar para crear otra evaluación. */
  paraOtraEvaluacion: { id: string; nombre: string; puesto: string }[];
}

export function SelectorParticipantes({ equipo, yaDentro = [], valor, onCambio }: {
  equipo: string;
  yaDentro?: string[];
  valor: SeleccionParticipantes;
  onCambio: (v: SeleccionParticipantes) => void;
}) {
  const [roster, setRoster] = useState<Colaborador[] | null>(null);
  const [evaluadores, setEvaluadores] = useState<EvaluadorDesempeno[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [aceptados, setAceptados] = useState<string[]>([]); // otros puestos a los que RH aplica los mismos criterios
  const [propuestas, setPropuestas] = useState<Record<string, PropuestaEvaluador>>({});

  // Evaluador propuesto = su jefe en la base maestra (si tiene usuario). Si falta, RH elige: nunca bloquea.
  useEffect(() => {
    const faltan = valor.ids.filter((id) => !(id in propuestas));
    if (!faltan.length) return;
    fetchPropuestaEvaluadores(faltan).then((resp) => {
      // cada id pedido queda marcado (aunque no venga) para no volver a pedirlo en bucle
      const p: Record<string, PropuestaEvaluador> = Object.fromEntries(faltan.map((id) => [id, { jefe: null, usuario: null, motivo: "" }]));
      Object.assign(p, resp ?? {});
      setPropuestas((prev) => ({ ...prev, ...p }));
      const evs = { ...valor.evaluadores };
      let cambio = false;
      for (const [id, prop] of Object.entries(p)) {
        if (prop.usuario && evs[id] === undefined) {
          evs[id] = prop.usuario.id;
          cambio = true;
        }
      }
      if (cambio) onCambio({ ...valor, evaluadores: evs });
    });
  }, [valor, propuestas, onCambio]);

  useEffect(() => {
    fetchColaboradores(true).then((c) => setRoster(c ?? []));
    fetchEvaluadoresDesempeno().then((e) => setEvaluadores(e ?? []));
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (roster ?? []).filter((c) => !q || c.nombre.toLowerCase().includes(q) || (c.puesto ?? "").toLowerCase().includes(q) || (c.area ?? "").toLowerCase().includes(q));
  }, [roster, busqueda]);
  const porId = useMemo(() => Object.fromEntries((roster ?? []).map((c) => [c.id, c])), [roster]);
  const otros = valor.ids.filter((id) => porId[id] && !mismoPuesto(equipo, porId[id].puesto ?? "") && !aceptados.includes(id));

  function alternar(id: string) {
    const dentro = valor.ids.includes(id);
    const ids = dentro ? valor.ids.filter((x) => x !== id) : [...valor.ids, id];
    const evs = { ...valor.evaluadores };
    if (dentro) delete evs[id];
    onCambio({ ...valor, ids, evaluadores: evs });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, puesto o área…" className={cn(inputRH, "pl-9")} />
      </label>

      {otros.length > 0 && (
        <div className="rounded-2xl border border-warn/30 bg-warn-soft/40 p-4 text-sm">
          <p className="flex items-start gap-2 font-semibold text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {otros.length} persona(s) tienen un puesto distinto a «{equipo || "la evaluación"}» y podrían necesitar criterios distintos.
          </p>
          <p className="mt-1 text-[12px] text-ink-2">{otros.map((id) => `${porId[id].nombre} (${porId[id].puesto || "sin puesto"})`).join(", ")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAceptados([...aceptados, ...otros])}>Aplicar los mismos criterios</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCambio({
                ids: valor.ids.filter((x) => !otros.includes(x)),
                evaluadores: Object.fromEntries(Object.entries(valor.evaluadores).filter(([k]) => !otros.includes(k))),
                paraOtraEvaluacion: [...valor.paraOtraEvaluacion, ...otros.map((id) => ({ id, nombre: porId[id].nombre, puesto: porId[id].puesto ?? "" }))],
              })}
            >
              Sacarlos y crear otra evaluación
            </Button>
          </div>
        </div>
      )}

      <div className="max-h-[44vh] overflow-y-auto rounded-2xl border border-border-soft">
        {roster === null ? (
          <div className="grid place-items-center py-10 text-ink-3"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtrados.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">No hay colaboradores activos que coincidan.</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {filtrados.map((c) => {
              const dentro = yaDentro.includes(c.id);
              const marcado = valor.ids.includes(c.id);
              const distinto = !mismoPuesto(equipo, c.puesto ?? "");
              return (
                <li key={c.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", dentro && "opacity-50")}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input type="checkbox" disabled={dentro} checked={marcado} onChange={() => alternar(c.id)} className="h-4 w-4 rounded border-border-soft text-brand" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{c.nombre}</span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {[c.area, c.puesto].filter(Boolean).join(" · ") || "Sin puesto"} · {c.id}
                        {distinto && <span className="ml-1 font-semibold text-warn">· otro puesto</span>}
                      </span>
                    </span>
                  </label>
                  {dentro && <span className="shrink-0 text-[11px] font-semibold text-good">Ya está</span>}
                  {marcado && propuestas[c.id]?.motivo && (
                    <span className={cn("w-full text-[11px] sm:order-last", propuestas[c.id].usuario ? "text-good" : "text-warn")}>
                      {propuestas[c.id].motivo}
                    </span>
                  )}
                  {marcado && (
                    <select
                      value={valor.evaluadores[c.id] ?? ""}
                      onChange={(e) => onCambio({ ...valor, evaluadores: { ...valor.evaluadores, [c.id]: e.target.value ? Number(e.target.value) : null } })}
                      className="h-9 w-full max-w-[14rem] rounded-lg border border-border-soft bg-surface px-2 text-[12px] outline-none focus:border-brand sm:w-auto"
                      aria-label={`Evaluador de ${c.nombre}`}
                    >
                      <option value="">Evaluador: yo (quien crea)</option>
                      {evaluadores.map((u) => <option key={u.id} value={u.id}>Evaluador: {u.nombre}</option>)}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-ink-3">{valor.ids.length} seleccionado(s). Si alguien no aparece, dalo de alta en Colaboradores.</p>
    </div>
  );
}
