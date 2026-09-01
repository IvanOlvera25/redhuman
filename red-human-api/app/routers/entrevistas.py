"""Módulo 1 · Reclutamiento — Entrevistas con agente IA (módulo 3.10).

Flujo: RH agenda → se genera guion con IA y una liga pública → el candidato
abre la liga, otorga consentimiento y conversa con el avatar (Anam) o por
texto (modo demo) → al terminar, la IA evalúa y deja una RECOMENDACIÓN;
la decisión de avanzar/descartar sigue siendo humana (LFPDPPP).
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import Candidato, Entrevista, Mensaje, Usuario, Vacante, registrar
from ..serial import entrevista_dict
from ..services import ia
from ..services.avatar import avatar_activo, crear_sesion_avatar
from ..services.entrevistas import crear_entrevista_para_candidato
from ..services.whatsapp import enviar_mensaje

router = APIRouter(prefix="/entrevistas", tags=["entrevistas"])


def _por_token(db: Session, token: str) -> Entrevista:
    e = db.query(Entrevista).filter(Entrevista.token == token).first()
    if not e:
        raise HTTPException(404, "Entrevista no encontrada")
    return e


def _por_codigo(db: Session, codigo: str) -> Entrevista:
    e = db.query(Entrevista).filter(Entrevista.codigo == codigo).first()
    if not e:
        raise HTTPException(404, "Entrevista no encontrada")
    return e


@router.get("")
def listar(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return [entrevista_dict(e) for e in db.query(Entrevista).order_by(Entrevista.id.desc()).all()]


@router.get("/metricas")
def metricas(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """Métricas del motor de entrevistas para el dashboard."""
    todas = db.query(Entrevista).all()
    evaluadas = [e for e in todas if e.estado == "evaluada" and e.evaluacion]
    matches = [e.evaluacion.get("match_perfil", 0) for e in evaluadas]
    recomendaciones = {"avanzar": 0, "revision": 0, "no_avanzar": 0}
    for e in evaluadas:
        rec = e.evaluacion.get("recomendacion")
        if rec in recomendaciones:
            recomendaciones[rec] += 1
    return {
        "total": len(todas),
        "evaluadas": len(evaluadas),
        "pendientes": sum(1 for e in todas if e.estado in ("programada", "en_curso")),
        "match_promedio": round(sum(matches) / len(matches)) if matches else 0,
        "recomendaciones": recomendaciones,
        "avatar_activo": avatar_activo(),
    }


# ------------------------------------------------------------
# Agendar (RH) — genera guion IA + liga pública para el candidato
# ------------------------------------------------------------


class AgendarIn(BaseModel):
    candidato: str  # código C-####
    programada_para: Optional[str] = None  # ISO
    avisar_whatsapp: bool = True


@router.post("", status_code=201)
async def agendar(datos: AgendarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    c = db.query(Candidato).filter(Candidato.codigo == datos.candidato).first()
    if not c:
        raise HTTPException(404, "Candidato no encontrado")

    fecha = None
    if datos.programada_para:
        try:
            fecha = datetime.fromisoformat(datos.programada_para).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "programada_para inválida (usa ISO: 2026-07-28T15:00)")

    e, con_ia = crear_entrevista_para_candidato(db, c, u.nombre, programada_para=fecha)

    v = c.vacante
    liga = f"{settings.app_url}/entrevista/{e.token}"
    envio = {"enviado": False, "proveedor": "demo"}
    if datos.avisar_whatsapp and c.telefono:
        texto = (
            f"¡Hola {c.nombre.split(' ')[0]}! 👋 Tu entrevista para {v.titulo if v else 'la vacante'} está lista. "
            f"Entra cuando gustes desde tu celular o computadora: {liga} — dura unos 10 minutos."
        )
        envio = await enviar_mensaje(c.telefono, texto)
    db.commit()
    return {"liga": liga, "ia": con_ia, "whatsapp": envio, **entrevista_dict(e)}


# ------------------------------------------------------------
# Entrevista inmediata — prospecto nuevo con liga al instante
# ------------------------------------------------------------


class InmediataIn(BaseModel):
    nombre: str
    telefono: str = ""
    correo: str = ""
    vacante: Optional[str] = None  # código VAC-####
    avisar_whatsapp: bool = False


@router.post("/inmediata", status_code=201)
async def inmediata(datos: InmediataIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Crea (o reutiliza) al prospecto y genera su liga de entrevista en un paso."""
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre del prospecto es obligatorio.")

    c = None
    if datos.telefono:
        c = db.query(Candidato).filter(Candidato.telefono == datos.telefono).first()
    if not c and datos.correo:
        c = db.query(Candidato).filter(Candidato.correo == datos.correo).first()

    if not c:
        vac = db.query(Vacante).filter(Vacante.codigo == datos.vacante).first() if datos.vacante else None
        c = Candidato(
            codigo="TMP",
            nombre=datos.nombre.strip(),
            telefono=datos.telefono,
            correo=datos.correo,
            fuente="RH",
            etapa="Entrevista IA",
            vacante_id=vac.id if vac else None,
        )
        db.add(c)
        db.flush()
        c.codigo = f"C-{8800 + c.id}"
        registrar(db, "sistema", "candidato_ingresado", "candidato", c.codigo, {"fuente": "RH", "via": "entrevista_inmediata"})
        db.commit()

    return await agendar(AgendarIn(candidato=c.codigo, avisar_whatsapp=datos.avisar_whatsapp), db, u)


# ------------------------------------------------------------
# Sala pública (candidato) — por token
# ------------------------------------------------------------


@router.get("/publica/{token}")
def publica(token: str, db: Session = Depends(get_db)):
    e = _por_token(db, token)
    c = e.candidato
    return {
        "candidato": c.nombre if c else "",
        "puesto": c.vacante.titulo if c and c.vacante else "",
        "empresa": c.vacante.empresa if c and c.vacante else "Red Human",
        "tipo": e.tipo,
        "estado": e.estado,
        "consentimiento": e.consentimiento,
        "avatar_disponible": avatar_activo(),
    }


class ConsentirIn(BaseModel):
    acepta: bool


@router.post("/publica/{token}/consentimiento")
def consentir(token: str, datos: ConsentirIn, db: Session = Depends(get_db)):
    e = _por_token(db, token)
    if not datos.acepta:
        raise HTTPException(400, "La entrevista requiere consentimiento explícito del candidato.")
    e.consentimiento = True
    e.consentimiento_fecha = datetime.now(timezone.utc)
    registrar(db, e.candidato.codigo if e.candidato else "candidato", "consentimiento_entrevista", "entrevista", e.codigo, {})
    db.commit()
    return {"ok": True}


def _system_prompt(e: Entrevista) -> str:
    c = e.candidato
    v = c.vacante if c else None
    return ia.prompt_entrevistador(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        c.nombre if c else "candidato",
        (e.guion or {}).get("preguntas", []),
    )


@router.post("/publica/{token}/sesion")
async def sesion(token: str, db: Session = Depends(get_db)):
    """Inicia la sesión: token de avatar (Anam) o modo texto si no hay clave."""
    e = _por_token(db, token)
    if not e.consentimiento:
        raise HTTPException(403, "Primero se requiere el consentimiento del candidato.")
    if e.estado in ("completada", "evaluada"):
        raise HTTPException(409, "Esta entrevista ya fue realizada.")

    c = e.candidato
    saludo = (
        f"Hola {c.nombre.split(' ')[0] if c else ''}, soy Alma, la entrevistadora virtual de Red Human. "
        "Gracias por tu tiempo. Cuando estés lista o listo, empezamos. 😊"
    )
    e.estado = "en_curso"

    ses = None
    try:
        ses = await crear_sesion_avatar("Alma", _system_prompt(e), saludo)
        print(f"[DEBUG] crear_sesion_avatar devolvió: {bool(ses)}", flush=True)
    except Exception as ex:  # el avatar nunca debe tumbar la entrevista: cae a texto
        print(f"[ERROR] crear_sesion_avatar falló: {str(ex)}", flush=True)
        registrar(db, "sistema", "avatar_error", "entrevista", e.codigo, {"error": str(ex)[:300]})

    if ses is None:
        e.tipo = "texto"
        if not e.transcript:
            e.transcript = [{"rol": "assistant", "texto": saludo}]
        db.commit()
        return {"modo": "texto", "mensajes": e.transcript}

    e.tipo = "avatar"
    db.commit()
    return {"modo": "avatar", **ses}


class TurnoIn(BaseModel):
    texto: str


@router.post("/publica/{token}/turno")
def turno(token: str, datos: TurnoIn, db: Session = Depends(get_db)):
    """Un turno de la entrevista en modo texto (demo o fallback)."""
    e = _por_token(db, token)
    if not e.consentimiento or e.estado not in ("en_curso",):
        raise HTTPException(403, "La entrevista no está en curso.")

    historial = list(e.transcript or []) + [{"rol": "user", "texto": datos.texto}]
    t, con_ia = ia.entrevista_turno(_system_prompt(e), historial)
    e.transcript = historial + [{"rol": "assistant", "texto": t.respuesta}]
    db.commit()
    return {"respuesta": t.respuesta, "terminada": t.terminada, "ia": con_ia}


class FinalizarIn(BaseModel):
    transcript: Optional[List[dict]] = None  # modo avatar: lo manda el navegador; modo texto: ya está guardado


@router.post("/publica/{token}/finalizar")
async def finalizar(token: str, datos: FinalizarIn, db: Session = Depends(get_db)):
    """Cierra la entrevista, corre la evaluación IA (recomendación para RH) y mueve al
    candidato a la etapa Evaluación — Zero-Touch, sin intervención manual de RH."""
    e = _por_token(db, token)
    if e.estado == "evaluada":
        return entrevista_dict(e)

    if datos.transcript:
        e.transcript = [
            {"rol": ("assistant" if m.get("rol") == "assistant" else "user"), "texto": str(m.get("texto", ""))[:2000]}
            for m in datos.transcript
        ]
    e.estado = "completada"

    c = e.candidato
    v = c.vacante if c else None
    ev, con_ia = ia.evaluar_entrevista(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        e.transcript or [],
    )
    e.evaluacion = ev.model_dump()
    e.estado = "evaluada"
    if c and ev.match_perfil:
        c.score = max(c.score, ev.match_perfil)
        c.evidencia = ev.evidencia
    registrar(
        db, "agente-ia", "entrevista_evaluada", "entrevista", e.codigo,
        {"ia": con_ia, "recomendacion": ev.recomendacion, "match": ev.match_perfil},
    )

    # Zero-Touch: mueve el Kanban a Evaluación — NO toca c.estado, la recomendación de la IA
    # queda solo como dato para que RH decida a mano ahí, mismo patrón HITL que el resto del
    # sistema (ver _auto_decision_zero_touch en candidatos.py).
    if c and c.etapa == "Entrevista IA":
        c.etapa = "Evaluación"
        registrar(
            db, "agente-ia", "auto_evaluacion_zero_touch", "candidato", c.codigo,
            {"entrevista": e.codigo, "recomendacion": ev.recomendacion, "match": ev.match_perfil},
        )

        primer_nombre = c.nombre.split(" ")[0] if c.nombre else "candidato(a)"
        texto = (
            f"¡Gracias, {primer_nombre}! 🙌 Terminamos tu entrevista para {v.titulo if v else 'la vacante'}. "
            "El equipo de RH va a revisar tus resultados y te contactará pronto."
        )
        if c.telefono:
            try:
                envio = await enviar_mensaje(c.telefono, texto)
            except Exception as ex:  # que WhatsApp falle no debe tumbar el cierre de la entrevista
                print(f"[whatsapp-send-error] finalizar -> {e.codigo}: {ex}")
                envio = {"enviado": False, "proveedor": "error", "detalle": str(ex)}
            db.add(Mensaje(
                candidato_id=c.id, rol="assistant", texto=texto, canal="whatsapp",
                enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", ""),
            ))

    db.commit()
    return entrevista_dict(e)
