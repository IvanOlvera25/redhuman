"""Evaluaciones y verificaciones del candidato (2026-09-28) — lógica interna, sin proveedores externos todavía.

* Consentimientos ANTES de enviar/asignar: el general de la postulación (LFPDPPP) para todo; para el estudio
  MÉDICO además uno expreso y por escrito por medio electrónico (texto exacto + aceptación + evidencia). Sin él la
  evaluación queda «En espera de consentimiento» y no se puede enviar ni cargar resultado.
* Seguimiento: Pendiente → En proceso → Resultado recibido → Revisada; Fallida/Cancelada siempre con motivo.
* Modo Integrada simulado: Asignada → Enviada → Iniciada → Completada → Resultado recibido (a mano por ahora).
* Nada de aquí escribe `Postulacion.etapa` (no hay columnas nuevas en el pipeline) ni usa IA: RH revisa y dictamina.
"""

from datetime import datetime, timezone
from typing import List, Optional

from ..models import (
    DICTAMENES_GENERALES,
    DICTAMENES_MEDICOS,
    ESTADO_POR_PASO,
    ESTADOS_EVALUACION,
    MODOS_PRUEBA,
    PASOS_INTEGRADA,
    TIPOS_EVALUACION,
    EvaluacionCandidato,
    Postulacion,
)

ESTADOS_ABIERTOS = ("en_espera_consentimiento", "pendiente", "en_proceso", "resultado_recibido")


def dictamenes_de(tipo: str) -> dict:
    return DICTAMENES_MEDICOS if tipo == "medico" else DICTAMENES_GENERALES


def consentimiento_ok(ev: EvaluacionCandidato, p: Optional[Postulacion]) -> bool:
    """General (postulación) para todas; el médico exige además el expreso por escrito ya aceptado."""
    if not (p and p.consentimiento):
        return False
    if ev.requiere_consentimiento_expreso:
        return bool(ev.consentimiento_aceptado_en)
    return True


def falta_consentimiento(ev: EvaluacionCandidato, p: Optional[Postulacion]) -> str:
    if not (p and p.consentimiento):
        return "Falta el consentimiento de privacidad del candidato (LFPDPPP)."
    if ev.requiere_consentimiento_expreso and not ev.consentimiento_aceptado_en:
        return "Falta el consentimiento expreso y por escrito del candidato para el estudio médico."
    return ""


def mover(ev: EvaluacionCandidato, estado: str, usuario: str, detalle: str = "") -> None:
    """Cambia el estado de seguimiento y lo deja en el historial de la evaluación."""
    if estado == ev.estado and not detalle:
        return
    ev.historial = list(ev.historial or []) + [
        {"fecha": datetime.now(timezone.utc).isoformat(), "usuario": usuario, "de": ev.estado, "a": estado, "detalle": detalle[:500]}
    ]
    ev.estado = estado


def refrescar_consentimiento(ev: EvaluacionCandidato, p: Optional[Postulacion], usuario: str = "sistema") -> bool:
    """«En espera de consentimiento» ↔ «Pendiente» según los consentimientos vigentes. Regresa si cambió."""
    ok = consentimiento_ok(ev, p)
    if ev.estado == "en_espera_consentimiento" and ok:
        mover(ev, "pendiente", usuario, "Consentimiento registrado")
        if ev.modo == "integrada" and not ev.paso_integrada:
            ev.paso_integrada = "asignada"
        return True
    if ev.estado == "pendiente" and not ok:
        mover(ev, "en_espera_consentimiento", usuario, falta_consentimiento(ev, p))
        return True
    return False


def siguiente_paso(ev: EvaluacionCandidato) -> Optional[str]:
    if ev.modo != "integrada":
        return None
    actual = ev.paso_integrada or "asignada"
    i = PASOS_INTEGRADA.index(actual) if actual in PASOS_INTEGRADA else 0
    return PASOS_INTEGRADA[i + 1] if i + 1 < len(PASOS_INTEGRADA) else None


def aplicar_paso(ev: EvaluacionCandidato, paso: str, usuario: str, origen: str = "simulado") -> None:
    """`origen`: «simulado» (RH a mano) o el nombre del proveedor cuando el paso lo reporta su API/webhook."""
    ev.paso_integrada = paso
    mover(ev, ESTADO_POR_PASO[paso], usuario, f"Modo integrada ({origen}): {paso}")


def normalizar_sugeridas(lista: List[dict], pruebas_validas: dict) -> List[dict]:
    """Sugerencias de la vacante: [{tipo, prueba_id?, nombre?}] sin duplicados; la prueba debe ser del catálogo."""
    salida, vistos = [], set()
    for x in lista or []:
        tipo = str((x or {}).get("tipo") or "").strip()
        if tipo not in TIPOS_EVALUACION:
            continue
        prueba_id = (x or {}).get("prueba_id")
        try:
            prueba_id = int(prueba_id) if prueba_id not in (None, "") else None
        except (TypeError, ValueError):
            prueba_id = None
        if prueba_id is not None and prueba_id not in pruebas_validas:
            prueba_id = None
        nombre = str((x or {}).get("nombre") or "").strip()[:200] or (pruebas_validas.get(prueba_id) if prueba_id else TIPOS_EVALUACION[tipo])
        clave = (tipo, prueba_id, nombre.lower())
        if clave in vistos:
            continue
        vistos.add(clave)
        salida.append({"tipo": tipo, "prueba_id": prueba_id, "nombre": nombre})
    return salida


def avisos_antes_onboarding(p: Postulacion, evaluaciones: List[EvaluacionCandidato]) -> List[str]:
    """Si la vacante pide «Avisar antes de Onboarding»: qué sugeridas faltan, cuáles no están revisadas y cuáles
    salieron desfavorables. Solo AVISA (RH decide); nunca bloquea."""
    v = p.vacante
    if not v or not v.avisar_evaluaciones_antes_onboarding:
        return []
    avisos = []
    vivas = [e for e in evaluaciones if e.estado != "fallida"]
    for s in v.evaluaciones_sugeridas or []:
        hay = any(e.tipo == s.get("tipo") and (not s.get("prueba_id") or e.prueba_id == s.get("prueba_id")) for e in vivas)
        if not hay:
            avisos.append(f"Sugerida por la vacante y no asignada: {s.get('nombre') or TIPOS_EVALUACION.get(s.get('tipo'), '')}.")
    for e in vivas:
        if e.estado != "revisada":
            avisos.append(f"{e.nombre}: {ESTADOS_EVALUACION.get(e.estado, e.estado)} (sin revisar).")
        elif e.dictamen in ("desfavorable", "no_apto"):
            avisos.append(f"{e.nombre}: dictamen {dictamenes_de(e.tipo).get(e.dictamen, e.dictamen)}.")
    return avisos


def etiqueta_modo(modo: str) -> str:
    return MODOS_PRUEBA.get(modo, modo)


# ---------- Demo Fraiche (spec §9-10, 2026-09-29) ----------

from . import cifrado as _cif  # noqa: E402
from . import fraiche as _fr  # noqa: E402

CAMPOS_MEDICOS_CIFRADOS = ("resultado_resumen", "comentario_revision", "notas", "resumen_ia")


def estado_fraiche(ev: EvaluacionCandidato) -> str:
    """Estados del spec §10 sobre el seguimiento interno: Pendiente / Realizada con resultado pendiente /
    Con resultado / No realizada / Cancelada. Referencias (2026-10-05): «Completado» o «En proceso»."""
    if ev.tipo == "referencias" and ev.estado != "fallida":
        if referencias_completas(ev) or (ev.estado == "revisada" and ev.dictamen):  # legado: ya concluidas por RH
            return "completado"
        return "en_proceso" if ev.referencias else "pendiente"
    if ev.estado == "fallida":
        return "no_realizada" if ev.no_realizada else "cancelada"
    if ev.estado in ("resultado_recibido", "revisada"):
        return "con_resultado"
    if ev.realizada_en:
        return "realizada_pendiente"
    return "pendiente"


def etiqueta_estado_fraiche(ev: EvaluacionCandidato) -> str:
    return _fr.ESTADOS_EVALUACION_EXTERNA.get(estado_fraiche(ev), ESTADOS_EVALUACION.get(ev.estado, ev.estado))


def guardar_texto(ev: EvaluacionCandidato, campo: str, valor: str) -> None:
    """Escribe un campo de texto; en una evaluación MÉDICA queda cifrado (spec §10)."""
    valor = (valor or "")[:5000]
    if ev.es_medico and campo in CAMPOS_MEDICOS_CIFRADOS:
        setattr(ev, campo, _cif.cifrar(valor))
        ev.cifrado = True
    else:
        setattr(ev, campo, valor)


def leer_texto(ev: EvaluacionCandidato, campo: str) -> str:
    """Lee un campo de texto descifrándolo si hace falta. SOLO llamar para quien tiene permiso (el serializador
    ya recorta el informe médico para el resto)."""
    return _cif.descifrar(getattr(ev, campo) or "")


def dictamen_interno_medico(decision: str) -> Optional[str]:
    """Apto / Apto condicionado / No recomendable (spec) → Favorable / Con observaciones / Desfavorable. Acepta
    también los valores previos (apto_con_restricciones, no_apto) para no romper registros anteriores."""
    mapa = {**_fr.DICTAMEN_MEDICO_A_INTERNO, "apto_con_restricciones": "con_observaciones", "no_apto": "desfavorable"}
    return mapa.get(decision)


def texto_decision_medica(decision: str) -> str:
    return {**_fr.DICTAMEN_MEDICO_FRAICHE, **DICTAMENES_MEDICOS}.get(decision, "")


def dictamenes_visibles(ev: EvaluacionCandidato) -> dict:
    """Opciones que se ofrecen en la UI: médico → Apto / Apto condicionado / No recomendable; franquiciatario →
    Continuar / No continuar; el resto → Favorable / Con observaciones / Desfavorable."""
    if ev.es_medico:
        return dict(_fr.DICTAMEN_MEDICO_FRAICHE)
    if es_franquiciatario(ev):
        return dict(_fr.DECISIONES_FRANQUICIATARIO)
    return dict(DICTAMENES_GENERALES)


def es_franquiciatario(ev: EvaluacionCandidato) -> bool:
    return ev.tipo == "otra" and (ev.nombre or "").strip().lower() == _fr.NOMBRE_EVALUACION_FRANQUICIATARIO.lower()


def es_encargado(ev: EvaluacionCandidato) -> bool:
    return ev.tipo == "otra" and (ev.nombre or "").strip().lower() == _fr.NOMBRE_EVALUACION_ENCARGADO.lower()


def aplicar_decision(ev: EvaluacionCandidato, decision: str) -> str:
    """Guarda la decisión tal como la eligió quien evaluó y su equivalente interno en `dictamen`. Regresa el
    texto visible. Lanza ValueError si la decisión no aplica al tipo."""
    d = (decision or "").strip().lower()
    if ev.es_medico:
        interno = dictamen_interno_medico(d)
        if not interno:
            raise ValueError("El dictamen médico es Apto, Apto condicionado o No recomendable.")
        ev.decision_externa, ev.dictamen = d, interno
        return texto_decision_medica(d)
    if es_franquiciatario(ev):
        if d not in _fr.DECISIONES_FRANQUICIATARIO:
            raise ValueError("La decisión del franquiciatario es Continuar o No continuar.")
        ev.decision_externa, ev.dictamen = d, _fr.DECISION_FRANQUICIATARIO_A_INTERNO[d]
        return _fr.DECISIONES_FRANQUICIATARIO[d]
    if d not in DICTAMENES_GENERALES:
        raise ValueError("La conclusión es Favorable, Con observaciones o Desfavorable.")
    ev.decision_externa, ev.dictamen = d, d
    return DICTAMENES_GENERALES[d]


def texto_dictamen(ev: EvaluacionCandidato) -> str:
    if not ev.dictamen:
        return ""
    if ev.decision_externa:
        return (texto_decision_medica(ev.decision_externa) if ev.es_medico else
                _fr.DECISIONES_FRANQUICIATARIO.get(ev.decision_externa) if es_franquiciatario(ev) else
                DICTAMENES_GENERALES.get(ev.decision_externa)) or DICTAMENES_GENERALES.get(ev.dictamen, ev.dictamen)
    return {**DICTAMENES_GENERALES, **DICTAMENES_MEDICOS}.get(ev.dictamen, ev.dictamen)


def archivar_resultado_previo(ev: EvaluacionCandidato, usuario: str) -> None:
    """Spec §10: «Una corrección conserva el resultado anterior en el historial»."""
    if not (ev.resultado_cargado_en or ev.dictamen):
        return
    ev.historial = list(ev.historial or []) + [{
        "fecha": datetime.now(timezone.utc).isoformat(), "usuario": usuario, "de": ev.estado, "a": ev.estado,
        "detalle": "Corrección: se conserva el resultado anterior",
        "resultado_anterior": {
            "dictamen": ev.dictamen, "decision": ev.decision_externa, "origen": ev.origen_resultado,
            "resumen": ("[cifrado]" if ev.es_medico else (ev.resultado_resumen or "")[:500]),
            "cargado_por": ev.resultado_cargado_por, "cargado_en": ev.resultado_cargado_en.isoformat() if ev.resultado_cargado_en else None,
            "archivo": ev.nombre_archivo or "",
        },
    }]


# ---------- Referencias laborales estructuradas (2026-10-02, cambios integrados §10) ----------
# Datos (los captura el candidato por su liga o el responsable): empresa, puesto del candidato, periodo, contacto
# (nombre, cargo, relación, teléfono, correo opcional). Validación (SOLO el responsable/RH): quién contestó, cargo,
# fecha, medio, confirmación de puesto y periodo, desempeño, motivo de salida, ¿lo volverían a contratar?,
# observaciones, resultado e informe. Capturar contactos NO es validarlos; no contestar NO es desfavorable.

ESTADOS_REFERENCIA = {"pendiente_datos": "Pendiente de datos", "por_contactar": "Por contactar", "no_contactada": "No contactada", "validada": "Validada"}
RESULTADOS_REFERENCIA = {"favorable": "Favorable", "con_observaciones": "Con observaciones", "desfavorable": "Desfavorable"}
SI_NO_NI = ("si", "no", "no_informado")
CAMPOS_DATOS_REFERENCIA = ("empresa", "puesto_candidato", "periodo", "contacto_nombre", "contacto_cargo", "relacion", "telefono", "correo")
CAMPOS_VALIDACION_REFERENCIA = ("contesto_nombre", "contesto_cargo", "fecha_contacto", "medio", "confirma_puesto", "confirma_periodo",
                                "desempeno", "motivo_salida", "recontrataria", "observaciones", "resultado", "no_contactada", "intentos")


def _txt(r: dict, k: str, n: int = 200) -> str:
    return str(r.get(k) or "").strip()[:n]


def estado_referencia(r: dict) -> str:
    if not (r.get("empresa") and r.get("contacto_nombre") and r.get("telefono")):
        return "pendiente_datos"
    if r.get("resultado") in RESULTADOS_REFERENCIA and r.get("fecha_contacto"):
        return "validada"
    if r.get("no_contactada"):
        return "no_contactada"
    return "por_contactar"


def normalizar_referencias(lista: List[dict], previas: Optional[List[dict]] = None, validar: bool = True) -> List[dict]:
    """`validar=False` (liga del candidato): solo se toman los DATOS; la validación previa se conserva tal cual.
    Acepta el formato anterior (contacto, puesto, fecha_verificacion, comentarios) para no perder registros."""
    previas = previas or []
    salida = []
    for i, r in enumerate(lista or []):
        if not isinstance(r, dict):
            continue
        ant = previas[i] if i < len(previas) and isinstance(previas[i], dict) else {}
        d = {
            "empresa": _txt(r, "empresa", 150), "puesto_candidato": _txt(r, "puesto_candidato", 120) or _txt(r, "puesto", 120),
            "periodo": _txt(r, "periodo", 80), "contacto_nombre": _txt(r, "contacto_nombre", 150) or _txt(r, "contacto", 150),
            "contacto_cargo": _txt(r, "contacto_cargo", 120), "relacion": _txt(r, "relacion", 120),
            "telefono": _txt(r, "telefono", 30), "correo": _txt(r, "correo", 200),
        }
        if not any(d.values()):
            continue
        if validar:
            resultado = _txt(r, "resultado", 30).lower()
            v = {
                "contesto_nombre": _txt(r, "contesto_nombre", 150), "contesto_cargo": _txt(r, "contesto_cargo", 120),
                # sin fecha capturada, una referencia con resultado se fecha HOY (validación dentro del sistema)
                "fecha_contacto": _txt(r, "fecha_contacto", 10) or _txt(r, "fecha_verificacion", 10)
                or (datetime.now(timezone.utc).date().isoformat() if resultado in RESULTADOS_REFERENCIA else ""), "medio": _txt(r, "medio", 60),
                "confirma_puesto": _txt(r, "confirma_puesto", 15) if _txt(r, "confirma_puesto", 15) in SI_NO_NI else "",
                "confirma_periodo": _txt(r, "confirma_periodo", 15) if _txt(r, "confirma_periodo", 15) in SI_NO_NI else "",
                "desempeno": _txt(r, "desempeno", 1000) or "", "motivo_salida": _txt(r, "motivo_salida", 500),
                "recontrataria": _txt(r, "recontrataria", 15) if _txt(r, "recontrataria", 15) in SI_NO_NI else "",
                "observaciones": _txt(r, "observaciones", 1500) or _txt(r, "comentarios", 1500),
                "resultado": resultado if resultado in RESULTADOS_REFERENCIA else "",
                "no_contactada": bool(r.get("no_contactada")) or resultado == "sin_respuesta",
                "intentos": int(r.get("intentos") or 0) if str(r.get("intentos") or "0").isdigit() else 0,
                "informe": ant.get("informe") or r.get("informe") or None,
            }
        else:
            v = {k: ant.get(k) for k in CAMPOS_VALIDACION_REFERENCIA + ("informe",) if k in ant}
        ref = {**d, **v, "capturada_por": _txt(r, "capturada_por", 60) or ant.get("capturada_por") or ""}
        ref["estado"] = estado_referencia(ref)
        ref["estadoTexto"] = ESTADOS_REFERENCIA[ref["estado"]]
        # 2026-10-05: quién registró la validación y cuándo (se conserva mientras siga validada)
        ref["validada_por"] = ant.get("validada_por") or ""
        ref["validada_en"] = ant.get("validada_en") or ""
        if ref["estado"] != "validada":
            ref["validada_por"], ref["validada_en"] = "", ""
        salida.append(ref)
    return salida[:10]


def sellar_validadas(refs: List[dict], actor: str) -> None:
    """Marca quién/cuándo en las referencias que acaban de quedar validadas."""
    ahora = datetime.now(timezone.utc).isoformat()
    for r in refs:
        if r.get("estado") == "validada" and not r.get("validada_por"):
            r["validada_por"], r["validada_en"] = actor, ahora


def dictamen_referencias(refs: List[dict]) -> str:
    """Conclusión que se desprende de lo que registró quien validó (no es una segunda calificación de RH)."""
    res = [r.get("resultado") for r in refs if r.get("estado") == "validada"]
    return "desfavorable" if "desfavorable" in res else "con_observaciones" if "con_observaciones" in res else "favorable"


def referencias_completas(ev: EvaluacionCandidato) -> bool:
    return ev.tipo == "referencias" and resumen_referencias(ev)["completas"]


def resumen_referencias(ev: EvaluacionCandidato) -> dict:
    refs = [r for r in (ev.referencias or []) if isinstance(r, dict)]
    por = {k: sum(1 for r in refs if (r.get("estado") or estado_referencia(r)) == k) for k in ESTADOS_REFERENCIA}
    requeridas = max(1, int(ev.referencias_requeridas or 1))
    return {"total": len(refs), "requeridas": requeridas, "validadas": por["validada"], "porEstado": por,
            "completas": por["validada"] >= requeridas,
            "texto": f"{por['validada']} de {requeridas} validada{'s' if requeridas != 1 else ''}"}


# ---------- Psicometría conectada (2026-10-02, cambios integrados §7-8) ----------

def liga_real(url: str) -> bool:
    """2026-10-04: una liga de prueba solo sirve si es http(s) y apunta a un dominio real — nunca los marcadores de
    ejemplo (`*.invalid`, `example.*`, `localhost`) que traían los datos demo."""
    from urllib.parse import urlparse

    try:
        u = urlparse((url or "").strip())
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host or "." not in host:
        return False
    return not (host.endswith(".invalid") or host.endswith(".example") or host.endswith(".test") or host.endswith(".localhost")
                or host.startswith("example.") or ".example." in host or host in ("localhost", "example.com"))


def liga_candidato(ev: EvaluacionCandidato) -> str:
    """La liga que el CANDIDATO usa para hacer su prueba (nunca el formulario del evaluador). Una liga de ejemplo no
    cuenta como liga: mejor ninguna que una que no abre."""
    if ev.liga_candidato and liga_real(ev.liga_candidato):
        return ev.liga_candidato
    if ev.clave_proveedor:
        from . import psicometricas as psi

        return psi.url_candidato(ev.clave_proveedor) or ""
    if ev.tipo == "psicometrica" and ev.modo == "enlace" and liga_real(ev.url):
        return ev.url
    return ""


ESTADOS_PSICOMETRIA = {"pendiente": "Pendiente", "en_curso": "En curso", "esperando_resultado": "Esperando resultado", "completada": "Completada",
                       "cancelada": "Cancelada"}


def estado_psicometria(ev: EvaluacionCandidato) -> str:
    if ev.estado == "fallida":
        return "cancelada"
    if ev.estado in ("resultado_recibido", "revisada"):
        return "completada"
    if ev.paso_integrada == "completada" or ev.realizada_en:
        return "esperando_resultado"
    if ev.estado == "en_proceso" or ev.clave_proveedor or ev.liga_enviada_en:
        return "en_curso"
    return "pendiente"


def evaluatest_normalizado(datos: dict) -> dict:
    """Campos del reporte Evaluatest (spec §9): índice de afinidad, IGI, competencias, fortalezas, áreas de
    oportunidad y riesgo. Solo lo que venga; nada se inventa."""
    def _pct(v):
        try:
            x = float(str(v).replace("%", "").strip())
        except (TypeError, ValueError):
            return None
        return max(0.0, min(100.0, x))

    def _lista(v):
        if isinstance(v, list):
            return [str(x).strip()[:200] for x in v if str(x).strip()][:20]
        return [x.strip()[:200] for x in str(v or "").replace("\n", ",").split(",") if x.strip()][:20]

    d = datos or {}
    return {
        "indice_afinidad": _pct(d.get("indice_afinidad")),
        "igi": _pct(d.get("igi")),
        "competencias": _lista(d.get("competencias")),
        "fortalezas": _lista(d.get("fortalezas")),
        "areas_oportunidad": _lista(d.get("areas_oportunidad")),
        "riesgo": str(d.get("riesgo") or "").strip()[:200],
    }


def es_evaluatest(ev: EvaluacionCandidato) -> bool:
    return ev.tipo == "psicometrica" and (ev.proveedor or "").strip().lower() == _fr.PROVEEDOR_EVALUATEST.lower()


def agregar_adjunto(ev: EvaluacionCandidato, ruta: str, nombre: str, mime: str, subido_por: str) -> None:
    ev.adjuntos = list(ev.adjuntos or []) + [{"ruta": ruta, "nombre": nombre, "mime": mime, "subido_por": subido_por, "subido_en": datetime.now(timezone.utc).isoformat()}]


# ---------- Psicométricas.mx (2026-09-29) ----------

def usa_psicometricas(ev: EvaluacionCandidato) -> bool:
    from . import psicometricas as psi

    return ev.modo == "integrada" and psi.es_psicometricas(ev.proveedor)


def resumen_resultado(datos) -> str:
    """Texto breve para RH a partir del JSON del proveedor (sin interpretar: lo revisa y dictamina una persona)."""
    import json as _json

    texto = _json.dumps(datos, ensure_ascii=False)
    return f"Resultado recibido de Psicométricas.mx ({len(texto)} caracteres). Revisa el informe PDF adjunto."


def sincronizar_psicometricas(db, ev: EvaluacionCandidato, por: str = "Psicométricas.mx (automático)") -> str:
    """Confirma con su API (consultaCandidato → fecha_fin) y, si ya terminó, descarga el resultado (JSON + PDF) y lo
    deja en la evaluación: Completada → Resultado recibido. Idempotente. Regresa: sin_clave | en_curso | ya_estaba |
    resultado_recibido."""
    from . import archivos as fs
    from . import psicometricas as psi

    if not ev.clave_proveedor:
        return "sin_clave"
    if ev.estado in ("resultado_recibido", "revisada", "fallida"):
        return "ya_estaba"
    filas = psi.consultar_candidato(ev.clave_proveedor)
    if not psi.terminado(filas):
        return "en_curso"
    datos = psi.resultado_json(ev.clave_proveedor)
    pdf = psi.resultado_pdf(ev.clave_proveedor)
    ev.resultado_json = datos if isinstance(datos, dict) else {"resultados": datos}
    ev.resultado_resumen = resumen_resultado(datos)
    if pdf:
        validado = fs.validar_bytes(pdf, f"psicometricas-{ev.clave_proveedor}.pdf", f"informe «{ev.nombre}»")
        ev.archivo = fs.guardar(validado, f"evaluaciones/{ev.id}", f"informe_{ev.codigo}")
        ev.nombre_archivo, ev.mime = validado.nombre, validado.mime
    ev.resultado_cargado_por, ev.resultado_cargado_en = por, datetime.now(timezone.utc)
    if ev.paso_integrada != "completada":
        aplicar_paso(ev, "completada", por, "Psicométricas.mx")
    aplicar_paso(ev, "resultado_recibido", por, "Psicométricas.mx")
    return "resultado_recibido"
