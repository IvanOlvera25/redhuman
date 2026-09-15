"""Configuración global del sistema — Modo Prueba (solo admin), Punto 13.

ConfiguracionSistema es una fila única global (no por Cuenta); solo los conteos de registros de
prueba se acotan a la Cuenta de quien consulta.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_admin
from ..models import Candidato, Cuenta, Postulacion, Usuario, registrar
from ..services import configuracion as cfg_service

router = APIRouter(prefix="/configuracion", tags=["configuracion"])

VENTANA_MIN, VENTANA_MAX = 5, 1440  # minutos: entre 5 min y 24 h


def _salida(db: Session, cuenta_id: int) -> dict:
    cfg = cfg_service.obtener(db)
    candidatos_prueba = db.query(Candidato).filter(Candidato.es_prueba.is_(True), Candidato.cuenta_id == cuenta_id).count()
    postulaciones_prueba = db.query(Postulacion).filter(Postulacion.es_prueba.is_(True), Postulacion.cuenta_id == cuenta_id).count()
    return {
        "modoPrueba": cfg.modo_prueba,
        "modoPruebaVentanaMin": cfg.modo_prueba_ventana_min,
        # Fase 3: recordatorios automáticos de documentos
        "recordatorioDocumentosDias": cfg.recordatorio_documentos_dias,
        "recordatorioDocumentosHora": cfg.recordatorio_documentos_hora,
        "candidatosPrueba": candidatos_prueba,
        "postulacionesPrueba": postulaciones_prueba,
    }


@router.get("")
def obtener(db: Session = Depends(get_db), _: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)):
    return _salida(db, cuenta.id)


class ConfiguracionIn(BaseModel):
    modo_prueba: Optional[bool] = None
    modo_prueba_ventana_min: Optional[int] = None
    recordatorio_documentos_dias: Optional[int] = None  # Fase 3: cada N días (1-30)
    recordatorio_documentos_hora: Optional[int] = None  # Fase 3: a partir de esta hora MX (0-23)


@router.patch("")
def actualizar(
    datos: ConfiguracionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    cfg = cfg_service.obtener(db)
    if all(v is None for v in datos.model_dump().values()):
        raise HTTPException(400, "No se enviaron cambios.")
    if datos.recordatorio_documentos_dias is not None:
        if not (1 <= datos.recordatorio_documentos_dias <= 30):
            raise HTTPException(400, "Los recordatorios de documentos deben ser cada 1 a 30 días.")
        cfg.recordatorio_documentos_dias = datos.recordatorio_documentos_dias
    if datos.recordatorio_documentos_hora is not None:
        if not (0 <= datos.recordatorio_documentos_hora <= 23):
            raise HTTPException(400, "La hora de los recordatorios debe estar entre 0 y 23.")
        cfg.recordatorio_documentos_hora = datos.recordatorio_documentos_hora
    if datos.modo_prueba is not None and datos.modo_prueba != cfg.modo_prueba:
        cfg.modo_prueba = datos.modo_prueba
        registrar(
            db, u.nombre, "modo_prueba_activado" if datos.modo_prueba else "modo_prueba_desactivado",
            "sistema", "configuracion", {"correo_rh": u.correo},
        )
    if datos.modo_prueba_ventana_min is not None:
        if not (VENTANA_MIN <= datos.modo_prueba_ventana_min <= VENTANA_MAX):
            raise HTTPException(400, f"La ventana debe estar entre {VENTANA_MIN} y {VENTANA_MAX} minutos.")
        if datos.modo_prueba_ventana_min != cfg.modo_prueba_ventana_min:
            registrar(
                db, u.nombre, "modo_prueba_ventana_actualizada", "sistema", "configuracion",
                {"de": cfg.modo_prueba_ventana_min, "a": datos.modo_prueba_ventana_min, "correo_rh": u.correo},
            )
            cfg.modo_prueba_ventana_min = datos.modo_prueba_ventana_min
    db.commit()
    return _salida(db, cuenta.id)
