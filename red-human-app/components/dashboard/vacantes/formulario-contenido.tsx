"use client";

/* Punto 11 — UN solo formulario de contenido para "Nueva vacante" y "Nueva plantilla".

   Parte 3 (2026-09-12) — estructura final, en este orden:
     1. Datos principales (captura ANTES de generar): Puesto → Área → Seniority → [Cliente, solo en
        Vacantes, vía `slotDatosPrincipales`] → Ubicación → Modalidad → Sueldo (Desde/Hasta/Moneda/
        Periodicidad o A convenir).
     2. Guía opcional para Red Human: Descripción breve → Indispensables → Deseables → Prestaciones.
     3. Un solo botón «Generar vacante con Red Human», ABAJO de (1) y (2).
     4. Tras generar, (2) se vuelve «Contenido generado por Red Human (editable)»: Descripción
        completa → Responsabilidades → Indispensables → Deseables → Prestaciones — mismos campos,
        siempre visibles y editables.
     5. Selección: Prefiltro (criterios con eliminatorias) → Entrevista Red Human (2 enfoques).
     Vacantes agrega después Gestión (Responsable → Colaboradores) y Publicación; Plantillas agrega
     encima Nombre/Alcance.

   Dos reglas NO NEGOCIABLES (también garantizadas en el servidor, ia._asegurar_capturado):
   - Red Human no inventa condiciones reales (sueldo, periodicidad, ubicación, modalidad, horario,
     prestaciones): lo que RH no capturó queda vacío/pendiente, nunca rellenado.
   - Red Human respeta lo capturado: indispensable sigue indispensable, deseable sigue deseable;
     solo complementa lo vacío. `contenidoDesdeGenerado` aplica exactamente eso del lado del cliente. */

import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { Button, Eyebrow } from "@/components/ui";
import { Area, CampoSueldo, Field, ListaEditable, Selector } from "@/components/dashboard/campos";
import {
  generarVacanteIA,
  ENFOQUES_ENTREVISTA,
  MONEDAS_SUELDO,
  PERIODICIDADES_SUELDO,
  SENIORITIES,
  type CriterioFiltro,
  type EnfoqueEntrevista,
  type PeriodicidadSueldo,
  type Plantilla,
  type VacanteGenerada,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export interface ContenidoVacante {
  /* --- 1. datos principales --- */
  titulo: string;
  area: string;
  seniority: string;
  ubicacion: string;
  modalidad: string;
  sueldo_desde: string; // texto numérico del input; vacío = sin dato
  sueldo_hasta: string;
  sueldo_moneda: string;
  sueldo_periodicidad: PeriodicidadSueldo | "";
  /* --- 2/4. guía → contenido generado (mismos campos) --- */
  descripcion: string;
  responsabilidades: string[];
  requisitos: string[]; // indispensables (lista); viaja al servidor unida por « · »
  requisitos_deseables: string[];
  beneficios: string[];
  /* --- 5. selección --- */
  preguntas_filtro: CriterioFiltro[];
  /** Fase 4 (Punto 6): enfoque de la Entrevista Red Human — solo 2 niveles. */
  enfoque_entrevista: EnfoqueEntrevista;
  /* --- avanzado (los llena la IA; editables pero colapsados) --- */
  resumen: string;
  perfil_ideal: string;
  palabras_clave: string[];
  avisos_cumplimiento: string[];
  texto_whatsapp: string;
  texto_bolsa: string;
}

export const CONTENIDO_VACIO: ContenidoVacante = {
  titulo: "",
  area: "",
  seniority: "",
  ubicacion: "",
  modalidad: "Presencial",
  sueldo_desde: "",
  sueldo_hasta: "",
  sueldo_moneda: "MXN",
  sueldo_periodicidad: "",
  descripcion: "",
  responsabilidades: [],
  requisitos: [],
  requisitos_deseables: [],
  beneficios: [],
  preguntas_filtro: [],
  enfoque_entrevista: "profesional",
  resumen: "",
  perfil_ideal: "",
  palabras_clave: [],
  avisos_cumplimiento: [],
  texto_whatsapp: "",
  texto_bolsa: "",
};

export const MODALIDADES = ["Presencial", "Híbrido", "Remoto"];
export const TIPOS_CRITERIO: { valor: CriterioFiltro["tipo"]; texto: string }[] = [
  { valor: "si_no", texto: "Sí / No" },
  { valor: "numero", texto: "Número" },
  { valor: "opcion", texto: "Opción" },
  { valor: "texto_corto", texto: "Texto corto" },
];

const SEPARADOR_REQUISITOS = " · ";

/** `requisitos` legado es texto separado por « · » (o saltos/;) → lista de indispensables. */
export function requisitosLista(texto: string | undefined): string[] {
  return (texto ?? "")
    .split(/\s*·\s*|;|\n/)
    .map((x) => x.replace(/^[\s.\-•]+|[\s.\-•]+$/g, ""))
    .filter(Boolean);
}

const clave = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Capturados primero y literal; después lo generado que no repita ni esté en `excluir`. */
function unirCapturado(capturados: string[], generados: string[] | undefined, excluir: string[] = []): string[] {
  const vistos = new Set(capturados.map(clave).filter(Boolean));
  const prohibidos = new Set(excluir.map(clave).filter(Boolean));
  const salida = capturados.filter((x) => x.trim());
  for (const g of generados ?? []) {
    const k = clave(g);
    if (!k || vistos.has(k) || prohibidos.has(k)) continue;
    vistos.add(k);
    salida.push(g.trim());
  }
  return salida;
}

/** Precarga TODOS los campos compartidos desde una plantilla. */
export function contenidoDesdePlantilla(p: Plantilla): ContenidoVacante {
  return {
    titulo: p.titulo,
    area: p.area,
    seniority: p.seniority ?? "",
    ubicacion: p.ubicacion ?? "",
    modalidad: p.modalidad || "Presencial",
    sueldo_desde: p.sueldoDesde ? String(p.sueldoDesde) : "",
    sueldo_hasta: p.sueldoHasta ? String(p.sueldoHasta) : "",
    sueldo_moneda: p.sueldoMoneda || "MXN",
    sueldo_periodicidad: p.sueldoPeriodicidad ?? "",
    descripcion: p.descripcion,
    responsabilidades: [...(p.responsabilidades ?? [])],
    requisitos: requisitosLista(p.requisitos),
    requisitos_deseables: [...(p.requisitosDeseables ?? [])],
    beneficios: [...(p.beneficios ?? [])],
    preguntas_filtro: [...(p.preguntasFiltro ?? [])],
    enfoque_entrevista: p.enfoqueEntrevista ?? "profesional",
    resumen: p.resumen,
    perfil_ideal: p.perfilIdeal,
    palabras_clave: [...(p.palabrasClave ?? [])],
    avisos_cumplimiento: [...(p.avisosCumplimiento ?? [])],
    texto_whatsapp: p.textoWhatsapp,
    texto_bolsa: p.textoBolsa,
  };
}

/** Vuelca lo que generó Red Human sobre el contenido actual RESPETANDO lo capturado: nunca toca
 * sueldo, seniority ni prestaciones; indispensables/deseables capturados quedan literal, en su
 * categoría y primero; la descripción breve se expande (decisión 3); lo demás solo rellena vacíos. */
export function contenidoDesdeGenerado(base: ContenidoVacante, g: VacanteGenerada): ContenidoVacante {
  return {
    ...base,
    descripcion: g.descripcion || base.descripcion,
    responsabilidades: base.responsabilidades.length ? base.responsabilidades : g.responsabilidades ?? [],
    requisitos: unirCapturado(base.requisitos, g.requisitos_indispensables, base.requisitos_deseables),
    requisitos_deseables: unirCapturado(base.requisitos_deseables, g.requisitos_deseables, base.requisitos),
    beneficios: base.beneficios, // regla 4: solo lo capturado por RH
    preguntas_filtro: base.preguntas_filtro.length ? base.preguntas_filtro : g.preguntas_filtro ?? [],
    resumen: base.resumen || g.resumen,
    perfil_ideal: base.perfil_ideal || g.perfil_ideal,
    palabras_clave: base.palabras_clave.length ? base.palabras_clave : g.palabras_clave ?? [],
    avisos_cumplimiento: g.avisos_cumplimiento ?? [],
    texto_whatsapp: base.texto_whatsapp || (g.texto_whatsapp ?? ""),
    texto_bolsa: base.texto_bolsa || (g.portal?.page ?? ""),
  };
}

/** true si ya hay contenido (capturado o generado) — la API no debe volver a generarlo al guardar. */
export function tieneContenidoManual(c: ContenidoVacante): boolean {
  return Boolean(c.responsabilidades.length || c.preguntas_filtro.length);
}

/** Datos principales obligatorios (Parte 3): se exigen para generar y para publicar. */
export function faltantesDatosPrincipales(c: ContenidoVacante): string[] {
  const faltan: string[] = [];
  if (!c.titulo.trim()) faltan.push("Puesto");
  if (!c.area.trim()) faltan.push("Área");
  if (!c.seniority) faltan.push("Seniority");
  if (!c.ubicacion.trim()) faltan.push("Ubicación");
  if (!c.modalidad) faltan.push("Modalidad");
  if (!c.sueldo_periodicidad) faltan.push("Periodicidad del sueldo (o «A convenir»)");
  else if (c.sueldo_periodicidad !== "a_convenir" && !c.sueldo_desde) faltan.push("Sueldo desde (o «A convenir»)");
  return faltan;
}

/** Cuerpo snake_case para POST /plantillas, PATCH /plantillas/{id}, POST /vacantes y /vacantes/generar. */
export function contenidoComoPayload(c: ContenidoVacante) {
  const desde = c.sueldo_desde ? Number(c.sueldo_desde) : null;
  const hasta = c.sueldo_hasta ? Number(c.sueldo_hasta) : null;
  return {
    titulo: c.titulo.trim(),
    area: c.area,
    seniority: c.seniority,
    ubicacion: c.ubicacion,
    modalidad: c.modalidad,
    sueldo_desde: c.sueldo_periodicidad === "a_convenir" ? null : desde,
    sueldo_hasta: c.sueldo_periodicidad === "a_convenir" ? null : hasta,
    sueldo_moneda: c.sueldo_moneda || "MXN",
    sueldo_periodicidad: c.sueldo_periodicidad,
    requisitos: c.requisitos.join(SEPARADOR_REQUISITOS),
    requisitos_indispensables: c.requisitos,
    descripcion: c.descripcion,
    responsabilidades: c.responsabilidades,
    requisitos_deseables: c.requisitos_deseables,
    beneficios: c.beneficios,
    preguntas_filtro: c.preguntas_filtro,
    enfoque_entrevista: c.enfoque_entrevista,
    resumen: c.resumen,
    perfil_ideal: c.perfil_ideal,
    palabras_clave: c.palabras_clave,
    avisos_cumplimiento: c.avisos_cumplimiento,
    texto_whatsapp: c.texto_whatsapp,
    texto_bolsa: c.texto_bolsa,
  };
}

export function Seccion({ titulo, children, ayuda }: { titulo: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <Eyebrow>{titulo}</Eyebrow>
        {ayuda && <p className="mt-0.5 text-xs text-ink-3">{ayuda}</p>}
      </div>
      {children}
    </section>
  );
}

function CriteriosEditor({ items, onChange }: { items: CriterioFiltro[]; onChange: (c: CriterioFiltro[]) => void }) {
  const set = (i: number, cambios: Partial<CriterioFiltro>) => onChange(items.map((x, j) => (j === i ? { ...x, ...cambios } : x)));
  return (
    <div className="flex flex-col gap-2">
      {items.map((c, i) => (
        <div key={i} className="rounded-xl border border-border-soft bg-surface-2/50 p-3">
          <div className="flex items-start gap-2">
            <input
              value={c.pregunta}
              onChange={(e) => set(i, { pregunta: e.target.value })}
              placeholder="Pregunta cerrada al candidato"
              className="h-10 flex-1 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button type="button" aria-label="Quitar criterio" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mt-2.5 text-ink-3 hover:text-bad">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <select
              value={c.tipo}
              onChange={(e) => set(i, { tipo: e.target.value as CriterioFiltro["tipo"] })}
              className="h-10 rounded-xl border border-border-soft bg-surface px-2.5 text-sm outline-none focus:border-brand"
            >
              {TIPOS_CRITERIO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.texto}
                </option>
              ))}
            </select>
            <input
              value={c.respuesta_esperada}
              onChange={(e) => set(i, { respuesta_esperada: e.target.value })}
              placeholder="Respuesta que cumple (ej. Sí, ≥ 2 años)"
              className="h-10 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand"
            />
            <label className="flex h-10 items-center gap-2 rounded-xl border border-border-soft bg-surface px-3 text-xs text-ink-2">
              <input type="checkbox" checked={c.descarta} onChange={(e) => set(i, { descarta: e.target.checked })} className="h-3.5 w-3.5 rounded border-border-soft text-brand" />
              Eliminatoria (descarta si no cumple)
            </label>
          </div>
          {c.valida && <p className="mt-1.5 text-[11px] text-ink-3">Valida: {c.valida}</p>}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...items, { pregunta: "", tipo: "si_no", valida: "", respuesta_esperada: "Sí", descarta: false }])}
      >
        + Agregar pregunta
      </Button>
    </div>
  );
}

export function FormularioContenidoVacante({
  value,
  onChange,
  onGenerado,
  conIA = true,
  clienteId,
  mostrarCliente = true,
  slotDatosPrincipales,
  faltaCliente = false,
}: {
  value: ContenidoVacante;
  onChange: (c: ContenidoVacante) => void;
  /** Vacantes lo usa para conservar los bloques de publicación (occ/linkedin/portal) del generador. */
  onGenerado?: (g: VacanteGenerada) => void;
  conIA?: boolean;
  /** Fase 4 (Punto 1): el nombre de empresa que usa la IA lo resuelve el servidor con la regla
   * Cliente visible / Cuenta; aquí solo viaja el contexto (nada de texto libre). */
  clienteId?: number | null;
  mostrarCliente?: boolean;
  /** Vacantes inyecta aquí el selector de Cliente (+ Mostrar cliente) dentro de Datos principales. */
  slotDatosPrincipales?: React.ReactNode;
  /** true cuando la Cuenta tiene Clientes y RH todavía no eligió (Cliente o «recluta directo»). */
  faltaCliente?: boolean;
}) {
  const set = <K extends keyof ContenidoVacante>(k: K) => (v: ContenidoVacante[K]) => onChange({ ...value, [k]: v });
  const [generando, setGenerando] = useState(false);
  const [errorIA, setErrorIA] = useState("");
  const [avanzado, setAvanzado] = useState(false);
  const [empresaIA, setEmpresaIA] = useState("");
  const [generado, setGenerado] = useState(() => tieneContenidoManual(value));

  async function generar() {
    const faltan = faltantesDatosPrincipales(value);
    if (faltaCliente) faltan.splice(3, 0, "Cliente (o «La Cuenta recluta directo»)");
    if (faltan.length) {
      setErrorIA(`Para generar, captura primero: ${faltan.join(", ")}.`);
      return;
    }
    setGenerando(true);
    setErrorIA("");
    const p = contenidoComoPayload(value);
    const r = await generarVacanteIA({
      titulo: p.titulo,
      area: p.area,
      seniority: p.seniority,
      ubicacion: p.ubicacion,
      modalidad: p.modalidad,
      sueldo_desde: p.sueldo_desde,
      sueldo_hasta: p.sueldo_hasta,
      sueldo_moneda: p.sueldo_moneda,
      sueldo_periodicidad: p.sueldo_periodicidad,
      descripcion: p.descripcion,
      requisitos_indispensables: p.requisitos_indispensables,
      requisitos_deseables: p.requisitos_deseables,
      beneficios: p.beneficios,
      cliente_id: clienteId ?? null,
      mostrar_cliente_candidato: mostrarCliente,
    });
    setGenerando(false);
    if (!r.ok) {
      setErrorIA(r.error);
      return;
    }
    onChange(contenidoDesdeGenerado(value, r.data));
    onGenerado?.(r.data);
    setGenerado(true);
    if (r.data.empresa) setEmpresaIA(r.data.empresa);
  }

  const sueldo = { desde: value.sueldo_desde, hasta: value.sueldo_hasta, moneda: value.sueldo_moneda, periodicidad: value.sueldo_periodicidad };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Datos principales */}
      <Seccion titulo="Datos principales" ayuda="Se capturan antes de generar. Son la única fuente de condiciones reales: Red Human nunca las inventa.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Puesto *" value={value.titulo} onChange={set("titulo")} placeholder="Ej. Cajero(a) de sucursal" full />
          <Field label="Área *" value={value.area} onChange={set("area")} placeholder="Operaciones, Ventas…" />
          <Selector label="Seniority *" value={value.seniority} onChange={set("seniority")} opciones={[{ valor: "", texto: "Elige un nivel…" }, ...SENIORITIES.map((s) => ({ valor: s, texto: s }))]} />
          {slotDatosPrincipales}
          <Field label="Ubicación *" value={value.ubicacion} onChange={set("ubicacion")} placeholder="Guadalajara, JAL" />
          <Selector label="Modalidad *" value={value.modalidad} onChange={set("modalidad")} opciones={MODALIDADES} />
          <CampoSueldo
            value={sueldo}
            onChange={(v) =>
              onChange({ ...value, sueldo_desde: v.desde, sueldo_hasta: v.hasta, sueldo_moneda: v.moneda, sueldo_periodicidad: v.periodicidad as PeriodicidadSueldo | "" })
            }
            periodicidades={PERIODICIDADES_SUELDO}
            monedas={MONEDAS_SUELDO}
            ayuda="Desde / Hasta / Moneda / Periodicidad (semanal, quincenal, mensual o anual), o «A convenir». Lo que se muestra al candidato se deriva de aquí."
          />
        </div>
      </Seccion>

      {/* 2 → 4. Guía opcional / Contenido generado (mismos campos, siempre visibles y editables) */}
      <Seccion
        titulo={generado ? "Contenido generado por Red Human (editable)" : "Guía opcional para Red Human"}
        ayuda={
          generado
            ? "Revisa y corrige: lo que capturaste se conservó tal cual (indispensable sigue indispensable, deseable sigue deseable); Red Human solo complementó lo vacío."
            : "Todo es opcional. Lo que captures aquí se respeta literal al generar: Red Human solo complementa lo que dejes vacío."
        }
      >
        <Area
          label={generado ? "Descripción del puesto" : "Descripción breve (opcional)"}
          value={value.descripcion}
          onChange={set("descripcion")}
          rows={generado ? 5 : 3}
          placeholder={generado ? "" : "Una o dos líneas: qué hace el puesto y para quién. Red Human la expande."}
        />
        {generado && (
          <ListaEditable label="Responsabilidades principales" items={value.responsabilidades} onChange={set("responsabilidades")} placeholder="Una responsabilidad por renglón" />
        )}
        <ListaEditable
          label={generado ? "Requisitos indispensables" : "Requisitos indispensables (opcional)"}
          items={value.requisitos}
          onChange={set("requisitos")}
          placeholder="Ej. Carrera técnica concluida"
          ayuda="Los indispensables alimentan el prefiltro por WhatsApp."
        />
        <ListaEditable label={generado ? "Requisitos deseables" : "Requisitos deseables (opcional)"} items={value.requisitos_deseables} onChange={set("requisitos_deseables")} placeholder="Ej. Inglés básico" />
        <ListaEditable
          label={generado ? "Prestaciones" : "Prestaciones (opcional)"}
          items={value.beneficios}
          onChange={set("beneficios")}
          placeholder="Ej. Vales de despensa"
          ayuda="Solo se publican las que captures aquí; Red Human no agrega ninguna por su cuenta."
        />
      </Seccion>

      {/* 3. Botón único, ABAJO de datos principales y guía */}
      {conIA && (
        <div className="rounded-xl border border-dashed border-brand/40 bg-brand-soft/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-ink-2">
              <span className="font-semibold text-ink">{generado ? "Volver a generar" : "Generar vacante con Red Human"}</span> — completa descripción,
              responsabilidades, requisitos, perfil ideal, palabras clave, prefiltro, entrevista y textos de publicación.
            </div>
            <Button type="button" onClick={generar} disabled={generando}>
              <Sparkles className="h-4 w-4" /> {generando ? "Generando…" : generado ? "Volver a generar" : "Generar vacante con Red Human"}
            </Button>
          </div>
          {errorIA && <p className="mt-2 text-xs text-bad">{errorIA}</p>}
          {empresaIA && !errorIA && (
            <p className="mt-2 text-xs text-ink-3">
              Contenido generado a nombre de <b className="text-ink">{empresaIA}</b> (según el Cliente y “mostrar cliente al candidato”).
            </p>
          )}
          {generado && value.avisos_cumplimiento.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-warn-soft/40 p-3 text-xs leading-relaxed text-ink-2">
              {value.avisos_cumplimiento.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 5. Selección */}
      <Seccion titulo="Prefiltro" ayuda="Preguntas que Red Human hace por WhatsApp, propuestas a partir de los requisitos indispensables. Edita, elimina o agrega, y marca cuáles son eliminatorias.">
        <CriteriosEditor items={value.preguntas_filtro} onChange={set("preguntas_filtro")} />
      </Seccion>

      <Seccion titulo="Entrevista Red Human" ayuda="Define qué tan a fondo conversa Red Human con el candidato; cambia el guion, la entrevista y la evaluación.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Selector
            label="Enfoque de entrevista"
            value={value.enfoque_entrevista}
            onChange={(v) => set("enfoque_entrevista")(v as EnfoqueEntrevista)}
            opciones={ENFOQUES_ENTREVISTA.map((e) => ({ valor: e.valor, texto: e.texto }))}
          />
          <p className="self-end pb-2 text-xs leading-relaxed text-ink-3">
            {ENFOQUES_ENTREVISTA.find((e) => e.valor === value.enfoque_entrevista)?.detalle}
          </p>
        </div>
      </Seccion>

      <section>
        <button type="button" onClick={() => setAvanzado((a) => !a)} className="flex items-center gap-1.5 text-xs font-semibold text-ink-3 hover:text-ink">
          {avanzado ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Avanzado (resumen, perfil ideal, palabras clave, textos de publicación)
        </button>
        <div className={cn("mt-3 flex flex-col gap-4", !avanzado && "hidden")}>
          <Area label="Resumen (portal)" value={value.resumen} onChange={set("resumen")} rows={2} />
          <Area label="Perfil ideal" value={value.perfil_ideal} onChange={set("perfil_ideal")} rows={3} />
          <ListaEditable label="Palabras clave" items={value.palabras_clave} onChange={set("palabras_clave")} />
          <ListaEditable label="Avisos de cumplimiento" items={value.avisos_cumplimiento} onChange={set("avisos_cumplimiento")} />
          <Area label="Texto para WhatsApp" value={value.texto_whatsapp} onChange={set("texto_whatsapp")} rows={3} />
          <Area label="Texto para bolsa de trabajo" value={value.texto_bolsa} onChange={set("texto_bolsa")} rows={4} />
        </div>
      </section>
    </div>
  );
}
