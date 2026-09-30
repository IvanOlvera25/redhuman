"""
Creación del registro `Entrevista` (guion vía IA + liga pública con token) — lógica
compartida por dos caminos que la disparan por razones distintas:

  · routers/entrevistas.py `agendar()` — RH la agenda a mano desde el panel.
  · services/ia.agendar_videollamada_mock — el agente Zero-Touch, cuando el candidato
    confirma su disponibilidad por WhatsApp y hay avatar de Anam activo (ver ese archivo).

No manda WhatsApp ni hace `db.commit()`: cada camino avisa al candidato con un mensaje
distinto (uno fijo, el otro redactado por el agente), así que eso se queda con quien llama.
"""

import secrets
from datetime import datetime
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ..models import Entrevista, Postulacion, registrar
from . import ia
from .avatar import avatar_activo


def reabrir_entrevista(db: Session, e: Entrevista, actor: str, motivo: str = "", extra: Optional[dict] = None) -> dict:
    """Vuelve a aceptar respuestas tras un cierre. El intento anterior (transcript, evaluación,
    cierre) se archiva en `intentos_previos`, nunca se pisa; la liga (token) es la misma; la
    postulación vuelve a Entrevista IA si estaba en Evaluación. Fase 3 (2026-09-15): compartido
    entre RH (POST /entrevistas/{codigo}/reabrir) y el candidato por WhatsApp (solo interrumpida/
    parcial — ver candidatos._reanudar_entrevista_ia). No hace commit."""
    p = e.postulacion
    intento = {
        "estado": e.estado, "cierre": e.cierre, "iniciada_en": e.iniciada_en.isoformat() if e.iniciada_en else None,
        "finalizada_en": e.finalizada_en.isoformat() if e.finalizada_en else None,
        "transcript": list(e.transcript or []), "evaluacion": dict(e.evaluacion or {}),
    }
    e.intentos_previos = list(e.intentos_previos or []) + [intento]
    e.transcript = []
    e.evaluacion = {}
    e.cierre = ""
    e.motivo = ""
    e.iniciada_en = None
    e.finalizada_en = None
    e.estado = "programada"
    if p and p.etapa == "Evaluación":
        p.etapa = "Entrevista IA"
    registrar(
        db, actor, "entrevista_reabierta", "entrevista", e.codigo,
        {"postulacion": p.codigo if p else None, "motivo": (motivo or "").strip()[:300], "intento_archivado": intento["estado"], **(extra or {})},
    )
    return intento


def crear_entrevista_para_candidato(
    db: Session,
    p: Postulacion,
    actor: str,
    programada_para: Optional[datetime] = None,
    fase: str = "inicial",
) -> Tuple[Entrevista, bool]:
    """Genera el guion y crea la `Entrevista` (con su token) para la postulación `p`, usando su vacante.
    `actor` firma la bitácora — el nombre de RH en el camino manual, "agente-ia" en Zero-Touch, igual que
    el resto de acciones automáticas del agente.

    Fraiche (spec §7-8): la entrevista inicial usa el guion FIJO de temas (experiencia, funciones,
    estabilidad, motivos de salida, disponibilidad, servicio al cliente, expectativa salarial) y parte
    del prefiltro; `fase="ipv"` crea una sesión que es solo la Entrevista IPV (rúbrica)."""
    from . import fraiche

    v = p.vacante
    titulo = v.titulo if v else "vacante general"
    if fase == "ipv":
        guion, con_ia = ia.GuionEntrevista(
            enfoque=f"Entrevista IPV para {titulo}: una situación por competencia, con ejemplo concreto.",
            temas=[c["nombre"] for c in fraiche.COMPETENCIAS_IPV], preguntas=ia.preguntas_ipv_demo(),
        ), False
    else:
        guion, con_ia = ia.guion_entrevista_inicial_fraiche(
            titulo, fraiche.contexto_previo_entrevista(p.analisis),
            enfoque_entrevista=(v.enfoque_entrevista if v else "profesional") or "profesional",
        ), False
    e = Entrevista(
        codigo="TMP",
        candidato_id=p.candidato_id,
        token=secrets.token_urlsafe(24),
        tipo="avatar" if avatar_activo() else "texto",
        guion=guion.model_dump(),
        programada_para=programada_para,
        fase=fase if fase in fraiche.FASES_ENTREVISTA else "inicial",
    )
    p.entrevistas.append(e)
    db.add(e)
    db.flush()
    e.codigo = f"ENT-{300 + e.id}"
    if p.etapa == "Prefiltro":
        p.etapa = "Entrevista IA"  # ver ETAPAS_CANDIDATO — la entrevista con avatar también es "IA"
    registrar(db, actor, "entrevista_agendada", "entrevista", e.codigo, {"candidato": p.candidato.codigo, "postulacion": p.codigo, "ia": con_ia, "fase": e.fase})
    return e, con_ia
