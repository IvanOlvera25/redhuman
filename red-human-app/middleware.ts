import { NextResponse, type NextRequest } from "next/server";

/* ============================================================
   Guardia de rutas del panel.

   Solo comprueba que exista la cookie de sesión, para evitar el parpadeo de
   entrar al dashboard y salir disparado. La validación de verdad la hace la
   API en cada petición: sin sesión válida, todo responde 401.
   ============================================================ */

const COOKIE = "rh_sesion";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const tieneSesion = Boolean(request.cookies.get(COOKIE)?.value);

  // Ya con sesión, /login no tiene caso
  if (pathname === "/login" && tieneSesion) {
    const destino = request.nextUrl.searchParams.get("next") || "/dashboard";
    return NextResponse.redirect(new URL(destino, request.url));
  }

  if (pathname.startsWith("/dashboard") && !tieneSesion) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // /aplicar/* y /entrevista/* quedan fuera a propósito: son las páginas del candidato
  matcher: ["/dashboard/:path*", "/login"],
};
