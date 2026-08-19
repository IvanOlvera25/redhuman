"""Dependencias de autorización.

`usuario_actual` es la única fuente de verdad sobre quién está operando: los
endpoints ya NO aceptan del cliente el nombre de quien decide, porque eso
permitiría firmar la bitácora a nombre de otra persona.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .models import Usuario
from .services import auth


def _token(request: Request) -> Optional[str]:
    """La cookie es la vía normal; el Bearer existe para scripts e integraciones."""
    cookie = request.cookies.get(auth.COOKIE)
    if cookie:
        return cookie
    cabecera = request.headers.get("authorization", "")
    if cabecera.lower().startswith("bearer "):
        return cabecera[7:].strip()
    return None


def usuario_opcional(request: Request, db: Session = Depends(get_db)) -> Optional[Usuario]:
    return auth.sesion_valida(db, _token(request))


def usuario_actual(request: Request, db: Session = Depends(get_db)) -> Usuario:
    u = auth.sesion_valida(db, _token(request))
    if not u:
        raise HTTPException(401, "Tu sesión expiró o no has iniciado sesión.", headers={"WWW-Authenticate": "Cookie"})
    return u


def usuario_decisor(u: Usuario = Depends(usuario_actual)) -> Usuario:
    """Para acciones que firman la bitácora: el rol 'lectura' no puede."""
    if not u.puede_decidir():
        raise HTTPException(403, "Tu perfil es de solo lectura; pide a un administrador que te cambie el rol.")
    return u


def usuario_admin(u: Usuario = Depends(usuario_actual)) -> Usuario:
    if u.rol != "admin":
        raise HTTPException(403, "Solo un administrador puede hacer esto.")
    return u
