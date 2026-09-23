"""Módulo de Desempeño — andamiaje 2026-09-22.

REGLA DE ORO: la tabla `colaboradores` es la BASE MAESTRA. Este módulo NUNCA captura personas ni crea
usuarios internos: se elige a quién evaluar de entre los colaboradores activos de la Cuenta.

Flujo (el mismo que ve RH en pantalla):
    1. Crear la evaluación del periodo (`POST /desempeno/ciclos`), con objetivos y KPIs capturados por RH
       o propuestos por la IA (`POST /desempeno/ciclos/generar`, siempre editables).
    2. Seleccionar colaboradores (`POST /desempeno/ciclos/{codigo}/participantes`) → una
       `EvaluacionDesempeno` por persona, en estado «pendiente».
    3. Evaluar (`PATCH /desempeno/evaluaciones/{codigo}`): resultados por objetivo/KPI, comentarios y
       brechas. La calificación se calcula ponderada; siempre la firma una persona (HITL).
    4. Resultados y brechas del ciclo (`GET /desempeno/ciclos/{codigo}/resultados`), insumo directo del
       módulo de Capacitación.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import (
    ESTADOS_CICLO_DESEMPENO,
    CicloDesempeno,
    Colaborador,
    Cuenta,
    EvaluacionDesempeno,
    Usuario,
    registrar,
)
from ..serial import ciclo_desempeno_dict, evaluacion_desempeno_dict
from ..services import ia
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/desempeno", tags=["desempeno"], dependencies=[Depends(requiere_modulos_rh)])


def _ciclo(db: Session, codigo: str, cuenta_id: int) -> CicloDesempeno:
    c = db.query(CicloDesempeno).filter(CicloDesempeno.codigo == codigo, CicloDesempeno.cuenta_id == cuenta_id).first()
    if not c:
        raise HTTPException(404, "Ciclo de desempeño no encontrado.")
    return c


def _evaluacion(db: Session, codigo: str, cuenta_id: int) -> EvaluacionDesempeno:
    e = db.query(EvaluacionDesempeno).filter(EvaluacionDesempeno.codigo == codigo, EvaluacionDesempeno.cuenta_id == cuenta_id).first()
    if not e:
        raise HTTPException(404, "Evaluación no encontrada.")
    return e


# ------------------------------------------------------------
# 1. Crear la evaluación del periodo (con o sin IA)
# ------------------------------------------------------------


class GenerarPlanIn(BaseModel):
    puesto: str = ""
    periodo: str = ""
    contexto: str = ""


@router.post("/ciclos/generar")
def generar_plan(datos: GenerarPlanIn, _: Usuario = Depends(usuario_decisor), __: Cuenta = Depends(cuenta_actual)):
    """«Crear evaluación con IA»: propone objetivos y KPIs para el puesto/periodo. NO guarda nada —
    RH los edita y luego crea el ciclo. Sin OPENAI_API_KEY regresa una propuesta base editable."""
    plan, con_ia = ia.plan_desempeno(datos.puesto, datos.periodo, datos.contexto)
    return {
        "objetivos": [o.model_dump() for o in plan.objetivos],
        "kpis": [k.model_dump() for k in plan.kpis],
        "generadoConIa": con_ia,
    }


class CicloIn(BaseModel):
    nombre: str
    periodo: str = ""
    descripcion: str = ""
    puesto_objetivo: str = ""
    objetivos: List[dict] = []
    kpis: List[dict] = []
    escala_maxima: int = 100
    generado_con_ia: bool = False


@router.post("/ciclos", status_code=201)
def crear_ciclo(datos: CicloIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre de la evaluación es obligatorio.")
    if not datos.objetivos and not datos.kpis:
        raise HTTPException(400, "Captura al menos un objetivo o un KPI (puedes generarlos con IA y editarlos).")
    c = CicloDesempeno(
        codigo="TMP", cuenta_id=cuenta.id, nombre=datos.nombre.strip(), periodo=datos.periodo.strip(),
        descripcion=datos.descripcion.strip(), puesto_objetivo=datos.puesto_objetivo.strip(),
        objetivos=list(datos.objetivos), kpis=list(datos.kpis),
        escala_maxima=max(1, int(datos.escala_maxima or 100)), generado_con_ia=bool(datos.generado_con_ia),
        estado="borrador", creado_por=u.nombre,
    )
    db.add(c)
    db.flush()
    c.codigo = f"DES-{700 + c.id}"
    registrar(db, u.nombre, "ciclo_desempeno_creado", "desempeno", c.codigo, {"nombre": c.nombre, "periodo": c.periodo, "con_ia": c.generado_con_ia, "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(c)


@router.get("/ciclos")
def listar_ciclos(estado: Optional[str] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    q = db.query(CicloDesempeno).filter(CicloDesempeno.cuenta_id == cuenta.id).order_by(CicloDesempeno.id.desc())
    if estado:
        q = q.filter(CicloDesempeno.estado == estado)
    return [ciclo_desempeno_dict(c) for c in q.all()]


@router.get("/ciclos/{codigo}")
def ver_ciclo(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    return ciclo_desempeno_dict(_ciclo(db, codigo, cuenta.id), detalle=True)


class CicloEditarIn(BaseModel):
    nombre: Optional[str] = None
    periodo: Optional[str] = None
    descripcion: Optional[str] = None
    objetivos: Optional[List[dict]] = None
    kpis: Optional[List[dict]] = None
    escala_maxima: Optional[int] = None
    estado: Optional[str] = None  # borrador | en_curso | cerrado


@router.patch("/ciclos/{codigo}")
def editar_ciclo(codigo: str, datos: CicloEditarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    c = _ciclo(db, codigo, cuenta.id)
    if datos.estado is not None and datos.estado not in ESTADOS_CICLO_DESEMPENO:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS_CICLO_DESEMPENO)}")
    for campo in ("nombre", "periodo", "descripcion"):
        valor = getattr(datos, campo)
        if valor is not None:
            setattr(c, campo, valor.strip())
    if datos.objetivos is not None:
        c.objetivos = list(datos.objetivos)
    if datos.kpis is not None:
        c.kpis = list(datos.kpis)
    if datos.escala_maxima is not None:
        c.escala_maxima = max(1, int(datos.escala_maxima))
    if datos.estado is not None:
        c.estado = datos.estado
        c.cerrado_en = datetime.now(timezone.utc) if datos.estado == "cerrado" else None
    registrar(db, u.nombre, "ciclo_desempeno_actualizado", "desempeno", c.codigo, {"estado": c.estado, "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(c, detalle=True)


# ------------------------------------------------------------
# 2. Seleccionar colaboradores (SIEMPRE del roster maestro)
# ------------------------------------------------------------


class ParticipantesIn(BaseModel):
    colaborador_ids: List[str] = []  # códigos COL-#### del roster
    evaluador: str = ""              # quién evalúa (default: quien lo asigna)


@router.post("/ciclos/{codigo}/participantes", status_code=201)
def agregar_participantes(codigo: str, datos: ParticipantesIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Agrega colaboradores del roster al ciclo (idempotente por persona). Nunca se captura una persona
    nueva aquí: si no está en `colaboradores`, primero se da de alta desde Contratación."""
    c = _ciclo(db, codigo, cuenta.id)
    if not datos.colaborador_ids:
        raise HTTPException(400, "Elige al menos un colaborador.")
    creadas, existentes, no_encontrados = [], [], []
    for cod in datos.colaborador_ids:
        col = db.query(Colaborador).filter(
            Colaborador.codigo == cod, Colaborador.cuenta_id == cuenta.id,
            Colaborador.eliminado_en.is_(None), Colaborador.activo.is_(True),
        ).first()
        if not col:
            no_encontrados.append(cod)
            continue
        prev = db.query(EvaluacionDesempeno).filter(EvaluacionDesempeno.ciclo_id == c.id, EvaluacionDesempeno.colaborador_id == col.id).first()
        if prev:
            existentes.append(prev)
            continue
        e = EvaluacionDesempeno(
            codigo="TMP", cuenta_id=cuenta.id, ciclo_id=c.id, colaborador_id=col.id,
            evaluador=(datos.evaluador.strip() or u.nombre), estado="pendiente",
        )
        db.add(e)
        db.flush()
        e.codigo = f"EVD-{3000 + e.id}"
        creadas.append(e)
    if not creadas and not existentes:
        raise HTTPException(404, "Ninguno de los colaboradores indicados existe o está activo.")
    if c.estado == "borrador" and creadas:
        c.estado = "en_curso"
    registrar(db, u.nombre, "desempeno_participantes_agregados", "desempeno", c.codigo,
              {"creadas": [e.codigo for e in creadas], "existentes": [e.codigo for e in existentes], "no_encontrados": no_encontrados, "correo_rh": u.correo})
    db.commit()
    return {
        "ciclo": ciclo_desempeno_dict(c),
        "evaluaciones": [evaluacion_desempeno_dict(e) for e in [*creadas, *existentes]],
        "noEncontrados": no_encontrados,
    }


@router.get("/evaluaciones")
def listar_evaluaciones(
    ciclo: Optional[str] = None, colaborador: Optional[str] = None, estado: Optional[str] = None,
    db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual),
):
    """Tablero del módulo: una fila por persona evaluada (filtros por ciclo, colaborador o estado)."""
    q = db.query(EvaluacionDesempeno).filter(EvaluacionDesempeno.cuenta_id == cuenta.id).order_by(EvaluacionDesempeno.id.desc())
    if ciclo:
        q = q.filter(EvaluacionDesempeno.ciclo_id == _ciclo(db, ciclo, cuenta.id).id)
    if estado:
        q = q.filter(EvaluacionDesempeno.estado == estado)
    filas = [e for e in q.all() if e.colaborador and e.colaborador.eliminado_en is None]
    if colaborador:
        filas = [e for e in filas if e.colaborador.codigo == colaborador]
    return [evaluacion_desempeno_dict(e) for e in filas]


# ------------------------------------------------------------
# 3. Evaluar (HITL: la califica una persona)
# ------------------------------------------------------------


class EvaluarIn(BaseModel):
    # [{tipo: objetivo|kpi, nombre, meta, real, logro (0-100), peso, comentario}]
    resultados: List[dict] = []
    comentarios: str = ""
    brechas: List[dict] = []  # [{tema, brecha, accion_sugerida}]
    completar: bool = False   # True = queda «completada» y se sella la fecha


def _calificacion(resultados: List[dict], escala: int) -> Optional[float]:
    """Promedio PONDERADO de los logros capturados (0-100 → escala del ciclo). None si no hay ninguno."""
    filas = [r for r in resultados if r.get("logro") is not None]
    if not filas:
        return None
    total_peso = sum(float(r.get("peso") or 0) for r in filas)
    if total_peso <= 0:
        return round(sum(float(r["logro"]) for r in filas) / len(filas) * escala / 100, 1)
    ponderado = sum(float(r["logro"]) * float(r.get("peso") or 0) for r in filas) / total_peso
    return round(ponderado * escala / 100, 1)


@router.patch("/evaluaciones/{codigo}")
def evaluar(codigo: str, datos: EvaluarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    e = _evaluacion(db, codigo, cuenta.id)
    if datos.resultados:
        e.resultados = list(datos.resultados)
    if datos.brechas:
        e.brechas = list(datos.brechas)
    if datos.comentarios:
        e.comentarios = datos.comentarios.strip()
    e.calificacion = _calificacion(e.resultados or [], e.ciclo.escala_maxima if e.ciclo else 100)
    e.evaluador = e.evaluador or u.nombre
    if datos.completar:
        e.estado = "completada"
        e.completada_en = datetime.now(timezone.utc)
    elif e.estado == "pendiente" and (e.resultados or e.comentarios):
        e.estado = "en_curso"
    registrar(db, u.nombre, "desempeno_evaluado", "desempeno", e.codigo,
              {"colaborador": e.colaborador.codigo if e.colaborador else None, "calificacion": e.calificacion, "estado": e.estado, "correo_rh": u.correo})
    db.commit()
    return evaluacion_desempeno_dict(e, detalle=True)


@router.get("/evaluaciones/{codigo}")
def ver_evaluacion(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    return evaluacion_desempeno_dict(_evaluacion(db, codigo, cuenta.id), detalle=True)


# ------------------------------------------------------------
# 4. Resultados y brechas del ciclo
# ------------------------------------------------------------


@router.get("/ciclos/{codigo}/resultados")
def resultados(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Resumen del ciclo: avance, calificación promedio, ranking y brechas agrupadas (insumo del plan de
    capacitación: cada brecha dice a cuántas personas les aparece)."""
    c = _ciclo(db, codigo, cuenta.id)
    evs = [e for e in c.evaluaciones if e.colaborador and e.colaborador.eliminado_en is None]
    completadas = [e for e in evs if e.estado == "completada"]
    calificadas = [e for e in completadas if e.calificacion is not None]
    # Fortalezas: resultados con logro alto, agrupados por objetivo/KPI (lo que el equipo sí domina).
    fortalezas: dict = {}
    for e in completadas:
        for r in e.resultados or []:
            try:
                logro = float(r.get("logro"))
            except (TypeError, ValueError):
                continue
            if logro < 85:
                continue
            nombre = str(r.get("nombre") or "").strip() or "Sin nombre"
            fila = fortalezas.setdefault(nombre, {"tema": nombre, "personas": 0, "promedio": 0.0, "_suma": 0.0})
            fila["personas"] += 1
            fila["_suma"] += logro
            fila["promedio"] = round(fila["_suma"] / fila["personas"], 1)
    for fila in fortalezas.values():
        fila.pop("_suma", None)

    brechas: dict = {}
    for e in evs:
        for b in e.brechas or []:
            tema = str(b.get("tema") or "").strip() or "Sin tema"
            fila = brechas.setdefault(tema, {"tema": tema, "personas": 0, "acciones": [], "colaboradores": []})
            fila["personas"] += 1
            fila["colaboradores"].append(e.colaborador.nombre if e.colaborador else "")
            accion = str(b.get("accion_sugerida") or "").strip()
            if accion and accion not in fila["acciones"]:
                fila["acciones"].append(accion)
    promedio = round(sum(e.calificacion for e in calificadas) / len(calificadas), 1) if calificadas else None
    return {
        "ciclo": ciclo_desempeno_dict(c),
        "total": len(evs),
        "completadas": len(completadas),
        "avance": round(len(completadas) / len(evs) * 100) if evs else 0,
        "promedio": promedio,
        "escalaMaxima": c.escala_maxima,
        "ranking": [
            evaluacion_desempeno_dict(e)
            for e in sorted(calificadas, key=lambda x: x.calificacion or 0, reverse=True)
        ],
        "pendientes": [evaluacion_desempeno_dict(e) for e in evs if e.estado != "completada"],
        "brechas": sorted(brechas.values(), key=lambda b: b["personas"], reverse=True),
        "fortalezas": sorted(fortalezas.values(), key=lambda f: (f["personas"], f["promedio"]), reverse=True),
    }
