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


def _validar_prueba(db: Session, cuenta_id: int, pr: PruebaPsicometrica) -> None:
    pr.clave = (pr.clave or "").strip()[:60]
    pr.nombre = (pr.nombre or "").strip()[:200]
    if not pr.clave:
        raise HTTPException(400, "Captura el identificador interno de la prueba.")
    if not pr.nombre:
        raise HTTPException(400, "Captura el nombre visible de la prueba.")
    if pr.modo not in MODOS_PRUEBA:
        raise HTTPException(400, "Modo inválido: usa integrada, enlace o manual.")
    if pr.modo == "enlace" and not (pr.url or "").strip().lower().startswith(("http://", "https://")):
        raise HTTPException(400, "El modo «Enlace externo» necesita la liga de la prueba (https://…).")
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
def agregar_evaluacion(codigo: str, datos: AgregarEvaluacionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Agregar evaluación o verificación» desde la ficha. NO toca la etapa de la postulación. Comprueba los
    consentimientos: si falta alguno queda «En espera de consentimiento» (y no se puede enviar)."""
    p = _postulacion(db, codigo, cuenta.id)
    if not p.activa:
        raise HTTPException(409, "La postulación está cerrada.")
    if datos.tipo not in TIPOS_EVALUACION:
        raise HTTPException(400, f"Tipo inválido. Usa uno de: {', '.join(TIPOS_EVALUACION)}.")
    from ..services import fraiche_pipeline as fp

    if fp.es_franquicia(p) and fp.es_ruta_fraiche(p) and datos.tipo in fp.TIPOS_SOLO_TIENDA:
        raise HTTPException(409, f"«{TIPOS_EVALUACION[datos.tipo]}» no aplica a la ruta Franquicia (sin IPV, psicometría, médico ni socioeconómico de Fraiche).")
    nombre, modo, proveedor, id_prov, url = datos.nombre.strip(), datos.modo.strip(), datos.proveedor.strip(), datos.id_proveedor.strip(), datos.url.strip()
    prueba = None
    if datos.tipo == "psicometrica":
        if not datos.prueba_id:
            raise HTTPException(400, "Elige la prueba psicométrica del catálogo (Configuración → Pruebas psicométricas).")
        prueba = _prueba(db, datos.prueba_id, cuenta.id)
        if not prueba.activa:
            raise HTTPException(409, "Esa prueba psicométrica está inactiva.")
        nombre = nombre or prueba.nombre
        modo = modo or prueba.modo
        proveedor, id_prov, url = proveedor or prueba.proveedor, id_prov or prueba.id_proveedor, url or prueba.url
    nombre = (nombre or TIPOS_EVALUACION[datos.tipo])[:200]
    modo = modo or "manual"
    if modo not in MODOS_PRUEBA:
        raise HTTPException(400, "Modo inválido: usa integrada, enlace o manual.")
    if modo == "enlace" and not url.lower().startswith(("http://", "https://")):
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
    if datos.generar_liga or sev.es_franquiciatario(ev) or sev.es_encargado(ev):
        ev.token_externo = secrets.token_urlsafe(24)
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
    db.commit()
    return evaluacion_candidato_dict(ev, u)


class EditarEvaluacionIn(BaseModel):
    responsable: Optional[ResponsableIn] = None
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


class ReferenciasIn(BaseModel):
    referencias: List[dict] = []


@router.post("/{codigo}/referencias")
def guardar_referencias(codigo: str, datos: ReferenciasIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Fraiche (spec §10): referencias laborales — contactos, fecha de verificación, resultado, comentarios y
    responsable. Con al menos una referencia verificada la evaluación queda «Con resultado» (RH la revisa después)."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    if ev.tipo != "referencias":
        raise HTTPException(409, "Solo una evaluación de Referencias lleva referencias laborales.")
    _abierta(ev)
    _exigir_consentimiento(ev, p)
    ev.referencias = sev.normalizar_referencias(datos.referencias)
    verificadas = [r for r in ev.referencias if r.get("fecha_verificacion") and r.get("resultado")]
    if verificadas and ev.estado in ("pendiente", "en_proceso"):
        ev.resultado_cargado_por, ev.resultado_cargado_en, ev.origen_resultado = u.nombre, datetime.now(timezone.utc), "manual"
        ev.resultado_resumen = "; ".join(f"{r['contacto']} ({r.get('empresa') or 's/e'}): {r['resultado']}" for r in verificadas)[:5000]
        sev.mover(ev, "resultado_recibido", u.nombre, f"{len(verificadas)} referencia(s) verificada(s)")
    registrar(db, u.nombre, "evaluacion_referencias", "postulacion", p.codigo if p else "", {"evaluacion": ev.codigo, "referencias": len(ev.referencias), "verificadas": len(verificadas), "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


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
    if ev.estado in ("revisada", "fallida"):
        raise HTTPException(409, f"La evaluación ya está {'revisada' if ev.estado == 'revisada' else 'fallida/cancelada'}.")


@router.post("/{codigo}/enviar")
def enviar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Envía/asigna la evaluación: Pendiente → En proceso (en modo Integrada: Asignada → Enviada). Bloqueado sin
    consentimiento. Todavía sin conexión al proveedor: solo registra el envío."""
    ev = _evaluacion(db, codigo, cuenta.id)
    p = _post_de(db, ev)
    _abierta(ev)
    _exigir_consentimiento(ev, p)
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
    registrar(db, u.nombre, "evaluacion_enviada", "postulacion", p.codigo if p else "",
              {"evaluacion": ev.codigo, "modo": ev.modo, "proveedor": ev.proveedor, "clave_proveedor": ev.clave_proveedor, "correo_rh": u.correo})
    db.commit()
    return evaluacion_candidato_dict(ev, u)


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
    evaluatest: str = Form(""), comentarios: str = Form(""),
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
def aceptar_consentimiento(token: str, datos: AceptarConsentimientoIn, request: Request, db: Session = Depends(get_db)):
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
    db.commit()
    return {"ok": True, "aceptadoEn": ahora.isoformat(), "estado": ev.estado}
