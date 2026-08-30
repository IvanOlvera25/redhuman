"""Métricas que cruzan el Módulo 1 (reclutamiento) y el Módulo 2 (contratación).

Es la vista que demuestra que ambos módulos son un solo flujo: de candidato
captado a colaborador dado de alta, con el embudo real de la base.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual
from ..models import ETAPAS_CANDIDATO, Candidato, Entrevista, Expediente, Vacante

router = APIRouter(prefix="/metricas", tags=["metricas"], dependencies=[Depends(usuario_actual)])


@router.get("/pipeline")
def pipeline(db: Session = Depends(get_db)):
    """Embudo de punta a punta: captación → prefiltro → entrevista → expediente → alta."""
    total_candidatos = db.query(Candidato).count()
    por_etapa = dict(db.query(Candidato.etapa, func.count(Candidato.id)).group_by(Candidato.etapa).all())
    por_estado = dict(db.query(Candidato.estado, func.count(Candidato.id)).group_by(Candidato.estado).all())
    por_fuente = dict(db.query(Candidato.fuente, func.count(Candidato.id)).group_by(Candidato.fuente).all())

    prefiltrados = db.query(Candidato).filter(Candidato.prefiltro_completo.is_(True)).count()
    entrevistas_evaluadas = db.query(Entrevista).filter(Entrevista.estado == "evaluada").count()
    expedientes = db.query(Expediente).all()
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
            "total": db.query(Vacante).count(),
            "publicadas": db.query(Vacante).filter(Vacante.estado == "Publicada").count(),
            "borradores": db.query(Vacante).filter(Vacante.estado == "Borrador").count(),
        },
        "candidatos": {
            "total": total_candidatos,
            "nuevos_7d": db.query(Candidato).filter(Candidato.creado_en >= hace_7d).count(),
            "por_etapa": {e: por_etapa.get(e, 0) for e in ETAPAS_CANDIDATO},
            "por_estado": por_estado,
            "por_fuente": por_fuente,
            "sin_consentimiento": db.query(Candidato).filter(Candidato.consentimiento.is_(False)).count(),
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
        "acciones": _acciones(db, expedientes),
    }


def _acciones(db: Session, expedientes) -> list:
    salida = []

    por_decidir = db.query(Candidato).filter(
        Candidato.prefiltro_completo.is_(True), Candidato.etapa == "Prefiltro", Candidato.estado != "no_cumple"
    ).count()
    if por_decidir:
        salida.append({
            "modulo": 1,
            "tipo": "decision_pendiente",
            "cantidad": por_decidir,
            "texto": f"{por_decidir} candidato(s) prefiltrados esperan decisión de RH.",
            "ruta": "/dashboard/candidatos",
        })

    sin_consentimiento = db.query(Candidato).filter(
        Candidato.consentimiento.is_(False), Candidato.etapa != "Prefiltro"
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
