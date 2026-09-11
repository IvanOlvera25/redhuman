"""Módulo 1 · Reclutamiento — liga pública del entrevistador (Lote 3).

Contraparte liviana de `entrevistas.py`/`capacitacion.py`: ahí el token abre una sesión
completa con el avatar (varios endpoints, conversación, transcript). Aquí no hay nada que
conversar — es un solo formulario (Resultado, Recomendación, Comentario) de un solo submit,
así que basta con GET (contexto de solo lectura) + POST (el único envío posible). El token es
la credencial, igual que en los otros dos: sin sesión, sin login.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EntrevistaHumana, registrar
from ..serial import iso
from ..services import notificaciones

router = APIRouter(prefix="/entrevista-humana", tags=["entrevista-humana"])

RESULTADOS_ENTREVISTA_HUMANA = ("aprobado", "no_aprobado")
RECOMENDACIONES_ENTREVISTA_HUMANA = ("avanzar", "no_avanzar", "segunda_entrevista")


def _por_token(db: Session, token: str) -> EntrevistaHumana:
    """Sirve tanto para el GET como para el POST: si alguien más ya capturó el resultado entre
    ambas llamadas, esta misma condición hace que el POST también la trate como no encontrada
    — nunca sobreescribe (ver candidatos.registrar_resultado_entrevista_humana, el respaldo
    de RH, para la única vía que sí puede corregir un resultado ya capturado)."""
    eh = db.query(EntrevistaHumana).filter(EntrevistaHumana.token == token).first()
    if not eh or eh.resultado_capturado_por:
        raise HTTPException(404, "Esta liga ya no está disponible.")
    return eh


@router.get("/publica/{token}")
def publica(token: str, db: Session = Depends(get_db)):
    eh = _por_token(db, token)
    p = eh.postulacion
    return {
        "candidato": eh.candidato.nombre if eh.candidato else "",
        "puesto": p.vacante.titulo if p and p.vacante else "",
        "fecha": iso(eh.fecha),
    }


class ResultadoEntrevistaHumanaPublicaIn(BaseModel):
    resultado: str  # aprobado | no_aprobado
    recomendacion: str  # avanzar | no_avanzar | segunda_entrevista
    comentario: str = ""


@router.post("/publica/{token}")
async def enviar_resultado(token: str, datos: ResultadoEntrevistaHumanaPublicaIn, db: Session = Depends(get_db)):
    eh = _por_token(db, token)

    if datos.resultado not in RESULTADOS_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Resultado inválido. Usa uno de: {', '.join(RESULTADOS_ENTREVISTA_HUMANA)}")
    if datos.recomendacion not in RECOMENDACIONES_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Recomendación inválida. Usa una de: {', '.join(RECOMENDACIONES_ENTREVISTA_HUMANA)}")
    comentario = datos.comentario.strip()
    if (datos.resultado == "no_aprobado" or datos.recomendacion == "segunda_entrevista") and not comentario:
        raise HTTPException(
            400,
            "Agrega un comentario: es obligatorio cuando el resultado es 'No aprobado' o la "
            "recomendación es 'Segunda entrevista'.",
        )

    eh.realizada = True
    eh.resultado = datos.resultado
    eh.recomendacion = datos.recomendacion
    eh.comentario = comentario
    eh.resultado_capturado_por = "entrevistador"
    # Fase C: actualizar resultado_apto y ultima_actividad_en de la POSTULACIÓN (Fase 2: el
    # Kanban lee de ahí, no de la persona). Se importa aquí para evitar import circular.
    from .candidatos import _recalcular_resultado_apto_y_notificar, _actualizar_ultima_actividad
    p = eh.postulacion
    if not p:
        raise HTTPException(409, "Esta entrevista no está ligada a ninguna postulación (corre scripts/migrar_postulaciones.py).")
    _actualizar_ultima_actividad(p)
    await _recalcular_resultado_apto_y_notificar(db, p, "entrevistador-externo")
    resultados = await notificaciones.disparar(db, "recomendacion_final", p, "entrevistador-externo", eh=eh)
    registrar(
        db, "entrevistador-externo", "entrevista_humana_evaluada_por_liga", "postulacion", p.codigo,
        {"candidato": p.candidato.codigo, "resultado": datos.resultado, "recomendacion": datos.recomendacion, "comentario": comentario, "notificaciones": resultados},
    )
    db.commit()
    return {"ok": True}
