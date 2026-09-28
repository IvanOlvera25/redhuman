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

import copy
import re
import unicodedata
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
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
    PlantillaDesempeno,
    Usuario,
    UsuarioCuenta,
    normalizar_estado_ciclo,
    normalizar_estado_persona,
    registrar,
)
from ..serial import ciclo_desempeno_dict, evaluacion_desempeno_dict
from ..services import desempeno_calculo as calc
from ..services import ia, masivo
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


class GenerarCriteriosIn(BaseModel):
    puesto: str          # puesto o equipo que se evalúa (obligatorio: la IA lo recibe ANTES de proponer)
    periodo: str = ""
    contexto: str = ""


@router.post("/criterios/generar")
def generar_criterios(datos: GenerarCriteriosIn, _: Usuario = Depends(usuario_decisor), __: Cuenta = Depends(cuenta_actual)):
    """Paso 3 «Proponer con Red Human»: criterios medibles y descriptivos para el puesto/equipo. Los
    medibles salen SIN meta (la IA nunca inventa cifras). NO guarda nada: RH revisa en el paso 4."""
    if not datos.puesto.strip():
        raise HTTPException(400, "Indica el puesto o equipo antes de pedir la propuesta.")
    prop, con_ia = ia.criterios_desempeno(datos.puesto, datos.periodo, datos.contexto)
    crudos = [{**c.model_dump(), "meta": None} for c in prop.criterios]
    for c in crudos:
        if c["tipo"] == "descriptivo" and len(c.get("escala") or []) != 5:
            c["escala"] = []  # la normalización pone la escala por defecto
    return {"criterios": _criterios(crudos), "generadoConIa": con_ia}


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
    evaluador: str = ""              # nombre del evaluador (compatibilidad; default: quien lo asigna)
    evaluador_usuario_id: Optional[int] = None      # evaluador para todos los agregados
    evaluadores: Dict[str, Optional[int]] = {}      # {COL-####: usuario_id} evaluador por persona


def _palabras_puesto(texto: str) -> set:
    """«Gerentes de Proyectos» ≈ «Gerente de proyecto»: minúsculas, sin acentos ni plurales simples."""
    plano = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    palabras = set()
    for w in re.findall(r"[a-z0-9]+", plano):
        if len(w) <= 2 or w in ("del", "los", "las"):
            continue
        if len(w) > 4 and w.endswith("s"):
            w = w[:-1]
        if len(w) > 4 and w.endswith("e"):
            w = w[:-1]  # «gerentes»/«gerente» → «gerent», «profesores» → «profesor»
        palabras.add(w)
    return palabras


def mismo_puesto(equipo: str, puesto: str) -> bool:
    a, b = _palabras_puesto(equipo), _palabras_puesto(puesto)
    if not a or not b:
        return True  # sin datos no se advierte
    return a <= b or b <= a


def _usuario_de_cuenta(db: Session, usuario_id: Optional[int], cuenta_id: int) -> Optional[Usuario]:
    if not usuario_id:
        return None
    ok = db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id == usuario_id, UsuarioCuenta.cuenta_id == cuenta_id).first()
    u = db.get(Usuario, usuario_id) if ok else None
    if not u or not u.activo:
        raise HTTPException(400, "El evaluador elegido no es un usuario activo de esta Cuenta.")
    return u


@router.get("/evaluadores")
def evaluadores(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Usuarios de la Cuenta que pueden evaluar (entran al sistema y guardan borradores)."""
    filas = (
        db.query(Usuario).join(UsuarioCuenta, UsuarioCuenta.usuario_id == Usuario.id)
        .filter(UsuarioCuenta.cuenta_id == cuenta.id, Usuario.activo.is_(True)).order_by(Usuario.nombre).all()
    )
    return [{"id": u.id, "nombre": u.nombre, "correo": u.correo, "puesto": u.puesto or ""} for u in filas]


class RevisarIn(BaseModel):
    colaborador_ids: List[str] = []


@router.post("/ciclos/{codigo}/participantes/revisar")
def revisar_participantes(codigo: str, datos: RevisarIn, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Antes de agregar: quiénes tienen un puesto distinto al de la evaluación (podrían necesitar otros
    criterios). RH decide aplicar los mismos criterios o crear otra evaluación; nunca bloquea."""
    c = _ciclo(db, codigo, cuenta.id)
    equipo = c.equipo or c.puesto_objetivo or ""
    otros = []
    for cod in datos.colaborador_ids:
        col = db.query(Colaborador).filter(Colaborador.codigo == cod, Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None)).first()
        if col and not mismo_puesto(equipo, col.puesto or ""):
            otros.append({"id": col.codigo, "nombre": col.nombre, "puesto": col.puesto or ""})
    return {
        "equipo": equipo,
        "otrosPuestos": otros,
        "advertencia": (
            f"{len(otros)} persona(s) tienen un puesto distinto a «{equipo}» y podrían necesitar criterios distintos. "
            "Puedes aplicarles los mismos criterios o crear otra evaluación para su puesto."
        ) if otros else "",
    }


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
        ev_u = _usuario_de_cuenta(db, datos.evaluadores.get(cod) or datos.evaluador_usuario_id, cuenta.id)
        e = EvaluacionDesempeno(
            codigo="TMP", cuenta_id=cuenta.id, ciclo_id=c.id, colaborador_id=col.id,
            evaluador=(ev_u.nombre if ev_u else (datos.evaluador.strip() or u.nombre)),
            evaluador_usuario_id=ev_u.id if ev_u else None, estado="pendiente",
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


class AjusteIn(BaseModel):
    criterio_id: str
    motivo: str = ""
    quitar: bool = False                  # True = vuelve al criterio general
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    esperado: Optional[str] = None
    unidad: Optional[str] = None
    meta: Optional[float] = None
    sentido: Optional[str] = None


CAMPOS_AJUSTABLES = ("nombre", "descripcion", "esperado", "unidad", "meta", "sentido")


@router.patch("/evaluaciones/{codigo}/ajustes")
def ajustar_criterio(codigo: str, datos: AjusteIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Ajuste INDIVIDUAL de un criterio o meta para esta persona (queda marcado como tal, con motivo). Si
    la evaluación ya inició, el cambio queda en su historial (valor anterior, nuevo, motivo, fecha, usuario)."""
    e = _evaluacion(db, codigo, cuenta.id)
    if normalizar_estado_ciclo(e.ciclo.estado) == "cerrada":
        raise HTTPException(409, "La evaluación está cerrada.")
    if normalizar_estado_persona(e.estado) == "completada":
        raise HTTPException(409, "Esta persona ya está completada.")
    base = {c["id"]: c for c in calc.criterios_de(e.ciclo)}
    if datos.criterio_id not in base:
        raise HTTPException(404, "Ese criterio no existe en la evaluación.")
    if not datos.motivo.strip():
        raise HTTPException(400, "Indica el motivo del ajuste individual.")
    ajustes = dict(e.ajustes or {})
    anterior = {k: v for k, v in {**base[datos.criterio_id], **ajustes.get(datos.criterio_id, {})}.items() if k in CAMPOS_AJUSTABLES}
    if datos.quitar:
        ajustes.pop(datos.criterio_id, None)
        nuevo = {k: v for k, v in base[datos.criterio_id].items() if k in CAMPOS_AJUSTABLES}
    else:
        cambios = {k: getattr(datos, k) for k in CAMPOS_AJUSTABLES if getattr(datos, k) is not None}
        if not cambios:
            raise HTTPException(400, "No indicaste qué cambiar.")
        if cambios.get("sentido") and cambios["sentido"] not in ("mayor_es_mejor", "menor_es_mejor"):
            raise HTTPException(400, "Sentido inválido.")
        ajustes[datos.criterio_id] = {**ajustes.get(datos.criterio_id, {}), **cambios, "motivo": datos.motivo.strip()}
        nuevo = {**anterior, **cambios}
    e.ajustes = ajustes
    if normalizar_estado_ciclo(e.ciclo.estado) == "en_curso":
        registrar_cambio(e, u, datos.criterio_id, base[datos.criterio_id]["nombre"], anterior, nuevo, datos.motivo.strip(), "persona")
    e.calificacion = calc.calcular(e)["calificacion"]
    registrar(db, u.nombre, "desempeno_ajuste_individual", "desempeno", e.codigo,
              {"criterio": datos.criterio_id, "quitar": datos.quitar, "motivo": datos.motivo.strip(), "correo_rh": u.correo})
    db.commit()
    return evaluacion_desempeno_dict(e, detalle=True)


def registrar_cambio(obj, u: Usuario, criterio_id: str, criterio: str, anterior: dict, nuevo: dict, motivo: str, nivel: str) -> None:
    """Historial de cambios a criterios/metas DESPUÉS de iniciar: un renglón por campo que cambió."""
    ahora = datetime.now(timezone.utc).isoformat()
    filas = list(obj.historial_cambios or [])
    for campo in sorted(set(anterior) | set(nuevo)):
        if anterior.get(campo) != nuevo.get(campo):
            filas.append({"fecha": ahora, "usuario": u.nombre, "criterio_id": criterio_id, "criterio": criterio, "campo": campo,
                          "anterior": anterior.get(campo), "nuevo": nuevo.get(campo), "motivo": motivo, "nivel": nivel})
    obj.historial_cambios = filas


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


# ------------------------------------------------------------
# 5. Reutilización: plantillas, duplicar evaluación e importar criterios
# ------------------------------------------------------------


def _plantilla_dict(p: PlantillaDesempeno, detalle: bool = False) -> dict:
    salida = {
        "id": p.id, "nombre": p.nombre, "descripcion": p.descripcion or "", "equipo": p.equipo or "",
        "criterios": len(p.criterios or []), "pesosPersonalizados": bool(p.pesos_personalizados), "activa": bool(p.activa),
        "creadoPor": p.creado_por or "", "actualizada": p.actualizada_en.isoformat() if p.actualizada_en else None,
        "tipos": sorted({c.get("tipo") for c in (p.criterios or [])}),
    }
    if detalle:
        salida["listaCriterios"] = list(p.criterios or [])
    return salida


def _plantilla(db: Session, pid: int, cuenta_id: int) -> PlantillaDesempeno:
    p = db.query(PlantillaDesempeno).filter(PlantillaDesempeno.id == pid, PlantillaDesempeno.cuenta_id == cuenta_id).first()
    if not p:
        raise HTTPException(404, "Plantilla no encontrada.")
    return p


class PlantillaIn(BaseModel):
    nombre: str
    descripcion: str = ""
    equipo: str = ""
    criterios: List[dict] = []
    pesos_personalizados: bool = False


def _crear_plantilla(db: Session, cuenta_id: int, datos: PlantillaIn, por: str) -> PlantillaDesempeno:
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre de la plantilla es obligatorio.")
    criterios = _criterios(datos.criterios)
    if not criterios:
        raise HTTPException(400, "La plantilla necesita al menos un criterio.")
    p = PlantillaDesempeno(cuenta_id=cuenta_id, nombre=datos.nombre.strip(), descripcion=datos.descripcion.strip(),
                           equipo=datos.equipo.strip(), criterios=criterios, pesos_personalizados=bool(datos.pesos_personalizados), creado_por=por)
    db.add(p)
    db.flush()
    return p


@router.get("/plantillas")
def listar_plantillas(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    filas = db.query(PlantillaDesempeno).filter(PlantillaDesempeno.cuenta_id == cuenta.id, PlantillaDesempeno.activa.is_(True)).order_by(PlantillaDesempeno.nombre).all()
    return [_plantilla_dict(p, detalle=True) for p in filas]


@router.post("/plantillas", status_code=201)
def crear_plantilla(datos: PlantillaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    p = _crear_plantilla(db, cuenta.id, datos, u.nombre)
    registrar(db, u.nombre, "plantilla_desempeno_creada", "desempeno", str(p.id), {"nombre": p.nombre, "correo_rh": u.correo})
    db.commit()
    return _plantilla_dict(p, detalle=True)


class GuardarPlantillaIn(BaseModel):
    nombre: str
    descripcion: str = ""


@router.post("/ciclos/{codigo}/plantilla", status_code=201)
def guardar_como_plantilla(codigo: str, datos: GuardarPlantillaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Guardar como plantilla»: copia los criterios generales (sin ajustes individuales, personas ni resultados)."""
    c = _ciclo(db, codigo, cuenta.id)
    p = _crear_plantilla(db, cuenta.id, PlantillaIn(nombre=datos.nombre, descripcion=datos.descripcion, equipo=c.equipo or c.puesto_objetivo or "",
                                                    criterios=copy.deepcopy(calc.criterios_de(c)), pesos_personalizados=calc.usa_pesos(c)), u.nombre)
    registrar(db, u.nombre, "plantilla_desempeno_creada", "desempeno", str(p.id), {"nombre": p.nombre, "desde": c.codigo, "correo_rh": u.correo})
    db.commit()
    return _plantilla_dict(p, detalle=True)


@router.get("/plantillas/{pid}")
def ver_plantilla(pid: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    return _plantilla_dict(_plantilla(db, pid, cuenta.id), detalle=True)


class EditarPlantillaIn(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    equipo: Optional[str] = None
    criterios: Optional[List[dict]] = None
    pesos_personalizados: Optional[bool] = None


@router.patch("/plantillas/{pid}")
def editar_plantilla(pid: int, datos: EditarPlantillaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Editar la plantilla NO toca ninguna evaluación: cada una conserva la copia que se hizo al usarla."""
    p = _plantilla(db, pid, cuenta.id)
    if datos.nombre is not None:
        if not datos.nombre.strip():
            raise HTTPException(400, "El nombre de la plantilla es obligatorio.")
        p.nombre = datos.nombre.strip()
    for campo in ("descripcion", "equipo"):
        if getattr(datos, campo) is not None:
            setattr(p, campo, getattr(datos, campo).strip())
    if datos.criterios is not None:
        criterios = _criterios(datos.criterios)
        if not criterios:
            raise HTTPException(400, "La plantilla necesita al menos un criterio.")
        p.criterios = criterios
    if datos.pesos_personalizados is not None:
        p.pesos_personalizados = bool(datos.pesos_personalizados)
    registrar(db, u.nombre, "plantilla_desempeno_editada", "desempeno", str(p.id), {"nombre": p.nombre, "correo_rh": u.correo})
    db.commit()
    return _plantilla_dict(p, detalle=True)


@router.delete("/plantillas/{pid}")
def eliminar_plantilla(pid: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    p = _plantilla(db, pid, cuenta.id)
    p.activa = False
    registrar(db, u.nombre, "plantilla_desempeno_desactivada", "desempeno", str(p.id), {"nombre": p.nombre, "correo_rh": u.correo})
    db.commit()
    return _plantilla_dict(p)


class DuplicarIn(BaseModel):
    nombre: str = ""
    periodo: str = ""


@router.post("/ciclos/{codigo}/duplicar", status_code=201)
def duplicar(codigo: str, datos: DuplicarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Duplicar evaluación» para otro periodo: copia la CONFIGURACIÓN (nombre, puesto/equipo, criterios y
    pesos). NUNCA copia personas evaluadas, resultados, comentarios, brechas ni ajustes individuales."""
    c = _ciclo(db, codigo, cuenta.id)
    nuevo = CicloDesempeno(
        codigo="TMP", cuenta_id=cuenta.id, nombre=(datos.nombre.strip() or f"{c.nombre} (copia)"), periodo=datos.periodo.strip(),
        descripcion=c.descripcion or "", puesto_objetivo=c.puesto_objetivo or "", equipo=c.equipo or c.puesto_objetivo or "",
        criterios=copy.deepcopy(calc.criterios_de(c)), pesos_personalizados=calc.usa_pesos(c),
        origen_criterios=c.origen_criterios or "manual", plantilla_id=c.plantilla_id, duplicado_de=c.codigo,
        escala_maxima=100, generado_con_ia=bool(c.generado_con_ia), estado="borrador", creado_por=u.nombre,
    )
    db.add(nuevo)
    db.flush()
    nuevo.codigo = f"DES-{700 + nuevo.id}"
    registrar(db, u.nombre, "ciclo_desempeno_duplicado", "desempeno", nuevo.codigo, {"desde": c.codigo, "periodo": nuevo.periodo, "correo_rh": u.correo})
    db.commit()
    return ciclo_desempeno_dict(nuevo, detalle=True)


COLUMNAS_IMPORTAR = ["tipo", "nombre", "descripcion", "unidad", "meta", "sentido", "esperado", "peso",
                     "nivel_1", "nivel_2", "nivel_3", "nivel_4", "nivel_5"]
TIPOS_IMPORTAR = {"medible": "medible", "cuantitativo": "medible", "kpi": "medible", "descriptivo": "descriptivo",
                  "cualitativo": "descriptivo", "competencia": "descriptivo", "objetivo": "descriptivo"}
SENTIDOS_IMPORTAR = {"": "mayor_es_mejor", "mayor": "mayor_es_mejor", "mayor es mejor": "mayor_es_mejor", "mayor_es_mejor": "mayor_es_mejor",
                     "menor": "menor_es_mejor", "menor es mejor": "menor_es_mejor", "menor_es_mejor": "menor_es_mejor"}


@router.get("/criterios/formato")
def formato_criterios(_: Usuario = Depends(usuario_actual)):
    return masivo.csv_plantilla("criterios_desempeno.csv", COLUMNAS_IMPORTAR, [
        ["medible", "Proyectos entregados a tiempo", "Entregas en la fecha comprometida", "%", "95", "mayor", "", "", "", "", "", "", ""],
        ["descriptivo", "Comunicación con el cliente", "", "", "", "", "Informa avances y riesgos a tiempo", "",
         "No informa", "Informa a destiempo", "Informa a tiempo", "Anticipa riesgos", "Es referente"],
    ])


@router.post("/criterios/importar")
async def vista_previa_importacion(archivo: UploadFile = File(...), _: Usuario = Depends(usuario_decisor), __: Cuenta = Depends(cuenta_actual)):
    """VISTA PREVIA de criterios desde Excel/CSV: columnas detectadas, cada fila normalizada y sus errores.
    NO guarda nada — el usuario confirma y los criterios válidos pasan al editor (evaluación o plantilla)."""
    filas = await masivo.leer_tabla(archivo)
    detectadas = sorted({k for _, f in filas for k in f})
    salida, validos = [], []
    for n, f in filas:
        errores = []
        tipo_txt = (f.get("tipo") or "").strip().lower()
        sentido_txt = (f.get("sentido") or "").strip().lower()
        tipo = TIPOS_IMPORTAR.get(tipo_txt)
        sentido = SENTIDOS_IMPORTAR.get(sentido_txt)
        if not (f.get("nombre") or "").strip():
            errores.append("Falta el nombre.")
        if not tipo:
            errores.append(f"Tipo «{tipo_txt}» no reconocido (usa medible o descriptivo).")
        if tipo == "medible" and sentido is None:
            errores.append(f"Sentido «{sentido_txt}» no reconocido (usa mayor o menor).")
        meta_txt = (f.get("meta") or "").strip()
        if tipo == "medible" and meta_txt and calc._num(meta_txt) is None:
            errores.append(f"La meta «{meta_txt}» no es un número.")
        peso_txt = (f.get("peso") or "").strip()
        if peso_txt and calc._num(peso_txt) is None:
            errores.append(f"El peso «{peso_txt}» no es un número.")
        niveles = [f.get(f"nivel_{i}") or "" for i in range(1, 6)]
        criterio = None
        if not errores:
            crudo = {"tipo": tipo, "nombre": f.get("nombre"), "descripcion": f.get("descripcion"), "unidad": f.get("unidad"),
                     "meta": meta_txt or None, "sentido": sentido, "esperado": f.get("esperado"), "peso": peso_txt or None,
                     "escala": [{"valor": i, "significado": t} for i, t in enumerate(niveles, start=1)] if all(t.strip() for t in niveles) else []}
            try:
                criterio = calc.normalizar_criterios([crudo])[0]
                criterio["id"] = f"c{len(validos) + 1}"
                validos.append(criterio)
            except calc.CriterioInvalido as ex:
                errores.append(str(ex))
        salida.append({"fila": n, "valores": f, "criterio": criterio, "errores": errores})
    return {
        "columnasDetectadas": detectadas,
        "columnasEsperadas": COLUMNAS_IMPORTAR,
        "columnasDesconocidas": [c for c in detectadas if c not in COLUMNAS_IMPORTAR],
        "filas": salida,
        "validos": validos,
        "conErrores": sum(1 for x in salida if x["errores"]),
    }
