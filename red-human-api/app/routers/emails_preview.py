"""Vistas previas de los correos corporativos (2026-09-18) — para revisar y aprobar el diseño en el
navegador con datos de prueba, sin enviar nada:

    GET /api/emails/preview/entrevistador
    GET /api/emails/preview/candidato

Sin sesión (solo datos ficticios). `?modalidad=Presencial|Llamada|Videollamada` cambia la variante del
candidato; `?json=1` regresa el asunto y los datos usados."""

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, JSONResponse

from ..services import plantillas_correo as pc

router = APIRouter(prefix="/api/emails/preview", tags=["emails-preview"])


def _mock(modalidad: str) -> dict:
    d = dict(pc.MOCK_ENTREVISTA)
    if modalidad == "Presencial":
        d.update({"modalidad": "Presencial", "liga_conexion": "", "detalle_conexion": "Ubicación: Av. Reforma 222, piso 8, CDMX", "ubicacion": "Av. Reforma 222, piso 8, CDMX"})
    elif modalidad == "Llamada":
        d.update({"modalidad": "Llamada", "liga_conexion": "", "detalle_conexion": "Te contactaremos al 55 1234 5678", "telefono_contacto": "55 1234 5678"})
    return d


@router.get("/entrevistador", response_class=HTMLResponse)
def preview_entrevistador(modalidad: str = Query("Videollamada"), json: int = Query(0)):
    d = _mock(modalidad)
    asunto, html = pc.html_entrevistador(d)
    if json:
        return JSONResponse({"asunto": asunto, "datos": d, "parametros_meta": [d["entrevistador"], d["candidato"], d["vacante"], d["fecha"], d["hora"], d["liga_expediente"]]})
    return HTMLResponse(html)


@router.get("/candidato", response_class=HTMLResponse)
def preview_candidato(modalidad: str = Query("Videollamada"), json: int = Query(0)):
    d = _mock(modalidad)
    asunto, html = pc.html_candidato(d)
    if json:
        return JSONResponse({"asunto": asunto, "datos": d})
    return HTMLResponse(html)
