"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchConfiguracion, fetchYo, logout as apiLogout, type UsuarioRH } from "@/lib/api";

/* ============================================================
   Sesión de la persona de RH.

   El servidor es quien manda: la cookie es httpOnly y toda decisión se firma
   allá con el usuario de la sesión. Este contexto solo sirve para pintar la
   interfaz y esconder lo que el rol no puede hacer.

   También carga Modo Prueba una sola vez aquí (en vez de que cada componente que lo necesite
   haga su propio GET /configuracion) — lo usan varios sitios a la vez cuando el modal de un
   candidato está abierto (Lote 4: botón "Continuar de todos modos").
   ============================================================ */

interface Contexto {
  usuario: UsuarioRH | null;
  cargando: boolean;
  modoPrueba: boolean;
  refrescar: () => Promise<void>;
  salir: () => Promise<void>;
}

const SesionCtx = createContext<Contexto>({
  usuario: null,
  cargando: true,
  modoPrueba: false,
  refrescar: async () => {},
  salir: async () => {},
});

export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioRH | null>(null);
  const [cargando, setCargando] = useState(true);
  const [modoPrueba, setModoPrueba] = useState(false);
  const router = useRouter();

  const refrescar = useCallback(async () => {
    const u = await fetchYo();
    setUsuario(u);
    setCargando(false);
  }, []);

  useEffect(() => {
    refrescar();
  }, [refrescar]);

  useEffect(() => {
    fetchConfiguracion().then((cfg) => {
      if (cfg) setModoPrueba(cfg.modoPrueba);
    });
  }, []);

  const salir = useCallback(async () => {
    await apiLogout();
    setUsuario(null);
    router.push("/login");
  }, [router]);

  return (
    <SesionCtx.Provider value={{ usuario, cargando, modoPrueba, refrescar, salir }}>{children}</SesionCtx.Provider>
  );
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

/** `true` solo para admin — el servidor es quien realmente lo exige (Depends(usuario_admin)). */
export function useEsAdmin() {
  return useSesion().usuario?.rol === "admin";
}

/** Modo Prueba (Lote 4) — activo, ciertos bloqueos de estado pueden saltarse con
 * `forzarPrueba` (ver moverEtapaCandidato/autorizarAlta/etc. en lib/api.ts); el flag es inerte
 * si esto es `false`, el servidor nunca lo obedece fuera de Modo Prueba. */
export function useModoPrueba() {
  return useSesion().modoPrueba;
}
