"""Métricas que cruzan el Módulo 1 (reclutamiento) y el Módulo 2 (contratación).

Es la vista que demuestra que ambos módulos son un solo flujo: de candidato
captado a colaborador dado de alta, con el embudo real de la base.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..deps import cuenta_actual, usuario_actual
from ..database import get_db
from ..models import ETAPAS_CANDIDATO, Candidato, Cuenta, Entrevista, Expediente, Postulacion, Vacante

router = APIRouter(prefix="/metricas", tags=["metricas"], dependencies=[Depends(usuario_actual)])


def _postulaciones(db: Session, cuenta_id: int):
    """Base de todo conteo de este módulo (Fase 2: se cuentan POSTULACIONES, no personas) —
    nunca cuenta postulaciones de Modo Prueba."""
    return db.query(Postulacion).filter(Postulacion.es_prueba.is_(False), Postulacion.cuenta_id == cuenta_id)


@router.get("/pipeline")
def pipeline(db: Session = Depends(get_db), cuenta: Cuenta = Depends(cuenta_actual)):
    """Embudo de punta a punta: captación → prefiltro → entrevista → expediente → alta."""
    # Fase 2: el embudo cuenta POSTULACIONES (una persona con 2 vacantes son 2 en el embudo).
    total_candidatos = _postulaciones(db, cuenta.id).count()
    por_etapa = dict(
        _postulaciones(db, cuenta.id).with_entities(Postulacion.etapa, func.count(Postulacion.id)).group_by(Postulacion.etapa).all()
    )
    por_estado = dict(
        _postulaciones(db, cuenta.id).with_entities(Postulacion.estado, func.count(Postulacion.id)).group_by(Postulacion.estado).all()
    )
    # "por fuente" sigue siendo la fuente de la PERSONA (Formulario/WhatsApp/OCC/...), que es lo
    # que el frontend grafica; se cuenta por postulación.
    por_fuente = dict(
        _postulaciones(db, cuenta.id)
        .join(Candidato, Postulacion.candidato_id == Candidato.id)
        .with_entities(Candidato.fuente, func.count(Postulacion.id))
        .group_by(Candidato.fuente)
        .all()
    )
    prefiltrados = _postulaciones(db, cuenta.id).filter(Postulacion.prefiltro_completo.is_(True)).count()
    entrevistas_evaluadas = (
        db.query(Entrevista)
        .join(Candidato, Entrevista.candidato_id == Candidato.id)
        .filter(Entrevista.estado == "evaluada", Candidato.cuenta_id == cuenta.id)
        .count()
    )
    expedientes = (
        db.query(Expediente)
        .join(Candidato, Expediente.candidato_id == Candidato.id)
        .filter(Candidato.cuenta_id == cuenta.id)
        .all()
    )
    altas = [e for e in expedientes if e.estado == "alta"]

    embudo = [
        {"etapa": "Candidatos", "valor": total_candidatos},
        {"etapa": "Prefiltro IA", "valor": prefiltrados},
        {"etapa": "Entrevista", "valor": entrevistas_evaluadas},
        {"etapa": "Expediente", "valor": len(expedientes)},
        {"etapa": "Alta", "valor": len(altas)},
    ]
    base = embudo[0]["valor"] or 1
    for paso in embudo:
        paso["pct"] = round(paso["valor"] / base * 100)

    hace_7d = datetime.now(timezone.utc) - timedelta(days=7)
    return {
        "vacantes": {
            "total": db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id).count(),
            "publicadas": db.query(Vacante).filter(Vacante.estado == "Publicada", Vacante.cuenta_id == cuenta.id).count(),
            "borradores": db.query(Vacante).filter(Vacante.estado == "Borrador", Vacante.cuenta_id == cuenta.id).count(),
        },
        "candidatos": {
            "total": total_candidatos,
            "nuevos_7d": _postulaciones(db, cuenta.id).filter(Postulacion.creado_en >= hace_7d).count(),
            "por_etapa": {e: por_etapa.get(e, 0) for e in ETAPAS_CANDIDATO},
            "por_estado": por_estado,
            "por_fuente": por_fuente,
            "sin_consentimiento": _postulaciones(db, cuenta.id).filter(Postulacion.consentimiento.is_(False)).count(),
        },
        "contratacion": {
            "expedientes": len(expedientes),
            "en_integracion": sum(1 for e in expedientes if e.estado == "integracion"),
            "listos_para_alta": sum(1 for e in expedientes if e.progreso == 100 and e.estado != "alta"),
            "altas": len(altas),
            "documentos_pendientes": sum(len(e.pendientes) for e in expedientes),
            "documentos_por_revisar": sum(len(e.por_revisar) for e in expedientes),
        },
        "embudo": embudo,
        # cuellos de botella accionables para RH, con la liga al módulo que los resuelve
        "acciones": _acciones(db, expedientes, cuenta.id),
    }


def _acciones(db: Session, expedientes, cuenta_id: int) -> list:
    salida = []

    por_decidir = _postulaciones(db, cuenta_id).filter(
        Postulacion.activa.is_(True), Postulacion.prefiltro_completo.is_(True),
        Postulacion.etapa == "Prefiltro", Postulacion.estado != "no_cumple",
    ).count()
    if por_decidir:
        salida.append({
            "modulo": 1,
            "tipo": "decision_pendiente",
            "cantidad": por_decidir,
            "texto": f"{por_decidir} candidato(s) prefiltrados esperan decisión de RH.",
            "ruta": "/dashboard/candidatos",
        })

    sin_consentimiento = _postulaciones(db, cuenta_id).filter(
        Postulacion.activa.is_(True), Postulacion.consentimiento.is_(False), Postulacion.etapa != "Prefiltro"
    ).count()
    if sin_consentimiento:
        salida.append({
            "modulo": 1,
            "tipo": "consentimiento",
            "cantidad": sin_consentimiento,
            "texto": f"{sin_consentimiento} candidato(s) avanzados sin consentimiento registrado (LFPDPPP).",
            "ruta": "/dashboard/candidatos",
        })

    por_revisar = sum(len(e.por_revisar) for e in expedientes)
    if por_revisar:
        salida.append({
            "modulo": 2,
            "tipo": "documentos_revision",
            "cantidad": por_revisar,
            "texto": f"{por_revisar} documento(s) marcados por la IA para revisión humana.",
            "ruta": "/dashboard/onboarding",
        })

    listos = [e for e in expedientes if e.progreso == 100 and e.estado != "alta"]
    if listos:
        salida.append({
            "modulo": 2,
            "tipo": "alta_pendiente",
            "cantidad": len(listos),
            "texto": f"{len(listos)} expediente(s) completos esperan autorización de alta.",
            "ruta": "/dashboard/onboarding",
        })

    return salida
