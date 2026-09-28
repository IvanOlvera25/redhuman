"use client";

/* «Plantillas» dentro de Desempeño (Desempeño v2, 2026-09-27) — sin módulo aparte: guardan criterios,
   definiciones, forma de evaluar (medible/descriptivo) y pesos. Usar una plantilla COPIA sus criterios a
   la evaluación; editar la plantilla nunca modifica evaluaciones ya creadas, iniciadas o cerradas. */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileSpreadsheet, Loader2, PenLine, Plus, Save, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { AvisoLinea, CampoRH, ModalMarco, inputRH, type AvisoRH } from "@/components/dashboard/modulos-rh";
import { EditorCriterios, criteriosParaGuardar } from "@/components/dashboard/desempeno/editor-criterios";
import { ImportarCriterios } from "@/components/dashboard/desempeno/importar-criterios";
import {
  crearPlantillaDesempeno, editarPlantillaDesempeno, eliminarPlantillaDesempeno, fetchPlantillasDesempeno,
  type CriterioDesempeno, type PlantillaDesempeno,
} from "@/lib/api";

export function VistaPlantillasDesempeno({ onVolver, puedeDecidir }: { onVolver: () => void; puedeDecidir: boolean }) {
  const [lista, setLista] = useState<PlantillaDesempeno[] | null>(null);
  const [editor, setEditor] = useState<{ plantilla: PlantillaDesempeno | null } | null>(null);
  const [baja, setBaja] = useState<PlantillaDesempeno | null>(null);
  const [aviso, setAviso] = useState<AvisoRH>(null);

  const recargar = useCallback(async () => setLista((await fetchPlantillasDesempeno()) ?? []), []);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={onVolver} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 transition hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Desempeño
      </button>
      <PageHeader title="Plantillas de desempeño" subtitle="Criterios, definiciones, forma de evaluar y pesos listos para reutilizar. Cada evaluación guarda su propia copia.">
        {puedeDecidir && <Button size="sm" onClick={() => setEditor({ plantilla: null })}><Plus className="h-4 w-4" /> Nueva plantilla</Button>}
      </PageHeader>
      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}

      {lista === null ? (
        <div className="mt-10 grid place-items-center text-ink-3"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : lista.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-sm text-ink-3">
          Aún no hay plantillas. Crea una, impórtala de Excel o usa «Guardar como plantilla» desde una evaluación.
        </Card>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {lista.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{p.nombre}</p>
                <p className="text-[12px] text-ink-3">
                  {p.criterios} criterios{p.equipo ? ` · ${p.equipo}` : ""}{p.pesosPersonalizados ? " · pesos personalizados" : " · pesos iguales"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.listaCriterios.slice(0, 4).map((c) => <Badge key={c.id} tone={c.tipo === "medible" ? "brand" : "neutral"}>{c.nombre}</Badge>)}
                  {p.listaCriterios.length > 4 && <Badge tone="neutral">+{p.listaCriterios.length - 4}</Badge>}
                </div>
              </div>
              {puedeDecidir && (
                <MenuAcciones
                  acciones={[
                    { etiqueta: "Editar", icono: <PenLine className="h-4 w-4" />, onClick: () => setEditor({ plantilla: p }) },
                    { etiqueta: "Eliminar", icono: <Trash2 className="h-4 w-4" />, peligrosa: true, onClick: () => setBaja(p) },
                  ]}
                />
              )}
            </Card>
          ))}
          <p className="text-[12px] text-ink-3">Para usar una plantilla: «Crear evaluación» → paso 3 → «Usar plantilla».</p>
        </div>
      )}

      {editor && (
        <ModalPlantilla
          plantilla={editor.plantilla}
          onClose={() => setEditor(null)}
          onGuardada={(nombre) => { setEditor(null); setAviso({ tono: "ok", texto: `Plantilla «${nombre}» guardada. Las evaluaciones existentes no cambian.` }); void recargar(); }}
        />
      )}
      {baja && (
        <ModalMarco titulo="Eliminar plantilla" subtitulo={`«${baja.nombre}» deja de ofrecerse. Las evaluaciones creadas con ella conservan sus criterios.`} onClose={() => setBaja(null)}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setBaja(null)}>Cancelar</Button>
            <Button size="sm" onClick={async () => {
              const r = await eliminarPlantillaDesempeno(baja.id);
              setBaja(null);
              if (!r.ok) return setAviso({ tono: "error", texto: r.error });
              void recargar();
            }}><Trash2 className="h-4 w-4" /> Eliminar</Button>
          </div>
        </ModalMarco>
      )}
    </div>
  );
}

function ModalPlantilla({ plantilla, onClose, onGuardada }: { plantilla: PlantillaDesempeno | null; onClose: () => void; onGuardada: (nombre: string) => void }) {
  const [nombre, setNombre] = useState(plantilla?.nombre ?? "");
  const [equipo, setEquipo] = useState(plantilla?.equipo ?? "");
  const [criterios, setCriterios] = useState<CriterioDesempeno[]>(plantilla?.listaCriterios.map((c) => ({ ...c })) ?? []);
  const [pesos, setPesos] = useState(plantilla?.pesosPersonalizados ?? false);
  const [importar, setImportar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    const limpios = criteriosParaGuardar(criterios, pesos);
    if (!nombre.trim()) return setError("Ponle nombre a la plantilla.");
    if (!limpios.length) return setError("Captura al menos un criterio.");
    setOcupado(true);
    const r = plantilla
      ? await editarPlantillaDesempeno(plantilla.id, { nombre, equipo, criterios: limpios, pesosPersonalizados: pesos })
      : await crearPlantillaDesempeno({ nombre, equipo, criterios: limpios, pesosPersonalizados: pesos });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onGuardada(r.data.nombre);
  }

  return (
    <ModalMarco titulo={plantilla ? "Editar plantilla" : "Nueva plantilla"} subtitulo="Editarla no cambia las evaluaciones que ya se crearon con ella." onClose={onClose} ancho="max-w-4xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoRH label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputRH} /></CampoRH>
        <CampoRH label="Puesto o equipo (opcional)"><input value={equipo} onChange={(e) => setEquipo(e.target.value)} className={inputRH} /></CampoRH>
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setImportar(true)}><FileSpreadsheet className="h-4 w-4" /> Importar criterios de Excel</Button>
      </div>
      <EditorCriterios criterios={criterios} onCambio={setCriterios} pesosPersonalizados={pesos} onPesosPersonalizados={setPesos} />
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado}>{ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar plantilla</Button>
      </div>
      {importar && (
        <ImportarCriterios onClose={() => setImportar(false)} onConfirmar={(cs) => { setCriterios([...criterios.filter((c) => c.nombre.trim()), ...cs]); setImportar(false); }} />
      )}
    </ModalMarco>
  );
}
