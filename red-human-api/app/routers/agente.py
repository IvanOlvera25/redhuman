"""Fase F — agente global "Pregunta a Red Human" (punto 29).

Solo dos endpoints: `/preguntar` (lee y, si hace falta, PROPONE una acción — nunca la
ejecuta) y `/ejecutar` (ejecuta una acción ya confirmada por el usuario en el panel). Toda la
lógica real vive en `services/agente.py` — este router únicamente resuelve sesión/Cuenta y
delega, igual que el resto de los routers del sistema.
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual
from ..models import Cuenta, Usuario
from ..services import agente

router = APIRouter(prefix="/agente", tags=["agente"])


class TurnoIn(BaseModel):
    rol: Literal["user", "assistant"]
    texto: str


class EntidadContextoIn(BaseModel):
    tipo: Literal["candidato", "vacante"]
    codigo: str


class ContextoIn(BaseModel):
    pantalla: str = ""
    entidad: Optional[EntidadContextoIn] = None


class PreguntarIn(BaseModel):
    mensaje: str
    # El backend no persiste conversación (Q6): el frontend manda los últimos turnos cada vez.
    historial: List[TurnoIn] = []
    contexto: Optional[ContextoIn] = None
    alcance: Literal["cuenta", "todas_mis_cuentas"] = "cuenta"


@router.post("/preguntar")
async def preguntar(
    datos: PreguntarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    resultado = await agente.responder(
        db, u, cuenta,
        mensaje=datos.mensaje,
        historial=[{"rol": t.rol, "texto": t.texto} for t in datos.historial],
        contexto=datos.contexto.model_dump() if datos.contexto else None,
        alcance=datos.alcance,
    )
    return resultado


class EjecutarIn(BaseModel):
    tool: str
    argumentos: dict = {}


@router.post("/ejecutar")
async def ejecutar(
    datos: EjecutarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    return await agente.ejecutar_accion(db, u, cuenta, datos.tool, datos.argumentos)


@router.get("/uso")
def uso(db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Para pintar '{n}/{limite} preguntas hoy' en el panel sin gastar una pregunta."""
    return agente.verificar_uso(db, u)
