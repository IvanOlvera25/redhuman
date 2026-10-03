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
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Expediente
from ..services.pdf import pdf_carta_intencion
from .contratacion import _datos_carta_intencion, subir_documento_interno

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
            if d.estado != "no_aplica" and not d.interno  # Onboarding v2: ni «No aplica» ni documentos internos de RH
        ],
        # 2026-09-19: la carta de intención se descarga desde la misma liga (la comparte RH por WhatsApp)
        "cartaDisponible": bool(e.puesto and e.sueldo),
        # 2026-10-02 (Fraiche §13): el contrato (borrador para revisión) también se descarga desde aquí
        "contratoDisponible": bool(e.puesto and e.sueldo and e.tipo_contratacion and e.fecha_ingreso and e.condiciones_guardadas_en),
    }


@router.get("/publica/{token}/contrato")
def contrato_publico(token: str, db: Session = Depends(get_db)):
    from ..services.pdf import pdf_contrato

    e = _por_token(db, token)
    if not (e.puesto and e.sueldo and e.tipo_contratacion and e.fecha_ingreso and e.condiciones_guardadas_en):
        raise HTTPException(404, "Tu contrato todavía no está listo.")
    try:
        pdf = pdf_contrato({**_datos_carta_intencion(e), "borrador": True})
    except Exception as ex:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo generar el contrato: {ex}")
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="contrato.pdf"'})


@router.get("/publica/{token}/carta-intencion")
def carta_publica(token: str, db: Session = Depends(get_db)):
    """PDF de la carta de intención para el candidato (la liga es la credencial)."""
    e = _por_token(db, token)
    if not (e.puesto and e.sueldo):
        raise HTTPException(404, "Tu carta todavía no está lista.")
    try:
        pdf = pdf_carta_intencion(_datos_carta_intencion(e))
    except Exception as ex:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo generar la carta: {ex}")
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="carta-intencion.pdf"'})


@router.post("/publica/{token}/documentos")
async def subir(
    token: str, tipo: str = Form(...), archivo: UploadFile = File(...), db: Session = Depends(get_db)
):
    e = _por_token(db, token)
    return await subir_documento_interno(db, e, tipo, archivo, subido_por="candidato")
