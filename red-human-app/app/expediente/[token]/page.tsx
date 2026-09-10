"use client";

/* Liga pública para que el candidato suba sus documentos de contratación (Lote 4). Contraparte
   liviana de app/entrevista/[token] y app/entrevista-humana/[token]: sin sesión, sin avatar —
   aquí es una lista de documentos con un Dropzone por cada uno. A diferencia de la liga de
   Entrevista Humana, esta NO es de un solo uso: el candidato puede volver varias veces hasta
   completar todo. */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Clock, FileWarning, Loader2 } from "lucide-react";
import { Logo, Card, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { Dropzone } from "@/components/dashboard/subida";
import { cn } from "@/lib/utils";
import {
  fetchExpedientePublico,
  subirDocumentoPublico,
  type DocumentoExpedientePublico,
  type ExpedientePublico,
} from "@/lib/api";

type Fase = "cargando" | "no_disponible" | "lista";

const ESTADO_INFO: Record<DocumentoExpedientePublico["estado"], { label: string; tone: "good" | "warn" | "bad" | "neutral"; icon: typeof Clock }> = {
  recibido: { label: "Recibido", tone: "good", icon: CheckCircle2 },
  revision: { label: "En revisión", tone: "warn", icon: Clock },
  rechazado: { label: "Rechazado — vuelve a subirlo", tone: "bad", icon: FileWarning },
  pendiente: { label: "Pendiente", tone: "neutral", icon: Clock },
};

export default function ExpedientePublico() {
  const params = useParams();
  const token = String(params?.token ?? "");

  const [fase, setFase] = useState<Fase>("cargando");
  const [info, setInfo] = useState<ExpedientePublico | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    fetchExpedientePublico(token).then((i) => {
      if (!i) return setFase("no_disponible");
      setInfo(i);
      setFase("lista");
    });
  }, [token]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function subir(tipo: string, archivos: File[]) {
    if (!archivos[0]) return;
    setSubiendo(tipo);
    setError("");
    const r = await subirDocumentoPublico(token, tipo, archivos[0]);
    setSubiendo(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    cargar(); // re-sincroniza la lista completa desde el servidor en vez de mezclar formas de respuesta distintas
  }

  return (
    <main className="min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-10">
        {fase === "cargando" && (
          <div className="grid place-items-center py-24 text-ink-3">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {fase === "no_disponible" && (
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-bold">Liga no disponible</h1>
            <p className="mt-2 text-sm text-ink-2">
              Esta liga no es válida o tu expediente ya se cerró. Si crees que es un error, contacta al equipo de RH.
            </p>
          </Card>
        )}

        {fase === "lista" && info && (
          <>
            <div className="text-center">
              <Badge tone="brand" dot>
                Documentos de contratación
              </Badge>
              <h1 className="font-display mt-3 text-2xl font-bold sm:text-3xl">
                {info.candidato ? `Hola, ${info.candidato.split(" ")[0]}` : "Sube tus documentos"}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
                {info.puesto && `Para tu contratación como ${info.puesto}. `}Sube foto o PDF de cada documento —
                puedes volver a esta liga cuantas veces necesites.
              </p>
            </div>

            {info.estado === "alta" ? (
              <Card className="mt-6 p-6 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-good" />
                <p className="mt-2 text-sm text-ink-2">
                  Tu expediente ya quedó completo y tu alta fue autorizada — ya no se pueden subir más documentos
                  desde aquí.
                </p>
              </Card>
            ) : (
              <div className="mt-6 flex flex-col gap-3">
                {error && (
                  <div className="rounded-xl border border-bad/25 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
                    {error}
                  </div>
                )}
                {info.documentos.map((d) => {
                  const estado = ESTADO_INFO[d.estado];
                  const Icono = estado.icon;
                  return (
                    <Card key={d.tipo} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink">
                            {d.tipo}
                            {d.obligatorio && <span className="ml-1 text-bad">*</span>}
                          </span>
                        </div>
                        <Badge tone={estado.tone} dot>
                          <Icono className="h-3 w-3" /> {estado.label}
                        </Badge>
                      </div>
                      <div className={cn("mt-3", d.estado === "recibido" && "opacity-70")}>
                        <Dropzone
                          compacto
                          cargando={subiendo === d.tipo}
                          onArchivos={(archivos) => subir(d.tipo, archivos)}
                          titulo={d.estado === "recibido" ? "Subir otra vez / reemplazar" : "Subir foto o PDF"}
                        />
                      </div>
                    </Card>
                  );
                })}
                <p className="text-center text-[11px] text-ink-3">* obligatorio</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
