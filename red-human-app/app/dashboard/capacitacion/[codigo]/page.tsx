"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { Card, Badge, Button, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import {
  fetchCurso,
  fetchColaboradores,
  publicarCurso,
  asignarCurso,
  fetchAsignacionesCurso,
  type Curso,
  type AsignacionCurso,
  type Colaborador,
} from "@/lib/api";

function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export default function DetalleCurso() {
  const params = useParams();
  const codigo = String(params?.codigo ?? "");

  const [curso, setCurso] = useState<Curso | null>(null);
  const [asignaciones, setAsignaciones] = useState<AsignacionCurso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [publicando, setPublicando] = useState(false);
  const [asignarAbierto, setAsignarAbierto] = useState(false);
  const [error, setError] = useState("");

  async function cargar() {
    const [c, asigs] = await Promise.all([fetchCurso(codigo), fetchAsignacionesCurso(codigo)]);
    if (c) setCurso(c);
    if (asigs) setAsignaciones(asigs);
    setCargando(false);
  }

  useEffect(() => {
    if (codigo) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  async function publicar() {
    setPublicando(true);
    setError("");
    const r = await publicarCurso(codigo);
    setPublicando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCurso(r.data);
  }

  if (cargando) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-ink-3">
        Cargando curso…
      </div>
    );
  }

  if (!curso) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Aviso tono="error">No se encontró el curso «{codigo}».</Aviso>
        <Link href="/dashboard/capacitacion" className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand">
          <ArrowLeft className="h-4 w-4" /> Volver a Capacitación
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/dashboard/capacitacion" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Capacitación
      </Link>

      <PageHeader title={curso.titulo} subtitle={curso.categoria || "Sin categoría"}>
        {curso.obligatorio && <Badge tone="human">Obligatorio</Badge>}
        <Badge tone={curso.estado === "Publicado" ? "good" : "neutral"} dot>{curso.estado}</Badge>
        {curso.estado === "Borrador" && (
          <Button size="sm" onClick={publicar} disabled={publicando}>
            {publicando ? "Publicando…" : "Publicar"}
          </Button>
        )}
        {curso.estado === "Publicado" && (
          <Button size="sm" onClick={() => setAsignarAbierto(true)}>
            <Send className="h-4 w-4" /> Asignar
          </Button>
        )}
      </PageHeader>

      {error && (
        <div className="mt-4">
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-ink-3" /> {curso.duracionHoras} h</span>
        <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-ink-3" /> {curso.modulos} módulos</span>
        <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-ink-3" /> {curso.asignados} asignado(s) · {curso.completados} completado(s)</span>
      </div>

      <Card className="mt-5 p-4">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold">Objetivo del curso</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{curso.objetivo}</p>
      </Card>

      <div className="mt-5">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">Temario</p>
        <div className="space-y-3">
          {(curso.listaModulos ?? []).map((m) => (
            <Card key={m.orden} className="p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft font-mono text-xs font-bold text-brand">{m.orden}</span>
                <h3 className="font-display text-base font-bold">{m.titulo}</h3>
              </div>
              <p className="mt-2 pl-11 text-sm leading-relaxed text-ink-2">{m.contenido}</p>
              {m.preguntasVerificacion.length > 0 && (
                <div className="mt-3 space-y-1.5 pl-11">
                  {m.preguntasVerificacion.map((p, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-ink-3">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                      <span>{p.pregunta}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {asignaciones.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">Asignado a</p>
          <div className="space-y-2">
            {asignaciones.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-border-soft bg-surface p-3 text-sm">
                <span className="font-medium">{a.colaboradorNombre}</span>
                <span className="flex items-center gap-2 text-xs text-ink-3">
                  {a.estado === "completado" && <CheckCircle2 className="h-3.5 w-3.5 text-good" />}
                  {a.estado}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {asignarAbierto && (
        <ModalAsignar
          codigo={codigo}
          yaAsignados={new Set(asignaciones.map((a) => a.colaboradorId))}
          onClose={() => setAsignarAbierto(false)}
          onListo={() => {
            setAsignarAbierto(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function ModalAsignar({
  codigo,
  yaAsignados,
  onClose,
  onListo,
}: {
  codigo: string;
  yaAsignados: Set<string>;
  onClose: () => void;
  onListo: () => void;
}) {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchColaboradores(true).then((c) => {
      if (c) setColaboradores(c);
      setCargando(false);
    });
  }, []);

  const filtrados = colaboradores.filter(
    (c) => !busqueda.trim() || normalizarTexto(c.nombre).includes(normalizarTexto(busqueda)),
  );

  function alternar(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function asignar() {
    if (seleccion.size === 0) {
      setError("Selecciona al menos un colaborador.");
      return;
    }
    setEnviando(true);
    setError("");
    const r = await asignarCurso(codigo, Array.from(seleccion));
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onListo();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="flex max-h-[80vh] w-full max-w-md flex-col p-5">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow>Asignar curso</Eyebrow>
            <h3 className="font-display text-lg font-bold">Selecciona colaboradores</h3>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre…"
            className="h-11 w-full rounded-xl border border-border-soft bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
          {cargando && (
            <div className="flex items-center justify-center py-8 text-ink-3">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!cargando && filtrados.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-3">Sin colaboradores activos que coincidan.</p>
          )}
          {filtrados.map((c) => {
            const asignado = yaAsignados.has(c.id);
            return (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-soft bg-surface px-3 py-2.5 text-sm hover:border-brand/40"
              >
                <input
                  type="checkbox"
                  checked={seleccion.has(c.id)}
                  onChange={() => alternar(c.id)}
                  className="h-4 w-4 rounded border-border-soft"
                />
                <span className="flex-1">
                  <span className="font-medium">{c.nombre}</span>
                  <span className="block text-xs text-ink-3">{c.puesto}</span>
                </span>
                {asignado && <Badge tone="neutral">Ya asignado</Badge>}
              </label>
            );
          })}
        </div>

        {error && (
          <div className="mt-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        )}

        <div className="mt-4 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={asignar} disabled={enviando || seleccion.size === 0}>
            {enviando ? "Asignando…" : `Asignar (${seleccion.size})`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
