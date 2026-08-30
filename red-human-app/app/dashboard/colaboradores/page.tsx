"use client";

import { useEffect, useState } from "react";
import { Briefcase, CalendarClock, ExternalLink, Mail, Phone, ShieldCheck, UserSquare2 } from "lucide-react";
import { Card, Badge, Avatar, Eyebrow } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { fetchColaboradores, type Colaborador } from "@/lib/api";

export default function Colaboradores() {
  const [datos, setDatos] = useState<Colaborador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    fetchColaboradores().then((d) => {
      if (d) {
        setDatos(d);
        setLive(true);
      }
      setCargando(false);
    });
  }, []);

  const activos = datos.filter((c) => c.activo).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Colaboradores"
        subtitle="Personas dadas de alta al cerrar el Onboarding — el destino final del pipeline de reclutamiento."
      >
        {live && (
          <Badge tone="good" dot>
            API en vivo
          </Badge>
        )}
        <Badge tone="brand" dot>
          {activos} activo{activos !== 1 ? "s" : ""}
        </Badge>
      </PageHeader>

      {cargando ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-border-soft bg-surface-2/60" />
          ))}
        </div>
      ) : datos.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-2 p-12 text-center">
          <UserSquare2 className="h-8 w-8 text-ink-3" />
          <p className="text-sm font-medium text-ink-2">Todavía no hay colaboradores dados de alta.</p>
          <p className="max-w-sm text-xs text-ink-3">
            Aparecen aquí en cuanto RH presiona «Dar de alta como colaborador» al cerrar el expediente de un
            candidato en Onboarding.
          </p>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {datos.map((c) => (
            <Card key={c.id} hover className="flex flex-col gap-3.5 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={c.nombre} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.nombre}</p>
                    <p className="truncate text-xs text-ink-3">{c.puesto || "Puesto sin definir"}</p>
                  </div>
                </div>
                <Badge tone={c.activo ? "good" : "neutral"} dot>
                  {c.activo ? "Activo" : "Inactivo"}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-ink-2">
                {c.salario && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface-2 px-2 py-1 font-mono text-brand">
                    {c.salario}
                  </span>
                )}
                {c.fechaIngreso && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 text-ink-3" />
                    Ingresó {new Date(c.fechaIngreso).toLocaleDateString("es-MX")}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1 text-xs text-ink-3">
                {c.correo && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {c.correo}
                  </span>
                )}
                {c.telefono && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> {c.telefono}
                  </span>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between border-t border-border-faint pt-3 text-[11px] text-ink-3">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-human" /> Alta por {c.dadoDeAltaPor || "RH"}
                </span>
                {c.candidatoOrigenId && (
                  <a
                    href="/dashboard/candidatos"
                    className="flex items-center gap-1 text-brand transition hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> {c.candidatoOrigenId}
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!cargando && (
        <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-3">
          <Briefcase className="h-3.5 w-3.5" />
          Este registro es independiente del módulo de Empleados (Requisiciones · Radar Interno).
        </p>
      )}
    </div>
  );
}
