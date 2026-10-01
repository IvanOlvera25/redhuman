"use client";

/* Tablero de control de Reclutamiento (Fraiche, spec §14). Solo datos reales de `GET /metricas/reclutamiento`
   (filtrados por la Cuenta en el servidor); sin datos se ven ceros y «Sin datos», nunca cifras inventadas.
   Los filtros viven en la URL (liga compartible) y la vista se revalida con `usePolling`.
   Lo ven Coordinación de Reclutamiento y Administrador; el servidor es quien realmente lo exige. */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Building2, Store, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { PageHeader, KpiCard } from "@/components/dashboard/parts";
import { usePuedeVerTableroReclutamiento, useSesion } from "@/components/sesion";
import { fetchClientes, fetchTableroReclutamiento, fetchVacantes, type Cliente, type TableroReclutamiento } from "@/lib/api";
import type { Vacante } from "@/lib/data";
import { usePolling } from "@/lib/use-polling";

type Filtros = { destino: string; reclutador: string; zona: string; sucursal: string; cliente: string; vacante: string; fuente: string };
const CLAVES: (keyof Filtros)[] = ["destino", "reclutador", "zona", "sucursal", "cliente", "vacante", "fuente"];

const DESTINOS: { valor: string; texto: string }[] = [
  { valor: "", texto: "Todas" },
  { valor: "tienda_propia", texto: "Tiendas propias" },
  { valor: "franquicia", texto: "Franquicias" },
];

function fechaMX(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function pct(v: number | null | undefined) {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function BadgeDestino({ destino }: { destino: string }) {
  return destino === "franquicia"
    ? <Badge tone="human">Franquicia</Badge>
    : <Badge tone="brand">Tienda propia</Badge>;
}

/* ---------- piezas de tabla (móvil: dentro de .scroll-x) ---------- */
function Tabla({ cabeceras, children, vacio, filas }: { cabeceras: string[]; children: React.ReactNode; vacio: string; filas: number }) {
  if (!filas) return <p className="px-5 py-6 text-sm text-ink-3">{vacio}</p>;
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border-faint text-left text-[11px] uppercase tracking-wide text-ink-3">
            {cabeceras.map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-faint">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle ${className}`}>{children}</td>;
}

function Barra({ valor }: { valor: number | null }) {
  const w = Math.max(0, Math.min(100, valor ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${w}%` }} /></div>
      <span className="tabular text-xs text-ink-2">{pct(valor)}</span>
    </div>
  );
}

function Titulo({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="border-b border-border-faint p-5">
      <h3 className="font-display text-lg font-bold">{children}</h3>
      {sub && <p className="text-sm text-ink-3">{sub}</p>}
    </div>
  );
}

function Select({ label, value, onChange, opciones }: { label: string; value: string; onChange: (v: string) => void; opciones: { valor: string; texto: string }[] }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-3">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-xl border border-border-soft bg-surface px-2.5 text-sm font-normal text-ink outline-none focus:border-brand/50">
        <option value="">Todos</option>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  );
}

/* ================================================================ */

function Contenido() {
  const router = useRouter();
  const sp = useSearchParams();
  const { cargando: cargandoSesion } = useSesion();
  const permitido = usePuedeVerTableroReclutamiento();

  // Filtros = URL (liga compartible)
  const f = useMemo<Filtros>(() => {
    const o = {} as Filtros;
    for (const k of CLAVES) o[k] = sp.get(k) ?? "";
    return o;
  }, [sp]);
  const setFiltro = useCallback((cambios: Partial<Filtros>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) v ? p.set(k, v) : p.delete(k);
    const q = p.toString();
    router.replace(`/dashboard/reclutamiento${q ? `?${q}` : ""}`, { scroll: false });
  }, [router, sp]);
  const hayFiltros = CLAVES.some((k) => f[k]);

  const [t, setT] = useState<TableroReclutamiento | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vacantes, setVacantes] = useState<Vacante[]>([]);

  const cargar = useCallback(async () => {
    if (!permitido) return;
    const r = await fetchTableroReclutamiento({
      destino: f.destino, reclutadorId: f.reclutador ? Number(f.reclutador) : null, zona: f.zona, sucursal: f.sucursal,
      clienteId: f.cliente ? Number(f.cliente) : null, vacante: f.vacante, fuente: f.fuente,
    });
    if (r) { setT(r); setError(false); } else setError(true);
    setCargando(false);
  }, [permitido, f]);

  useEffect(() => { void cargar(); }, [cargar]);
  usePolling(cargar);

  useEffect(() => {
    if (!permitido) return;
    fetchClientes("Activo").then((c) => setClientes(c ?? []));
    fetchVacantes().then((v) => setVacantes(v ?? []));
  }, [permitido]);

  if (cargandoSesion) return <div className="mx-auto max-w-7xl px-4 py-8"><div className="h-32 animate-pulse rounded-2xl border border-border-soft bg-surface-2/60" /></div>;
  if (!permitido) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader title="Tablero de control de Reclutamiento" />
        <Card className="mt-6 p-6 text-sm text-ink-2">Este tablero es para Coordinación de Reclutamiento.</Card>
      </div>
    );
  }

  const vacantesFiltro = vacantes.filter((v) => !f.destino || (v.destino ?? "tienda_propia") === f.destino);
  const idPorTitulo = (titulo: string) => t?.vacantes.lista.find((v) => v.titulo === titulo)?.id ?? "";
  const verTiendas = f.destino !== "franquicia";
  const verFranquicias = f.destino !== "tienda_propia";
  const tiposPendientes = t ? Object.entries(t.pendientes.evaluacionesPorTipo).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Tablero de control de Reclutamiento" subtitle="Vacantes, candidatos, seguimiento y efectividad por destino, reclutador y fuente">
        {/* Selector segmentado por destino */}
        <div className="inline-flex rounded-xl border border-border-soft bg-surface-2 p-1">
          {DESTINOS.map((d) => (
            <button key={d.valor} type="button" onClick={() => setFiltro({ destino: d.valor, vacante: "" })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${f.destino === d.valor ? "bg-surface text-brand shadow-sm" : "text-ink-2 hover:text-ink"}`}>
              {d.texto}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Filtros (viven en la URL) */}
      <Card className="mt-5 p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select label="Reclutador" value={f.reclutador} onChange={(v) => setFiltro({ reclutador: v })}
            opciones={(t?.opciones.reclutadores ?? []).map(([id, nombre]) => ({ valor: String(id), texto: nombre }))} />
          <Select label="Zona" value={f.zona} onChange={(v) => setFiltro({ zona: v })} opciones={(t?.opciones.zonas ?? []).map((z) => ({ valor: z, texto: z }))} />
          <Select label="Sucursal" value={f.sucursal} onChange={(v) => setFiltro({ sucursal: v })} opciones={(t?.opciones.sucursales ?? []).map((s) => ({ valor: s, texto: s }))} />
          <Select label="Franquicia" value={f.cliente} onChange={(v) => setFiltro({ cliente: v })} opciones={clientes.map((c) => ({ valor: String(c.id), texto: c.nombre }))} />
          <Select label="Vacante" value={f.vacante} onChange={(v) => setFiltro({ vacante: v })} opciones={vacantesFiltro.map((v) => ({ valor: v.id, texto: `${v.id} · ${v.titulo}` }))} />
          <Select label="Fuente" value={f.fuente} onChange={(v) => setFiltro({ fuente: v })} opciones={(t?.opciones.fuentes ?? []).map((x) => ({ valor: x.clave, texto: x.nombre }))} />
        </div>
        {hayFiltros && (
          <div className="mt-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => router.replace("/dashboard/reclutamiento", { scroll: false })}><X className="h-4 w-4" /> Limpiar</Button>
          </div>
        )}
      </Card>

      {error && !t && <Card className="mt-4 p-6 text-sm text-ink-2">No se pudo cargar el tablero. Revisa la conexión con la API e intenta de nuevo.</Card>}

      {/* KPIs */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cargando && !t
          ? [0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-border-soft bg-surface-2/60" />)
          : t && (
            <>
              <KpiCard label="Vacantes activas" value={String(t.vacantes.activas)} detalle={`${t.vacantes.total} en total`} />
              <KpiCard label="Cubiertas" value={String(t.vacantes.cubiertas)} detalle="Posiciones cubiertas" tone="good" />
              <KpiCard label="Pendientes (posiciones)" value={String(t.vacantes.pendientes)} detalle="Por cubrir" />
              <KpiCard label="Próximas a cubrir" value={String(t.vacantes.proximasACubrir)} detalle="Con candidato en pasos finales" tone="human" />
              <Card hover className={`p-5 ${t.vacantes.enRiesgo > 0 ? "border-bad/40" : ""}`}>
                <p className="text-sm text-ink-2">En riesgo</p>
                <div className={`mt-2 font-display text-3xl font-extrabold tracking-tight tabular ${t.vacantes.enRiesgo > 0 ? "text-bad" : ""}`}>{t.vacantes.enRiesgo}</div>
                <p className="mt-1 text-[12px] text-ink-3">umbral: {t.filtros.umbralRiesgoDias} días antes de la fecha objetivo</p>
              </Card>
              <KpiCard label="Postulados" value={String(t.candidatos.postulados)} />
              <KpiCard label="Contactados" value={String(t.candidatos.contactados)} />
              <KpiCard label="Entrevistados" value={String(t.candidatos.entrevistados)} tone="human" />
              <KpiCard label="Viables" value={String(t.candidatos.viables)} tone="good" />
              <KpiCard label="Descartados" value={String(t.candidatos.descartados)} />
              <KpiCard label="Evaluaciones pendientes" value={String(t.pendientes.evaluaciones)} />
              <KpiCard label="Documentos pendientes" value={String(t.pendientes.documentos)} />
              <KpiCard label="Candidatos detenidos" value={String(t.seguimiento.detenidos)} detalle={`Más de ${t.filtros.detenidoDias} días sin seguimiento`} />
            </>
          )}
      </div>

      {t && (
        <>
          {/* Vacantes */}
          <Card className="mt-4">
            <Titulo sub="Clic en una fila abre el Kanban filtrado por la vacante">Vacantes</Titulo>
            <Tabla filas={t.vacantes.lista.length} vacio="Sin vacantes con estos filtros."
              cabeceras={["Vacante", "Destino", "Sucursal / Cliente", "Zona", "Reclutador", "Pos. / Cub. / Pend.", "Antigüedad", "Fecha objetivo", "Viables", "Próximos", ""]}>
              {t.vacantes.lista.map((v) => (
                <tr key={v.id} onClick={() => router.push(`/dashboard/candidatos?vacante=${v.id}`)} className="cursor-pointer transition hover:bg-surface-2/50">
                  <Td><p className="font-semibold">{v.titulo}</p><p className="font-mono text-[11px] text-ink-3">{v.id} · {v.estado}</p></Td>
                  <Td><BadgeDestino destino={v.destino} /></Td>
                  <Td>{v.destino === "franquicia" ? v.cliente || "—" : v.sucursal || "—"}</Td>
                  <Td>{v.zona || "—"}</Td>
                  <Td>{v.reclutador || "—"}</Td>
                  <Td className="tabular">{v.posiciones} / {v.cubiertas} / {v.pendientes}</Td>
                  <Td className="tabular">{v.antiguedadDias == null ? "—" : `${v.antiguedadDias} d`}</Td>
                  <Td>
                    {fechaMX(v.fechaObjetivo)}
                    {v.diasParaObjetivo != null && (
                      <span className={`ml-1 text-[11px] ${v.diasParaObjetivo < 0 ? "text-bad" : "text-ink-3"}`}>
                        ({v.diasParaObjetivo < 0 ? `${Math.abs(v.diasParaObjetivo)} d vencida` : `${v.diasParaObjetivo} d`})
                      </span>
                    )}
                  </Td>
                  <Td className="tabular">{v.viables}</Td>
                  <Td className="tabular">{v.proximos}</Td>
                  <Td>{v.enRiesgo && <Badge tone="bad" dot>En riesgo</Badge>}</Td>
                </tr>
              ))}
            </Tabla>
          </Card>

          {/* Descartados por motivo · Evaluaciones pendientes por tipo */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <Titulo sub="Postulaciones descartadas agrupadas por motivo">Descartados por motivo</Titulo>
              {t.candidatos.descartadosPorMotivo.length ? (
                <ul className="divide-y divide-border-faint">
                  {t.candidatos.descartadosPorMotivo.map((m) => (
                    <li key={m.motivo} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"><span className="text-ink-2">{m.motivo || "Sin motivo"}</span><span className="tabular font-semibold">{m.total}</span></li>
                  ))}
                </ul>
              ) : <p className="px-5 py-6 text-sm text-ink-3">Sin descartes con estos filtros.</p>}
            </Card>
            <Card>
              <Titulo sub="Evaluaciones y verificaciones sin resultado">Evaluaciones pendientes por tipo</Titulo>
              {tiposPendientes.length ? (
                <ul className="divide-y divide-border-faint">
                  {tiposPendientes.map(([tipo, n]) => (
                    <li key={tipo} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"><span className="text-ink-2">{tipo}</span><span className="tabular font-semibold">{n}</span></li>
                  ))}
                </ul>
              ) : <p className="px-5 py-6 text-sm text-ink-3">Sin evaluaciones pendientes.</p>}
            </Card>
          </div>

          {/* Seguimiento */}
          <Card className="mt-4">
            <Titulo sub={`Último seguimiento por candidato · «Detenido» = más de ${t.filtros.detenidoDias} días sin actividad`}>Seguimiento</Titulo>
            <Tabla filas={t.seguimiento.candidatos.length} vacio="Sin candidatos en seguimiento."
              cabeceras={["Candidato", "Vacante", "Paso", "Reclutador", "Último seguimiento", "Días sin seguimiento", ""]}>
              {t.seguimiento.candidatos.map((c) => {
                const vid = idPorTitulo(c.vacante);
                return (
                  <tr key={c.id} onClick={() => router.push(vid ? `/dashboard/candidatos?vacante=${vid}` : "/dashboard/candidatos")} className="cursor-pointer transition hover:bg-surface-2/50">
                    <Td><p className="font-semibold">{c.nombre}</p><p className="font-mono text-[11px] text-ink-3">{c.id}</p></Td>
                    <Td>{c.vacante || "—"}</Td>
                    <Td>{c.paso}</Td>
                    <Td>{c.reclutador || "—"}</Td>
                    <Td>{fechaMX(c.ultimoSeguimiento)}</Td>
                    <Td className={`tabular ${c.detenido ? "text-bad" : ""}`}>{c.diasSinSeguimiento}</Td>
                    <Td>{c.detenido && <Badge tone="bad" dot>Detenido</Badge>}</Td>
                  </tr>
                );
              })}
            </Tabla>
          </Card>

          {/* Citas y entrevistas por reclutador */}
          <Card className="mt-4">
            <Titulo sub="Efectividad = contratados y aceptados en franquicia sobre postulados">Citas y entrevistas por reclutador</Titulo>
            <Tabla filas={t.reclutadores.length} vacio="Sin actividad por reclutador."
              cabeceras={["Reclutador", "Postulados", "Citas", "Entrevistas Red Human", "Entrevistas humanas", "Contratados", "Aceptados franquicia", "Efectividad"]}>
              {t.reclutadores.map((r) => (
                <tr key={r.reclutador}>
                  <Td className="font-semibold">{r.reclutador || "Sin asignar"}</Td>
                  <Td className="tabular">{r.postulados}</Td>
                  <Td className="tabular">{r.citas}</Td>
                  <Td className="tabular">{r.entrevistasIA}</Td>
                  <Td className="tabular">{r.entrevistasHumanas}</Td>
                  <Td className="tabular">{r.contratados}</Td>
                  <Td className="tabular">{r.aceptadosFranquicia}</Td>
                  <Td className="tabular">{pct(r.efectividad)}</Td>
                </tr>
              ))}
            </Tabla>
          </Card>

          {/* Efectividad por fuente */}
          <Card className="mt-4">
            <Titulo sub="Postulados, viables y contratados por origen del candidato">Efectividad por fuente</Titulo>
            <Tabla filas={t.fuentes.length} vacio="Sin postulaciones por fuente."
              cabeceras={["Fuente", "Postulados", "Viables", "Contratados", "Aceptados franquicia", "Efectividad"]}>
              {t.fuentes.map((x) => (
                <tr key={x.fuente}>
                  <Td className="font-semibold">{x.fuente || "Sin fuente"}</Td>
                  <Td className="tabular">{x.postulados}</Td>
                  <Td className="tabular">{x.viables}</Td>
                  <Td className="tabular">{x.contratados}</Td>
                  <Td className="tabular">{x.aceptadosFranquicia}</Td>
                  <Td><Barra valor={x.efectividad} /></Td>
                </tr>
              ))}
            </Tabla>
          </Card>

          {/* Tiendas propias y Franquicias: bloques separados, nunca se mezclan */}
          <div className={`mt-4 grid gap-4 ${verTiendas && verFranquicias ? "lg:grid-cols-2" : ""}`}>
            {verTiendas && (
              <Card>
                <Titulo sub="Altas realizadas y fechas de ingreso previstas en sucursales propias">
                  <span className="inline-flex items-center gap-2"><Store className="h-5 w-5 text-brand" /> Tiendas propias · Ingresos y próximos ingresos</span>
                </Titulo>
                <div className="grid grid-cols-2 gap-3 p-5">
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">Ingresos</p><p className="mt-0.5 font-display text-xl font-bold tabular">{t.tiendasPropias.ingresos}</p></div>
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">Próximos ingresos</p><p className="mt-0.5 font-display text-xl font-bold tabular">{t.tiendasPropias.proximosIngresos}</p></div>
                </div>
                <p className="px-5 pb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">Ingresos</p>
                <Tabla filas={t.tiendasPropias.listaIngresos.length} vacio="Sin ingresos registrados." cabeceras={["Candidato", "Puesto", "Sucursal", "Fecha", ""]}>
                  {t.tiendasPropias.listaIngresos.map((i) => (
                    <tr key={i.id}>
                      <Td className="font-semibold">{i.nombre}</Td><Td>{i.puesto || "—"}</Td><Td>{i.sucursal || "—"}</Td><Td>{fechaMX(i.fecha)}</Td>
                      <Td>{i.listoSap && <Badge tone="good" dot>Listo para SAP</Badge>}</Td>
                    </tr>
                  ))}
                </Tabla>
                <p className="px-5 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-ink-3">Próximos ingresos</p>
                <Tabla filas={t.tiendasPropias.listaProximos.length} vacio="Sin próximos ingresos." cabeceras={["Candidato", "Puesto", "Sucursal", "Fecha", "Paso"]}>
                  {t.tiendasPropias.listaProximos.map((i) => (
                    <tr key={i.id}><Td className="font-semibold">{i.nombre}</Td><Td>{i.puesto || "—"}</Td><Td>{i.sucursal || "—"}</Td><Td>{fechaMX(i.fecha)}</Td><Td>{i.paso}</Td></tr>
                  ))}
                </Tabla>
              </Card>
            )}
            {verFranquicias && (
              <Card>
                <Titulo sub="Candidatos presentados al franquiciatario y su decisión">
                  <span className="inline-flex items-center gap-2"><Building2 className="h-5 w-5 text-human" /> Franquicias · Presentados y aceptados</span>
                </Titulo>
                <div className="grid grid-cols-3 gap-3 p-5">
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">Presentados</p><p className="mt-0.5 font-display text-xl font-bold tabular">{t.franquicias.presentados}</p></div>
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">Aceptados</p><p className="mt-0.5 font-display text-xl font-bold tabular text-good">{t.franquicias.aceptados}</p></div>
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">No aceptados</p><p className="mt-0.5 font-display text-xl font-bold tabular">{t.franquicias.noAceptados}</p></div>
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">Contratación confirmada</p><p className="mt-0.5 font-display text-xl font-bold tabular">{t.franquicias.contratacionesConfirmadas ?? 0}</p></div>
                  <div className="rounded-xl border border-border-soft bg-surface-2/40 px-3 py-2.5"><p className="text-[11px] text-ink-3">Ingreso confirmado</p><p className="mt-0.5 font-display text-xl font-bold tabular">{t.franquicias.ingresosConfirmados ?? 0}</p></div>
                </div>
                <Tabla filas={t.franquicias.porFranquicia.length} vacio="Sin candidatos presentados a franquicias." cabeceras={["Franquicia", "Presentados", "Aceptados", "No aceptados"]}>
                  {t.franquicias.porFranquicia.map((x) => (
                    <tr key={x.franquicia}>
                      <Td className="font-semibold">{x.franquicia || "Sin franquicia"}</Td><Td className="tabular">{x.presentados}</Td>
                      <Td className="tabular text-good">{x.aceptados}</Td><Td className="tabular">{x.noAceptados}</Td>
                    </tr>
                  ))}
                </Tabla>
              </Card>
            )}
          </div>

          {/* Indicadores futuros (SAP): sin cifras */}
          <Card className="mt-4 p-5">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><AlertTriangle className="h-5 w-5 text-warn" /> Bajas y permanencia</h3>
            <p className="mt-2 text-sm text-ink-2">{t.futuros.nota}</p>
          </Card>
        </>
      )}
    </div>
  );
}

export default function TableroReclutamientoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-ink-3">Cargando tablero…</div>}>
      <Contenido />
    </Suspense>
  );
}
