"""Módulo 2 · Contratación e integración (3.11) — expedientes, documentos, recordatorios y alta HITL.

El expediente nace desde el Módulo 1 (`/candidatos/{codigo}/seleccionar`). Aquí el
agente recibe los documentos, los valida con IA y da seguimiento; el alta la
autoriza siempre una persona de RH.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import Colaborador, Documento, Expediente, Mensaje, Usuario, registrar
from ..serial import colaborador_dict, expediente_dict
from ..services import archivos as fs
from ..services import ia
from ..services.whatsapp import enviar_mensaje

router = APIRouter(prefix="/contratacion", tags=["contratacion"])

ESTADOS_DOC = ("recibido", "rechazado", "revision", "pendiente")


def _expediente(db: Session, exp_id: int) -> Expediente:
    e = db.get(Expediente, exp_id)
    if not e:
        raise HTTPException(404, "Expediente no encontrado")
    return e


def _documento(e: Expediente, tipo: str) -> Documento:
    doc = next((d for d in e.documentos if d.tipo.lower() == tipo.strip().lower()), None)
    if not doc:
        raise HTTPException(404, f"El expediente no requiere el documento '{tipo}'")
    return doc


def _sincronizar_estado(e: Expediente) -> None:
    """El expediente pasa a 'completo' solo cuando no falta ningún obligatorio."""
    if e.estado != "alta":
        e.estado = "completo" if e.progreso == 100 else "integracion"


@router.get("/expedientes")
def listar(estado: Optional[str] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    q = db.query(Expediente).order_by(Expediente.id)
    if estado:
        q = q.filter(Expediente.estado == estado)
    return [expediente_dict(e) for e in q.all()]


@router.get("/metricas")
def metricas(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """Resumen del módulo 2 para el tablero — cierra el ciclo con el módulo 1."""
    todos = db.query(Expediente).all()
    docs_pendientes = sum(len(e.pendientes) for e in todos)
    por_revisar = sum(len(e.por_revisar) for e in todos)
    completos = [e for e in todos if e.progreso == 100]
    return {
        "expedientes": len(todos),
        "en_integracion": sum(1 for e in todos if e.estado == "integracion"),
        "completos": len(completos),
        "altas": sum(1 for e in todos if e.estado == "alta"),
        "documentos_pendientes": docs_pendientes,
        "documentos_por_revisar": por_revisar,
        "progreso_promedio": round(sum(e.progreso for e in todos) / len(todos)) if todos else 0,
        "listos_para_alta": [
            {"expedienteId": e.id, "nombre": e.candidato.nombre if e.candidato else "", "puesto": e.puesto}
            for e in completos
            if e.estado != "alta"
        ],
    }


@router.get("/expedientes/{exp_id}")
def detalle(exp_id: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return expediente_dict(_expediente(db, exp_id))


# ------------------------------------------------------------
# Documentos: subir → validar con IA → estado (revisión humana si hay duda)
# ------------------------------------------------------------


def _resolver_estado(v: ia.DocumentoValidado, con_ia: bool) -> tuple[str, str]:
    """Traduce la validación de la IA a un estado y un motivo legible para RH."""
    if not con_ia:
        return "revision", "Modo demo: se requiere revisión humana."
    if not v.coincide_tipo:
        return "rechazado", f"El archivo parece ser {v.tipo_detectado}, no el documento solicitado."
    if not v.legible:
        return "rechazado", v.motivo_rechazo or "El documento no se lee con claridad."
    if not v.completo:
        return "rechazado", v.motivo_rechazo or "Falta parte del documento (por ejemplo, el reverso)."
    if v.vigente is False:
        return "rechazado", v.motivo_rechazo or "El documento está vencido."
    if v.coincide_titular is False:
        return "revision", "El nombre del documento no coincide con el del candidato: verifícalo."
    return "recibido", v.observaciones


@router.post("/expedientes/{exp_id}/documentos")
async def subir_documento(
    exp_id: int,
    tipo: str = Form(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
):
    e = _expediente(db, exp_id)
    if e.estado == "alta":
        raise HTTPException(409, "El expediente ya fue dado de alta; no admite cambios.")
    doc = _documento(e, tipo)

    validado = await fs.validar(archivo, f"documento «{doc.tipo}»")
    titular = e.candidato.nombre if e.candidato else ""
    v, con_ia = ia.validar_documento(validado.b64, validado.extension, doc.tipo, titular)

    doc.archivo = fs.guardar(validado, f"expedientes/{e.id}", doc.tipo.replace(" ", "_"))
    doc.nombre_archivo = validado.nombre
    doc.mime = validado.mime
    doc.tamano = validado.tamano
    doc.subido_en = datetime.now(timezone.utc)
    doc.validacion = v.model_dump()
    doc.estado, doc.notas_ia = _resolver_estado(v, con_ia)
    doc.revisado_por = ""  # vuelve a quedar pendiente de revisión humana

    _sincronizar_estado(e)
    registrar(
        db, "agente-ia", "documento_validado", "documento", f"{e.id}:{doc.tipo}",
        {"ia": con_ia, "estado": doc.estado, "tipo_detectado": v.tipo_detectado, "subido_por": u.nombre},
    )
    db.commit()
    return {
        "ia": con_ia,
        "documento": {"tipo": doc.tipo, "estado": doc.estado, "notas": doc.notas_ia},
        "expediente": expediente_dict(e),
    }


@router.get("/expedientes/{exp_id}/documentos/{tipo}/archivo")
def descargar_documento(exp_id: int, tipo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    e = _expediente(db, exp_id)
    doc = _documento(e, tipo)
    if not fs.existe(doc.archivo):
        raise HTTPException(404, "Todavía no se ha subido este documento.")
    return FileResponse(doc.archivo, media_type=doc.mime or "application/octet-stream", filename=doc.nombre_archivo or doc.tipo)


class EstadoDocIn(BaseModel):
    tipo: str
    estado: str  # recibido | rechazado | revision | pendiente
    notas: str = ""
    # el documento se entregó en físico o fuera del sistema: RH lo da por recibido bajo su responsabilidad
    recibido_fisico: bool = False


@router.post("/expedientes/{exp_id}/documentos/estado")
def marcar_documento(exp_id: int, datos: EstadoDocIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Revisión humana manual de un documento (el agente propone, RH dispone)."""
    e = _expediente(db, exp_id)
    doc = _documento(e, datos.tipo)
    if datos.estado not in ESTADOS_DOC:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS_DOC)}")
    # confirmar uno ya recibido es válido; darlo por recibido de la nada exige archivo o entrega física declarada
    if datos.estado == "recibido" and not doc.archivo and doc.estado != "recibido" and not datos.recibido_fisico:
        raise HTTPException(
            409,
            "Ese documento no tiene archivo cargado. Súbelo, o marca «recibido en físico» para dejar "
            "constancia de que lo recibiste fuera del sistema.",
        )

    anterior = doc.estado
    doc.estado = datos.estado
    doc.revisado_por = u.nombre
    if datos.notas:
        doc.notas_ia = datos.notas

    _sincronizar_estado(e)
    registrar(
        db, u.nombre, "documento_revisado", "documento", f"{e.id}:{doc.tipo}",
        {"de": anterior, "a": datos.estado, "notas": datos.notas[:300], "sin_archivo": not doc.archivo},
    )
    db.commit()
    return expediente_dict(e)


class AgregarDocIn(BaseModel):
    tipo: str
    obligatorio: bool = True


@router.post("/expedientes/{exp_id}/documentos/agregar", status_code=201)
def agregar_documento(exp_id: int, datos: AgregarDocIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Suma un documento al checklist (título profesional, licencia, carta de no antecedentes…)."""
    e = _expediente(db, exp_id)
    tipo = datos.tipo.strip()
    if not tipo:
        raise HTTPException(400, "Indica el nombre del documento.")
    if any(d.tipo.lower() == tipo.lower() for d in e.documentos):
        raise HTTPException(409, f"El expediente ya incluye '{tipo}'.")

    db.add(Documento(expediente_id=e.id, tipo=tipo, obligatorio=datos.obligatorio))
    _sincronizar_estado(e)
    registrar(db, u.nombre, "documento_agregado", "expediente", str(e.id), {"tipo": tipo, "obligatorio": datos.obligatorio})
    db.commit()
    db.refresh(e)
    return expediente_dict(e)


@router.delete("/expedientes/{exp_id}/documentos/{tipo}")
def quitar_documento(exp_id: int, tipo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    e = _expediente(db, exp_id)
    doc = _documento(e, tipo)
    if doc.estado == "recibido":
        raise HTTPException(409, "No se puede quitar un documento ya recibido; márcalo como no obligatorio.")
    e.documentos.remove(doc)
    _sincronizar_estado(e)
    registrar(db, u.nombre, "documento_quitado", "expediente", str(e.id), {"tipo": doc.tipo})
    db.commit()
    return expediente_dict(e)


# ------------------------------------------------------------
# Recordatorios (el agente da seguimiento a pendientes)
# ------------------------------------------------------------


@router.post("/expedientes/{exp_id}/recordatorio")
async def recordatorio(exp_id: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_decisor)):
    e = _expediente(db, exp_id)
    pendientes = e.pendientes
    if not pendientes:
        return {"enviado": False, "detalle": "Sin documentos pendientes 🎉", "expediente": expediente_dict(e)}

    c = e.candidato
    rechazados = [d for d in e.documentos if d.estado == "rechazado"]
    detalle_rechazos = "".join(f"\n• {d.tipo}: {d.notas_ia}" for d in rechazados if d.notas_ia)
    texto = (
        f"Hola {c.nombre.split(' ')[0]} 👋 Para completar tu expediente de {e.puesto or 'tu nuevo puesto'} "
        f"me falta recibir: {', '.join(pendientes)}."
        + (f"\n\nAlgunos necesitan volver a enviarse:{detalle_rechazos}" if detalle_rechazos else "")
        + "\n\nMándalos por aquí cuando puedas. 🙌"
    )
    envio = {"enviado": False, "proveedor": "demo"}
    if c.telefono:
        envio = await enviar_mensaje(c.telefono, texto)
        db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=texto, canal="whatsapp", enviado=envio["enviado"]))
    registrar(db, "agente-ia", "recordatorio_enviado", "expediente", str(e.id), {"pendientes": pendientes, "whatsapp": envio})
    db.commit()
    return {"enviado": True, "pendientes": pendientes, "whatsapp": envio, "expediente": expediente_dict(e)}


# ------------------------------------------------------------
# Alta del colaborador (HITL obligatorio — RH autoriza) — «Dar de alta como colaborador»
# ------------------------------------------------------------


def _crear_colaborador(db: Session, e: Expediente, u: Usuario) -> Optional[Colaborador]:
    """Cierra el ciclo del candidato: crea el registro en `colaboradores` heredando nombre,
    puesto, CV y salario. No toca `Empleado` (universo aparte del Radar Interno, módulo 4)."""
    c = e.candidato
    if not c:
        return None

    cv = next((a for a in reversed(c.archivos) if a.tipo == "cv"), None)
    col = Colaborador(
        codigo="TMP",
        nombre=c.nombre,
        correo=c.correo,
        telefono=c.telefono,
        puesto=e.puesto or (c.vacante.titulo if c.vacante else ""),
        salario=c.vacante.sueldo if c.vacante else "",
        cv_ruta=cv.ruta if cv else "",
        cv_nombre=cv.nombre if cv else "",
        fecha_ingreso=e.fecha_ingreso,
        dado_de_alta_por=u.nombre,
        candidato_origen_id=c.id,
        expediente_id=e.id,
    )
    db.add(col)
    db.flush()
    col.codigo = f"COL-{100 + col.id}"
    registrar(
        db, u.nombre, "colaborador_alta", "colaborador", col.codigo,
        {"candidato_origen": c.codigo, "puesto": col.puesto, "expediente": e.id},
    )
    return col


class AltaIn(BaseModel):
    fecha_ingreso: Optional[str] = None
    avisar_whatsapp: bool = True


@router.post("/expedientes/{exp_id}/alta")
async def alta(exp_id: int, datos: AltaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    e = _expediente(db, exp_id)
    if e.estado == "alta":
        raise HTTPException(409, f"El expediente ya fue dado de alta por {e.alta_autorizada_por}.")
    if e.progreso < 100:
        raise HTTPException(409, f"El expediente está al {e.progreso}%. Faltan: {', '.join(e.pendientes)}.")
    sin_revisar = [d.tipo for d in e.obligatorios if d.estado == "recibido" and not d.revisado_por]
    if sin_revisar:
        raise HTTPException(
            409,
            "Antes del alta, una persona de RH debe confirmar los documentos validados por la IA: "
            + ", ".join(sin_revisar),
        )

    if datos.fecha_ingreso:
        try:
            e.fecha_ingreso = datetime.fromisoformat(datos.fecha_ingreso).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "fecha_ingreso inválida (usa ISO: 2026-08-15)")

    e.estado = "alta"
    e.alta_autorizada_por = u.nombre
    e.alta_fecha = datetime.now(timezone.utc)
    registrar(
        db, u.nombre, "alta_autorizada", "expediente", str(e.id),
        {"candidato": e.candidato.codigo if e.candidato else "", "puesto": e.puesto, "correo_rh": u.correo},
    )

    colaborador = _crear_colaborador(db, e, u)

    c = e.candidato
    envio = {"enviado": False, "proveedor": "demo"}
    if datos.avisar_whatsapp and c and c.telefono:
        ingreso = f" Te esperamos el {e.fecha_ingreso.day}." if e.fecha_ingreso else ""
        texto = (
            f"¡Bienvenido(a) {c.nombre.split(' ')[0]}! 🎊 Tu expediente quedó completo y tu alta fue autorizada."
            f"{ingreso} En los próximos días te comparto tu plan de inducción."
        )
        envio = await enviar_mensaje(c.telefono, texto)
        db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=texto, canal="whatsapp", enviado=envio["enviado"]))

    db.commit()
    return {
        "ok": True,
        "whatsapp": envio,
        "expediente": expediente_dict(e),
        "colaborador": colaborador_dict(colaborador) if colaborador else None,
    }


class CancelarIn(BaseModel):
    motivo: str


@router.post("/expedientes/{exp_id}/cancelar")
def cancelar(exp_id: int, datos: CancelarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Cierra un expediente que no llegó a alta y regresa al candidato a Evaluación."""
    e = _expediente(db, exp_id)
    if not datos.motivo.strip():
        raise HTTPException(400, "La cancelación requiere un motivo.")
    if e.estado == "alta":
        raise HTTPException(409, "No se puede cancelar un expediente ya dado de alta.")

    c = e.candidato
    codigo = c.codigo if c else ""
    if c:
        c.etapa = "Evaluación"
    registrar(db, u.nombre, "expediente_cancelado", "expediente", str(e.id), {"motivo": datos.motivo, "candidato": codigo})
    db.delete(e)
    db.commit()
    return {"ok": True, "candidato": codigo}
