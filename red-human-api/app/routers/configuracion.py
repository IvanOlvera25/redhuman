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
from ..services import fraiche

router = APIRouter(prefix="/configuracion", tags=["configuracion"])

VENTANA_MIN, VENTANA_MAX = 5, 1440  # minutos: entre 5 min y 24 h


def _salida(db: Session, cuenta_id: int) -> dict:
    cfg = cfg_service.obtener(db)
    candidatos_prueba = db.query(Candidato).filter(Candidato.es_prueba.is_(True), Candidato.cuenta_id == cuenta_id).count()
    postulaciones_prueba = db.query(Postulacion).filter(Postulacion.es_prueba.is_(True), Postulacion.cuenta_id == cuenta_id).count()
    return {
        "modoPrueba": cfg.modo_prueba,
        "ambientePrueba": cfg_service.ambiente_prueba(),  # 2026-10-02: ambiente de desarrollo/demo (AMBIENTE_PRUEBA)
        "modoPruebaVentanaMin": cfg.modo_prueba_ventana_min,
        # Fase 3: recordatorios automáticos de documentos
        "recordatorioDocumentosDias": cfg.recordatorio_documentos_dias,
        "recordatorioDocumentosHora": cfg.recordatorio_documentos_hora,
        "recordatorioEntrevistaHoras": cfg.recordatorio_entrevista_horas,  # 2026-09-19
        "candidatosPrueba": candidatos_prueba,
        "postulacionesPrueba": postulaciones_prueba,
        # Fraiche (spec §8 y §14): equivalencias de la rúbrica IPV y umbral de «vacante en riesgo»
        "ipvEquivalencias": fraiche.equivalencias_de(db),
        "riesgoDiasUmbral": cfg.riesgo_dias_umbral if cfg.riesgo_dias_umbral is not None else 7,
    }


@router.get("")
def obtener(db: Session = Depends(get_db), _: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)):
    return _salida(db, cuenta.id)


class ConfiguracionIn(BaseModel):
    modo_prueba: Optional[bool] = None
    modo_prueba_ventana_min: Optional[int] = None
    recordatorio_documentos_dias: Optional[int] = None  # Fase 3: cada N días (1-30)
    recordatorio_documentos_hora: Optional[int] = None  # Fase 3: a partir de esta hora MX (0-23)
    recordatorio_entrevista_horas: Optional[int] = None  # 2026-09-19: horas antes de la entrevista (0 = apagado, máx 168)
    ipv_equivalencias: Optional[dict] = None  # Fraiche §8: {alto, medio, bajo} en puntos 0-100
    riesgo_dias_umbral: Optional[int] = None  # Fraiche §14: días antes de la fecha objetivo para «en riesgo»


@router.patch("")
def actualizar(
    datos: ConfiguracionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    cfg = cfg_service.obtener(db)
    if all(v is None for v in datos.model_dump().values()):
        raise HTTPException(400, "No se enviaron cambios.")
    if datos.ipv_equivalencias is not None:
        eq = {}
        for k in ("alto", "medio", "bajo"):
            v = datos.ipv_equivalencias.get(k)
            if v is None:
                continue
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise HTTPException(400, f"La equivalencia «{k}» debe ser un número entero.")
            if not (0 <= v <= 100):
                raise HTTPException(400, f"La equivalencia «{k}» debe estar entre 0 y 100.")
            eq[k] = v
        nueva = {**fraiche.equivalencias_de(db), **eq}
        if not (nueva["alto"] >= nueva["medio"] >= nueva["bajo"]):
            raise HTTPException(400, "Las equivalencias deben cumplir Alto ≥ Medio ≥ Bajo.")
        cfg.ipv_equivalencias = nueva
        registrar(db, u.nombre, "ipv_equivalencias_actualizadas", "sistema", "configuracion", {"equivalencias": nueva, "correo_rh": u.correo})
    if datos.riesgo_dias_umbral is not None:
        if not (0 <= datos.riesgo_dias_umbral <= 365):
            raise HTTPException(400, "El umbral de riesgo debe estar entre 0 y 365 días.")
        cfg.riesgo_dias_umbral = datos.riesgo_dias_umbral
    if datos.recordatorio_documentos_dias is not None:
        if not (1 <= datos.recordatorio_documentos_dias <= 30):
            raise HTTPException(400, "Los recordatorios de documentos deben ser cada 1 a 30 días.")
        cfg.recordatorio_documentos_dias = datos.recordatorio_documentos_dias
    if datos.recordatorio_documentos_hora is not None:
        if not (0 <= datos.recordatorio_documentos_hora <= 23):
            raise HTTPException(400, "La hora de los recordatorios debe estar entre 0 y 23.")
        cfg.recordatorio_documentos_hora = datos.recordatorio_documentos_hora
    if datos.recordatorio_entrevista_horas is not None:
        if not (0 <= datos.recordatorio_entrevista_horas <= 168):
            raise HTTPException(400, "El recordatorio de entrevista debe ser entre 0 (apagado) y 168 horas antes.")
        cfg.recordatorio_entrevista_horas = datos.recordatorio_entrevista_horas
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
