"use client";

/* Editor ÚNICO de criterios de Desempeño v2 (2026-09-27): lo usan el asistente «Crear evaluación» (paso 4),
   la edición del borrador y las Plantillas de Desempeño. Dos tipos:
   · Medible — unidad, meta (opcional: la IA nunca la inventa), sentido del indicador y fórmula (tope 100 %).
   · Descriptivo — qué se espera observar + escala 1-5 con significado (sin casillas de meta/real).
   Pesos: iguales por defecto; «Personalizar pesos» exige que sumen 100 % antes de iniciar. */

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { inputRH } from "@/components/dashboard/modulos-rh";
import { cn } from "@/lib/utils";
import type { CriterioDesempeno, NivelEscala, TipoCriterio } from "@/lib/api";

export const ESCALA_POR_DEFECTO: NivelEscala[] = [
  { valor: 1, significado: "No cumple lo esperado" },
  { valor: 2, significado: "Cumple parcialmente" },
  { valor: 3, significado: "Cumple lo esperado" },
  { valor: 4, significado: "Supera lo esperado" },
  { valor: 5, significado: "Es referente para el equipo" },
];

const nuevoId = () => `c${Math.random().toString(36).slice(2, 7)}`;

export function criterioVacio(tipo: TipoCriterio): CriterioDesempeno {
  return tipo === "medible"
    ? { id: nuevoId(), tipo, nombre: "", descripcion: "", unidad: "", meta: null, sentido: "mayor_es_mejor", peso: null }
    : { id: nuevoId(), tipo, nombre: "", descripcion: "", esperado: "", escala: ESCALA_POR_DEFECTO, peso: null };
}

export function sumaPesos(criterios: CriterioDesempeno[]) {
  return Math.round(criterios.reduce((a, c) => a + Number(c.peso ?? 0), 0) * 100) / 100;
}

/** Lo que se manda al guardar: sin criterios vacíos; con pesos iguales, sin pesos. */
export function criteriosParaGuardar(criterios: CriterioDesempeno[], pesosPersonalizados: boolean): CriterioDesempeno[] {
  return criterios
    .filter((c) => c.nombre.trim())
    .map((c) => ({ ...c, nombre: c.nombre.trim(), peso: pesosPersonalizados ? Number(c.peso ?? 0) : null }));
}

export function EditorCriterios({
  criterios, onCambio, pesosPersonalizados, onPesosPersonalizados, soloLectura = false,
}: {
  criterios: CriterioDesempeno[];
  onCambio: (c: CriterioDesempeno[]) => void;
  pesosPersonalizados: boolean;
  onPesosPersonalizados: (v: boolean) => void;
  soloLectura?: boolean;
}) {
  const set = (i: number, c: CriterioDesempeno) => onCambio(criterios.map((x, k) => (k === i ? c : x)));
  const cambiarTipo = (i: number, tipo: TipoCriterio) => {
    const base = criterioVacio(tipo);
    const c = criterios[i];
    set(i, { ...base, id: c.id, nombre: c.nombre, descripcion: c.descripcion, peso: c.peso });
  };
  const suma = sumaPesos(criterios.filter((c) => c.nombre.trim()));

  function activarPesos(v: boolean) {
    onPesosPersonalizados(v);
    if (v && criterios.every((c) => c.peso === null || c.peso === undefined)) {
      const n = criterios.length || 1;
      const base = Math.floor((100 / n) * 100) / 100;
      onCambio(criterios.map((c, i) => ({ ...c, peso: i === 0 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base })));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-2">{criterios.length} criterio(s)</p>
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" disabled={soloLectura} checked={pesosPersonalizados} onChange={(e) => activarPesos(e.target.checked)} className="h-4 w-4 rounded border-border-soft text-brand" />
          Personalizar pesos
        </label>
      </div>
      {pesosPersonalizados ? (
        <p className={cn("text-xs font-semibold", Math.abs(suma - 100) < 0.01 ? "text-good" : "text-warn")}>
          Suma de pesos: {suma} % {Math.abs(suma - 100) < 0.01 ? "· lista para iniciar" : "· debe sumar 100 % para poder iniciar"}
        </p>
      ) : (
        <p className="text-xs text-ink-3">Todos los criterios pesan igual.</p>
      )}

      <ol className="flex flex-col gap-3">
        {criterios.map((c, i) => (
          <li key={c.id} className="rounded-2xl border border-border-soft bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-ink-3">{i + 1}.</span>
              <div className="inline-flex rounded-lg border border-border-soft p-0.5" role="radiogroup" aria-label="Tipo de criterio">
                {(["medible", "descriptivo"] as TipoCriterio[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={c.tipo === t}
                    disabled={soloLectura}
                    onClick={() => cambiarTipo(i, t)}
                    className={cn("rounded-md px-3 py-1 text-xs font-semibold capitalize", c.tipo === t ? "bg-brand text-white" : "text-ink-2 hover:bg-surface-2")}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {pesosPersonalizados && (
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-2">
                  Peso
                  <input
                    type="number" min={0} max={100} step="0.01" disabled={soloLectura}
                    value={c.peso ?? ""}
                    onChange={(e) => set(i, { ...c, peso: e.target.value === "" ? null : Number(e.target.value) })}
                    className="h-9 w-20 rounded-lg border border-border-soft bg-surface px-2 text-sm outline-none focus:border-brand"
                  />
                  %
                </label>
              )}
              {!soloLectura && (
                <button onClick={() => onCambio(criterios.filter((_, k) => k !== i))} className={cn("grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-bad-soft hover:text-bad", !pesosPersonalizados && "ml-auto")} aria-label="Quitar criterio">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input disabled={soloLectura} value={c.nombre} onChange={(e) => set(i, { ...c, nombre: e.target.value })} placeholder="Nombre del criterio" className={cn(inputRH, "sm:col-span-2")} />
              <input disabled={soloLectura} value={c.descripcion ?? ""} onChange={(e) => set(i, { ...c, descripcion: e.target.value })} placeholder="Qué mide y por qué importa (opcional)" className={cn(inputRH, "sm:col-span-2")} />
            </div>

            {c.tipo === "medible" ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <input disabled={soloLectura} value={c.unidad ?? ""} onChange={(e) => set(i, { ...c, unidad: e.target.value })} placeholder="Unidad (%, proyectos, días…)" className={inputRH} />
                <input
                  type="number" disabled={soloLectura}
                  value={c.meta ?? ""}
                  onChange={(e) => set(i, { ...c, meta: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="Meta (la captura RH)"
                  className={inputRH}
                />
                <select disabled={soloLectura} value={c.sentido ?? "mayor_es_mejor"} onChange={(e) => set(i, { ...c, sentido: e.target.value as CriterioDesempeno["sentido"] })} className={inputRH} aria-label="Sentido del indicador">
                  <option value="mayor_es_mejor">Mayor es mejor</option>
                  <option value="menor_es_mejor">Menor es mejor</option>
                </select>
                <p className="text-[11px] text-ink-3 sm:col-span-3">
                  Fórmula de cumplimiento: {c.sentido === "menor_es_mejor" ? "Meta ÷ Real × 100" : "Real ÷ Meta × 100"} (tope 100 %).
                  {c.meta === null || c.meta === undefined ? " Sin meta, este criterio no se califica hasta capturarla." : ""}
                </p>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <input disabled={soloLectura} value={c.esperado ?? ""} onChange={(e) => set(i, { ...c, esperado: e.target.value })} placeholder="Qué se espera observar" className={inputRH} />
                <div className="grid gap-1.5 sm:grid-cols-5">
                  {(c.escala?.length === 5 ? c.escala : ESCALA_POR_DEFECTO).map((n, k) => (
                    <label key={n.valor} className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-ink-3">Nivel {n.valor}</span>
                      <input
                        disabled={soloLectura}
                        value={n.significado}
                        onChange={(e) => {
                          const escala = [...(c.escala?.length === 5 ? c.escala : ESCALA_POR_DEFECTO)];
                          escala[k] = { ...n, significado: e.target.value };
                          set(i, { ...c, escala });
                        }}
                        className="h-9 rounded-lg border border-border-soft bg-surface px-2 text-[12px] outline-none focus:border-brand"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {!soloLectura && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onCambio([...criterios, criterioVacio("medible")])}><Plus className="h-4 w-4" /> Criterio medible</Button>
          <Button size="sm" variant="outline" onClick={() => onCambio([...criterios, criterioVacio("descriptivo")])}><Plus className="h-4 w-4" /> Criterio descriptivo</Button>
        </div>
      )}
    </div>
  );
}
