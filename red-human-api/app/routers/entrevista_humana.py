"""Módulo 1 · Reclutamiento — liga pública del entrevistador (Lote 3).

Contraparte liviana de `entrevistas.py`/`capacitacion.py`: ahí el token abre una sesión
completa con el avatar (varios endpoints, conversación, transcript). Aquí no hay nada que
conversar — es un solo formulario (Resultado, Recomendación, Comentario) de un solo submit,
así que basta con GET (contexto de solo lectura) + POST (el único envío posible). El token es
la credencial, igual que en los otros dos: sin sesión, sin login.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from typing import Optional

from ..database import get_db
from ..models import CLASES_ENTREVISTA_HUMANA, Archivo, EntrevistaHumana, registrar
from ..serial import iso, nombre_empresa_candidato
from ..services import archivos as fs
from ..services import fraiche, notificaciones

router = APIRouter(prefix="/entrevista-humana", tags=["entrevista-humana"])

RESULTADOS_ENTREVISTA_HUMANA = ("aprobado", "no_aprobado")
RECOMENDACIONES_ENTREVISTA_HUMANA = ("avanzar", "no_avanzar", "segunda_entrevista")


def _por_token(db: Session, token: str, permitir_evaluada: bool = False) -> EntrevistaHumana:
    """POST: si alguien más ya capturó el resultado, se trata como no encontrada — nunca sobreescribe
    (ver candidatos.registrar_resultado_entrevista_humana, el respaldo de RH, para la única vía que sí
    puede corregir). GET (2026-09-19): la liga sigue mostrando el expediente aunque ya esté evaluada."""
    eh = db.query(EntrevistaHumana).filter(EntrevistaHumana.token == token).first()
    if not eh or (eh.resultado_capturado_por and not permitir_evaluada):
        raise HTTPException(404, "Esta liga ya no está disponible.")
    return eh


def _expediente_para_entrevistador(db: Session, eh: EntrevistaHumana) -> dict:
    """2026-10-04 («Ficha + expediente»): CV (datos y archivos), documentos, respuestas del candidato y evaluaciones
    previas. Solo lectura y respetando el acceso: sin datos médicos ni socioeconómicos; un entrevistador externo no ve
    el teléfono ni el correo del candidato."""
    from ..models import EvaluacionCandidato
    from ..services import evaluaciones as sev

    p = eh.postulacion
    c = eh.candidato
    cv = dict((c.cv_datos or {}) if c else {})
    a = dict((p.analisis or {}) if p else {})
    externo = (eh.tipo or "") == "externo"
    archivos = [{"id": x.id, "tipo": x.tipo, "nombre": x.nombre, "mime": x.mime} for x in (c.archivos if c else [])]
    exp = p.expediente if p else None
    documentos = [{"tipo": d.tipo, "estado": d.estado, "obligatorio": d.obligatorio} for d in (exp.documentos if exp else []) if not getattr(d, "interno", False)]
    respuestas = [{"pregunta": r.get("pregunta", ""), "respuesta": r.get("respuesta", ""), "origen": "Formulario web"} for r in (a.get("respuestas_web") or []) if r.get("pregunta")]
    respuestas += [{"pregunta": r.get("pregunta", ""), "respuesta": r.get("respuesta", ""), "origen": "Conversación"}
                   for r in (a.get("respuestas_prefiltro") or []) if r.get("pregunta") and "bbva" not in f"{r.get('criterio', '')} {r.get('pregunta', '')}".lower()]
    previas = []
    for e in (p.entrevistas if p else []):
        if e.estado == "evaluada" and e.evaluacion and e.fase != "ipv":
            ev = e.evaluacion or {}
            previas.append({"nombre": "Entrevista Red Human", "resultado": f"Afinidad {ev.get('match_perfil')}/100" if ev.get("match_perfil") is not None else "Evaluada",
                            "detalle": ev.get("resumen") or "", "fecha": iso(e.finalizada_en)})
        calc = (e.evaluacion_ipv or {}).get("calculo") or {}
        if e.evaluacion_ipv:
            previas.append({"nombre": "IPV Red Human", "resultado": fraiche.texto_resultado_ipv(calc), "detalle": "", "fecha": iso(e.finalizada_en)})
    for otra in (p.entrevistas_humanas if p else []):
        if otra.id != eh.id and otra.resultado:
            previas.append({"nombre": "IPV humana" if otra.es_ipv else CLASES_ENTREVISTA_HUMANA.get(otra.clase or "reclutamiento", "Entrevista"),
                            "resultado": ("Aprobado" if otra.resultado == "aprobado" else "Rechazado") + (f" · {otra.entrevistador}" if otra.entrevistador else ""),
                            "detalle": otra.comentario or "", "fecha": iso(otra.evaluada_en or otra.fecha)})
    try:
        evs = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.postulacion_id == p.id).all() if p else []
    except Exception:  # noqa: BLE001
        evs = []
    for ev in evs:
        if ev.tipo in ("medico", "socioeconomico") or ev.estado == "fallida":
            continue
        previas.append({"nombre": ev.nombre, "resultado": sev.texto_dictamen(ev) or sev.etiqueta_estado_fraiche(ev), "detalle": "", "fecha": iso(ev.revisada_en or ev.resultado_cargado_en)})
    return {
        "candidato": {"nombre": c.nombre if c else "", "telefono": "" if externo else ((c.telefono if c else "") or ""),
                      "correo": "" if externo else ((c.correo if c else "") or "")},
        "cv": {
            "resumen": cv.get("resumen_profesional") or "", "habilidades": cv.get("habilidades") or [], "estudios": cv.get("estudios") or [],
            "idiomas": cv.get("idiomas") or [], "experiencia": cv.get("experiencia") or cv.get("experiencia_laboral") or [], "anosExperiencia": cv.get("anos_experiencia"),
        },
        "archivos": archivos,
        "documentos": documentos,
        "respuestas": respuestas[:40],
        "evaluacionesPrevias": previas,
    }


def _ficha(db: Session, eh: EntrevistaHumana) -> dict:
    from .candidatos import datos_ficha_entrevistador

    return datos_ficha_entrevistador(db, eh.postulacion, eh)


@router.get("/publica/{token}")
def publica(token: str, db: Session = Depends(get_db)):
    """La liga del entrevistador abre la FICHA (el mismo contenido que el PDF adjunto) y el formulario de evaluación.
    El expediente solo existe si RH eligió «Ficha + expediente» (se pide aparte, ver /expediente)."""
    eh = _por_token(db, token, permitir_evaluada=True)
    p = eh.postulacion
    if not p:
        raise HTTPException(404, "Esta liga ya no está disponible.")
    return {
        "candidato": eh.candidato.nombre if eh.candidato else "",
        "puesto": p.vacante.titulo if p.vacante else "",
        "empresa": nombre_empresa_candidato(p.vacante) if p.vacante else "",
        "fecha": iso(eh.fecha),
        "entrevistador": eh.entrevistador or "",
        "modalidad": eh.modalidad or "",
        "yaEvaluada": bool(eh.resultado_capturado_por),
        "resultado": eh.resultado or "",
        "recomendacion": eh.recomendacion or "",
        "comentario": eh.comentario if eh.resultado_capturado_por else "",
        "ficha": _ficha(db, eh),
        "compartir": eh.compartir or "ficha",
        "puedeVerExpediente": (eh.compartir or "ficha") == "ficha_expediente",
        # Fraiche (spec §8): Entrevista IPV con rúbrica — misma que usa Red Human
        "esIpv": bool(eh.es_ipv),
        "tipoEntrevista": "Entrevista IPV" if eh.es_ipv else CLASES_ENTREVISTA_HUMANA.get(eh.clase or "reclutamiento", "Entrevista"),
        "rubricaIpv": {
            "competencias": fraiche.COMPETENCIAS_IPV, "observaciones": fraiche.OBSERVACIONES_IPV,
            "niveles": [{"clave": n, "nombre": fraiche.NOMBRE_NIVEL_IPV[n]} for n in fraiche.NIVELES_IPV],
            "equivalencias": fraiche.equivalencias_de(db), "conclusiones": fraiche.CONCLUSIONES_IPV,
        } if eh.es_ipv else None,
        "resultadoIpv": eh.resultado_ipv or None,
    }


def _exigir_expediente(eh: EntrevistaHumana) -> None:
    if (eh.compartir or "ficha") != "ficha_expediente":
        raise HTTPException(403, "Esta liga solo comparte la ficha del candidato.")


@router.get("/publica/{token}/expediente")
def expediente_publico(token: str, db: Session = Depends(get_db)):
    """«Ver expediente»: SOLO si RH eligió «Ficha + expediente»; con «Solo ficha» → 403 (también por acceso directo)."""
    eh = _por_token(db, token, permitir_evaluada=True)
    _exigir_expediente(eh)
    registrar(db, eh.entrevistador or "entrevistador", "expediente_consultado_por_entrevistador", "postulacion", eh.postulacion.codigo if eh.postulacion else "", {"entrevista": eh.id})
    db.commit()
    return _expediente_para_entrevistador(db, eh)


@router.get("/publica/{token}/ficha.pdf")
def ficha_pdf(token: str, db: Session = Depends(get_db)):
    """El MISMO PDF que se adjuntó en el correo (generado de la misma ficha)."""
    from fastapi.responses import Response

    from ..services.pdf import pdf_ficha_presentacion

    eh = _por_token(db, token, permitir_evaluada=True)
    if not eh.postulacion:
        raise HTTPException(404, "Esta liga ya no está disponible.")
    pdf = pdf_ficha_presentacion(_ficha(db, eh))
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="ficha-{eh.postulacion.codigo}.pdf"'})


@router.get("/publica/{token}/archivo/{archivo_id}")
def archivo_publico(token: str, archivo_id: int, db: Session = Depends(get_db)):
    """CV u otro archivo del candidato para el entrevistador (la liga es la credencial)."""
    eh = _por_token(db, token, permitir_evaluada=True)
    _exigir_expediente(eh)  # los archivos son parte del expediente
    arch = db.query(Archivo).filter(Archivo.id == archivo_id, Archivo.candidato_id == eh.candidato_id).first()
    if not arch or not arch.ruta or not fs.existe(arch.ruta):
        raise HTTPException(404, "Archivo no disponible.")
    return FileResponse(arch.ruta, media_type=arch.mime or "application/octet-stream", filename=arch.nombre or "archivo")


class ResultadoEntrevistaHumanaPublicaIn(BaseModel):
    resultado: str = ""  # aprobado | no_aprobado (en una IPV se deriva de la rúbrica si no viene)
    recomendacion: str = ""  # avanzar | no_avanzar | segunda_entrevista
    comentario: str = ""
    # Fraiche (spec §8): rúbrica IPV {niveles, respuestas, evidencias, observaciones}; obligatoria si es IPV
    rubrica: Optional[dict] = None


def aplicar_rubrica_ipv(db: Session, eh: EntrevistaHumana, rubrica: Optional[dict], resultado: str, recomendacion: str):
    """Fraiche (spec §8): guarda la rúbrica y su cálculo en la EntrevistaHumana IPV. Devuelve (resultado,
    recomendacion) — los enviados si vienen; si no, los derivados de la conclusión (solo recomendación:
    ninguna puntuación mueve de etapa ni descarta por sí sola)."""
    if not eh.es_ipv:
        return resultado, recomendacion
    if not rubrica:
        raise HTTPException(400, "Una Entrevista IPV se registra con la rúbrica de competencias.")
    rub = fraiche.normalizar_rubrica(rubrica)
    calculo = fraiche.calcular_ipv(rub["niveles"], fraiche.equivalencias_de(db))
    eh.rubrica = rub
    eh.resultado_ipv = {**calculo, "evaluador": eh.entrevistador or "entrevistador", "evaluada_en": datetime.now(timezone.utc).isoformat()}
    r_der, rec_der = fraiche.resultado_desde_ipv(calculo)
    return (resultado or r_der), (recomendacion or rec_der)


@router.post("/publica/{token}")
async def enviar_resultado(token: str, datos: ResultadoEntrevistaHumanaPublicaIn, db: Session = Depends(get_db)):
    eh = _por_token(db, token)

    resultado, recomendacion = aplicar_rubrica_ipv(db, eh, datos.rubrica, datos.resultado, datos.recomendacion)
    if resultado not in RESULTADOS_ENTREVISTA_HUMANA and not (eh.es_ipv and resultado == ""):
        raise HTTPException(400, f"Resultado inválido. Usa uno de: {', '.join(RESULTADOS_ENTREVISTA_HUMANA)}")
    if recomendacion not in RECOMENDACIONES_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Recomendación inválida. Usa una de: {', '.join(RECOMENDACIONES_ENTREVISTA_HUMANA)}")
    comentario = datos.comentario.strip()  # 2026-09-19: opcional (antes obligatorio en no_aprobado / segunda)

    # Autocierre (2026-09-19): la entrevista queda realizada y confirmada con evaluación; el ciclo se cierra aquí.
    eh.realizada = True
    eh.resultado = resultado
    eh.recomendacion = recomendacion
    eh.comentario = comentario
    eh.resultado_capturado_por = "entrevistador"
    eh.evaluada_en = datetime.now(timezone.utc)
    # Fase C: actualizar resultado_apto y ultima_actividad_en de la POSTULACIÓN (Fase 2: el
    # Kanban lee de ahí, no de la persona). Se importa aquí para evitar import circular.
    from .candidatos import _recalcular_resultado_apto_y_notificar, _actualizar_ultima_actividad
    p = eh.postulacion
    if not p:
        raise HTTPException(409, "Esta entrevista no está ligada a ninguna postulación (corre scripts/migrar_postulaciones.py).")
    _actualizar_ultima_actividad(p)
    await _recalcular_resultado_apto_y_notificar(db, p, "entrevistador-externo")
    resultados = await notificaciones.disparar(db, "recomendacion_final", p, "entrevistador-externo", eh=eh)
    # 2026-09-19: aviso HTML de «entrevista completada» al candidato/cliente (regla) y a RH (responsable).
    resultados += await notificaciones.disparar(db, "entrevista_completada", p, "entrevistador-externo", eh=eh)
    aviso_rh = await notificaciones.notificar_rh_entrevista_completada(db, p, eh)
    if aviso_rh:
        resultados.append(aviso_rh)
    registrar(
        db, "entrevistador-externo", "entrevista_humana_evaluada_por_liga", "postulacion", p.codigo,
        {"candidato": p.candidato.codigo, "resultado": resultado, "recomendacion": recomendacion, "comentario": comentario, "notificaciones": resultados, "estatus": "realizada_confirmada",
         **({"ipv": {"puntaje": eh.resultado_ipv.get("puntaje"), "conclusion": eh.resultado_ipv.get("conclusion")}} if eh.es_ipv else {})},
    )
    db.commit()
    return {"ok": True, "estatus": "realizada", "mensaje": "Evaluación guardada", "notificaciones": resultados, "resultadoIpv": eh.resultado_ipv or None}
