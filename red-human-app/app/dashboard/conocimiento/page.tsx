"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, FileText, BookOpen, Plus, Search, CornerDownLeft } from "lucide-react";
import { Card, Badge, Button, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { knowledgeBase, chatSugerencias, conversacionDemo } from "@/lib/data";
import { cn } from "@/lib/utils";

type Msg = { rol: "user" | "assistant"; texto: string; fuente?: string };

const respuestas: { match: string[]; texto: string; fuente: string }[] = [
  {
    match: ["vacacion", "vacaciones", "dias"],
    texto:
      "Según tu antigüedad y la reforma a la LFT, este año te corresponden 14 días de vacaciones. Puedo generar tu solicitud con folio para autorización de tu jefe(a). ¿Qué fechas te gustaría?",
    fuente: "KB-01 · Solicitud de vacaciones (v3)",
  },
  {
    match: ["pago", "nomina", "nómina", "quincena", "sueldo"],
    texto:
      "El próximo día de pago es el viernes 25. La nómina se procesa los días 24 y 9 de cada mes; si cae en fin de semana, se adelanta al día hábil anterior.",
    fuente: "KB-02 · Proceso de nómina (v5)",
  },
  {
    match: ["permiso", "ausencia", "falta"],
    texto:
      "Para un permiso por asuntos personales, dime el día y el motivo y genero la solicitud con folio. Recuerda que los permisos con goce se descuentan de tu saldo disponible.",
    fuente: "KB-03 · Permisos y ausencias (v2)",
  },
  {
    match: ["prestacion", "prestaciones", "seguro", "imss"],
    texto:
      "Cuentas con prestaciones superiores a la ley: 30 días de aguinaldo, vales de despensa, seguro de gastos médicos menores y fondo de ahorro. ¿Sobre cuál quieres detalle?",
    fuente: "KB-04 · Prestaciones superiores a la ley (v4)",
  },
];

function responder(texto: string): Msg {
  const t = texto.toLowerCase();
  const r = respuestas.find((r) => r.match.some((m) => t.includes(m)));
  if (r) return { rol: "assistant", texto: r.texto, fuente: r.fuente };
  return {
    rol: "assistant",
    texto:
      "Con gusto te ayudo. Puedo resolver dudas sobre nómina, vacaciones, permisos, prestaciones y políticas internas. Si no tengo la información, escalo tu caso a una persona de RH. ¿Sobre qué tema necesitas?",
    fuente: "Base de conocimiento · Grupo Carbe",
  };
}

export default function Conocimiento() {
  const [msgs, setMsgs] = useState<Msg[]>(conversacionDemo as Msg[]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing]);

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { rol: "user", texto: t }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setMsgs((m) => [...m, responder(t)]);
      setTyping(false);
    }, 1100);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Base de conocimiento" subtitle="Atención al colaborador con IA · respuestas con evidencia y fuente.">
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4" /> Nuevo contenido
        </Button>
      </PageHeader>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        {/* KB list */}
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input
                placeholder="Buscar en la base…"
                className="h-10 w-full rounded-xl border border-border-soft bg-surface-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border-faint px-4 py-3">
              <h3 className="text-sm font-semibold">Contenidos ({knowledgeBase.length})</h3>
            </div>
            <div className="divide-y divide-border-faint">
              {knowledgeBase.map((k) => (
                <div key={k.id} className="flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/50">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{k.titulo}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone="neutral">{k.categoria}</Badge>
                      <span className="font-mono text-[10px] text-good">{k.vigencia}</span>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-ink-3">{k.accesos.toLocaleString("es-MX")}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Chat */}
        <Card className="flex h-[640px] flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border-faint px-5 py-3.5">
            <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-brand text-brand-ink">
              <Sparkles className="h-4 w-4" />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-good" />
            </span>
            <div>
              <p className="text-sm font-semibold">Agente de atención</p>
              <p className="font-mono text-[11px] text-good">En línea · es-MX</p>
            </div>
            <Badge tone="brand" className="ml-auto">
              <BookOpen className="h-3 w-3" /> RAG
            </Badge>
          </div>

          {/* Mensajes */}
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {msgs.map((m, i) => (
              <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%]", m.rol === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed",
                      m.rol === "user"
                        ? "rounded-br-md bg-brand text-brand-ink"
                        : "rounded-bl-md border border-border-soft bg-surface-2 text-ink",
                    )}
                  >
                    {m.texto}
                  </div>
                  {m.fuente && (
                    <div className="mt-1.5 flex items-center gap-1.5 px-1 font-mono text-[10px] text-ink-3">
                      <FileText className="h-3 w-3 text-brand" /> {m.fuente}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {typing && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border-soft bg-surface-2 px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Sugerencias */}
          <div className="flex flex-wrap gap-2 border-t border-border-faint px-5 pt-3">
            {chatSugerencias.slice(0, 3).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-border-soft bg-surface px-3 py-1.5 text-xs text-ink-2 transition hover:border-brand/50 hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 p-4"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta…"
              className="h-11 flex-1 rounded-xl border border-border-soft bg-surface-2 px-4 text-sm outline-none transition focus:border-brand focus:bg-surface"
            />
            <Button type="submit" size="md" className="aspect-square px-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
