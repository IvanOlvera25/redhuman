"use client";

/* Referencias laborales — liga del CANDIDATO (Fraiche, cambios integrados 2026-10-02 §10). Sin sesión: la liga es la
   credencial y SOLO permite capturar los datos de sus referencias (empresa, puesto, periodo y un contacto). Nunca ve
   la validación ni el resultado: eso lo registra el responsable desde su propia liga. */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Trash2, Users } from "lucide-react";
import { Button, Card, Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { REFERENCIA_VACIA, capturarReferenciasCandidato, fetchReferenciasCandidato, type ReferenciaLaboral } from "@/lib/api";

type Datos = Awaited<ReturnType<typeof fetchReferenciasCandidato>>;
const input = "h-12 w-full rounded-xl border border-border-soft bg-surface px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const CAMPOS: { clave: keyof ReferenciaLaboral; etiqueta: string; placeholder?: string; tipo?: string; opcional?: boolean }[] = [
  { clave: "empresa", etiqueta: "Empresa" },
  { clave: "puesto_candidato", etiqueta: "Tu puesto ahí" },
  { clave: "periodo", etiqueta: "Periodo trabajado", placeholder: "Ej. 2023 – 2025" },
  { clave: "contacto_nombre", etiqueta: "Nombre de quien te puede recomendar" },
  { clave: "contacto_cargo", etiqueta: "Su cargo", placeholder: "Ej. Gerente de tienda" },
  { clave: "relacion", etiqueta: "Relación laboral", placeholder: "Ej. Jefe directo" },
  { clave: "telefono", etiqueta: "Su teléfono", tipo: "tel" },
  { clave: "correo", etiqueta: "Su correo (opcional)", tipo: "email", opcional: true },
];

export default function ReferenciasCandidato() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [datos, setDatos] = useState<Datos | undefined>(undefined);
  const [filas, setFilas] = useState<ReferenciaLaboral[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    fetchReferenciasCandidato(token).then((d) => {
      setDatos(d);
      if (d) {
        const base = d.referencias.length ? d.referencias.map((r) => ({ ...REFERENCIA_VACIA, ...r })) : [];
        while (base.length < Math.max(1, d.requeridas)) base.push({ ...REFERENCIA_VACIA });
        setFilas(base);
      }
    });
  }, [token]);

  const cambiar = (i: number, p: Partial<ReferenciaLaboral>) => setFilas(filas.map((f, j) => (j === i ? { ...f, ...p } : f)));

  async function guardar() {
    setEnviando(true);
    setError("");
    const r = await capturarReferenciasCandidato(token, filas.filter((f) => f.empresa.trim() || f.contacto_nombre.trim() || f.telefono.trim()));
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    setListo(true);
  }

  return (
    <main className="sala-publica min-h-svh bg-bg">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-10">
        {datos === undefined ? (
          <div className="grid place-items-center py-24 text-ink-3"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : datos === null ? (
          <Card className="p-8 text-center text-sm text-ink-2">Esta liga no es válida o ya no está disponible.</Card>
        ) : listo || datos.cerrada ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-good" />
            <h1 className="font-display text-xl font-bold">Referencias recibidas</h1>
            <p className="text-sm text-ink-2">Gracias. {datos.empresa} se pondrá en contacto con tus referencias para continuar con tu proceso.</p>
          </Card>
        ) : (
          <Card className="p-6">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-3"><Users className="h-4 w-4" /> Referencias laborales</p>
            <h1 className="mt-2 font-display text-xl font-bold">{datos.vacante} · {datos.empresa}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Hola {datos.candidato.split(" ")[0]}. Compártenos {datos.requeridas} referencia{datos.requeridas === 1 ? "" : "s"} laboral{datos.requeridas === 1 ? "" : "es"}: dónde
              trabajaste y una persona que te conozca en ese trabajo. Puede ser de otros trabajos; usaremos estos datos solo para validar tu experiencia.
            </p>
            <div className="mt-5 flex flex-col gap-4">
              {filas.map((f, i) => (
                <div key={i} className="rounded-2xl border border-border-soft bg-surface-2/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">Referencia {i + 1}</p>
                    {filas.length > 1 && (
                      <button type="button" onClick={() => setFilas(filas.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-xs text-bad hover:underline">
                        <Trash2 className="h-3.5 w-3.5" /> Quitar
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {CAMPOS.map((c) => (
                      <label key={c.clave} className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-ink-2">{c.etiqueta}</span>
                        <input
                          type={c.tipo ?? "text"}
                          value={String(f[c.clave] ?? "")}
                          onChange={(e) => cambiar(i, { [c.clave]: e.target.value } as Partial<ReferenciaLaboral>)}
                          placeholder={c.placeholder}
                          className={input}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {filas.length < 10 && (
                <Button variant="outline" className="self-start" onClick={() => setFilas([...filas, { ...REFERENCIA_VACIA }])}>
                  <Plus className="h-4 w-4" /> Agregar otra referencia
                </Button>
              )}
            </div>
            {error && <p className="mt-4 text-sm font-semibold text-bad">{error}</p>}
            <Button size="lg" className="mt-5 w-full totem:min-h-16 totem:text-xl" onClick={guardar} disabled={enviando}>
              {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Enviar referencias
            </Button>
          </Card>
        )}
      </div>
    </main>
  );
}
