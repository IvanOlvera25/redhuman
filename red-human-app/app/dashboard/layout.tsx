import { DashboardShell } from "@/components/dashboard/shell";
import { ProveedorSesion } from "@/components/sesion";
import { PorCuenta } from "@/components/dashboard/por-cuenta";
import { ProveedorAgente } from "@/components/dashboard/agente/proveedor";
import { CambioObligatorio } from "@/components/cambiar-password";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProveedorSesion>
      <PorCuenta>
        <ProveedorAgente>
          <DashboardShell>{children}</DashboardShell>
        </ProveedorAgente>
      </PorCuenta>
      {/* bloquea el panel hasta que la persona elija una contraseña propia */}
      <CambioObligatorio />
    </ProveedorSesion>
  );
}
