"""Módulo 2 · Contratación e integración — liga pública para que el candidato suba sus
documentos (Lote 4).

Contraparte liviana de `entrevistas.py`/`capacitacion.py`, mismo espíritu que
`entrevista_humana.py`: sin sesión, el token es la credencial. Diferencia importante frente al
de `EntrevistaHumana` (un solo uso): este token NO se invalida tras la primera subida — el
candidato puede volver varias veces hasta completar todos los documentos obligatorios. Solo se
cierra cuando el expediente llega a `estado == "alta"` (ver `subir_documento_interno` en
`contratacion.py`, que ya rechaza cambios en ese estado — mismo guard para RH y para el
candidato, sin excepción de Modo Prueba).
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Expediente
from .contratacion import subir_documento_interno

router = APIRouter(prefix="/expedientes", tags=["expedientes-publico"])


def _por_token(db: Session, token: str) -> Expediente:
    e = db.query(Expediente).filter(Expediente.token == token).first()
    if not e:
        raise HTTPException(404, "Esta liga no es válida.")
    return e


@router.get("/publica/{token}")
def publica(token: str, db: Session = Depends(get_db)):
    e = _por_token(db, token)
    return {
        "candidato": e.candidato.nombre if e.candidato else "",
        "puesto": e.puesto,
        "estado": e.estado,
        "documentos": [
            {"tipo": d.tipo, "estado": d.estado, "obligatorio": d.obligatorio} for d in e.documentos
        ],
    }


@router.post("/publica/{token}/documentos")
async def subir(
    token: str, tipo: str = Form(...), archivo: UploadFile = File(...), db: Session = Depends(get_db)
):
    e = _por_token(db, token)
    return await subir_documento_interno(db, e, tipo, archivo, subido_por="candidato")
