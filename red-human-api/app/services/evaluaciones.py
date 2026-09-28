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


def aplicar_paso(ev: EvaluacionCandidato, paso: str, usuario: str) -> None:
    ev.paso_integrada = paso
    mover(ev, ESTADO_POR_PASO[paso], usuario, f"Modo integrada (simulado): {paso}")


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
