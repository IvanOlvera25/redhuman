"""Demo Fraiche (spec §10, 2026-09-29) — liga limitada para la persona EXTERNA que realiza una evaluación:
encargado o coordinador de tienda (entrevista), proveedor socioeconómico (carga el estudio), médico (dictamen) o
franquiciatario (Continuar / No continuar). El token es la credencial (sin sesión) y SOLO abre esa evaluación con
la información necesaria: nunca el expediente completo ni datos de otras evaluaciones.

Recibir un resultado por aquí NUNCA mueve al candidato de etapa: RH lo revisa y decide.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EvaluacionCandidato, Postulacion, registrar
from ..serial import iso, nombre_empresa_candidato
from ..services import evaluaciones as sev
from ..services import fraiche
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/evaluaciones-externas", tags=["evaluaciones-externas"], dependencies=[Depends(requiere_modulos_rh)])


def _por_token(db: Session, token: str) -> EvaluacionCandidato:
    ev = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.token_externo == token).first() if token else None
    if not ev:
        raise HTTPException(404, "Esta liga no es válida o ya no está disponible.")
    return ev


def _post(db: Session, ev: EvaluacionCandidato) -> Optional[Postulacion]:
    return db.get(Postulacion, ev.postulacion_id)


def _rol(ev: EvaluacionCandidato) -> str:
    if ev.tipo == "referencias":
        return "referencias"
    if ev.es_medico:
        return "medico"
    if ev.tipo == "socioeconomico":
        return "socioeconomico"
    if sev.es_franquiciatario(ev):
        return "franquiciatario"
    if sev.es_encargado(ev):
        return "encargado"
    return "externo"


def _opciones(ev: EvaluacionCandidato) -> list:
    return [{"valor": k, "texto": t} for k, t in sev.dictamenes_visibles(ev).items()]


@router.get("/publica/{token}")
def ver(token: str, db: Session = Depends(get_db)):
    """Solo lo necesario: qué evaluación es, a quién se evalúa (nombre y vacante), cita, estado y qué se pide."""
    ev = _por_token(db, token)
    p = _post(db, ev)
    v = p.vacante if p else None
    rol = _rol(ev)
    instrucciones = {
        "encargado": "Entrevista al candidato y registra tu conclusión y comentarios.",
        "socioeconomico": "Carga el estudio (PDF), la conclusión y tus comentarios. Red Human propondrá un resumen del documento; RH lo revisa.",
        "medico": "Adjunta el dictamen y selecciona Apto, Apto condicionado o No recomendable. La información médica solo la ve el rol autorizado.",
        "franquiciatario": "Revisa al candidato que Fraiche te presenta y registra Continuar o No continuar con tus comentarios.",
        "externo": "Registra el resultado de la evaluación y adjunta el informe si aplica.",
        "referencias": "Captura los datos de cada referencia (si faltan) y registra su validación: quién contestó, cargo, fecha, medio, "
                       "si confirma puesto y periodo, desempeño, motivo de salida y si lo volverían a contratar. Si nadie contesta, "
                       "márcala como «No contactada» (no es un resultado desfavorable).",
    }[rol]
    cerrada = ev.estado in ("revisada", "fallida")
    return {
        "evaluacion": ev.nombre,
        "tipo": ev.tipo,
        "rol": rol,
        "candidato": p.nombre if p else "",
        "vacante": v.titulo if v else "",
        "sucursal": (v.sucursal if v else "") or "",
        "empresa": nombre_empresa_candidato(v) if v else "",
        "responsable": ev.responsable or "",
        "citaEn": iso(ev.cita_en),
        "citaLugar": ev.cita_lugar or "",
        "estado": sev.estado_fraiche(ev),
        "estadoTexto": sev.etiqueta_estado_fraiche(ev),
        "yaRegistrada": bool(ev.resultado_cargado_en) or cerrada,
        "cerrada": cerrada,
        "consentimientoPendiente": bool(sev.falta_consentimiento(ev, p)),
        "opciones": _opciones(ev),
        "pideArchivo": rol in ("socioeconomico", "medico"),
        "instrucciones": instrucciones,
        # franquiciatario / encargado: solo el candidato presentado, con lo necesario para entrevistarlo
        "resumenCandidato": {
            "experiencia": (p.experiencia if p else "") or "",
            "ubicacion": (p.ubicacion if p else "") or "",
        } if rol in ("franquiciatario", "encargado") and p else None,
        # 2026-10-02 (§10): el responsable de referencias captura y valida (ve las referencias; nada más del expediente)
        "referencias": list(ev.referencias or []) if rol == "referencias" else None,
        "referenciasResumen": sev.resumen_referencias(ev) if rol == "referencias" else None,
    }


class ReferenciasPublicasIn(BaseModel):
    referencias: list = []


@router.post("/publica/{token}/referencias")
async def referencias_responsable(token: str, datos: ReferenciasPublicasIn, db: Session = Depends(get_db)):
    """El RESPONSABLE (interno o externo) captura y valida las referencias desde su liga."""
    from .evaluaciones import aplicar_referencias

    ev = _por_token(db, token)
    p = _post(db, ev)
    if ev.tipo != "referencias":
        raise HTTPException(409, "Esta evaluación no es de referencias.")
    if ev.estado in ("revisada", "fallida"):
        raise HTTPException(409, "Esta evaluación ya está cerrada; contacta al equipo de RH.")
    falta = sev.falta_consentimiento(ev, p)
    if falta:
        raise HTTPException(409, falta)
    actor = ev.responsable or "responsable externo"
    r = await aplicar_referencias(db, ev, p, datos.referencias, actor, validar=True)
    registrar(db, actor, "referencias_por_liga_responsable", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, **{k: r["resumen"][k] for k in ("total", "validadas", "requeridas")}})
    db.commit()
    return {"ok": True, "referencias": ev.referencias, "resumen": r["resumen"], "estadoTexto": sev.etiqueta_estado_fraiche(ev)}


# ---------------- Liga del CANDIDATO para capturar sus referencias (2026-10-02, §10) ----------------

def _por_token_candidato(db: Session, token: str) -> EvaluacionCandidato:
    ev = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.token_candidato == token).first() if token else None
    if not ev or ev.tipo != "referencias":
        raise HTTPException(404, "Esta liga no es válida o ya no está disponible.")
    return ev


@router.get("/referencias/{token}")
def ver_referencias_candidato(token: str, db: Session = Depends(get_db)):
    """El candidato SOLO ve y captura los datos de sus referencias (nunca la validación ni el resultado)."""
    ev = _por_token_candidato(db, token)
    p = _post(db, ev)
    v = p.vacante if p else None
    datos = [{k: r.get(k, "") for k in sev.CAMPOS_DATOS_REFERENCIA} for r in ev.referencias or []]
    return {
        "candidato": p.nombre if p else "", "vacante": v.titulo if v else "", "empresa": nombre_empresa_candidato(v) if v else "",
        "requeridas": max(1, int(ev.referencias_requeridas or 1)), "referencias": datos,
        "cerrada": ev.estado in ("revisada", "fallida", "resultado_recibido"),
    }


@router.post("/referencias/{token}")
async def capturar_referencias_candidato(token: str, datos: ReferenciasPublicasIn, db: Session = Depends(get_db)):
    from .evaluaciones import aplicar_referencias

    ev = _por_token_candidato(db, token)
    p = _post(db, ev)
    if ev.estado in ("revisada", "fallida", "resultado_recibido"):
        raise HTTPException(409, "Tus referencias ya se recibieron. Gracias.")
    if p is not None and not p.consentimiento:
        raise HTTPException(409, "Falta tu consentimiento de privacidad para continuar.")
    limpias = [{k: (r or {}).get(k, "") for k in sev.CAMPOS_DATOS_REFERENCIA} for r in datos.referencias or [] if isinstance(r, dict)]
    for i, r in enumerate(limpias):
        r["capturada_por"] = "candidato"
        if not (r["empresa"] and r["contacto_nombre"] and r["telefono"]):
            raise HTTPException(400, f"Referencia {i + 1}: captura al menos la empresa, el nombre del contacto y su teléfono.")
    r = await aplicar_referencias(db, ev, p, limpias, "candidato", validar=False)
    registrar(db, "candidato", "referencias_capturadas_por_candidato", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "total": r["resumen"]["total"]})
    db.commit()
    return {"ok": True, "total": r["resumen"]["total"], "requeridas": r["resumen"]["requeridas"]}


@router.post("/publica/{token}/resultado")
async def registrar_resultado_externo(
    token: str, decision: str = Form(""), comentarios: str = Form(""), resumen: str = Form(""), archivo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """La persona externa registra el resultado. Exige los consentimientos vigentes (el médico, el expreso). Nunca
    mueve de etapa. Si ya se registró, se conserva el anterior en el historial (corrección)."""
    from .evaluaciones import registrar_resultado

    ev = _por_token(db, token)
    p = _post(db, ev)
    from ..services.configuracion import ambiente_prueba

    if ev.estado == "fallida" or (ev.estado == "revisada" and not ambiente_prueba()):  # prueba: se puede volver a capturar
        raise HTTPException(409, "Esta evaluación ya está cerrada; contacta al equipo de RH.")
    falta = sev.falta_consentimiento(ev, p)
    if falta:
        raise HTTPException(409, falta)
    rol = _rol(ev)
    if rol == "referencias":
        raise HTTPException(409, "Las referencias se registran una por una con su validación (sección Referencias laborales de esta liga).")
    if rol in ("medico", "franquiciatario", "encargado") and not decision.strip():
        raise HTTPException(400, "Selecciona la conclusión.")
    if rol == "socioeconomico" and not (archivo and archivo.filename) and not resumen.strip():
        raise HTTPException(400, "Adjunta el estudio (PDF) o escribe la conclusión.")
    if not decision.strip() and not resumen.strip() and not (archivo and archivo.filename):
        raise HTTPException(400, "Registra el resultado o adjunta el informe.")
    actor = ev.responsable or f"externo-{rol}"
    r = await registrar_resultado(db, ev, p, actor=actor, resumen=resumen, archivo=archivo, decision=decision, origen="liga_externa", comentarios=comentarios)
    registrar(db, actor, "evaluacion_resultado_por_liga", "postulacion", p.codigo if p else "",
              {"evaluacion": ev.codigo, "rol": rol, "decision": ev.decision_externa, "con_archivo": bool(ev.archivo)})
    db.commit()
    return {"ok": True, "estado": sev.estado_fraiche(ev), "estadoTexto": sev.etiqueta_estado_fraiche(ev), "avisos": r["avisos"],
            "decisionTexto": sev.texto_dictamen(ev)}


class NoRealizadaIn(BaseModel):
    motivo: str = ""


@router.post("/publica/{token}/no-realizada")
def no_realizada(token: str, datos: NoRealizadaIn, db: Session = Depends(get_db)):
    """«No realizada» (p. ej. el candidato no se presentó). Siempre con motivo; RH decide qué sigue."""
    ev = _por_token(db, token)
    p = _post(db, ev)
    if ev.estado in ("revisada", "fallida"):
        raise HTTPException(409, "Esta evaluación ya está cerrada.")
    motivo = datos.motivo.strip()
    if not motivo:
        raise HTTPException(400, "Indica el motivo.")
    ev.motivo_fallida, ev.no_realizada = motivo[:1000], True
    sev.mover(ev, "fallida", ev.responsable or "externo", "No realizada: " + motivo)
    registrar(db, ev.responsable or "externo", "evaluacion_no_realizada_por_liga", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "motivo": motivo[:300]})
    db.commit()
    return {"ok": True, "estado": "no_realizada", "estadoTexto": fraiche.ESTADOS_EVALUACION_EXTERNA["no_realizada"]}
