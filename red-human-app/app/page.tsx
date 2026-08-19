"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  MessageCircle,
  Mic,
  Video,
  GraduationCap,
  BarChart3,
  HeartPulse,
  UserPlus,
  ShieldCheck,
  Sparkles,
  Play,
  CheckCircle2,
} from "lucide-react";
import { Logo, Button, Card, Badge, Eyebrow } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

const HeroCanvas = dynamic(() => import("@/components/landing/hero-canvas"), {
  ssr: false,
  loading: () => null,
});

const reveal = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      variants={reveal}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const areas = [
  { icon: UserPlus, t: "Reclutamiento y selección", d: "Publica vacantes, capta por 4 rutas, prefiltra y entrevista por voz o video con criterios consistentes.", tone: "brand" },
  { icon: ShieldCheck, t: "Contratación e integración", d: "Acompaña al candidato: solicita documentos, detecta pendientes y da seguimiento hasta el alta.", tone: "human" },
  { icon: MessageCircle, t: "Atención diaria", d: "Resuelve dudas de nómina, vacaciones y prestaciones por WhatsApp, llamada o videollamada.", tone: "brand" },
  { icon: GraduationCap, t: "Capacitación y onboarding", d: "Crea e imparte cursos completos, explica, ejercita y evalúa hasta comprobar la comprensión.", tone: "human" },
  { icon: BarChart3, t: "Desempeño y productividad", d: "Compara competencias y KPIs contra el perfil del puesto; detecta fortalezas y brechas.", tone: "brand" },
  { icon: HeartPulse, t: "Clima y experiencia", d: "Escucha señales tempranas de desmotivación o intención de salida para intervenir a tiempo.", tone: "human" },
];

const capacidades = [
  { icon: MessageCircle, t: "WhatsApp-first", d: "El canal donde ya está tu gente. Prefiltro, seguimiento y atención en el chat que en México usa el 93% de los adultos." },
  { icon: Mic, t: "Voz con IA en español mexicano", d: "Entrevistas y llamadas naturales con reconocimiento y síntesis de voz de baja latencia, en es-MX." },
  { icon: Video, t: "Avatares para videollamada", d: "Entrevistas por video con un agente realista, siempre con consentimiento y decisión humana final." },
  { icon: Bot, t: "Agente que razona", d: "Un orquestador que identifica a la persona, sus permisos, reconoce el proceso y ejecuta la conversación." },
];

const stack = ["FastAPI", "LangGraph", "Temporal", "PostgreSQL + pgvector", "Next.js", "LiveKit", "WhatsApp API", "Deepgram", "Cartesia", "Claude · GPT · Gemini"];

export default function Landing() {
  return (
    <main className="relative overflow-hidden">
      {/* ---------- NAV ---------- */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
          <div className="glass flex items-center gap-6 rounded-2xl border border-border-soft px-4 py-2.5">
            <Logo />
            <nav className="hidden items-center gap-6 text-sm text-ink-2 md:flex">
              <a href="#areas" className="transition hover:text-ink">Áreas</a>
              <a href="#capacidades" className="transition hover:text-ink">Capacidades</a>
              <a href="#flujo" className="transition hover:text-ink">Flujo</a>
            </nav>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <Button href="/login" variant="secondary" size="sm" className="hidden sm:inline-flex">
              Entrar
            </Button>
            <Button href="/dashboard" size="sm">
              Ver demo <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="relative min-h-[100svh] bg-[#151517] text-white">
        <div className="absolute inset-0">
          <HeroCanvas />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(238,68,68,0.08),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#151517]" />

        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-4xl flex-col items-center justify-center px-5 pt-24 text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12px] font-medium text-white/80 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-[#f26663]" />
              Agente integral de RH con Inteligencia Artificial
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="font-display mt-6 text-balance text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl md:text-7xl"
          >
            Todo el talento,
            <br />
            <span className="brand-gradient-text">una sola inteligencia.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.16 }}
            className="mt-6 max-w-2xl text-balance text-lg text-white/70 sm:text-xl"
          >
            Red Human AI acompaña todo el ciclo de vida del colaborador —de la vacante al desarrollo—
            con un agente que recluta, entrevista, capacita y atiende. Con humano en el circuito.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
            className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
          >
            <Button href="/dashboard" size="lg" className="group">
              Explorar la plataforma
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button href="/aplicar/cajero-de-sucursal" size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
              <Play className="h-4 w-4" /> Ver flujo del candidato
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="mt-14 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-white/50"
          >
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#f26663]" /> Multiempresa</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#f26663]" /> Español mexicano</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#f26663]" /> Cumple LFPDPPP</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#f26663]" /> Human-in-the-loop</span>
          </motion.div>
        </div>
      </section>

      {/* ---------- ÁREAS ---------- */}
      <section id="areas" className="relative mx-auto max-w-7xl px-5 py-24 sm:py-32">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Un agente, seis áreas</Eyebrow>
          <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Cubre todo el ciclo de vida del colaborador
          </h2>
          <p className="mt-4 text-lg text-ink-2">
            Del reclutamiento al clima laboral, con criterios consistentes y evidencia en cada decisión.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a, i) => (
            <Reveal key={a.t} delay={i * 0.06}>
              <Card hover className="group h-full p-6">
                <div className={`grid h-12 w-12 place-items-center rounded-2xl ${a.tone === "human" ? "bg-human-soft text-human" : "bg-brand-soft text-brand"}`}>
                  <a.icon className="h-6 w-6" />
                </div>
                <h3 className="font-display mt-5 text-xl font-bold">{a.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{a.d}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- STATS ---------- */}
      <section className="border-y border-border-soft bg-surface-2/50">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-5 md:grid-cols-4">
          {[
            { n: "48h → min", l: "Tiempo de respuesta al candidato" },
            { n: "65%", l: "Candidatos prefiltrados por IA" },
            { n: "22", l: "Módulos de arquitectura" },
            { n: "es-MX", l: "Voz y texto nativos" },
          ].map((s, i) => (
            <Reveal key={s.l} delay={i * 0.06} className="px-4 py-10 text-center">
              <div className="font-display text-3xl font-extrabold text-brand sm:text-4xl">{s.n}</div>
              <div className="mt-2 text-sm text-ink-2">{s.l}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- CAPACIDADES ---------- */}
      <section id="capacidades" className="mx-auto max-w-7xl px-5 py-24 sm:py-32">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>Capacidades de IA</Eyebrow>
            <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
              Conversa donde tu gente ya está
            </h2>
            <p className="mt-4 text-lg text-ink-2">
              Tres capas de inteligencia —texto, voz y video— sobre un canal omnicanal con WhatsApp como eje.
              Cada interacción queda registrada, con evidencia y trazabilidad.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              {["El candidato inicia por WhatsApp o un anuncio", "El agente prefiltra y agenda entrevista", "Entrevista por voz o video con evidencia", "RH decide con la recomendación de la IA"].map((s, i) => (
                <div key={s} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-brand-ink">{i + 1}</span>
                  <span className="text-[15px] text-ink-2">{s}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2">
            {capacidades.map((c, i) => (
              <Reveal key={c.t} delay={i * 0.08}>
                <Card hover className="h-full p-5">
                  <c.icon className="h-6 w-6 text-brand" />
                  <h3 className="font-display mt-4 text-base font-bold">{c.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{c.d}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FLUJO ---------- */}
      <section id="flujo" className="border-y border-border-soft bg-surface-2/40 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Eyebrow>Flujo de reclutamiento</Eyebrow>
            <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
              De la vacante a la contratación
            </h2>
          </Reveal>

          <div className="relative mt-16 grid gap-6 md:grid-cols-4">
            {[
              { n: "01", t: "Publicación", d: "RH crea la vacante o la IA la genera y la adapta por plataforma con liga única y QR." },
              { n: "02", t: "Captación", d: "Cuatro rutas: formulario, WhatsApp, integración por API y carga manual de RH." },
              { n: "03", t: "Prefiltro", d: "Entrevista breve, valida requisitos y clasifica: cumple, requiere revisión o no cumple." },
              { n: "04", t: "Entrevista", d: "Liga única, voz o video, profundiza y genera una evaluación con evidencia para RH." },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 0.08}>
                <Card className="relative h-full p-6">
                  <span className="font-mono text-sm font-bold text-brand">{s.n}</span>
                  <h3 className="font-display mt-3 text-lg font-bold">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.d}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- STACK MARQUEE ---------- */}
      <section className="overflow-hidden py-16">
        <Reveal className="mb-8 text-center">
          <Eyebrow>Construido con lo mejor de 2026</Eyebrow>
        </Reveal>
        <div className="relative flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
          <div className="flex shrink-0 animate-marquee items-center gap-4 pr-4">
            {[...stack, ...stack].map((s, i) => (
              <span key={i} className="whitespace-nowrap rounded-xl border border-border-soft bg-surface px-4 py-2 font-mono text-sm text-ink-2">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="mx-auto max-w-7xl px-5 pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border-soft bg-[#151517] px-6 py-16 text-center text-white sm:px-16 sm:py-20">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_50%_0%,rgba(238,68,68,0.14),transparent_70%)]" />
            <div className="pointer-events-none absolute -right-10 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-white/5 blur-3xl" />
            <div className="relative">
              <h2 className="font-display mx-auto max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
                Empieza a reclutar con Red Human AI
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-white/70">
                Explora la plataforma completa —tablero, vacantes, candidatos y atención— con datos de ejemplo.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button href="/dashboard" size="lg">
                  Ver la plataforma <ArrowRight className="h-4 w-4" />
                </Button>
                <Button href="/login" size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                  Iniciar sesión
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="border-t border-border-soft">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-ink-3 sm:flex-row">
          <Logo />
          <p className="font-mono text-xs">Red Human AI · Plataforma de RH con IA · México 2026</p>
          <div className="flex gap-5">
            <Link href="/dashboard" className="transition hover:text-ink">Plataforma</Link>
            <Link href="/login" className="transition hover:text-ink">Entrar</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
