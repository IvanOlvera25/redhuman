"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  MapPin,
  Users,
  X,
  Wand2,
  Check,
  Send,
  Briefcase,
  ShieldAlert,
  Link2,
  RefreshCw,
  ExternalLink,
  Ban,
  RotateCcw,
} from "lucide-react";
import { Button, Card, Badge, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso, BotonCopiar } from "@/components/dashboard/subida";
import { vacantes as vacantesDemo, type Vacante } from "@/lib/data";
import {
  crearVacante,
  fetchVacantes,
  publicarVacante,
  cerrarVacante,
  regenerarVacante,
  generarVacanteIA,
  type BloquePlataforma,
  type CriterioFiltro,
  type VacanteGenerada,
} from "@/lib/api";
import { usePuedeDecidir } from "@/components/sesion";
import { cn } from "@/lib/utils";

const estadoTone: Record<Vacante["estado"], "good" | "neutral" | "warn" | "bad"> = {
  Publicada: "good",
  Borrador: "neutral",
  "En revisión": "warn",
  Cerrada: "bad",
};

const filtros = ["Todas", "Publicada", "Borrador", "En revisión"] as const;

/** Plataformas del distribuidor: cada una tiene su propio copy y su propia page. */
const PLATAFORMAS = [
  { clave: "whatsapp", nombre: "WhatsApp", api: "WhatsApp", nota: "Mensaje y estados", tono: "human" },
  { clave: "occ", nombre: "OCC", api: "OCC", nota: "Texto plano para el formulario de OCC", tono: "brand" },
  { clave: "linkedin", nombre: "LinkedIn", api: "LinkedIn", nota: "Post del feed + LinkedIn Jobs", tono: "brand" },
  { clave: "portal", nombre: "Portal", api: "Portal", nota: "Landing pública /aplicar", tono: "human" },
] as const;

export default function Vacantes() {
  const puedeDecidir = usePuedeDecidir();
  const [filtro, setFiltro] = useState<(typeof filtros)[number]>("Todas");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Vacante | null>(null);
  const [datos, setDatos] = useState<Vacante[]>(vacantesDemo);
  const [live, setLive] = useState(false);
  const [cambiandoEstatus, setCambiandoEstatus] = useState("");

  const recargar = useCallback(
    async (seleccionar?: string) => {
      const v = await fetchVacantes();
      if (v && v.length) {
        setDatos(v);
        setLive(true);
        if (seleccionar) setSel(v.find((x) => x.id === seleccionar) ?? null);
      }
    },
    [],
  );

  useEffect(() => {
    recargar();
  }, [recargar]);

  /** Switch de estatus: Publicada -> Cerrada le quita la vacante del portal público al instante; Cerrada -> Publicada la reabre. */
  async function alternarEstatus(v: Vacante) {
    setCambiandoEstatus(v.id);
    const r =
      v.estado === "Publicada"
        ? await cerrarVacante(v.id)
        : await publicarVacante(v.id, v.plataformas.length ? v.plataformas : ["WhatsApp", "Portal"]);
    setCambiandoEstatus("");
    if (r.ok) recargar(sel?.id === v.id ? v.id : undefined);
  }

  const lista = filtro === "Todas" ? datos : datos.filter((v) => v.estado === filtro);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Vacantes" subtitle="Publica, distribuye y da seguimiento a tus vacantes.">
        {live && (
          <Badge tone="good" dot>
            API en vivo
          </Badge>
        )}
        {puedeDecidir && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Nueva vacante
          </Button>
        )}
      </PageHeader>

      {/* Filtros */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {filtros.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              filtro === f
                ? "border-brand bg-brand-soft text-brand"
                : "border-border-soft text-ink-2 hover:border-brand/40 hover:text-ink",
            )}
          >
            {f}
            {f !== "Todas" && (
              <span className="ml-1.5 font-mono text-xs opacity-70">
                {datos.filter((v) => v.estado === f).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lista.map((v) => (
          <Card key={v.id} hover className="flex cursor-pointer flex-col p-5" onClick={() => setSel(v)}>
            <div className="flex items-start justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
                <Briefcase className="h-5 w-5" />
              </span>
              <Badge tone={estadoTone[v.estado]} dot>
                {v.estado}
              </Badge>
            </div>

            <h3 className="font-display mt-4 text-lg font-bold leading-snug">{v.titulo}</h3>
            <p className="mt-1 text-sm text-ink-3">
              {v.area} · {v.empresa}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-2">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-ink-3" /> {v.ubicacion}
              </span>
              <span className="font-mono text-brand">{v.sueldo}</span>
            </div>

            {v.plataformas.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {v.plataformas.map((p) => (
                  <span key={p} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-3">
                    {p}
                  </span>
                ))}
              </div>
            )}

            {(v.avisosCumplimiento?.length ?? 0) > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-warn">
                <ShieldAlert className="h-3.5 w-3.5" />
                {v.avisosCumplimiento!.length} aviso(s) de cumplimiento por confirmar
              </p>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-border-faint pt-4">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-ink-3" />
                <span className="font-semibold tabular">{v.candidatos}</span>
                <span className="text-ink-3">candidatos</span>
              </div>
              {v.nuevos > 0 && (
                <span className="rounded-full bg-human-soft px-2 py-0.5 text-[11px] font-semibold text-human">
                  {v.nuevos} nuevos
                </span>
              )}
            </div>

            {/* Acción rápida de estatus: no abre el detalle, cambia el switch Publicada <-> Cerrada al instante */}
            {puedeDecidir && (v.estado === "Publicada" || v.estado === "Cerrada") && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  alternarEstatus(v);
                }}
                disabled={cambiandoEstatus === v.id}
                className={cn(
                  "mt-3 flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition disabled:opacity-50",
                  v.estado === "Publicada"
                    ? "border-border-soft text-ink-2 hover:border-bad/40 hover:bg-bad-soft hover:text-bad"
                    : "border-border-soft text-ink-2 hover:border-good/40 hover:bg-good-soft hover:text-good",
                )}
              >
                {v.estado === "Publicada" ? (
                  <>
                    <Ban className="h-3.5 w-3.5" /> {cambiandoEstatus === v.id ? "Cerrando…" : "Cerrar vacante"}
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" /> {cambiandoEstatus === v.id ? "Reabriendo…" : "Reabrir vacante"}
                  </>
                )}
              </button>
            )}
          </Card>
        ))}

        {/* Add card */}
        <button
          onClick={() => setOpen(true)}
          className="group grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-border-soft text-ink-3 transition hover:border-brand hover:text-brand"
        >
          <span className="flex flex-col items-center gap-2">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 transition group-hover:bg-brand-soft">
              <Plus className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium">Crear vacante</span>
          </span>
        </button>
      </div>

      {open && (
        <CrearVacante
          onClose={() => setOpen(false)}
          onGuardado={(codigo) => {
            recargar(codigo);
            setOpen(false);
          }}
        />
      )}

      {sel && <DetalleVacante v={sel} live={live} onClose={() => setSel(null)} onCambio={recargar} />}
    </div>
  );
}

/* ============================================================
   Modal: crear vacante con IA
   ============================================================ */
function CrearVacante({ onClose, onGuardado }: { onClose: () => void; onGuardado: (codigo: string) => void }) {
  const [f, setF] = useState({
    titulo: "Repartidor(a) en motocicleta",
    area: "Logística",
    ubicacion: "Guadalajara, JAL",
    sueldo: "$10,500 + bonos",
    empresa: "Grupo Carbe",
    modalidad: "Presencial",
    requisitos: "Licencia vigente, moto propia, disponibilidad de horario.",
    notas: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const [gen, setGen] = useState<VacanteGenerada | null>(null);
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [destinos, setDestinos] = useState<string[]>(["WhatsApp", "Portal"]);

  async function generar() {
    if (!f.titulo.trim()) {
      setError("El título del puesto es obligatorio.");
      return;
    }
    setGenerando(true);
    setError("");
    const r = await generarVacanteIA(f);
    setGenerando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setGen(r.data);
  }

  async function guardar(publicar: boolean) {
    setGuardando(true);
    setError("");
    const r = await crearVacante({
      ...f,
      descripcion: gen?.descripcion ?? "",
      resumen: gen?.resumen ?? "",
      perfil_ideal: gen?.perfil_ideal ?? "",
      responsabilidades: gen?.responsabilidades ?? [],
      requisitos_deseables: gen?.requisitos_deseables ?? [],
      beneficios: gen?.beneficios ?? [],
      palabras_clave: gen?.palabras_clave ?? [],
      seniority: gen?.seniority ?? "",
      avisos_cumplimiento: gen?.avisos_cumplimiento ?? [],
      texto_whatsapp: gen?.texto_whatsapp ?? "",
      preguntas_filtro: gen?.preguntas_filtro ?? [],
      publicaciones: gen
        ? {
            whatsapp: { titulo: f.titulo, copy: gen.texto_whatsapp, page: gen.texto_whatsapp, etiquetas: [] },
            occ: gen.occ,
            linkedin: gen.linkedin,
            portal: gen.portal,
          }
        : undefined,
      publicar,
      plataformas: publicar ? destinos : [],
      generar_si_falta: !gen, // si RH guarda sin generar, la API genera el contenido
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onGuardado(r.data.id);
  }

  return (
    <Panel titulo="Nueva vacante" eyebrow="Distribuidor de vacantes" onClose={onClose} ancho="max-w-3xl">
      <div className="flex flex-col gap-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título del puesto" value={f.titulo} onChange={set("titulo")} full />
          <Field label="Área" value={f.area} onChange={set("area")} />
          <Field label="Empresa" value={f.empresa} onChange={set("empresa")} />
          <Field label="Ubicación" value={f.ubicacion} onChange={set("ubicacion")} />
          <Field label="Sueldo" value={f.sueldo} onChange={set("sueldo")} />
          <Selector
            label="Modalidad"
            value={f.modalidad}
            onChange={set("modalidad")}
            opciones={["Presencial", "Híbrido", "Remoto"]}
          />
        </div>

        <Area
          label="Requisitos indispensables"
          value={f.requisitos}
          onChange={set("requisitos")}
          ayuda="Sepáralos con comas. La IA quita cualquier criterio discriminatorio (edad, sexo, estado civil) y te avisa."
        />
        <Area
          label="Notas para la IA (opcional)"
          value={f.notas}
          onChange={set("notas")}
          rows={2}
          ayuda="Horario, prestaciones superiores, tono deseado, detalles del equipo…"
        />

        {error && <Aviso tono="error">{error}</Aviso>}

        <Button onClick={generar} disabled={generando} className="w-full">
          {generando ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink/40 border-t-brand-ink" />
              Generando publicación por plataforma…
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" /> {gen ? "Volver a generar" : "Generar publicación con IA"}
            </>
          )}
        </Button>

        {gen && (
          <>
            <ResultadoGeneracion gen={gen} />

            <div>
              <Eyebrow>Publicar en</Eyebrow>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {PLATAFORMAS.map((p) => {
                  const activo = destinos.includes(p.api);
                  return (
                    <button
                      key={p.clave}
                      onClick={() =>
                        setDestinos((d) => (activo ? d.filter((x) => x !== p.api) : [...d, p.api]))
                      }
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
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{p.nombre}</p>
                        <p className="truncate text-xs text-ink-3">{p.nota}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 border-t border-border-faint pt-5">
          <Button variant="outline" className="flex-1" onClick={() => guardar(false)} disabled={guardando}>
            Guardar borrador
          </Button>
          <Button className="flex-1" onClick={() => guardar(true)} disabled={guardando || destinos.length === 0}>
            {guardando ? "Publicando…" : `Publicar en ${destinos.length || 0} plataforma(s)`}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Resultado del generador ---------------- */
function ResultadoGeneracion({ gen }: { gen: VacanteGenerada }) {
  const bloques: Record<string, BloquePlataforma> = useMemo(
    () => ({
      whatsapp: { titulo: "WhatsApp", copy: gen.texto_whatsapp, page: gen.texto_whatsapp, etiquetas: [] },
      occ: gen.occ,
      linkedin: gen.linkedin,
      portal: gen.portal,
    }),
    [gen],
  );

  return (
    <div className="flex flex-col gap-4">
      <Aviso tono={gen.ia ? "ok" : "warn"}>
        {gen.ia
          ? "Publicación generada con IA y adaptada al formato de cada plataforma."
          : "Publicación generada con plantilla (modo demo — agrega OPENAI_API_KEY en la API para IA real)."}
      </Aviso>

      {gen.avisos_cumplimiento.length > 0 && (
        <Card className="border-warn/30 bg-warn-soft/40 p-4">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-warn">
            <ShieldAlert className="h-3.5 w-3.5" /> Cumplimiento · revisa antes de publicar
          </span>
          <ul className="mt-2.5 space-y-1.5">
            {gen.avisos_cumplimiento.map((a, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink-2">
                · {a}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ContenidoBase gen={gen} />
      <PestanasPlataforma bloques={bloques} />
      <Criterios criterios={gen.preguntas_filtro} />
    </div>
  );
}

function ContenidoBase({ gen }: { gen: VacanteGenerada }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Contenido base</span>
        <div className="flex items-center gap-2">
          <Badge tone="brand">{gen.seniority}</Badge>
          <Badge tone="neutral">{gen.rango_salarial_sugerido}</Badge>
        </div>
      </div>

      <p className="mt-3 text-[15px] font-medium leading-relaxed">{gen.resumen}</p>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{gen.descripcion}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ListaCorta titulo="Responsabilidades" items={gen.responsabilidades} />
        <ListaCorta titulo="Indispensables" items={gen.requisitos_indispensables} />
        <ListaCorta titulo="Deseables" items={gen.requisitos_deseables} />
        <ListaCorta titulo="Ofrecemos" items={gen.beneficios} />
      </div>

      {gen.palabras_clave.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border-faint pt-3">
          {gen.palabras_clave.map((p) => (
            <span key={p} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-3">
              {p}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Copy y page de cada plataforma, en pestañas — es lo que RH pega en OCC / LinkedIn. */
function PestanasPlataforma({ bloques, liga }: { bloques: Record<string, BloquePlataforma>; liga?: string }) {
  const disponibles = PLATAFORMAS.filter((p) => bloques[p.clave]?.page || bloques[p.clave]?.copy);
  const [activa, setActiva] = useState(disponibles[0]?.clave ?? "occ");
  const bloque = bloques[activa];

  if (!disponibles.length) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-1 border-b border-border-faint bg-surface-2/50 p-1.5">
        {disponibles.map((p) => (
          <button
            key={p.clave}
            onClick={() => setActiva(p.clave)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium transition",
              activa === p.clave ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            {p.nombre}
          </button>
        ))}
      </div>

      {bloque && (
        <div className="flex flex-col gap-4 p-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                Título ({bloque.titulo.length} car.)
              </span>
              <BotonCopiar texto={bloque.titulo} />
            </div>
            <p className="mt-1.5 text-sm font-semibold">{bloque.titulo}</p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                Copy · difusión ({bloque.copy.length} car.)
              </span>
              <BotonCopiar texto={liga ? `${bloque.copy}\n\n👉 Postúlate aquí: ${liga}` : bloque.copy} />
            </div>
            <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 font-sans text-[13px] leading-relaxed text-ink-2">
              {bloque.copy}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                Page · publicación completa
              </span>
              <BotonCopiar texto={bloque.page} />
            </div>
            <pre className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 font-sans text-[13px] leading-relaxed text-ink-2">
              {bloque.page}
            </pre>
          </div>

          {bloque.etiquetas?.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Etiquetas</span>
                <BotonCopiar texto={bloque.etiquetas.join(", ")} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {bloque.etiquetas.map((e) => (
                  <span key={e} className="rounded-md bg-brand-soft px-2 py-0.5 font-mono text-[10px] text-brand">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Criterios({ criterios }: { criterios: CriterioFiltro[] }) {
  if (!criterios?.length) return null;
  return (
    <Card className="p-4">
      <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
        Criterios de prefiltro · los usa el agente en WhatsApp
      </span>
      <ul className="mt-2.5 space-y-2">
        {criterios.map((q, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-soft font-mono text-[10px] font-bold text-brand">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-2">{q.pregunta}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-3">
                <span>espera: {q.respuesta_esperada}</span>
                {q.descarta ? (
                  <span className="rounded bg-bad-soft px-1.5 py-0.5 text-bad">descarta</span>
                ) : (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5">no descarta</span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ============================================================
   Drawer: detalle de una vacante ya guardada
   ============================================================ */
function DetalleVacante({
  v,
  live,
  onClose,
  onCambio,
}: {
  v: Vacante;
  live: boolean;
  onClose: () => void;
  onCambio: (codigo?: string) => void;
}) {
  const [ocupado, setOcupado] = useState("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const puedeDecidir = usePuedeDecidir();
  const [destinos, setDestinos] = useState<string[]>(v.plataformas.length ? v.plataformas : ["WhatsApp", "Portal"]);

  const liga = v.slug && typeof window !== "undefined" ? `${window.location.origin}/aplicar/${v.slug}` : "";
  const bloques = (v.publicaciones ?? {}) as Record<string, BloquePlataforma>;
  const tieneContenido = Object.keys(bloques).length > 0;

  async function publicar() {
    setOcupado("publicar");
    const r = await publicarVacante(v.id, destinos);
    setOcupado("");
    setAviso(r.ok ? { tono: "ok", texto: `Publicada en ${destinos.join(", ")}.` } : { tono: "error", texto: r.error });
    if (r.ok) onCambio(v.id);
  }

  async function regenerar() {
    setOcupado("regenerar");
    const r = await regenerarVacante(v.id, "");
    setOcupado("");
    setAviso(
      r.ok
        ? { tono: "ok", texto: "Contenido regenerado para las cuatro plataformas." }
        : { tono: "error", texto: r.error },
    );
    if (r.ok) onCambio(v.id);
  }

  /** Switch de estatus: al cerrar, la vacante desaparece de /vacantes/publicas al instante (sin borrar su historial). */
  async function alternarEstatus() {
    setOcupado("estatus");
    const r = v.estado === "Publicada" ? await cerrarVacante(v.id) : await publicarVacante(v.id, destinos);
    setOcupado("");
    setAviso(
      r.ok
        ? {
            tono: "ok",
            texto:
              v.estado === "Publicada"
                ? "Vacante cerrada: ya no aparece en el portal público ni recibe nuevas postulaciones."
                : "Vacante reabierta: vuelve a aparecer en el portal público.",
          }
        : { tono: "error", texto: r.error },
    );
    if (r.ok) onCambio(v.id);
  }

  const embudo = v.embudo?.etapas ?? {};

  return (
    <Panel titulo={v.titulo} eyebrow={v.id} onClose={onClose} ancho="max-w-3xl">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={estadoTone[v.estado]} dot>
            {v.estado}
          </Badge>
          {v.seniority && <Badge tone="brand">{v.seniority}</Badge>}
          <Badge tone="neutral">{v.modalidad}</Badge>
          <span className="text-sm text-ink-2">
            {v.area} · {v.ubicacion} · <span className="font-mono text-brand">{v.sueldo}</span>
          </span>
        </div>

        {/* Embudo de esta vacante — conecta con el pipeline de candidatos */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {["Prefiltro", "Entrevista IA", "Evaluación", "Entrevista Humana", "Contratación", "Onboarding"].map((e) => (
            <div key={e} className="rounded-xl border border-border-soft bg-surface p-3 text-center">
              <p className="font-display text-xl font-bold tabular">{embudo[e] ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-ink-3">{e}</p>
            </div>
          ))}
        </div>

        {liga && (
          <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface-2 px-3.5 py-2.5">
            <Link2 className="h-4 w-4 shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">{liga}</span>
            <BotonCopiar texto={liga} etiqueta="Copiar liga" />
            <a
              href={`/aplicar/${v.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-ink-3 transition hover:text-brand"
              aria-label="Abrir página de postulación"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        {aviso && <Aviso tono={aviso.tono} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso>}

        {(v.avisosCumplimiento?.length ?? 0) > 0 && (
          <Card className="border-warn/30 bg-warn-soft/40 p-4">
            <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-warn">
              <ShieldAlert className="h-3.5 w-3.5" /> Cumplimiento
            </span>
            <ul className="mt-2 space-y-1.5">
              {v.avisosCumplimiento!.map((a, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-ink-2">
                  · {a}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {tieneContenido ? (
          <PestanasPlataforma bloques={bloques} liga={liga} />
        ) : (
          <Aviso tono="info">
            Esta vacante todavía no tiene publicación por plataforma. Genérala para obtener el copy y la page de
            OCC y LinkedIn.
          </Aviso>
        )}

        {(v.criterios?.length ?? 0) > 0 && <Criterios criterios={v.criterios as CriterioFiltro[]} />}

        {live && puedeDecidir && (
          <div className="flex flex-col gap-3 border-t border-border-faint pt-5">
            <div>
              <Eyebrow>Distribuir en</Eyebrow>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {PLATAFORMAS.map((p) => {
                  const activo = destinos.includes(p.api);
                  return (
                    <button
                      key={p.clave}
                      onClick={() =>
                        setDestinos((d) => (activo ? d.filter((x) => x !== p.api) : [...d, p.api]))
                      }
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition",
                        activo
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-border-soft text-ink-2 hover:border-brand/40",
                      )}
                    >
                      {p.nombre}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={regenerar} disabled={Boolean(ocupado)}>
                <RefreshCw className={cn("h-4 w-4", ocupado === "regenerar" && "animate-spin")} />
                {ocupado === "regenerar" ? "Generando…" : "Regenerar con IA"}
              </Button>
              <Button className="flex-1" onClick={publicar} disabled={Boolean(ocupado) || !destinos.length}>
                <Send className="h-4 w-4" />
                {ocupado === "publicar" ? "Publicando…" : "Publicar"}
              </Button>
            </div>

            {(v.estado === "Publicada" || v.estado === "Cerrada") && (
              <div>
                <Eyebrow>Estatus de la vacante</Eyebrow>
                <button
                  onClick={alternarEstatus}
                  disabled={Boolean(ocupado)}
                  className={cn(
                    "mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50",
                    v.estado === "Publicada"
                      ? "border-bad/30 text-bad hover:bg-bad-soft"
                      : "border-good/30 text-good hover:bg-good-soft",
                  )}
                >
                  {v.estado === "Publicada" ? (
                    <>
                      <Ban className="h-4 w-4" />
                      {ocupado === "estatus" ? "Cerrando…" : "Cerrar vacante (deja de verse en el portal)"}
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4" />
                      {ocupado === "estatus" ? "Reabriendo…" : "Reabrir vacante"}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ============================================================
   Piezas compartidas
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

function ListaCorta({ titulo, items }: { titulo: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{titulo}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-ink-2">
            <span className="text-brand">·</span>
            {x}
          </li>
        ))}
      </ul>
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
