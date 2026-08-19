"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchYo, logout as apiLogout, type UsuarioRH } from "@/lib/api";

/* ============================================================
   Sesión de la persona de RH.

   El servidor es quien manda: la cookie es httpOnly y toda decisión se firma
   allá con el usuario de la sesión. Este contexto solo sirve para pintar la
   interfaz y esconder lo que el rol no puede hacer.
   ============================================================ */

interface Contexto {
  usuario: UsuarioRH | null;
  cargando: boolean;
  refrescar: () => Promise<void>;
  salir: () => Promise<void>;
}

const SesionCtx = createContext<Contexto>({
  usuario: null,
  cargando: true,
  refrescar: async () => {},
  salir: async () => {},
});

export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioRH | null>(null);
  const [cargando, setCargando] = useState(true);
  const router = useRouter();

  const refrescar = useCallback(async () => {
    const u = await fetchYo();
    setUsuario(u);
    setCargando(false);
  }, []);

  useEffect(() => {
    refrescar();
  }, [refrescar]);

  const salir = useCallback(async () => {
    await apiLogout();
    setUsuario(null);
    router.push("/login");
  }, [router]);

  return <SesionCtx.Provider value={{ usuario, cargando, refrescar, salir }}>{children}</SesionCtx.Provider>;
}

export function useSesion() {
  return useContext(SesionCtx);
}

/** Nombre con el que se firma en pantalla; el servidor usa el suyo propio. */
export function useNombreRH() {
  return useSesion().usuario?.nombre ?? "";
}

/** `false` para el rol de solo lectura: la UI esconde los botones que la API rechazaría. */
export function usePuedeDecidir() {
  return useSesion().usuario?.puedeDecidir ?? false;
}
