"""Cifrado de datos sensibles en la base (Fraiche spec §10, 2026-09-29): el dictamen médico y su detalle se guardan
cifrados con Fernet (AES) y solo se descifran para el rol autorizado (`Usuario.puede_ver_informe_medico`).

La clave se deriva de `DATOS_SENSIBLES_CLAVE` (variable del servidor); si no está, de `META_APP_SECRET` o de
`TEAMS_CLIENT_SECRET` (mismo patrón que services/teams.py). Rotar la clave obliga a recapturar lo cifrado.
Los textos cifrados llevan el prefijo `enc1:` para reconocerlos; un texto sin prefijo se devuelve tal cual
(registros previos a este cambio).
"""

import base64
import hashlib

from ..config import settings

PREFIJO = "enc1:"


def _secreto() -> str:
    return settings.datos_sensibles_clave or settings.meta_app_secret or settings.teams_client_secret or "red-human-demo-sin-secreto"


def _fernet():
    from cryptography.fernet import Fernet

    clave = base64.urlsafe_b64encode(hashlib.sha256(_secreto().encode()).digest())
    return Fernet(clave)


def cifrar(texto: str) -> str:
    """'' → '' ; texto → 'enc1:<token>'. Idempotente (no vuelve a cifrar lo ya cifrado)."""
    if not texto:
        return ""
    if texto.startswith(PREFIJO):
        return texto
    return PREFIJO + _fernet().encrypt(texto.encode("utf-8")).decode()


def descifrar(texto: str) -> str:
    """'enc1:…' → texto plano; sin prefijo → tal cual. Si la clave cambió, regresa un aviso en vez de tronar."""
    if not texto or not texto.startswith(PREFIJO):
        return texto or ""
    from cryptography.fernet import InvalidToken

    try:
        return _fernet().decrypt(texto[len(PREFIJO):].encode()).decode("utf-8")
    except InvalidToken:
        return "[dato cifrado con otra clave del servidor: no se puede leer]"


def esta_cifrado(texto: str) -> bool:
    return bool(texto) and texto.startswith(PREFIJO)
