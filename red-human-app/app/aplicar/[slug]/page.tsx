"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Building2,
  ArrowRight,
  ArrowLeft,
  FileCheck2,
  Check,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  User,
  Mail,
  Phone,
  AlertTriangle,
} from "lucide-react";
import { Logo, Button, Card, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { Dropzone, pesoLegible } from "@/components/dashboard/subida";
import { fetchVacantePorSlug, postular } from "@/lib/api";
import type { Vacante } from "@/lib/data";
import { cn } from "@/lib/utils";

const pasos = ["Tus datos", "Currículum", "Unas preguntas"];

/** Preguntas de respaldo cuando la vacante no trae criterios de prefiltro. */
const PREGUNTAS_BASE = [
  "¿Cuentas con disponibilidad de horario para el puesto?",
  "¿Tienes experiencia previa en un puesto similar?",
];

export default function Aplicar() {
  const params = useParams();
  const slug = String(params?.slug ?? "");

  const [vacante, setVacante] = useState<Vacante | null>(null);
  const [cargando, setCargando] = useState(true);

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);
  const [cv, setCv] = useState<File | null>(null);
  const [datos, setDatos] = useState({ nombre: "", correo: "", telefono: "" });
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetchVacantePorSlug(slug).then((v) => {
      setVacante(v);
      setCargando(false);
    });
  }, [slug]);

  /* Título de respaldo a partir del slug si la API no responde (modo demo). */
  const titulo = useMemo(() => {
    if (vacante) return vacante.titulo;
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [vacante, slug]);

  const preguntas = useMemo(
    () => (vacante?.criterios?.length ? vacante.criterios.map((c) => c.pregunta) : vacante?.preguntas_filtro?.length ? vacante.preguntas_filtro : PREGUNTAS_BASE),
    [vacante],
  );

  const puedeAvanzar =
    step === 0 ? datos.nombre.trim().length > 2 && (datos.telefono.trim() || datos.correo.trim()) : step === 1 ? consent : true;

  async function siguiente() {
    setError("");
    if (step < pasos.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    if (!vacante) {
      setDone(true); // modo demo sin API: se muestra la confirmación
      return;
    }

    setEnviando(true);
    const r = await postular({
      slug,
      nombre: datos.nombre,
      telefono: datos.telefono,
      correo: datos.correo,
      consentimiento: consent,
      respuestas: preguntas.map((p) => ({ pregunta: p, respuesta: respuestas[p] ?? "" })),
      cv,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDone(true);
  }

  return (
    <main className="min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        {/* Encabezado de la vacante */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge tone={vacante || cargando ? "good" : "warn"} dot>
              {cargando ? "Cargando…" : vacante ? "Vacante abierta" : "Vista previa"}
            </Badge>
            <h1 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{titulo}</h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-ink-3" /> {vacante?.empresa ?? "Grupo Carbe"}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-ink-3" /> {vacante?.ubicacion ?? "México"}
              </span>
              {vacante?.sueldo && <span className="font-mono text-brand">{vacante.sueldo}</span>}
              {vacante?.modalidad && <span className="text-ink-3">{vacante.modalidad}</span>}
            </div>
          </div>
        </div>

        {/* Descripción real de la vacante */}
        {vacante && !done && (
          <Card className="mt-6 p-5">
            {vacante.resumen && <p className="text-[15px] font-medium leading-relaxed">{vacante.resumen}</p>}
            {vacante.descripcion && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{vacante.descripcion}</p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(vacante.responsabilidades?.length ?? 0) > 0 && (
                <Lista titulo="Lo que harás" items={vacante.responsabilidades!} />
              )}
              {(vacante.beneficios?.length ?? 0) > 0 && <Lista titulo="Lo que ofrecemos" items={vacante.beneficios!} />}
            </div>
          </Card>
        )}

        {done ? (
          <Exito titulo={titulo} conCv={Boolean(cv)} />
        ) : (
          <Card className="mt-6 overflow-hidden">
            {/* Progreso */}
            <div className="border-b border-border-faint px-6 py-4">
              <div className="flex items-center gap-2">
                {pasos.map((p, i) => (
                  <div key={p} className="flex flex-1 items-center gap-2">
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold transition",
                        i < step
                          ? "bg-brand text-brand-ink"
                          : i === step
                            ? "bg-brand text-brand-ink ring-4 ring-brand/20"
                            : "bg-surface-2 text-ink-3",
                      )}
                    >
                      {i < step ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className={cn("hidden text-sm font-medium sm:block", i === step ? "text-ink" : "text-ink-3")}>
                      {p}
                    </span>
                    {i < pasos.length - 1 && <span className={cn("h-px flex-1", i < step ? "bg-brand" : "bg-border-soft")} />}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  {step === 0 && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo
                        label="Nombre completo"
                        icon={User}
                        placeholder="María Fernanda López"
                        value={datos.nombre}
                        onChange={(v) => setDatos({ ...datos, nombre: v })}
                        full
                      />
                      <Campo
                        label="Correo"
                        icon={Mail}
                        placeholder="tu@correo.com"
                        type="email"
                        value={datos.correo}
                        onChange={(v) => setDatos({ ...datos, correo: v })}
                      />
                      <Campo
                        label="WhatsApp"
                        icon={Phone}
                        placeholder="33 1234 5678"
                        type="tel"
                        value={datos.telefono}
                        onChange={(v) => setDatos({ ...datos, telefono: v })}
                      />
                      <p className="text-xs text-ink-3 sm:col-span-2">
                        Con uno de los dos basta, pero por WhatsApp te contestamos más rápido.
                      </p>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="flex flex-col gap-5">
                      {cv ? (
                        <button
                          onClick={() => setCv(null)}
                          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-good bg-good-soft/40 p-8 text-center transition"
                        >
                          <FileCheck2 className="h-10 w-10 text-good" />
                          <div>
                            <p className="font-semibold text-good">{cv.name}</p>
                            <p className="text-sm text-ink-3">{pesoLegible(cv.size)} · toca para cambiarlo</p>
                          </div>
                        </button>
                      ) : (
                        <Dropzone
                          onArchivos={(a) => setCv(a[0])}
                          titulo="Sube tu currículum (opcional)"
                          ayuda="PDF o foto · máx. 10 MB · nuestro asistente leerá tus datos para que no los captures"
                        />
                      )}

                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-soft bg-surface-2 p-4">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          className="mt-0.5 h-5 w-5 rounded border-border-soft accent-[var(--brand)]"
                        />
                        <span className="text-[13px] leading-relaxed text-ink-2">
                          Autorizo ser contactado(a) por WhatsApp, correo o llamada, y el tratamiento de mis datos
                          personales conforme al{" "}
                          <a href="#" className="text-brand underline">
                            Aviso de Privacidad
                          </a>
                          .
                          <span className="mt-1 block text-ink-3">
                            Requerido para continuar (LFPDPPP). Puedes revocarlo cuando quieras.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="flex flex-col gap-4">
                      {preguntas.map((q, i) => (
                        <div key={i}>
                          <p className="mb-2 text-sm font-medium">{q}</p>
                          <div className="flex gap-2">
                            {["Sí", "No", "Parcial"].map((op) => {
                              const activa = respuestas[q] === op;
                              return (
                                <button
                                  key={op}
                                  onClick={() => setRespuestas((r) => ({ ...r, [q]: op }))}
                                  className={cn(
                                    "flex-1 rounded-xl border py-2.5 text-sm transition",
                                    activa
                                      ? "border-brand bg-brand-soft font-medium text-brand"
                                      : "border-border-soft bg-surface hover:border-brand hover:bg-brand-soft",
                                  )}
                                >
                                  {op}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border-faint px-6 py-4">
              <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || enviando}>
                <ArrowLeft className="h-4 w-4" /> Atrás
              </Button>
              <Button onClick={siguiente} disabled={!puedeAvanzar || enviando}>
                {enviando ? "Enviando…" : step === pasos.length - 1 ? "Enviar aplicación" : "Continuar"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}

function Lista({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{titulo}</p>
      <ul className="mt-1.5 space-y-1">
        {items.slice(0, 5).map((x, i) => (
          <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-ink-2">
            <span className="text-brand">·</span>
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Campo({
  label,
  icon: Icon,
  placeholder,
  type = "text",
  value,
  onChange,
  full,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full rounded-xl border border-border-soft bg-surface pl-10 pr-4 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
    </label>
  );
}

function Exito({ titulo, conCv }: { titulo: string; conCv: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Card className="mt-8 overflow-hidden text-center">
        <div className="relative bg-[#151517] px-6 py-12 text-white">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(238,68,68,0.16),transparent_70%)]" />
          <div className="relative">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.15 }}
              className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-good text-white"
            >
              <Check className="h-9 w-9" />
            </motion.div>
            <h2 className="font-display mt-5 text-2xl font-bold">¡Aplicación enviada!</h2>
            <p className="mx-auto mt-2 max-w-md text-white/70">
              Recibimos tu solicitud para <b className="text-white">{titulo}</b>.
              {conCv && " Ya estamos leyendo tu CV."} Nuestro agente continuará tu proceso por WhatsApp en los
              próximos minutos.
            </p>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-3 rounded-2xl border border-human/25 bg-human-soft/50 p-4 text-left">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-human text-white">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">Continúa por WhatsApp</p>
              <p className="text-xs text-ink-3">El agente te escribirá para completar tu prefiltro.</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-6 text-sm text-ink-3">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-good" /> Datos protegidos
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-brand" /> Respuesta en minutos
            </span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
