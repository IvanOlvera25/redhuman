"use client";

/* Configuración → Pruebas psicométricas (2026-09-28). Catálogo por Cuenta: identificador interno, nombre visible,
   descripción, puestos sugeridos, modo (Integrada / Enlace externo / Carga manual), proveedor, identificador en el
   proveedor y estado (Activa / Inactiva). «Eliminar» = inactivar; las evaluaciones ya asignadas no cambian.
   Sin conexión a proveedores todavía: las llaves se inyectan en un sprint posterior. */

import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, PenLine, Plus, Power, Save } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { MenuAcciones } from "@/components/dashboard/menu-acciones";
import { AvisoLinea, CampoRH, ModalMarco, inputRH, type AvisoRH } from "@/components/dashboard/modulos-rh";
import {
  MODOS_PRUEBA, crearPruebaPsicometrica, editarPruebaPsicometrica, fetchPruebasPsicometricas, inactivarPruebaPsicometrica,
  type ModoPrueba, type PruebaPsicometrica,
} from "@/lib/api";

export function SeccionPruebasPsicometricas() {
  const [lista, setLista] = useState<PruebaPsicometrica[] | null>(null);
  const [editor, setEditor] = useState<{ prueba: PruebaPsicometrica | null } | null>(null);
  const [aviso, setAviso] = useState<AvisoRH>(null);

  const recargar = useCallback(async () => setLista((await fetchPruebasPsicometricas(true)) ?? []), []);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function alternar(p: PruebaPsicometrica) {
    const r = p.activa ? await inactivarPruebaPsicometrica(p.id) : await editarPruebaPsicometrica(p.id, { activa: true });
    if (!r.ok) return setAviso({ tono: "error", texto: r.error });
    setAviso({ tono: "ok", texto: `«${p.nombre}» ${p.activa ? "inactivada" : "activada"}.` });
    void recargar();
  }

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Brain className="h-4 w-4" /></span>
          <div>
            <h2 className="font-display text-base font-bold">Pruebas psicométricas</h2>
            <p className="mt-0.5 text-sm text-ink-2">Catálogo que se ofrece al agregar una evaluación psicométrica a un candidato.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setEditor({ prueba: null })}><Plus className="h-4 w-4" /> Nueva prueba</Button>
      </div>
      {aviso && <AvisoLinea aviso={aviso} onCerrar={() => setAviso(null)} />}
      <div className="mt-4">
        {lista === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
        ) : lista.length === 0 ? (
          <p className="text-sm text-ink-3">Aún no hay pruebas en el catálogo.</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {lista.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{p.nombre}</span>
                    <span className="font-mono text-[10px] font-normal text-ink-3">{p.clave}</span>
                    <Badge tone={p.activa ? "good" : "neutral"}>{p.activa ? "Activa" : "Inactiva"}</Badge>
                  </p>
                  <p className="truncate text-[11px] text-ink-3">
                    {p.modoTexto}{p.proveedor ? ` · ${p.proveedor}` : ""}{p.idProveedor ? ` (${p.idProveedor})` : ""}{(p.incluye?.length ?? 0) > 0 ? ` · Incluye: ${p.incluye!.join(", ")}` : ""}
                    {p.puestos.length ? ` · sugerida para: ${p.puestos.join(", ")}` : ""}
                  </p>
                </div>
                <MenuAcciones
                  acciones={[
                    { etiqueta: "Editar", icono: <PenLine className="h-4 w-4" />, onClick: () => setEditor({ prueba: p }) },
                    { etiqueta: p.activa ? "Inactivar" : "Activar", icono: <Power className="h-4 w-4" />, peligrosa: p.activa, onClick: () => void alternar(p) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {editor && (
        <ModalPrueba
          prueba={editor.prueba}
          onClose={() => setEditor(null)}
          onGuardada={(n) => { setEditor(null); setAviso({ tono: "ok", texto: `Prueba «${n}» guardada.` }); void recargar(); }}
        />
      )}
    </Card>
  );
}

function ModalPrueba({ prueba, onClose, onGuardada }: { prueba: PruebaPsicometrica | null; onClose: () => void; onGuardada: (n: string) => void }) {
  const [clave, setClave] = useState(prueba?.clave ?? "");
  const [nombre, setNombre] = useState(prueba?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(prueba?.descripcion ?? "");
  const [puestos, setPuestos] = useState((prueba?.puestos ?? []).join(", "));
  const [modo, setModo] = useState<ModoPrueba>(prueba?.modo ?? "manual");
  const [proveedor, setProveedor] = useState(prueba?.proveedor ?? "");
  const [idProveedor, setIdProveedor] = useState(prueba?.idProveedor ?? "");
  const [url, setUrl] = useState(prueba?.url ?? "");
  const [activa, setActiva] = useState(prueba?.activa ?? true);
  // 2026-10-02 (Fraiche §7-8): qué incluye la batería (evita duplicidades) e instrucciones para el candidato
  const [incluye, setIncluye] = useState((prueba?.incluye ?? []).join(", "));
  const [instrucciones, setInstrucciones] = useState(prueba?.instrucciones ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    setOcupado(true);
    const datos = {
      clave, nombre, descripcion, puestos: puestos.split(",").map((x) => x.trim()).filter(Boolean),
      modo, proveedor, id_proveedor: idProveedor, url, activa,
      incluye: incluye.split(",").map((x) => x.trim()).filter(Boolean), instrucciones,
    };
    const r = prueba ? await editarPruebaPsicometrica(prueba.id, datos) : await crearPruebaPsicometrica(datos);
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    onGuardada(r.data.nombre);
  }

  return (
    <ModalMarco titulo={prueba ? "Editar prueba psicométrica" : "Nueva prueba psicométrica"} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoRH label="Identificador interno"><input value={clave} onChange={(e) => setClave(e.target.value)} className={inputRH} placeholder="PSI-CLEAVER" /></CampoRH>
        <CampoRH label="Nombre visible"><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputRH} placeholder="Cleaver" /></CampoRH>
        <div className="sm:col-span-2">
          <CampoRH label="Descripción"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={inputRH} /></CampoRH>
        </div>
        <div className="sm:col-span-2">
          <CampoRH label="Puestos sugeridos" ayuda="Separados por coma. Al asignar a un candidato de ese puesto aparece primero.">
            <input value={puestos} onChange={(e) => setPuestos(e.target.value)} className={inputRH} placeholder="Chofer repartidor, Almacenista" />
          </CampoRH>
        </div>
        <CampoRH label="Modo">
          <select value={modo} onChange={(e) => setModo(e.target.value as ModoPrueba)} className={inputRH}>
            {MODOS_PRUEBA.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
          </select>
        </CampoRH>
        <CampoRH label={modo === "integrada" ? "Proveedor" : "Proveedor (opcional)"}><input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={inputRH} /></CampoRH>
        <CampoRH label="Identificador en el proveedor"><input value={idProveedor} onChange={(e) => setIdProveedor(e.target.value)} className={inputRH} /></CampoRH>
        {modo === "enlace" && <CampoRH label="Liga de la prueba"><input value={url} onChange={(e) => setUrl(e.target.value)} className={inputRH} placeholder="https://…" /></CampoRH>}
        <div className="sm:col-span-2">
          <CampoRH label="Pruebas que incluye" ayuda="Separadas por coma. Se muestran al asignar para evitar duplicidades.">
            <input value={incluye} onChange={(e) => setIncluye(e.target.value)} className={inputRH} placeholder="Índice Evaluatest de Afinidad, Etegrity" />
          </CampoRH>
        </div>
        <div className="sm:col-span-2">
          <CampoRH label="Instrucciones para el candidato" ayuda="Se envían junto con su liga. Vacío = instrucciones generales.">
            <textarea value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} rows={2} className="w-full rounded-xl border border-border-soft bg-surface px-3 py-2 text-sm outline-none focus:border-brand" />
          </CampoRH>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Activa
        </label>
        {modo === "integrada" && (
          <p className="text-[11px] text-ink-3 sm:col-span-2">Conectada con el proveedor: al asignarla se crea la evaluación real en el proveedor, el candidato recibe su acceso y el resultado e informe llegan solos. Sin credenciales del proveedor, los pasos se registran a mano.</p>
        )}
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar prueba
        </Button>
      </div>
    </ModalMarco>
  );
}
