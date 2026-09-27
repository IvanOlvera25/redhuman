"use client";

/* Configuración → Plantillas de clima (Clima v2, 2026-09-27). Crear, editar, subir (CSV/Excel) y
   reutilizar cuestionarios base. Usar una plantilla crea un BORRADOR con una COPIA de sus dimensiones y
   preguntas (mismos tipos y orden): editar la encuesta nunca altera la plantilla, y viceversa. El editor es
   el mismo del Borrador de una encuesta (`EditorCuestionario`). */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, LayoutTemplate, Loader2, PenLine, Plus, Save, Trash2, Upload } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { AvisoLinea, CampoRH, ModalMarco, inputRH, type AvisoRH } from "@/components/dashboard/modulos-rh";
import { EditorCuestionario, cuestionarioParaGuardar } from "@/components/dashboard/clima/editor-cuestionario";
import {
  crearPlantillaClima, desactivarPlantillaClima, editarPlantillaClima, fetchPlantillaClima, fetchPlantillasClima,
  importarPlantillaClima, urlFormatoPlantillaClima, usarPlantillaClima,
  type PlantillaClima, type PreguntaClima,
} from "@/lib/api";

export function SeccionPlantillasClima() {
  const router = useRouter();
  const [lista, setLista] = useState<PlantillaClima[] | null>(null);
  const [editor, setEditor] = useState<{ plantilla: PlantillaClima | null } | null>(null);
  const [baja, setBaja] = useState<PlantillaClima | null>(null);
  const [aviso, setAviso] = useState<AvisoRH>(null);
  const [ocupado, setOcupado] = useState("");
  const archivo = useRef<HTMLInputElement>(null);

  const recargar = useCallback(async () => setLista((await fetchPlantillasClima()) ?? []), []);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function subir(f: File | undefined) {
    if (!f) return;
    setOcupado("subir");
    const r = await importarPlantillaClima(f);
    setOcupado("");
    if (archivo.current) archivo.current.value = "";
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `Plantilla «${r.data.nombre}» creada con ${r.data.preguntas} preguntas.` });
    void recargar();
  }

  async function usar(p: PlantillaClima) {
    setOcupado(`usar-${p.id}`);
    const r = await usarPlantillaClima(p.id);
    setOcupado("");
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    router.push(`/dashboard/clima?medicion=${encodeURIComponent(r.data.id)}`);
  }

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><LayoutTemplate className="h-4 w-4" /></span>
          <div>
            <h2 className="font-display text-base font-bold">Plantillas de clima</h2>
            <p className="mt-0.5 text-sm text-ink-2">Cuestionarios base con sus dimensiones y tipos de pregunta. Usarlos copia el cuestionario: el original no cambia.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input ref={archivo} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void subir(e.target.files?.[0])} />
          <MenuAcciones
            acciones={[
              { etiqueta: "Subir plantilla (CSV o Excel)", icono: <Upload className="h-4 w-4" />, onClick: () => archivo.current?.click(), disabled: ocupado === "subir" },
              { etiqueta: "Descargar formato de ejemplo", icono: <Download className="h-4 w-4" />, onClick: () => window.open(urlFormatoPlantillaClima(), "_blank") },
            ]}
          />
          <Button size="sm" onClick={() => setEditor({ plantilla: null })}><Plus className="h-4 w-4" /> Nueva plantilla</Button>
        </div>
      </div>

      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}
      {ocupado === "subir" && <p className="mt-3 inline-flex items-center gap-2 text-sm text-ink-3"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo el archivo…</p>}

      <div className="mt-4">
        {lista === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
        ) : lista.length === 0 ? (
          <p className="text-sm text-ink-3">Aún no hay plantillas de clima. Crea una o sube un archivo.</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {lista.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.nombre}</p>
                  <p className="truncate text-[11px] text-ink-3">{p.preguntas} preguntas · {p.dimensiones.join(", ")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void usar(p)} disabled={ocupado === `usar-${p.id}`}>
                    {ocupado === `usar-${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />} Usar
                  </Button>
                  <MenuAcciones
                    acciones={[
                      { etiqueta: "Editar", icono: <PenLine className="h-4 w-4" />, onClick: () => setEditor({ plantilla: p }) },
                      { etiqueta: "Eliminar", icono: <Trash2 className="h-4 w-4" />, peligrosa: true, onClick: () => setBaja(p) },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editor && (
        <ModalPlantilla
          plantilla={editor.plantilla}
          onClose={() => setEditor(null)}
          onGuardada={(n) => { setEditor(null); setAviso({ tono: "ok", texto: `Plantilla «${n}» guardada.` }); void recargar(); }}
        />
      )}
      {baja && (
        <ModalMarco titulo="Eliminar plantilla" subtitulo={`«${baja.nombre}» deja de ofrecerse. Las encuestas creadas con ella no se tocan.`} onClose={() => setBaja(null)}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setBaja(null)}>Cancelar</Button>
            <Button
              size="sm"
              onClick={async () => {
                const r = await desactivarPlantillaClima(baja.id);
                setBaja(null);
                if (!r.ok) return setAviso({ tono: "error", texto: r.error });
                void recargar();
              }}
            >
              <Trash2 className="h-4 w-4" /> Eliminar
            </Button>
          </div>
        </ModalMarco>
      )}
    </Card>
  );
}

function ModalPlantilla({ plantilla, onClose, onGuardada }: { plantilla: PlantillaClima | null; onClose: () => void; onGuardada: (nombre: string) => void }) {
  const [cargado, setCargado] = useState(!plantilla);
  const [nombre, setNombre] = useState(plantilla?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(plantilla?.descripcion ?? "");
  const [dimensiones, setDimensiones] = useState<string[]>(plantilla?.dimensiones ?? ["General"]);
  const [preguntas, setPreguntas] = useState<PreguntaClima[]>([{ id: "p1", texto: "", tipo: "escala", dimension: "General", escala_max: 5 }]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!plantilla) return;
    fetchPlantillaClima(plantilla.id).then((p) => {
      if (p?.cuestionario) setPreguntas(p.cuestionario);
      if (p) setDimensiones(p.dimensiones);
      setCargado(true);
    });
  }, [plantilla]);

  async function guardar() {
    const limpias = cuestionarioParaGuardar(preguntas);
    if (!nombre.trim()) return setError("Ponle nombre a la plantilla.");
    if (!limpias.length) return setError("Captura al menos una pregunta.");
    setOcupado(true);
    const r = plantilla
      ? await editarPlantillaClima(plantilla.id, { nombre, descripcion, dimensiones, preguntas: limpias })
      : await crearPlantillaClima({ nombre, descripcion, dimensiones, preguntas: limpias });
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onGuardada(r.data.nombre);
  }

  return (
    <ModalMarco titulo={plantilla ? "Editar plantilla de clima" : "Nueva plantilla de clima"} subtitulo="Las encuestas ya creadas con esta plantilla no cambian." onClose={onClose} ancho="max-w-4xl">
      {!cargado ? (
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoRH label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputRH} /></CampoRH>
            <CampoRH label="Descripción (opcional)"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={inputRH} /></CampoRH>
          </div>
          <div className="mt-5">
            <EditorCuestionario dimensiones={dimensiones} preguntas={preguntas} onCambio={(d, p) => { setDimensiones(d); setPreguntas(p); }} />
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado || !cargado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar plantilla
        </Button>
      </div>
    </ModalMarco>
  );
}
