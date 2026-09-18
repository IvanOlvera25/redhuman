"use client";

/* Switch de Modo Prueba para Contratación/Onboarding (2026-09-18). Lee y cambia
   ConfiguracionSistema.modo_prueba (global de la instalación) y refresca la sesión para que el resto
   de la app lo vea. Solo Administradores lo cambian; los demás lo ven como indicador.
   Con Modo Prueba ACTIVO se permite dar de alta aunque el expediente no esté al 100%; INACTIVO exige
   expediente validado al 100% (el backend lo refuerza: contratacion.alta + puede_forzar_prueba). */

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { actualizarConfiguracion } from "@/lib/api";
import { useModoPrueba, useSesion } from "@/components/sesion";
import { cn } from "@/lib/utils";

export function SwitchModoPrueba({ className }: { className?: string }) {
  const modoPrueba = useModoPrueba();
  const { usuario, refrescar } = useSesion();
  const [ocupado, setOcupado] = useState(false);
  const puedeCambiar = usuario?.rol === "Administrador";

  async function alternar() {
    if (!puedeCambiar || ocupado) return;
    setOcupado(true);
    const r = await actualizarConfiguracion({ modoPrueba: !modoPrueba });
    if (r.ok) await refrescar();
    setOcupado(false);
  }

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[12px] font-semibold transition",
        modoPrueba ? "border-warn/40 bg-warn-soft text-warn" : "border-border-soft bg-surface text-ink-3",
        puedeCambiar ? "cursor-pointer" : "cursor-default",
        className,
      )}
      title={
        modoPrueba
          ? "Modo Prueba ACTIVO: se puede dar de alta aunque el expediente no esté al 100%."
          : "Modo Prueba inactivo: el alta exige expediente validado al 100%."
      }
    >
      <FlaskConical className="h-3.5 w-3.5" />
      Modo Prueba
      <button
        type="button"
        role="switch"
        aria-checked={modoPrueba}
        disabled={!puedeCambiar || ocupado}
        onClick={alternar}
        className={cn(
          "relative h-5 w-9 rounded-full transition disabled:cursor-not-allowed",
          modoPrueba ? "bg-warn" : "bg-border-soft",
        )}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", modoPrueba ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}
