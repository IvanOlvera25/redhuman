"""Autenticación de las personas de RH: contraseñas, sesiones y bloqueo por intentos.

No usa dependencias externas: `hashlib.scrypt` viene en la stdlib y es memory-hard,
así que no hace falta compilar bcrypt en el servidor.

Las sesiones viven en la base (tabla `sesiones`) en vez de ser JWT, para poder
revocarlas al instante cuando alguien cierra sesión o se da de baja a un usuario.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ..models import Sesion, Usuario, ahora

# --- parámetros de scrypt (RFC 7914). n=2^14 ≈ 16 MB por verificación ---
_N, _R, _P, _LEN = 2**14, 8, 1, 32

COOKIE = "rh_sesion"
DURACION_SESION = timedelta(hours=12)  # jornada laboral; después hay que volver a entrar
MAX_INTENTOS = 5
BLOQUEO = timedelta(minutes=15)


# ------------------------------------------------------------
# Contraseñas
# ------------------------------------------------------------


def hashear(password: str) -> str:
    """→ 'scrypt$<n>$<r>$<p>$<sal_hex>$<hash_hex>'"""
    sal = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=_LEN)
    return f"scrypt${_N}${_R}${_P}${sal.hex()}${dk.hex()}"


def verificar(password: str, guardado: str) -> bool:
    """Comparación en tiempo constante; nunca lanza, un hash corrupto es simplemente inválido."""
    try:
        etiqueta, n, r, p, sal_hex, hash_hex = guardado.split("$")
        if etiqueta != "scrypt":
            return False
        dk = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(sal_hex), n=int(n), r=int(r), p=int(p), dklen=len(hash_hex) // 2
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


def validar_fortaleza(password: str) -> Optional[str]:
    """Regresa el motivo del rechazo, o None si la contraseña es aceptable."""
    if len(password) < 10:
        return "La contraseña debe tener al menos 10 caracteres."
    if password.isdigit() or password.isalpha():
        return "Combina letras y números (y de preferencia algún símbolo)."
    if password.lower() in {"contrasena", "password", "redhuman1", "12345678910"}:
        return "Esa contraseña es demasiado común."
    return None


# ------------------------------------------------------------
# Sesiones
# ------------------------------------------------------------


def _hash_token(token: str) -> str:
    """En la base se guarda solo el sha256: si se filtra la tabla, los tokens no sirven."""
    return hashlib.sha256(token.encode()).hexdigest()


def crear_sesion(db: Session, usuario: Usuario, ip: str = "", agente: str = "") -> Tuple[str, Sesion]:
    token = secrets.token_urlsafe(32)
    s = Sesion(
        token_hash=_hash_token(token),
        usuario_id=usuario.id,
        expira_en=ahora() + DURACION_SESION,
        ip=ip[:60],
        agente=agente[:255],
    )
    db.add(s)
    db.flush()
    return token, s


def sesion_valida(db: Session, token: Optional[str]) -> Optional[Usuario]:
    """Regresa el usuario si el token corresponde a una sesión vigente y a una cuenta activa."""
    if not token:
        return None
    s = db.query(Sesion).filter(Sesion.token_hash == _hash_token(token)).first()
    if not s:
        return None

    expira = s.expira_en if s.expira_en.tzinfo else s.expira_en.replace(tzinfo=timezone.utc)
    if expira <= ahora():
        db.delete(s)
        db.commit()
        return None

    u = s.usuario
    if not u or not u.activo:
        return None
    return u


def cerrar_sesion(db: Session, token: Optional[str]) -> bool:
    if not token:
        return False
    s = db.query(Sesion).filter(Sesion.token_hash == _hash_token(token)).first()
    if not s:
        return False
    db.delete(s)
    return True


def cerrar_todas(db: Session, usuario_id: int) -> int:
    """Revoca todas las sesiones de un usuario (cambio de contraseña o baja)."""
    n = db.query(Sesion).filter(Sesion.usuario_id == usuario_id).delete()
    return n


def purgar_expiradas(db: Session) -> int:
    return db.query(Sesion).filter(Sesion.expira_en <= ahora()).delete()


# ------------------------------------------------------------
# Intentos fallidos
# ------------------------------------------------------------


def registrar_fallo(db: Session, u: Usuario) -> None:
    u.intentos_fallidos = (u.intentos_fallidos or 0) + 1
    if u.intentos_fallidos >= MAX_INTENTOS:
        u.bloqueado_hasta = ahora() + BLOQUEO
        u.intentos_fallidos = 0


def registrar_exito(db: Session, u: Usuario) -> None:
    u.intentos_fallidos = 0
    u.bloqueado_hasta = None
    u.ultimo_acceso = ahora()


def minutos_restantes(u: Usuario) -> int:
    if not u.bloqueado_hasta:
        return 0
    limite = u.bloqueado_hasta
    if limite.tzinfo is None:
        limite = limite.replace(tzinfo=timezone.utc)
    return max(1, int((limite - ahora()).total_seconds() // 60) + 1)
