"use client";

import { useState } from "react";
import { KeyRound, AlertTriangle, Check } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { cambiarPassword } from "@/lib/api";
import { useSesion } from "@/components/sesion";

/* ============================================================
   Cambio de contraseña obligatorio.

   Se muestra cuando la contraseña la puso un administrador: mientras nadie más
   que la persona conozca su clave, la firma de la bitácora significa algo.
   No se puede cerrar sin cambiarla.
   ============================================================ */

export function CambioObligatorio() {
  const { usuario, refrescar, salir } = useSesion();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!usuario?.debeCambiarPass) return null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (nueva !== repetir) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    setGuardando(true);
    setError("");
    const r = await cambiarPassword(actual, nueva);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await refrescar();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md p-6">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
          <KeyRound className="h-5 w-5" />
        </span>
        <h2 className="font-display mt-4 text-xl font-bold">Cambia tu contraseña</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Tu contraseña actual la definió un administrador. Elige una que solo tú conozcas: cada decisión que
          tomes queda firmada con tu nombre en la bitácora.
        </p>

        <form onSubmit={guardar} className="mt-5 flex flex-col gap-3">
          <Campo label="Contraseña actual" value={actual} onChange={setActual} autoComplete="current-password" />
          <Campo label="Nueva contraseña" value={nueva} onChange={setNueva} autoComplete="new-password" />
          <Campo label="Repite la nueva" value={repetir} onChange={setRepetir} autoComplete="new-password" />

          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <Check className="h-3.5 w-3.5" /> Mínimo 10 caracteres, combinando letras y números.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-2 flex gap-3">
            <Button type="button" variant="outline" onClick={salir} disabled={guardando}>
              Salir
            </Button>
            <Button type="submit" className="flex-1" disabled={guardando || !actual || !nueva}>
              {guardando ? "Guardando…" : "Guardar y continuar"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        type="password"
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
