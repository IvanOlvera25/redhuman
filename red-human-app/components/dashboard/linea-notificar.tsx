"use client";

/* Punto 12 — "Notificar: Candidato ✓ · Entrevistador ✓ · Cliente ☐ · Editar".

   Una línea precargada con la configuración predeterminada de la Cuenta (Configuración →
   Notificaciones) que acompaña a cada acción manual que dispara una notificación. Solo al
   pulsar "Editar" se expanden los checkboxes de Correo/WhatsApp por destinatario; lo que RH
   cambie aquí aplica ÚNICAMENTE a esa acción (viaja como `notificar` al backend) y nunca
   altera la configuración general. Los recordatorios automáticos no la muestran. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import {
  fetchCliente,
  fetchReglasNotificacion,
  type ContactoCliente,
  type EventoNotificacion,
  type NotificarAccion,
  type ReglaNotificacion,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/* --- caché en memoria de las reglas (una carga por sesión de página; se invalida al guardar) --- */
let cacheReglas: ReglaNotificacion[] | null = null;
let cargaEnCurso: Promise<ReglaNotificacion[] | null> | null = null;

export function invalidarReglasNotificacion() {
  cacheReglas = null;
  cargaEnCurso = null;
}

export function useReglasNotificacion() {
  const [reglas, setReglas] = useState<ReglaNotificacion[] | null>(cacheReglas);
  useEffect(() => {
    if (cacheReglas) {
      setReglas(cacheReglas);
      return;
    }
    if (!cargaEnCurso) {
      cargaEnCurso = fetchReglasNotificacion().then((r) => {
        cacheReglas = r;
        return r;
      });
    }
    let vivo = true;
    cargaEnCurso.then((r) => vivo && setReglas(r));
    return () => {
      vivo = false;
    };
  }, []);
  return reglas;
}

export function reglaComoAccion(r?: ReglaNotificacion | null): NotificarAccion {
  return {
    candidatoCorreo: r?.candidatoCorreo ?? false,
    candidatoWhatsapp: r?.candidatoWhatsapp ?? false,
    entrevistadorCorreo: r?.entrevistadorCorreo ?? false,
    entrevistadorWhatsapp: r?.entrevistadorWhatsapp ?? false,
    clienteCorreo: r?.clienteCorreo ?? false,
    clienteWhatsapp: r?.clienteWhatsapp ?? false,
  };
}

type Destinatario = { clave: "candidato" | "entrevistador" | "cliente"; etiqueta: string; correo: keyof NotificarAccion; whatsapp: keyof NotificarAccion };

const DESTINATARIOS: Destinatario[] = [
  { clave: "candidato", etiqueta: "Candidato", correo: "candidatoCorreo", whatsapp: "candidatoWhatsapp" },
  { clave: "entrevistador", etiqueta: "Entrevistador", correo: "entrevistadorCorreo", whatsapp: "entrevistadorWhatsapp" },
  { clave: "cliente", etiqueta: "Cliente", correo: "clienteCorreo", whatsapp: "clienteWhatsapp" },
];

/** Hook de conveniencia: estado local `value` precargado desde la regla del evento en cuanto
 * las reglas llegan (una sola vez), listo para pasar a `LineaNotificar` y al API. */
export function useNotificarAccion(evento: EventoNotificacion) {
  const reglas = useReglasNotificacion();
  const [value, setValue] = useState<NotificarAccion | null>(null);
  useEffect(() => {
    if (value !== null || !reglas) return;
    setValue(reglaComoAccion(reglas.find((r) => r.evento === evento)));
  }, [reglas, evento, value]);
  const reset = useCallback(() => setValue(reglas ? reglaComoAccion(reglas.find((r) => r.evento === evento)) : null), [reglas, evento]);
  return { value: value ?? reglaComoAccion(null), setValue, listo: value !== null, reset };
}

export function LineaNotificar({
  value,
  onChange,
  hayEntrevistador = true,
  hayCliente = false,
  clienteId,
  className,
}: {
  value: NotificarAccion;
  onChange: (v: NotificarAccion) => void;
  /** false = la acción no tiene entrevistador que notificar (p. ej. documentos): se oculta. */
  hayEntrevistador?: boolean;
  /** false = la vacante no tiene Cliente: se oculta (Fase D, punto 26). */
  hayCliente?: boolean;
  /** Fase 7A: id del Cliente de la vacante — con «Cliente» activo se listan sus contactos ya
   * registrados para elegir a quién notificar (todos marcados por defecto; nunca se capturan datos). */
  clienteId?: number | null;
  className?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [contactos, setContactos] = useState<ContactoCliente[] | null>(null);
  const visibles = useMemo(
    () => DESTINATARIOS.filter((d) => (d.clave === "entrevistador" ? hayEntrevistador : d.clave === "cliente" ? hayCliente : true)),
    [hayEntrevistador, hayCliente],
  );
  const activo = (d: Destinatario) => Boolean(value[d.correo] || value[d.whatsapp]);
  const clienteActivo = hayCliente && Boolean(value.clienteCorreo || value.clienteWhatsapp);

  useEffect(() => {
    if (!hayCliente || !clienteId) return;
    let vivo = true;
    fetchCliente(clienteId).then((c) => vivo && setContactos(c?.listaContactos ?? []));
    return () => {
      vivo = false;
    };
  }, [hayCliente, clienteId]);

  // ids elegidos: undefined = todos (default Fase D). Se materializa solo cuando RH desmarca alguno.
  const elegidos = value.clienteContactosIds ?? (contactos ?? []).map((k) => k.id);
  const alternarContacto = (id: number, marcado: boolean) => {
    const base = value.clienteContactosIds ?? (contactos ?? []).map((k) => k.id);
    onChange({ ...value, clienteContactosIds: marcado ? Array.from(new Set([...base, id])) : base.filter((x) => x !== id) });
  };
  const resumenCliente = clienteActivo && contactos ? ` (${elegidos.length}/${contactos.length} contactos)` : "";

  return (
    <div className={cn("rounded-xl border border-border-soft bg-surface-2/60 px-3.5 py-2.5 text-[13px]", className)}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-semibold text-ink-2">Notificar:</span>
        {visibles.map((d, i) => (
          <span key={d.clave} className="flex items-center gap-1.5">
            <span className={cn(activo(d) ? "text-ink" : "text-ink-3")}>
              {d.etiqueta} {activo(d) ? "✓" : "☐"}
              {d.clave === "cliente" ? resumenCliente : ""}
            </span>
            {i < visibles.length - 1 && <span className="text-ink-3">·</span>}
          </span>
        ))}
        <span className="text-ink-3">·</span>
        <button
          type="button"
          onClick={() => setEditando((e) => !e)}
          className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
        >
          <Pencil className="h-3 w-3" /> {editando ? "Listo" : "Editar"}
        </button>
      </div>
      {editando && (
        <div className="mt-2.5 grid gap-2 border-t border-border-soft pt-2.5 sm:grid-cols-3">
          {visibles.map((d) => (
            <div key={d.clave} className="rounded-lg bg-surface px-2.5 py-2">
              <p className="text-xs font-semibold text-ink-2">{d.etiqueta}</p>
              <label className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={Boolean(value[d.correo])}
                  onChange={(e) => onChange({ ...value, [d.correo]: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border-soft text-brand focus:ring-brand"
                />
                Correo
              </label>
              <label className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={Boolean(value[d.whatsapp])}
                  onChange={(e) => onChange({ ...value, [d.whatsapp]: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border-soft text-brand focus:ring-brand"
                />
                WhatsApp
              </label>
            </div>
          ))}
          {clienteActivo && contactos && (
            <div className="rounded-lg bg-surface px-2.5 py-2 sm:col-span-3">
              <p className="text-xs font-semibold text-ink-2">Contactos del Cliente a notificar</p>
              {contactos.length === 0 ? (
                <p className="mt-1 text-[11px] text-ink-3">Este Cliente no tiene contactos registrados (Configuración → Clientes y contactos).</p>
              ) : (
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {contactos.map((k) => (
                    <label key={k.id} className="flex items-center gap-2 text-xs text-ink-2">
                      <input
                        type="checkbox"
                        checked={elegidos.includes(k.id)}
                        onChange={(e) => alternarContacto(k.id, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border-soft text-brand focus:ring-brand"
                      />
                      <span className="truncate">
                        {k.nombre} {k.apellidos ?? ""}
                        <span className="text-ink-3"> · {[k.correo, k.telefono].filter(Boolean).join(" · ") || "sin datos de contacto"}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-ink-3 sm:col-span-3">
            Solo para esta acción. La configuración general se cambia en Configuración → Notificaciones.
          </p>
        </div>
      )}
    </div>
  );
}
