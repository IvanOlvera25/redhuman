"""Onboarding v2 (2026-09-28) — Fase 1: Plantillas de Onboarding (Configuración) y tareas por persona.

* Plantilla = documentos requeridos, recursos internos (correo, equipo, accesos), responsables por defecto,
  curso de inducción y plazos RELATIVOS a la fecha de ingreso. Alcance «empresa» (toda la Cuenta o una razón
  social contratante) o «puesto». La de puesto prevalece sobre la de empresa (`services.onboarding`).
* «Eliminar» una plantilla = desactivarla; los Onboardings ya generados con ella no se tocan (se copiaron).
* Tareas: pendiente → realizada | cancelada (con motivo). Las tres fijas (Contrato firmado, Alta IMSS /
  nómina, Confirmar ingreso) son obligatorias y no se cancelan una por una; «Contrato firmado» solo se
  cierra al cargar el contrato firmado.
* Ninguna ruta de aquí escribe `Postulacion.etapa` (B5).
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import (
    ALCANCES_PLANTILLA_ONBOARDING,
    DOCUMENTOS_BASE,
    ESTADOS_DOCUMENTO_ONBOARDING,
    PLAZOS_ONBOARDING_DEFAULT,
    TAREAS_FIJAS_ONBOARDING,
    TIPOS_RECURSO_ONBOARDING,
    Candidato,
    Cuenta,
    Curso,
    Expediente,
    PlantillaOnboarding,
    TareaOnboarding,
    Usuario,
    Vacante,
    registrar,
)
from ..serial import plantilla_onboarding_dict, tarea_onboarding_dict
from ..services import onboarding as onb
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/onboarding", tags=["onboarding"], dependencies=[Depends(requiere_modulos_rh)])


def _plantilla(db: Session, pid: int, cuenta_id: int) -> PlantillaOnboarding:
    p = db.query(PlantillaOnboarding).filter(PlantillaOnboarding.id == pid, PlantillaOnboarding.cuenta_id == cuenta_id).first()
    if not p:
        raise HTTPException(404, "Plantilla de Onboarding no encontrada.")
    return p


def _curso_titulo(db: Session, curso_id: Optional[int], cuenta_id: int) -> str:
    if not curso_id:
        return ""
    c = db.query(Curso).filter(Curso.id == curso_id, Curso.cuenta_id == cuenta_id).first()
    return c.titulo if c else ""


def _dict(db: Session, p: PlantillaOnboarding) -> dict:
    return plantilla_onboarding_dict(p, _curso_titulo(db, p.curso_induccion_id, p.cuenta_id))


def _expediente(db: Session, exp_id: int, cuenta_id: int) -> Expediente:
    e = (
        db.query(Expediente)
        .join(Candidato, Expediente.candidato_id == Candidato.id)
        .filter(Expediente.id == exp_id, Candidato.cuenta_id == cuenta_id)
        .first()
    )
    if not e:
        raise HTTPException(404, "Expediente no encontrado.")
    return e


def _tarea(db: Session, tid: int, cuenta_id: int) -> TareaOnboarding:
    t = db.query(TareaOnboarding).filter(TareaOnboarding.id == tid, TareaOnboarding.cuenta_id == cuenta_id).first()
    if not t:
        raise HTTPException(404, "Tarea de Onboarding no encontrada.")
    return t


# ---------- Plantillas (Configuración) ----------

class PlantillaOnboardingIn(BaseModel):
    nombre: str
    alcance: str = "empresa"
    empresa: str = ""
    puesto: str = ""
    documentos: Optional[List[dict]] = None  # None = los predeterminados
    recursos: List[dict] = []
    responsables: dict = {}
    plazos: dict = {}
    curso_induccion_id: Optional[int] = None


class EditarPlantillaOnboardingIn(BaseModel):
    nombre: Optional[str] = None
    alcance: Optional[str] = None
    empresa: Optional[str] = None
    puesto: Optional[str] = None
    documentos: Optional[List[dict]] = None
    recursos: Optional[List[dict]] = None
    responsables: Optional[dict] = None
    plazos: Optional[dict] = None
    curso_induccion_id: Optional[int] = None
    quitar_curso: bool = False
    activa: Optional[bool] = None


def _validar(db: Session, cuenta: Cuenta, p: PlantillaOnboarding) -> None:
    """Reglas comunes a crear y editar (se llama con los valores ya aplicados, antes del commit)."""
    from .cuentas import razones_sociales_de

    if not (p.nombre or "").strip():
        raise HTTPException(400, "El nombre de la plantilla es obligatorio.")
    if p.alcance not in ALCANCES_PLANTILLA_ONBOARDING:
        raise HTTPException(400, "Alcance inválido: usa «empresa» o «puesto».")
    if p.alcance == "puesto" and not (p.puesto or "").strip():
        raise HTTPException(400, "Una plantilla de puesto necesita el nombre del puesto.")
    if p.alcance == "empresa":
        p.puesto = ""
    if p.empresa:
        razones = {r["razonSocial"].lower(): r["razonSocial"] for r in razones_sociales_de(db, cuenta)}
        if p.empresa.strip().lower() not in razones:
            raise HTTPException(400, "La empresa debe ser una razón social configurada en la Cuenta o en un Cliente activo.")
        p.empresa = razones[p.empresa.strip().lower()]
    if not p.documentos:
        raise HTTPException(400, "La plantilla necesita al menos un documento requerido.")
    if p.curso_induccion_id and not _curso_titulo(db, p.curso_induccion_id, cuenta.id):
        raise HTTPException(400, "El curso de inducción no existe en esta Cuenta.")
    if p.activa:
        dup = (
            db.query(PlantillaOnboarding)
            .filter(PlantillaOnboarding.cuenta_id == cuenta.id, PlantillaOnboarding.activa.is_(True), PlantillaOnboarding.alcance == p.alcance)
            .all()
        )
        for o in dup:
            if o.id != p.id and onb.norm(o.puesto) == onb.norm(p.puesto) and onb.norm(o.empresa) == onb.norm(p.empresa):
                quien = f"el puesto «{p.puesto}»" if p.alcance == "puesto" else "la empresa"
                raise HTTPException(409, f"Ya existe una plantilla activa para {quien}{' en ' + p.empresa if p.empresa else ''}: «{o.nombre}». Edítala o desactívala.")


@router.get("/plantillas")
def listar_plantillas(incluir_inactivas: bool = False, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    q = db.query(PlantillaOnboarding).filter(PlantillaOnboarding.cuenta_id == cuenta.id)
    if not incluir_inactivas:
        q = q.filter(PlantillaOnboarding.activa.is_(True))
    # puesto primero (prevalece), luego empresa
    lista = sorted(q.all(), key=lambda p: (0 if p.alcance == "puesto" else 1, onb.norm(p.puesto), onb.norm(p.nombre)))
    return [_dict(db, p) for p in lista]


@router.get("/plantillas/opciones")
def opciones(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Catálogos para el formulario: razones sociales, puestos sugeridos, cursos y valores predeterminados."""
    from .cuentas import razones_sociales_de

    puestos = sorted({
        (v.titulo or "").strip()
        for v in db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.estado != "Eliminada").all()
        if (v.titulo or "").strip()
    }, key=onb.norm)
    cursos = db.query(Curso).filter(Curso.cuenta_id == cuenta.id, Curso.estado != "Archivado").order_by(Curso.titulo).all()
    return {
        "razonesSociales": [r["razonSocial"] for r in razones_sociales_de(db, cuenta)],
        "puestos": puestos,
        "cursos": [{"id": c.id, "codigo": c.codigo, "titulo": c.titulo, "estado": c.estado} for c in cursos],
        "documentosBase": list(DOCUMENTOS_BASE),
        "tareasFijas": [{"clave": c, "nombre": n} for c, n in TAREAS_FIJAS_ONBOARDING],
        "tiposRecurso": list(TIPOS_RECURSO_ONBOARDING),
        "plazosDefault": dict(PLAZOS_ONBOARDING_DEFAULT),
        "estadosDocumento": list(ESTADOS_DOCUMENTO_ONBOARDING),
    }


@router.get("/plantillas/resolver")
def resolver(puesto: str = "", empresa: str = "", db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Qué configuración le tocaría a una persona con ese puesto y empresa (vista previa; no guarda nada)."""
    cfg = onb.configuracion_para(db, cuenta.id, puesto, empresa)
    cfg["cursoInduccion"] = _curso_titulo(db, cfg.get("cursoInduccionId"), cuenta.id)
    return cfg


@router.post("/plantillas", status_code=201)
def crear_plantilla(datos: PlantillaOnboardingIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    docs = onb.normalizar_documentos(datos.documentos) if datos.documentos is not None else onb.configuracion_predeterminada()["documentos"]
    p = PlantillaOnboarding(
        cuenta_id=cuenta.id, nombre=(datos.nombre or "").strip()[:200], alcance=(datos.alcance or "").strip().lower(),
        empresa=(datos.empresa or "").strip(), puesto=(datos.puesto or "").strip()[:200], documentos=docs,
        recursos=onb.normalizar_recursos(datos.recursos), responsables=onb.normalizar_responsables(datos.responsables),
        plazos=onb.normalizar_plazos(datos.plazos), curso_induccion_id=datos.curso_induccion_id or None, activa=True, creado_por=u.nombre,
    )
    _validar(db, cuenta, p)
    db.add(p)
    db.flush()
    registrar(db, u.nombre, "plantilla_onboarding_creada", "onboarding", str(p.id),
              {"nombre": p.nombre, "alcance": p.alcance, "puesto": p.puesto, "empresa": p.empresa, "correo_rh": u.correo})
    db.commit()
    return _dict(db, p)


@router.get("/plantillas/{pid}")
def ver_plantilla(pid: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    return _dict(db, _plantilla(db, pid, cuenta.id))


@router.patch("/plantillas/{pid}")
def editar_plantilla(pid: int, datos: EditarPlantillaOnboardingIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Editar la plantilla NO toca los Onboardings ya generados (se copiaron al aplicarla)."""
    p = _plantilla(db, pid, cuenta.id)
    if datos.nombre is not None:
        p.nombre = datos.nombre.strip()[:200]
    if datos.alcance is not None:
        p.alcance = datos.alcance.strip().lower()
    if datos.empresa is not None:
        p.empresa = datos.empresa.strip()
    if datos.puesto is not None:
        p.puesto = datos.puesto.strip()[:200]
    if datos.documentos is not None:
        p.documentos = onb.normalizar_documentos(datos.documentos)
    if datos.recursos is not None:
        p.recursos = onb.normalizar_recursos(datos.recursos)
    if datos.responsables is not None:
        p.responsables = onb.normalizar_responsables(datos.responsables)
    if datos.plazos is not None:
        p.plazos = onb.normalizar_plazos(datos.plazos)
    if datos.quitar_curso:
        p.curso_induccion_id = None
    elif datos.curso_induccion_id is not None:
        p.curso_induccion_id = datos.curso_induccion_id or None
    if datos.activa is not None:
        p.activa = bool(datos.activa)
    try:
        _validar(db, cuenta, p)
    except HTTPException:
        db.rollback()
        raise
    registrar(db, u.nombre, "plantilla_onboarding_editada", "onboarding", str(p.id), {"nombre": p.nombre, "correo_rh": u.correo})
    db.commit()
    return _dict(db, p)


@router.delete("/plantillas/{pid}")
def eliminar_plantilla(pid: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Baja lógica: la plantilla deja de aplicarse; los Onboardings ya generados no se tocan."""
    p = _plantilla(db, pid, cuenta.id)
    p.activa = False
    registrar(db, u.nombre, "plantilla_onboarding_desactivada", "onboarding", str(p.id), {"nombre": p.nombre, "correo_rh": u.correo})
    db.commit()
    return _dict(db, p)


# ---------- Tareas de una persona ----------

@router.get("/expedientes/{exp_id}/tareas")
def listar_tareas(exp_id: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    e = _expediente(db, exp_id, cuenta.id)
    return [tarea_onboarding_dict(t) for t in onb.tareas_de(db, e)]


class TareaIn(BaseModel):
    nombre: str
    tipo: str = "otro"
    responsable: str = ""
    dias: Optional[int] = None  # relativo a la fecha de ingreso
    obligatoria: bool = True


@router.post("/expedientes/{exp_id}/tareas", status_code=201)
def agregar_tarea(exp_id: int, datos: TareaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Tarea adicional SOLO para esta persona (no altera la plantilla)."""
    e = _expediente(db, exp_id, cuenta.id)
    nombre = (datos.nombre or "").strip()[:200]
    if not nombre:
        raise HTTPException(400, "Indica el nombre de la tarea.")
    if any(onb.norm(t.nombre) == onb.norm(nombre) and t.estado != "cancelada" for t in onb.tareas_de(db, e)):
        raise HTTPException(409, f"El Onboarding ya tiene la tarea «{nombre}».")
    tipo = datos.tipo if datos.tipo in TIPOS_RECURSO_ONBOARDING else "otro"
    t = TareaOnboarding(
        cuenta_id=cuenta.id, expediente_id=e.id, clave="otra", nombre=nombre, tipo=tipo, fija=False, obligatoria=datos.obligatoria,
        responsable=datos.responsable.strip()[:150], dias_relativos=datos.dias, fecha_limite=onb.fecha_limite(e.fecha_ingreso, datos.dias), creada_por=u.nombre,
    )
    db.add(t)
    db.flush()
    registrar(db, u.nombre, "tarea_onboarding_agregada", "expediente", str(e.id), {"tarea": nombre, "correo_rh": u.correo})
    db.commit()
    return tarea_onboarding_dict(t)


class EditarTareaIn(BaseModel):
    estado: Optional[str] = None  # pendiente | realizada | cancelada
    motivo: str = ""
    responsable: Optional[str] = None
    notas: Optional[str] = None
    fecha_limite: Optional[datetime] = None


@router.patch("/tareas/{tid}")
def editar_tarea(tid: int, datos: EditarTareaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    t = _tarea(db, tid, cuenta.id)
    e = db.get(Expediente, t.expediente_id)
    if e and e.estado == "alta" and datos.estado and datos.estado != t.estado:
        # tras el alta solo se permite cerrar lo pendiente, nunca reabrir
        if datos.estado == "pendiente":
            raise HTTPException(409, "El colaborador ya fue dado de alta; las tareas cerradas no se reabren.")
    anterior = t.estado
    if datos.estado is not None:
        error = onb.cambiar_estado_tarea(t, datos.estado, datos.motivo, u.nombre)
        if error:
            codigo = 400 if ("motivo" in error.lower() or "inválido" in error) else 409
            raise HTTPException(codigo, error)
    if datos.responsable is not None:
        t.responsable = datos.responsable.strip()[:150]
    if datos.notas is not None:
        t.notas = datos.notas.strip()[:2000]
    if datos.fecha_limite is not None:
        t.fecha_limite = datos.fecha_limite
        t.dias_relativos = None  # fecha fija capturada por RH: ya no se recalcula con la de ingreso
    registrar(db, u.nombre, "tarea_onboarding_actualizada", "expediente", str(t.expediente_id),
              {"tarea": t.nombre, "de": anterior, "a": t.estado, "motivo": t.motivo_cancelacion[:300], "correo_rh": u.correo})
    db.commit()
    return tarea_onboarding_dict(t)
