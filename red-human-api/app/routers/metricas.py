"""Métricas que cruzan el Módulo 1 (reclutamiento) y el Módulo 2 (contratación).

Es la vista que demuestra que ambos módulos son un solo flujo: de candidato
captado a colaborador dado de alta, con el embudo real de la base.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from typing import Optional

from fastapi import HTTPException

from ..deps import cuenta_actual, usuario_actual
from ..database import get_db
from ..models import ETAPAS_CANDIDATO, Candidato, Cuenta, Entrevista, Expediente, Postulacion, Usuario, Vacante
from ..services import conteos, fraiche

router = APIRouter(prefix="/metricas", tags=["metricas"], dependencies=[Depends(usuario_actual)])


def _postulaciones(db: Session, cuenta_id: int):
    """Base de todo conteo de este módulo (Fase 2: se cuentan POSTULACIONES, no personas) —
    nunca cuenta postulaciones de Modo Prueba."""
    return db.query(Postulacion).filter(Postulacion.es_prueba.is_(False), Postulacion.cuenta_id == cuenta_id)


@router.get("/pipeline")
def pipeline(db: Session = Depends(get_db), cuenta: Cuenta = Depends(cuenta_actual)):
    """Embudo de punta a punta: captación → prefiltro → entrevista → expediente → alta."""
    # Fase 2: el embudo cuenta POSTULACIONES (una persona con 2 vacantes son 2 en el embudo).
    total_candidatos = _postulaciones(db, cuenta.id).count()
    # 2026-09-20 (B4): "por etapa" sale de `services.conteos.por_etapa` — EXACTAMENTE la misma base que el
    # Kanban y el embudo de cada vacante (activas, personas no eliminadas, incluye Modo Prueba), para que el
    # pipeline global, la tarjeta de la vacante y la lista de candidatos coincidan siempre.
    por_etapa = conteos.por_etapa(db, cuenta.id)
    por_estado = dict(
        _postulaciones(db, cuenta.id).with_entities(Postulacion.estado, func.count(Postulacion.id)).group_by(Postulacion.estado).all()
    )
    # "por fuente" sigue siendo la fuente de la PERSONA (Formulario/WhatsApp/OCC/...), que es lo
    # que el frontend grafica; se cuenta por postulación.
    por_fuente = dict(
        _postulaciones(db, cuenta.id)
        .join(Candidato, Postulacion.candidato_id == Candidato.id)
        .with_entities(Candidato.fuente, func.count(Postulacion.id))
        .group_by(Candidato.fuente)
        .all()
    )
    prefiltrados = _postulaciones(db, cuenta.id).filter(Postulacion.prefiltro_completo.is_(True)).count()
    entrevistas_evaluadas = (
        db.query(Entrevista)
        .join(Candidato, Entrevista.candidato_id == Candidato.id)
        .filter(Entrevista.estado == "evaluada", Candidato.cuenta_id == cuenta.id)
        .count()
    )
    expedientes = (
        db.query(Expediente)
        .join(Candidato, Expediente.candidato_id == Candidato.id)
        .filter(Candidato.cuenta_id == cuenta.id)
        .all()
    )
    altas = [e for e in expedientes if e.estado == "alta"]

    embudo = [
        {"etapa": "Candidatos", "valor": total_candidatos},
        {"etapa": "Prefiltro IA", "valor": prefiltrados},
        {"etapa": "Entrevista", "valor": entrevistas_evaluadas},
        {"etapa": "Expediente", "valor": len(expedientes)},
        {"etapa": "Alta", "valor": len(altas)},
    ]
    base = embudo[0]["valor"] or 1
    for paso in embudo:
        paso["pct"] = round(paso["valor"] / base * 100)

    hace_7d = datetime.now(timezone.utc) - timedelta(days=7)
    return {
        "vacantes": {
            "total": db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.estado != "Eliminada").count(),
            "publicadas": db.query(Vacante).filter(Vacante.estado == "Publicada", Vacante.cuenta_id == cuenta.id).count(),
            "borradores": db.query(Vacante).filter(Vacante.estado == "Borrador", Vacante.cuenta_id == cuenta.id).count(),
        },
        "candidatos": {
            "total": total_candidatos,
            "nuevos_7d": _postulaciones(db, cuenta.id).filter(Postulacion.creado_en >= hace_7d).count(),
            "por_etapa": {e: por_etapa.get(e, 0) for e in ETAPAS_CANDIDATO},
            "por_estado": por_estado,
            "por_fuente": por_fuente,
            "sin_consentimiento": _postulaciones(db, cuenta.id).filter(Postulacion.consentimiento.is_(False)).count(),
        },
        "contratacion": {
            "expedientes": len(expedientes),
            "en_integracion": sum(1 for e in expedientes if e.estado == "integracion"),
            "listos_para_alta": sum(1 for e in expedientes if e.progreso == 100 and e.estado != "alta"),
            "altas": len(altas),
            "documentos_pendientes": sum(len(e.pendientes) for e in expedientes),
            "documentos_por_revisar": sum(len(e.por_revisar) for e in expedientes),
        },
        "embudo": embudo,
        # cuellos de botella accionables para RH, con la liga al módulo que los resuelve
        "acciones": _acciones(db, expedientes, cuenta.id),
    }


def _acciones(db: Session, expedientes, cuenta_id: int) -> list:
    salida = []

    por_decidir = _postulaciones(db, cuenta_id).filter(
        Postulacion.activa.is_(True), Postulacion.prefiltro_completo.is_(True),
        Postulacion.etapa == "Prefiltro", Postulacion.estado != "no_cumple",
    ).count()
    if por_decidir:
        salida.append({
            "modulo": 1,
            "tipo": "decision_pendiente",
            "cantidad": por_decidir,
            "texto": f"{por_decidir} candidato(s) prefiltrados esperan decisión de RH.",
            "ruta": "/dashboard/candidatos",
        })

    sin_consentimiento = _postulaciones(db, cuenta_id).filter(
        Postulacion.activa.is_(True), Postulacion.consentimiento.is_(False), Postulacion.etapa != "Prefiltro"
    ).count()
    if sin_consentimiento:
        salida.append({
            "modulo": 1,
            "tipo": "consentimiento",
            "cantidad": sin_consentimiento,
            "texto": f"{sin_consentimiento} candidato(s) avanzados sin consentimiento registrado (LFPDPPP).",
            "ruta": "/dashboard/candidatos",
        })

    por_revisar = sum(len(e.por_revisar) for e in expedientes)
    if por_revisar:
        salida.append({
            "modulo": 2,
            "tipo": "documentos_revision",
            "cantidad": por_revisar,
            "texto": f"{por_revisar} documento(s) marcados por la IA para revisión humana.",
            "ruta": "/dashboard/onboarding",
        })

    listos = [e for e in expedientes if e.progreso == 100 and e.estado != "alta"]
    if listos:
        salida.append({
            "modulo": 2,
            "tipo": "alta_pendiente",
            "cantidad": len(listos),
            "texto": f"{len(listos)} expediente(s) completos esperan autorización de alta.",
            "ruta": "/dashboard/onboarding",
        })

    return salida


# ------------------------------------------------------------
# Tablero de control principal (2026-09-28): SOLO datos reales, SIEMPRE filtrados por la Cuenta de la sesión.
# ------------------------------------------------------------

DIAS_CORTOS = ("Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom")
MESES_CORTOS = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")


def _utc(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _dia_mx(dt):
    from ..services.notificaciones import TZ_MEXICO

    return _utc(dt).astimezone(TZ_MEXICO).date()


def _modulo(db: Session, fn):
    """Los módulos de RH viven en tablas del paso NO fatal: si no existen, esa sección es None y el resto sigue."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        db.rollback()
        return None


@router.get("/tablero")
def tablero(db: Session = Depends(get_db), cuenta: Cuenta = Depends(cuenta_actual)):
    """Todo lo que pinta el Tablero de control. Cada consulta filtra por `cuenta.id` (multi-inquilino estricto);
    nada es inventado: sin datos, las series vienen vacías o en cero."""
    from ..models import Colaborador, EntrevistaHumana
    from ..serial import hace
    from ..services.notificaciones import TZ_MEXICO

    ahora = datetime.now(timezone.utc)
    hoy = ahora.astimezone(TZ_MEXICO).date()
    dias = [hoy - timedelta(days=i) for i in range(6, -1, -1)]
    desde_7d = ahora - timedelta(days=8)

    visibles = conteos.postulaciones_visibles(db, cuenta.id)
    activos_pipeline = visibles.count()

    # --- actividad de los últimos 7 días: postulaciones nuevas y entrevistas (IA finalizadas + humanas del día) ---
    nuevas = [_dia_mx(f) for (f,) in _postulaciones(db, cuenta.id).filter(Postulacion.creado_en >= desde_7d).with_entities(Postulacion.creado_en).all()]
    ent_ia = [
        _dia_mx(f) for (f,) in db.query(Entrevista.finalizada_en)
        .join(Postulacion, Entrevista.postulacion_id == Postulacion.id)
        .filter(Postulacion.cuenta_id == cuenta.id, Entrevista.finalizada_en.isnot(None), Entrevista.finalizada_en >= desde_7d).all()
    ]
    ent_h = [
        _dia_mx(f) for (f,) in db.query(EntrevistaHumana.fecha)
        .join(Postulacion, EntrevistaHumana.postulacion_id == Postulacion.id)
        .filter(Postulacion.cuenta_id == cuenta.id, EntrevistaHumana.fecha.isnot(None), EntrevistaHumana.fecha >= desde_7d, EntrevistaHumana.fecha <= ahora).all()
    ]
    actividad = [
        {"dia": DIAS_CORTOS[d.weekday()], "fecha": d.isoformat(), "candidatos": sum(1 for x in nuevas if x == d), "entrevistas": sum(1 for x in ent_ia + ent_h if x == d)}
        for d in dias
    ]

    # --- fuentes de las postulaciones activas ---
    fuentes = [
        {"name": f or "Sin fuente", "value": int(n)}
        for f, n in visibles.with_entities(Candidato.fuente, func.count(Postulacion.id)).group_by(Candidato.fuente).order_by(func.count(Postulacion.id).desc()).all()
    ]

    # --- colaboradores y contrataciones ---
    colaboradores_activos = (
        db.query(Colaborador).filter(Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None), Colaborador.activo.is_(True)).count()
    )
    expedientes_cuenta = (
        db.query(Expediente).join(Candidato, Expediente.candidato_id == Candidato.id).filter(Candidato.cuenta_id == cuenta.id).all()
    )
    altas = [e for e in expedientes_cuenta if e.estado == "alta" and e.alta_fecha]
    altas_30d = sum(1 for e in altas if _utc(e.alta_fecha) >= ahora - timedelta(days=30))
    # tiempo de contratación: días de la postulación al alta, promedio por mes (últimos 6 meses con altas)
    por_mes: dict = {}
    for e in altas:
        p = e.postulacion
        f = _utc(e.alta_fecha)
        if not p or not p.creado_en or f < ahora - timedelta(days=186):
            continue
        por_mes.setdefault((f.year, f.month), []).append(max(0, (f - _utc(p.creado_en)).days))
    tiempo = [{"mes": MESES_CORTOS[m - 1], "dias": round(sum(v) / len(v))} for (_a, m), v in sorted(por_mes.items())]
    dias_todos = [d for v in por_mes.values() for d in v]

    vacantes_publicadas = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.estado == "Publicada").count()

    # --- recientes ---
    recientes = [
        {
            "id": p.codigo, "nombre": p.nombre, "puesto": p.vacante.titulo if p.vacante else "",
            "ubicacion": (p.candidato.ubicacion if p.candidato else "") or "", "fuente": p.fuente, "estado": p.estado,
            "score": p.score or 0, "etapa": p.etapa, "aplicado": hace(p.creado_en),
        }
        for p in visibles.order_by(Postulacion.creado_en.desc()).limit(5).all()
    ]

    return {
        "cuentaId": cuenta.id,
        "generado": ahora.isoformat(),
        "kpis": {
            "candidatosActivos": activos_pipeline,
            "candidatosNuevos7d": sum(r["candidatos"] for r in actividad),
            "colaboradoresActivos": colaboradores_activos,
            "altas30d": altas_30d,
            "vacantesPublicadas": vacantes_publicadas,
        },
        "actividad": actividad,
        "fuentes": fuentes,
        "tiempoContratacion": {"serie": tiempo, "promedio": round(sum(dias_todos) / len(dias_todos)) if dias_todos else None},
        "recientes": recientes,
        "pendientesRH": _acciones(db, expedientes_cuenta, cuenta.id),
        "onboarding": _modulo(db, lambda: _tablero_onboarding(db, cuenta.id)),
        "evaluaciones": _modulo(db, lambda: _tablero_evaluaciones(db, cuenta.id)),
        "desempeno": _modulo(db, lambda: _tablero_desempeno(db, cuenta.id)),
        "clima": _modulo(db, lambda: _tablero_clima(db, cuenta.id)),
    }


def _tablero_onboarding(db: Session, cuenta_id: int) -> dict:
    """Onboardings ACTIVOS = en etapa Onboarding (postulación viva, o ya dada de alta y sin cerrar), sin «No ingresó».
    Avance = (documentos aprobados + tareas realizadas) / (documentos aplicables + tareas vigentes)."""
    from sqlalchemy import or_

    from ..models import TareaOnboarding
    from ..services import onboarding as onb

    exps = (
        db.query(Expediente)
        .join(Candidato, Expediente.candidato_id == Candidato.id)
        .join(Postulacion, Expediente.postulacion_id == Postulacion.id)
        .filter(
            Candidato.cuenta_id == cuenta_id, Candidato.eliminado_en.is_(None), Postulacion.cuenta_id == cuenta_id,
            Postulacion.etapa == "Onboarding", or_(Postulacion.activa.is_(True), Postulacion.motivo_cierre == "contratado"),
            Expediente.onboarding_cerrado_en.is_(None), Expediente.no_ingreso_en.is_(None),
        )
        .all()
    )
    ids = [e.id for e in exps]
    tareas: dict = {}
    if ids:
        for t in db.query(TareaOnboarding).filter(TareaOnboarding.cuenta_id == cuenta_id, TareaOnboarding.expediente_id.in_(ids)).all():
            tareas.setdefault(t.expediente_id, []).append(t)
    avances, atrasadas, sin_tareas, listos_cierre = [], 0, 0, 0
    for e in exps:
        r = onb.resumen_tablero(e, tareas.get(e.id, []))
        total = r["documentos"]["total"] + r["tareas"]["total"]
        hechos = len(r["documentos"]["aprobados"]) + r["tareas"]["realizadas"]
        avances.append(round(hechos / total * 100) if total else 0)
        atrasadas += r["tareas"]["atrasadas"]
        sin_tareas += 0 if r["iniciado"] else 1
        listos_cierre += 1 if r["puedeCerrar"] else 0
    return {
        "activos": len(exps),
        "tareasAtrasadas": atrasadas,
        "avancePromedio": round(sum(avances) / len(avances)) if avances else None,
        "sinTareas": sin_tareas,
        "listosParaCerrar": listos_cierre,
    }


def _tablero_evaluaciones(db: Session, cuenta_id: int) -> dict:
    """Evaluaciones y verificaciones de postulaciones ACTIVAS de personas no eliminadas."""
    from ..models import EvaluacionCandidato

    filas = (
        db.query(EvaluacionCandidato.estado, func.count(EvaluacionCandidato.id))
        .join(Postulacion, EvaluacionCandidato.postulacion_id == Postulacion.id)
        .join(Candidato, Postulacion.candidato_id == Candidato.id)
        .filter(EvaluacionCandidato.cuenta_id == cuenta_id, Postulacion.cuenta_id == cuenta_id, Postulacion.activa.is_(True), Candidato.eliminado_en.is_(None))
        .group_by(EvaluacionCandidato.estado)
        .all()
    )
    por = {e: int(n) for e, n in filas}
    return {
        "pendientes": por.get("pendiente", 0),
        "enEsperaConsentimiento": por.get("en_espera_consentimiento", 0),
        "enProceso": por.get("en_proceso", 0),
        "resultadoRecibido": por.get("resultado_recibido", 0),
        "revisadas": por.get("revisada", 0),
        "porEstado": por,
    }


def _tablero_desempeno(db: Session, cuenta_id: int) -> dict:
    """Ciclos de Desempeño ACTIVOS (En curso): avance = personas completadas ÷ incluidas (motor único)."""
    from ..models import CicloDesempeno, normalizar_estado_ciclo
    from ..services import desempeno_calculo as calc

    ciclos = db.query(CicloDesempeno).filter(CicloDesempeno.cuenta_id == cuenta_id).all()
    activos = [c for c in ciclos if normalizar_estado_ciclo(c.estado) == "en_curso"]
    detalle = [{"id": c.codigo, "nombre": c.nombre, "periodo": c.periodo or "", **calc.avance(c)} for c in activos]
    incl = sum(d["incluidas"] for d in detalle)
    comp = sum(d["completadas"] for d in detalle)
    return {
        "activos": len(activos),
        "borradores": sum(1 for c in ciclos if normalizar_estado_ciclo(c.estado) == "borrador"),
        "personasIncluidas": incl,
        "personasCompletadas": comp,
        "avance": round(comp / incl * 100) if incl else None,
        "ciclos": sorted(detalle, key=lambda d: d["porcentaje"])[:5],
    }


def _tablero_clima(db: Session, cuenta_id: int) -> dict:
    from ..models import MedicionClima

    filas = db.query(MedicionClima.estado, func.count(MedicionClima.id)).filter(MedicionClima.cuenta_id == cuenta_id).group_by(MedicionClima.estado).all()
    por = {e: int(n) for e, n in filas}
    return {"abiertas": por.get("abierta", 0), "borradores": por.get("borrador", 0), "cerradas": por.get("cerrada", 0)}


# ============================================================
# Demo Fraiche (spec §14, 2026-09-29) · Tablero de control de Reclutamiento
# ============================================================

DETENIDO_DIAS = 5  # candidato «detenido»: sin seguimiento en más de N días
PASOS_VIABLES = ("entrevista_inicial", "ipv", "psicometria", "evaluaciones_adicionales", "referencias", "documentacion", "listo_alta", "listo_sap", "presentacion")
PASOS_PROXIMOS = ("documentacion", "listo_alta", "listo_sap", "presentacion")


def _ok(v):
    return v if v is not None else 0


@router.get("/reclutamiento")
def tablero_reclutamiento(
    destino: str = "",           # "" (Todas) | tienda_propia | franquicia
    reclutador_id: Optional[int] = None,
    zona: str = "",
    sucursal: str = "",
    cliente_id: Optional[int] = None,  # franquicia
    vacante: str = "",           # código VAC-####
    fuente: str = "",            # fuente de la postulación (services.fraiche.FUENTES_POSTULACION)
    db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual),
):
    """Tablero de control de Reclutamiento (spec §14) — visible para Coordinación de Reclutamiento (y Administrador).
    Selector Todas / Tiendas propias / Franquicias y filtros por reclutador, zona, sucursal, franquicia, vacante y
    fuente. TODOS los contadores se calculan de los registros; nada se escribe a mano. «En riesgo» usa el umbral
    configurado (ConfiguracionSistema.riesgo_dias_umbral). Bajas y permanencia quedan como indicadores futuros
    dependientes de SAP, sin cifras inventadas."""
    from ..models import Bitacora, EntrevistaHumana, EvaluacionCandidato
    from ..services import evaluaciones as sev
    from ..services.configuracion import obtener as cfg_obtener
    from ..services.notificaciones import TZ_MEXICO

    if not u.puede_ver_tablero_reclutamiento():
        raise HTTPException(403, "El Tablero de control de Reclutamiento es para Coordinación de Reclutamiento y Administradores.")
    ahora = datetime.now(timezone.utc)
    hoy = ahora.astimezone(TZ_MEXICO).date()
    cfg = cfg_obtener(db)
    umbral = cfg.riesgo_dias_umbral if cfg.riesgo_dias_umbral is not None else 7

    # --- vacantes en alcance ---
    qv = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.estado != "Eliminada")
    if destino in ("tienda_propia", "franquicia"):
        qv = qv.filter(Vacante.destino == destino)
    if reclutador_id:
        qv = qv.filter(Vacante.responsable_id == reclutador_id)
    if zona.strip():
        qv = qv.filter(Vacante.zona.ilike(f"%{zona.strip()}%"))
    if sucursal.strip():
        qv = qv.filter(Vacante.sucursal.ilike(f"%{sucursal.strip()}%"))
    if cliente_id:
        qv = qv.filter(Vacante.cliente_id == cliente_id)
    if vacante.strip():
        qv = qv.filter(Vacante.codigo == vacante.strip())
    vacantes = qv.all()
    ids_v = [v.id for v in vacantes]

    # --- postulaciones (activas y cerradas) de esas vacantes, sin Modo Prueba ---
    qp = db.query(Postulacion).join(Candidato, Postulacion.candidato_id == Candidato.id).filter(
        Postulacion.cuenta_id == cuenta.id, Postulacion.es_prueba.is_(False), Candidato.eliminado_en.is_(None),
        Postulacion.vacante_id.in_(ids_v) if ids_v else False,
    )
    if fuente.strip():
        qp = qp.filter(Postulacion.fuente_postulacion == fraiche.normalizar_fuente(fuente))
    postulaciones = qp.all() if ids_v else []
    por_vacante: dict = {}
    for p in postulaciones:
        por_vacante.setdefault(p.vacante_id, []).append(p)

    # cierres con motivo (descartados) — comentario de la decisión desde la bitácora
    codigos_desc = [p.codigo for p in postulaciones if p.motivo_cierre == "descartado"]
    motivos_bitacora: dict = {}
    if codigos_desc:
        for b in db.query(Bitacora).filter(Bitacora.accion == "decision_descartar", Bitacora.entidad_id.in_(codigos_desc)).all():
            det = b.detalle if isinstance(b.detalle, dict) else {}
            motivos_bitacora[b.entidad_id] = (det.get("comentario") or det.get("motivo") or "").strip()

    def contratados(ps):
        return [p for p in ps if p.motivo_cierre == "contratado"]

    def aceptados(ps):
        return [p for p in ps if p.franquicia_estado == "aceptado"]

    filas_vacantes = []
    en_riesgo = 0
    activas = cubiertas = pendientes_total = proximas = 0
    for v in vacantes:
        ps = por_vacante.get(v.id, [])
        vivas = [p for p in ps if p.activa]
        cubre = len(contratados(ps)) if v.destino != "franquicia" else len(aceptados(ps))
        posiciones = max(1, v.posiciones or 1)
        pend = max(0, posiciones - cubre)
        viables = [p for p in vivas if fraiche.paso_visible(p) in PASOS_VIABLES and p.estado != "no_cumple"]
        prox = [p for p in vivas if fraiche.paso_visible(p) in PASOS_PROXIMOS]
        dias_obj = (v.fecha_objetivo - hoy).days if v.fecha_objetivo else None
        riesgo = bool(v.estado == "Publicada" and pend > 0 and dias_obj is not None and dias_obj <= umbral and len(viables) < pend)
        es_activa = v.estado == "Publicada"
        activas += 1 if es_activa else 0
        cubiertas += 1 if (cubre >= posiciones and posiciones > 0) else 0
        pendientes_total += pend if es_activa else 0
        proximas += 1 if (es_activa and pend > 0 and prox) else 0
        en_riesgo += 1 if riesgo else 0
        antiguedad = (ahora - _utc(v.publicada_en or v.creada_en)).days if (v.publicada_en or v.creada_en) else None
        filas_vacantes.append({
            "id": v.codigo, "titulo": v.titulo, "destino": v.destino or "tienda_propia", "estado": v.estado,
            "sucursal": v.sucursal or "", "zona": v.zona or "", "cliente": v.cliente.nombre_visible if v.cliente else "",
            "reclutador": v.responsable.nombre if v.responsable else "", "reclutadorId": v.responsable_id,
            "posiciones": posiciones, "cubiertas": cubre, "pendientes": pend, "antiguedadDias": antiguedad,
            "fechaObjetivo": v.fecha_objetivo.isoformat() if v.fecha_objetivo else None, "diasParaObjetivo": dias_obj,
            "enRiesgo": riesgo, "viables": len(viables), "proximos": len(prox), "postulados": len(ps), "activos": len(vivas),
        })

    # --- embudo de candidatos ---
    contactados = [p for p in postulaciones if p.prefiltro_completo or (p.analisis or {}).get("respuestas_prefiltro") or fraiche.paso_visible(p) not in ("nuevo", "prefiltro_web")]
    entrevistados = [p for p in postulaciones if any(e.estado == "evaluada" for e in p.entrevistas) or any(eh.realizada for eh in p.entrevistas_humanas)]
    viables_tot = [p for p in postulaciones if p.activa and fraiche.paso_visible(p) in PASOS_VIABLES and p.estado != "no_cumple"]
    descartados = [p for p in postulaciones if p.motivo_cierre == "descartado"]
    motivos: dict = {}
    for p in descartados:
        m = motivos_bitacora.get(p.codigo) or "Sin motivo registrado"
        motivos[m] = motivos.get(m, 0) + 1

    # --- evaluaciones y documentos pendientes ---
    ids_p = [p.id for p in postulaciones]
    evs = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.postulacion_id.in_(ids_p)).all() if ids_p else []
    ev_pend = [e for e in evs if e.estado not in ("revisada", "fallida")]
    docs_pend = sum(1 for p in postulaciones if p.activa and p.expediente and p.expediente.no_aprobados)

    # --- seguimiento ---
    def ult(p):
        return _utc(p.ultima_actividad_en or p.creado_en)

    detenidos = [p for p in postulaciones if p.activa and (ahora - ult(p)).days > DETENIDO_DIAS]
    seguimiento = sorted(
        [{"id": p.codigo, "nombre": p.nombre, "vacante": p.vacante.titulo if p.vacante else "", "paso": fraiche.PASOS[fraiche.paso_visible(p)]["nombre"],
          "ultimoSeguimiento": ult(p).isoformat(), "diasSinSeguimiento": (ahora - ult(p)).days, "detenido": (ahora - ult(p)).days > DETENIDO_DIAS,
          "reclutador": p.vacante.responsable.nombre if p.vacante and p.vacante.responsable else ""}
         for p in postulaciones if p.activa],
        key=lambda x: -x["diasSinSeguimiento"],
    )[:50]

    # --- citas y entrevistas por reclutador ---
    por_reclutador: dict = {}

    def rec_de(p):
        return (p.vacante.responsable.nombre if p.vacante and p.vacante.responsable else "Sin responsable")

    for p in postulaciones:
        r = por_reclutador.setdefault(rec_de(p), {"reclutador": rec_de(p), "postulados": 0, "citas": 0, "entrevistasIA": 0, "entrevistasHumanas": 0, "contratados": 0, "aceptadosFranquicia": 0})
        r["postulados"] += 1
        r["citas"] += sum(1 for eh in p.entrevistas_humanas if eh.fecha and not eh.cancelada) + sum(1 for e in p.entrevistas if e.programada_para)
        r["entrevistasIA"] += sum(1 for e in p.entrevistas if e.estado == "evaluada")
        r["entrevistasHumanas"] += sum(1 for eh in p.entrevistas_humanas if eh.realizada)
        r["contratados"] += 1 if p.motivo_cierre == "contratado" else 0
        r["aceptadosFranquicia"] += 1 if p.franquicia_estado == "aceptado" else 0
    for r in por_reclutador.values():
        exitos = r["contratados"] + r["aceptadosFranquicia"]
        r["efectividad"] = round(exitos / r["postulados"] * 100) if r["postulados"] else None

    # --- efectividad por fuente ---
    por_fuente: dict = {}
    for p in postulaciones:
        f = fraiche.nombre_fuente(p.fuente_postulacion) if p.fuente_postulacion else (p.candidato.fuente if p.candidato else "Sin fuente")
        x = por_fuente.setdefault(f, {"fuente": f, "postulados": 0, "viables": 0, "contratados": 0, "aceptadosFranquicia": 0})
        x["postulados"] += 1
        x["viables"] += 1 if (p.activa and fraiche.paso_visible(p) in PASOS_VIABLES and p.estado != "no_cumple") else 0
        x["contratados"] += 1 if p.motivo_cierre == "contratado" else 0
        x["aceptadosFranquicia"] += 1 if p.franquicia_estado == "aceptado" else 0
    for x in por_fuente.values():
        exitos = x["contratados"] + x["aceptadosFranquicia"]
        x["efectividad"] = round(exitos / x["postulados"] * 100) if x["postulados"] else None

    # --- ingresos y próximos ingresos (tiendas propias) — NUNCA mezclados con franquicias ---
    propias = [p for p in postulaciones if p.vacante and p.vacante.destino != "franquicia"]
    ingresos = [p for p in propias if p.motivo_cierre == "contratado" and p.expediente and p.expediente.alta_fecha]
    proximos_ingresos = [p for p in propias if p.activa and p.expediente and (p.expediente.fecha_ingreso_real or p.expediente.fecha_ingreso) and not p.expediente.alta_fecha and _utc(p.expediente.fecha_ingreso_real or p.expediente.fecha_ingreso) >= ahora - timedelta(days=1)]
    ingresos_lista = sorted([
        {"id": p.codigo, "nombre": p.nombre, "puesto": p.vacante.titulo if p.vacante else "", "sucursal": p.vacante.sucursal if p.vacante else "",
         "fecha": _utc(p.expediente.fecha_ingreso_real or p.expediente.fecha_ingreso or p.expediente.alta_fecha).date().isoformat(), "listoSap": p.expediente.estado_sap == fraiche.ESTADO_LISTO_SAP}
        for p in ingresos], key=lambda x: x["fecha"], reverse=True)[:30]
    proximos_lista = sorted([
        {"id": p.codigo, "nombre": p.nombre, "puesto": p.vacante.titulo if p.vacante else "", "sucursal": p.vacante.sucursal if p.vacante else "",
         "fecha": _utc(p.expediente.fecha_ingreso_real or p.expediente.fecha_ingreso).date().isoformat(), "paso": fraiche.PASOS[fraiche.paso_visible(p)]["nombre"]}
        for p in proximos_ingresos], key=lambda x: x["fecha"])[:30]

    # --- franquicias: presentados y aceptados, por franquicia ---
    franq = [p for p in postulaciones if p.vacante and p.vacante.destino == "franquicia"]
    por_franquicia: dict = {}
    for p in franq:
        nombre_f = p.vacante.cliente.nombre_visible if p.vacante.cliente else "Sin franquicia"
        x = por_franquicia.setdefault(nombre_f, {"franquicia": nombre_f, "presentados": 0, "aceptados": 0, "noAceptados": 0})
        if p.franquicia_estado:
            x["presentados"] += 1
        x["aceptados"] += 1 if p.franquicia_estado == "aceptado" else 0
        x["noAceptados"] += 1 if p.franquicia_estado == "no_aceptado" else 0

    return {
        "cuentaId": cuenta.id, "generado": ahora.isoformat(),
        "filtros": {"destino": destino or "", "reclutadorId": reclutador_id, "zona": zona, "sucursal": sucursal, "clienteId": cliente_id, "vacante": vacante, "fuente": fuente, "umbralRiesgoDias": umbral, "detenidoDias": DETENIDO_DIAS},
        "vacantes": {"activas": activas, "cubiertas": cubiertas, "pendientes": pendientes_total, "proximasACubrir": proximas, "enRiesgo": en_riesgo, "total": len(vacantes), "lista": filas_vacantes},
        "candidatos": {
            "postulados": len(postulaciones), "contactados": len(contactados), "entrevistados": len(entrevistados), "viables": len(viables_tot),
            "descartados": len(descartados), "descartadosPorMotivo": [{"motivo": k, "total": n} for k, n in sorted(motivos.items(), key=lambda kv: -kv[1])],
        },
        "pendientes": {"evaluaciones": len(ev_pend), "evaluacionesPorTipo": {t: sum(1 for e in ev_pend if e.tipo == t) for t in {e.tipo for e in ev_pend}}, "documentos": docs_pend},
        "seguimiento": {"detenidos": len(detenidos), "candidatos": seguimiento},
        "reclutadores": sorted(por_reclutador.values(), key=lambda r: -r["postulados"]),
        "fuentes": sorted(por_fuente.values(), key=lambda r: -r["postulados"]),
        "tiendasPropias": {"ingresos": len(ingresos), "proximosIngresos": len(proximos_ingresos), "listaIngresos": ingresos_lista, "listaProximos": proximos_lista},
        "franquicias": {"presentados": sum(1 for p in franq if p.franquicia_estado), "aceptados": sum(1 for p in franq if p.franquicia_estado == "aceptado"),
                        "noAceptados": sum(1 for p in franq if p.franquicia_estado == "no_aceptado"),
                        # 2026-10-01: contratación e ingreso los confirma el franquiciatario (RH los registra); nunca suman a tiendas propias
                        "contratacionesConfirmadas": sum(1 for p in franq if p.franquicia_contratado_en),
                        "ingresosConfirmados": sum(1 for p in franq if p.franquicia_ingreso_en), "porFranquicia": sorted(por_franquicia.values(), key=lambda r: -r["presentados"])},
        "futuros": {"bajas": None, "permanencia": None, "nota": "Bajas y permanencia dependen de recibir información de SAP; no se muestran cifras inventadas."},
        "opciones": {
            "reclutadores": sorted({(v.responsable_id, v.responsable.nombre) for v in db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.responsable_id.isnot(None)).all() if v.responsable}, key=lambda x: x[1]),
            "zonas": sorted({(v.zona or "").strip() for v in db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id).all() if (v.zona or "").strip()}),
            "sucursales": sorted({(v.sucursal or "").strip() for v in db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id).all() if (v.sucursal or "").strip()}),
            "fuentes": [{"clave": k, "nombre": n} for k, n in fraiche.FUENTES_POSTULACION.items()],
        },
    }
