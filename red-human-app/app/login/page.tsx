"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Mail, Lock, Eye, EyeOff, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { Logo, Button } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { login } from "@/lib/api";

export default function Login() {
  return (
    <Suspense fallback={null}>
      <PantallaLogin />
    </Suspense>
  );
}

function PantallaLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("expirada") ? "Tu sesión expiró. Vuelve a entrar." : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const r = await login(correo, password);
    if (!r.ok) {
      setLoading(false);
      setError(r.error);
      return;
    }
    // replace, no push: el login no debe quedar en el historial
    router.replace(params.get("next") || "/dashboard");
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-[#151517] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_30%_20%,rgba(238,68,68,0.12),transparent_70%)]" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />

        <div className="relative">
          <Logo onDark />
        </div>

        <div className="relative">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-display max-w-md text-balance text-4xl font-bold leading-tight"
          >
            La plataforma de RH que <span className="brand-gradient-text">piensa contigo.</span>
          </motion.h1>
          <p className="mt-4 max-w-sm text-white/60">
            Recluta, entrevista, capacita y atiende a tu gente con un agente de IA — siempre con decisión humana.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            {["Multiempresa con permisos por rol", "Español mexicano en voz y texto", "Auditoría y consentimiento integrados"].map((t) => (
              <div key={t} className="flex items-center gap-2.5 text-sm text-white/70">
                <CheckCircle2 className="h-4 w-4 text-[#f26663]" /> {t}
              </div>
            ))}
          </div>
        </div>

        <div className="relative font-mono text-xs text-white/40">Red Human AI · México 2026</div>
      </div>

      {/* Form */}
      <div className="relative flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="absolute right-5 top-5 flex items-center gap-2">
          <Button href="/" variant="ghost" size="sm">
            ← Ir a landing
          </Button>
          <ThemeToggle />
        </div>
        <div className="lg:hidden">
          <Logo />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto mt-10 w-full max-w-sm lg:mt-0"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight">Bienvenido de vuelta</h2>
          <p className="mt-2 text-ink-2">Entra a tu panel de Red Human AI.</p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Correo</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  className="h-12 w-full rounded-xl border border-border-soft bg-surface pl-10 pr-4 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  placeholder="tu@empresa.mx"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Contraseña</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input
                  type={show ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-xl border border-border-soft bg-surface pl-10 pr-11 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 transition hover:text-ink"
                  aria-label="Mostrar contraseña"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="mt-2 w-full" disabled={loading}>
              {loading ? "Entrando…" : (<>Entrar <ArrowRight className="h-4 w-4" /></>)}
            </Button>
          </form>

          <div className="mt-6 flex items-start gap-2 rounded-xl border border-border-soft bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span>
              Cada decisión que tomes queda firmada con tu nombre en la bitácora de auditoría (LFPDPPP).
              Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.
            </span>
          </div>

          <p className="mt-6 text-center text-sm text-ink-2">
            ¿Eres candidato?{" "}
            <Link href="/aplicar/cajero-a-de-sucursal" className="font-medium text-brand hover:underline">
              Aplica a una vacante
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
