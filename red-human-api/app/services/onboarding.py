"""Onboarding v2 (2026-09-28) — Fase 1: plantillas, resolución por jerarquía y tareas.

* Jerarquía: la plantilla de PUESTO prevalece sobre la de EMPRESA. Dentro de cada nivel, la que nombra la
  razón social contratante gana a la que aplica a toda la Cuenta (`empresa` vacía). Sin ninguna, aplica la
  configuración predeterminada (`DOCUMENTOS_BASE` + las tres tareas fijas + `PLAZOS_ONBOARDING_DEFAULT`).
* La configuración que se aplica a una persona es una COPIA (`configuracion_para`): lo que RH cambie para
  ese candidato nunca altera la plantilla.
* Tareas: pendiente → realizada | cancelada (motivo obligatorio). Las tres fijas nacen siempre y no se
  cancelan una por una. Los plazos son relativos a la fecha de ingreso (`fecha_limite`).
* Nada de esto escribe `Postulacion.etapa` (regla B5).
"""

import copy
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ..models import (
    DOCUMENTOS_BASE,
    PLAZOS_ONBOARDING_DEFAULT,
    TAREAS_FIJAS_ONBOARDING,
    TIPOS_RECURSO_ONBOARDING,
    Documento,
    Expediente,
    PlantillaOnboarding,
    TareaOnboarding,
)

CLAVES_FIJAS = {c for c, _ in TAREAS_FIJAS_ONBOARDING}
# Tareas que solo se cierran con su acción propia (no con «marcar realizada» genérico).
CIERRE_CON_ACCION = {"contrato_firmado": "Se marca como realizada al cargar el contrato firmado (PDF final)."}


def norm(s: str) -> str:
    return " ".join(unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().split())


def _entero(v, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


# ---------- normalización de lo que captura RH ----------

def normalizar_documentos(docs: List[dict]) -> List[dict]:
    salida, vistos = [], set()
    for d in docs or []:
        tipo = str((d or {}).get("tipo") or "").strip()[:80]
        if not tipo or norm(tipo) in vistos:
            continue
        vistos.add(norm(tipo))
        salida.append({"tipo": tipo, "obligatorio": bool((d or {}).get("obligatorio", True))})
    return salida


def normalizar_recursos(recursos: List[dict]) -> List[dict]:
    salida, vistos = [], set()
    for r in recursos or []:
        nombre = str((r or {}).get("nombre") or "").strip()[:200]
        if not nombre or norm(nombre) in vistos:
            continue
        vistos.add(norm(nombre))
        tipo = str((r or {}).get("tipo") or "otro").strip().lower()
        salida.append({
            "nombre": nombre,
            "tipo": tipo if tipo in TIPOS_RECURSO_ONBOARDING else "otro",
            "responsable": str((r or {}).get("responsable") or "").strip()[:150],
            "dias": _entero((r or {}).get("dias"), 0),
        })
    return salida


def normalizar_plazos(plazos: dict) -> dict:
    salida = dict(PLAZOS_ONBOARDING_DEFAULT)
    for k in PLAZOS_ONBOARDING_DEFAULT:
        v = _entero((plazos or {}).get(k))
        if v is not None:
            salida[k] = v
    return salida


def normalizar_responsables(resp: dict) -> dict:
    claves = ["documentos", *CLAVES_FIJAS]
    return {k: str((resp or {}).get(k) or "").strip()[:150] for k in claves}


# ---------- resolución ----------

def configuracion_predeterminada() -> dict:
    return {
        "documentos": [{"tipo": t, "obligatorio": True} for t in DOCUMENTOS_BASE],
        "recursos": [],
        "responsables": normalizar_responsables({}),
        "plazos": dict(PLAZOS_ONBOARDING_DEFAULT),
        "cursoInduccionId": None,
    }


def config_de_plantilla(p: PlantillaOnboarding) -> dict:
    return {
        "documentos": normalizar_documentos(list(p.documentos or [])),
        "recursos": normalizar_recursos(list(p.recursos or [])),
        "responsables": normalizar_responsables(dict(p.responsables or {})),
        "plazos": normalizar_plazos(dict(p.plazos or {})),
        "cursoInduccionId": p.curso_induccion_id,
    }


def resolver_plantilla(db: Session, cuenta_id: int, puesto: str = "", empresa: str = "") -> Tuple[Optional[PlantillaOnboarding], str]:
    """(plantilla, origen) con origen ∈ puesto | empresa | predeterminada."""
    activas = (
        db.query(PlantillaOnboarding)
        .filter(PlantillaOnboarding.cuenta_id == cuenta_id, PlantillaOnboarding.activa.is_(True))
        .order_by(PlantillaOnboarding.id)
        .all()
    )
    np_, ne = norm(puesto), norm(empresa)

    def empresa_ok(p):
        return not norm(p.empresa) or (ne and norm(p.empresa) == ne)

    def mejor(cands):
        # la que nombra la empresa contratante gana a la genérica de la Cuenta
        especificas = [p for p in cands if norm(p.empresa)]
        return (especificas or cands)[0] if cands else None

    if np_:
        p = mejor([p for p in activas if p.alcance == "puesto" and norm(p.puesto) == np_ and empresa_ok(p)])
        if p:
            return p, "puesto"
    p = mejor([p for p in activas if p.alcance == "empresa" and empresa_ok(p)])
    if p:
        return p, "empresa"
    return None, "predeterminada"


def configuracion_para(db: Session, cuenta_id: int, puesto: str = "", empresa: str = "") -> dict:
    """COPIA de la configuración que le toca a una persona (la plantilla nunca se toca)."""
    p, origen = resolver_plantilla(db, cuenta_id, puesto, empresa)
    base = config_de_plantilla(p) if p else configuracion_predeterminada()
    return {"plantillaId": p.id if p else None, "plantilla": p.nombre if p else "", "origen": origen, **copy.deepcopy(base)}


# ---------- tareas ----------

def fecha_limite(fecha_ingreso: Optional[datetime], dias: Optional[int]) -> Optional[datetime]:
    if not fecha_ingreso or dias is None:
        return None
    return fecha_ingreso + timedelta(days=int(dias))


def tareas_de(db: Session, e: Expediente) -> List[TareaOnboarding]:
    fijas = {c: i for i, (c, _) in enumerate(TAREAS_FIJAS_ONBOARDING)}
    tareas = db.query(TareaOnboarding).filter(TareaOnboarding.expediente_id == e.id).all()
    return sorted(tareas, key=lambda t: (0 if t.fija else 1, fijas.get(t.clave, 99), t.id))


def generar_tareas(db: Session, e: Expediente, cuenta_id: int, config: dict, por: str) -> List[TareaOnboarding]:
    """Idempotente: crea las tres fijas y un recurso por cada `config["recursos"]` que no exista ya (por
    nombre). Nunca borra ni cambia el estado de una tarea existente."""
    existentes = tareas_de(db, e)
    por_clave = {t.clave for t in existentes if t.fija}
    recursos = {norm(t.nombre) for t in existentes if not t.fija}
    responsables = config.get("responsables") or {}
    plazos = config.get("plazos") or PLAZOS_ONBOARDING_DEFAULT
    for clave, nombre in TAREAS_FIJAS_ONBOARDING:
        if clave in por_clave:
            continue
        dias = _entero(plazos.get(clave), PLAZOS_ONBOARDING_DEFAULT.get(clave))
        db.add(TareaOnboarding(
            cuenta_id=cuenta_id, expediente_id=e.id, clave=clave, nombre=nombre, tipo="fija", fija=True, obligatoria=True,
            responsable=responsables.get(clave, ""), dias_relativos=dias, fecha_limite=fecha_limite(e.fecha_ingreso, dias), creada_por=por,
        ))
    for r in normalizar_recursos(config.get("recursos") or []):
        if norm(r["nombre"]) in recursos:
            continue
        db.add(TareaOnboarding(
            cuenta_id=cuenta_id, expediente_id=e.id, clave="recurso", nombre=r["nombre"], tipo=r["tipo"], fija=False, obligatoria=True,
            responsable=r["responsable"], dias_relativos=r["dias"], fecha_limite=fecha_limite(e.fecha_ingreso, r["dias"]), creada_por=por,
        ))
    db.flush()
    return tareas_de(db, e)


def aplicar_documentos(db: Session, e: Expediente, documentos: List[dict]) -> List[str]:
    """Agrega al expediente los documentos de la configuración que falten (por tipo). Nunca borra ni cambia
    el estado de uno existente. Regresa los tipos agregados."""
    existentes = {norm(d.tipo) for d in e.documentos}
    nuevos = []
    for d in normalizar_documentos(documentos):
        if norm(d["tipo"]) in existentes:
            continue
        doc = Documento(expediente_id=e.id, tipo=d["tipo"], obligatorio=d["obligatorio"])
        db.add(doc)
        e.documentos.append(doc)
        nuevos.append(d["tipo"])
    db.flush()
    return nuevos


def recalcular_fechas(db: Session, e: Expediente) -> int:
    """Recalcula la fecha límite de las tareas PENDIENTES a partir de la fecha de ingreso. Regresa cuántas cambió."""
    n = 0
    for t in tareas_de(db, e):
        if t.estado != "pendiente" or t.dias_relativos is None:
            continue
        nueva = fecha_limite(e.fecha_ingreso, t.dias_relativos)
        if nueva != t.fecha_limite:
            t.fecha_limite = nueva
            n += 1
    return n


def atrasada(t: TareaOnboarding, ahora: Optional[datetime] = None) -> bool:
    if t.estado != "pendiente" or not t.fecha_limite:
        return False
    limite = t.fecha_limite if t.fecha_limite.tzinfo else t.fecha_limite.replace(tzinfo=timezone.utc)
    return limite.date() < (ahora or datetime.now(timezone.utc)).date()


def cambiar_estado_tarea(t: TareaOnboarding, estado: str, motivo: str, por: str) -> Optional[str]:
    """Aplica la transición. Regresa un mensaje de error (409/400) o None si se aplicó."""
    estado = (estado or "").strip().lower()
    motivo = (motivo or "").strip()
    if estado == t.estado:
        return None
    ahora = datetime.now(timezone.utc)
    if estado == "realizada":
        if t.clave in CIERRE_CON_ACCION:
            return CIERRE_CON_ACCION[t.clave]
        t.estado, t.realizada_por, t.realizada_en = "realizada", por, ahora
        t.cancelada_por, t.cancelada_en, t.motivo_cancelacion = "", None, ""
    elif estado == "cancelada":
        if t.fija:
            return f"«{t.nombre}» es una tarea fija y obligatoria del Onboarding; no se cancela por separado."
        if not motivo:
            return "Indica el motivo para cancelar la tarea."
        t.estado, t.cancelada_por, t.cancelada_en, t.motivo_cancelacion = "cancelada", por, ahora, motivo[:1000]
        t.realizada_por, t.realizada_en = "", None
    elif estado == "pendiente":  # reabrir
        t.estado = "pendiente"
        t.realizada_por, t.realizada_en, t.cancelada_por, t.cancelada_en, t.motivo_cancelacion = "", None, "", None, ""
    else:
        return "Estado inválido. Usa pendiente, realizada o cancelada."
    return None
