"""Psicométricas.mx — cliente de su API (2026-09-29). Referencia: https://psicometricas.mx/api

* Base https://admin.psicometricas.mx/api/ · todas las llamadas llevan `Token` y `Password` (form-encoded) por HTTPS.
  Llaves SOLO por entorno (PSICOMETRICAS_TOKEN + PSICOMETRICAS_PASSWORD, o PSICOMETRICAS_USUARIO como Password).
  Sin ellas `configurado()` es False y el modo Integrada sigue simulado a mano (nunca rompe el flujo).
* `agregaCandidato` (Candidate, Email, Vacancy, Tests «1,2», Lang Mx) → `clave`. Psicométricas manda al candidato
  su liga por correo; su API NO regresa esa liga (se muestra la clave; `PSICOMETRICAS_URL_CANDIDATO` es opcional).
* `consultaCandidato` (Clave) → estatus / fecha_fin; `consultaResultado` (Clave, Prueba, Pdf) → JSON o PDF binario.
* Su webhook (`termina_prueba` / `termina_practica`) NO trae firma: NUNCA se confía en él solo — se confirma con
  `consultaCandidato` (fecha_fin) antes de guardar nada.
"""

from typing import List, Optional, Union

import httpx

from ..config import settings

ERRORES = {
    "1001": "Psicométricas.mx rechazó el Token/Password (1001).",
    "1002": "La cuenta de Psicométricas.mx no tiene un paquete activo (1002).",
    "1003": "El paquete de Psicométricas.mx no es compatible con la API (1003).",
    "1004": "Faltan campos obligatorios para Psicométricas.mx (1004).",
}


class PsicometricasError(Exception):
    def __init__(self, mensaje: str, status: Optional[int] = None):
        super().__init__(mensaje)
        self.status = status


def _sin_conexion(ex: httpx.HTTPError) -> PsicometricasError:
    if isinstance(ex, httpx.TimeoutException):
        return PsicometricasError("Psicométricas.mx no respondió a tiempo. Intenta de nuevo en unos minutos.", 504)
    return PsicometricasError(f"No se pudo conectar con Psicométricas.mx: {ex}")


def _password() -> str:
    return settings.psicometricas_password or settings.psicometricas_usuario


def configurado() -> bool:
    return bool(settings.psicometricas_token and _password())


def es_psicometricas(proveedor: str) -> bool:
    p = (proveedor or "").lower().replace(" ", "").replace("é", "e")
    return "psicometricas" in p


def _cred() -> dict:
    if not configurado():
        raise PsicometricasError("Psicométricas.mx no está configurado (PSICOMETRICAS_TOKEN / PSICOMETRICAS_PASSWORD).", 503)
    return {"Token": settings.psicometricas_token, "Password": _password()}


def _url(ruta: str) -> str:
    return f"{settings.psicometricas_base_url.rstrip('/')}/{ruta}"


def _revisar(r: httpx.Response) -> Union[dict, list]:
    try:
        datos = r.json()
    except ValueError:
        raise PsicometricasError(f"Psicométricas.mx respondió {r.status_code} sin JSON.", r.status_code)
    codigo = str((datos or {}).get("code") or (datos or {}).get("codigo") or "") if isinstance(datos, dict) else ""
    if r.status_code >= 400 or codigo in ERRORES:
        msg = ERRORES.get(codigo) or (datos.get("msg") if isinstance(datos, dict) else "") or f"HTTP {r.status_code}"
        raise PsicometricasError(str(msg), r.status_code)
    return datos


def tests_de(id_proveedor: str) -> str:
    """«1, 7» → «1,7» (IDs numéricos de sus pruebas: 1 Cleaver, 2 Kostick, 7 Terman, 10 16PF…)."""
    ids = [x.strip() for x in (id_proveedor or "").split(",") if x.strip()]
    if not ids or not all(x.isdigit() for x in ids):
        raise PsicometricasError("El «identificador en el proveedor» debe ser el ID numérico de la prueba en Psicométricas.mx (p. ej. 1 = Cleaver, 7 = Terman; varios: 1,7).", 400)
    return ",".join(ids)


def agregar_candidato(nombre: str, correo: str, vacante: str, tests: str, lang: str = "Mx") -> str:
    try:
        r = httpx.post(_url("agregaCandidato"), data={**_cred(), "Candidate": nombre, "Email": correo, "Vacancy": vacante, "Tests": tests, "Lang": lang}, timeout=30)
    except httpx.HTTPError as ex:
        raise _sin_conexion(ex)
    datos = _revisar(r)
    clave = str((datos or {}).get("clave") or "") if isinstance(datos, dict) else ""
    if not clave:
        raise PsicometricasError(f"Psicométricas.mx no regresó la clave del candidato: {str(datos)[:200]}")
    return clave


def consultar_candidato(clave: str) -> List[dict]:
    try:
        r = httpx.get(_url("consultaCandidato"), params={**_cred(), "Clave": clave}, timeout=30)
    except httpx.HTTPError as ex:
        raise _sin_conexion(ex)
    datos = _revisar(r)
    filas = datos if isinstance(datos, list) else [datos]
    return [f for f in filas if isinstance(f, dict) and str(f.get("clave") or clave) == clave]


def terminado(filas: List[dict]) -> bool:
    """Todas sus pruebas con `fecha_fin` (campo documentado de consultaCandidato)."""
    return bool(filas) and all(f.get("fecha_fin") for f in filas)


def resultado_json(clave: str) -> Union[dict, list]:
    try:
        r = httpx.get(_url("consultaResultado"), params={**_cred(), "Clave": clave, "Pdf": "false"}, timeout=60)
    except httpx.HTTPError as ex:
        raise _sin_conexion(ex)
    return _revisar(r)


def resultado_pdf(clave: str) -> Optional[bytes]:
    try:
        r = httpx.get(_url("consultaResultado"), params={**_cred(), "Clave": clave, "Pdf": "true"}, timeout=60)
    except httpx.HTTPError as ex:
        raise _sin_conexion(ex)
    if r.status_code >= 400:
        raise PsicometricasError(f"Psicométricas.mx respondió {r.status_code} al pedir el PDF.", r.status_code)
    return r.content if r.content.startswith(b"%PDF") else None


def url_candidato(clave: str) -> Optional[str]:
    plantilla = settings.psicometricas_url_candidato
    return plantilla.replace("{clave}", clave) if plantilla and clave else None
