"use client";

/* Asistente «Crear evaluación» (Desempeño v2, 2026-09-27) en el orden EXACTO de la especificación:
     1. Nombre y periodo → 2. Puesto o equipo → 3. Cómo definir criterios (Red Human · plantilla · manual)
     → 4. Revisar criterios y metas → 5. Colaboradores y evaluadores.
   La IA recibe el puesto/equipo antes de proponer y nunca inventa metas. Al terminar se crea la evaluación
   en BORRADOR con sus personas; se inicia desde el detalle. El flujo rápido no exige plantillas, Excel,
   pesos ni notas. */

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, LayoutTemplate, Loader2, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { CampoRH, ModalMarco, inputRH } from "@/components/dashboard/modulos-rh";
import { EditorCriterios, criterioVacio, criteriosParaGuardar, sumaPesos } from "@/components/dashboard/desempeno/editor-criterios";
import { SelectorParticipantes, type SeleccionParticipantes } from "@/components/dashboard/desempeno/selector-participantes";
import { ImportarCriterios } from "@/components/dashboard/desempeno/importar-criterios";
import { cn } from "@/lib/utils";
import {
  agregarParticipantesDesempeno, crearCicloDesempeno, generarCriteriosDesempeno,
  type CicloDesempeno, type CriterioDesempeno,
} from "@/lib/api";

const PASOS = ["Nombre y periodo", "Puesto o equipo", "Cómo definir criterios", "Revisar criterios y metas", "Colaboradores y evaluadores"];

export interface OrigenPlantilla {
  id: number;
  nombre: string;
  criterios: CriterioDesempeno[];
  pesosPersonalizados: boolean;
}

export function AsistenteCrearEvaluacion({ onClose, onCreada, plantillas, inicial }: {
  onClose: () => void;
  onCreada: (c: CicloDesempeno, paraOtraEvaluacion: SeleccionParticipantes["paraOtraEvaluacion"]) => void;
  /** Fase 3: cuando hay plantillas se ofrece «Usar plantilla» en el paso 3. */
  plantillas?: { cargar: () => Promise<OrigenPlantilla[]> };
  inicial?: { equipo?: string; ids?: string[] };
}) {
  const [paso, setPaso] = useState(0);
  const [nombre, setNombre] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [equipo, setEquipo] = useState(inicial?.equipo ?? "");
  const [origen, setOrigen] = useState<"ia" | "plantilla" | "manual" | "">("");
  const [plantillaId, setPlantillaId] = useState<number | null>(null);
  const [lista, setLista] = useState<OrigenPlantilla[] | null>(null);
  const [criterios, setCriterios] = useState<CriterioDesempeno[]>([]);
  const [pesos, setPesos] = useState(false);
  const [sel, setSel] = useState<SeleccionParticipantes>({ ids: inicial?.ids ?? [], evaluadores: {}, paraOtraEvaluacion: [] });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [conIa, setConIa] = useState<boolean | null>(null);
  const [importar, setImportar] = useState(false);

  async function elegir(o: "ia" | "plantilla" | "manual") {
    setError("");
    setOrigen(o);
    if (o === "manual") {
      setCriterios([criterioVacio("medible"), criterioVacio("descriptivo")]);
      setPesos(false);
      return setPaso(3);
    }
    if (o === "ia") {
      setOcupado(true);
      const r = await generarCriteriosDesempeno({ puesto: equipo, periodo });
      setOcupado(false);
      if (!r.ok) return setError(r.error);
      setCriterios(r.data.criterios);
      setConIa(r.data.generadoConIa);
      setPesos(false);
      return setPaso(3);
    }
    if (plantillas) {
      setOcupado(true);
      setLista(await plantillas.cargar());
      setOcupado(false);
    }
  }

  function usarPlantilla(p: OrigenPlantilla) {
    setPlantillaId(p.id);
    setCriterios(p.criterios.map((c) => ({ ...c })));  // copia: editar aquí nunca cambia la plantilla
    setPesos(p.pesosPersonalizados);
    setPaso(3);
  }

  function siguiente() {
    setError("");
    if (paso === 0 && !nombre.trim()) return setError("Ponle nombre a la evaluación.");
    if (paso === 1 && !equipo.trim()) return setError("Indica el puesto o equipo que vas a evaluar.");
    if (paso === 3 && !criteriosParaGuardar(criterios, pesos).length) return setError("Captura al menos un criterio con nombre.");
    setPaso(paso + 1);
  }

  async function crear() {
    setOcupado(true);
    setError("");
    const r = await crearCicloDesempeno({
      nombre, periodo, equipo, criterios: criteriosParaGuardar(criterios, pesos), pesosPersonalizados: pesos,
      origenCriterios: origen || "manual", plantillaId,
    });
    if (!r.ok) {
      setOcupado(false);
      return setError(r.error);
    }
    if (sel.ids.length) {
      const p = await agregarParticipantesDesempeno(r.data.id, sel.ids, sel.evaluadores);
      if (!p.ok) {
        setOcupado(false);
        return setError(`La evaluación se creó, pero no se pudieron agregar las personas: ${p.error}`);
      }
    }
    setOcupado(false);
    onCreada(r.data, sel.paraOtraEvaluacion);
  }

  return (
    <ModalMarco titulo="Crear evaluación de desempeño" subtitulo={`Paso ${paso + 1} de 5 · ${PASOS[paso]}`} onClose={onClose} ancho="max-w-4xl">
      <ol className="mb-5 flex gap-1.5" aria-label="Pasos">
        {PASOS.map((p, i) => (
          <li key={p} className={cn("h-1.5 flex-1 rounded-full", i <= paso ? "bg-brand" : "bg-surface-2")} title={p} />
        ))}
      </ol>

      {paso === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoRH label="Nombre de la evaluación"><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Desempeño gerentes 2026-S2" className={inputRH} /></CampoRH>
          <CampoRH label="Periodo"><input value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="Ej. 2026-S2 · Q3 2026 · Anual 2026" className={inputRH} /></CampoRH>
        </div>
      )}

      {paso === 1 && (
        <CampoRH label="Puesto o equipo que se evalúa" ayuda="Red Human lo usa para proponer criterios específicos; también sirve para avisarte si agregas a alguien de otro puesto.">
          <input autoFocus value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Ej. Gerentes de proyectos" className={inputRH} />
        </CampoRH>
      )}

      {paso === 2 && (
        lista ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-2">Elige una plantilla. Se copia a esta evaluación: editarla aquí no cambia la plantilla.</p>
            {lista.length === 0 && <p className="py-6 text-center text-sm text-ink-3">No hay plantillas todavía.</p>}
            {lista.map((p) => (
              <button key={p.id} onClick={() => usarPlantilla(p)} className="flex items-center justify-between gap-3 rounded-2xl border border-border-soft p-4 text-left hover:border-brand/40">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{p.nombre}</span>
                  <span className="block text-[11px] text-ink-3">{p.criterios.length} criterios{p.pesosPersonalizados ? " · pesos personalizados" : ""}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-brand" />
              </button>
            ))}
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setLista(null)}><ArrowLeft className="h-4 w-4" /> Otra forma</Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <OpcionOrigen icono={<Sparkles className="h-5 w-5" />} titulo="Proponer con Red Human" texto={`Criterios para «${equipo}». Sin metas inventadas: tú las capturas.`} onClick={() => elegir("ia")} ocupado={ocupado && origen === "ia"} />
            {plantillas && <OpcionOrigen icono={<LayoutTemplate className="h-5 w-5" />} titulo="Usar plantilla" texto="Criterios, definiciones, forma de evaluar y pesos ya guardados." onClick={() => elegir("plantilla")} ocupado={ocupado && origen === "plantilla"} />}
            <OpcionOrigen icono={<PenLine className="h-5 w-5" />} titulo="Capturar manualmente" texto="Empiezas con un criterio medible y uno descriptivo." onClick={() => elegir("manual")} />
            <OpcionOrigen icono={<FileSpreadsheet className="h-5 w-5" />} titulo="Importar de Excel" texto="Vista previa con columnas y errores; confirmas antes de usarlos." onClick={() => setImportar(true)} />
          </div>
        )
      )}

      {paso === 3 && (
        <>
          {conIa !== null && origen === "ia" && (
            <p className="mb-3 rounded-xl bg-brand-soft/40 px-3 py-2 text-[12px] text-ink-2">
              {conIa ? "Propuesta de Red Human para " : "Propuesta base (sin IA disponible) para "}«{equipo}». Revísala: las metas quedan vacías hasta que las captures.
            </p>
          )}
          <EditorCriterios criterios={criterios} onCambio={setCriterios} pesosPersonalizados={pesos} onPesosPersonalizados={setPesos} />
          {pesos && Math.abs(sumaPesos(criteriosParaGuardar(criterios, true)) - 100) > 0.01 && (
            <p className="mt-2 text-[12px] text-ink-3">Puedes guardar así el borrador; para iniciar la evaluación los pesos deben sumar 100 %.</p>
          )}
        </>
      )}

      {paso === 4 && <SelectorParticipantes equipo={equipo} valor={sel} onCambio={setSel} />}

      {importar && (
        <ImportarCriterios
          onClose={() => setImportar(false)}
          onConfirmar={(cs) => { setCriterios(cs); setPesos(cs.some((c) => c.peso !== null && c.peso !== undefined)); setOrigen("manual"); setImportar(false); setPaso(3); }}
        />
      )}

      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => (paso === 0 ? onClose() : setPaso(paso === 3 ? 2 : paso - 1))} disabled={ocupado}>
          <ArrowLeft className="h-4 w-4" /> {paso === 0 ? "Cancelar" : "Atrás"}
        </Button>
        {paso < 4 && paso !== 2 && (
          <Button size="sm" onClick={siguiente} disabled={ocupado}>Siguiente <ArrowRight className="h-4 w-4" /></Button>
        )}
        {paso === 4 && (
          <Button size="sm" onClick={crear} disabled={ocupado}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Crear evaluación{sel.ids.length ? ` con ${sel.ids.length} persona(s)` : ""}
          </Button>
        )}
      </div>
    </ModalMarco>
  );
}

function OpcionOrigen({ icono, titulo, texto, onClick, ocupado = false }: { icono: React.ReactNode; titulo: string; texto: string; onClick: () => void; ocupado?: boolean }) {
  return (
    <button onClick={onClick} disabled={ocupado} className="flex flex-col gap-2 rounded-2xl border border-border-soft p-4 text-left transition hover:border-brand/40 hover:bg-brand-soft/20">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">{ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : icono}</span>
      <span className="text-sm font-semibold">{titulo}</span>
      <span className="text-[12px] leading-relaxed text-ink-3">{texto}</span>
    </button>
  );
}
