"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Save,
  Shield,
  Trash2,
  Upload,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";
import { PageHeader } from "@/components/dashboard/parts";
import { Aviso } from "@/components/dashboard/subida";
import { useEsAdmin } from "@/components/sesion";
import {
  actualizarCliente,
  actualizarCuenta,
  actualizarReglaNotificacion,
  actualizarUsuario,
  crearCliente,
  crearUsuario,
  eliminarCandidatosPrueba,
  fetchClientes,
  fetchConfiguracion,
  fetchCuentaActual,
  fetchReglasNotificacion,
  fetchUsuarios,
  subirLogoCuenta,
  EVENTOS_NOTIFICACION,
  NOMBRE_EVENTO_NOTIFICACION,
  type Cliente,
  type ConfiguracionSistema,
  type DatosCuenta,
  type EventoNotificacion,
  type ReglaNotificacion,
  type ResumenBorradoPrueba,
  type RolUsuario,
  type UsuarioRH,
  urlArchivo,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/* ============================================================
   Configuración — reorganizada en 6 secciones (Punto 2)
   1. Cuenta y Portal
   2. Usuarios y permisos
   3. Clientes y contactos
   4. Plantillas  (enlace a Vacantes)
   5. Notificaciones
   6. Modo prueba
   ============================================================ */

export default function Configuracion() {
  const esAdmin = useEsAdmin();

  if (!esAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader title="Configuración" subtitle="Solo un administrador puede ver esta sección." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Configuración" subtitle="Ajustes globales del sistema, solo para administradores." />

      <SeccionCuentaPortal />
      <SeccionUsuarios />
      <SeccionClientes />
      <SeccionPlantillas />
      <SeccionNotificaciones />
      <SeccionModoPrueba />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cabecera de sección reutilizable                                      */
/* ------------------------------------------------------------------ */

function CabSeccion({
  icono: Icono,
  titulo,
  subtitulo,
}: {
  icono: React.ComponentType<{ className?: string }>;
  titulo: string;
  subtitulo?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icono className="h-[18px] w-[18px] text-brand" />
      <div>
        <h2 className="font-display text-base font-bold leading-none">{titulo}</h2>
        {subtitulo && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{subtitulo}</p>}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 1. Cuenta y Portal                                                  */
/* ================================================================== */

const CAMPOS_CUENTA: { campo: keyof Omit<DatosCuenta, "id" | "logo">; label: string; placeholder: string }[] = [
  { campo: "nombreComercial", label: "Nombre comercial", placeholder: "Ej. Grupo Carbe" },
  { campo: "razonSocial", label: "Razón social", placeholder: "Ej. Carbe S.A. de C.V." },
  { campo: "contactoNombre", label: "Nombre de contacto", placeholder: "Ej. Ana García" },
  { campo: "correoComunicacion", label: "Correo de comunicación", placeholder: "rh@empresa.com" },
  { campo: "whatsappComunicacion", label: "WhatsApp de comunicación", placeholder: "52 55 1234 5678" },
];

function SeccionCuentaPortal() {
  const [cuenta, setCuenta] = useState<DatosCuenta | null>(null);
  const [form, setForm] = useState<Partial<Omit<DatosCuenta, "id" | "logo">>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [error, setError] = useState("");
  const [guardado, setGuardado] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCuentaActual().then((d) => {
      if (d) {
        setCuenta(d);
        setForm({
          nombreComercial: d.nombreComercial,
          razonSocial: d.razonSocial,
          contactoNombre: d.contactoNombre,
          correoComunicacion: d.correoComunicacion,
          whatsappComunicacion: d.whatsappComunicacion,
        });
      }
      setCargando(false);
    });
  }, []);

  async function guardar() {
    setGuardando(true);
    setError("");
    setGuardado(false);
    const r = await actualizarCuenta(form);
    setGuardando(false);
    if (!r.ok) { setError(r.error); return; }
    setCuenta(r.data);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 3000);
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSubiendoLogo(true);
    setError("");
    const r = await subirLogoCuenta(f);
    setSubiendoLogo(false);
    if (!r.ok) { setError(r.error); return; }
    setCuenta(r.data);
  }

  return (
    <Card className="mt-6 p-5">
      <CabSeccion
        icono={Building2}
        titulo="Cuenta y Portal"
        subtitulo="Datos de tu empresa que aparecen en el portal de postulación y en los correos del proceso."
      />

      {error && <div className="mb-4"><Aviso tono="error">{error}</Aviso></div>}
      {guardado && <div className="mb-4"><Aviso tono="ok">Cambios guardados correctamente.</Aviso></div>}

      {cargando ? (
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      ) : (
        <>
          {/* Logo */}
          <div className="mb-5 flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-soft bg-surface-2">
              {cuenta?.logo ? (
                <img src={urlArchivo("/" + cuenta.logo)} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-7 w-7 text-ink-3" />
              )}
            </div>
            <div>
              <p className="text-[13px] font-medium">Logo de la Cuenta</p>
              <p className="text-[12px] text-ink-3">PNG, JPG, SVG o WebP. Se muestra en el portal y correos.</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={subiendoLogo}
                className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline disabled:opacity-50"
              >
                {subiendoLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {subiendoLogo ? "Subiendo…" : "Cambiar logo"}
              </button>
              <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={onLogo} />
            </div>
          </div>

          {/* Campos de texto */}
          <div className="grid gap-3 sm:grid-cols-2">
            {CAMPOS_CUENTA.map(({ campo, label, placeholder }) => (
              <div key={campo} className={campo === "nombreComercial" ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">{label}</label>
                <input
                  value={(form[campo] as string) ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [campo]: e.target.value }))}
                  placeholder={placeholder}
                  className="h-10 w-full rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ================================================================== */
/* 2. Usuarios y permisos                                              */
/* ================================================================== */

function SeccionUsuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioRH[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<UsuarioRH | null>(null);

  useEffect(() => {
    fetchUsuarios().then((u) => {
      setUsuarios(u ?? []);
      setCargando(false);
    });
  }, []);

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <CabSeccion
          icono={Users}
          titulo="Usuarios y permisos"
          subtitulo="Personas de RH con acceso a esta Cuenta. Administradores ven todo; Usuarios solo lo suyo."
        />
        <Button size="sm" onClick={() => { setMostrarForm(true); setEditando(null); }}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>

      {error && <div className="mb-3"><Aviso tono="error">{error}</Aviso></div>}

      {mostrarForm && (
        <FormUsuario
          usuario={editando}
          onGuardado={(u) => {
            setUsuarios((prev) =>
              editando ? prev.map((x) => (x.id === u.id ? u : x)) : [...prev, u].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            );
            setMostrarForm(false);
            setEditando(null);
          }}
          onCancelar={() => { setMostrarForm(false); setEditando(null); }}
          onError={setError}
        />
      )}

      {cargando ? (
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      ) : usuarios.length === 0 ? (
        <p className="text-sm text-ink-3">No hay usuarios en esta Cuenta.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-faint">
          {usuarios.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">{u.nombre}</p>
                <p className="truncate text-[12px] text-ink-3">{u.correo}{u.puesto ? ` · ${u.puesto}` : ""}</p>
              </div>
              <Badge tone={u.rol === "Administrador" ? "brand" : "neutral"}>{u.rol}</Badge>
              <Badge tone={u.activo ? "good" : "neutral"} dot>{u.activo ? "Activo" : "Inactivo"}</Badge>
              <button
                onClick={() => { setEditando(u); setMostrarForm(true); setError(""); }}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-brand"
                aria-label={`Editar ${u.nombre}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FormUsuario({
  usuario,
  onGuardado,
  onCancelar,
  onError,
}: {
  usuario: UsuarioRH | null;
  onGuardado: (u: UsuarioRH) => void;
  onCancelar: () => void;
  onError: (e: string) => void;
}) {
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [correo, setCorreo] = useState(usuario?.correo ?? "");
  const [puesto, setPuesto] = useState(usuario?.puesto ?? "");
  const [rol, setRol] = useState<RolUsuario>(usuario?.rol ?? "Usuario");
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    onError("");
    let r;
    if (usuario) {
      const cambios: Parameters<typeof actualizarUsuario>[1] = { nombre, puesto, rol, activo };
      if (password) cambios.password = password;
      r = await actualizarUsuario(usuario.id, cambios);
    } else {
      if (!password) { onError("La contraseña es obligatoria al crear un usuario."); setGuardando(false); return; }
      r = await crearUsuario({ correo, nombre, puesto, rol, password });
    }
    setGuardando(false);
    if (!r.ok) { onError(r.error); return; }
    onGuardado(r.data);
  }

  return (
    <div className="mb-4 rounded-xl border border-border-soft bg-surface-2 p-4">
      <p className="mb-3 text-sm font-semibold">{usuario ? `Editar: ${usuario.nombre}` : "Nuevo usuario"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">Nombre completo</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. María López" className="h-9 w-full rounded-lg border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </div>
        {!usuario && (
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-2">Correo</label>
            <input value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="correo@empresa.com" type="email" className="h-9 w-full rounded-lg border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">Puesto</label>
          <input value={puesto} onChange={(e) => setPuesto(e.target.value)} placeholder="Ej. Reclutadora" className="h-9 w-full rounded-lg border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">Rol</label>
          <select value={rol} onChange={(e) => setRol(e.target.value as RolUsuario)} className="h-9 w-full rounded-lg border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
            <option value="Usuario">Usuario</option>
            <option value="Administrador">Administrador</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">{usuario ? "Nueva contraseña (opcional)" : "Contraseña"}</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Mínimo 8 caracteres" className="h-9 w-full rounded-lg border border-border-soft bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </div>
        {usuario && (
          <div className="flex items-center gap-2 pt-5">
            <input type="checkbox" id={`activo-${usuario.id}`} checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4 rounded accent-brand" />
            <label htmlFor={`activo-${usuario.id}`} className="text-sm">Usuario activo</label>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancelar} disabled={guardando}><X className="h-4 w-4" /> Cancelar</Button>
        <Button size="sm" onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 3. Clientes y contactos                                             */
/* ================================================================== */

function SeccionClientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevoCliente, setNuevoCliente] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchClientes().then((c) => {
      setClientes(c ?? []);
      setCargando(false);
    });
  }, []);

  async function crearNuevo() {
    if (!nuevoCliente.trim()) return;
    setCreando(true);
    setError("");
    const r = await crearCliente(nuevoCliente.trim());
    setCreando(false);
    if (!r.ok) { setError(r.error); return; }
    setClientes((prev) => [...prev, r.data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setNuevoCliente("");
  }

  async function alternarEstado(c: Cliente) {
    const r = await actualizarCliente(c.id, { estado: c.estado === "Activo" ? "Inactivo" : "Activo" });
    if (r.ok) setClientes((prev) => prev.map((x) => (x.id === c.id ? r.data : x)));
  }

  return (
    <Card className="mt-4 p-5">
      <CabSeccion
        icono={UserCircle}
        titulo="Clientes y contactos"
        subtitulo="Empresas para las que recluta tu Cuenta. Se eligen al crear una vacante; si no hay ninguno, ese selector no aparece."
      />

      {error && <div className="mb-3"><Aviso tono="error">{error}</Aviso></div>}

      <div className="flex gap-2">
        <input
          value={nuevoCliente}
          onChange={(e) => setNuevoCliente(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && crearNuevo()}
          placeholder="Nombre del Cliente"
          className="h-10 flex-1 rounded-xl border border-border-soft bg-surface px-3.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button size="sm" onClick={crearNuevo} disabled={creando || !nuevoCliente.trim()}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>

      {cargando ? (
        <Loader2 className="mt-4 h-5 w-5 animate-spin text-ink-3" />
      ) : clientes.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Todavía no hay ningún Cliente.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border-faint">
          {clientes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm">{c.nombre}</span>
              <button onClick={() => alternarEstado(c)} className="shrink-0" aria-label={`Marcar ${c.nombre} como ${c.estado === "Activo" ? "Inactivo" : "Activo"}`}>
                <Badge tone={c.estado === "Activo" ? "good" : "neutral"} dot>{c.estado}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ================================================================== */
/* 4. Plantillas                                                        */
/* ================================================================== */

function SeccionPlantillas() {
  return (
    <Card className="mt-4 p-5">
      <CabSeccion
        icono={Briefcase}
        titulo="Plantillas"
        subtitulo="Reutiliza contenido de vacantes anteriores para agilizar la creación de nuevas."
      />
      <p className="text-[13px] text-ink-2">
        Las plantillas se gestionan desde la pantalla de Vacantes.{" "}
        <Link
          href="/dashboard/vacantes"
          className="font-medium text-brand hover:underline"
        >
          Ir a Vacantes → botón &quot;Plantillas&quot; →
        </Link>
      </p>
    </Card>
  );
}

/* ================================================================== */
/* 5. Notificaciones                                                    */
/* ================================================================== */

function SeccionNotificaciones() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [reglas, setReglas] = useState<ReglaNotificacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [guardandoRegla, setGuardandoRegla] = useState<EventoNotificacion | null>(null);

  useEffect(() => {
    Promise.all([fetchClientes(), fetchReglasNotificacion()]).then(([c, r]) => {
      setClientes(c ?? []);
      setReglas(r ?? []);
      setCargando(false);
    });
  }, []);

  const hayClienteActivo = clientes.some((c) => c.estado === "Activo");

  async function alternarCasilla(regla: ReglaNotificacion, campo: keyof Omit<ReglaNotificacion, "evento">) {
    setError("");
    setGuardandoRegla(regla.evento);
    const { evento, ...resto } = regla;
    const r = await actualizarReglaNotificacion(evento, { ...resto, [campo]: !resto[campo] });
    setGuardandoRegla(null);
    if (!r.ok) { setError(r.error); return; }
    setReglas((prev) => prev.map((x) => (x.evento === evento ? r.data : x)));
  }

  return (
    <Card className="mt-4 p-5">
      <CabSeccion
        icono={Bell}
        titulo="Notificaciones"
        subtitulo="Para cada evento del proceso, elige quién se entera y por qué canal — usando datos que ya existen en la ficha de cada candidato, entrevistador o Cliente."
      />

      {error && <div className="mb-3"><Aviso tono="error">{error}</Aviso></div>}

      {cargando ? (
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-faint text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3 font-medium">Evento</th>
                <th className="px-2 py-2 text-center font-medium" colSpan={2}>Candidato</th>
                <th className="px-2 py-2 text-center font-medium" colSpan={2}>Entrevistador</th>
                {hayClienteActivo && <th className="px-2 py-2 text-center font-medium" colSpan={2}>Cliente</th>}
              </tr>
              <tr className="border-b border-border-faint text-center text-[11px] text-ink-3">
                <th />
                <th className="px-2 pb-1.5 font-normal">Correo</th>
                <th className="px-2 pb-1.5 font-normal">WhatsApp</th>
                <th className="px-2 pb-1.5 font-normal">Correo</th>
                <th className="px-2 pb-1.5 font-normal">WhatsApp</th>
                {hayClienteActivo && (
                  <>
                    <th className="px-2 pb-1.5 font-normal">Correo</th>
                    <th className="px-2 pb-1.5 font-normal">WhatsApp</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {EVENTOS_NOTIFICACION.map((evento) => {
                const regla = reglas.find((r) => r.evento === evento);
                if (!regla) return null;
                return (
                  <tr key={evento} className="border-b border-border-faint last:border-0">
                    <td className="py-2 pr-3 text-[13px]">{NOMBRE_EVENTO_NOTIFICACION[evento]}</td>
                    <CasillaRegla regla={regla} campo="candidatoCorreo" ocupado={guardandoRegla === evento} onCambio={alternarCasilla} />
                    <CasillaRegla regla={regla} campo="candidatoWhatsapp" ocupado={guardandoRegla === evento} onCambio={alternarCasilla} />
                    <CasillaRegla regla={regla} campo="entrevistadorCorreo" ocupado={guardandoRegla === evento} onCambio={alternarCasilla} />
                    <CasillaRegla regla={regla} campo="entrevistadorWhatsapp" ocupado={guardandoRegla === evento} onCambio={alternarCasilla} />
                    {hayClienteActivo && (
                      <>
                        <CasillaRegla regla={regla} campo="clienteCorreo" ocupado={guardandoRegla === evento} onCambio={alternarCasilla} />
                        <CasillaRegla regla={regla} campo="clienteWhatsapp" ocupado={guardandoRegla === evento} onCambio={alternarCasilla} />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CasillaRegla({
  regla, campo, ocupado, onCambio,
}: {
  regla: ReglaNotificacion;
  campo: keyof Omit<ReglaNotificacion, "evento">;
  ocupado: boolean;
  onCambio: (regla: ReglaNotificacion, campo: keyof Omit<ReglaNotificacion, "evento">) => void;
}) {
  return (
    <td className="px-2 py-2 text-center">
      <input
        type="checkbox"
        checked={regla[campo]}
        disabled={ocupado}
        onChange={() => onCambio(regla, campo)}
        className="h-4 w-4 rounded border-border-soft accent-brand disabled:opacity-50"
        aria-label={`${NOMBRE_EVENTO_NOTIFICACION[regla.evento]} — ${campo}`}
      />
    </td>
  );
}

/* ================================================================== */
/* 6. Modo prueba                                                       */
/* ================================================================== */

function SeccionModoPrueba() {
  const [cfg, setCfg] = useState<ConfiguracionSistema | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resumen, setResumen] = useState<ResumenBorradoPrueba | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchConfiguracion().then((d) => {
      setCfg(d);
      setCargando(false);
    });
  }, []);

  async function alternar() {
    if (!cfg) return;
    setGuardando(true);
    setError("");
    const { actualizarConfiguracion } = await import("@/lib/api");
    const r = await actualizarConfiguracion(!cfg.modoPrueba);
    setGuardando(false);
    if (!r.ok) { setError(r.error); return; }
    setCfg(r.data);
  }

  async function confirmarBorrado() {
    setBorrando(true);
    setError("");
    const { eliminarCandidatosPrueba } = await import("@/lib/api");
    const r = await eliminarCandidatosPrueba();
    setBorrando(false);
    if (!r.ok) { setError(r.error); return; }
    setResumen(r.data);
    setConfirmando(false);
    setCfg((prev) => (prev ? { ...prev, candidatosPrueba: 0 } : prev));
  }

  return (
    <Card className="mt-4 p-5">
      <CabSeccion
        icono={FlaskConical}
        titulo="Modo prueba"
        subtitulo="Prueba el flujo de postulación sin contaminar los datos reales de RH."
      />

      {error && <div className="mb-4"><Aviso tono="error">{error}</Aviso></div>}

      {/* Toggle modo prueba */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Estado del modo prueba</p>
            {cfg?.modoPrueba && <Badge tone="brand" dot>Activo</Badge>}
          </div>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-ink-2">
            Con Modo Prueba activo, si una conversación de WhatsApp de prueba ya lleva más de 60
            minutos sin actividad, el siguiente mensaje del mismo teléfono crea una postulación
            nueva e independiente en vez de reutilizar la anterior. Los candidatos creados así se
            marcan como prueba y nunca aparecen en los listados ni reportes de RH.
          </p>
        </div>
        {cargando ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-ink-3" />
        ) : (
          <button
            type="button"
            onClick={alternar}
            disabled={guardando}
            aria-pressed={cfg?.modoPrueba}
            aria-label="Alternar Modo Prueba"
            className={cn(
              "h-7 w-12 shrink-0 rounded-full border transition",
              cfg?.modoPrueba ? "border-brand bg-brand" : "border-border-soft bg-surface-2",
            )}
          >
            <span
              className={cn(
                "block h-5 w-5 rounded-full bg-white shadow transition-transform",
                cfg?.modoPrueba ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        )}
      </div>

      {/* Eliminar postulaciones de prueba */}
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-bad/25 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Eliminar postulaciones de prueba</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            Borra permanentemente TODOS los candidatos marcados como prueba
            {cfg && ` (${cfg.candidatosPrueba} en este momento)`}, junto con sus mensajes,
            entrevistas, expedientes y documentos. Esta acción no se puede deshacer.
          </p>
          {resumen && (
            <div className="mt-2">
              <Aviso tono="ok">
                Se borraron {resumen.candidatos} candidato(s), {resumen.mensajes} mensaje(s),{" "}
                {resumen.entrevistas} entrevista(s), {resumen.expedientes} expediente(s) y{" "}
                {resumen.documentos} documento(s).
              </Aviso>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-bad/30 text-bad"
            onClick={() => setConfirmando(true)}
            disabled={!cfg || cfg.candidatosPrueba === 0}
          >
            <Trash2 className="h-4 w-4" /> Eliminar postulaciones de prueba
          </Button>
        </div>
      </div>

      {confirmando && (
        <ModalConfirmarBorrado
          cantidad={cfg?.candidatosPrueba ?? 0}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={confirmarBorrado}
          cargando={borrando}
        />
      )}
    </Card>
  );
}

function ModalConfirmarBorrado({
  cantidad, onCancelar, onConfirmar, cargando,
}: { cantidad: number; onCancelar: () => void; onConfirmar: () => void; cargando: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-5">
        <h3 className="font-display text-lg font-bold">¿Eliminar {cantidad} postulación(es) de prueba?</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Esta acción es permanente: se borran los candidatos y todo lo que cuelga de ellos
          (mensajes, entrevistas, expedientes, documentos). No se puede deshacer.
        </p>
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={cargando}>Cancelar</Button>
          <Button className="flex-1" onClick={onConfirmar} disabled={cargando}>
            {cargando ? "Borrando…" : "Sí, eliminar todo"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
