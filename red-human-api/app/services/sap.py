"""Alta en SAP SuccessFactors (Fraiche, 2026-10-05).

El alta en Colaboradores y el alta en SAP son DOS estados distintos:
- El colaborador nace en Colaboradores al confirmar el alta (routers/contratacion.alta), siempre.
- SAP: en el ambiente demo o sin conexión configurada (`SAP_API_URL` + `SAP_USUARIO`/`SAP_PASSWORD` o `SAP_TOKEN`)
  NO se envía nada → «Listo para SAP · Conexión pendiente». Con la conexión configurada se mandan los MISMOS datos
  confirmados y se guarda la respuesta; «Alta confirmada en SAP» solo cuando SAP la confirma (2xx con identificador).
Nunca se inventa un número de empleado.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from ..config import settings

log = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(20.0, connect=8.0)
ESTADOS_ENVIO = {
    "": "Por preparar",
    "conexion_pendiente": "Listo para SAP · Conexión pendiente",
    "enviado": "Enviado a SAP · sin confirmación",
    "confirmado": "Alta confirmada en SAP",
    "error": "Error al enviar a SAP",
}


def configurado() -> bool:
    from .configuracion import ambiente_prueba

    if ambiente_prueba():
        return False  # demo: nunca se envía
    return bool(settings.sap_api_url and (settings.sap_token or (settings.sap_usuario and settings.sap_password)))


def texto_estado(e) -> str:
    return ESTADOS_ENVIO.get(e.sap_envio or "", e.sap_envio or "Por preparar")


def carga(vista: dict) -> dict:
    """Los datos confirmados, planos {clave: valor} (los mismos que se ven en la pantalla)."""
    return {x["clave"]: x["valor"] for b in vista.get("bloques", []) for x in b["campos"] if x.get("valor")}


def _id_empleado(cuerpo) -> str:
    if not isinstance(cuerpo, dict):
        return ""
    d = cuerpo.get("d") if isinstance(cuerpo.get("d"), dict) else cuerpo
    for k in ("personIdExternal", "userId", "employeeId", "id"):
        if d.get(k):
            return str(d[k])[:60]
    return ""


async def enviar(e, vista: dict, actor: str) -> dict:
    """Envía (o deja en «Conexión pendiente») y registra la respuesta en el expediente. Nunca lanza."""
    ahora = datetime.now(timezone.utc)
    if not configurado():
        e.sap_envio = "conexion_pendiente"
        e.sap_respuesta = {"fecha": ahora.isoformat(), "por": actor, "detalle": "Sin envío: conexión con SAP pendiente."}
        return {"enviado": False, "estado": e.sap_envio, "texto": texto_estado(e)}
    datos = carga(vista)
    auth = None if settings.sap_token else (settings.sap_usuario, settings.sap_password)
    headers = {"Accept": "application/json"}
    if settings.sap_token:
        headers["Authorization"] = f"Bearer {settings.sap_token}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cli:
            r = await cli.post(settings.sap_api_url, json=datos, auth=auth, headers=headers)
        try:
            cuerpo = r.json()
        except ValueError:
            cuerpo = {"texto": r.text[:2000]}
        ident = _id_empleado(cuerpo) if r.is_success else ""
        e.sap_envio = "confirmado" if ident else ("enviado" if r.is_success else "error")
        e.sap_id_empleado = ident or e.sap_id_empleado or ""
        e.sap_respuesta = {"fecha": ahora.isoformat(), "por": actor, "status": r.status_code, "cuerpo": cuerpo}
    except httpx.HTTPError as ex:
        log.warning("[SAP] envío fallido: %s", ex)
        e.sap_envio = "error"
        e.sap_respuesta = {"fecha": ahora.isoformat(), "por": actor,
                           "detalle": "SAP no respondió a tiempo" if isinstance(ex, httpx.TimeoutException) else "No se pudo conectar con SAP"}
    e.sap_enviado_en = ahora
    return {"enviado": e.sap_envio in ("enviado", "confirmado"), "estado": e.sap_envio, "texto": texto_estado(e)}
