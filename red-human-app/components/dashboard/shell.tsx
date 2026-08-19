"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BookOpen,
  Briefcase,
  ClipboardCheck,
  GraduationCap,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Sparkles,
  Target,
  Users,
  Video,
  X,
} from "lucide-react";
import { Logo, Avatar, Button } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { useSesion } from "@/components/sesion";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const navOperacion: NavItem[] = [
  { href: "/dashboard", label: "Tablero de control", icon: LayoutDashboard },
  { href: "/dashboard/vacantes", label: "Vacantes", icon: Briefcase, badge: "24" },
  { href: "/dashboard/candidatos", label: "Candidatos", icon: Users, badge: "1.8k" },
  { href: "/dashboard/entrevistas", label: "Entrevistas", icon: Video, badge: "12" },
];

const navColaborador: NavItem[] = [
  { href: "/dashboard/onboarding", label: "Onboarding", icon: ClipboardCheck, badge: "3" },
  { href: "/dashboard/capacitacion", label: "Capacitación", icon: GraduationCap },
  { href: "/dashboard/desempeno", label: "Desempeño", icon: Target },
  { href: "/dashboard/clima", label: "Clima", icon: HeartPulse },
  { href: "/dashboard/conocimiento", label: "Base de conocimiento", icon: BookOpen },
];

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === "/dashboard" ? path === item.href : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand" />}
            <item.icon className={cn("h-[18px] w-[18px]", active ? "text-brand" : "text-ink-3 group-hover:text-ink-2")} />
            <span className="flex-1">{item.label}</span>
            {item.badge && (
              <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold", active ? "bg-brand/15 text-brand" : "bg-surface-2 text-ink-3")}>
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 pt-1">
        <Link href="/" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>

      <Button href="/dashboard/vacantes" size="sm" className="w-full">
        <Plus className="h-4 w-4" /> Nueva vacante
      </Button>

      <div className="flex-1 space-y-5 overflow-y-auto">
        <div>
          <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Reclutamiento</p>
          <NavList items={navOperacion} onNavigate={onNavigate} />
        </div>
        <div>
          <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Colaborador</p>
          <NavList items={navColaborador} onNavigate={onNavigate} />
        </div>
      </div>

      {/* Agente card */}
      <div className="relative overflow-hidden rounded-2xl border border-border-soft bg-gradient-to-br from-brand-soft to-transparent p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">Agente activo</span>
          <span className="ml-auto h-2 w-2 rounded-full bg-good pulse-ring" />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-2">
          Prefiltrando 3 candidatos en este momento por WhatsApp.
        </p>
      </div>

      <TarjetaUsuario />
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-svh bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border-soft bg-surface lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-border-soft bg-surface">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* Topbar */}
      <header className="glass fixed inset-x-0 top-0 z-30 border-b border-border-soft lg:left-64">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => setOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-xl text-ink-2 hover:bg-surface-2 lg:hidden"
            aria-label="Menú"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              placeholder="Buscar candidatos, vacantes, folios…"
              className="h-10 w-full rounded-xl border border-border-soft bg-surface-2 pl-10 pr-4 text-sm outline-none transition focus:border-brand focus:bg-surface"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="Notificaciones">
              <Bell className="h-5 w-5" />
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-human" />
            </button>
            <UsuarioBarra />
          </div>
        </div>
      </header>

      <main className="pt-16 lg:pl-64">{children}</main>
    </div>
  );
}


/* ---------------- Sesión ---------------- */
const ETIQUETA_ROL: Record<string, string> = {
  admin: "Administrador",
  rh: "Recursos Humanos",
  lectura: "Solo lectura",
};

function TarjetaUsuario() {
  const { usuario, cargando, salir } = useSesion();
  if (cargando) return <div className="h-[68px] animate-pulse rounded-2xl bg-surface-2" />;
  if (!usuario) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border-soft bg-surface-2 p-3">
      <Avatar name={usuario.nombre} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{usuario.nombre}</p>
        <p className="truncate text-xs text-ink-3">{ETIQUETA_ROL[usuario.rol] ?? usuario.rol}</p>
      </div>
      <button
        onClick={salir}
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-surface hover:text-brand"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function UsuarioBarra() {
  const { usuario, salir } = useSesion();
  if (!usuario) return null;
  return (
    <div className="hidden items-center gap-2.5 rounded-xl border border-border-soft bg-surface py-1.5 pl-1.5 pr-2 sm:flex">
      <Avatar name={usuario.nombre} />
      <div className="leading-tight">
        <p className="text-[13px] font-semibold">{usuario.nombre}</p>
        <p className="font-mono text-[10px] text-ink-3">{ETIQUETA_ROL[usuario.rol] ?? usuario.rol}</p>
      </div>
      <button
        onClick={salir}
        className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-brand"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
