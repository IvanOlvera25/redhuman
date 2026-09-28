"""Módulo de Desempeño — andamiaje 2026-09-22, Desempeño v2 2026-09-27.

REGLA DE ORO: la tabla `colaboradores` es la BASE MAESTRA. Este módulo NUNCA captura personas ni crea
usuarios internos: se elige a quién evaluar de entre los colaboradores activos de la Cuenta.

Flujo:
    1. Crear la evaluación del periodo (`POST /desempeno/ciclos`) con sus criterios (medibles o
       descriptivos; IA, plantilla o manual). Queda en BORRADOR.
    2. Agregar colaboradores (`POST /desempeno/ciclos/{codigo}/participantes`) → una
       `EvaluacionDesempeno` por persona, en «pendiente». Agregar NO inicia la evaluación.
    3. Iniciar (`POST /desempeno/ciclos/{codigo}/iniciar`): Borrador → En curso (valida criterios y pesos).
    4. Evaluar (`PATCH /desempeno/evaluaciones/{codigo}`): resultados por criterio, «No aplica» con motivo.
       Estado por persona: Pendiente → En proceso → Completada (solo con todos los criterios aplicables).
    5. Cerrar (`POST /desempeno/ciclos/{codigo}/cerrar`): En curso → Cerrada (flujo de ida).
Todo cálculo sale de `services.desempeno_calculo` (vacío ≠ cero; avance = completadas ÷ incluidas).
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
    TRANSICIONES_CICLO_DESEMPENO,
    CicloDesempeno,
    Colaborador,
    Cuenta,
    EvaluacionDesempeno,
    Usuario,
    normalizar_estado_ciclo,
    normalizar_estado_persona,
    registrar,
)
from ..serial import ciclo_desempeno_dict, evaluacion_desempeno_dict
from ..services import desempeno_calculo as calc
from ..services import ia
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/desempeno", tags=["desempeno"], dependencies=[Depends(requiere_modulos_rh)])


def _ciclo(db: Session, codigo: str, cuenta_id: int) -> CicloDesempeno:
    c = db.query(CicloDesempeno).filter(CicloDesempeno.codigo == codigo, CicloDesempeno.cuenta_id == cuenta_id).first()
    if not c:
        raise HTTPException(404, "Evaluación de desempeño no encontrada.")
    return c


def _evaluacion(db: Session, codigo: str, cuenta_id: int) -> EvaluacionDesempeno:
    e = db.query(EvaluacionDesempeno).filter(EvaluacionDesempeno.codigo == codigo, EvaluacionDesempeno.cuenta_id == cuenta_id).first()
    if not e:
        raise HTTPException(404, "Evaluación no encontrada.")
    return e


def _criterios(datos_criterios: List[dict]) -> List[dict]:
    try:
        return calc.normalizar_criterios(datos_criterios)
    except calc.CriterioInvalido as ex:
        raise HTTPException(400, str(ex))


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
    equipo: str = ""
    criterios: List[dict] = []
    pesos_personalizados: bool = False
    origen_criterios: str = ""
    plantilla_id: Optional[int] = None
    # LEGADO (antes de v2): se convierten a criterios
    objetivos: List[dict] = []
    kpis: List[dict] = []
    escala_maxima: int = 100
    generado_con_ia: bool = False


def _criterios_desde_legado(objetivos: List[dict], kpis: List[dict]) -> List[dict]:
    return [
        *({"tipo": "descriptivo", "nombre": o.get("titulo") or o.get("nombre"), "descripcion": o.get("descripcion"), "peso": o.get("peso")} for o in objetivos),
        *({"tipo": "medible", "nombre": k.get("nombre"), "descripcion": k.get("descripcion"), "unidad": k.get("unidad"),
           "meta": k.get("meta"), "peso": k.get("peso")} for k in kpis),
    ]


@router.post("/ciclos", status_code=201)
def crear_ciclo(datos: CicloIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre de la evaluación es obligatorio.")
    criterios = _criterios(datos.criterios or _criterios_desde_legado(datos.objetivos, datos.kpis))
    if not criterios:
        raise HTTPException(400, "Captura al menos un criterio (puedes proponerlos con IA, usar una plantilla o capturarlos).")
    personalizados = bool(datos.pesos_personalizados) or (not datos.criterios and any(c.get("peso") for c in criterios))
    c = CicloDesempeno(
        codigo="TMP", cuenta_id=cuenta.id, nombre=datos.nombre.strip(), periodo=datos.periodo.strip(),
        descripcion=datos.descripcion.strip(), puesto_objetivo=(datos.puesto_objetivo or datos.equipo).strip(),
        equipo=(datos.equipo or datos.puesto_objetivo).strip(), criterios=criterios, pesos_personalizados=personalizados,
        origen_criterios=datos.origen_criterios or ("ia" if datos.generado_con_ia else "manual"), plantilla_id=datos.plantilla_id,
        escala_maxima=100, generado_con_ia=bool(datos.generado_con_ia) or datos.origen_criterios == "ia",
        estado="borrador", creado_por=u.nombre,
    )
    db.add(c)
    db.flush()
    c.codigo = f"DES-{700 + c.id}"
    registrar(db, u.nombre, "ciclo_desempeno_creado", "desempeno", c.codigo,
              {"nombre": c.nombre, "periodo": c.periodo, "origen": c.origen_criterios, "criterios": len(criterios), "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(c, detalle=True)


@router.get("/ciclos")
def listar_ciclos(estado: Optional[str] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    q = db.query(CicloDesempeno).filter(CicloDesempeno.cuenta_id == cuenta.id).order_by(CicloDesempeno.id.desc())
    ciclos = q.all()
    if estado:
        ciclos = [c for c in ciclos if normalizar_estado_ciclo(c.estado) == normalizar_estado_ciclo(estado)]
    return [ciclo_desempeno_dict(c) for c in ciclos]


@router.get("/ciclos/{codigo}")
def ver_ciclo(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    return ciclo_desempeno_dict(_ciclo(db, codigo, cuenta.id), detalle=True)


class CicloEditarIn(BaseModel):
    nombre: Optional[str] = None
    periodo: Optional[str] = None
    descripcion: Optional[str] = None
    equipo: Optional[str] = None
    criterios: Optional[List[dict]] = None
    pesos_personalizados: Optional[bool] = None
    estado: Optional[str] = None  # compatibilidad: usa /iniciar y /cerrar


@router.patch("/ciclos/{codigo}")
def editar_ciclo(codigo: str, datos: CicloEditarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Borrador: se edita todo. En curso / cerrada: la configuración ya no se edita aquí."""
    c = _ciclo(db, codigo, cuenta.id)
    if datos.estado is not None:
        destino = normalizar_estado_ciclo(datos.estado)
        if destino not in ESTADOS_CICLO_DESEMPENO:
            raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS_CICLO_DESEMPENO)}")
        if destino == "en_curso":
            return iniciar(codigo, db, u, cuenta)
        if destino == "cerrada":
            return cerrar(codigo, CerrarIn(aun_con_pendientes=True), db, u, cuenta)
        if destino != normalizar_estado_ciclo(c.estado):
            raise HTTPException(409, "Flujo de ida: Borrador → En curso → Cerrada.")
    configuracion = {k for k in ("nombre", "periodo", "descripcion", "equipo", "criterios", "pesos_personalizados") if getattr(datos, k) is not None}
    if configuracion and normalizar_estado_ciclo(c.estado) != "borrador":
        raise HTTPException(409, "La evaluación ya inició: su configuración solo se edita en borrador.")
    for campo in ("nombre", "periodo", "descripcion", "equipo"):
        valor = getattr(datos, campo)
        if valor is not None:
            setattr(c, campo, valor.strip())
    if datos.equipo is not None:
        c.puesto_objetivo = datos.equipo.strip()
    if datos.criterios is not None:
        criterios = _criterios(datos.criterios)
        if not criterios:
            raise HTTPException(400, "Captura al menos un criterio.")
        c.criterios = criterios
    if datos.pesos_personalizados is not None:
        c.pesos_personalizados = bool(datos.pesos_personalizados)
    if configuracion:
        registrar(db, u.nombre, "ciclo_desempeno_actualizado", "desempeno", c.codigo, {"campos": sorted(configuracion), "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(c, detalle=True)


@router.post("/ciclos/{codigo}/iniciar")
def iniciar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Borrador → En curso. Exige criterios, pesos válidos (si se personalizaron, suman 100 %) y al menos
    una persona incluida."""
    c = _ciclo(db, codigo, cuenta.id)
    if "en_curso" not in TRANSICIONES_CICLO_DESEMPENO.get(normalizar_estado_ciclo(c.estado), ()):
        raise HTTPException(409, "Solo una evaluación en borrador se puede iniciar.")
    criterios = calc.criterios_de(c)
    if not criterios:
        raise HTTPException(400, "La evaluación no tiene criterios.")
    error = calc.validar_pesos(criterios, c.pesos_personalizados)
    if error:
        raise HTTPException(400, error)
    if not calc.incluidas(c):
        raise HTTPException(400, "Agrega al menos un colaborador antes de iniciar.")
    c.estado = "en_curso"
    c.iniciado_en = datetime.now(timezone.utc)
    registrar(db, u.nombre, "ciclo_desempeno_iniciado", "desempeno", c.codigo, {"personas": len(calc.incluidas(c)), "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(c, detalle=True)


class CerrarIn(BaseModel):
    aun_con_pendientes: bool = False  # cerrar aunque haya personas sin completar (quedan fuera del promedio)


@router.post("/ciclos/{codigo}/cerrar")
def cerrar(codigo: str, datos: CerrarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """En curso → Cerrada (no se reabre). Con personas sin completar pide confirmación explícita; no exige
    brechas: una buena evaluación se cierra sin inventarlas."""
    c = _ciclo(db, codigo, cuenta.id)
    if "cerrada" not in TRANSICIONES_CICLO_DESEMPENO.get(normalizar_estado_ciclo(c.estado), ()):
        raise HTTPException(409, "Solo una evaluación en curso se puede cerrar.")
    sin_completar = [e for e in calc.incluidas(c) if normalizar_estado_persona(e.estado) != "completada"]
    if sin_completar and not datos.aun_con_pendientes:
        raise HTTPException(409, f"{len(sin_completar)} persona(s) sin completar. Confirma para cerrar de todos modos (quedarán fuera del promedio).")
    c.estado = "cerrada"
    c.cerrado_en = datetime.now(timezone.utc)
    c.cerrado_por = u.nombre
    registrar(db, u.nombre, "ciclo_desempeno_cerrado", "desempeno", c.codigo, {"sin_completar": len(sin_completar), "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(c, detalle=True)


# ------------------------------------------------------------
# 2. Seleccionar colaboradores (SIEMPRE del roster maestro)
# ------------------------------------------------------------


class ParticipantesIn(BaseModel):
    colaborador_ids: List[str] = []  # códigos COL-#### del roster
    evaluador: str = ""              # nombre del evaluador (default: quien lo asigna)


@router.post("/ciclos/{codigo}/participantes", status_code=201)
def agregar_participantes(codigo: str, datos: ParticipantesIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Agrega colaboradores del roster (idempotente por persona). NO inicia la evaluación. Nunca se captura
    una persona nueva aquí."""
    c = _ciclo(db, codigo, cuenta.id)
    if normalizar_estado_ciclo(c.estado) == "cerrada":
        raise HTTPException(409, "La evaluación está cerrada.")
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
    filas = [e for e in q.all() if e.colaborador and e.colaborador.eliminado_en is None]
    if estado:
        filas = [e for e in filas if normalizar_estado_persona(e.estado) == normalizar_estado_persona(estado)]
    if colaborador:
        filas = [e for e in filas if e.colaborador.codigo == colaborador]
    return [evaluacion_desempeno_dict(e) for e in filas]


# ------------------------------------------------------------
# 3. Evaluar (HITL: la califica una persona)
# ------------------------------------------------------------


class EvaluarIn(BaseModel):
    # v2: [{criterio_id, real, valoracion, no_aplica, motivo_no_aplica, comentario}]
    resultados: Optional[List[dict]] = None
    comentarios: Optional[str] = None
    brechas: Optional[List[dict]] = None  # [{tema, brecha, accion_sugerida}]
    completar: bool = False   # True = queda «completada» (solo si todos los criterios aplicables tienen resultado)


def _limpiar_resultados(e: EvaluacionDesempeno, filas: List[dict]) -> List[dict]:
    """Solo criterios de esta persona; un valor vacío se guarda VACÍO (nunca como 0)."""
    ids = {c["id"] for c in calc.criterios_efectivos(e)}
    salida = []
    for r in filas:
        cid = r.get("criterio_id")
        if not cid:  # formato previo a v2 (tipo/nombre/logro): se conserva tal cual
            salida.append(r)
            continue
        if cid not in ids:
            continue
        salida.append({
            "criterio_id": cid,
            "real": r.get("real") if r.get("real") not in ("", None) else None,
            "valoracion": r.get("valoracion") if r.get("valoracion") not in ("", None) else None,
            "no_aplica": bool(r.get("no_aplica")),
            "motivo_no_aplica": str(r.get("motivo_no_aplica") or "").strip(),
            "comentario": str(r.get("comentario") or "").strip(),
        })
    return salida


@router.patch("/evaluaciones/{codigo}")
def evaluar(codigo: str, datos: EvaluarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    e = _evaluacion(db, codigo, cuenta.id)
    estado_ciclo = normalizar_estado_ciclo(e.ciclo.estado if e.ciclo else "")
    if estado_ciclo != "en_curso":
        raise HTTPException(409, "Solo se evalúa con la evaluación EN CURSO (inicia la evaluación primero)." if estado_ciclo == "borrador"
                            else "La evaluación está cerrada: los resultados quedan congelados.")
    if normalizar_estado_persona(e.estado) == "completada":
        raise HTTPException(409, "Esta persona ya está completada.")
    if datos.resultados is not None:
        e.resultados = _limpiar_resultados(e, datos.resultados)
    if datos.brechas is not None:
        e.brechas = [b for b in datos.brechas if str(b.get("tema") or "").strip()]
    if datos.comentarios is not None:
        e.comentarios = datos.comentarios.strip()
    calculo = calc.calcular(e)
    e.calificacion = calculo["calificacion"]
    e.evaluador = e.evaluador or u.nombre
    if datos.completar:
        if calculo["faltantes"]:
            raise HTTPException(400, "Para completar falta: " + " ".join(calculo["faltantes"]))
        e.estado = "completada"
        e.completada_en = datetime.now(timezone.utc)
        e.completada_por = u.nombre
    else:
        e.estado = calc.estado_persona(e, calculo)
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
    """Resumen: avance = completadas ÷ incluidas; promedio SOLO con calificaciones válidas de personas
    completadas; brechas agrupadas por tema."""
    c = _ciclo(db, codigo, cuenta.id)
    evs = calc.incluidas(c)
    av = calc.avance(c)
    completadas = [e for e in evs if normalizar_estado_persona(e.estado) == "completada"]
    calificadas = [e for e in completadas if e.calificacion is not None]
    # Fortalezas: resultados con logro alto, agrupados por criterio (se reemplaza en la Fase 5 por las
    # fortalezas CONFIRMADAS por el evaluador).
    fortalezas: dict = {}
    for e in completadas:
        nombres = {cr["id"]: cr["nombre"] for cr in calc.criterios_efectivos(e)}
        for d in calc.calcular(e)["detalle"]:
            if d["cumplimiento"] is None or d["cumplimiento"] < 85:
                continue
            nombre = nombres.get(d["criterio_id"], "Sin nombre")
            fila = fortalezas.setdefault(nombre, {"tema": nombre, "personas": 0, "promedio": 0.0, "_suma": 0.0})
            fila["personas"] += 1
            fila["_suma"] += d["cumplimiento"]
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
        "total": av["incluidas"],
        "completadas": av["completadas"],
        "avance": av["porcentaje"],
        "promedio": promedio,
        "escalaMaxima": 100,
        "ranking": [
            evaluacion_desempeno_dict(e)
            for e in sorted(calificadas, key=lambda x: x.calificacion or 0, reverse=True)
        ],
        "pendientes": [evaluacion_desempeno_dict(e) for e in evs if normalizar_estado_persona(e.estado) != "completada"],
        "brechas": sorted(brechas.values(), key=lambda b: b["personas"], reverse=True),
        "fortalezas": sorted(fortalezas.values(), key=lambda f: (f["personas"], f["promedio"]), reverse=True),
    }
