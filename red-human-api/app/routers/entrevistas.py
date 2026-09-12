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
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import CIERRES_COMPLETOS, CIERRES_ENTREVISTA, Candidato, Cuenta, Entrevista, Usuario, Vacante, registrar
from ..serial import entrevista_dict, nombre_empresa_candidato
from ..services import ia
from ..services.avatar import avatar_activo, crear_sesion_avatar
from ..services.configuracion import modo_prueba_activo
from ..services.entrevistas import crear_entrevista_para_candidato
from ..services.whatsapp import enviar_mensaje
from .candidatos import _crear_candidato, guardar_mensaje, nombre_ficha, postulacion_para_vacante
from .candidatos import _por_codigo as _postulacion_por_codigo

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
def listar(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    q = (
        db.query(Entrevista)
        .join(Candidato, Entrevista.candidato_id == Candidato.id)
        .filter(Candidato.cuenta_id == cuenta.id)
        .order_by(Entrevista.id.desc())
    )
    return [entrevista_dict(e) for e in q.all()]


@router.get("/metricas")
def metricas(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Métricas del motor de entrevistas para el dashboard."""
    todas = (
        db.query(Entrevista)
        .join(Candidato, Entrevista.candidato_id == Candidato.id)
        .filter(Candidato.cuenta_id == cuenta.id)
        .all()
    )
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
    candidato: str  # código de la Postulación (P-####); se acepta C-#### por compatibilidad
    programada_para: Optional[str] = None  # ISO
    avisar_whatsapp: bool = True


@router.post("", status_code=201)
async def agendar(
    datos: AgendarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    p = _postulacion_por_codigo(db, datos.candidato, cuenta.id)

    fecha = None
    if datos.programada_para:
        try:
            fecha = datetime.fromisoformat(datos.programada_para).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "programada_para inválida (usa ISO: 2026-07-28T15:00)")

    e, con_ia = crear_entrevista_para_candidato(db, p, u.nombre, programada_para=fecha)

    v = p.vacante
    liga = f"{settings.app_url}/entrevista/{e.token}"
    envio = {"enviado": False, "proveedor": "demo"}
    if datos.avisar_whatsapp and p.telefono:
        texto = (
            f"¡Hola {p.nombre.split(' ')[0]}! 👋 Tu entrevista para {v.titulo if v else 'la vacante'} está lista. "
            f"Entra cuando gustes desde tu celular o computadora: {liga} — dura unos 10 minutos."
        )
        envio = await enviar_mensaje(p.telefono, texto)
        guardar_mensaje(db, p, "assistant", texto, "whatsapp", envio)
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
async def inmediata(
    datos: InmediataIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Crea (o reutiliza) al prospecto y genera su liga de entrevista en un paso."""
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre del prospecto es obligatorio.")

    prueba = modo_prueba_activo(db)

    c = None
    if not prueba:
        if datos.telefono:
            c = db.query(Candidato).filter(
                Candidato.telefono == datos.telefono, Candidato.es_prueba.is_(False), Candidato.cuenta_id == cuenta.id
            ).first()
        if not c and datos.correo:
            c = db.query(Candidato).filter(
                Candidato.correo == datos.correo, Candidato.es_prueba.is_(False), Candidato.cuenta_id == cuenta.id
            ).first()

    vac = (
        db.query(Vacante).filter(Vacante.codigo == datos.vacante, Vacante.cuenta_id == cuenta.id).first()
        if datos.vacante
        else None
    )

    nuevo = c is None
    if c is None:
        c = _crear_candidato(db, cuenta.id, datos.nombre.strip(), "RH", prueba, telefono=datos.telefono, correo=datos.correo)
    # La persona se reutiliza; la postulación es por vacante (activa para esa vacante → la misma).
    p, nueva_p = postulacion_para_vacante(db, c, vac, cuenta.id, "rh_directo", es_prueba=prueba)
    registrar(
        db, "sistema", "candidato_ingresado", "postulacion", p.codigo,
        {"candidato": c.codigo, "fuente": "RH", "via": "entrevista_inmediata", "persona_nueva": nuevo, "postulacion_nueva": nueva_p},
    )
    db.commit()

    return await agendar(AgendarIn(candidato=p.codigo, avisar_whatsapp=datos.avisar_whatsapp), db, u, cuenta)


# ------------------------------------------------------------
# Sala pública (candidato) — por token
# ------------------------------------------------------------


def _contexto(e: Entrevista):
    """Fase 2/4: TODO sale de la Postulación de la entrevista (vacante, empresa visible) y de la
    persona solo el nombre. Nunca de `Candidato.vacante` (ya no existe: bug corregido en Fase 4)."""
    p = e.postulacion
    v = p.vacante if p else None
    empresa = nombre_empresa_candidato(v) if v else "la empresa"
    return p, v, empresa


def _nombre_entrevistado(e: Entrevista) -> str:
    """Nombre de la FICHA de la persona de esta entrevista (Punto 2): nunca de otra sesión."""
    c = e.candidato
    return nombre_ficha(e.postulacion) if e.postulacion else ((c.nombre.split(" ")[0] if c and c.nombre else "candidato"))


@router.get("/publica/{token}")
def publica(token: str, db: Session = Depends(get_db)):
    e = _por_token(db, token)
    p, v, empresa = _contexto(e)
    return {
        "candidato": _nombre_entrevistado(e),
        "puesto": v.titulo if v else "",
        "empresa": empresa,
        "tipo": e.tipo,
        "estado": e.estado,
        "cierre": e.cierre or "",
        "consentimiento": e.consentimiento,
        "avatar_disponible": avatar_activo(),
        "duracion_max_seg": settings.anam_max_sesion_seg,
    }


class ConsentirIn(BaseModel):
    acepta: bool


@router.post("/publica/{token}/consentimiento")
def consentir(token: str, datos: ConsentirIn, db: Session = Depends(get_db)):
    e = _por_token(db, token)
    if not datos.acepta:
        raise HTTPException(400, "La entrevista requiere consentimiento explícito del candidato.")
    if e.estado in ("completada", "evaluada", "interrumpida"):
        raise HTTPException(409, "Esta entrevista ya fue cerrada.")
    e.consentimiento = True
    e.consentimiento_fecha = datetime.now(timezone.utc)
    registrar(db, e.candidato.codigo if e.candidato else "candidato", "consentimiento_entrevista", "entrevista", e.codigo, {})
    db.commit()
    return {"ok": True}


def _system_prompt(e: Entrevista) -> str:
    p, v, empresa = _contexto(e)
    guion = e.guion or {}
    return ia.prompt_entrevistador(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        _nombre_entrevistado(e),
        list(guion.get("preguntas") or []),
        empresa=empresa,
        temas=ia.temas_de_guion(guion),
        enfoque=guion.get("enfoque", ""),
        enfoque_entrevista=(v.enfoque_entrevista if v else "profesional") or "profesional",
        ubicacion=(v.ubicacion if v else "") or "",
        modalidad=(v.modalidad if v else "") or "",
        sueldo=(v.sueldo if v else "") or "",
        beneficios=list(v.beneficios or []) if v else [],
        area=(v.area if v else "") or "",
    )


@router.post("/publica/{token}/sesion")
async def sesion(token: str, db: Session = Depends(get_db)):
    """Inicia la sesión: token de avatar (Anam) o modo texto si no hay clave."""
    e = _por_token(db, token)
    if not e.consentimiento:
        raise HTTPException(403, "Primero se requiere el consentimiento del candidato.")
    if e.estado in ("completada", "evaluada", "interrumpida"):
        raise HTTPException(409, "Esta entrevista ya fue cerrada. RH puede reabrirla si hace falta.")

    p, v, empresa = _contexto(e)
    saludo = ia.mensaje_inicial_entrevista(v.titulo if v else "")
    if e.estado != "en_curso":
        e.estado = "en_curso"
        e.iniciada_en = datetime.now(timezone.utc)

    ses = None
    try:
        ses = await crear_sesion_avatar("Red Human", _system_prompt(e), saludo)
    except Exception as ex:  # el avatar nunca debe tumbar la entrevista: cae a texto
        print(f"[ERROR] crear_sesion_avatar falló: {str(ex)}", flush=True)
        registrar(db, "sistema", "avatar_error", "entrevista", e.codigo, {"error": str(ex)[:300]})

    if ses is None:
        e.tipo = "texto"
        if not e.transcript:
            e.transcript = [{"rol": "assistant", "texto": saludo}]
        db.commit()
        return {"modo": "texto", "mensajes": e.transcript, "nombre": _nombre_entrevistado(e)}

    e.tipo = "avatar"
    db.commit()
    return {"modo": "avatar", "nombre": _nombre_entrevistado(e), **ses}


class TurnoIn(BaseModel):
    texto: str


@router.post("/publica/{token}/turno")
def turno(token: str, datos: TurnoIn, db: Session = Depends(get_db)):
    """Un turno de la entrevista en modo texto (demo o fallback)."""
    e = _por_token(db, token)
    if not e.consentimiento or e.estado != "en_curso":
        raise HTTPException(403, "La entrevista no está en curso.")

    historial = list(e.transcript or []) + [{"rol": "user", "texto": datos.texto}]
    t, con_ia = ia.entrevista_turno(_system_prompt(e), historial)
    e.transcript = historial + [{"rol": "assistant", "texto": t.respuesta}]
    db.commit()
    return {"respuesta": t.respuesta, "terminada": t.terminada, "ia": con_ia}


class FinalizarIn(BaseModel):
    transcript: Optional[List[dict]] = None  # modo avatar: lo manda el navegador; modo texto: ya está guardado
    # Fase 4 (Punto 4): cómo cerró, ver CIERRES_ENTREVISTA. El servidor lo VERIFICA, no lo confía.
    cierre: str = "manual"


# Mínimo de intervenciones del candidato para considerar que hubo entrevista que evaluar.
MIN_TURNOS_CANDIDATO = 2


def _cierre_verificado(e: Entrevista, cierre_declarado: str) -> str:
    """El backend decide el cierre real con lo que puede comprobar (Punto 4):
    - `texto`: solo si el último turno de la entrevistadora en el transcript guardado trae la despedida.
    - `herramienta`/`marcador`: solo si la despedida fija (ia.DESPEDIDA_ENTREVISTA) aparece en el
      último turno de la entrevistadora; si no, se degrada a `manual`.
    - `manual`/`desconexion`/`tiempo`: se aceptan tal cual (no cambian nada que haya que verificar).
    """
    if cierre_declarado not in CIERRES_ENTREVISTA:
        cierre_declarado = "manual"
    ultimo_asistente = next((m.get("texto", "") for m in reversed(e.transcript or []) if m.get("rol") == "assistant"), "")
    hay_despedida = ia.DESPEDIDA_ENTREVISTA.lower() in (ultimo_asistente or "").lower()
    if cierre_declarado in ("texto", "herramienta", "marcador"):
        return cierre_declarado if hay_despedida else "manual"
    return cierre_declarado


@router.post("/publica/{token}/finalizar")
async def finalizar(token: str, datos: FinalizarIn, db: Session = Depends(get_db)):
    """Cierra la entrevista DE VERDAD (Punto 4): registra cómo cerró (verificado), guarda el
    transcript, corre la evaluación IA (recomendación + perfil profundo) y mueve la postulación a
    Evaluación — sin que el candidato presione nada. Una entrevista con cierre por desconexión o
    tiempo y casi sin turnos del candidato queda `interrumpida` (sin evaluar) para que RH la reabra."""
    e = _por_token(db, token)
    if e.estado in ("evaluada", "interrumpida"):
        return entrevista_dict(e)
    if e.estado != "en_curso":
        raise HTTPException(409, "La entrevista no está en curso; no hay nada que cerrar.")
    if not e.consentimiento:
        raise HTTPException(403, "La entrevista no tiene consentimiento del candidato.")

    if datos.transcript:
        e.transcript = [
            {"rol": ("assistant" if m.get("rol") == "assistant" else "user"), "texto": str(m.get("texto", ""))[:2000]}
            for m in datos.transcript[:400]
        ]
    e.cierre = _cierre_verificado(e, datos.cierre)
    e.finalizada_en = datetime.now(timezone.utc)
    turnos_candidato = sum(1 for m in (e.transcript or []) if m.get("rol") == "user")

    p, v, empresa = _contexto(e)

    if e.cierre not in CIERRES_COMPLETOS and turnos_candidato < MIN_TURNOS_CANDIDATO:
        e.estado = "interrumpida"
        registrar(
            db, "sistema", "entrevista_interrumpida", "entrevista", e.codigo,
            {"cierre": e.cierre, "turnos_candidato": turnos_candidato, "postulacion": p.codigo if p else None},
        )
        db.commit()
        return entrevista_dict(e)

    e.estado = "completada"
    guion = e.guion or {}
    ev, con_ia = ia.evaluar_entrevista(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        e.transcript or [],
        perfil_ideal=(v.perfil_ideal if v else "") or "",
        temas=ia.temas_de_guion(guion),
        enfoque_entrevista=(v.enfoque_entrevista if v else "profesional") or "profesional",
    )
    e.evaluacion = ev.model_dump()
    e.estado = "evaluada"
    # p.score / p.evidencia son el resultado de Luna sobre el CV (ver ia.AjustePerfil,
    # candidatos._aplicar_cv) — NUNCA se tocan aquí. El resultado del avatar vive completo y
    # aparte en Entrevista.evaluacion (match_perfil, evidencia, recomendación, perfil profundo).
    registrar(
        db, "agente-ia", "entrevista_evaluada", "entrevista", e.codigo,
        {"ia": con_ia, "recomendacion": ev.recomendacion, "match": ev.match_perfil, "cierre": e.cierre, "turnos_candidato": turnos_candidato},
    )

    # Zero-Touch: mueve el Kanban a Evaluación — NO toca p.estado, la recomendación de la IA
    # queda solo como dato para que RH decida a mano ahí, mismo patrón HITL que el resto del
    # sistema (ver _auto_decision_zero_touch en candidatos.py).
    if p and p.etapa == "Entrevista IA":
        p.etapa = "Evaluación"
        registrar(
            db, "agente-ia", "auto_evaluacion_zero_touch", "postulacion", p.codigo,
            {"candidato": p.candidato.codigo, "entrevista": e.codigo, "recomendacion": ev.recomendacion, "match": ev.match_perfil},
        )

        primer_nombre = nombre_ficha(p)
        texto = (
            f"¡Gracias, {primer_nombre}! 🙌 Terminamos tu entrevista para {v.titulo if v else 'la vacante'} en {empresa}. "
            "El equipo de RH va a revisar tus resultados y te contactará pronto."
        )
        if p.telefono:
            try:
                envio = await enviar_mensaje(p.telefono, texto)
            except Exception as ex:  # que WhatsApp falle no debe tumbar el cierre de la entrevista
                print(f"[whatsapp-send-error] finalizar -> {e.codigo}: {ex}")
                envio = {"enviado": False, "proveedor": "error", "detalle": str(ex)}
            guardar_mensaje(db, p, "assistant", texto, "whatsapp", envio)

    db.commit()
    return entrevista_dict(e)


# ------------------------------------------------------------
# Reapertura explícita (RH) — Fase 4, Punto 4
# ------------------------------------------------------------


class ReabrirIn(BaseModel):
    motivo: str = ""


@router.post("/{codigo}/reabrir")
def reabrir(
    codigo: str, datos: ReabrirIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Única forma de volver a aceptar respuestas tras un cierre: una persona de RH la reabre. El
    intento anterior (transcript, evaluación, cierre) se archiva en `intentos_previos`, nunca se
    pisa. La liga (token) es la misma; la postulación vuelve a Entrevista IA si estaba en Evaluación."""
    e = _por_codigo(db, codigo)
    p = e.postulacion
    if not p or p.cuenta_id != cuenta.id:
        raise HTTPException(404, "Entrevista no encontrada")
    if e.estado not in ("evaluada", "interrumpida", "completada", "en_curso"):
        raise HTTPException(409, "La entrevista no está cerrada ni en curso.")
    intento = {
        "estado": e.estado, "cierre": e.cierre, "iniciada_en": e.iniciada_en.isoformat() if e.iniciada_en else None,
        "finalizada_en": e.finalizada_en.isoformat() if e.finalizada_en else None,
        "transcript": list(e.transcript or []), "evaluacion": dict(e.evaluacion or {}),
    }
    e.intentos_previos = list(e.intentos_previos or []) + [intento]
    e.transcript = []
    e.evaluacion = {}
    e.cierre = ""
    e.iniciada_en = None
    e.finalizada_en = None
    e.estado = "programada"
    if p.etapa == "Evaluación":
        p.etapa = "Entrevista IA"
    registrar(
        db, u.nombre, "entrevista_reabierta", "entrevista", e.codigo,
        {"postulacion": p.codigo, "motivo": datos.motivo.strip()[:300], "intento_archivado": intento["estado"], "correo_rh": u.correo},
    )
    db.commit()
    return entrevista_dict(e)
