"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ClipboardList, MapPin, Users, X, Check, Send } from "lucide-react";
import { Button, Card, Badge, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import {
  crearRequisicion,
  fetchRequisiciones,
  fetchRequisicion,
  autorizarRequisicion,
  rechazarRequisicion,
  convertirVacante,
  decidirSugerencia,
  type Requisicion,
  type SugerenciaMovilidad,
  type MotivoRequisicion,
  type EstadoRequisicion,
} from "@/lib/api";
import { usePuedeDecidir } from "@/components/sesion";
import { cn } from "@/lib/utils";

const estadoTone: Record<EstadoRequisicion, "good" | "neutral" | "warn" | "bad" | "brand"> = {
  borrador: "neutral",
  pendiente_autorizacion: "warn",
  autorizada: "good",
  rechazada: "bad",
  convertida_vacante: "brand",
};

const estadoLabel: Record<EstadoRequisicion, string> = {
  borrador: "Borrador",
  pendiente_autorizacion: "Pendiente",
  autorizada: "Autorizada",
  rechazada: "Rechazada",
  convertida_vacante: "Convertida a vacante",
};

const filtros: { label: string; estado: EstadoRequisicion | null }[] = [
  { label: "Todas", estado: null },
  { label: "Borrador", estado: "borrador" },
  { label: "Pendiente", estado: "pendiente_autorizacion" },
  { label: "Autorizada", estado: "autorizada" },
  { label: "Rechazada", estado: "rechazada" },
];

export default function Requisiciones() {
  const puedeDecidir = usePuedeDecidir();
  const [filtro, setFiltro] = useState<EstadoRequisicion | null>(null);
  const [open, setOpen] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [datos, setDatos] = useState<Requisicion[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async (seleccionar?: string) => {
    const r = await fetchRequisiciones();
    setCargando(false);
    if (r) {
      setDatos(r);
      if (seleccionar) setSelId(seleccionar);
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const lista = filtro ? datos.filter((r) => r.estado === filtro) : datos;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Requisiciones"
        subtitle="Solicita, autoriza y da seguimiento a nuevas plazas — con Radar Interno antes de salir a buscar afuera."
      >
        {puedeDecidir && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Nueva requisición
          </Button>
        )}
      </PageHeader>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {filtros.map((f) => (
          <button
            key={f.label}
            onClick={() => setFiltro(f.estado)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              filtro === f.estado
                ? "border-brand bg-brand-soft text-brand"
                : "border-border-soft text-ink-2 hover:border-brand/40 hover:text-ink",
            )}
          >
            {f.label}
            {f.estado && (
              <span className="ml-1.5 font-mono text-xs opacity-70">
                {datos.filter((r) => r.estado === f.estado).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lista.map((r) => (
          <Card key={r.id} hover className="flex cursor-pointer flex-col p-5" onClick={() => setSelId(r.id)}>
            <div className="flex items-start justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
                <ClipboardList className="h-5 w-5" />
              </span>
              <Badge tone={estadoTone[r.estado]} dot>
                {estadoLabel[r.estado]}
              </Badge>
            </div>

            <h3 className="font-display mt-4 text-lg font-bold leading-snug">{r.puesto}</h3>
            <p className="mt-1 text-sm text-ink-3">
              {r.area || "Sin área"} · {r.motivo}
              {r.motivo === "Reemplazo" && r.reemplazoDe ? ` de ${r.reemplazoDe}` : ""}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-2">
              {r.ubicacion && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-ink-3" /> {r.ubicacion}
                </span>
              )}
              <span className="font-mono text-brand">{r.sueldoPropuesto}</span>
            </div>

            {r.habilidadesRequeridas.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.habilidadesRequeridas.slice(0, 4).map((h) => (
                  <span key={h} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-3">
                    {h}
                  </span>
                ))}
                {r.habilidadesRequeridas.length > 4 && (
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-3">
                    +{r.habilidadesRequeridas.length - 4}
                  </span>
                )}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-border-faint pt-4">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-ink-3" />
                <span className="font-semibold tabular">{r.totalSugerencias}</span>
                <span className="text-ink-3">sugerencias internas</span>
              </div>
              {r.vacante && (
                <span className="rounded-full bg-human-soft px-2 py-0.5 text-[11px] font-semibold text-human">
                  {r.vacante}
                </span>
              )}
            </div>
          </Card>
        ))}

        <button
          onClick={() => setOpen(true)}
          className="group grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-border-soft text-ink-3 transition hover:border-brand hover:text-brand"
        >
          <span className="flex flex-col items-center gap-2">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 transition group-hover:bg-brand-soft">
              <Plus className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium">Crear requisición</span>
          </span>
        </button>
      </div>

      {!cargando && datos.length === 0 && (
        <div className="mt-5">
          <Aviso tono="info">Todavía no hay requisiciones. Crea la primera con el botón de arriba.</Aviso>
        </div>
      )}

      {open && (
        <CrearRequisicion
          onClose={() => setOpen(false)}
          onGuardado={(id) => {
            recargar(id);
            setOpen(false);
          }}
        />
      )}

      {selId && <DetalleRequisicion id={selId} onClose={() => setSelId(null)} onCambio={recargar} />}
    </div>
  );
}

/* ============================================================
   Modal: nueva requisición
   ============================================================ */
function CrearRequisicion({ onClose, onGuardado }: { onClose: () => void; onGuardado: (id: string) => void }) {
  const [f, setF] = useState({
    solicitanteNombre: "",
    area: "",
    motivo: "Crecimiento" as MotivoRequisicion,
    reemplazoDe: "",
    puesto: "",
    ubicacion: "",
    modalidad: "Presencial",
    sueldoPropuesto: "A convenir",
    requisitos: "",
    justificacion: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const [habilidades, setHabilidades] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(enviarAAutorizacion: boolean) {
    if (!f.puesto.trim()) {
      setError("El puesto es obligatorio.");
      return;
    }
    if (f.motivo === "Reemplazo" && !f.reemplazoDe.trim()) {
      setError("Indica a quién se reemplaza.");
      return;
    }
    setGuardando(true);
    setError("");
    const r = await crearRequisicion({ ...f, habilidadesRequeridas: habilidades, enviarAAutorizacion });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onGuardado(r.data.id);
  }

  return (
    <Panel titulo="Nueva requisición" eyebrow="Cazatalentos de IA" onClose={onClose} ancho="max-w-2xl">
      <div className="flex flex-col gap-5 p-6">
        <div>
          <Eyebrow>Motivo</Eyebrow>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            {(["Crecimiento", "Reemplazo"] as MotivoRequisicion[]).map((m) => {
              const activo = f.motivo === m;
              return (
                <button
                  key={m}
                  onClick={() => setF((prev) => ({ ...prev, motivo: m }))}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                    activo ? "border-brand bg-brand-soft/50" : "border-border-soft bg-surface hover:border-brand/40",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                      activo ? "border-brand bg-brand text-brand-ink" : "border-border-soft",
                    )}
                  >
                    {activo && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="text-sm font-semibold">{m}</span>
                </button>
              );
            })}
          </div>
        </div>

        {f.motivo === "Reemplazo" && (
          <Field label="¿A quién se reemplaza?" value={f.reemplazoDe} onChange={set("reemplazoDe")} full />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Puesto" value={f.puesto} onChange={set("puesto")} full />
          <Field label="Área" value={f.area} onChange={set("area")} />
          <Field label="Solicitante" value={f.solicitanteNombre} onChange={set("solicitanteNombre")} />
          <Field label="Ubicación" value={f.ubicacion} onChange={set("ubicacion")} />
          <Field label="Sueldo propuesto" value={f.sueldoPropuesto} onChange={set("sueldoPropuesto")} />
          <Selector
            label="Modalidad"
            value={f.modalidad}
            onChange={set("modalidad")}
            opciones={["Presencial", "Híbrido", "Remoto"]}
          />
        </div>

        <EtiquetasInput
          label="Habilidades requeridas"
          valores={habilidades}
          onChange={setHabilidades}
          ayuda="Escribe una habilidad y presiona Enter. Contra esta lista corre el Radar Interno antes de salir a buscar afuera."
        />

        <Area label="Requisitos indispensables" value={f.requisitos} onChange={set("requisitos")} />
        <Area
          label="Justificación"
          value={f.justificacion}
          onChange={set("justificacion")}
          rows={2}
          ayuda="Por qué se necesita esta plaza — lo que RH revisa para autorizar."
        />

        {error && <Aviso tono="error">{error}</Aviso>}

        <div className="flex items-center gap-3 border-t border-border-faint pt-5">
          <Button variant="outline" className="flex-1" onClick={() => guardar(false)} disabled={guardando}>
            Guardar borrador
          </Button>
          <Button className="flex-1" onClick={() => guardar(true)} disabled={guardando}>
            <Send className="h-4 w-4" />
            {guardando ? "Enviando…" : "Enviar a autorización"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function EtiquetasInput({
  label,
  valores,
  onChange,
  ayuda,
}: {
  label: string;
  valores: string[];
  onChange: (v: string[]) => void;
  ayuda?: string;
}) {
  const [texto, setTexto] = useState("");

  function agregar() {
    const limpio = texto.trim();
    if (limpio && !valores.includes(limpio)) onChange([...valores, limpio]);
    setTexto("");
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-2">{label}</label>
      <div className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregar();
            }
          }}
          placeholder="Ej. React, SQL, liderazgo de equipos…"
          className="h-11 flex-1 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button variant="outline" onClick={agregar}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {valores.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {valores.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1.5 rounded-md bg-brand-soft px-2 py-1 font-mono text-[11px] text-brand"
            >
              {v}
              <button onClick={() => onChange(valores.filter((x) => x !== v))} aria-label={`Quitar ${v}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}

/* ============================================================
   Drawer: detalle de una requisición
   ============================================================ */
function DetalleRequisicion({
  id,
  onClose,
  onCambio,
}: {
  id: string;
  onClose: () => void;
  onCambio: (id?: string) => void;
}) {
  const puedeDecidir = usePuedeDecidir();
  const [r, setR] = useState<(Requisicion & { sugerencias: SugerenciaMovilidad[] }) | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState("");
  const [comentario, setComentario] = useState("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const data = await fetchRequisicion(id);
    setCargando(false);
    if (data) setR(data);
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function autorizar() {
    setOcupado("autorizar");
    const res = await autorizarRequisicion(id, comentario);
    setOcupado("");
    if (!res.ok) {
      setAviso({ tono: "error", texto: res.error });
      return;
    }
    setAviso({
      tono: "ok",
      texto:
        res.data.sugerenciasInternas > 0
          ? `Autorizada. El Radar Interno encontró ${res.data.sugerenciasInternas} sugerencia(s).`
          : "Autorizada. El Radar Interno no encontró coincidencias internas — puedes convertirla en vacante.",
    });
    cargar();
    onCambio();
  }

  async function rechazar() {
    setOcupado("rechazar");
    const res = await rechazarRequisicion(id, comentario);
    setOcupado("");
    setAviso(res.ok ? { tono: "ok", texto: "Requisición rechazada." } : { tono: "error", texto: res.error });
    if (res.ok) {
      cargar();
      onCambio();
    }
  }

  async function convertir() {
    setOcupado("convertir");
    const res = await convertirVacante(id);
    setOcupado("");
    if (!res.ok) {
      setAviso({ tono: "error", texto: res.error });
      return;
    }
    setAviso({ tono: "ok", texto: `Vacante ${res.data.vacante} creada.` });
    cargar();
    onCambio();
  }

  async function decidir(sugerenciaId: number, estado: SugerenciaMovilidad["estado"]) {
    setOcupado(`sugerencia-${sugerenciaId}`);
    const res = await decidirSugerencia(id, sugerenciaId, estado);
    setOcupado("");
    if (res.ok) cargar();
  }

  if (cargando || !r) {
    return (
      <Panel titulo="Cargando…" eyebrow={id} onClose={onClose}>
        <div className="p-6">
          <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel titulo={r.puesto} eyebrow={r.id} onClose={onClose} ancho="max-w-2xl">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={estadoTone[r.estado]} dot>
            {estadoLabel[r.estado]}
          </Badge>
          <Badge tone="neutral">{r.motivo}</Badge>
          <span className="text-sm text-ink-2">
            {r.area || "Sin área"} · {r.ubicacion || "Sin ubicación"} ·{" "}
            <span className="font-mono text-brand">{r.sueldoPropuesto}</span>
          </span>
        </div>

        {r.motivo === "Reemplazo" && r.reemplazoDe && (
          <p className="text-sm text-ink-2">
            Reemplaza a: <span className="font-medium">{r.reemplazoDe}</span>
          </p>
        )}

        {aviso && (
          <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>
            {aviso.texto}
          </Aviso>
        )}

        {r.justificacion && (
          <Card className="p-4">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Justificación</span>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{r.justificacion}</p>
          </Card>
        )}

        {r.requisitos && (
          <Card className="p-4">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Requisitos indispensables</span>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{r.requisitos}</p>
          </Card>
        )}

        {r.habilidadesRequeridas.length > 0 && (
          <div>
            <Eyebrow>Habilidades requeridas</Eyebrow>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {r.habilidadesRequeridas.map((h) => (
                <span key={h} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-3">
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}

        {(r.estado === "autorizada" || r.estado === "convertida_vacante") && (
          <div>
            <Eyebrow>Radar Interno · {r.sugerencias.length} sugerencia(s)</Eyebrow>
            {r.sugerencias.length === 0 ? (
              <div className="mt-2.5">
                <Aviso tono="info">Ningún empleado activo cumple suficientes habilidades por ahora.</Aviso>
              </div>
            ) : (
              <div className="mt-2.5 flex flex-col gap-2.5">
                {r.sugerencias.map((s) => (
                  <Card key={s.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{s.empleado.nombre}</p>
                        <p className="text-xs text-ink-3">
                          {s.empleado.puestoActual || "Sin puesto"} · {s.empleado.area || "Sin área"}
                        </p>
                      </div>
                      <Badge tone={s.porcentajeMatch >= 80 ? "good" : "warn"}>{s.porcentajeMatch}% match</Badge>
                    </div>

                    {s.habilidadesCoincidentes.length > 0 && (
                      <p className="mt-2 text-xs leading-relaxed text-ink-2">
                        Coincide en: {s.habilidadesCoincidentes.join(", ")}
                      </p>
                    )}
                    {s.habilidadesFaltantes.length > 0 && (
                      <p className="mt-1 text-xs leading-relaxed text-ink-3">
                        Le falta: {s.habilidadesFaltantes.join(", ")}
                      </p>
                    )}

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <Badge tone="neutral">{s.estado}</Badge>
                      {puedeDecidir && s.estado === "sugerida" && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => decidir(s.id, "interesado")}
                            disabled={ocupado === `sugerencia-${s.id}`}
                            className="rounded-lg border border-border-soft px-2.5 py-1 text-xs font-medium text-ink-2 transition hover:border-brand/40 hover:text-brand"
                          >
                            Notificar
                          </button>
                          <button
                            onClick={() => decidir(s.id, "descartada")}
                            disabled={ocupado === `sugerencia-${s.id}`}
                            className="rounded-lg border border-border-soft px-2.5 py-1 text-xs font-medium text-ink-2 transition hover:border-bad/40 hover:text-bad"
                          >
                            Descartar
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {puedeDecidir && (r.estado === "borrador" || r.estado === "pendiente_autorizacion") && (
          <div className="flex flex-col gap-3 border-t border-border-faint pt-5">
            <Area label="Comentario de autorización (opcional)" value={comentario} onChange={setComentario} rows={2} />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={rechazar} disabled={Boolean(ocupado)}>
                Rechazar
              </Button>
              <Button className="flex-1" onClick={autorizar} disabled={Boolean(ocupado)}>
                <Check className="h-4 w-4" />
                {ocupado === "autorizar" ? "Autorizando…" : "Autorizar"}
              </Button>
            </div>
          </div>
        )}

        {puedeDecidir && r.estado === "autorizada" && (
          <div className="border-t border-border-faint pt-5">
            <Button className="w-full" onClick={convertir} disabled={Boolean(ocupado)}>
              <Send className="h-4 w-4" />
              {ocupado === "convertir" ? "Creando vacante…" : "Convertir en vacante (buscar afuera)"}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ============================================================
   Piezas compartidas — duplicadas de vacantes/page.tsx porque
   ahí no están exportadas (son privadas a ese archivo).
   ============================================================ */
function Panel({
  titulo,
  eyebrow,
  onClose,
  children,
  ancho = "max-w-xl",
}: {
  titulo: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative flex h-full w-full flex-col overflow-y-auto border-l border-border-soft bg-bg shadow-2xl",
          ancho,
        )}
      >
        <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border-soft px-6 py-4">
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="font-display truncate text-xl font-bold">{titulo}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

function Selector({
  label,
  value,
  onChange,
  opciones,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opciones: string[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      >
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  rows = 3,
  ayuda,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  ayuda?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-2">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}