import { DashboardShell } from "@/components/dashboard/shell";
import { ProveedorSesion } from "@/components/sesion";
import { CambioObligatorio } from "@/components/cambiar-password";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProveedorSesion>
      <DashboardShell>{children}</DashboardShell>
      {/* bloquea el panel hasta que la persona elija una contraseña propia */}
      <CambioObligatorio />
    </ProveedorSesion>
  );
}
