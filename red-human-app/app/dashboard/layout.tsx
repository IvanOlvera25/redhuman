import { DashboardShell } from "@/components/dashboard/shell";
import { ProveedorSesion } from "@/components/sesion";
import { ProveedorAgente } from "@/components/dashboard/agente/proveedor";
import { CambioObligatorio } from "@/components/cambiar-password";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProveedorSesion>
      <ProveedorAgente>
        <DashboardShell>{children}</DashboardShell>
      </ProveedorAgente>
      {/* bloquea el panel hasta que la persona elija una contraseña propia */}
      <CambioObligatorio />
    </ProveedorSesion>
  );
}
