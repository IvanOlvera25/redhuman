"""Evaluaciones y verificaciones del candidato + catálogo de Pruebas psicométricas (2026-09-28).

* Catálogo (Configuración → Pruebas psicométricas): identificador interno, nombre visible, descripción, puestos
  sugeridos, modo (Integrada / Enlace externo / Carga manual), proveedor, identificador en el proveedor y estado.
* Ficha → «…» → «Agregar evaluación o verificación»: Psicométrica, Técnica o caso práctico, Referencias, Médico,
  Socioeconómico u Otra. Se cuelga de la POSTULACIÓN y nunca mueve la columna del pipeline.
* Consentimientos antes de enviar/asignar (ver services/evaluaciones.py). El estudio médico exige consentimiento
  EXPRESO y POR ESCRITO por medio electrónico: liga pública `/consentimiento/{token}` donde la persona lee el texto,
  escribe su nombre y acepta; se guarda el texto exacto, la aceptación y la evidencia (y la bitácora hash-encadenada).
* Informe médico COMPLETO solo para quien tiene permiso (`Usuario.puede_ver_informe_medico`); el resto ve estado y
  dictamen. Sin conexiones a proveedores todavía: el modo Integrada se avanza a mano (simulado).
"""

import hashlib
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import (
    MODOS_PRUEBA,
    TEXTO_CONSENTIMIENTO_MEDICO,
    TIPOS_EVALUACION,
    Cuenta,
    EvaluacionCandidato,
    Postulacion,
    PruebaPsicometrica,
    Usuario,
    registrar,
)
from ..serial import evaluacion_candidato_dict, nombre_empresa_candidato, prueba_psicometrica_dict
from ..services import evaluaciones as sev
from ..services import fraiche
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/evaluaciones", tags=["evaluaciones"], dependencies=[Depends(requiere_modulos_rh)])


def _norm(s: str) -> str:
    from ..services.onboarding import norm

    return norm(s)


# ---------------- Catálogo: Pruebas psicométricas ----------------

def _prueba(db: Session, pid: int, cuenta_id: int) -> PruebaPsicometrica:
    pr = db.query(PruebaPsicometrica).filter(PruebaPsicometrica.id == pid, PruebaPsicometrica.cuenta_id == cuenta_id).first()
    if not pr:
        raise HTTPException(404, "Prueba psicométrica no encontrada.")
    return pr


class PruebaIn(BaseModel):
    clave: str
    nombre: str
    descripcion: str = ""
    puestos: List[str] = []
    modo: str = "manual"
    proveedor: str = ""
    id_proveedor: str = ""
    url: str = ""
    activa: bool = True
    incluye: List[str] = []  # 2026-10-02: pruebas que incluye la batería (se muestran al asignar)
    instrucciones: str = ""  # se mandan al candidato junto con su liga


class EditarPruebaIn(BaseModel):
    clave: Optional[str] = None
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    puestos: Optional[List[str]] = None
    modo: Optional[str] = None
    proveedor: Optional[str] = None
    id_proveedor: Optional[str] = None
    url: Optional[str] = None
    activa: Optional[bool] = None
    incluye: Optional[List[str]] = None
    instrucciones: Optional[str] = None


def _validar_prueba(db: Session, cuenta_id: int, pr: PruebaPsicometrica) -> None:
    pr.clave = (pr.clave or "").strip()[:60]
    pr.nombre = (pr.nombre or "").strip()[:200]
    if not pr.clave:
        raise HTTPException(400, "Captura el identificador interno de la prueba.")
    if not pr.nombre:
        raise HTTPException(400, "Captura el nombre visible de la prueba.")
    if pr.modo not in MODOS_PRUEBA:
        raise HTTPException(400, "Modo inválido: usa integrada, enlace o manual.")
    if pr.modo == "enlace" and not sev.liga_real(pr.url):
        raise HTTPException(400, "La prueba con «Liga del proveedor» necesita la liga REAL que te dio el proveedor (https://…); una liga de ejemplo no abre.")
    if pr.modo == "integrada" and not (pr.proveedor or "").strip():
        raise HTTPException(400, "El modo «Integrada» necesita el proveedor.")
    pr.puestos = [p.strip()[:200] for p in (pr.puestos or []) if p and p.strip()]
    otra = (
        db.query(PruebaPsicometrica)
        .filter(PruebaPsicometrica.cuenta_id == cuenta_id, PruebaPsicometrica.id != (pr.id or 0))
        .all()
    )
    if any(_norm(o.clave) == _norm(pr.clave) for o in otra):
        raise HTTPException(409, f"Ya existe una prueba con el identificador «{pr.clave}».")


@router.get("/pruebas")
def listar_pruebas(incluir_inactivas: bool = False, puesto: str = "", db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Con `puesto` las sugeridas para ese puesto van primero (`sugerida=true`)."""
    q = db.query(PruebaPsicometrica).filter(PruebaPsicometrica.cuenta_id == cuenta.id)
    if not incluir_inactivas:
        q = q.filter(PruebaPsicometrica.activa.is_(True))
    np_ = _norm(puesto)
    salida = []
    for pr in q.all():
        d = prueba_psicometrica_dict(pr)
        d["sugerida"] = bool(np_) and any(_norm(x) == np_ for x in pr.puestos or [])
        salida.append(d)
    return sorted(salida, key=lambda d: (not d["sugerida"], _norm(d["nombre"])))


@router.post("/pruebas", status_code=201)
def crear_prueba(datos: PruebaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    pr = PruebaPsicometrica(cuenta_id=cuenta.id, creado_por=u.nombre, **datos.model_dump())
    _validar_prueba(db, cuenta.id, pr)
    db.add(pr)
    db.flush()
    registrar(db, u.nombre, "prueba_psicometrica_creada", "evaluaciones", str(pr.id), {"clave": pr.clave, "modo": pr.modo, "correo_rh": u.correo})
    db.commit()
    return prueba_psicometrica_dict(pr)


@router.patch("/pruebas/{pid}")
def editar_prueba(pid: int, datos: EditarPruebaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    pr = _prueba(db, pid, cuenta.id)
    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(pr, campo, valor)
    try:
        _validar_prueba(db, cuenta.id, pr)
    except HTTPException:
        db.rollback()
        raise
    registrar(db, u.nombre, "prueba_psicometrica_editada", "evaluaciones", str(pr.id), {"clave": pr.clave, "correo_rh": u.correo})
    db.commit()
    return prueba_psicometrica_dict(pr)


@router.delete("/pruebas/{pid}")
def inactivar_prueba(pid: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Baja lógica: queda Inactiva; las evaluaciones ya asignadas con ella no cambian."""
    pr = _prueba(db, pid, cuenta.id)
    pr.activa = False
    registrar(db, u.nombre, "prueba_psicometrica_inactivada", "evaluaciones", str(pr.id), {"clave": pr.clave, "correo_rh": u.correo})
    db.commit()
    return prueba_psicometrica_dict(pr)


# ---------------- Evaluaciones de una postulación ----------------

def _postulacion(db: Session, codigo: str, cuenta_id: int) -> Postulacion:
    from .candidatos import _por_codigo

    return _por_codigo(db, codigo, cuenta_id)


def _evaluacion(db: Session, codigo: str, cuenta_id: int) -> EvaluacionCandidato:
    ev = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.codigo == codigo, EvaluacionCandidato.cuenta_id == cuenta_id).first()
    if not ev:
        raise HTTPException(404, "Evaluación no encontrada.")
    return ev


def _post_de(db: Session, ev: EvaluacionCandidato) -> Optional[Postulacion]:
    return db.get(Postulacion, ev.postulacion_id)


def evaluaciones_de(db: Session, p: Postulacion) -> List[EvaluacionCandidato]:
    return db.query(EvaluacionCandidato).filter(EvaluacionCandidato.postulacion_id == p.id).order_by(EvaluacionCandidato.id).all()


@router.get("/postulaciones/{codigo}")
def listar_evaluaciones(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    p = _postulacion(db, codigo, cuenta.id)
    evs = evaluaciones_de(db, p)
    if any(sev.refrescar_consentimiento(ev, p) for ev in evs):  # el consentimiento pudo llegar por otro medio
        db.commit()
    return [evaluacion_candidato_dict(ev, u) for ev in evs]


class ResponsableIn(BaseModel):
    """Fraiche (spec §10): quién realiza la evaluación — Usuario de la Cuenta, contacto del Cliente guardado o
    persona capturada (proveedor, médico, encargado). Nunca limita a contactos registrados."""
    usuario_id: Optional[int] = None
    contacto_id: Optional[int] = None
    nombre: str = ""
    correo: str = ""
    whatsapp: str = ""


class AgregarEvaluacionIn(BaseModel):
    tipo: str
    nombre: str = ""
    prueba_id: Optional[int] = None  # psicométrica del catálogo
    prueba_ids: List[int] = []  # 2026-10-02 (§7): varias pruebas a la vez (cada una con estado y resultado propios)
    enviar: bool = True  # 2026-10-02 (§9): avisar automáticamente al candidato y al responsable
    correo_candidato: str = ""  # §8: si el proveedor exige correo y falta, se captura y guarda desde aquí
    referencias_modo: str = ""  # §10: candidato (liga de captura) | responsable (el responsable las recaba)
    referencias_requeridas: Optional[int] = None  # §10: vacío = las que pida la vacante
    interno: bool = False  # uso interno: alta de UNA prueba dentro de una asignación múltiple
    # 2026-10-04 (pruebas psicométricas §1-2): modalidad y accesos
    modalidad: str = "digital"  # digital | presencial | videoconferencia
    liga_videollamada: str = ""
    liga_candidato: str = ""  # liga externa del proveedor para el candidato (cuando la conexión no la entrega)
    modo: str = ""  # vacío = el de la prueba o «manual»
    proveedor: str = ""
    id_proveedor: str = ""
    url: str = ""
    notas: str = ""
    # --- Fraiche (spec §10) ---
    responsable: Optional[ResponsableIn] = None
    cita: Optional[str] = None  # ISO «2026-10-05T10:00» (hora de México)
    cita_lugar: str = ""
    generar_liga: bool = False  # liga de acceso para la persona externa (/evaluacion/{token})


def _resolver_responsable(db: Session, cuenta_id: int, p: Postulacion, r: Optional[ResponsableIn]) -> dict:
    """→ {nombre, correo, whatsapp, usuario_id, contacto_id}. Interno: datos del perfil del Usuario; contacto del
    Cliente de la vacante: sus datos; captura manual: lo que venga."""
    if r is None:
        return {}
    if r.usuario_id:
        u = db.query(Usuario).filter(Usuario.id == r.usuario_id, Usuario.activo.is_(True)).first()
        if not u:
            raise HTTPException(400, "El usuario responsable no existe o no está activo.")
        return {"nombre": u.nombre, "correo": u.correo or "", "whatsapp": u.telefono or "", "usuario_id": u.id, "contacto_id": None}
    if r.contacto_id:
        from ..models import ClienteContacto

        cliente_id = p.vacante.cliente_id if p.vacante else None
        c = db.query(ClienteContacto).filter(ClienteContacto.id == r.contacto_id, ClienteContacto.cliente_id == cliente_id).first() if cliente_id else None
        if not c:
            raise HTTPException(400, "El contacto elegido no pertenece al Cliente de la vacante de esta postulación.")
        return {"nombre": f"{c.nombre} {c.apellidos or ''}".strip(), "correo": c.correo or "", "whatsapp": c.telefono or "", "usuario_id": None, "contacto_id": c.id}
    nombre = (r.nombre or "").strip()
    if not nombre:
        raise HTTPException(400, "Indica el nombre de la persona responsable.")
    return {"nombre": nombre[:150], "correo": (r.correo or "").strip()[:200], "whatsapp": (r.whatsapp or "").strip()[:30], "usuario_id": None, "contacto_id": None}


def _parsear_cita(valor: Optional[str]) -> Optional[datetime]:
    if not valor or not str(valor).strip():
        return None
    from ..services.notificaciones import TZ_MEXICO

    try:
        dt = datetime.fromisoformat(str(valor).strip())
    except ValueError:
        raise HTTPException(400, "La cita debe venir como AAAA-MM-DDTHH:MM (hora de México).")
    return (dt.replace(tzinfo=TZ_MEXICO) if dt.tzinfo is None else dt).astimezone(timezone.utc)


def _aplicar_responsable_y_cita(db: Session, cuenta_id: int, p: Postulacion, ev: EvaluacionCandidato, responsable: Optional[ResponsableIn], cita: Optional[str], cita_lugar: Optional[str]) -> None:
    datos = _resolver_responsable(db, cuenta_id, p, responsable)
    if datos:
        ev.responsable, ev.responsable_correo, ev.responsable_whatsapp = datos["nombre"], datos["correo"], datos["whatsapp"]
        ev.responsable_usuario_id, ev.responsable_contacto_id = datos["usuario_id"], datos["contacto_id"]
    if cita is not None:
        ev.cita_en = _parsear_cita(cita)
    if cita_lugar is not None:
        ev.cita_lugar = cita_lugar.strip()[:300]


@router.post("/postulaciones/{codigo}", status_code=201)
async def agregar_evaluacion(codigo: str, datos: AgregarEvaluacionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Agregar evaluación o verificación» desde la ficha. NO toca la etapa de la postulación. Comprueba los
    consentimientos: si falta alguno queda «En espera de consentimiento» (y no se puede enviar).
    2026-10-02: psicometría admite VARIAS pruebas (una evaluación por prueba, sin duplicar las ya asignadas) y, con
    `enviar`, cada destinatario recibe su aviso con SU liga (candidato / responsable / médico)."""
    p = _postulacion(db, codigo, cuenta.id)
    if not p.activa:
        raise HTTPException(409, "La postulación está cerrada.")
    if datos.tipo not in TIPOS_EVALUACION:
        raise HTTPException(400, f"Tipo inválido. Usa uno de: {', '.join(TIPOS_EVALUACION)}.")
    from ..services import fraiche_pipeline as fp

    if fp.es_franquicia(p) and fp.es_ruta_fraiche(p) and datos.tipo in fp.TIPOS_SOLO_TIENDA:
        raise HTTPException(409, f"«{TIPOS_EVALUACION[datos.tipo]}» no aplica a la ruta Franquicia (sin IPV, psicometría, médico ni socioeconómico de Fraiche).")
    if datos.tipo == "socioeconomico" and fp.es_ruta_fraiche(p) and not fp.aplica_socioeconomico(p):
        raise HTTPException(409, "En tienda propia el estudio socioeconómico aplica solo a Cajero y Encargado.")
    if datos.correo_candidato.strip():
        _guardar_correo_candidato(p, datos.correo_candidato, u.nombre, db)
    ids = list(dict.fromkeys([i for i in (datos.prueba_ids or []) if i] + ([datos.prueba_id] if datos.prueba_id else [])))
    if datos.tipo == "psicometrica" and datos.prueba_ids and not datos.interno:
        creadas, omitidas, envios = [], [], []
        for pid in ids:
            sub = datos.model_copy(update={"prueba_id": pid, "prueba_ids": [pid], "correo_candidato": "", "interno": True})
            r = await agregar_evaluacion(codigo, sub, db, u, cuenta)
            if r.get("omitida"):
                omitidas.append(r["omitida"])
            else:
                creadas.append(r)
                envios += r.get("envios") or []
        if not creadas:
            raise HTTPException(409, "Esas pruebas ya están asignadas a esta postulación: " + "; ".join(omitidas))
        return {**creadas[0], "evaluaciones": creadas, "omitidas": omitidas, "envios": envios}
    nombre, modo, proveedor, id_prov, url = datos.nombre.strip(), datos.modo.strip(), datos.proveedor.strip(), datos.id_proveedor.strip(), datos.url.strip()
    prueba = None
    if datos.tipo == "psicometrica":
        if not ids:
            raise HTTPException(400, "Elige la prueba psicométrica del catálogo (Configuración → Pruebas psicométricas).")
        prueba = _prueba(db, ids[0], cuenta.id)
        if not prueba.activa:
            raise HTTPException(409, "Esa prueba psicométrica está inactiva.")
        ya = [e for e in evaluaciones_de(db, p) if e.prueba_id == prueba.id and e.estado != "fallida"]
        if ya and datos.prueba_ids:  # §7: al asignar VARIAS, las que ya estaban no se duplican (agregar nunca sustituye)
            return {"omitida": f"«{prueba.nombre}» ya está asignada ({ya[-1].codigo})"}
        nombre = nombre or prueba.nombre
        modo = modo or prueba.modo
        proveedor, id_prov, url = proveedor or prueba.proveedor, id_prov or prueba.id_proveedor, url or prueba.url
    nombre = (nombre or TIPOS_EVALUACION[datos.tipo])[:200]
    modo = modo or "manual"
    if modo not in MODOS_PRUEBA:
        raise HTTPException(400, "Modo inválido: usa integrada, enlace o manual.")
    if modo == "enlace" and datos.tipo != "psicometrica" and not sev.liga_real(url):
        raise HTTPException(400, "El modo «Enlace externo» necesita la liga (https://…).")
    ev = EvaluacionCandidato(
        codigo="TMP", cuenta_id=cuenta.id, postulacion_id=p.id, tipo=datos.tipo, nombre=nombre, prueba_id=prueba.id if prueba else None,
        modo=modo, proveedor=proveedor[:150], id_proveedor=id_prov[:150], url=url[:500], notas=datos.notas.strip()[:2000],
        requiere_consentimiento_expreso=datos.tipo == "medico", asignada_por=u.nombre, estado="en_espera_consentimiento", historial=[],
    )
    if ev.requiere_consentimiento_expreso:
        ev.consentimiento_token = secrets.token_urlsafe(24)
    # Fraiche (spec §10): responsable, cita y liga de acceso de la persona externa
    _aplicar_responsable_y_cita(db, cuenta.id, p, ev, datos.responsable, datos.cita, datos.cita_lugar)
    # 2026-10-04 (§2): prueba primero, modalidad después — digital no lleva cita; presencial pide fecha, hora y lugar;
    # videoconferencia, fecha, hora y liga de la videollamada. Responsable = el reclutador asignado (se puede cambiar).
    from ..models import MODALIDADES_EVALUACION

    ev.modalidad = datos.modalidad if datos.modalidad in MODALIDADES_EVALUACION else "digital"
    if datos.tipo != "psicometrica":
        ev.modalidad = "presencial" if ev.cita_en else "digital"  # las demás evaluaciones conservan su cita y lugar
    elif ev.modalidad == "digital":
        ev.cita_en, ev.cita_lugar = None, ""
    elif not ev.cita_en:
        raise HTTPException(400, "Indica la fecha y hora de la prueba.")
    if datos.tipo == "psicometrica" and ev.modalidad == "presencial" and not ev.cita_lugar:
        raise HTTPException(400, "Indica el lugar de la prueba presencial.")
    if datos.tipo == "psicometrica" and ev.modalidad == "videoconferencia":
        if not sev.liga_real(datos.liga_videollamada):
            raise HTTPException(400, "Indica la liga de la videollamada (https://…).")
        ev.liga_videollamada = datos.liga_videollamada.strip()[:500]
    if datos.liga_candidato.strip():
        if not sev.liga_real(datos.liga_candidato):
            raise HTTPException(400, "La liga externa de la prueba debe ser la liga real del proveedor (https://…).")
        ev.liga_candidato = datos.liga_candidato.strip()[:500]
    if not ev.responsable and datos.tipo == "psicometrica":
        resp = (p.vacante.responsable if p.vacante and p.vacante.responsable and p.vacante.responsable.activo else None) or u
        ev.responsable, ev.responsable_correo, ev.responsable_whatsapp = resp.nombre, resp.correo or "", resp.telefono or ""
        ev.responsable_usuario_id = resp.id
    if datos.tipo == "psicometrica" and not ev.token_externo:
        ev.token_externo = secrets.token_urlsafe(24)  # acceso del RESPONSABLE (consultar / registrar resultados)
    if datos.generar_liga or sev.es_franquiciatario(ev) or sev.es_encargado(ev) or (ev.responsable and ev.tipo != "psicometrica"):
        ev.token_externo = secrets.token_urlsafe(24)
    if ev.tipo == "referencias":
        ev.referencias_modo = datos.referencias_modo if datos.referencias_modo in ("candidato", "responsable") else ("responsable" if ev.responsable else "candidato")
        req = datos.referencias_requeridas if datos.referencias_requeridas is not None else (getattr(p.vacante, "referencias_requeridas", None) if p.vacante else None)
        ev.referencias_requeridas = max(1, min(10, int(req or 1)))
        if ev.referencias_modo == "candidato":
            ev.token_candidato = secrets.token_urlsafe(24)
    if ev.es_medico:
        sev.guardar_texto(ev, "notas", ev.notas)  # cifrado desde el primer día
    db.add(ev)
    db.flush()
    ev.codigo = f"EVA-{7000 + ev.id}"
    sev.mover(ev, "en_espera_consentimiento", u.nombre, "Asignada" + (f" · responsable: {ev.responsable}" if ev.responsable else ""))
    sev.refrescar_consentimiento(ev, p, u.nombre)
    # Fraiche (spec §11): la ruta visible registra el paso alcanzado (RH lo confirma en el Kanban)
    fraiche.avanzar_paso(p, "presentacion" if sev.es_franquiciatario(ev) else "psicometria" if ev.tipo == "psicometrica" else "referencias" if ev.tipo == "referencias" else "evaluaciones_adicionales")
    registrar(db, u.nombre, "evaluacion_asignada", "postulacion", p.codigo,
              {"evaluacion": ev.codigo, "tipo": ev.tipo, "nombre": ev.nombre, "modo": ev.modo, "estado": ev.estado, "responsable": ev.responsable, "correo_rh": u.correo})
    db.flush()
    envios = await avisar_asignacion(db, ev, p, u.nombre) if datos.enviar else []
    db.commit()
    return {**evaluacion_candidato_dict(ev, u), "envios": envios}


# ---------------- Avisos de la actividad (2026-10-02, cambios integrados §8-10) ----------------

INSTRUCCIONES_PSICOMETRIA = ("Hazla desde una computadora o celular con buena conexión, en un lugar tranquilo y en una sola sesión. "
                             "No hay respuestas correctas ni incorrectas: contesta con sinceridad.")


def _guardar_correo_candidato(p: Postulacion, correo: str, actor: str, db: Session) -> None:
    import re as _re

    correo = (correo or "").strip()
    if not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", correo):
        raise HTTPException(400, "El correo del candidato no tiene un formato válido.")
    if p.candidato and (p.candidato.correo or "") != correo:
        anterior = p.candidato.correo or ""
        p.candidato.correo = correo
        registrar(db, actor, "correo_candidato_capturado", "postulacion", p.codigo, {"anterior": anterior, "nuevo": correo})


def _empresa(p: Optional[Postulacion]) -> str:
    return nombre_empresa_candidato(p.vacante) if p and p.vacante else ""


def _cita_texto(ev: EvaluacionCandidato) -> str:
    if not ev.cita_en:
        return ""
    from ..services.notificaciones import _fecha_hora_legible_mx

    return f" Cita: {_fecha_hora_legible_mx(ev.cita_en)}" + (f" en {ev.cita_lugar}" if ev.cita_lugar else "") + "."


def _rol_responsable(ev: EvaluacionCandidato) -> str:
    return "medico" if ev.es_medico else "franquiciatario" if sev.es_franquiciatario(ev) else "responsable"


async def _activar_psicometria(db: Session, ev: EvaluacionCandidato, p: Postulacion, actor: str) -> str:
    """Crea la evaluación REAL en el proveedor (una sola vez: un reintento nunca la duplica) y deja la liga del
    candidato. Regresa el motivo si no se pudo ("" = lista)."""
    from ..services import psicometricas as psi

    falta = sev.falta_consentimiento(ev, p)
    if falta:
        return falta
    if sev.usa_psicometricas(ev) and psi.configurado():
        if not ev.clave_proveedor:
            if not (p and p.correo):
                return "Psicométricas.mx necesita el correo del candidato: captúralo y vuelve a enviar."
            try:
                clave = psi.agregar_candidato(p.nombre, p.correo, p.vacante.titulo if p.vacante else ev.nombre, psi.tests_de(ev.id_proveedor))
            except psi.PsicometricasError as ex:
                return str(ex)
            ev.clave_proveedor = clave
            ev.liga_candidato = psi.url_candidato(clave) or ""
            sev.aplicar_paso(ev, "enviada", actor, "Psicométricas.mx")
    elif ev.modo == "integrada":
        if (ev.paso_integrada or "asignada") == "asignada":
            sev.aplicar_paso(ev, "enviada", actor)
    elif ev.modo == "enlace" and not sev.liga_candidato(ev):
        return (f"«{ev.nombre}» no tiene una liga real del proveedor para el candidato. Captúrala en Configuración → Pruebas "
                "psicométricas (o en la evaluación) y vuelve a enviar.")
    elif ev.estado == "pendiente":
        sev.mover(ev, "en_proceso", actor, "Liga enviada al candidato" if sev.liga_candidato(ev) else "Asignada al candidato")
    return ""


def _instrucciones_prueba(ev: EvaluacionCandidato) -> str:
    from ..models import PruebaPsicometrica
    from sqlalchemy.orm import object_session

    try:
        db_ = object_session(ev)
        pr = db_.get(PruebaPsicometrica, ev.prueba_id) if (db_ and ev.prueba_id) else None
    except Exception:  # noqa: BLE001
        pr = None
    return pr.instrucciones if pr and pr.instrucciones else INSTRUCCIONES_PSICOMETRIA


def _texto_psicometria(ev: EvaluacionCandidato, p: Postulacion) -> str:
    """2026-10-04 (§3): el candidato recibe TODO lo necesario por su canal — instrucciones + liga real + clave (si
    aplica). Nunca «el proveedor te enviará un correo». Presencial: la cita (contesta en el lugar, con el responsable).
    Videoconferencia: la cita, la liga de la videollamada y el acceso a la prueba."""
    nombre = (p.nombre or "").split(" ")[0]
    vac = p.vacante.titulo if p.vacante else "la vacante"
    liga = sev.liga_candidato(ev)
    if liga and ev.clave_proveedor:
        # 2026-10-05: la liga y la clave en su propia línea (en Telegram además va el botón «Abrir prueba»)
        acceso = (f"\n\n👉 Entra aquí para contestarla:\n{liga}\n\n🔑 Tu clave de acceso: {ev.clave_proveedor}\n\n"
                  "Escribe la clave, acepta el aviso de privacidad y da clic en «Ingresar».")
    elif liga:
        acceso = f"\n\n👉 Entra aquí para contestarla:\n{liga}"
    else:
        acceso = f" Tu clave de acceso: {ev.clave_proveedor}." if ev.clave_proveedor else ""
    base = f"Hola {nombre}. Como parte de tu proceso para {vac} en {_empresa(p)}, te asignamos la prueba «{ev.nombre}»."
    if ev.modalidad == "presencial":
        return f"{base}{_cita_texto(ev)} La contestarás en ese lugar; {ev.responsable or 'el equipo de RH'} te dará acceso. Llega 10 minutos antes."
    if ev.modalidad == "videoconferencia":
        return (f"{base}{_cita_texto(ev)} Conéctate a la videollamada: {ev.liga_videollamada}. Durante la llamada contestarás la prueba."
                f"{acceso} {_instrucciones_prueba(ev)}").strip()
    return f"{base} {_instrucciones_prueba(ev)}{acceso}".strip()


async def _aviso_candidato(db: Session, ev: EvaluacionCandidato, p: Postulacion, actor: str, evento: str) -> List[dict]:
    from ..config import settings
    from ..services import avisos

    nombre = (p.nombre or "").split(" ")[0]
    vac = p.vacante.titulo if p.vacante else "la vacante"
    liga, cta, asunto = "", "Abrir", f"{ev.nombre} — {vac}"
    if ev.tipo == "psicometrica":
        motivo = await _activar_psicometria(db, ev, p, actor)
        if motivo:
            return [{"fecha": datetime.now(timezone.utc).isoformat(), "evento": evento, "destinatario": "candidato", "nombre": p.nombre,
                     "canal": "", "destino": "", "enviado": False, "estado": "fallido", "detalle": motivo}]
        texto, liga, cta = _texto_psicometria(ev, p), sev.liga_candidato(ev), "Abrir prueba"
    elif ev.es_medico:
        if ev.consentimiento_aceptado_en:
            texto = f"Hola {nombre}. Tu estudio médico para {vac} en {_empresa(p)} quedó programado.{_cita_texto(ev)}"
        else:
            liga = f"{settings.app_url.rstrip('/')}/consentimiento/{ev.consentimiento_token}"
            texto = (f"Hola {nombre}. Para continuar con tu proceso en {_empresa(p)} necesitamos tu consentimiento por escrito para el "
                     f"estudio médico.{_cita_texto(ev)} Léelo y, si estás de acuerdo, acéptalo aquí: {liga}")
            cta, asunto = "Leer y aceptar", "Consentimiento para tu estudio médico"
    elif ev.tipo == "referencias" and ev.referencias_modo == "candidato":
        if not ev.token_candidato:
            ev.token_candidato = secrets.token_urlsafe(24)
        liga = f"{settings.app_url.rstrip('/')}/referencias/{ev.token_candidato}"
        req = max(1, int(ev.referencias_requeridas or 1))
        texto = (f"Hola {nombre}. Para continuar con tu proceso para {vac} en {_empresa(p)}, compártenos {req} referencia{'s' if req != 1 else ''} "
                 f"laboral{'es' if req != 1 else ''} (empresa, puesto, periodo y una persona de contacto). Captúralas aquí: {liga}")
        cta, asunto = "Capturar referencias", "Tus referencias laborales"
    elif ev.tipo == "referencias":
        texto = f"Hola {nombre}. Vamos a validar tus referencias laborales para {vac} en {_empresa(p)}; {ev.responsable or 'nuestro equipo'} podría contactarte para completar datos."
    else:
        texto = f"Hola {nombre}. Como parte de tu proceso para {vac} en {_empresa(p)} se programó «{ev.nombre}».{_cita_texto(ev)}" + (f" Te atenderá {ev.responsable}." if ev.responsable else "")
    if ev.tipo != "medico" and sev.falta_consentimiento(ev, p):
        return [{"fecha": datetime.now(timezone.utc).isoformat(), "evento": evento, "destinatario": "candidato", "nombre": p.nombre,
                 "canal": "", "destino": "", "enviado": False, "estado": "pendiente", "detalle": sev.falta_consentimiento(ev, p)}]
    return await avisos.avisar(db, rol="candidato", nombre=p.nombre, telefono=p.telefono or "", correo=p.correo or "", asunto=asunto, texto=texto,
                               liga=liga, cta=cta, empresa=_empresa(p), evento=evento, referencia=ev.codigo, postulacion=p,
                               filas=[("Actividad", ev.nombre), ("Vacante", vac)])


async def _aviso_responsable(db: Session, ev: EvaluacionCandidato, p: Postulacion, evento: str, motivo: str = "") -> List[dict]:
    """El responsable (médico, proveedor, encargado, franquiciatario…) recibe SU liga: la de registrar/validar."""
    from ..config import settings
    from ..services import avisos

    if not (ev.responsable_whatsapp or ev.responsable_correo):
        return []
    if not ev.token_externo:
        ev.token_externo = secrets.token_urlsafe(24)
    liga = f"{settings.app_url.rstrip('/')}/evaluacion/{ev.token_externo}"
    vac = p.vacante.titulo if p.vacante else "la vacante"
    if ev.tipo == "psicometrica":
        abrir = sev.liga_candidato(ev)
        accion = ((f"Abrir prueba (para que el candidato la conteste ahí): {abrir}. " if abrir and ev.modalidad != "digital" else "")
                  + (f"Clave del candidato: {ev.clave_proveedor}. " if ev.clave_proveedor and ev.modalidad != "digital" else "")
                  + "Consulta o registra el resultado")
    elif ev.tipo == "referencias":
        accion = "Captura y valida sus referencias laborales" if ev.referencias_modo != "candidato" else "Valida las referencias laborales que capturó el candidato"
    elif ev.es_medico:
        accion = "Registra el dictamen (el candidato ya otorgó su consentimiento)" if ev.consentimiento_aceptado_en else "Podrás registrar el dictamen cuando el candidato otorgue su consentimiento"
    else:
        accion = "Registra el resultado"
    texto = (f"Hola {ev.responsable or ''}. {_empresa(p)} te asignó «{ev.nombre}» de {p.nombre} para {vac}.{_cita_texto(ev)} "
             f"{motivo + ' ' if motivo else ''}{accion} aquí: {liga}").replace("  ", " ")
    envios = await avisos.avisar(db, rol=_rol_responsable(ev), nombre=ev.responsable, telefono=ev.responsable_whatsapp or "", correo=ev.responsable_correo or "",
                                 asunto=f"Evaluación asignada: {ev.nombre}", texto=texto, liga=liga, cta="Abrir evaluación", empresa=_empresa(p),
                                 evento=evento, referencia=ev.codigo, filas=[("Candidato", p.nombre), ("Vacante", vac)])
    if any(e.get("enviado") for e in envios):
        ev.liga_enviada_en = datetime.now(timezone.utc)
    return envios


async def avisar_asignacion(db: Session, ev: EvaluacionCandidato, p: Postulacion, actor: str, evento: str = "evaluacion_asignada",
                            destinatario: str = "") -> List[dict]:
    """§9: al asignar (o reenviar) cada destinatario recibe instrucciones y la liga de SU función. Nunca truena."""
    from ..services import avisos

    envios: List[dict] = []
    try:
        if destinatario in ("", "candidato"):
            envios += await _aviso_candidato(db, ev, p, actor, evento)
        if destinatario in ("", "responsable") and not (ev.es_medico and not ev.consentimiento_aceptado_en and destinatario == ""):
            envios += await _aviso_responsable(db, ev, p, evento)
    except Exception as ex:  # noqa: BLE001
        envios.append({"fecha": datetime.now(timezone.utc).isoformat(), "evento": evento, "destinatario": destinatario or "candidato", "canal": "",
                       "destino": "", "enviado": False, "estado": "fallido", "detalle": str(ex)[:200]})
    for e in envios:
        e["por"] = actor
    avisos.registrar_envios(ev, envios)
    if envios:
        registrar(db, actor, "evaluacion_avisos", "postulacion", p.codigo,
                  {"evaluacion": ev.codigo, "evento": evento, "envios": [{k: e.get(k) for k in ("destinatario", "canal", "destino", "estado", "detalle")} for e in envios]})
    return envios


class ReenviarAvisoIn(BaseModel):
    destinatario: str = ""  # candidato | responsable | "" = ambos


@router.post("/{codigo}/avisos")
async def reenviar_avisos(codigo: str, datos: ReenviarAvisoIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Reenviar»: vuelve a mandar el aviso (con su liga) al candidato y/o al responsable y registra el estado."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    if ev.estado == "fallida":
        raise HTTPException(409, "La evaluación está cancelada.")
    envios = await avisar_asignacion(db, ev, p, u.nombre, "evaluacion_reenvio", datos.destinatario if datos.destinatario in ("candidato", "responsable") else "")
    db.commit()
    return {**evaluacion_candidato_dict(ev, u), "envios": envios}


async def avisar_rh(db: Session, ev: EvaluacionCandidato, p: Postulacion, titulo: str, texto: str) -> List[dict]:
    """Aviso a RH (quien asignó la evaluación; si no se encuentra, el correo de comunicación de la Cuenta)."""
    from ..models import Cuenta as _Cuenta
    from ..services import avisos

    rh = db.query(Usuario).filter(Usuario.nombre == ev.asignada_por, Usuario.activo.is_(True)).first() if ev.asignada_por else None
    correo = (rh.correo if rh else "") or ((db.get(_Cuenta, ev.cuenta_id).correo_comunicacion or "") if db.get(_Cuenta, ev.cuenta_id) else "")
    if not correo:
        return []
    envios = await avisos.avisar(db, rol="rh", nombre=rh.nombre if rh else "RH", correo=correo, asunto=titulo, texto=texto, empresa=_empresa(p),
                                 evento="evaluacion_rh", referencia=ev.codigo, canales=("correo",),
                                 filas=[("Candidato", p.nombre if p else ""), ("Evaluación", ev.nombre)])
    avisos.registrar_envios(ev, envios)
    return envios


class EditarEvaluacionIn(BaseModel):
    responsable: Optional[ResponsableIn] = None
    liga_candidato: Optional[str] = None  # 2026-10-04: liga REAL del proveedor para el candidato ("" = quitar)
    cita: Optional[str] = None  # "" = quitar
    cita_lugar: Optional[str] = None
    notas: Optional[str] = None


@router.patch("/{codigo}")
def editar_evaluacion(codigo: str, datos: EditarEvaluacionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fraiche (spec §10): RH cambia responsable, cita (si aplica) o notas de la evaluación."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    _aplicar_responsable_y_cita(db, cuenta.id, p, ev, datos.responsable, datos.cita, datos.cita_lugar)
    if datos.notas is not None:
        sev.guardar_texto(ev, "notas", datos.notas.strip()[:2000])
    if datos.liga_candidato is not None:
        liga = datos.liga_candidato.strip()
        if liga and not sev.liga_real(liga):
            raise HTTPException(400, "Pega la liga real del proveedor (https://…).")
        ev.liga_candidato = liga[:500]
        sev.mover(ev, ev.estado, u.nombre, "Liga del candidato " + ("actualizada" if liga else "quitada"))
    registrar(db, u.nombre, "evaluacion_editada", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "responsable": ev.responsable, "cita": ev.cita_en.isoformat() if ev.cita_en else None, "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


class LigaIn(BaseModel):
    enviar: bool = True  # mandarla al responsable por correo/WhatsApp con lo que tenga
    regenerar: bool = False


@router.post("/{codigo}/liga")
async def liga_externa(codigo: str, datos: LigaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fraiche (spec §10): liga limitada para la persona externa (encargado de tienda, proveedor socioeconómico,
    médico, franquiciatario). Accede SOLO a esta evaluación. Un canal caído nunca rompe la acción."""
    from ..config import settings
    from ..services import plantillas_correo
    from ..services.correo import enviar_correo
    from ..services.whatsapp import enviar_mensaje

    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    if ev.es_medico:
        _exigir_consentimiento(ev, p)  # spec §10: consentimiento antes de enviar
    if not ev.token_externo or datos.regenerar:
        ev.token_externo = secrets.token_urlsafe(24)
    liga = f"{settings.app_url}/evaluacion/{ev.token_externo}"
    resultados = []
    if datos.enviar:
        empresa = nombre_empresa_candidato(p.vacante) if p and p.vacante else cuenta.nombre_visible
        texto = (f"Hola {ev.responsable or ''}. {empresa} te asignó «{ev.nombre}» de {p.nombre if p else 'un candidato'}"
                 f"{(' para ' + p.vacante.titulo) if p and p.vacante else ''}. Registra el resultado aquí: {liga}").replace("  ", " ")
        if ev.responsable_whatsapp:
            try:
                r = await enviar_mensaje(ev.responsable_whatsapp, texto)
            except Exception as ex:  # noqa: BLE001
                r = {"enviado": False, "detalle": str(ex)[:200]}
            resultados.append({"destinatario": "responsable", "canal": "whatsapp", "destino": ev.responsable_whatsapp, "enviado": bool(r.get("enviado")), "detalle": str(r.get("detalle") or "")})
        if ev.responsable_correo:
            try:
                asunto, html = plantillas_correo.html_aviso(f"Evaluación asignada: {ev.nombre}", texto.replace(liga, "").strip(), empresa,
                                                            [("Candidato", p.nombre if p else ""), ("Vacante", p.vacante.titulo if p and p.vacante else "")] + ([("Cita", ev.cita_en.isoformat())] if ev.cita_en else []),
                                                            ("Abrir evaluación", liga))
                r = await enviar_correo(ev.responsable_correo, asunto, html)
            except Exception as ex:  # noqa: BLE001
                r = {"enviado": False, "detalle": str(ex)[:200]}
            resultados.append({"destinatario": "responsable", "canal": "correo", "destino": ev.responsable_correo, "enviado": bool(r.get("enviado")), "detalle": str(r.get("detalle") or "")})
        if resultados:
            ev.liga_enviada_en = datetime.now(timezone.utc)
        sev.mover(ev, ev.estado, u.nombre, "Liga de acceso enviada" if resultados else "Liga de acceso generada")
    registrar(db, u.nombre, "evaluacion_liga_externa", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "envios": resultados, "correo_rh": u.correo})
    db.commit()
    return {"liga": liga, "resultados": resultados, "evaluacion": evaluacion_candidato_dict(ev, u)}


class ReferenciasConfigIn(BaseModel):
    referencias: List[dict] = []
    requeridas: Optional[int] = None


async def aplicar_referencias(db: Session, ev: EvaluacionCandidato, p: Optional[Postulacion], lista: List[dict], actor: str, validar: bool) -> dict:
    """Núcleo de RH, del responsable (validar=True) y del candidato (validar=False, solo datos). Al completar las
    requeridas validadas → «Resultado recibido» y aviso a RH; al capturar el candidato sus datos → aviso al responsable."""
    antes = sev.resumen_referencias(ev)
    datos_antes = sum(1 for r in ev.referencias or [] if (r.get("estado") or "") != "pendiente_datos")
    ev.referencias = sev.normalizar_referencias(lista, ev.referencias or [], validar=validar)
    for r in ev.referencias:
        r["capturada_por"] = r.get("capturada_por") or actor
    res = sev.resumen_referencias(ev)
    avisos_out: List[dict] = []
    if res["completas"] and ev.estado in ("pendiente", "en_proceso", "en_espera_consentimiento") and validar:
        validadas = [r for r in ev.referencias if r["estado"] == "validada"]
        ev.resultado_cargado_por, ev.resultado_cargado_en, ev.origen_resultado = actor, datetime.now(timezone.utc), "manual" if actor != (ev.responsable or "") else "liga_externa"
        ev.resultado_resumen = "; ".join(f"{r['empresa']} · {r['contesto_nombre'] or r['contacto_nombre']}: {sev.RESULTADOS_REFERENCIA[r['resultado']]}"
                                         + (f" (recontrataría: {r['recontrataria'].replace('_', ' ')})" if r.get("recontrataria") else "") for r in validadas)[:5000]
        sev.mover(ev, "resultado_recibido", actor, f"{len(validadas)} referencia(s) validada(s) de {res['requeridas']}")
        if p is not None and not antes["completas"]:
            avisos_out += await avisar_rh(db, ev, p, "Referencias laborales validadas",
                                          f"{actor} terminó de validar las referencias laborales de {p.nombre} ({res['texto']}). Revisa y registra la conclusión.")
    elif ev.estado == "pendiente" and any(r["estado"] != "pendiente_datos" for r in ev.referencias):
        sev.mover(ev, "en_proceso", actor, "Referencias en captura")
    if not validar and p is not None:
        datos_ahora = sum(1 for r in ev.referencias if r["estado"] != "pendiente_datos")
        if datos_ahora >= res["requeridas"] and datos_antes < res["requeridas"]:
            avisos_out += await _aviso_responsable(db, ev, p, "referencias_capturadas", motivo="El candidato ya capturó los datos de sus referencias.")
            from ..services import avisos as _av

            _av.registrar_envios(ev, avisos_out)
    return {"resumen": res, "envios": avisos_out}


@router.post("/{codigo}/referencias")
async def guardar_referencias(codigo: str, datos: ReferenciasConfigIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fraiche (2026-10-02, §10): referencias laborales estructuradas — datos de cada referencia y su validación
    (quién contestó, cargo, fecha, medio, puesto/periodo confirmados, desempeño, motivo de salida, ¿lo volverían a
    contratar?, observaciones y resultado). Capturar contactos no es validarlos; no contestar no es desfavorable."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    if ev.tipo != "referencias":
        raise HTTPException(409, "Solo una evaluación de Referencias lleva referencias laborales.")
    _abierta(ev)
    _exigir_consentimiento(ev, p)
    if datos.requeridas is not None:
        ev.referencias_requeridas = max(1, min(10, int(datos.requeridas)))
    r = await aplicar_referencias(db, ev, p, datos.referencias, u.nombre, validar=True)
    registrar(db, u.nombre, "evaluacion_referencias", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, **{k: r["resumen"][k] for k in ("total", "validadas", "requeridas")}, "correo_rh": u.correo})
    db.commit()
    return {**evaluacion_candidato_dict(ev, u), "envios": r["envios"]}


@router.get("/{codigo}/detalle-medico")
def detalle_medico(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fraiche (spec §10): el dictamen médico completo (cifrado en la base) solo para el rol autorizado; cada
    consulta queda en la bitácora con quién accedió."""
    ev = _evaluacion(db, codigo, cuenta.id)
    if not ev.es_medico:
        raise HTTPException(409, "Esta evaluación no es médica.")
    if not u.puede_ver_informe_medico():
        registrar(db, u.nombre, "informe_medico_acceso_denegado", "evaluaciones", ev.codigo, {"correo_rh": u.correo, "via": "detalle"})
        db.commit()
        raise HTTPException(403, "El dictamen médico completo solo lo ven usuarios con permiso; tú ves el estado y la conclusión.")
    registrar(db, u.nombre, "informe_medico_consultado", "evaluaciones", ev.codigo, {"correo_rh": u.correo, "via": "detalle"})
    db.commit()
    return {
        "id": ev.codigo, "decision": ev.decision_externa or None, "dictamenTexto": sev.texto_dictamen(ev),
        "resultadoResumen": sev.leer_texto(ev, "resultado_resumen"), "comentarioRevision": sev.leer_texto(ev, "comentario_revision"),
        "notas": sev.leer_texto(ev, "notas"), "adjuntos": [{**a, "ruta": None, "indice": i} for i, a in enumerate(ev.adjuntos or [])],
        "tieneInforme": bool(ev.archivo), "cifrado": bool(ev.cifrado), "revisadaPor": ev.revisada_por or "", "revisadaEn": ev.revisada_en.isoformat() if ev.revisada_en else None,
    }


@router.get("/{codigo}/adjuntos/{indice}")
def descargar_adjunto(codigo: str, indice: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    from ..services import archivos as fs

    ev = _evaluacion(db, codigo, cuenta.id)
    if ev.es_medico and not u.puede_ver_informe_medico():
        registrar(db, u.nombre, "informe_medico_acceso_denegado", "evaluaciones", ev.codigo, {"correo_rh": u.correo, "adjunto": indice})
        db.commit()
        raise HTTPException(403, "Los adjuntos médicos solo los ven usuarios con permiso.")
    adj = (ev.adjuntos or [])
    if indice < 0 or indice >= len(adj) or not fs.existe(adj[indice].get("ruta")):
        raise HTTPException(404, "Adjunto no disponible.")
    if ev.es_medico:
        registrar(db, u.nombre, "informe_medico_consultado", "evaluaciones", ev.codigo, {"correo_rh": u.correo, "adjunto": indice})
        db.commit()
    return FileResponse(adj[indice]["ruta"], media_type=adj[indice].get("mime") or "application/octet-stream", filename=adj[indice].get("nombre") or f"adjunto-{indice}")


def _exigir_consentimiento(ev: EvaluacionCandidato, p: Optional[Postulacion]) -> None:
    sev.refrescar_consentimiento(ev, p)
    falta = sev.falta_consentimiento(ev, p)
    if falta:
        raise HTTPException(409, f"En espera de consentimiento: {falta}")


def _abierta(ev: EvaluacionCandidato) -> None:
    from ..services.configuracion import ambiente_prueba

    if ambiente_prueba() and ev.estado == "revisada":
        return  # 2026-10-02: en el ambiente de prueba una evaluación revisada se puede repetir (el resultado previo queda en historial)
    if ev.estado in ("revisada", "fallida"):
        raise HTTPException(409, f"La evaluación ya está {'revisada' if ev.estado == 'revisada' else 'fallida/cancelada'}.")


class EnviarIn(BaseModel):
    correo: str = ""  # §8: correo del candidato si el proveedor lo exige y no estaba capturado


@router.post("/{codigo}/enviar")
async def enviar(codigo: str, datos: Optional[EnviarIn] = None, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Envía la evaluación. Psicometría (2026-10-02, §8): crea la evaluación real en el proveedor (si ya existe NO la
    duplica: solo reenvía) y manda al candidato el nombre de la prueba, instrucciones y SU liga; un fallo regresa
    502 con el motivo y se puede reintentar. Resto: Pendiente → En proceso con avisos a candidato y responsable."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    if datos and datos.correo.strip():
        _guardar_correo_candidato(p, datos.correo, u.nombre, db)
    _exigir_consentimiento(ev, p)
    if ev.tipo == "psicometrica":
        motivo = await _activar_psicometria(db, ev, p, u.nombre)
        if motivo:
            db.commit()  # el correo capturado se conserva aunque el proveedor falle
            raise HTTPException(409 if "correo" in motivo.lower() and "necesita" in motivo.lower() else 502, motivo)
        envios = await avisar_asignacion(db, ev, p, u.nombre, "evaluacion_enviada", "candidato")
        registrar(db, u.nombre, "evaluacion_enviada", "postulacion", p.codigo if p else "",
                  {"evaluacion": ev.codigo, "modo": ev.modo, "proveedor": ev.proveedor, "clave_proveedor": ev.clave_proveedor, "correo_rh": u.correo})
        db.commit()
        return {**evaluacion_candidato_dict(ev, u), "envios": envios}
    if ev.estado != "pendiente":
        raise HTTPException(409, "Solo se envía una evaluación pendiente.")
    from ..services import psicometricas as psi

    if sev.usa_psicometricas(ev) and psi.configurado():
        # 2026-09-29: envío REAL a Psicométricas.mx (agregaCandidato). Si falla, nada cambia (502 con el motivo).
        if not (p and p.correo):
            raise HTTPException(409, "Psicométricas.mx necesita el correo del candidato para mandarle su liga.")
        try:
            tests = psi.tests_de(ev.id_proveedor)
            clave = psi.agregar_candidato(p.nombre, p.correo, p.vacante.titulo if p.vacante else ev.nombre, tests)
        except psi.PsicometricasError as ex:
            raise HTTPException(400 if ex.status == 400 else 502, str(ex))
        ev.clave_proveedor = clave
        sev.aplicar_paso(ev, "enviada", u.nombre, "Psicométricas.mx")
    elif ev.modo == "integrada":
        sev.aplicar_paso(ev, "enviada", u.nombre)
    else:
        sev.mover(ev, "en_proceso", u.nombre, "Enviada" + (f" ({ev.url})" if ev.url else ""))
    envios = await avisar_asignacion(db, ev, p, u.nombre, "evaluacion_enviada")
    registrar(db, u.nombre, "evaluacion_enviada", "postulacion", p.codigo if p else "",
              {"evaluacion": ev.codigo, "modo": ev.modo, "proveedor": ev.proveedor, "clave_proveedor": ev.clave_proveedor, "correo_rh": u.correo})
    db.commit()
    return {**evaluacion_candidato_dict(ev, u), "envios": envios}


@router.post("/{codigo}/integracion/avanzar")
def avanzar_integrada(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Modo Integrada SIMULADO (hasta conectar proveedores): avanza un paso Asignada → Enviada → Iniciada →
    Completada → Resultado recibido. Cuando se conecte el proveedor, su webhook llamará a `sev.aplicar_paso`."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    if ev.modo != "integrada":
        raise HTTPException(409, "Solo las evaluaciones en modo Integrada avanzan por pasos.")
    if ev.clave_proveedor:
        raise HTTPException(409, "Esta evaluación está conectada a Psicométricas.mx: su avance llega del proveedor (usa «Consultar resultado»).")
    _abierta(ev)
    _exigir_consentimiento(ev, p)
    paso = sev.siguiente_paso(ev)
    if not paso:
        raise HTTPException(409, "La evaluación ya tiene su resultado; ahora se revisa.")
    sev.aplicar_paso(ev, paso, u.nombre)
    registrar(db, u.nombre, "evaluacion_paso_simulado", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "paso": paso, "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


@router.post("/{codigo}/sincronizar")
def sincronizar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Consultar resultado» en Psicométricas.mx (por si el webhook no llegó). Solo guarda si su API confirma que terminó."""
    from ..services import psicometricas as psi

    ev = _evaluacion(db, codigo, cuenta.id)
    if not ev.clave_proveedor:
        raise HTTPException(409, "Esta evaluación no está conectada a Psicométricas.mx.")
    try:
        r = sev.sincronizar_psicometricas(db, ev)
    except psi.PsicometricasError as ex:
        raise HTTPException(502, str(ex))
    registrar(db, u.nombre, "evaluacion_sincronizada", "evaluaciones", ev.codigo, {"resultado": r, "correo_rh": u.correo})
    db.commit()
    return {**evaluacion_candidato_dict(ev, u), "sincronizacion": r}


async def registrar_resultado(
    db: Session, ev: EvaluacionCandidato, p: Optional[Postulacion], *, actor: str, resumen: str = "", archivo: Optional[UploadFile] = None,
    decision: str = "", origen: str = "manual", evaluatest: Optional[dict] = None, comentarios: str = "",
) -> dict:
    """Núcleo compartido por RH (POST /{codigo}/resultado) y por la liga externa (spec §10): adjunta informe,
    resumen y decisión; un socioeconómico con PDF recibe la PROPUESTA de resumen de Red Human (sin puntuación);
    lo médico se guarda cifrado; una corrección conserva el resultado anterior en el historial. Regresa avisos."""
    from ..services import archivos as fs
    from ..services import ia

    avisos: List[str] = []
    if ev.resultado_cargado_en or ev.dictamen:
        sev.archivar_resultado_previo(ev, actor)
    if archivo is not None and archivo.filename:
        validado = await fs.validar(archivo, f"informe «{ev.nombre}»")
        n = len(ev.adjuntos or []) + 1
        ruta = fs.guardar(validado, f"evaluaciones/{ev.id}", f"informe_{ev.codigo}_{n}")
        ev.archivo, ev.nombre_archivo, ev.mime = ruta, validado.nombre, validado.mime
        sev.agregar_adjunto(ev, ruta, validado.nombre, validado.mime, actor)
        if ev.tipo == "socioeconomico" and validado.mime == "application/pdf":
            propuesta, _con_ia = ia.resumen_socioeconomico(ia.texto_de_pdf(validado.contenido))
            texto = propuesta.get("resumen") or ""
            if propuesta.get("hallazgos"):
                texto += "\nHallazgos: " + "; ".join(propuesta["hallazgos"])
            if propuesta.get("conclusion_documento"):
                texto += "\nConclusión del documento: " + propuesta["conclusion_documento"]
            sev.guardar_texto(ev, "resumen_ia", texto.strip())
            if propuesta.get("aviso"):
                avisos.append(propuesta["aviso"])
    if resumen.strip():
        sev.guardar_texto(ev, "resultado_resumen", resumen.strip())
    elif ev.tipo == "socioeconomico" and ev.resumen_ia and not ev.resultado_resumen:
        sev.guardar_texto(ev, "resultado_resumen", sev.leer_texto(ev, "resumen_ia"))  # propuesta editable por RH
    if comentarios.strip():
        sev.guardar_texto(ev, "comentario_revision", comentarios.strip())
    if evaluatest is not None and sev.es_evaluatest(ev):
        ev.resultado_json = {**(ev.resultado_json or {}), "evaluatest": sev.evaluatest_normalizado(evaluatest)}
        origen = "liga_proveedor_reporte_anonimizado"
    if ev.tipo == "referencias" and decision.strip().lower() == "favorable" and not sev.resumen_referencias(ev)["completas"]:
        raise HTTPException(409, f"Para cerrar como Favorable registra las referencias verificadas ({sev.resumen_referencias(ev)['texto']}).")
    if decision.strip():
        try:
            texto_dec = sev.aplicar_decision(ev, decision)
        except ValueError as ex:
            raise HTTPException(400, str(ex))
        avisos.append(f"Decisión registrada: {texto_dec}")
        if p is not None and sev.es_franquiciatario(ev) and ev.decision_externa in ("continuar", "no_continuar"):
            # Pipeline v2: la decisión del franquiciatario se refleja en la postulación; NO la cierra ni la mueve
            p.franquicia_estado = "aceptado" if ev.decision_externa == "continuar" else "no_aceptado"
            p.franquicia_decidido_en = datetime.now(timezone.utc)
    ev.origen_resultado = origen
    ev.resultado_cargado_por, ev.resultado_cargado_en = actor, datetime.now(timezone.utc)
    ev.realizada_en = ev.realizada_en or ev.resultado_cargado_en
    if ev.modo == "integrada":
        ev.paso_integrada = "resultado_recibido"
    sev.mover(ev, "resultado_recibido", actor, f"Resultado cargado ({origen})" + (" con informe" if ev.archivo else "") + (f" · {decision}" if decision else ""))
    return {"avisos": avisos}


@router.post("/{codigo}/resultado")
async def cargar_resultado(
    codigo: str, resumen: str = Form(""), archivo: Optional[UploadFile] = File(None), decision: str = Form(""),
    evaluatest: str = Form(""), comentarios: str = Form(""), tipo_adjunto: str = Form("resultado"),
    db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual),
):
    """Adjuntar el informe/resultado manualmente (quién y cuándo). Exige los consentimientos. Fraiche (spec §9-10):
    `decision` (Apto/Apto condicionado/No recomendable · Continuar/No continuar · Favorable/…) y `evaluatest`
    (JSON con indice_afinidad, igi, competencias, fortalezas, areas_oportunidad, riesgo — carga del reporte anonimizado)."""
    import json as _json

    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    _exigir_consentimiento(ev, p)
    if tipo_adjunto == "prueba_contestada":
        # 2026-10-04 (§5): adjuntar la prueba contestada NO es tener resultado — se guarda como adjunto y el estado no cambia
        from ..services import archivos as fs

        if not (archivo and archivo.filename):
            raise HTTPException(400, "Adjunta la prueba contestada (PDF o imagen).")
        validado = await fs.validar(archivo, f"archivo de la prueba contestada «{ev.nombre}»")
        n = len(ev.adjuntos or []) + 1
        ruta = fs.guardar(validado, f"evaluaciones/{ev.id}", f"contestada_{ev.codigo}_{n}")
        sev.agregar_adjunto(ev, ruta, validado.nombre, validado.mime, u.nombre)
        ev.adjuntos[-1]["tipo"] = "prueba_contestada"
        ev.adjuntos = list(ev.adjuntos)
        if comentarios.strip():
            sev.guardar_texto(ev, "comentario_revision", comentarios.strip())
        sev.mover(ev, ev.estado, u.nombre, "Prueba contestada adjunta (todavía sin resultado)")
        registrar(db, u.nombre, "evaluacion_prueba_contestada", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "archivo": validado.nombre, "correo_rh": u.correo})
        db.commit()
        return {**evaluacion_candidato_dict(ev, u), "avisos": ["Prueba contestada adjunta; la evaluación sigue sin resultado."]}
    if not archivo and not resumen.strip() and not evaluatest.strip() and not decision.strip():
        raise HTTPException(400, "Adjunta el informe o escribe el resultado.")
    if ev.es_medico and not u.puede_ver_informe_medico():
        raise HTTPException(403, "Cargar el informe médico requiere el permiso de informes médicos.")
    datos_eval = None
    if evaluatest.strip():
        try:
            datos_eval = _json.loads(evaluatest)
        except ValueError:
            raise HTTPException(400, "El reporte Evaluatest debe venir como JSON.")
    r = await registrar_resultado(db, ev, p, actor=u.nombre, resumen=resumen, archivo=archivo, decision=decision, origen="manual", evaluatest=datos_eval, comentarios=comentarios)
    registrar(db, u.nombre, "evaluacion_resultado_cargado", "postulacion", p.codigo if p else "",
              {"evaluacion": ev.codigo, "con_archivo": bool(ev.archivo), "decision": ev.decision_externa, "origen": ev.origen_resultado, "correo_rh": u.correo})
    db.commit()
    return {**evaluacion_candidato_dict(ev, u), "avisos": r["avisos"]}


class RevisarIn(BaseModel):
    dictamen: str
    comentario: str = ""


@router.post("/{codigo}/revisar")
def revisar(codigo: str, datos: RevisarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """RH marca «Revisada» y elige el dictamen: Favorable / Con observaciones / Desfavorable; en el estudio médico
    transcribe Apto / Apto con restricciones / No apto. Siempre una persona (HITL)."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    if ev.estado != "resultado_recibido":
        raise HTTPException(409, "Se revisa cuando ya hay resultado recibido.")
    if ev.es_medico and not u.puede_ver_informe_medico():
        raise HTTPException(403, "Transcribir el dictamen médico requiere el permiso de informes médicos.")
    if ev.tipo == "referencias" and datos.dictamen.strip().lower() == "favorable" and not sev.resumen_referencias(ev)["completas"]:
        res = sev.resumen_referencias(ev)
        raise HTTPException(409, f"Para cerrar como Favorable registra las referencias verificadas ({res['texto']}).")
    # Fraiche (spec §10): médico → Apto / Apto condicionado / No recomendable (se guarda como Favorable / Con
    # observaciones / Desfavorable); franquiciatario → Continuar / No continuar; resto → conclusión general.
    try:
        texto_dictamen = sev.aplicar_decision(ev, datos.dictamen)
    except ValueError as ex:
        opciones = sev.dictamenes_visibles(ev)
        raise HTTPException(400, f"Dictamen inválido para {ev.nombre}: usa {', '.join(opciones.values())}. ({ex})")
    sev.guardar_texto(ev, "comentario_revision", datos.comentario.strip()[:2000])
    ev.revisada_por, ev.revisada_en = u.nombre, datetime.now(timezone.utc)
    sev.mover(ev, "revisada", u.nombre, f"Dictamen: {texto_dictamen}")
    registrar(db, u.nombre, "evaluacion_revisada", "postulacion", p.codigo if p else "",
              {"evaluacion": ev.codigo, "tipo": ev.tipo, "dictamen": datos.dictamen, "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


class CancelarIn(BaseModel):
    motivo: str = ""
    no_realizada: bool = False  # Fraiche (spec §10): «No realizada» (la persona no se presentó) vs «Cancelada»


@router.post("/{codigo}/cancelar")
def cancelar(codigo: str, datos: CancelarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fallida/Cancelada: siempre con motivo. Fraiche: `no_realizada=true` la marca «No realizada»."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    motivo = datos.motivo.strip()
    if not motivo:
        raise HTTPException(400, "Indica el motivo (fallida o cancelada).")
    ev.motivo_fallida = motivo[:1000]
    ev.no_realizada = bool(datos.no_realizada)
    sev.mover(ev, "fallida", u.nombre, ("No realizada: " if datos.no_realizada else "Cancelada: ") + motivo)
    registrar(db, u.nombre, "evaluacion_fallida", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "motivo": motivo[:300], "no_realizada": ev.no_realizada, "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


class RealizadaIn(BaseModel):
    nota: str = ""


@router.post("/{codigo}/realizada")
def marcar_realizada(codigo: str, datos: RealizadaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fraiche (spec §10): «Realizada con resultado pendiente» — ya ocurrió (entrevista, estudio, consulta) y falta el resultado."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    _exigir_consentimiento(ev, p)
    if ev.estado == "resultado_recibido":
        raise HTTPException(409, "Esta evaluación ya tiene resultado.")
    ev.realizada_en = datetime.now(timezone.utc)
    sev.mover(ev, "en_proceso", u.nombre, "Realizada, resultado pendiente" + (f": {datos.nota.strip()[:300]}" if datos.nota.strip() else ""))
    registrar(db, u.nombre, "evaluacion_realizada", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


@router.get("/{codigo}/informe")
def descargar_informe(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    from ..services import archivos as fs

    ev = _evaluacion(db, codigo, cuenta.id)
    if ev.es_medico and not u.puede_ver_informe_medico():
        registrar(db, u.nombre, "informe_medico_acceso_denegado", "evaluaciones", ev.codigo, {"correo_rh": u.correo})
        db.commit()
        raise HTTPException(403, "El informe médico completo solo lo ven usuarios con permiso; tú ves el estado y el dictamen.")
    if not fs.existe(ev.archivo):
        raise HTTPException(404, "Esta evaluación no tiene informe adjunto.")
    if ev.es_medico:
        registrar(db, u.nombre, "informe_medico_consultado", "evaluaciones", ev.codigo, {"correo_rh": u.correo})
        db.commit()
    return FileResponse(ev.archivo, media_type=ev.mime or "application/octet-stream", filename=ev.nombre_archivo or f"informe-{ev.codigo}")


@router.post("/{codigo}/consentimiento/enviar")
async def enviar_liga_consentimiento(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Manda al candidato la liga del consentimiento expreso (WhatsApp y correo con lo que tenga). Un canal caído
    nunca rompe la acción: el resultado de cada envío regresa a RH."""
    from ..config import settings
    from ..services import plantillas_correo
    from ..services.correo import enviar_correo
    from ..services.whatsapp import enviar_mensaje

    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    if not ev.requiere_consentimiento_expreso or not ev.consentimiento_token:
        raise HTTPException(409, "Esta evaluación no requiere consentimiento expreso.")
    if ev.consentimiento_aceptado_en:
        raise HTTPException(409, "El candidato ya otorgó su consentimiento.")
    liga = f"{settings.app_url}/consentimiento/{ev.consentimiento_token}"
    nombre = p.nombre if p else ""
    empresa = nombre_empresa_candidato(p.vacante) if p and p.vacante else cuenta.nombre_visible
    texto = (f"Hola {nombre}. Para continuar con tu proceso en {empresa} necesitamos tu consentimiento por escrito para el estudio "
             f"médico. Léelo y, si estás de acuerdo, acéptalo aquí: {liga}")
    resultados = []
    if p and p.telefono:
        try:
            r = await enviar_mensaje(p.telefono, texto)
        except Exception as ex:  # noqa: BLE001
            r = {"enviado": False, "detalle": str(ex)[:200]}
        resultados.append({"destinatario": "candidato", "canal": "whatsapp", "destino": p.telefono, "enviado": bool(r.get("enviado")), "detalle": str(r.get("detalle") or "")})
    if p and p.correo:
        try:
            asunto, html = plantillas_correo.html_aviso("Consentimiento para tu estudio médico", texto.replace(liga, "").strip(), empresa, [], ("Leer y aceptar", liga))
            r = await enviar_correo(p.correo, asunto, html)
        except Exception as ex:  # noqa: BLE001
            r = {"enviado": False, "detalle": str(ex)[:200]}
        resultados.append({"destinatario": "candidato", "canal": "correo", "destino": p.correo, "enviado": bool(r.get("enviado")), "detalle": str(r.get("detalle") or "")})
    registrar(db, u.nombre, "consentimiento_medico_solicitado", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "envios": resultados, "correo_rh": u.correo})
    db.commit()
    return {"liga": liga, "resultados": resultados}


# ---------------- Pública: consentimiento expreso del estudio médico ----------------

def _por_token(db: Session, token: str) -> EvaluacionCandidato:
    ev = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.consentimiento_token == token).first() if token else None
    if not ev:
        raise HTTPException(404, "Esta liga no es válida.")
    return ev


def _texto_consentimiento(db: Session, ev: EvaluacionCandidato) -> str:
    p = _post_de(db, ev)
    empresa = nombre_empresa_candidato(p.vacante) if p and p.vacante else "la empresa"
    return TEXTO_CONSENTIMIENTO_MEDICO.format(nombre=(p.nombre if p else "la persona candidata"), empresa=empresa, puesto=(p.vacante.titulo if p and p.vacante else "el puesto"))


@router.get("/publica/consentimiento/{token}")
def ver_consentimiento(token: str, db: Session = Depends(get_db)):
    ev = _por_token(db, token)
    p = _post_de(db, ev)
    return {
        "candidato": p.nombre if p else "",
        "empresa": nombre_empresa_candidato(p.vacante) if p and p.vacante else "",
        "puesto": p.vacante.titulo if p and p.vacante else "",
        "evaluacion": ev.nombre,
        "texto": ev.consentimiento_texto or _texto_consentimiento(db, ev),
        "aceptado": bool(ev.consentimiento_aceptado_en),
        "aceptadoEn": ev.consentimiento_aceptado_en.isoformat() if ev.consentimiento_aceptado_en else None,
        "cancelada": ev.estado == "fallida",
    }


class AceptarConsentimientoIn(BaseModel):
    nombre: str
    acepto: bool = False


@router.post("/publica/consentimiento/{token}/aceptar")
async def aceptar_consentimiento(token: str, datos: AceptarConsentimientoIn, request: Request, db: Session = Depends(get_db)):
    """Consentimiento EXPRESO y POR ESCRITO por medio electrónico: la persona escribe su nombre completo como firma y
    marca «Acepto». Se guarda el texto exacto, la aceptación y la evidencia (nombre, IP, navegador, huella SHA-256) y
    queda en la bitácora hash-encadenada. Nunca se acepta en nombre de la persona."""
    ev = _por_token(db, token)
    if ev.estado == "fallida":
        raise HTTPException(409, "Esta evaluación fue cancelada.")
    if ev.consentimiento_aceptado_en:
        raise HTTPException(409, "Ya habías otorgado tu consentimiento. Gracias.")
    firma = " ".join((datos.nombre or "").split())
    if not datos.acepto:
        raise HTTPException(400, "Para otorgar tu consentimiento marca «Acepto».")
    if len(firma) < 5:
        raise HTTPException(400, "Escribe tu nombre completo como firma.")
    ahora = datetime.now(timezone.utc)
    texto = _texto_consentimiento(db, ev)
    huella = hashlib.sha256(f"{texto}|{firma}|{ahora.isoformat()}|{ev.codigo}".encode("utf-8")).hexdigest()
    ev.consentimiento_texto = texto
    ev.consentimiento_aceptado_en = ahora
    ev.consentimiento_evidencia = {
        "nombre_escrito": firma[:200],
        "ip": (request.client.host if request.client else "")[:64],
        "navegador": (request.headers.get("user-agent") or "")[:300],
        "medio": "electronico",
        "huella_sha256": huella,
    }
    p = _post_de(db, ev)
    sev.refrescar_consentimiento(ev, p, "candidato")
    registrar(db, "candidato", "consentimiento_medico_otorgado", "postulacion", p.codigo if p else "",
              {"evaluacion": ev.codigo, "huella_sha256": huella, "nombre_escrito": firma[:200]})
    db.flush()
    # 2026-10-02 (§9): con el consentimiento se habilita el registro y se avisa al médico con SU liga
    if p is not None:
        try:
            from ..services import avisos

            envios = await _aviso_responsable(db, ev, p, "consentimiento_otorgado")
            for e in envios:
                e["por"] = "sistema"
            avisos.registrar_envios(ev, envios)
        except Exception as ex:  # noqa: BLE001
            print(f"[evaluaciones] no se pudo avisar al médico de {ev.codigo}: {ex}", flush=True)
    db.commit()
    return {"ok": True, "aceptadoEn": ahora.isoformat(), "estado": ev.estado}
