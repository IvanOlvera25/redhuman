"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FlaskConical, Loader2, Trash2 } from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import { useEsAdmin } from "@/components/sesion";
import {
  actualizarConfiguracion,
  eliminarCandidatosPrueba,
  fetchConfiguracion,
  type ConfiguracionSistema,
  type ResumenBorradoPrueba,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function Configuracion() {
  const esAdmin = useEsAdmin();
  const [cfg, setCfg] = useState<ConfiguracionSistema | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [resumen, setResumen] = useState<ResumenBorradoPrueba | null>(null);

  useEffect(() => {
    if (!esAdmin) {
      setCargando(false);
      return;
    }
    fetchConfiguracion().then((d) => {
      setCfg(d);
      setCargando(false);
    });
  }, [esAdmin]);

  async function alternarModoPrueba() {
    if (!cfg) return;
    setGuardando(true);
    setError("");
    const r = await actualizarConfiguracion(!cfg.modoPrueba);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCfg(r.data);
  }

  async function confirmarBorrado() {
    setBorrando(true);
    setError("");
    const r = await eliminarCandidatosPrueba();
    setBorrando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResumen(r.data);
    setConfirmando(false);
    setCfg((prev) => (prev ? { ...prev, candidatosPrueba: 0 } : prev));
  }

  if (!esAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader title="Configuración" subtitle="Solo un administrador puede ver esta sección." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Configuración" subtitle="Ajustes globales del sistema, solo para administradores." />

      {error && (
        <div className="mt-4">
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}

      <Card className="mt-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FlaskConical className="h-[18px] w-[18px] text-brand" />
              <h3 className="font-display text-base font-bold">Modo Prueba</h3>
              {cfg?.modoPrueba && (
                <Badge tone="brand" dot>
                  Activo
                </Badge>
              )}
            </div>
            <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-2">
              Con Modo Prueba activo, si una conversación de WhatsApp de prueba ya lleva más de 60
              minutos sin actividad, el siguiente mensaje del mismo teléfono crea una postulación
              nueva e independiente en vez de reutilizar la anterior. Los candidatos creados así se
              marcan como prueba y nunca aparecen en los listados ni reportes de RH.
            </p>
          </div>
          {cargando ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-ink-3" />
          ) : (
            <button
              type="button"
              onClick={alternarModoPrueba}
              disabled={guardando}
              aria-pressed={cfg?.modoPrueba}
              aria-label="Alternar Modo Prueba"
              className={cn(
                "h-7 w-12 shrink-0 rounded-full border transition",
                cfg?.modoPrueba ? "border-brand bg-brand" : "border-border-soft bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "block h-5 w-5 rounded-full bg-white shadow transition-transform",
                  cfg?.modoPrueba ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          )}
        </div>
      </Card>

      <Card className="mt-4 border-bad/25 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
          <div className="flex-1">
            <h3 className="font-display text-base font-bold">Eliminar postulaciones de prueba</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              Borra permanentemente TODOS los candidatos marcados como prueba
              {cfg && ` (${cfg.candidatosPrueba} en este momento)`}, junto con sus mensajes,
              entrevistas, expedientes y documentos. Esta acción no se puede deshacer.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 border-bad/30 text-bad"
              onClick={() => setConfirmando(true)}
              disabled={!cfg || cfg.candidatosPrueba === 0}
            >
              <Trash2 className="h-4 w-4" /> Eliminar postulaciones de prueba
            </Button>
          </div>
        </div>
      </Card>

      {resumen && (
        <div className="mt-4">
          <Aviso tono="ok">
            Se borraron {resumen.candidatos} candidato(s), {resumen.mensajes} mensaje(s),{" "}
            {resumen.entrevistas} entrevista(s), {resumen.expedientes} expediente(s) y{" "}
            {resumen.documentos} documento(s).
          </Aviso>
        </div>
      )}

      {confirmando && (
        <ModalConfirmarBorrado
          cantidad={cfg?.candidatosPrueba ?? 0}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={confirmarBorrado}
          cargando={borrando}
        />
      )}
    </div>
  );
}

function ModalConfirmarBorrado({
  cantidad,
  onCancelar,
  onConfirmar,
  cargando,
}: {
  cantidad: number;
  onCancelar: () => void;
  onConfirmar: () => void;
  cargando: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-5">
        <h3 className="font-display text-lg font-bold">¿Eliminar {cantidad} postulación(es) de prueba?</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Esta acción es permanente: se borran los candidatos y todo lo que cuelga de ellos
          (mensajes, entrevistas, expedientes, documentos). No se puede deshacer.
        </p>
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={cargando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={onConfirmar} disabled={cargando}>
            {cargando ? "Borrando…" : "Sí, eliminar todo"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
