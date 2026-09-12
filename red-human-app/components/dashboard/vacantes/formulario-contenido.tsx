"use client";

/* Punto 11 — UN solo formulario de contenido para "Nueva vacante" y "Nueva plantilla".

   Secciones: Puesto · Descripción · Responsabilidades · Requisitos · Condiciones (ubicación,
   modalidad, sueldo, beneficios) · Criterios de prefiltro. Todo editable; el botón "Generar con
   IA" (mismo generador que ya usaba Vacantes) rellena los campos y el usuario los corrige antes
   de guardar. Los campos que solo produce la IA (resumen, perfil ideal, palabras clave, seniority,
   avisos, textos de publicación) viajan en el estado y se muestran colapsados en "Avanzado".

   Vacantes agrega encima sus relaciones (Cliente/Responsable/Colaboradores/plataformas);
   Configuración → Plantillas agrega "Nombre de plantilla" y el alcance (General/Cliente). */

import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { Button, Eyebrow } from "@/components/ui";
import { Area, Field, ListaEditable, Selector } from "@/components/dashboard/campos";
import {
  generarVacanteIA,
  ENFOQUES_ENTREVISTA,
  type CriterioFiltro,
  type EnfoqueEntrevista,
  type Plantilla,
  type VacanteGenerada,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export interface ContenidoVacante {
  titulo: string;
  area: string;
  descripcion: string;
  responsabilidades: string[];
  requisitos: string;
  requisitos_deseables: string[];
  ubicacion: string;
  modalidad: string;
  sueldo: string;
  beneficios: string[];
  preguntas_filtro: CriterioFiltro[];
  /** Fase 4 (Punto 6): enfoque de la Entrevista IA — solo 2 niveles. */
  enfoque_entrevista: EnfoqueEntrevista;
  /* --- avanzado (los llena la IA; editables pero colapsados) --- */
  resumen: string;
  perfil_ideal: string;
  palabras_clave: string[];
  seniority: string;
  avisos_cumplimiento: string[];
  texto_whatsapp: string;
  texto_bolsa: string;
}

export const CONTENIDO_VACIO: ContenidoVacante = {
  titulo: "",
  area: "",
  descripcion: "",
  responsabilidades: [],
  requisitos: "",
  requisitos_deseables: [],
  ubicacion: "",
  modalidad: "Presencial",
  sueldo: "",
  beneficios: [],
  preguntas_filtro: [],
  enfoque_entrevista: "profesional",
  resumen: "",
  perfil_ideal: "",
  palabras_clave: [],
  seniority: "",
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

/** Precarga TODOS los campos compartidos desde una plantilla (antes solo 5). */
export function contenidoDesdePlantilla(p: Plantilla): ContenidoVacante {
  return {
    titulo: p.titulo,
    area: p.area,
    descripcion: p.descripcion,
    responsabilidades: [...(p.responsabilidades ?? [])],
    requisitos: p.requisitos,
    requisitos_deseables: [...(p.requisitosDeseables ?? [])],
    ubicacion: p.ubicacion ?? "",
    modalidad: p.modalidad || "Presencial",
    sueldo: p.sueldo === "A convenir" ? "" : p.sueldo,
    beneficios: [...(p.beneficios ?? [])],
    preguntas_filtro: [...(p.preguntasFiltro ?? [])],
    enfoque_entrevista: p.enfoqueEntrevista ?? "profesional",
    resumen: p.resumen,
    perfil_ideal: p.perfilIdeal,
    palabras_clave: [...(p.palabrasClave ?? [])],
    seniority: p.seniority,
    avisos_cumplimiento: [...(p.avisosCumplimiento ?? [])],
    texto_whatsapp: p.textoWhatsapp,
    texto_bolsa: p.textoBolsa,
  };
}

/** Vuelca lo que generó la IA sobre el contenido actual (conserva puesto/condiciones capturados). */
export function contenidoDesdeGenerado(base: ContenidoVacante, g: VacanteGenerada): ContenidoVacante {
  return {
    ...base,
    descripcion: g.descripcion || base.descripcion,
    responsabilidades: g.responsabilidades?.length ? g.responsabilidades : base.responsabilidades,
    requisitos: base.requisitos || (g.requisitos_indispensables ?? []).join(" · "),
    requisitos_deseables: g.requisitos_deseables ?? base.requisitos_deseables,
    beneficios: g.beneficios?.length ? g.beneficios : base.beneficios,
    preguntas_filtro: g.preguntas_filtro?.length ? g.preguntas_filtro : base.preguntas_filtro,
    sueldo: base.sueldo || g.rango_salarial_sugerido || "",
    resumen: g.resumen,
    perfil_ideal: g.perfil_ideal,
    palabras_clave: g.palabras_clave ?? [],
    seniority: g.seniority ?? "",
    avisos_cumplimiento: g.avisos_cumplimiento ?? [],
    texto_whatsapp: g.texto_whatsapp ?? "",
    texto_bolsa: g.portal?.page ?? base.texto_bolsa,
  };
}

/** true si el usuario ya capturó contenido (la API no debe volver a generarlo al guardar). */
export function tieneContenidoManual(c: ContenidoVacante): boolean {
  return Boolean(c.descripcion.trim() || c.responsabilidades.length || c.preguntas_filtro.length);
}

/** Cuerpo snake_case para POST /plantillas, PATCH /plantillas/{id} y POST /vacantes. */
export function contenidoComoPayload(c: ContenidoVacante) {
  return {
    titulo: c.titulo.trim(),
    area: c.area,
    ubicacion: c.ubicacion,
    modalidad: c.modalidad,
    sueldo: c.sueldo || "A convenir",
    requisitos: c.requisitos,
    descripcion: c.descripcion,
    responsabilidades: c.responsabilidades,
    requisitos_deseables: c.requisitos_deseables,
    beneficios: c.beneficios,
    preguntas_filtro: c.preguntas_filtro,
    enfoque_entrevista: c.enfoque_entrevista,
    resumen: c.resumen,
    perfil_ideal: c.perfil_ideal,
    palabras_clave: c.palabras_clave,
    seniority: c.seniority,
    avisos_cumplimiento: c.avisos_cumplimiento,
    texto_whatsapp: c.texto_whatsapp,
    texto_bolsa: c.texto_bolsa,
  };
}

function Seccion({ titulo, children, ayuda }: { titulo: string; children: React.ReactNode; ayuda?: string }) {
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
              Descarta si no cumple
            </label>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...items, { pregunta: "", tipo: "si_no", valida: "", respuesta_esperada: "Sí", descarta: false }])}
      >
        + Agregar criterio
      </Button>
    </div>
  );
}

export function FormularioContenidoVacante({
  value,
  onChange,
  onGenerado,
  conIA = true,
  notasIA,
  onNotasIA,
  clienteId,
  mostrarCliente = true,
}: {
  value: ContenidoVacante;
  onChange: (c: ContenidoVacante) => void;
  /** Vacantes lo usa para conservar los bloques de publicación (occ/linkedin/portal) del generador. */
  onGenerado?: (g: VacanteGenerada) => void;
  conIA?: boolean;
  notasIA?: string;
  onNotasIA?: (v: string) => void;
  /** Fase 4 (Punto 1): el nombre de empresa que usa la IA lo resuelve el servidor con la regla
   * Cliente visible / Cuenta; aquí solo viaja el contexto (nada de texto libre). */
  clienteId?: number | null;
  mostrarCliente?: boolean;
}) {
  const set = <K extends keyof ContenidoVacante>(k: K) => (v: ContenidoVacante[K]) => onChange({ ...value, [k]: v });
  const [generando, setGenerando] = useState(false);
  const [errorIA, setErrorIA] = useState("");
  const [avanzado, setAvanzado] = useState(false);
  const [empresaIA, setEmpresaIA] = useState("");

  async function generar() {
    if (!value.titulo.trim()) {
      setErrorIA("Captura el nombre del puesto para generar el contenido.");
      return;
    }
    setGenerando(true);
    setErrorIA("");
    const r = await generarVacanteIA({
      titulo: value.titulo,
      area: value.area,
      ubicacion: value.ubicacion,
      sueldo: value.sueldo,
      requisitos: value.requisitos,
      modalidad: value.modalidad,
      cliente_id: clienteId ?? null,
      mostrar_cliente_candidato: mostrarCliente,
      notas: notasIA,
    });
    setGenerando(false);
    if (!r.ok) {
      setErrorIA(r.error);
      return;
    }
    onChange(contenidoDesdeGenerado(value, r.data));
    onGenerado?.(r.data);
    if (r.data.empresa) setEmpresaIA(r.data.empresa);
  }

  return (
    <div className="flex flex-col gap-6">
      <Seccion titulo="Puesto">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre del puesto" value={value.titulo} onChange={set("titulo")} placeholder="Ej. Cajero(a) de sucursal" full />
          <Field label="Área" value={value.area} onChange={set("area")} placeholder="Operaciones, Ventas…" />
          <Field label="Seniority (opcional)" value={value.seniority} onChange={set("seniority")} placeholder="Junior, Senior…" />
        </div>
      </Seccion>

      {conIA && (
        <div className="rounded-xl border border-dashed border-brand/40 bg-brand-soft/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-ink-2">
              <span className="font-semibold text-ink">Generar con IA</span> — rellena descripción, responsabilidades, requisitos, beneficios y criterios; después los puedes corregir.
            </div>
            <Button type="button" onClick={generar} disabled={generando}>
              <Sparkles className="h-4 w-4" /> {generando ? "Generando…" : tieneContenidoManual(value) ? "Volver a generar" : "Generar con IA"}
            </Button>
          </div>
          {onNotasIA && (
            <div className="mt-3">
              <Area label="Notas para la IA (opcional)" value={notasIA ?? ""} onChange={onNotasIA} rows={2} placeholder="Tono, horarios, prestaciones específicas…" />
            </div>
          )}
          {errorIA && <p className="mt-2 text-xs text-bad">{errorIA}</p>}
          {empresaIA && !errorIA && (
            <p className="mt-2 text-xs text-ink-3">
              Contenido generado a nombre de <b className="text-ink">{empresaIA}</b> (según el Cliente y “mostrar cliente al candidato”).
            </p>
          )}
        </div>
      )}

      <Seccion titulo="Descripción">
        <Area label="Descripción del puesto" value={value.descripcion} onChange={set("descripcion")} rows={5} placeholder="Qué hace el puesto, para quién y en qué contexto." />
      </Seccion>

      <Seccion titulo="Responsabilidades">
        <ListaEditable label="Responsabilidades principales" items={value.responsabilidades} onChange={set("responsabilidades")} placeholder="Una responsabilidad por renglón" />
      </Seccion>

      <Seccion titulo="Requisitos">
        <Area
          label="Requisitos indispensables"
          value={value.requisitos}
          onChange={set("requisitos")}
          rows={3}
          ayuda="El prefiltro del agente se apoya en estos requisitos para clasificar al candidato."
        />
        <ListaEditable label="Requisitos deseables" items={value.requisitos_deseables} onChange={set("requisitos_deseables")} />
      </Seccion>

      <Seccion titulo="Condiciones">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ubicación" value={value.ubicacion} onChange={set("ubicacion")} placeholder="Guadalajara, JAL" />
          <Selector label="Modalidad" value={value.modalidad} onChange={set("modalidad")} opciones={MODALIDADES} />
          <Field label="Sueldo" value={value.sueldo} onChange={set("sueldo")} placeholder="$9,500 – 11,000 o 'A convenir'" />
        </div>
        <ListaEditable label="Beneficios / prestaciones" items={value.beneficios} onChange={set("beneficios")} />
      </Seccion>

      <Seccion titulo="Criterios de prefiltro" ayuda="Preguntas cerradas que el agente hace por WhatsApp; las marcadas como 'descarta' son knock-out.">
        <CriteriosEditor items={value.preguntas_filtro} onChange={set("preguntas_filtro")} />
      </Seccion>

      <Seccion titulo="Entrevista IA" ayuda="Define qué tan a fondo conversa Red Human con el candidato; cambia el guion, la entrevista y la evaluación.">
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
