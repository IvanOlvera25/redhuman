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

from ..models import Candidato, Entrevista, registrar
from . import ia
from .avatar import avatar_activo


def crear_entrevista_para_candidato(
    db: Session,
    c: Candidato,
    actor: str,
    programada_para: Optional[datetime] = None,
) -> Tuple[Entrevista, bool]:
    """Genera el guion con IA y crea la `Entrevista` (con su token) para `c`, usando la vacante
    que ya tenga asignada. `actor` firma la bitácora — el nombre de RH en el camino manual,
    "agente-ia" en Zero-Touch, igual que el resto de acciones automáticas del agente."""
    v = c.vacante
    guion, con_ia = ia.guion_entrevista(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        c.experiencia or "",
    )
    e = Entrevista(
        codigo="TMP",
        candidato_id=c.id,
        token=secrets.token_urlsafe(24),
        tipo="avatar" if avatar_activo() else "texto",
        guion=guion.model_dump(),
        programada_para=programada_para,
    )
    db.add(e)
    db.flush()
    e.codigo = f"ENT-{300 + e.id}"
    if c.etapa == "Prefiltro":
        c.etapa = "Entrevista IA"  # ver ETAPAS_CANDIDATO — la entrevista con avatar también es "IA"
    registrar(db, actor, "entrevista_agendada", "entrevista", e.codigo, {"candidato": c.codigo, "ia": con_ia})
    return e, con_ia
