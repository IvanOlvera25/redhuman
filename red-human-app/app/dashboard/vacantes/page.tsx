"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Sparkles,
  FileEdit,
  Eye,
  Building2,
  LayoutGrid,
  List,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import { Button, Card, Badge, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso, BotonCopiar } from "@/components/dashboard/subida";
import { vacantes as vacantesDemo, type Vacante } from "@/lib/data";
import { useRouter } from "next/navigation";
import {
  crearVacante,
  actualizarVacante,
  fetchVacantes,
  fetchVistaPreviaVacante,
  publicarVacante,
  cerrarVacante,
  regenerarVacante,
  generarVacanteIA,
  fetchClientes,
  fetchEntrevistadores,
  fetchPlantillas,
  crearPlantilla,
  eliminarPlantilla,
  type BloquePlataforma,
  type CriterioFiltro,
  type VacanteGenerada,
  type Cliente,
  type Plantilla,
} from "@/lib/api";
import { usePuedeDecidir } from "@/components/sesion";
import { useAnunciarContextoAgente } from "@/components/dashboard/agente/proveedor";
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
  const router = useRouter();
  const [filtro, setFiltro] = useState<(typeof filtros)[number]>("Todas");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Vacante | null>(null);
  useAnunciarContextoAgente(
    sel ? { pantalla: "vacante", entidad: { tipo: "vacante", codigo: sel.id } } : { pantalla: "vacantes" },
  );
  const [verPrevia, setVerPrevia] = useState<string | null>(null);
  const [gestionPlantillas, setGestionPlantillas] = useState(false);
  const [datos, setDatos] = useState<Vacante[]>(vacantesDemo);
  const [live, setLive] = useState(false);
  const [cambiandoEstatus, setCambiandoEstatus] = useState("");
  // --- Fase C: vista, buscador y filtros avanzados ---
  const [vista, setVista] = useState<"tarjetas" | "lista">("tarjetas");
  const [buscador, setBuscador] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [fCliente, setFCliente] = useState<number | "">("" );
  const [fResponsable, setFResponsable] = useState<number | "">("" );
  const [fArea, setFArea] = useState("");
  const [fUbicacion, setFUbicacion] = useState("");
  const [clientes, setClientes] = useState<import("@/lib/api").Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: number; nombre: string }[]>([]);
  // Menú de acciones flotante por tarjeta/fila
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    // Fase C: restaurar vista preferida desde localStorage
    const guardada = localStorage.getItem("rh-vacantes-vista");
    if (guardada === "lista" || guardada === "tarjetas") setVista(guardada);
    // Cargar listas para los selectores de filtros avanzados
    fetchClientes("Activo").then((c) => setClientes(c ?? []));
    fetchEntrevistadores().then((u) => setUsuarios(u ?? []));
  }, [recargar]);

  // Cerrar menú flotante al hacer click fuera
  useEffect(() => {
    function clickFuera(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(null);
    }
    document.addEventListener("mousedown", clickFuera);
    return () => document.removeEventListener("mousedown", clickFuera);
  }, []);

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

  function cambiarVista(v: "tarjetas" | "lista") {
    setVista(v);
    localStorage.setItem("rh-vacantes-vista", v);
  }

  /** Navega a Candidatos filtrando por vacante + etapa (Punto 17). */
  function navegarAEtapa(vacanteId: string, etapa: string) {
    const params = new URLSearchParams({ vacante: vacanteId, etapa });
    router.push(`/dashboard/candidatos?${params.toString()}`);
  }

  function limpiarFiltros() {
    setFCliente("");
    setFResponsable("");
    setFArea("");
    setFUbicacion("");
    setBuscador("");
  }

  const filtrosActivosCount = [fCliente, fResponsable, fArea, fUbicacion].filter(Boolean).length;

  // Formatear fecha corta
  function fechaCorta(iso: string | null | undefined): string | null {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    } catch {
      return null;
    }
  }

  // Filtrado combinado (estatus + buscador + filtros avanzados — todos client-side)
  const lista = useMemo(() => {
    let r = filtro === "Todas" ? datos : datos.filter((v) => v.estado === filtro);
    if (buscador.trim())
      r = r.filter((v) => v.titulo.toLowerCase().includes(buscador.toLowerCase().trim()));
    if (fArea.trim()) r = r.filter((v) => v.area?.toLowerCase().includes(fArea.toLowerCase().trim()));
    if (fUbicacion.trim()) r = r.filter((v) => v.ubicacion?.toLowerCase().includes(fUbicacion.toLowerCase().trim()));
    if (fCliente) r = r.filter((v) => {
      // cliente es un string de nombre — buscamos las vacantes que tengan algún candidato del cliente seleccionado
      // como no tenemos cliente_id en el frontend, filtramos por nombre de cliente
      const nombreCliente = clientes.find((c) => c.id === fCliente)?.nombre;
      return nombreCliente ? v.cliente === nombreCliente : true;
    });
    if (fResponsable) r = r.filter((v) => {
      const nombreResp = usuarios.find((u) => u.id === fResponsable)?.nombre;
      return nombreResp ? v.responsable === nombreResp : true;
    });
    return r;
  }, [datos, filtro, buscador, fArea, fUbicacion, fCliente, fResponsable, clientes, usuarios]);

  // Columna Cliente: solo si alguna vacante del listado actual tiene cliente != null
  const mostrarCliente = useMemo(() => lista.some((v) => v.cliente), [lista]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Vacantes" subtitle="Publica, distribuye y da seguimiento a tus vacantes.">
        {live && (
          <Badge tone="good" dot>
            API en vivo
          </Badge>
        )}
        {/* Fase C: selector de vista */}
        <div className="flex items-center gap-1 rounded-lg border border-border-soft bg-surface-2 p-1">
          <button
            id="vacantes-vista-tarjetas"
            onClick={() => cambiarVista("tarjetas")}
            className={cn(
              "grid place-items-center rounded-md p-1.5 transition",
              vista === "tarjetas" ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
            title="Vista tarjetas"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            id="vacantes-vista-lista"
            onClick={() => cambiarVista("lista")}
            className={cn(
              "grid place-items-center rounded-md p-1.5 transition",
              vista === "lista" ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
            title="Vista lista"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
        {puedeDecidir && (
          <Button size="sm" variant="outline" onClick={() => setGestionPlantillas(true)}>
            <Sparkles className="h-4 w-4" /> Plantillas
          </Button>
        )}
        {puedeDecidir && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Nueva vacante
          </Button>
        )}
      </PageHeader>

      {/* Filtros rápidos de estatus + buscador + botón Filtros */}
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
        {/* Buscador */}
        <div className="relative ml-auto flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-ink-3" />
          <input
            id="vacantes-buscador"
            type="text"
            placeholder="Buscar por título…"
            value={buscador}
            onChange={(e) => setBuscador(e.target.value)}
            className="h-9 rounded-full border border-border-soft bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
          />
          {buscador && (
            <button onClick={() => setBuscador("")} className="absolute right-3 text-ink-3 hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* Botón Filtros avanzados */}
        <button
          id="vacantes-btn-filtros"
          onClick={() => setFiltrosAbiertos((prev) => !prev)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
            filtrosAbiertos || filtrosActivosCount > 0
              ? "border-brand bg-brand-soft text-brand"
              : "border-border-soft text-ink-2 hover:border-brand/40 hover:text-ink",
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filtros{filtrosActivosCount > 0 ? ` · ${filtrosActivosCount}` : ""}
          <ChevronDown className={cn("h-3.5 w-3.5 transition", filtrosAbiertos && "rotate-180")} />
        </button>
        {(filtrosActivosCount > 0 || buscador) && (
          <button
            onClick={limpiarFiltros}
            className="text-xs text-ink-3 underline hover:text-ink"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Panel de filtros avanzados */}
      {filtrosAbiertos && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border-soft bg-surface-2 p-4">
          {clientes.length > 0 && (
            <label className="flex flex-col gap-1.5 text-xs text-ink-2">
              Cliente
              <select
                value={fCliente}
                onChange={(e) => setFCliente(e.target.value ? Number(e.target.value) : "")}
                className="rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="">Todos</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </label>
          )}
          {usuarios.length > 0 && (
            <label className="flex flex-col gap-1.5 text-xs text-ink-2">
              Responsable
              <select
                value={fResponsable}
                onChange={(e) => setFResponsable(e.target.value ? Number(e.target.value) : "")}
                className="rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="">Todos</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-xs text-ink-2">
            Área
            <input
              type="text"
              value={fArea}
              onChange={(e) => setFArea(e.target.value)}
              placeholder="Ej: Operaciones"
              className="rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-2">
            Ubicación
            <input
              type="text"
              value={fUbicacion}
              onChange={(e) => setFUbicacion(e.target.value)}
              placeholder="Ej: Guadalajara"
              className="rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
            />
          </label>
          <button
            onClick={limpiarFiltros}
            className="rounded-lg border border-border-soft px-3 py-2 text-sm text-ink-2 hover:border-bad/40 hover:bg-bad-soft hover:text-bad"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Vista Tarjetas */}
      {vista === "tarjetas" && (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((v) => (
            <Card key={v.id} hover className="flex cursor-pointer flex-col p-5" onClick={() => setSel(v)}>
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Briefcase className="h-5 w-5" />
                </span>
                <div className="flex items-center gap-2">
                  <Badge tone={estadoTone[v.estado]} dot>{v.estado}</Badge>
                  {/* Menú de acciones (Fase C: mover de botón principal a ⋯) */}
                  {puedeDecidir && (v.estado === "Publicada" || v.estado === "Cerrada") && (
                    <div className="relative" ref={menuAbierto === v.id ? menuRef : undefined}>
                      <button
                        id={`vacante-menu-${v.id}`}
                        onClick={(e) => { e.stopPropagation(); setMenuAbierto(menuAbierto === v.id ? null : v.id); }}
                        className="grid place-items-center rounded-lg p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menuAbierto === v.id && (
                        <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-border-soft bg-surface p-1 shadow-lg">
                          <button
                            onClick={(e) => { e.stopPropagation(); setMenuAbierto(null); alternarEstatus(v); }}
                            disabled={cambiandoEstatus === v.id}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50",
                              v.estado === "Publicada" ? "text-bad" : "text-good",
                            )}
                          >
                            {v.estado === "Publicada" ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            {cambiandoEstatus === v.id ? "…" : v.estado === "Publicada" ? "Cerrar vacante" : "Reabrir vacante"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <h3 className="font-display mt-4 text-lg font-bold leading-snug">{v.titulo}</h3>
              <p className="mt-1 text-sm text-ink-3">
                {v.area} · {v.cliente ?? v.empresa}
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
                    <span key={p} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-3">{p}</span>
                  ))}
                </div>
              )}

              {(v.avisosCumplimiento?.length ?? 0) > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-[11px] text-warn">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {v.avisosCumplimiento!.length} aviso(s) de cumplimiento por confirmar
                </p>
              )}

              {/* Fase C: mini-embudo clicable (Punto 16 + 17) */}
              {v.embudo?.etapas && Object.keys(v.embudo.etapas).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {Object.entries(v.embudo.etapas)
                    .filter(([, n]) => n > 0)
                    .map(([etapa, n]) => (
                      <button
                        key={etapa}
                        id={`vacante-embudo-${v.id}-${etapa.replace(/\s/g, "-")}`}
                        onClick={(e) => { e.stopPropagation(); navegarAEtapa(v.id, etapa); }}
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-ink-3 transition hover:bg-brand-soft hover:text-brand"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                        {etapa} <span className="font-semibold tabular">{n}</span>
                      </button>
                    ))}
                </div>
              )}

              {/* Fase C: pie con candidatos + fechas */}
              <div className="mt-auto flex items-end justify-between border-t border-border-faint pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-ink-3" />
                  <span className="font-semibold tabular">{v.candidatos}</span>
                  <span className="text-ink-3">candidatos</span>
                  {v.nuevos > 0 && (
                    <span className="rounded-full bg-human-soft px-2 py-0.5 text-[11px] font-semibold text-human">
                      {v.nuevos} nuevos
                    </span>
                  )}
                </div>
                <div className="text-right text-[11px] text-ink-3">
                  {fechaCorta(v.creada) && <span>Creada {fechaCorta(v.creada)}</span>}
                  {fechaCorta(v.publicadaEn) && (
                    <><br /><span className="text-good">Publicada {fechaCorta(v.publicadaEn)}</span></>
                  )}
                </div>
              </div>
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
      )}

      {/* Fase C: Vista Lista */}
      {vista === "lista" && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft bg-surface-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3 text-left">Vacante</th>
                {mostrarCliente && <th className="px-4 py-3 text-left">Cliente</th>}
                <th className="px-4 py-3 text-left">Área</th>
                <th className="px-4 py-3 text-left">Estatus</th>
                <th className="px-4 py-3 text-left">Candidatos / Etapas</th>
                <th className="px-4 py-3 text-left">Responsable</th>
                <th className="px-4 py-3 text-left">Ubicación</th>
                <th className="px-4 py-3 text-left">Creada</th>
                {puedeDecidir && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-faint">
              {lista.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => setSel(v)}
                  className="cursor-pointer transition hover:bg-brand-soft/30"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{v.titulo}</p>
                    <p className="font-mono text-[11px] text-ink-3">{v.id}</p>
                  </td>
                  {mostrarCliente && <td className="px-4 py-3 text-ink-2">{v.cliente ?? "—"}</td>}
                  <td className="px-4 py-3 text-ink-2">{v.area || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={estadoTone[v.estado]} dot>{v.estado}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-ink-2">
                      <Users className="h-3.5 w-3.5 text-ink-3" />
                      <span className="font-semibold">{v.candidatos}</span>
                    </div>
                    {v.embudo?.etapas && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(v.embudo.etapas)
                          .filter(([, n]) => n > 0)
                          .map(([etapa, n]) => (
                            <button
                              key={etapa}
                              onClick={(e) => { e.stopPropagation(); navegarAEtapa(v.id, etapa); }}
                              className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand hover:bg-brand hover:text-white"
                            >
                              {etapa} {n}
                            </button>
                          ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-2">{v.responsable ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-2">{v.ubicacion || "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-3">
                    {fechaCorta(v.creada) ?? "—"}
                    {fechaCorta(v.publicadaEn) && (
                      <div className="text-good">{fechaCorta(v.publicadaEn)}</div>
                    )}
                  </td>
                  {puedeDecidir && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {(v.estado === "Publicada" || v.estado === "Cerrada") && (
                        <button
                          onClick={() => alternarEstatus(v)}
                          disabled={cambiandoEstatus === v.id}
                          className={cn(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                            v.estado === "Publicada"
                              ? "border-bad/30 text-bad hover:bg-bad-soft"
                              : "border-good/30 text-good hover:bg-good-soft",
                          )}
                        >
                          {cambiandoEstatus === v.id ? "…" : v.estado === "Publicada" ? "Cerrar" : "Reabrir"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length === 0 && (
            <div className="py-12 text-center text-sm text-ink-3">Sin vacantes con estos filtros.</div>
          )}
        </div>
      )}

      {open && (
        <CrearVacante
          onClose={() => setOpen(false)}
          onGuardado={(codigo) => {
            recargar(codigo);
            setOpen(false);
          }}
        />
      )}

      {sel && (
        <DetalleVacante
          v={sel}
          live={live}
          onClose={() => setSel(null)}
          onCambio={recargar}
          onVerPrevia={() => setVerPrevia(sel.id)}
        />
      )}

      {verPrevia && <VistaPreviaVacante codigo={verPrevia} onClose={() => setVerPrevia(null)} />}

      {gestionPlantillas && <GestionPlantillas onClose={() => setGestionPlantillas(false)} />}
    </div>
  );
}

/* ============================================================
   Modal: crear vacante con IA
   ============================================================ */
function CrearVacante({ onClose, onGuardado }: { onClose: () => void; onGuardado: (codigo: string) => void }) {
  const [paso, setPaso] = useState<"elegir" | "plantilla" | "formulario">("elegir");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: number; nombre: string }[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [clienteParaPlantilla, setClienteParaPlantilla] = useState<number | "">("");
  const [plantillaBase, setPlantillaBase] = useState<Plantilla | null>(null);

  useEffect(() => {
    fetchClientes("Activo").then((c) => setClientes(c ?? []));
    fetchEntrevistadores().then((u) => setUsuarios(u ?? []));
  }, []);

  useEffect(() => {
    if (paso !== "plantilla") return;
    fetchPlantillas(clienteParaPlantilla || undefined).then((p) => setPlantillas(p ?? []));
  }, [paso, clienteParaPlantilla]);

  function elegirPlantilla(p: Plantilla) {
    setPlantillaBase(p);
    setF((prev) => ({
      ...prev,
      titulo: p.titulo || prev.titulo,
      area: p.area || prev.area,
      sueldo: p.sueldo || prev.sueldo,
      modalidad: p.modalidad || prev.modalidad,
      requisitos: p.requisitos || prev.requisitos,
    }));
    if (p.clienteId) setClienteId(p.clienteId);
    setPaso("formulario");
  }

  const [f, setF] = useState({
    titulo: "",
    area: "",
    ubicacion: "",
    sueldo: "",
    empresa: "",
    modalidad: "Presencial",
    requisitos: "",
    notas: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const [clienteId, setClienteId] = useState<number | "">("");
  const [responsableId, setResponsableId] = useState<number | "">("");
  const [colaboradoresIds, setColaboradoresIds] = useState<number[]>([]);
  const [mostrarCliente, setMostrarCliente] = useState(true);

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
    // El contenido viene de lo que la IA generó en esta sesión si se corrió; si no, de la
    // plantilla elegida (si hubo); si tampoco, se manda vacío y generar_si_falta deja que la
    // API lo genere sola al guardar.
    const contenido = gen
      ? {
          descripcion: gen.descripcion,
          resumen: gen.resumen,
          perfil_ideal: gen.perfil_ideal,
          responsabilidades: gen.responsabilidades,
          requisitos_deseables: gen.requisitos_deseables,
          beneficios: gen.beneficios,
          palabras_clave: gen.palabras_clave,
          seniority: gen.seniority,
          avisos_cumplimiento: gen.avisos_cumplimiento,
          texto_whatsapp: gen.texto_whatsapp,
          preguntas_filtro: gen.preguntas_filtro,
          publicaciones: {
            whatsapp: { titulo: f.titulo, copy: gen.texto_whatsapp, page: gen.texto_whatsapp, etiquetas: [] },
            occ: gen.occ,
            linkedin: gen.linkedin,
            portal: gen.portal,
          },
        }
      : plantillaBase
        ? {
            descripcion: plantillaBase.descripcion,
            resumen: plantillaBase.resumen,
            perfil_ideal: plantillaBase.perfilIdeal,
            responsabilidades: plantillaBase.responsabilidades,
            requisitos_deseables: plantillaBase.requisitosDeseables,
            beneficios: plantillaBase.beneficios,
            palabras_clave: plantillaBase.palabrasClave,
            seniority: plantillaBase.seniority,
            avisos_cumplimiento: plantillaBase.avisosCumplimiento,
            texto_whatsapp: plantillaBase.textoWhatsapp,
            preguntas_filtro: plantillaBase.preguntasFiltro,
          }
        : {};

    const r = await crearVacante({
      ...f,
      ...contenido,
      publicar,
      plataformas: publicar ? destinos : [],
      generar_si_falta: !gen && !plantillaBase, // sin IA ni plantilla, la API genera el contenido
      cliente_id: clienteId || null,
      responsable_id: responsableId || null,
      colaboradores_ids: colaboradoresIds,
      mostrar_cliente_candidato: mostrarCliente,
      plantilla_id: plantillaBase?.id ?? null,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onGuardado(r.data.id);
  }

  if (paso === "elegir") {
    return (
      <Panel titulo="Nueva vacante" eyebrow="Distribuidor de vacantes" onClose={onClose} ancho="max-w-2xl">
        <div className="flex flex-col gap-4 p-6">
          <p className="text-sm text-ink-2">¿Cómo quieres empezar? Ninguna opción es obligatoria.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => {
                setPlantillaBase(null);
                setPaso("formulario");
              }}
              className="group flex flex-col items-start gap-3 rounded-2xl border border-border-soft bg-surface p-5 text-left transition hover:border-brand"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
                <FileEdit className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-base font-bold">Crear desde cero</p>
                <p className="mt-1 text-sm text-ink-3">Empieza con un formulario en blanco.</p>
              </div>
            </button>
            <button
              onClick={() => setPaso("plantilla")}
              className="group flex flex-col items-start gap-3 rounded-2xl border border-border-soft bg-surface p-5 text-left transition hover:border-brand"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-human-soft text-human">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-base font-bold">Usar plantilla</p>
                <p className="mt-1 text-sm text-ink-3">Precarga puesto, descripción, requisitos y preguntas.</p>
              </div>
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  if (paso === "plantilla") {
    return (
      <Panel titulo="Usar plantilla" eyebrow="Nueva vacante" onClose={onClose} ancho="max-w-2xl">
        <div className="flex flex-col gap-4 p-6">
          <button onClick={() => setPaso("elegir")} className="self-start text-xs font-medium text-ink-3 hover:text-brand">
            ← Volver
          </button>
          {clientes.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Cliente (opcional)</span>
              <select
                value={clienteParaPlantilla}
                onChange={(e) => setClienteParaPlantilla(e.target.value ? Number(e.target.value) : "")}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Sin Cliente (solo plantillas generales)</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          {plantillas.length === 0 ? (
            <Aviso tono="info">
              No hay plantillas {clienteParaPlantilla ? "para este Cliente ni generales" : "generales"} todavía.
              Cierra esta ventana y crea la vacante desde cero.
            </Aviso>
          ) : (
            <div className="flex flex-col gap-2.5">
              {plantillas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => elegirPlantilla(p)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border-soft bg-surface p-4 text-left transition hover:border-brand"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{p.nombre}</p>
                    <p className="truncate text-xs text-ink-3">{p.titulo || "Sin título precargado"}</p>
                  </div>
                  {p.clienteNombre ? <Badge tone="brand">{p.clienteNombre}</Badge> : <Badge tone="neutral">General</Badge>}
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel titulo="Nueva vacante" eyebrow="Distribuidor de vacantes" onClose={onClose} ancho="max-w-3xl">
      <div className="flex flex-col gap-5 p-6">
        {plantillaBase && (
          <Aviso tono="ok">
            Formulario precargado desde la plantilla «{plantillaBase.nombre}». Puedes editar cualquier campo.
          </Aviso>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título del puesto" value={f.titulo} onChange={set("titulo")} placeholder="Ej. Repartidor en motocicleta" full />
          <Field label="Área" value={f.area} onChange={set("area")} placeholder="Ej. Logística" />
          <Field label="Empresa" value={f.empresa} onChange={set("empresa")} placeholder="Ej. Red Human S.A. de C.V." />
          <Field label="Ubicación" value={f.ubicacion} onChange={set("ubicacion")} placeholder="Ej. Ciudad de México, CDMX" />
          <Field label="Sueldo" value={f.sueldo} onChange={set("sueldo")} placeholder="Ej. $12,000 - $15,000 mensuales" />
          <Selector
            label="Modalidad"
            value={f.modalidad}
            onChange={set("modalidad")}
            opciones={["Presencial", "Híbrido", "Remoto"]}
          />
        </div>

        {/* Cuenta (automática) / Cliente / Responsable / Colaboradores — Fase B, punto 8 */}
        <div className="grid gap-4 border-t border-border-faint pt-5 sm:grid-cols-2">
          {clientes.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Cliente (opcional)</span>
              <select
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : "")}
                className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Sin Cliente — la Cuenta recluta directo</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Responsable (opcional)</span>
            <select
              value={responsableId}
              onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : "")}
              className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Quien crea la vacante</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>

        {usuarios.length > 0 && (
          <div>
            <Eyebrow>Colaboradores (opcional)</Eyebrow>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {usuarios.map((u) => {
                const activo = colaboradoresIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() =>
                      setColaboradoresIds((ids) => (activo ? ids.filter((x) => x !== u.id) : [...ids, u.id]))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[13px] font-medium transition",
                      activo ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/40",
                    )}
                  >
                    {u.nombre}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {clienteId !== "" && (
          <ToggleSiNo
            label="Mostrar cliente al candidato"
            ayuda="Si está en 'No', el candidato ve el nombre de tu Cuenta en vez del Cliente — internamente el equipo siempre ve la relación real."
            valor={mostrarCliente}
            onChange={setMostrarCliente}
          />
        )}

        <Area
          label="Requisitos indispensables"
          value={f.requisitos}
          onChange={set("requisitos")}
          placeholder="Ej. Licencia de conducir vigente, disponibilidad de horario"
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

/* ============================================================
   Gestión de Plantillas (Fase B, punto 11)
   ============================================================ */
function GestionPlantillas({ onClose }: { onClose: () => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [crear, setCrear] = useState(false);

  const recargar = useCallback(async () => {
    const p = await fetchPlantillas();
    setPlantillas(p ?? []);
  }, []);

  useEffect(() => {
    fetchClientes("Activo").then((c) => setClientes(c ?? []));
    recargar().then(() => setCargando(false));
  }, [recargar]);

  async function desactivar(id: number) {
    await eliminarPlantilla(id);
    recargar();
  }

  return (
    <Panel titulo="Plantillas de vacante" eyebrow="General de la Cuenta o de un Cliente" onClose={onClose} ancho="max-w-2xl">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            Precargan puesto, descripción, requisitos y preguntas al crear una vacante.
          </p>
          <Button size="sm" variant="outline" onClick={() => setCrear((v) => !v)}>
            <Plus className="h-4 w-4" /> {crear ? "Cancelar" : "Nueva"}
          </Button>
        </div>

        {crear && (
          <FormularioPlantilla
            clientes={clientes}
            onCreada={() => {
              setCrear(false);
              recargar();
            }}
          />
        )}

        {cargando ? (
          <p className="text-sm text-ink-3">Cargando…</p>
        ) : plantillas.length === 0 ? (
          <Aviso tono="info">
            Todavía no hay ninguna plantilla. Créala aquí, o desde el detalle de una vacante con
            «Guardar este contenido como plantilla reutilizable».
          </Aviso>
        ) : (
          <ul className="flex flex-col divide-y divide-border-faint">
            {plantillas.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{p.nombre}</p>
                  <p className="truncate text-xs text-ink-3">{p.titulo || "Sin título precargado"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.clienteNombre ? <Badge tone="brand">{p.clienteNombre}</Badge> : <Badge tone="neutral">General</Badge>}
                  <button onClick={() => desactivar(p.id)} className="text-xs font-medium text-bad hover:underline">
                    Desactivar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function FormularioPlantilla({ clientes, onCreada }: { clientes: Cliente[]; onCreada: () => void }) {
  const [nombre, setNombre] = useState("");
  const [clienteId, setClienteId] = useState<number | "">("");
  const [titulo, setTitulo] = useState("");
  const [requisitos, setRequisitos] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function crear() {
    if (!nombre.trim()) {
      setError("El nombre de la plantilla es obligatorio.");
      return;
    }
    setGuardando(true);
    setError("");
    const r = await crearPlantilla({ nombre: nombre.trim(), cliente_id: clienteId || null, titulo, requisitos, descripcion });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onCreada();
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label="Nombre de la plantilla" value={nombre} onChange={setNombre} placeholder="Ej. Vendedor de piso estándar" full />
      {clientes.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Alcance</span>
          <select
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : "")}
            className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">General de la Cuenta</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <Field label="Título del puesto" value={titulo} onChange={setTitulo} placeholder="Ej. Vendedor de piso" />
      <Area label="Requisitos" value={requisitos} onChange={setRequisitos} rows={2} />
      <Area label="Descripción" value={descripcion} onChange={setDescripcion} rows={3} />
      {error && <Aviso tono="error">{error}</Aviso>}
      <Button size="sm" onClick={crear} disabled={guardando}>
        {guardando ? "Guardando…" : "Crear plantilla"}
      </Button>
    </Card>
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
   Cliente / Responsable / Colaboradores — únicos campos editables del detalle (Fase B)
   ============================================================ */
function RelacionesVacante({ v, onCambio }: { v: Vacante; onCambio: () => void }) {
  const puedeDecidir = usePuedeDecidir();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: number; nombre: string }[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    fetchClientes("Activo").then((c) => setClientes(c ?? []));
    fetchEntrevistadores().then((u) => setUsuarios(u ?? []));
  }, []);

  async function guardar(cambios: Record<string, unknown>) {
    setGuardando(true);
    await actualizarVacante(v.id, cambios);
    setGuardando(false);
    onCambio();
  }

  if (!puedeDecidir) {
    return (
      <Card className="p-4 text-sm text-ink-2">
        <p>Cliente: {v.cliente ?? "— la Cuenta recluta directo —"}</p>
        <p className="mt-1">Responsable: {v.responsable ?? "—"}</p>
        {(v.colaboradores?.length ?? 0) > 0 && <p className="mt-1">Colaboradores: {v.colaboradores!.join(", ")}</p>}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <Eyebrow>Cliente y responsables</Eyebrow>
      <div className="grid gap-4 sm:grid-cols-2">
        {clientes.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Cliente</span>
            <select
              value={v.cliente ? clientes.find((c) => c.nombre === v.cliente)?.id ?? "" : ""}
              onChange={(e) => guardar({ cliente_id: e.target.value ? Number(e.target.value) : null })}
              disabled={guardando}
              className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Sin Cliente — la Cuenta recluta directo</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Responsable</span>
          <select
            value={usuarios.find((u) => u.nombre === v.responsable)?.id ?? ""}
            onChange={(e) => guardar({ responsable_id: e.target.value ? Number(e.target.value) : null })}
            disabled={guardando}
            className="h-11 rounded-xl border border-border-soft bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">Sin asignar</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      {usuarios.length > 0 && (
        <div>
          <span className="text-sm font-medium text-ink-2">Colaboradores</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {usuarios.map((u) => {
              const activo = (v.colaboradores ?? []).includes(u.nombre);
              return (
                <button
                  key={u.id}
                  disabled={guardando}
                  onClick={() => {
                    const nombresActuales = v.colaboradores ?? [];
                    const idsActuales = usuarios.filter((x) => nombresActuales.includes(x.nombre)).map((x) => x.id);
                    const nuevos = activo ? idsActuales.filter((x) => x !== u.id) : [...idsActuales, u.id];
                    guardar({ colaboradores_ids: nuevos });
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-50",
                    activo ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/40",
                  )}
                >
                  {u.nombre}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {v.cliente && (
        <ToggleSiNo
          label="Mostrar cliente al candidato"
          ayuda="Si está en 'No', el candidato ve el nombre de tu Cuenta en vez del Cliente."
          valor={v.mostrarClienteCandidato ?? true}
          onChange={(valor) => guardar({ mostrar_cliente_candidato: valor })}
        />
      )}
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
  onVerPrevia,
}: {
  v: Vacante;
  live: boolean;
  onClose: () => void;
  onCambio: (codigo?: string) => void;
  onVerPrevia: () => void;
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

  const [mostrarGuardarPlantilla, setMostrarGuardarPlantilla] = useState(false);
  const [nombrePlantilla, setNombrePlantilla] = useState("");
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false);

  /** Guarda el contenido ya generado de esta vacante como una Plantilla general (Fase B, punto
   * 11) — la forma más natural de armar una plantilla rica sin capturar todo a mano. Se puede
   * mover a un Cliente específico después desde la gestión de Plantillas. */
  async function guardarComoPlantilla() {
    if (!nombrePlantilla.trim()) return;
    setGuardandoPlantilla(true);
    const r = await crearPlantilla({
      nombre: nombrePlantilla.trim(),
      titulo: v.titulo,
      area: v.area,
      modalidad: v.modalidad,
      sueldo: v.sueldo,
      requisitos: v.requisitos ?? "",
      descripcion: v.descripcion ?? "",
      resumen: v.resumen ?? "",
      perfil_ideal: v.perfilIdeal ?? "",
      responsabilidades: v.responsabilidades ?? [],
      requisitos_deseables: v.requisitosDeseables ?? [],
      beneficios: v.beneficios ?? [],
      palabras_clave: v.palabrasClave ?? [],
      seniority: v.seniority ?? "",
      avisos_cumplimiento: v.avisosCumplimiento ?? [],
      preguntas_filtro: (v.criterios ?? []) as CriterioFiltro[],
      texto_whatsapp: v.textoWhatsapp ?? "",
      texto_bolsa: v.textoBolsa ?? "",
    });
    setGuardandoPlantilla(false);
    if (!r.ok) {
      setAviso({ tono: "error", texto: r.error });
      return;
    }
    setAviso({ tono: "ok", texto: `Plantilla "${r.data.nombre}" creada — ya se puede sugerir en nuevas vacantes.` });
    setMostrarGuardarPlantilla(false);
    setNombrePlantilla("");
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

        {live && (
          <button
            onClick={onVerPrevia}
            className="flex items-center justify-center gap-2 rounded-xl border border-border-soft px-4 py-2.5 text-sm font-semibold text-ink-2 transition hover:border-brand/40 hover:text-brand"
          >
            <Eye className="h-4 w-4" /> Vista previa — cómo la ve el candidato
          </button>
        )}

        {live && <RelacionesVacante v={v} onCambio={() => onCambio(v.id)} />}

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

        {live && puedeDecidir && tieneContenido && (
          <div className="rounded-xl border border-border-soft p-4">
            {mostrarGuardarPlantilla ? (
              <div className="flex gap-2">
                <input
                  value={nombrePlantilla}
                  onChange={(e) => setNombrePlantilla(e.target.value)}
                  placeholder="Nombre de la plantilla"
                  className="h-10 flex-1 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <Button size="sm" onClick={guardarComoPlantilla} disabled={guardandoPlantilla || !nombrePlantilla.trim()}>
                  {guardandoPlantilla ? "Guardando…" : "Guardar"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setMostrarGuardarPlantilla(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setMostrarGuardarPlantilla(true)}
                className="text-sm font-medium text-brand hover:underline"
              >
                Guardar este contenido como plantilla reutilizable
              </button>
            )}
          </div>
        )}

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

/** Vista previa (Fase B, punto 12) — mismo layout conceptual que /aplicar/[slug]: título,
 * nombre de empresa ya resuelto por el backend (Cliente o Cuenta, según el flag), ubicación,
 * sueldo/modalidad, resumen/descripción/responsabilidades/beneficios. Logo de la Cuenta si
 * existe. Funciona con la vacante en Borrador — nunca es obligatoria para publicar. */
function VistaPreviaVacante({ codigo, onClose }: { codigo: string; onClose: () => void }) {
  const [v, setV] = useState<Vacante | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    fetchVistaPreviaVacante(codigo).then((data) => {
      setV(data);
      setCargando(false);
    });
  }, [codigo]);

  return (
    <Panel titulo="Vista previa" eyebrow="Cómo la ve el candidato" onClose={onClose} ancho="max-w-2xl">
      <div className="flex flex-col gap-5 p-6">
        {cargando && <p className="text-sm text-ink-3">Cargando…</p>}
        {!cargando && !v && <Aviso tono="error">No se pudo cargar la vista previa.</Aviso>}
        {v && (
          <Card className="p-6">
            {v.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.logoUrl} alt={v.nombreEmpresa ?? ""} className="h-10 w-auto object-contain" />
            ) : (
              <span className="font-display text-lg font-bold text-brand">Red Human AI</span>
            )}
            <h2 className="font-display mt-4 text-2xl font-bold">{v.titulo}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-2">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-ink-3" /> {v.nombreEmpresa ?? v.empresa}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-ink-3" /> {v.ubicacion}
              </span>
              <span>{v.modalidad}</span>
              <span className="font-mono text-brand">{v.sueldo}</span>
            </div>
            {v.resumen && <p className="mt-4 text-[15px] font-medium leading-relaxed">{v.resumen}</p>}
            {v.descripcion && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{v.descripcion}</p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ListaCorta titulo="Responsabilidades" items={v.responsabilidades ?? []} />
              <ListaCorta titulo="Ofrecemos" items={v.beneficios ?? []} />
            </div>
          </Card>
        )}
      </div>
    </Panel>
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
  placeholder,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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

function ToggleSiNo({
  label,
  ayuda,
  valor,
  onChange,
}: {
  label: string;
  ayuda?: string;
  valor: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="mt-1.5 flex gap-2">
        {[
          { texto: "Sí", val: true },
          { texto: "No", val: false },
        ].map((o) => (
          <button
            key={o.texto}
            onClick={() => onChange(o.val)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-[13px] font-medium transition",
              valor === o.val ? "border-brand bg-brand-soft text-brand" : "border-border-soft text-ink-2 hover:border-brand/40",
            )}
          >
            {o.texto}
          </button>
        ))}
      </div>
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  rows = 3,
  ayuda,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  ayuda?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-2">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {ayuda && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{ayuda}</p>}
    </div>
  );
}
