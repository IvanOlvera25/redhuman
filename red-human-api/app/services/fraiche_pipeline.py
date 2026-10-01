"""Pipeline Fraiche v2 (2026-10-01, «Cambios integrados — Fraiche»): UN solo pipeline de cinco columnas y la
ruta (Tienda propia / Franquicia) decide qué actividades se hacen DENTRO de cada columna.

    Prefiltro → Filtro Red Human → Filtro humano → Contratación → Onboarding

Los valores internos de `Postulacion.etapa` no cambian (CLAUDE.md): «Entrevista IA» se muestra como «Filtro Red
Human» y «Entrevista Humana» como «Filtro humano». «Evaluación» deja de ser columna: nadie entra ahí y lo que
quedaba se reubica (`reubicar_evaluacion`). La «Evaluación integral» es el RESULTADO ACUMULADO de las actividades
aplicables (`avance(p)["integral"]`).

`avance(p)` es la ÚNICA fuente de: ruta, columna, actividades (resultado, pendiente, «Revisado por»), estado de
franquicia, evaluación integral, siguiente acción y qué falta para pasar a la siguiente columna. Tarjeta, ficha y
bloqueos de movimiento leen esto; nunca se recalcula en el frontend.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy.orm import object_session

from . import canal as _canal
from .fraiche import BATERIAS_EVALUATEST, NOMBRE_EVALUACION_FRANQUICIATARIO, destino_de

# ------------------------------------------------------------
# Columnas
# ------------------------------------------------------------

COLUMNAS: List[Dict[str, str]] = [
    {"etapa": "Prefiltro", "nombre": "Prefiltro"},
    {"etapa": "Entrevista IA", "nombre": "Filtro Red Human"},
    {"etapa": "Entrevista Humana", "nombre": "Filtro humano"},
    {"etapa": "Contratación", "nombre": "Contratación"},
    {"etapa": "Onboarding", "nombre": "Onboarding"},
]
ETAPAS_VISIBLES = [c["etapa"] for c in COLUMNAS]
NOMBRE_COLUMNA = {c["etapa"]: c["nombre"] for c in COLUMNAS}
NOMBRE_COLUMNA["Evaluación"] = "Filtro humano"  # legado: nunca debería verse
NOMBRE_DESTINO = {"tienda_propia": "Tienda propia", "franquicia": "Franquicia"}

# Evaluaciones que NO existen en la ruta de franquicia (spec: «Franquicia no lleva IPV ni psicometría. Tampoco
# médico interno de Fraiche, socioeconómico ni kit de precontratación de Reclutamiento»).
TIPOS_SOLO_TIENDA = ("psicometrica", "medico", "socioeconomico")

ESTADOS_FRANQUICIA_V2 = {
    "pendiente_presentar": "Pendiente de presentar",
    "presentado": "Presentado",
    "pendiente_decision": "Pendiente de decisión",
    "aceptado": "Aceptado",
    "no_aceptado": "No aceptado",
}


def nombre_columna(etapa: str) -> str:
    return NOMBRE_COLUMNA.get(etapa, etapa)


def columna(p) -> str:
    return "Entrevista Humana" if p.etapa == "Evaluación" else p.etapa


def es_franquicia(p) -> bool:
    return destino_de(p) == "franquicia"


def es_ruta_fraiche(p) -> bool:
    """La vacante usa las rutas de Fraiche (tiene sucursal/zona capturadas o es de franquicia). Las vacantes de otras
    Cuentas (sin esos datos) siguen el pipeline genérico: mismas columnas, sin actividades ni bloqueos de ruta."""
    v = getattr(p, "vacante", None)
    return bool(v and ((v.zona or "").strip() or (v.sucursal or "").strip() or v.destino == "franquicia"))


def _iso(dt) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def evaluaciones_de(p) -> list:
    from ..models import EvaluacionCandidato

    db = object_session(p)
    if db is None or p.id is None:
        return []
    try:
        return db.query(EvaluacionCandidato).filter(EvaluacionCandidato.postulacion_id == p.id).order_by(EvaluacionCandidato.id).all()
    except Exception:  # tablas de módulos no disponibles
        return []


def aplica_psicometria(p) -> bool:
    v = p.vacante
    return bool(v and v.titulo in BATERIAS_EVALUATEST) and not es_franquicia(p)


def aplica_socioeconomico(p) -> bool:
    v = p.vacante
    return bool(v and (v.titulo or "").strip().lower().startswith("cajer")) and not es_franquicia(p)


# ------------------------------------------------------------
# Actividades
# ------------------------------------------------------------

def _act(clave, nombre, etapa, estado, *, resultado="", tono="neutral", revisado_por="", fecha=None, detalle="", obligatoria=True,
         no_cumple=False, accion=None) -> dict:
    """estado ∈ hecha | en_curso | pendiente | no_aplica. `no_cumple` = resultado negativo de un requisito."""
    return {"clave": clave, "nombre": nombre, "columna": etapa, "columnaNombre": nombre_columna(etapa), "estado": estado,
            "resultado": resultado, "tono": tono, "revisadoPor": revisado_por, "fecha": _iso(fecha), "detalle": detalle,
            "obligatoria": obligatoria, "noCumple": no_cumple, "accion": accion}


def _ev_validacion(ev, nombre: str, etapa: str, clave: str) -> dict:
    """Actividad a partir de una EvaluacionCandidato (psicometría, médico, socioeconómico, referencias, franquiciatario)."""
    from . import evaluaciones as sev

    est = sev.estado_fraiche(ev)
    revisor = ev.revisada_por or ev.resultado_cargado_por or ev.responsable or ""
    if est in ("cancelada", "no_realizada"):
        return _act(clave, nombre, etapa, "pendiente", resultado=sev.etiqueta_estado_fraiche(ev), tono="warn",
                    detalle=ev.motivo_fallida or "", accion={"tipo": "agregar_evaluacion", "evaluacion": ev.tipo})
    if est == "con_resultado":
        if not ev.dictamen:
            return _act(clave, nombre, etapa, "en_curso", resultado="Resultado recibido · falta revisión", tono="warn",
                        revisado_por=revisor, fecha=ev.resultado_cargado_en, accion={"tipo": "revisar_evaluacion", "codigo": ev.codigo})
        negativo = ev.dictamen in ("desfavorable", "no_apto")
        try:
            texto = sev.texto_dictamen(ev)
        except Exception:  # noqa: BLE001
            texto = ev.dictamen
        return _act(clave, nombre, etapa, "hecha", resultado=texto or ev.dictamen, tono="bad" if negativo else ("warn" if ev.dictamen in ("con_observaciones", "apto_con_restricciones") else "good"),
                    revisado_por=revisor, fecha=ev.revisada_en or ev.resultado_cargado_en, no_cumple=negativo)
    if est == "realizada_pendiente":
        return _act(clave, nombre, etapa, "en_curso", resultado="Realizada · resultado pendiente", tono="warn", revisado_por=ev.responsable or "",
                    fecha=ev.realizada_en, accion={"tipo": "esperar_resultado", "codigo": ev.codigo})
    return _act(clave, nombre, etapa, "en_curso", resultado=sev.etiqueta_estado_fraiche(ev), tono="neutral", revisado_por=ev.responsable or "",
                fecha=ev.cita_en, accion={"tipo": "esperar_resultado", "codigo": ev.codigo})


def _actividad_eval(p, evs, tipo: str, nombre: str, clave: str, etapa: str = "Entrevista Humana") -> dict:
    vivas = [e for e in evs if e.tipo == tipo and e.estado != "fallida"]
    if vivas:
        return _ev_validacion(vivas[-1], nombre, etapa, clave)
    caidas = [e for e in evs if e.tipo == tipo]
    if caidas:
        return _ev_validacion(caidas[-1], nombre, etapa, clave)
    return _act(clave, nombre, etapa, "pendiente", resultado="Sin solicitar", accion={"tipo": "agregar_evaluacion", "evaluacion": tipo})


def _prefiltro(p) -> dict:
    a = p.analisis or {}
    web = a.get("prefiltro_web") or {}
    if web:
        r = web.get("resultado")
        if r == "no_cumple":
            return _act("formulario", "Formulario y requisitos indispensables", "Prefiltro", "hecha", resultado=web.get("etiqueta") or "No cumple",
                        tono="bad", revisado_por="Red Human (automático)", detalle=web.get("motivo", ""), no_cumple=True)
        if r == "revision":
            return _act("formulario", "Formulario y requisitos indispensables", "Prefiltro", "en_curso", resultado=web.get("etiqueta") or "Requiere revisión",
                        tono="warn", revisado_por="Red Human (automático)", detalle=web.get("motivo", ""), accion={"tipo": "revisar_prefiltro"})
        return _act("formulario", "Formulario y requisitos indispensables", "Prefiltro", "hecha", resultado=web.get("etiqueta") or "Cumple",
                    tono="good", revisado_por="Red Human (automático)", detalle=web.get("motivo", ""))
    if p.estado == "no_cumple":
        return _act("formulario", "Formulario y requisitos indispensables", "Prefiltro", "hecha", resultado="No cumple", tono="bad",
                    revisado_por="Red Human (automático)", detalle=p.evidencia or "", no_cumple=True)
    if p.prefiltro_completo or p.etapa != "Prefiltro":
        return _act("formulario", "Formulario y requisitos indispensables", "Prefiltro", "hecha", resultado="Cumple", tono="good", revisado_por="Red Human (automático)")
    return _act("formulario", "Formulario y requisitos indispensables", "Prefiltro", "pendiente", resultado="Sin respuestas todavía")


def _filtro_mensaje(p) -> dict:
    a = p.analisis or {}
    nombre = f"Filtro por {_canal.nombre()}"
    fw = a.get("prefiltro_whatsapp") or {}
    if fw:
        r = fw.get("resultado")
        return _act("filtro_mensaje", nombre, "Entrevista IA", "hecha", resultado=fw.get("etiqueta") or r or "", tono="bad" if r == "no_cumple" else "warn" if r == "revision" else "good",
                    revisado_por="Red Human (automático)", detalle=fw.get("evidencia", ""), no_cumple=r == "no_cumple")
    if p.prefiltro_completo:
        return _act("filtro_mensaje", nombre, "Entrevista IA", "hecha", resultado="Completo", tono="good", revisado_por="Red Human (automático)")
    if p.mensajes:
        return _act("filtro_mensaje", nombre, "Entrevista IA", "en_curso", resultado="Conversación en curso", accion={"tipo": "esperar_chat"})
    return _act("filtro_mensaje", nombre, "Entrevista IA", "pendiente", resultado=f"Esperando que conteste por {_canal.nombre()}", accion={"tipo": "esperar_chat"})


def _entrevista_agente(p) -> dict:
    ents = [e for e in p.entrevistas if (e.fase or "inicial") in ("inicial", "inicial_ipv")]
    if not ents:
        return _act("entrevista_agente", "Entrevista Red Human", "Entrevista IA", "pendiente", resultado="Sin programar", accion={"tipo": "invitar_entrevista_red_human"})
    e = ents[-1]
    if e.estado == "evaluada" and e.evaluacion:
        ev = e.evaluacion or {}
        rec = ev.get("recomendacion") or ""
        texto = {"avanzar": "Recomienda avanzar", "revision": "Revisar con RH", "no_avanzar": "No recomienda avanzar"}.get(rec, rec or "Evaluada")
        match = ev.get("match_perfil")
        return _act("entrevista_agente", "Entrevista Red Human", "Entrevista IA", "hecha", resultado=texto + (f" · afinidad {match}%" if match else ""),
                    tono="good" if rec == "avanzar" else "warn" if rec == "revision" else "bad", revisado_por="Red Human (IA) · decide RH", fecha=e.finalizada_en)
    if e.estado in ("interrumpida", "parcial"):
        return _act("entrevista_agente", "Entrevista Red Human", "Entrevista IA", "en_curso", resultado="Interrumpida · se puede reabrir", tono="warn", accion={"tipo": "reabrir_entrevista", "codigo": e.codigo})
    return _act("entrevista_agente", "Entrevista Red Human", "Entrevista IA", "en_curso", resultado="Programada · esperando al candidato", accion={"tipo": "esperar_entrevista"})


def _entrevista_inicial(p) -> dict:
    nombre = "Entrevista inicial de Reclutamiento" if es_franquicia(p) else "Entrevista inicial"
    ehs = [eh for eh in p.entrevistas_humanas if not eh.es_ipv and not eh.cancelada]
    if not ehs:
        return _act("entrevista_inicial", nombre, "Entrevista Humana", "pendiente", resultado="Sin agendar",
                    accion={"tipo": "agregar_evaluacion", "evaluacion": "entrevista_humana"})
    eh = ehs[-1]
    if eh.realizada and eh.resultado:
        ok = eh.resultado == "aprobado"
        return _act("entrevista_inicial", nombre, "Entrevista Humana", "hecha", resultado="Aprobada" if ok else "No aprobada", tono="good" if ok else "bad",
                    revisado_por=eh.entrevistador or "", fecha=eh.evaluada_en or eh.fecha, no_cumple=not ok)
    if eh.realizada:
        return _act("entrevista_inicial", nombre, "Entrevista Humana", "en_curso", resultado="Realizada · falta resultado", tono="warn", revisado_por=eh.entrevistador or "",
                    accion={"tipo": "registrar_entrevista"})
    return _act("entrevista_inicial", nombre, "Entrevista Humana", "en_curso", resultado="Agendada", revisado_por=eh.entrevistador or "", fecha=eh.fecha,
                accion={"tipo": "registrar_entrevista"})


def _ipv(p) -> dict:
    from .fraiche import resultado_desde_ipv  # noqa: F401  (misma regla de conclusión)

    textos = {"recomendable": "Recomendable", "bajo_reserva": "Bajo reserva", "no_recomendable": "No recomendable", "requiere_revision": "Requiere revisión"}
    mejor = None
    for eh in p.entrevistas_humanas:
        ri = eh.resultado_ipv or {}
        calc = ri if ri.get("conclusion") else (ri.get("calculo") or {})
        if eh.es_ipv and calc.get("conclusion"):
            mejor = (calc, eh.entrevistador or "Entrevistador", eh.evaluada_en or eh.fecha)
    if mejor is None:
        for e in p.entrevistas:
            calc = (e.evaluacion_ipv or {}).get("calculo") or {}
            if calc.get("conclusion"):
                mejor = (calc, "Red Human (IA) · decide RH", e.finalizada_en)
    if mejor:
        calc, quien, fecha = mejor
        concl = calc.get("conclusion")
        puntaje = calc.get("puntaje")
        return _act("ipv", "IPV", "Entrevista Humana", "hecha" if concl != "requiere_revision" else "en_curso",
                    resultado=textos.get(concl, concl) + (f" · {puntaje} pts" if puntaje is not None else ""),
                    tono="good" if concl == "recomendable" else "warn" if concl in ("bajo_reserva", "requiere_revision") else "bad",
                    revisado_por=quien, fecha=fecha, no_cumple=concl == "no_recomendable")
    pendiente_h = any(eh.es_ipv and not eh.realizada and not eh.cancelada for eh in p.entrevistas_humanas)
    if pendiente_h:
        return _act("ipv", "IPV", "Entrevista Humana", "en_curso", resultado="IPV agendada", accion={"tipo": "registrar_entrevista"})
    if any((e.fase or "") in ("ipv", "inicial_ipv") and e.estado != "evaluada" for e in p.entrevistas):
        return _act("ipv", "IPV", "Entrevista Humana", "en_curso", resultado="IPV programada con Red Human", accion={"tipo": "esperar_entrevista"})
    return _act("ipv", "IPV", "Entrevista Humana", "pendiente", resultado="Sin programar", accion={"tipo": "agregar_evaluacion", "evaluacion": "ipv"})


def estado_franquicia(p, evs=None) -> str:
    """Pendiente de presentar / Presentado / Pendiente de decisión / Aceptado / No aceptado (dentro de Filtro humano)."""
    from . import evaluaciones as sev

    evs = evs if evs is not None else evaluaciones_de(p)
    fr = [e for e in evs if sev.es_franquiciatario(e) and e.estado != "fallida"]
    if p.franquicia_estado == "aceptado" or any(e.decision_externa == "continuar" for e in fr):
        return "aceptado"
    if p.franquicia_estado == "no_aceptado" or any(e.decision_externa == "no_continuar" for e in fr):
        return "no_aceptado"
    if not fr and p.franquicia_estado != "presentado":
        return "pendiente_presentar"
    ev = fr[-1] if fr else None
    ahora = datetime.now(timezone.utc)
    cita = ev.cita_en if ev else None
    if cita is not None and cita.tzinfo is None:
        cita = cita.replace(tzinfo=timezone.utc)
    if ev and (ev.realizada_en or (cita and cita <= ahora)):
        return "pendiente_decision"
    return "presentado"


def _franquicia(p, evs) -> List[dict]:
    from . import evaluaciones as sev

    est = estado_franquicia(p, evs)
    fr = [e for e in evs if sev.es_franquiciatario(e) and e.estado != "fallida"]
    ev = fr[-1] if fr else None
    quien = (ev.responsable if ev else "") or "Franquiciatario"
    if est == "pendiente_presentar":
        pres = _act("presentacion", "Presentación al franquiciatario", "Entrevista Humana", "pendiente", resultado="Pendiente de presentar",
                    accion={"tipo": "agregar_evaluacion", "evaluacion": "presentacion_franquiciatario"})
    else:
        pres = _act("presentacion", "Presentación al franquiciatario", "Entrevista Humana", "hecha", resultado="Presentado", tono="good",
                    revisado_por="Reclutamiento", fecha=p.franquicia_presentado_en or (ev.creada_en if ev else None))
    if est == "aceptado":
        dec = _act("decision_franquiciatario", "Entrevista y decisión del franquiciatario", "Entrevista Humana", "hecha", resultado="Aceptado", tono="good",
                   revisado_por=quien, fecha=p.franquicia_decidido_en or (ev.revisada_en if ev else None))
    elif est == "no_aceptado":
        dec = _act("decision_franquiciatario", "Entrevista y decisión del franquiciatario", "Entrevista Humana", "hecha", resultado="No aceptado", tono="bad",
                   revisado_por=quien, fecha=p.franquicia_decidido_en, no_cumple=True)
    elif est == "pendiente_decision":
        dec = _act("decision_franquiciatario", "Entrevista y decisión del franquiciatario", "Entrevista Humana", "en_curso", resultado="Pendiente de decisión", tono="warn",
                   revisado_por=quien, accion={"tipo": "registrar_decision_franquiciatario"})
    elif est == "presentado":
        dec = _act("decision_franquiciatario", "Entrevista y decisión del franquiciatario", "Entrevista Humana", "en_curso", resultado="Esperando entrevista con el franquiciatario",
                   revisado_por=quien, fecha=ev.cita_en if ev else None, accion={"tipo": "registrar_decision_franquiciatario"})
    else:
        dec = _act("decision_franquiciatario", "Entrevista y decisión del franquiciatario", "Entrevista Humana", "pendiente", resultado="Después de la presentación")
    return [pres, dec]


def _contratacion_tienda(p) -> dict:
    e = p.expediente
    if not e:
        return _act("contratacion", "Condiciones y documentación de contratación", "Contratación", "pendiente", resultado="Sin expediente")
    falta = []
    if not e.condiciones_guardadas_en:
        falta.append("condiciones")
    if (e.progreso or 0) < 100:
        falta.append(f"documentos ({e.progreso or 0} %)")
    if not falta:
        return _act("contratacion", "Condiciones y documentación de contratación", "Contratación", "hecha", resultado="Completa", tono="good",
                    revisado_por=e.seleccionado_por or "", fecha=e.condiciones_guardadas_en)
    return _act("contratacion", "Condiciones y documentación de contratación", "Contratación", "en_curso", resultado="Falta: " + ", ".join(falta), tono="warn",
                revisado_por=e.seleccionado_por or "", accion={"tipo": "expediente"})


def _onboarding_tienda(p) -> List[dict]:
    from .fraiche import ESTADO_LISTO_SAP

    e = p.expediente
    if not e:
        return [_act("ingreso", "Documentación de ingreso y preparación del alta", "Onboarding", "pendiente"),
                _act("sap", "Listo para enviar a SAP", "Onboarding", "pendiente")]
    hecho_ingreso = bool(e.fecha_ingreso_real or e.estado == "alta")
    ingreso = _act("ingreso", "Documentación de ingreso y preparación del alta", "Onboarding", "hecha" if hecho_ingreso else "en_curso",
                   resultado="Ingreso confirmado" if hecho_ingreso else "En preparación", tono="good" if hecho_ingreso else "neutral",
                   revisado_por=e.ingreso_confirmado_por or "", fecha=e.fecha_ingreso_real, accion=None if hecho_ingreso else {"tipo": "expediente"})
    listo = e.estado_sap == ESTADO_LISTO_SAP
    # NUNCA «Enviado»: no existe envío real a SAP (spec).
    sap = _act("sap", "Listo para enviar a SAP", "Onboarding", "hecha" if listo else "pendiente",
               resultado="Listo para enviar a SAP · conexión con SAP pendiente de configurar" if listo else "Datos para alta sin confirmar",
               tono="good" if listo else "neutral", revisado_por=e.sap_confirmado_por or "", fecha=e.sap_confirmado_en,
               accion=None if listo else {"tipo": "preparar_alta_sap"})
    return [ingreso, sap]


def actividades(p, evs=None) -> List[dict]:
    evs = evs if evs is not None else evaluaciones_de(p)
    acts = [_prefiltro(p), _filtro_mensaje(p), _entrevista_agente(p), _entrevista_inicial(p)]
    if not es_ruta_fraiche(p):
        return acts
    if es_franquicia(p):
        acts += _franquicia(p, evs)
        acts.append(_act("contratacion_franquicia", "Confirmación de contratación del franquiciatario", "Contratación",
                         "hecha" if p.franquicia_contratado_en else "pendiente",
                         resultado="Confirmada" if p.franquicia_contratado_en else "Pendiente de registrar", tono="good" if p.franquicia_contratado_en else "neutral",
                         revisado_por=p.franquicia_contratado_por or "", fecha=p.franquicia_contratado_en,
                         accion=None if p.franquicia_contratado_en else {"tipo": "confirmar_contratacion_franquicia"}))
        acts.append(_act("ingreso_franquicia", "Ingreso confirmado por el franquiciatario", "Onboarding",
                         "hecha" if p.franquicia_ingreso_en else "pendiente",
                         resultado="Ingreso confirmado" if p.franquicia_ingreso_en else "Pendiente de registrar", tono="good" if p.franquicia_ingreso_en else "neutral",
                         revisado_por=p.franquicia_ingreso_por or "", fecha=p.franquicia_ingreso_en,
                         accion=None if p.franquicia_ingreso_en else {"tipo": "confirmar_ingreso_franquicia"}))
        return acts
    acts.append(_ipv(p))
    if aplica_psicometria(p):
        acts.append(_actividad_eval(p, evs, "psicometrica", "Psicometría", "psicometria"))
    acts.append(_actividad_eval(p, evs, "medico", "Estudio médico", "medico"))
    if aplica_socioeconomico(p):
        acts.append(_actividad_eval(p, evs, "socioeconomico", "Estudio socioeconómico", "socioeconomico"))
    acts.append(_actividad_eval(p, evs, "referencias", "Referencias laborales", "referencias"))
    acts.append(_contratacion_tienda(p))
    acts += _onboarding_tienda(p)
    return acts


# ------------------------------------------------------------
# Resultado acumulado, bloqueos y siguiente acción
# ------------------------------------------------------------

def _orden(etapa: str) -> int:
    return ETAPAS_VISIBLES.index(etapa) if etapa in ETAPAS_VISIBLES else 0


def faltantes_para(p, destino_etapa: str, acts: Optional[List[dict]] = None) -> List[str]:
    """Qué falta EXACTAMENTE para pasar a `destino_etapa`: toda actividad obligatoria de las columnas anteriores
    tiene que estar hecha, y ningún requisito obligatorio puede estar en «No cumple»."""
    acts = acts if acts is not None else actividades(p)
    previas = [a for a in acts if _orden(a["columna"]) < _orden(destino_etapa) and a["obligatoria"] and a["estado"] != "no_aplica"]
    falta = []
    for a in previas:
        if a["noCumple"]:
            falta.append(f"{a['nombre']}: {a['resultado']} (requisito obligatorio no cumplido)")
        elif a["estado"] != "hecha":
            falta.append(f"{a['nombre']}: {a['resultado'] or 'pendiente'}")
    return falta


def integral(p, acts: List[dict]) -> dict:
    """Evaluación integral = resultado acumulado. Un requisito obligatorio «No cumple» prevalece sobre un score alto."""
    aplicables = [a for a in acts if a["estado"] != "no_aplica" and _orden(a["columna"]) <= _orden("Entrevista Humana")]
    no_cumplidos = [a["nombre"] for a in aplicables if a["noCumple"]]
    cumplidos = [a["nombre"] for a in aplicables if a["estado"] == "hecha" and not a["noCumple"]]
    pendientes = [a["nombre"] for a in aplicables if a["estado"] != "hecha"]
    score = p.score or None
    if no_cumplidos:
        conclusion, texto = "no_apto", "No apto: " + ", ".join(no_cumplidos) + (f" (prevalece sobre el score {score})" if score else "")
    elif pendientes:
        conclusion, texto = "en_proceso", f"En proceso: {len(cumplidos)} de {len(aplicables)} validaciones completas"
    else:
        conclusion, texto = "apto", "Apto: todas las validaciones aplicables están completas"
    return {"conclusion": conclusion, "texto": texto, "score": score, "cumplidos": cumplidos, "pendientes": pendientes, "noCumplidos": no_cumplidos,
            "resultados": [{"nombre": a["nombre"], "resultado": a["resultado"], "tono": a["tono"], "revisadoPor": a["revisadoPor"]} for a in aplicables if a["estado"] in ("hecha", "en_curso")]}


def siguiente_accion(p, acts: List[dict], integ: dict) -> dict:
    col = columna(p)
    if not p.activa:
        return {"tipo": "ninguna", "texto": "Postulación cerrada"}
    if integ["conclusion"] == "no_apto":
        return {"tipo": "no_cumple", "texto": "No cumple un requisito obligatorio: revisa y decide (descartar o reconsiderar)"}
    for a in acts:
        if a["columna"] == col and a["estado"] != "hecha" and a["obligatoria"]:
            acc = dict(a["accion"] or {"tipo": "esperar"})
            textos = {
                "agregar_evaluacion": f"Agregar evaluación: {a['nombre']}",
                "revisar_evaluacion": f"Revisar resultado: {a['nombre']}",
                "esperar_resultado": f"Esperar resultado: {a['nombre']}",
                "registrar_entrevista": f"Registrar resultado: {a['nombre']}",
                "registrar_decision_franquiciatario": "Registrar la decisión del franquiciatario",
                "confirmar_contratacion_franquicia": "Registrar la confirmación de contratación del franquiciatario",
                "confirmar_ingreso_franquicia": "Registrar el ingreso confirmado por el franquiciatario",
                "esperar_chat": f"Esperar respuestas por {_canal.nombre()}",
                "esperar_entrevista": "Esperar a que el candidato haga la Entrevista Red Human",
                "invitar_entrevista_red_human": "Invitar a la Entrevista Red Human",
                "reabrir_entrevista": "Reabrir la Entrevista Red Human",
                "revisar_prefiltro": "Revisar requisitos del prefiltro",
                "expediente": "Completar el expediente de contratación",
                "preparar_alta_sap": "Preparar alta: confirmar datos para SAP",
            }
            acc["texto"] = textos.get(acc["tipo"], f"Pendiente: {a['nombre']}" + (f" ({a['resultado']})" if a.get("resultado") else ""))
            acc["actividad"] = a["clave"]
            return acc
    # todo lo de esta columna está hecho → avanzar
    idx = _orden(col)
    if col == "Entrevista IA":
        return {"tipo": "agregar_evaluacion", "evaluacion": "entrevista_humana", "texto": "Agregar evaluación: Entrevista humana (pasa a Filtro humano)"}
    if col == "Prefiltro":
        return {"tipo": "mover", "etapa": "Entrevista IA", "texto": "Pasar a Filtro Red Human"}
    if col == "Onboarding":
        if es_franquicia(p):
            return {"tipo": "ninguna", "texto": "Proceso completo: ingreso confirmado por el franquiciatario"}
        return {"tipo": "alta", "texto": "Dar de alta como colaborador / cerrar Onboarding"}
    if idx + 1 < len(ETAPAS_VISIBLES):
        destino = ETAPAS_VISIBLES[idx + 1]
        return {"tipo": "mover", "etapa": destino, "texto": f"Pasar a {nombre_columna(destino)}"}
    return {"tipo": "ninguna", "texto": ""}


def avance(p) -> dict:
    evs = evaluaciones_de(p)
    acts = actividades(p, evs)
    integ = integral(p, acts)
    col = columna(p)
    idx = _orden(col)
    siguiente_col = ETAPAS_VISIBLES[idx + 1] if idx + 1 < len(ETAPAS_VISIBLES) else None
    faltan = faltantes_para(p, siguiente_col, acts) if siguiente_col else []
    return {
        "destino": destino_de(p) if es_ruta_fraiche(p) else "",
        "ruta": NOMBRE_DESTINO.get(destino_de(p), "Tienda propia") if es_ruta_fraiche(p) else "",
        "columna": col,
        "columnaNombre": nombre_columna(col),
        "actividades": acts,
        "realizadas": [a["nombre"] for a in acts if a["estado"] == "hecha"],
        "pendientes": [a["nombre"] for a in acts if a["estado"] != "hecha" and a["columna"] == col],
        "integral": integ,
        "franquiciaEstado": estado_franquicia(p, evs) if es_franquicia(p) else None,
        "franquiciaEstadoTexto": ESTADOS_FRANQUICIA_V2.get(estado_franquicia(p, evs)) if es_franquicia(p) else None,
        "siguienteAccion": siguiente_accion(p, acts, integ),
        "siguienteColumna": siguiente_col,
        "puedeAvanzar": bool(siguiente_col) and not faltan,
        "faltaParaAvanzar": faltan,
    }


# ------------------------------------------------------------
# Reglas de movimiento y ajustes de ruta
# ------------------------------------------------------------

def validar_movimiento(p, destino_etapa: str) -> List[str]:
    """Bloqueos al avanzar hacia `destino_etapa` (solo hacia adelante). Lista vacía = puede pasar."""
    if destino_etapa == "Evaluación":
        return ["La columna «Evaluación» ya no existe: la evaluación integral es un resultado en la ficha."]
    if _orden(destino_etapa) <= _orden(columna(p)):
        return []
    if destino_etapa in ("Contratación", "Onboarding") and es_ruta_fraiche(p):
        return faltantes_para(p, destino_etapa)
    return []


def ajustar_por_cambio_de_ruta(db, v, anterior: str, nuevo: str, actor: str) -> int:
    """La vacante cambió de Tienda propia ↔ Franquicia: las actividades PENDIENTES que ya no aplican se cancelan
    (con motivo); los resultados ya recibidos y el historial se conservan. Regresa cuántas se ajustaron."""
    from ..models import EvaluacionCandidato, Postulacion, registrar

    if anterior == nuevo:
        return 0
    n = 0
    motivo = f"No aplica a la ruta {NOMBRE_DESTINO.get(nuevo, nuevo)} (la vacante cambió de clasificación)."
    ahora = datetime.now(timezone.utc)
    for p in db.query(Postulacion).filter(Postulacion.vacante_id == v.id, Postulacion.activa.is_(True)).all():
        for ev in db.query(EvaluacionCandidato).filter(EvaluacionCandidato.postulacion_id == p.id).all():
            if ev.estado in ("resultado_recibido", "revisada", "fallida"):
                continue
            no_aplica = (nuevo == "franquicia" and ev.tipo in TIPOS_SOLO_TIENDA) or (
                nuevo != "franquicia" and ev.tipo == "otra" and (ev.nombre or "").strip().lower() == NOMBRE_EVALUACION_FRANQUICIATARIO.lower())
            if no_aplica:
                ev.historial = list(ev.historial or []) + [{"fecha": ahora.isoformat(), "usuario": actor, "de": ev.estado, "a": "fallida", "detalle": motivo}]
                ev.estado, ev.motivo_fallida = "fallida", motivo
                n += 1
        if nuevo == "franquicia":
            for eh in p.entrevistas_humanas:
                if eh.es_ipv and not eh.realizada and not eh.cancelada:
                    eh.cancelada = True
                    n += 1
        p.historial = list(p.historial or []) + [{"evento": "ruta_cambiada", "texto": f"La vacante pasó de {NOMBRE_DESTINO.get(anterior, anterior)} a {NOMBRE_DESTINO.get(nuevo, nuevo)}: se ajustaron las actividades pendientes; resultados e historial se conservan.",
                                                  "usuario": actor, "fecha": ahora.isoformat()}]
        registrar(db, actor, "ruta_postulacion_ajustada", "postulacion", p.codigo, {"de": anterior, "a": nuevo})
    return n


def reubicar_evaluacion(db) -> int:
    """Las postulaciones que quedaron en la columna retirada «Evaluación» pasan a Filtro humano si ya tienen alguna
    actividad humana (entrevista humana o evaluación), si no regresan a Filtro Red Human. Idempotente."""
    from ..models import Postulacion, registrar

    n = 0
    for p in db.query(Postulacion).filter(Postulacion.etapa == "Evaluación").all():
        humana = bool(p.entrevistas_humanas) or bool(evaluaciones_de(p))
        p.etapa = "Entrevista Humana" if humana else "Entrevista IA"
        registrar(db, "sistema", "etapa_reubicada_pipeline_v2", "postulacion", p.codigo, {"de": "Evaluación", "a": p.etapa})
        n += 1
    return n


def limpiar_franquicias(db, actor: str = "sistema") -> int:
    """Franquicia no lleva IPV, psicometría, médico ni socioeconómico: lo PENDIENTE se cancela con motivo (los
    resultados ya recibidos se conservan). Idempotente."""
    from ..models import EvaluacionCandidato, Postulacion, Vacante

    n = 0
    motivo = "No aplica a la ruta Franquicia (sin IPV, psicometría, médico ni socioeconómico de Fraiche)."
    ahora = datetime.now(timezone.utc).isoformat()
    posts = db.query(Postulacion).join(Vacante, Vacante.id == Postulacion.vacante_id).filter(Vacante.destino == "franquicia", Postulacion.activa.is_(True)).all()
    for p in posts:
        for ev in evaluaciones_de(p):
            if ev.tipo in TIPOS_SOLO_TIENDA and ev.estado not in ("resultado_recibido", "revisada", "fallida"):
                ev.historial = list(ev.historial or []) + [{"fecha": ahora, "usuario": actor, "de": ev.estado, "a": "fallida", "detalle": motivo}]
                ev.estado, ev.motivo_fallida = "fallida", motivo
                n += 1
        for eh in p.entrevistas_humanas:
            if eh.es_ipv and not eh.realizada and not eh.cancelada:
                eh.cancelada = True
                n += 1
    return n


def reabrir_aceptados_franquicia(db) -> int:
    """Antes «Aceptado» cerraba la postulación; ahora sigue a Contratación (RH registra la confirmación del
    franquiciatario). Las cerradas con `aceptado_franquicia` se reabren en Filtro humano. Idempotente."""
    from ..models import Postulacion, registrar

    n = 0
    for p in db.query(Postulacion).filter(Postulacion.activa.is_(False), Postulacion.motivo_cierre == "aceptado_franquicia").all():
        p.activa, p.motivo_cierre, p.cerrada_en = True, "", None
        p.etapa = "Entrevista Humana"
        p.franquicia_estado = "aceptado"
        registrar(db, "sistema", "postulacion_reabierta_pipeline_v2", "postulacion", p.codigo, {"motivo": "aceptado_franquicia ya no cierra"})
        n += 1
    return n


def refrescar_guiones(db) -> int:
    """Aplica la corrección del guion a las entrevistas Red Human YA configuradas que aún no se hacen: sin sueldo,
    disponibilidad «¿Cuándo podrías empezar a trabajar en Fraiche?» y nombre visible de la empresa. Idempotente."""
    from ..models import Entrevista
    from ..serial import nombre_empresa_candidato
    from . import fraiche, ia

    n = 0
    for e in db.query(Entrevista).filter(Entrevista.estado.in_(("programada", "en_curso"))).all():
        if (e.fase or "inicial") not in ("inicial", "inicial_ipv") or not e.postulacion or not e.postulacion.vacante:
            continue
        g = e.guion or {}
        texto = " ".join([str(g.get("enfoque", ""))] + [str(x) for x in (g.get("preguntas") or [])] + [str(x) for x in (g.get("temas") or [])]).lower()
        if not ("salari" in texto or "sueldo" in texto or "a partir de cuándo podrías iniciar" in texto):
            continue
        v = e.postulacion.vacante
        if not es_ruta_fraiche(e.postulacion):
            continue
        guion = ia.guion_entrevista_inicial_fraiche(v.titulo, fraiche.contexto_previo_entrevista(e.postulacion.analisis),
                                                     enfoque_entrevista=v.enfoque_entrevista or "profesional", empresa=nombre_empresa_candidato(v))
        e.guion = guion.model_dump()
        n += 1
    return n

