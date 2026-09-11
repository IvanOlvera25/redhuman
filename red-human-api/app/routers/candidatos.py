"""Módulo 1 · Reclutamiento — Candidatos: ingesta, CV, prefiltro y decisión HITL (3.6–3.9).

La salida del pipeline es el enlace con el Módulo 2: `/candidatos/{codigo}/seleccionar`
crea el expediente de contratación y arranca la solicitud de documentos.
"""

import base64
import json
import re
import secrets
import unicodedata
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_admin, usuario_decisor
from ..models import (
    DOCUMENTOS_BASE,
    ETAPAS_CANDIDATO,
    Archivo,
    Candidato,
    Cuenta,
    Documento,
    Entrevista,
    EntrevistaHumana,
    Expediente,
    Mensaje,
    Usuario,
    Vacante,
    registrar,
)
from ..serial import archivo_dict, candidato_dict, expediente_dict, nombre_empresa_candidato
from ..services import archivos as fs
from ..services import ia
from ..services import notificaciones
from ..services.configuracion import modo_prueba_activo, puede_forzar_prueba
from ..services.correo import enviar_correo
from ..services.notificaciones import RE_CORREO, TZ_MEXICO
from ..services.whatsapp import enviar_mensaje, enviar_plantilla

router = APIRouter(prefix="/candidatos", tags=["candidatos"])

# Plantilla aprobada en Meta para romper el hielo tras una postulación web (fuera de la ventana
# de 24h: el candidato no nos ha escrito todavía, así que solo una plantilla aprobada pasa).
PLANTILLA_INICIO_ENTREVISTA = "inicio_entrevista_rh"

TIPOS_ARCHIVO = ["cv", "carta", "certificado", "identificacion", "otro"]


def _por_codigo(db: Session, codigo: str, cuenta_id: int) -> Candidato:
    c = db.query(Candidato).filter(Candidato.codigo == codigo, Candidato.cuenta_id == cuenta_id).first()
    if not c:
        raise HTTPException(404, "Candidato no encontrado")
    return c


def _vacante(db: Session, codigo: Optional[str], cuenta_id: int) -> Optional[Vacante]:
    if not codigo:
        return None
    v = db.query(Vacante).filter(Vacante.codigo == codigo, Vacante.cuenta_id == cuenta_id).first()
    if not v:
        raise HTTPException(404, f"Vacante '{codigo}' no encontrada")
    return v


def _telefono(valor: Optional[str]) -> str:
    """Normaliza a dígitos para que el dedup por teléfono sea confiable."""
    digitos = re.sub(r"\D", "", valor or "")
    return digitos[-10:] if len(digitos) > 10 else digitos


def _distinto(a: str, b: str) -> bool:
    """Compara nombres ignorando acentos, orden y palabras sueltas; True si no comparten ningún apellido."""
    def tokens(s: str) -> set:
        plano = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
        return {t for t in re.split(r"\W+", plano) if len(t) > 2}

    ta, tb = tokens(a), tokens(b)
    return bool(ta and tb and not (ta & tb))


def _duplicado(db: Session, telefono: str, correo: str, cuenta_id: int, excluir: Optional[int] = None) -> Optional[Candidato]:
    """Nunca empareja contra un candidato de Modo Prueba (`es_prueba=True`); tampoco cruza
    Cuentas — dos empresas reclutadoras distintas en la plataforma no deben verse como
    'el mismo candidato duplicado' entre sí."""
    q = db.query(Candidato).filter(Candidato.es_prueba.is_(False), Candidato.cuenta_id == cuenta_id)
    if excluir:
        q = q.filter(Candidato.id != excluir)
    if telefono:
        existente = q.filter(Candidato.telefono == telefono).first()
        if existente:
            return existente
    if correo:
        return q.filter(func.lower(Candidato.correo) == correo.strip().lower()).first()
    return None


# ============================================================
# Fase C — Helpers de actividad y resultado "Apto"
# ============================================================


def _actualizar_ultima_actividad(c: Candidato) -> None:
    """Registra que hubo actividad relevante en este candidato ahora mismo.
    Debe llamarse justo antes de db.commit() en cualquier endpoint que modifique
    el estado del candidato (etapa, evaluación, documento, mensaje, consentimiento)."""
    from ..models import ahora as _ahora
    c.ultima_actividad_en = _ahora()


def _recalcular_resultado_apto(c: Candidato) -> str:
    """Actualiza Candidato.resultado_apto aplicando la regla 'el más reciente gana':

    1. Contratación / Onboarding → True siempre (llegaron al final del pipeline).
    2. Descartado (decision() -> estado='no_cumple' sin evaluaciones posteriores) → False.
    3. EntrevistaHumana más reciente con resultado → aprobado=True | no_aprobado=False.
    4. Entrevista IA más reciente evaluada → avanzar=True | no_avanzar=False.
    5. Prefiltro (c.estado) → cumple=True | no_cumple=False | otro=None.

    Se llama tras cualquier cambio que pueda alterar el resultado vigente. Regresa qué regla
    decidió el valor final ("contratacion"|"entrevista_humana"|"entrevista_ia"|"prefiltro") —
    lo usa `_recalcular_resultado_apto_y_notificar` (Fase D) para saber si el cambio vino del
    prefiltro Zero-Touch (excluido de notificaciones) o de una etapa posterior real.
    """
    # Regla 1: etapas finales del pipeline — llegaron al final del proceso, siempre Aptos.
    if c.etapa in ("Contratación", "Onboarding"):
        c.resultado_apto = True
        return "contratacion"

    # Regla 3: Entrevista Humana más reciente con resultado registrado
    for eh in reversed(c.entrevistas_humanas):
        if eh.resultado:
            c.resultado_apto = (eh.resultado == "aprobado")
            return "entrevista_humana"

    # Regla 4: Entrevista IA más reciente evaluada
    for e in reversed(c.entrevistas):
        rec = (e.evaluacion or {}).get("recomendacion", "")
        if rec:
            c.resultado_apto = (rec == "avanzar")
            return "entrevista_ia"

    # Regla 5: Prefiltro del agente (fallback) — Zero-Touch, no dispara notificaciones.
    if c.estado == "cumple":
        c.resultado_apto = True
    elif c.estado == "no_cumple":
        c.resultado_apto = False
    else:
        c.resultado_apto = None
    return "prefiltro"


async def _recalcular_resultado_apto_y_notificar(db: Session, c: Candidato, actor: str) -> None:
    """Fase D, evento 'candidato_apto': dispara la notificación solo cuando resultado_apto pasa
    a True por una etapa POSTERIOR al prefiltro (Entrevista IA, Entrevista Humana,
    Contratación) — el apto/no-apto de prefiltro (Zero-Touch) sigue 100% excluido, tal como se
    confirmó en la investigación de Fase D."""
    anterior = c.resultado_apto
    origen = _recalcular_resultado_apto(c)
    if c.resultado_apto is True and anterior is not True and origen != "prefiltro":
        eh = c.entrevistas_humanas[-1] if c.entrevistas_humanas else None
        await notificaciones.disparar(db, "candidato_apto", c, actor, eh=eh)


@router.get("")
def listar(
    vacante: Optional[str] = None,
    etapa: Optional[str] = None,
    estado: Optional[str] = None,
    # --- Fase C: filtros adicionales ---
    fuente: Optional[str] = None,
    # --- Fase F: búsqueda por nombre (LIKE, mismo patrón que vacantes.listar::busqueda) ---
    nombre: Optional[str] = None,
    cliente_id: Optional[int] = None,
    responsable_id: Optional[int] = None,
    consentimiento: Optional[bool] = None,
    apto: Optional[bool] = None,           # True → resultado_apto == True; False → == False
    duplicados: Optional[bool] = None,     # True → candidatos con tel/correo repetido en la Cuenta
    score_min: Optional[int] = None,       # Score CV mínimo (0-100)
    score_max: Optional[int] = None,       # Score CV máximo (0-100)
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    # A diferencia de /metricas y los conteos por vacante, este listado (el Kanban de RH) SÍ
    # incluye a los candidatos de Modo Prueba (es_prueba=True) — el frontend los distingue con
    # un badge "Prueba" para que un admin pueda seguir su propio flujo de pruebas visualmente.
    q = db.query(Candidato).filter(Candidato.cuenta_id == cuenta.id).order_by(Candidato.id.desc())
    if vacante:
        v = _vacante(db, vacante, cuenta.id)
        q = q.filter(Candidato.vacante_id == v.id)
    if etapa:
        q = q.filter(Candidato.etapa == etapa)
    if estado:
        q = q.filter(Candidato.estado == estado)
    if fuente:
        q = q.filter(Candidato.fuente == fuente)
    if nombre:
        q = q.filter(Candidato.nombre.ilike(f"%{nombre.strip()}%"))
    if consentimiento is not None:
        q = q.filter(Candidato.consentimiento.is_(consentimiento))
    if apto is not None:
        q = q.filter(Candidato.resultado_apto.is_(apto))
    if score_min is not None:
        q = q.filter(Candidato.score >= score_min)
    if score_max is not None:
        q = q.filter(Candidato.score <= score_max)
    if cliente_id is not None:
        q = q.join(Vacante, Candidato.vacante_id == Vacante.id).filter(Vacante.cliente_id == cliente_id)
    if responsable_id is not None:
        q = q.join(Vacante, Candidato.vacante_id == Vacante.id, isouter=True).filter(Vacante.responsable_id == responsable_id)
    if duplicados:
        # Candidatos cuyo teléfono normalizado o correo en minúsculas aparece más de una vez
        # en la misma Cuenta — misma lógica que _duplicado(), pero para MOSTRAR, no para bloquear.
        from sqlalchemy import select
        tel_dup = (
            select(Candidato.telefono)
            .where(Candidato.cuenta_id == cuenta.id, Candidato.telefono != "", Candidato.es_prueba.is_(False))
            .group_by(Candidato.telefono)
            .having(func.count(Candidato.id) > 1)
        ).scalar_subquery()
        correo_dup = (
            select(func.lower(Candidato.correo))
            .where(Candidato.cuenta_id == cuenta.id, Candidato.correo != "", Candidato.es_prueba.is_(False))
            .group_by(func.lower(Candidato.correo))
            .having(func.count(Candidato.id) > 1)
        ).scalar_subquery()
        from sqlalchemy import or_
        q = q.filter(or_(Candidato.telefono.in_(tel_dup), func.lower(Candidato.correo).in_(correo_dup)))
    return [candidato_dict(c) for c in q.all()]


@router.post("/prueba/eliminar")
def eliminar_candidatos_prueba(
    db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)
):
    """Botón «Eliminar postulaciones de prueba» (solo admin) — borra TODOS los candidatos
    con `es_prueba=True` de la Cuenta activa y lo que cuelga de ellos. Mismo patrón de cascada
    que scripts/borrar_demo_candidatos.py (que borra por prefijo de código en vez de por flag)."""
    candidatos = db.query(Candidato).filter(Candidato.es_prueba.is_(True), Candidato.cuenta_id == cuenta.id).all()
    if not candidatos:
        return {"candidatos": 0, "mensajes": 0, "entrevistas": 0, "expedientes": 0, "documentos": 0}

    ids = [c.id for c in candidatos]
    n_msj = db.query(Mensaje).filter(Mensaje.candidato_id.in_(ids)).delete(synchronize_session=False)
    n_ent = db.query(Entrevista).filter(Entrevista.candidato_id.in_(ids)).delete(synchronize_session=False)

    # Expediente uno por uno (no bulk delete) para que la cascada del ORM se lleve
    # también sus Documento — Expediente.documentos tiene cascade="all, delete-orphan".
    expedientes = db.query(Expediente).filter(Expediente.candidato_id.in_(ids)).all()
    n_doc = sum(len(e.documentos) for e in expedientes)
    for e in expedientes:
        db.delete(e)
    db.flush()

    codigos = [c.codigo for c in candidatos]
    for c in candidatos:
        db.delete(c)  # Candidato.archivos también tiene cascade="all, delete-orphan"

    registrar(
        db, u.nombre, "candidatos_prueba_borrados", "sistema", "modo_prueba",
        {"candidatos": codigos, "correo_rh": u.correo},
    )
    db.commit()
    return {"candidatos": len(candidatos), "mensajes": n_msj, "entrevistas": n_ent, "expedientes": len(expedientes), "documentos": n_doc}


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    return candidato_dict(_por_codigo(db, codigo, cuenta.id), detalle=True)


# ------------------------------------------------------------
# Ingesta (rutas 1, 3 y 4: formulario / integración / carga RH)
# ------------------------------------------------------------


class IngresarIn(BaseModel):
    nombre: str
    correo: str = ""
    telefono: str = ""
    ubicacion: str = ""
    experiencia: str = ""
    fuente: str = "Formulario"  # Formulario | WhatsApp | OCC | LinkedIn | Indeed | RH
    vacante: Optional[str] = None  # código VAC-####
    consentimiento: bool = False


@router.post("", status_code=201)
def ingresar(
    datos: IngresarIn,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre del candidato es obligatorio.")
    vac = _vacante(db, datos.vacante, cuenta.id)
    telefono = _telefono(datos.telefono)
    prueba = modo_prueba_activo(db)

    # dedup básico por teléfono o correo (módulo 3.6) — con Modo Prueba activo se salta siempre:
    # cada alta es una postulación nueva e independiente marcada es_prueba=True.
    if not prueba:
        existente = _duplicado(db, telefono, datos.correo, cuenta.id)
        if existente:
            return {"duplicado": True, **candidato_dict(existente)}

    c = Candidato(
        codigo="TMP",
        cuenta_id=cuenta.id,
        nombre=datos.nombre.strip(),
        correo=datos.correo.strip(),
        telefono=telefono,
        ubicacion=datos.ubicacion,
        experiencia=datos.experiencia,
        fuente=datos.fuente,
        vacante_id=vac.id if vac else None,
        consentimiento=datos.consentimiento,
        consentimiento_fecha=datetime.now(timezone.utc) if datos.consentimiento else None,
        es_prueba=prueba,
    )
    db.add(c)
    db.flush()
    c.codigo = f"C-{8800 + c.id}"
    registrar(db, "sistema", "candidato_ingresado", "candidato", c.codigo, {"fuente": datos.fuente, "vacante": datos.vacante})
    db.commit()
    return {"duplicado": False, **candidato_dict(c)}


# ------------------------------------------------------------
# Extractor de CV (módulo 3.7) — PDF o imagen, uno o varios a la vez
# ------------------------------------------------------------


def _aplicar_cv(db: Session, c: Candidato, datos: ia.CVExtraido, vac: Optional[Vacante], con_ia: bool) -> None:
    """Vuelca la extracción sobre el candidato: datos de contacto + match contra la vacante."""
    if datos.nombre and (not c.nombre or c.nombre.startswith("Candidato")):
        c.nombre = datos.nombre
    c.correo = c.correo or (datos.correo or "")
    c.telefono = c.telefono or _telefono(datos.telefono)
    c.ubicacion = c.ubicacion or (datos.ubicacion or "")
    c.experiencia = (datos.experiencia_resumen or c.experiencia)[:240]
    c.cv_datos = datos.model_dump()

    ajuste = datos.ajuste
    if ajuste and vac:
        c.score = ajuste.score
        c.evidencia = ajuste.evidencia
        # un CV subido después no reclasifica a quien RH ya avanzó: solo actualiza score y evidencia
        if c.etapa == "Prefiltro":
            c.estado = ajuste.estado
        c.analisis = {
            "origen": "cv",
            "ia": con_ia,
            "requisitos_cumplidos": ajuste.requisitos_cumplidos,
            "brechas": ajuste.brechas,
            "alertas": datos.alertas,
            "datos_faltantes": datos.datos_faltantes,
        }
    else:
        c.estado = "revision" if datos.datos_faltantes else c.estado
        c.evidencia = (
            "Datos faltantes en el CV: " + ", ".join(datos.datos_faltantes)
            if datos.datos_faltantes
            else c.evidencia
        )
        c.analisis = {"origen": "cv", "ia": con_ia, "alertas": datos.alertas, "datos_faltantes": datos.datos_faltantes}


async def _procesar_cv(
    db: Session,
    subida: UploadFile,
    vac: Optional[Vacante],
    fuente: str,
    subido_por: str,
    cuenta_id: int,
    candidato: Optional[Candidato] = None,
) -> dict:
    """Valida el archivo, lo guarda, lo extrae con IA y crea o actualiza al prospecto."""
    archivo = await fs.validar(subida, "CV")
    datos, con_ia = ia.extraer_cv(
        archivo.b64,
        archivo.extension,
        vac.titulo if vac else "",
        vac.requisitos if vac else "",
    )

    c = candidato
    duplicado = False
    avisos: List[str] = []
    prueba = modo_prueba_activo(db)
    if c is None and not prueba:
        telefono = _telefono(datos.telefono)
        c = _duplicado(db, telefono, datos.correo or "", cuenta_id)
        duplicado = c is not None
    if duplicado and c is not None and datos.nombre and _distinto(datos.nombre, c.nombre):
        # mismo teléfono/correo pero otro nombre: puede ser un contacto compartido o un dato mal capturado
        avisos.append(
            f"El CV está a nombre de «{datos.nombre}» pero el contacto ya existía como «{c.nombre}». "
            "Verifica que sea la misma persona antes de avanzarlo."
        )
    if c is None:
        c = Candidato(
            codigo="TMP",
            cuenta_id=cuenta_id,
            nombre=datos.nombre or archivo.nombre.rsplit(".", 1)[0],
            fuente=fuente,
            vacante_id=vac.id if vac else None,
            es_prueba=prueba,
        )
        db.add(c)
        db.flush()
        c.codigo = f"C-{8800 + c.id}"
    elif vac and not c.vacante_id:
        c.vacante_id = vac.id

    _aplicar_cv(db, c, datos, vac, con_ia)

    notas = avisos + list(datos.alertas)
    if not datos.es_cv:
        notas.insert(0, "El archivo no parece un currículum: revísalo manualmente.")
    # duda de identidad o archivo equivocado → nunca se queda en "cumple" automático
    if (avisos or not datos.es_cv) and c.estado == "cumple":
        c.estado = "revision"
        c.evidencia = f"{notas[0]} · {c.evidencia}"

    # el consecutivo evita que un segundo CV con el mismo nombre pise al anterior en disco
    consecutivo = len(c.archivos) + 1
    ruta = fs.guardar(archivo, "cv", f"{c.codigo}_{consecutivo}_{archivo.nombre.rsplit('.', 1)[0]}")
    reg = Archivo(
        tipo="cv",
        nombre=archivo.nombre,
        ruta=ruta,
        mime=archivo.mime,
        tamano=archivo.tamano,
        estado="recibido" if datos.es_cv else "revision",
        notas_ia="; ".join(notas),
        extraccion=datos.model_dump(),
        subido_por=subido_por,
    )
    c.archivos.append(reg)  # por la relación, para que la respuesta ya incluya el archivo nuevo
    db.flush()

    registrar(
        db, "agente-ia", "cv_extraido", "candidato", c.codigo,
        {
            "ia": con_ia,
            "archivo": archivo.nombre,
            "es_cv": datos.es_cv,
            "faltantes": datos.datos_faltantes,
            "score": c.score,
            "vacante": vac.codigo if vac else None,
        },
    )
    return {
        "ok": True,
        "archivo": archivo.nombre,
        "ia": con_ia,
        "duplicado": duplicado,
        "esCv": datos.es_cv,
        "avisos": notas,
        "extraccion": datos.model_dump(),
        "candidato": candidato_dict(c, detalle=True),
    }


@router.post("/cv", status_code=201)
async def subir_cv(
    archivos: List[UploadFile] = File(..., description="Uno o varios CVs en PDF o imagen"),
    vacante: Optional[str] = Form(default=None),
    fuente: str = Form(default="RH"),
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Carga masiva de CVs: valida, extrae con IA y califica contra la vacante."""
    if not archivos:
        raise HTTPException(400, "No se recibió ningún archivo.")
    if len(archivos) > 20:
        raise HTTPException(400, "Máximo 20 CVs por carga.")
    vac = _vacante(db, vacante, cuenta.id)

    resultados = []
    for subida in archivos:
        try:
            resultados.append(await _procesar_cv(db, subida, vac, fuente, u.nombre, cuenta.id))
            db.commit()
        except HTTPException as e:
            db.rollback()
            resultados.append({"ok": False, "archivo": subida.filename or "archivo", "error": e.detail})

    exitosos = [r for r in resultados if r["ok"]]
    return {
        "procesados": len(exitosos),
        "fallidos": len(resultados) - len(exitosos),
        "resultados": resultados,
    }


async def _disparar_plantilla_inicio(db: Session, c: Candidato) -> dict:
    """Rompe el hielo por WhatsApp justo después de guardar al candidato, usando la plantilla
    aprobada de Meta (nunca texto libre: la web no cuenta como 'el candidato escribió primero')."""
    if not c.telefono:
        return {"enviado": False, "detalle": "El candidato no dejó WhatsApp."}
    primer_nombre = (c.nombre or "").split(" ")[0] or "candidato(a)"
    envio = await enviar_plantilla(c.telefono, PLANTILLA_INICIO_ENTREVISTA, [primer_nombre])
    texto_mensaje = (
        f"[Plantilla de WhatsApp «{PLANTILLA_INICIO_ENTREVISTA}»] Hola {primer_nombre}, ¡gracias por tu interés! Empecemos con tu proceso."
        if envio.get("enviado")
        else f"[Fallo de envío Meta] La plantilla «{PLANTILLA_INICIO_ENTREVISTA}» no pudo entregarse a {c.telefono}: {envio.get('detalle', 'sin detalle')}."
    )
    db.add(Mensaje(
        candidato_id=c.id, rol="assistant", texto=texto_mensaje,
        canal="whatsapp", enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", ""),
    ))
    registrar(
        db, "sistema", "plantilla_inicio_enviada", "candidato", c.codigo,
        {"plantilla": PLANTILLA_INICIO_ENTREVISTA, "whatsapp": envio},
    )
    return envio


@router.post("/postular", status_code=201)
async def postular(
    vacante: str = Form(..., description="slug o código de la vacante publicada"),
    nombre: str = Form(...),
    telefono: str = Form(default=""),
    correo: str = Form(default=""),
    consentimiento: bool = Form(default=False),
    respuestas: str = Form(default="", description="JSON: [{pregunta, respuesta}]"),
    cv: Optional[UploadFile] = File(default=None, description="CV en PDF o imagen"),
    db: Session = Depends(get_db),
):
    """Postulación desde la página pública `/aplicar/[slug]` — un solo paso para el candidato."""
    if not nombre.strip():
        raise HTTPException(400, "Necesitamos tu nombre completo.")
    if not consentimiento:
        raise HTTPException(400, "Necesitamos tu autorización para tratar tus datos (Aviso de Privacidad).")
    if not telefono.strip() and not correo.strip():
        raise HTTPException(400, "Déjanos un WhatsApp o un correo para poder contactarte.")

    vac = db.query(Vacante).filter(Vacante.slug == vacante).first()
    if not vac:
        vac = db.query(Vacante).filter(func.lower(Vacante.slug) == vacante.lower()).first()
    if not vac:
        vac = db.query(Vacante).filter(Vacante.codigo == vacante).first()
    if not vac:
        # Si aún no coincide, buscar por título aproximado
        vac = db.query(Vacante).filter(func.lower(Vacante.titulo) == vacante.replace("-", " ").lower()).first()
    if not vac:
        raise HTTPException(404, f"Vacante '{vacante}' no encontrada")

    tel = _telefono(telefono)
    prueba = modo_prueba_activo(db)

    c = None
    if not prueba:
        c = _duplicado(db, tel, correo, vac.cuenta_id)
        if c and c.etapa != "Prefiltro":
            # Ya avanzó del prefiltro (en esta vacante o en otra): no lo mezclamos con una
            # postulación nueva — antes esto pisaba silenciosamente su vacante_id.
            raise HTTPException(
                409,
                f"Ya tienes un proceso en curso para la vacante «{c.vacante.titulo if c.vacante else 'otra posición'}» "
                f"(etapa: {c.etapa}). Contacta a RH si necesitas darle seguimiento.",
            )
    # Con Modo Prueba activo, `c` siempre queda en None aquí: cada llamada es una postulación
    # nueva e independiente, sin importar cuánto pasó desde la anterior ni la etapa de esa otra.

    nuevo = c is None
    if c is None:
        c = Candidato(
            codigo="TMP", cuenta_id=vac.cuenta_id, nombre=nombre.strip(), telefono=tel, correo=correo.strip(),
            fuente="Formulario", es_prueba=prueba,
        )
        db.add(c)
        db.flush()
        c.codigo = f"C-{8800 + c.id}"
    else:
        if nombre.strip() and (not c.nombre or c.nombre.startswith("Candidato")):
            c.nombre = nombre.strip()
        if tel and not c.telefono:
            c.telefono = tel
        if correo.strip() and not c.correo:
            c.correo = correo.strip()

    # Antes: `if not c.vacante_id: ...` — se quedaba pegado a la primera vacante para siempre.
    # El guard de arriba ya garantiza que solo llegamos aquí si es seguro reasignar: candidato
    # nuevo, o uno existente que sigue en Prefiltro sin avance real.
    c.vacante_id = vac.id

    c.consentimiento = True
    c.consentimiento_fecha = datetime.now(timezone.utc)
    registrar(
        db, c.codigo, "consentimiento_otorgado", "candidato", c.codigo,
        {"medio": "portal", "vacante": vac.codigo, "aviso_privacidad": "aceptado en /aplicar"},
    )

    resultado_cv = {"ok": False, "avisos": []}
    if cv and cv.filename:
        try:
            resultado_cv = await _procesar_cv(db, cv, vac, "Formulario", c.codigo, vac.cuenta_id, candidato=c)
        except Exception as e:
            print(f"[postular-cv-error] Error procesando CV: {e}")
            resultado_cv = {"ok": False, "avisos": [f"No se pudo extraer el CV: {e}"]}

    registrar(db, "sistema", "postulacion_recibida", "candidato", c.codigo, {"vacante": vac.codigo, "nuevo": nuevo})
    db.commit()

    # Zero-Touch: dispara la plantilla de Meta ("recibimos tu postulación") ya con el candidato
    # comprometido a disco — vacante_id y consentimiento incluidos — solo para candidatos nuevos,
    # para no volver a "romper el hielo" con alguien que ya nos escribió. Antes se mandaba ANTES
    # del commit: si el candidato respondía muy rápido (p. ej. mientras _procesar_cv seguía
    # llamando a la IA), el webhook corría en otra transacción que todavía no veía este registro
    # y creaba un candidato duplicado sin vacante — el agente le mandaba el menú de vacantes en
    # vez de continuar el prefiltro.
    if nuevo:
        await _disparar_plantilla_inicio(db, c)
        db.commit()

    return {
        "ok": True,
        "candidato": c.codigo,
        "nombre": c.nombre,
        "nuevo": nuevo,
        "cv": {"procesado": resultado_cv.get("ok", False), "avisos": resultado_cv.get("avisos", [])},
    }


@router.post("/{codigo}/archivos", status_code=201)
async def subir_archivo(
    codigo: str,
    archivo: UploadFile = File(...),
    tipo: str = Form(default="cv"),
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Adjunta un archivo a un prospecto existente. Si es CV, vuelve a extraer y recalificar."""
    c = _por_codigo(db, codigo, cuenta.id)
    if tipo not in TIPOS_ARCHIVO:
        raise HTTPException(400, f"Tipo inválido. Usa uno de: {', '.join(TIPOS_ARCHIVO)}")

    if tipo == "cv":
        resultado = await _procesar_cv(db, archivo, c.vacante, c.fuente, u.nombre, cuenta.id, candidato=c)
        db.commit()
        return resultado

    validado = await fs.validar(archivo, tipo)
    consecutivo = len(c.archivos) + 1
    ruta = fs.guardar(validado, "anexos", f"{c.codigo}_{consecutivo}_{tipo}_{validado.nombre.rsplit('.', 1)[0]}")
    reg = Archivo(
        tipo=tipo,
        nombre=validado.nombre,
        ruta=ruta,
        mime=validado.mime,
        tamano=validado.tamano,
        estado="recibido",
        subido_por=u.nombre,
    )
    c.archivos.append(reg)
    db.flush()
    registrar(db, u.nombre, "archivo_adjuntado", "candidato", c.codigo, {"tipo": tipo, "archivo": validado.nombre})
    _actualizar_ultima_actividad(c)
    db.commit()
    return {"ok": True, "archivo": archivo_dict(reg), "candidato": candidato_dict(c, detalle=True)}


@router.get("/{codigo}/archivos/{archivo_id}")
def descargar_archivo(
    codigo: str,
    archivo_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    c = _por_codigo(db, codigo, cuenta.id)
    a = next((x for x in c.archivos if x.id == archivo_id), None)
    if not a:
        raise HTTPException(404, "Archivo no encontrado")
    if not fs.existe(a.ruta):
        raise HTTPException(410, "El archivo ya no está disponible en el servidor.")
    return FileResponse(a.ruta, media_type=a.mime, filename=a.nombre)


# ------------------------------------------------------------
# Asignación y reevaluación contra la vacante
# ------------------------------------------------------------


class AsignarIn(BaseModel):
    vacante: str
    reevaluar: bool = True


@router.post("/{codigo}/asignar")
async def asignar(
    codigo: str,
    datos: AsignarIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Mueve al prospecto a otra vacante y, si tiene CV, recalcula el match."""
    c = _por_codigo(db, codigo, cuenta.id)
    vac = _vacante(db, datos.vacante, cuenta.id)
    anterior = c.vacante.codigo if c.vacante else None
    c.vacante_id = vac.id

    if datos.reevaluar and c.cv_datos:
        cv = next((a for a in reversed(c.archivos) if a.tipo == "cv" and fs.existe(a.ruta)), None)
        if cv:
            with open(cv.ruta, "rb") as f:
                b64 = base64.standard_b64encode(f.read()).decode()
            datos_cv, con_ia = ia.extraer_cv(b64, cv.ruta.rsplit(".", 1)[-1], vac.titulo, vac.requisitos)
            _aplicar_cv(db, c, datos_cv, vac, con_ia)

    await _recalcular_resultado_apto_y_notificar(db, c, u.nombre)  # la nueva vacante puede cambiar el contexto de evaluación
    registrar(db, u.nombre, "candidato_reasignado", "candidato", c.codigo, {"de": anterior, "a": vac.codigo})
    db.commit()
    return candidato_dict(c, detalle=True)


@router.post("/{codigo}/liberar-telefono")
def liberar_telefono(
    codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)
):
    """SOLO PRUEBAS: limpia teléfono y wa_id del candidato para poder reutilizar el mismo número
    de WhatsApp en pruebas repetidas sin que `_buscar_o_crear_candidato` (webhooks.py) lo asocie
    a este registro. No borra el candidato ni sus mensajes/CV/expediente."""
    c = _por_codigo(db, codigo, cuenta.id)
    anterior = {"telefono": c.telefono, "wa_id": c.wa_id}
    c.telefono = ""
    c.wa_id = ""
    registrar(db, u.nombre, "telefono_liberado_prueba", "candidato", c.codigo, anterior)
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Prefiltro conversacional (módulo 3.9)
# ------------------------------------------------------------


@router.get("/{codigo}/mensajes")
def mensajes(
    codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)
):
    c = _por_codigo(db, codigo, cuenta.id)
    return [
        {"rol": m.rol, "texto": m.texto, "canal": m.canal, "enviado": m.enviado, "ts": m.creado_en.isoformat()}
        for m in c.mensajes
    ]


class MensajeIn(BaseModel):
    texto: str
    canal: str = "simulador"  # simulador | whatsapp | web


# Score mínimo (0-100) para considerarse "apto" en el flujo automático (Zero-Touch).
UMBRAL_ZERO_TOUCH = 50


def _texto_apto(c: Candidato) -> str:
    return (
        f"¡Buenas noticias, {c.nombre.split(' ')[0]}! 🎉 Tu perfil es compatible con lo que buscamos "
        "para esta vacante. Cuéntame, ¿qué disponibilidad tienes para una breve videollamada?"
    )


async def _avisar_apto_e_iniciar_agenda(db: Session, c: Candidato) -> dict:
    """Mensaje que invita al candidato a compartir su disponibilidad — en cuanto responda,
    procesar_prefiltro lo enruta a _procesar_turno_agenda (herramienta agendar_videollamada).
    La usan tanto la clasificación automática de Zero-Touch como el botón manual
    'Enviar a Entrevista IA' (mover_etapa), para que ambos caminos se comporten igual."""
    texto = _texto_apto(c)
    envio = {"enviado": False, "proveedor": "demo"}
    if c.telefono:
        try:
            envio = await enviar_mensaje(c.telefono, texto)
        except Exception as e:  # que WhatsApp falle no debe tumbar el flujo
            print(f"[whatsapp-send-error] avisar_apto -> {c.codigo}: {e}")
            envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}
    db.add(Mensaje(
        candidato_id=c.id, rol="assistant", texto=texto, canal="whatsapp",
        enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", ""),
    ))
    return envio


async def _auto_decision_zero_touch(db: Session, c: Candidato) -> dict:
    """Flujo Zero-Touch: al terminar el prefiltro, clasifica al candidato contra
    UMBRAL_ZERO_TOUCH y le avisa el resultado por WhatsApp sin intervención de RH.

    Reemplaza el estado intermedio 'revision' del agente por una decisión binaria
    (cumple/no_cumple). RH conserva la capacidad de reabrir el caso desde el panel;
    la bitácora deja constancia de que la acción la tomó el agente ("agente-ia"),
    no una persona de RH, para no falsear la trazabilidad que exige la LFPDPPP.

    Regresa {"respuesta": str, "whatsapp": dict} — el ÚNICO mensaje que debe ver el
    candidato en el turno de cierre del prefiltro (ver procesar_prefiltro: ya no se
    manda encima el mensaje genérico de turno.respuesta).
    """
    if c.score < UMBRAL_ZERO_TOUCH:
        c.estado = "no_cumple"
        accion = "auto_descartado_zero_touch"
        texto = (
            f"Gracias por tu tiempo, {c.nombre.split(' ')[0]}. Después de revisar tus respuestas, "
            "por ahora tu perfil no se alinea con lo que busca esta vacante. Guardamos tu información "
            "por si surge una oportunidad más adelante. ¡Mucho éxito en tu búsqueda! 🙌"
        )
        registrar(db, "agente-ia", accion, "candidato", c.codigo, {"score": c.score, "umbral": UMBRAL_ZERO_TOUCH})
        envio = {"enviado": False, "proveedor": "demo"}
        if c.telefono:
            try:
                envio = await enviar_mensaje(c.telefono, texto)
            except Exception as e:
                print(f"[zero-touch-whatsapp-error] {c.codigo}: {e}")
                envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}
        # Se guarda igual sin teléfono (p.ej. pruebas por simulador): así el veredicto real
        # siempre queda en el historial, aunque no haya salido por WhatsApp.
        db.add(Mensaje(
            candidato_id=c.id, rol="assistant", texto=texto, canal="whatsapp",
            enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", ""),
        ))
        return {"respuesta": texto, "whatsapp": envio}

    c.estado = "cumple"
    # antes la tarjeta solo se movía al agendar la cita, así que un candidato ya clasificado
    # como apto seguía viéndose "atorado" en Prefiltro mientras coordinaba fecha/hora — se
    # mueve aquí para que el Kanban refleje la realidad de inmediato.
    c.etapa = "Entrevista IA"
    registrar(
        db, "agente-ia", "auto_apto_zero_touch", "candidato", c.codigo,
        {"score": c.score, "umbral": UMBRAL_ZERO_TOUCH},
    )
    envio = await _avisar_apto_e_iniciar_agenda(db, c)
    return {"respuesta": _texto_apto(c), "whatsapp": envio}


def _parsear_fecha_cita(valor: str) -> Optional[datetime]:
    """agendar_videollamada debe regresar ISO 8601; si el modelo se equivocó de formato, se
    ignora la fecha — mejor no programar el aviso de no-show que programarlo mal.

    Se normaliza a UTC en automático antes de regresar. SQLite (el motor de esta base, ver
    database.py) no preserva el offset de un DateTime(timezone=True): al releerlo pierde la
    zona horaria pero conserva los mismos números de reloj con los que se guardó. Si aquí se
    devolviera tal cual "09:55:00-06:00" (hora de México), en SQLite quedaría guardado como
    "09:55:00" a secas, y services/agenda.py lo compararía contra un "ahora" en UTC como si
    esas 9:55 ya fueran UTC — el aviso de no-show se dispararía varias horas antes de la cita
    real. Convertir a UTC aquí, antes de guardar, hace que el valor absoluto sea correcto
    aunque SQLite le quite la etiqueta de zona horaria."""
    try:
        dt = datetime.fromisoformat(valor)
    except (TypeError, ValueError):
        return None
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def _procesar_turno_agenda(db: Session, c: Candidato, historial: List[dict], canal: str) -> dict:
    """Turno posterior a la clasificación: coordina la videollamada con la herramienta
    agendar_videollamada (function calling) — ver ia.agenda_turno."""
    v = c.vacante
    turno, con_ia = ia.agenda_turno(
        c.wa_nombre or c.nombre.split(" ")[0], v.titulo if v else "", historial, db=db, candidato=c
    )

    respuesta_final = turno.respuesta
    if turno.cita_fecha_hora and turno.cita_liga:
        fecha = _parsear_fecha_cita(turno.cita_fecha_hora)
        c.videollamada_agendada_en = fecha or datetime.now(timezone.utc)
        c.videollamada_liga = turno.cita_liga
        c.etapa = "Entrevista IA"  # ver ETAPAS_CANDIDATO — no cambia el comportamiento de Zero-Touch, solo el nombre de la columna
        registrar(
            db, "agente-ia", "videollamada_agendada", "candidato", c.codigo,
            {"fecha_hora": turno.cita_fecha_hora, "liga": turno.cita_liga, "fecha_parseada": bool(fecha)},
        )
        # La liga real se agrega aquí, textual — nunca se manda la que el modelo haya escrito
        # dentro de turno.respuesta: un token de 32+ caracteres es fácil de transcribir mal, y
        # eso deja al candidato con una liga que da 404 sin que nadie se entere.
        respuesta_final = f"{turno.respuesta}\n\n{turno.cita_liga}"

    envio = {"enviado": False, "proveedor": "demo"}
    if canal == "whatsapp" and c.telefono:
        try:
            envio = await enviar_mensaje(c.telefono, respuesta_final)
        except Exception as e:  # que WhatsApp falle no debe tumbar la conversación
            print(f"[whatsapp-send-error] Error enviando mensaje a {c.telefono}: {e}")
            envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}
    db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=respuesta_final, canal=canal,
                   enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", "")))
    db.commit()
    return {
        "respuesta": respuesta_final,
        "clasificacion": None,
        "ia": con_ia,
        "whatsapp": envio,
        "cita": {"fechaHora": turno.cita_fecha_hora, "liga": turno.cita_liga} if turno.cita_liga else None,
    }


async def _procesar_turno_onboarding(db: Session, c: Candidato, historial: List[dict], canal: str) -> dict:
    """Zero-Touch fase 2: el candidato ya está en Onboarding — el agente ya no evalúa ni agenda,
    solo acompaña la recolección de documentos (ver ia.onboarding_turno)."""
    v = c.vacante
    turno, con_ia = ia.onboarding_turno(c.wa_nombre or c.nombre.split(" ")[0], v.titulo if v else "", historial)

    envio = {"enviado": False, "proveedor": "demo"}
    if canal == "whatsapp" and c.telefono:
        try:
            envio = await enviar_mensaje(c.telefono, turno.respuesta)
        except Exception as e:  # que WhatsApp falle no debe tumbar la conversación
            print(f"[whatsapp-send-error] Error enviando mensaje a {c.telefono}: {e}")
            envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}
    db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=turno.respuesta, canal=canal,
                   enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", "")))
    db.commit()
    return {"respuesta": turno.respuesta, "clasificacion": None, "ia": con_ia, "whatsapp": envio}


async def _procesar_turno_post_completo(db: Session, c: Candidato, texto: str, canal: str) -> dict:
    """No queda nada pendiente que la IA deba coordinar (no_cumple ya avisado, o cumple con
    videollamada ya agendada) — se responde con un mensaje fijo, sin volver a llamar al modelo."""
    if c.videollamada_agendada_en:
        respuesta = "¡Ya tienes tu videollamada agendada! Si necesitas reagendar, avísame y lo vemos. 🙌"
    elif c.estado == "no_cumple":
        # Ya se le avisó el rechazo desde _auto_decision_zero_touch — este mensaje NO debe sonar
        # a que su proceso sigue activo ni prometer contacto próximo, solo confirmar que ya se
        # cerró y que sus datos quedan guardados.
        respuesta = (
            "Gracias por escribirnos de nuevo. Ya revisamos tu perfil para esta vacante y por ahora "
            "no avanza en el proceso, pero tus datos quedan en nuestra base para futuras oportunidades."
        )
    else:
        respuesta = "¡Gracias! Ya tengo tu información. Estoy procesando tu perfil y en breve te contactamos con los siguientes pasos. 😊"
    envio = {"enviado": False, "proveedor": "demo"}
    if canal == "whatsapp" and c.telefono:
        try:
            envio = await enviar_mensaje(c.telefono, respuesta)
        except Exception as e:
            print(f"[whatsapp-send-error] Error enviando mensaje a {c.telefono}: {e}")
            envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}
    db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=respuesta, canal=canal,
                   enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", "")))
    db.commit()
    return {"respuesta": respuesta, "clasificacion": None, "ia": False, "whatsapp": envio}


async def procesar_prefiltro(db: Session, c: Candidato, texto: str, canal: str, wa_id: str = "") -> dict:
    """Registra el mensaje del candidato, corre un turno del agente y responde."""
    db.add(Mensaje(candidato_id=c.id, rol="user", texto=texto, canal=canal, wa_id=wa_id))
    db.flush()

    v = c.vacante
    mensajes_db = [{"rol": m.rol, "texto": m.texto} for m in c.mensajes]
    if mensajes_db and mensajes_db[-1]["texto"] == texto and mensajes_db[-1]["rol"] == "user":
        historial = mensajes_db
    else:
        historial = mensajes_db + [{"rol": "user", "texto": texto}]

    # Zero-Touch fase 2: candidato ya en Onboarding -> el agente ya no evalúa ni agenda, solo
    # acompaña documentos. Va ANTES que las ramas de fase 1 a propósito: sin este check, un
    # candidato en Onboarding (que ya trae prefiltro_completo=True y estado="cumple" de fases
    # previas) caería por error en la rama de "ya tienes tu videollamada agendada".
    if c.etapa == "Onboarding":
        return await _procesar_turno_onboarding(db, c, historial, canal)

    # Zero-Touch fase 1: ya clasificado como apto y sin videollamada agendada -> seguimos la
    # conversación con la herramienta de agendamiento en vez de re-correr la clasificación.
    if c.prefiltro_completo and c.estado == "cumple" and not c.videollamada_agendada_en:
        return await _procesar_turno_agenda(db, c, historial, canal)

    # Ya no hay nada más que resolver (no_cumple avisado, o cita ya agendada): respuesta fija.
    if c.prefiltro_completo:
        return await _procesar_turno_post_completo(db, c, texto, canal)

    turno, con_ia = ia.prefiltro_turno(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        (v.preguntas_filtro or []) if v else [],
        historial,
        empresa=nombre_empresa_candidato(v) if v else "",
        ubicacion=v.ubicacion if v else "",
        sueldo=v.sueldo if v else "",
        modalidad=v.modalidad if v else "",
        beneficios=(v.beneficios or []) if v else [],
        perfil_ideal=v.perfil_ideal if v else "",
        nombre_candidato=c.wa_nombre or c.nombre.split(" ")[0],
    )

    analisis_actual = dict(c.analisis or {})
    if turno.respuestas_extraidas:
        analisis_actual["respuestas_prefiltro"] = [r.model_dump() for r in turno.respuestas_extraidas]

    cierra_prefiltro = turno.clasificacion_lista and turno.estado and not c.prefiltro_completo

    if cierra_prefiltro:
        # Turno de cierre: turno.respuesta es el mensaje genérico ("gracias, RH revisará") que
        # la regla (7) del prompt le pide al modelo para no filtrarle el resultado real al
        # candidato — nunca debe llegar por WhatsApp ni quedar en el historial: no aporta nada
        # que _auto_decision_zero_touch no vuelva a decir con el veredicto real, y mandar los
        # dos seguidos (uno genérico, luego el real) confundía al candidato. Se descarta aquí
        # sin guardarlo.
        c.score = turno.score or 0
        c.evidencia = turno.evidencia or ""
        c.prefiltro_completo = True
        analisis_actual.update({"origen": "prefiltro", "ia": con_ia})
        registrar(
            db, "agente-ia", "prefiltro_clasificado", "candidato", c.codigo,
            {"ia": con_ia, "estado_ia": turno.estado, "score": c.score, "evidencia": c.evidencia},
        )

        # Zero-Touch: clasificación final (cumple/no_cumple) — su mensaje es el único que ve
        # el candidato en este turno.
        resultado_cierre = await _auto_decision_zero_touch(db, c)
        clasificacion = {"estado": c.estado, "score": c.score, "evidencia": c.evidencia}
        respuesta_final = resultado_cierre["respuesta"]
        envio = resultado_cierre["whatsapp"]
    else:
        envio = {"enviado": False, "proveedor": "demo"}
        if canal == "whatsapp" and c.telefono:
            try:
                envio = await enviar_mensaje(c.telefono, turno.respuesta)
            except Exception as e:
                # que WhatsApp falle no debe tumbar el prefiltro: queda registrado y RH lo ve
                print(f"[whatsapp-send-error] Error enviando mensaje a {c.telefono}: {e}")
                envio = {"enviado": False, "proveedor": "error", "detalle": str(e)}
        db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=turno.respuesta, canal=canal,
                       enviado=envio.get("enviado", False), wa_id=envio.get("wa_id", "")))
        clasificacion = None
        respuesta_final = turno.respuesta

    c.analisis = analisis_actual
    # Fase C: cada turno del prefiltro (mensaje recibido) es actividad; si hubo clasificaci\u00f3n
    # del agente, recalcular resultado_apto para reflejar cumple/no_cumple reci\u00e9n asignados.
    # (El wrapper de Fase D nunca dispara "candidato_apto" aqu\u00ed: este resultado siempre viene
    # de la regla de prefiltro, que est\u00e1 expl\u00edcitamente excluida de notificaciones.)
    _actualizar_ultima_actividad(c)
    if cierra_prefiltro:
        await _recalcular_resultado_apto_y_notificar(db, c, "agente-ia")
    db.commit()
    return {"respuesta": respuesta_final, "clasificacion": clasificacion, "ia": con_ia, "whatsapp": envio}


@router.post("/{codigo}/prefiltro")
async def prefiltro(
    codigo: str,
    datos: MensajeIn,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    c = _por_codigo(db, codigo, cuenta.id)
    if not datos.texto.strip():
        raise HTTPException(400, "El mensaje va vacío.")
    return await procesar_prefiltro(db, c, datos.texto, datos.canal)


# ------------------------------------------------------------
# Consentimiento (LFPDPPP) — requisito para tratar datos del candidato
# ------------------------------------------------------------


class ConsentimientoIn(BaseModel):
    acepta: bool = True
    medio: str = "verbal"  # portal | whatsapp | verbal | escrito
    evidencia: str = ""


@router.post("/{codigo}/consentimiento")
def consentimiento(
    codigo: str,
    datos: ConsentimientoIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Deja constancia del consentimiento en la bitácora hash-encadenada."""
    c = _por_codigo(db, codigo, cuenta.id)
    if not datos.acepta:
        c.consentimiento = False
        c.consentimiento_fecha = None
        registrar(db, u.nombre, "consentimiento_revocado", "candidato", c.codigo, {"medio": datos.medio})
        db.commit()
        return candidato_dict(c, detalle=True)

    c.consentimiento = True
    c.consentimiento_fecha = datetime.now(timezone.utc)
    _actualizar_ultima_actividad(c)
    registrar(
        db, u.nombre, "consentimiento_otorgado", "candidato", c.codigo,
        {"medio": datos.medio, "evidencia": datos.evidencia[:500], "correo_rh": u.correo},
    )
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Decisión humana (HITL — LFPDPPP: RH decide, la IA recomienda)
# ------------------------------------------------------------
#
# El botón genérico "Avanzar etapa" se reemplazó por botones explícitos por destino
# (ver PATCH /{codigo}/etapa más abajo) a pedido del cliente. "Descartar" sigue aquí
# porque no es un movimiento de tarjeta: es una reclasificación (estado -> no_cumple).


class DecisionIn(BaseModel):
    accion: str  # descartar (el avance genérico se reemplazó por PATCH /candidatos/{codigo}/etapa)
    comentario: str = ""


@router.post("/{codigo}/decision")
async def decision(
    codigo: str,
    datos: DecisionIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    c = _por_codigo(db, codigo, cuenta.id)
    if datos.accion != "descartar":
        raise HTTPException(400, "Acción inválida. Para mover de etapa usa PATCH /candidatos/{codigo}/etapa.")
    if c.expediente:
        raise HTTPException(
            409,
            "El candidato ya tiene expediente de contratación abierto. Cancélalo desde el módulo de contratación antes de descartarlo.",
        )

    recomendacion_ia = {"estado": c.estado, "score": c.score}
    c.etapa = "Prefiltro"
    c.estado = "no_cumple"
    _actualizar_ultima_actividad(c)
    await _recalcular_resultado_apto_y_notificar(db, c, u.nombre)
    registrar(
        db, u.nombre, "decision_descartar", "candidato", c.codigo,
        {"recomendacion_ia": recomendacion_ia, "comentario": datos.comentario, "correo_rh": u.correo},
    )
    db.commit()
    return candidato_dict(c, detalle=True)


class EtapaIn(BaseModel):
    etapa: str
    comentario: str = ""


def _abrir_expediente(db: Session, c: Candidato, u: Usuario) -> Expediente:
    """Crea el expediente con el checklist de 6 documentos al entrar a Contratación. Ya no
    existe el botón «Seleccionar y crear expediente»: esto lo dispara automáticamente
    PATCH /{codigo}/etapa cuando el destino es "Contratación"."""
    exp = Expediente(
        puesto=c.vacante.titulo if c.vacante else "",
        seleccionado_por=u.nombre,
        token=secrets.token_urlsafe(24),
    )
    # se asigna por la relación (no solo candidato_id=c.id): así c.expediente queda
    # sincronizado en memoria de inmediato — si no, candidato_dict(c) seguía viendo None
    # hasta el próximo refresh, aunque el registro ya existiera en la base.
    c.expediente = exp
    db.add(exp)
    db.flush()
    for tipo in DOCUMENTOS_BASE:
        db.add(Documento(expediente_id=exp.id, tipo=tipo, obligatorio=True))
    registrar(db, u.nombre, "expediente_abierto", "candidato", c.codigo, {"expediente": exp.id, "puesto": exp.puesto})
    return exp


@router.patch("/{codigo}/etapa")
async def mover_etapa(
    codigo: str, datos: EtapaIn, forzar_prueba: bool = False,
    db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Avance manual explícito del Kanban — cada botón del panel manda su etapa destino exacta
    (ver ETAPAS_CANDIDATO). No reemplaza el flujo dedicado de Entrevista Humana
    (POST /{codigo}/entrevista-humana, que captura entrevistador/fecha/modalidad además de
    mover la tarjeta) — aquí se rechaza a propósito.

    "Entrevista IA" desde Prefiltro es la única "fricción manual" a propósito: fuerza la
    clasificación como apto y dispara el mismo mensaje que usa Zero-Touch para invitar al
    candidato a compartir disponibilidad, para RH pueda arrancar el proceso sin esperar a
    que el agente termine el prefiltro por su cuenta.

    `forzar_prueba` (Lote 4): inerte salvo que Modo Prueba esté activo (ver
    services.configuracion.puede_forzar_prueba) — deja saltar los bloqueos de secuencia de
    abajo para poder probar el flujo completo rápido, sin esperar a que cada paso previo esté
    realmente satisfecho."""
    c = _por_codigo(db, codigo, cuenta.id)
    if datos.etapa not in ETAPAS_CANDIDATO:
        raise HTTPException(400, f"Etapa inválida. Usa una de: {', '.join(ETAPAS_CANDIDATO)}")
    if datos.etapa == "Entrevista Humana":
        raise HTTPException(409, "Para programar la Entrevista Humana usa POST /candidatos/{codigo}/entrevista-humana.")
    if datos.etapa == "Onboarding":
        if c.etapa != "Contratación" and not puede_forzar_prueba(db, forzar_prueba):
            raise HTTPException(409, "Solo se puede enviar a Onboarding desde la etapa de Contratación.")
    elif c.etapa == "Onboarding" and not puede_forzar_prueba(db, forzar_prueba):
        raise HTTPException(409, "El candidato ya está en Onboarding; gestiona su expediente desde ese módulo.")

    if datos.etapa == "Entrevista IA":
        if c.etapa != "Prefiltro":
            raise HTTPException(409, "Solo se puede forzar Entrevista IA desde la etapa de Prefiltro.")
        if not c.telefono and not puede_forzar_prueba(db, forzar_prueba):
            raise HTTPException(409, "El candidato no tiene WhatsApp registrado; no se puede iniciar el agendamiento.")
        c.estado = "cumple"
        c.prefiltro_completo = True
        envio = await _avisar_apto_e_iniciar_agenda(db, c)
        registrar(
            db, u.nombre, "entrevista_ia_forzada", "candidato", c.codigo,
            {"whatsapp": envio, "correo_rh": u.correo},
        )

    if datos.etapa == "Contratación" and not c.expediente:
        if not c.consentimiento:
            raise HTTPException(
                409,
                "El candidato no tiene consentimiento registrado para el tratamiento de sus datos (LFPDPPP). "
                "Regístralo antes de continuar.",
            )
        _abrir_expediente(db, c, u)

    anterior = c.etapa
    c.etapa = datos.etapa
    _actualizar_ultima_actividad(c)
    await _recalcular_resultado_apto_y_notificar(db, c, u.nombre)
    registrar(
        db, u.nombre, "etapa_movida", "candidato", c.codigo,
        {"de": anterior, "a": datos.etapa, "comentario": datos.comentario, "correo_rh": u.correo},
    )
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Entrevista Humana — modal "Programar entrevista" + checkbox "Entrevista realizada"
# ------------------------------------------------------------

MODALIDADES_ENTREVISTA_HUMANA = ("Presencial", "Videollamada", "Llamada")

# RH captura fecha/hora pensando en hora de México — nunca vienen con offset. Igual que el fix
# de _parsear_fecha_cita (Zero-Touch), hay que convertir a UTC explícitamente antes de guardar:
# SQLite descarta el offset de un DateTime(timezone=True) y se queda con los números de reloj
# tal cual, así que un "11:00" sin convertir se compara después como si ya fuera UTC.
# (TZ_MEXICO y RE_CORREO viven en services/notificaciones.py — Fase D las reutiliza también
# para armar el texto de las notificaciones de Entrevista Humana.)

TIPOS_ENTREVISTADOR = ("interno", "externo")


class EntrevistaHumanaIn(BaseModel):
    tipo_entrevistador: str  # interno | externo
    entrevistador_usuario_id: Optional[int] = None  # requerido si tipo_entrevistador == interno
    entrevistador_nombre: str = ""  # requerido si tipo_entrevistador == externo
    entrevistador_correo: str = ""  # requerido si tipo_entrevistador == externo
    entrevistador_whatsapp: str = ""  # opcional si tipo_entrevistador == externo (Fase D, punto 23)
    fecha: str  # ISO: 2026-09-05
    hora: str  # HH:MM, hora de México
    modalidad: str  # Presencial | Videollamada | Llamada
    liga: str = ""  # obligatoria si modalidad == Videollamada
    ubicacion: str = ""  # obligatoria si modalidad == Presencial
    telefono_contacto: str = ""  # opcional si modalidad == Llamada (si falta, se usa c.telefono)
    comentario: str = ""


@router.post("/{codigo}/entrevista-humana", status_code=201)
async def programar_entrevista_humana(
    codigo: str, datos: EntrevistaHumanaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Botón «Programar entrevista» del modal — agenda una ronda NUEVA (ver EntrevistaHumana:
    cada llamada crea su propia fila, nunca sobreescribe una anterior — así "Agendar otra
    Entrevista Humana" no borra el resultado de la ronda previa), mueve la tarjeta a Entrevista
    Humana y dispara el evento "entrevista_agendada" (Fase D) — a quién y por qué canal ya no
    está fijo aquí, lo decide la regla configurada de la Cuenta."""
    c = _por_codigo(db, codigo, cuenta.id)

    if datos.tipo_entrevistador not in TIPOS_ENTREVISTADOR:
        raise HTTPException(400, f"Tipo de entrevistador inválido. Usa uno de: {', '.join(TIPOS_ENTREVISTADOR)}")

    entrevistador_usuario: Optional[Usuario] = None
    correo_entrevistador = ""
    whatsapp_entrevistador = ""
    if datos.tipo_entrevistador == "interno":
        if not datos.entrevistador_usuario_id:
            raise HTTPException(400, "Selecciona quién entrevista.")
        entrevistador_usuario = (
            db.query(Usuario)
            .filter(Usuario.id == datos.entrevistador_usuario_id, Usuario.activo.is_(True))
            .first()
        )
        if not entrevistador_usuario:
            raise HTTPException(400, "El usuario seleccionado no existe o no está activo.")
        nombre_entrevistador = entrevistador_usuario.nombre
        correo_entrevistador = entrevistador_usuario.correo
    else:
        nombre_entrevistador = datos.entrevistador_nombre.strip()
        if not nombre_entrevistador:
            raise HTTPException(400, "Indica el nombre de quien entrevista.")
        correo_entrevistador = datos.entrevistador_correo.strip()
        if not RE_CORREO.match(correo_entrevistador):
            raise HTTPException(400, "El correo del entrevistador externo no tiene un formato válido.")
        whatsapp_entrevistador = datos.entrevistador_whatsapp.strip()

    if datos.modalidad not in MODALIDADES_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Modalidad inválida. Usa una de: {', '.join(MODALIDADES_ENTREVISTA_HUMANA)}")
    liga = datos.liga.strip()
    ubicacion = datos.ubicacion.strip()
    if datos.modalidad == "Videollamada" and not liga:
        raise HTTPException(400, "Falta la liga de la videollamada.")
    if datos.modalidad == "Presencial" and not ubicacion:
        raise HTTPException(400, "Falta la ubicación de la entrevista.")

    try:
        # Se captura en hora de México y se normaliza a UTC antes de guardar (ver TZ_MEXICO).
        fecha_hora = datetime.fromisoformat(f"{datos.fecha}T{datos.hora}").replace(tzinfo=TZ_MEXICO).astimezone(timezone.utc)
    except ValueError:
        raise HTTPException(400, "Fecha u hora inválida (fecha ISO: 2026-09-05, hora: 14:30).")

    anterior = c.etapa
    c.etapa = "Entrevista Humana"

    eh = EntrevistaHumana(
        candidato_id=c.id,
        tipo=datos.tipo_entrevistador,
        usuario_id=entrevistador_usuario.id if entrevistador_usuario else None,
        correo_externo=correo_entrevistador if datos.tipo_entrevistador == "externo" else "",
        whatsapp_externo=whatsapp_entrevistador if datos.tipo_entrevistador == "externo" else "",
        entrevistador=nombre_entrevistador,
        fecha=fecha_hora,
        modalidad=datos.modalidad,
        liga=liga if datos.modalidad == "Videollamada" else "",
        ubicacion=ubicacion if datos.modalidad == "Presencial" else "",
        telefono_contacto=datos.telefono_contacto.strip() if datos.modalidad == "Llamada" else "",
        comentario=datos.comentario.strip(),
        token=secrets.token_urlsafe(24),
    )
    db.add(eh)
    db.flush()

    resultados = await notificaciones.disparar(db, "entrevista_agendada", c, u.nombre, eh=eh)

    registrar(
        db, u.nombre, "entrevista_humana_programada", "candidato", c.codigo,
        {
            "de": anterior, "entrevistador": eh.entrevistador,
            "tipo_entrevistador": datos.tipo_entrevistador,
            "fecha": fecha_hora.isoformat(), "modalidad": datos.modalidad, "correo_rh": u.correo,
            "notificaciones": resultados,
        },
    )
    _actualizar_ultima_actividad(c)
    db.commit()
    return candidato_dict(c, detalle=True)


RESULTADOS_ENTREVISTA_HUMANA = ("aprobado", "no_aprobado")
RECOMENDACIONES_ENTREVISTA_HUMANA = ("avanzar", "no_avanzar", "segunda_entrevista")


def _ultima_entrevista_humana(c: Candidato) -> EntrevistaHumana:
    if not c.entrevistas_humanas:
        raise HTTPException(409, "El candidato no tiene ninguna Entrevista Humana programada.")
    return c.entrevistas_humanas[-1]


class EntrevistaHumanaModificarIn(BaseModel):
    fecha: str  # ISO: 2026-09-05
    hora: str  # HH:MM, hora de México
    modalidad: str  # Presencial | Videollamada | Llamada
    liga: str = ""  # obligatoria si modalidad == Videollamada
    ubicacion: str = ""  # obligatoria si modalidad == Presencial
    telefono_contacto: str = ""  # opcional si modalidad == Llamada
    comentario: str = ""


@router.patch("/{codigo}/entrevista-humana")
async def modificar_entrevista_humana(
    codigo: str, datos: EntrevistaHumanaModificarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Botón «Modificar» — edita fecha/modalidad/liga/ubicación de la ronda vigente y dispara el
    evento "entrevista_modificada" (Fase D, punto 3 — no existía hasta ahora)."""
    c = _por_codigo(db, codigo, cuenta.id)
    eh = _ultima_entrevista_humana(c)
    if eh.cancelada:
        raise HTTPException(409, "Esta entrevista fue cancelada; agenda una nueva.")
    if eh.realizada:
        raise HTTPException(409, "Esta entrevista ya se marcó como realizada.")

    if datos.modalidad not in MODALIDADES_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Modalidad inválida. Usa una de: {', '.join(MODALIDADES_ENTREVISTA_HUMANA)}")
    liga = datos.liga.strip()
    ubicacion = datos.ubicacion.strip()
    if datos.modalidad == "Videollamada" and not liga:
        raise HTTPException(400, "Falta la liga de la videollamada.")
    if datos.modalidad == "Presencial" and not ubicacion:
        raise HTTPException(400, "Falta la ubicación de la entrevista.")
    try:
        # Se captura en hora de México y se normaliza a UTC antes de guardar (ver TZ_MEXICO).
        fecha_hora = datetime.fromisoformat(f"{datos.fecha}T{datos.hora}").replace(tzinfo=TZ_MEXICO).astimezone(timezone.utc)
    except ValueError:
        raise HTTPException(400, "Fecha u hora inválida (fecha ISO: 2026-09-05, hora: 14:30).")

    eh.fecha = fecha_hora
    eh.modalidad = datos.modalidad
    eh.liga = liga if datos.modalidad == "Videollamada" else ""
    eh.ubicacion = ubicacion if datos.modalidad == "Presencial" else ""
    eh.telefono_contacto = datos.telefono_contacto.strip() if datos.modalidad == "Llamada" else ""
    eh.comentario = datos.comentario.strip()

    resultados = await notificaciones.disparar(db, "entrevista_modificada", c, u.nombre, eh=eh)
    registrar(
        db, u.nombre, "entrevista_humana_modificada", "candidato", c.codigo,
        {
            "fecha": fecha_hora.isoformat(), "modalidad": datos.modalidad, "correo_rh": u.correo,
            "notificaciones": resultados,
        },
    )
    _actualizar_ultima_actividad(c)
    db.commit()
    return candidato_dict(c, detalle=True)


@router.post("/{codigo}/entrevista-humana/cancelar")
async def cancelar_entrevista_humana(
    codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Botón «Cancelar» — dispara el evento "entrevista_cancelada" (Fase D, punto 4 — no existía
    hasta ahora). No mueve la etapa del candidato automáticamente: RH decide a mano el siguiente
    paso (agendar otra ronda o mover la etapa), igual que en cualquier otro punto del pipeline."""
    c = _por_codigo(db, codigo, cuenta.id)
    eh = _ultima_entrevista_humana(c)
    if eh.cancelada:
        raise HTTPException(409, "Esta entrevista ya estaba cancelada.")
    if eh.realizada:
        raise HTTPException(409, "Esta entrevista ya se marcó como realizada.")
    eh.cancelada = True

    resultados = await notificaciones.disparar(db, "entrevista_cancelada", c, u.nombre, eh=eh)
    registrar(
        db, u.nombre, "entrevista_humana_cancelada", "candidato", c.codigo,
        {"correo_rh": u.correo, "notificaciones": resultados},
    )
    _actualizar_ultima_actividad(c)
    db.commit()
    return candidato_dict(c, detalle=True)


@router.post("/{codigo}/entrevista-humana/realizada")
async def marcar_entrevista_humana_realizada(
    codigo: str, forzar_prueba: bool = False, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Botón «Marcar entrevista realizada» — ya no le pide el resultado a RH: marca que la
    entrevista ocurrió y dispara el evento "entrevista_humana_terminada" (Fase D) — la liga de
    evaluación al entrevistador es, ahora, simplemente el destinatario Entrevistador de ese
    evento; RH conserva la opción de capturar/corregir el resultado a mano como respaldo — ver
    POST .../entrevista-humana/resultado."""
    c = _por_codigo(db, codigo, cuenta.id)
    if c.etapa != "Entrevista Humana" and not puede_forzar_prueba(db, forzar_prueba):
        raise HTTPException(409, "El candidato no está en la etapa de Entrevista Humana.")
    eh = _ultima_entrevista_humana(c)

    eh.realizada = True
    resultados = await notificaciones.disparar(db, "entrevista_humana_terminada", c, u.nombre, eh=eh)

    registrar(
        db, u.nombre, "entrevista_humana_marcada_realizada", "candidato", c.codigo,
        {"notificaciones": resultados, "correo_rh": u.correo},
    )
    db.commit()
    return {"resultados": resultados, "candidato": candidato_dict(c, detalle=True)}


class EntrevistaHumanaResultadoIn(BaseModel):
    resultado: str  # aprobado | no_aprobado
    recomendacion: str  # avanzar | no_avanzar | segunda_entrevista
    comentario: str = ""


@router.post("/{codigo}/entrevista-humana/resultado")
async def registrar_resultado_entrevista_humana(
    codigo: str, datos: EntrevistaHumanaResultadoIn, forzar_prueba: bool = False,
    db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Respaldo manual de RH junto a la liga del entrevistador (Eje 1 del Lote 3: gana quien
    llegue primero, pero RH siempre puede usar este mismo endpoint después para corregir —
    a diferencia de POST /entrevista-humana/publica/{token}, que si ya está capturada regresa
    409 sin tocar nada)."""
    c = _por_codigo(db, codigo, cuenta.id)
    if c.etapa != "Entrevista Humana" and not puede_forzar_prueba(db, forzar_prueba):
        raise HTTPException(409, "El candidato no está en la etapa de Entrevista Humana.")
    if datos.resultado not in RESULTADOS_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Resultado inválido. Usa uno de: {', '.join(RESULTADOS_ENTREVISTA_HUMANA)}")
    if datos.recomendacion not in RECOMENDACIONES_ENTREVISTA_HUMANA:
        raise HTTPException(400, f"Recomendación inválida. Usa una de: {', '.join(RECOMENDACIONES_ENTREVISTA_HUMANA)}")
    comentario = datos.comentario.strip()
    if (datos.resultado == "no_aprobado" or datos.recomendacion == "segunda_entrevista") and not comentario:
        raise HTTPException(
            400,
            "Agrega un comentario: es obligatorio cuando el resultado es 'No aprobado' o la "
            "recomendación es 'Segunda entrevista'.",
        )

    eh = _ultima_entrevista_humana(c)
    ya_capturada = bool(eh.resultado_capturado_por)
    eh.realizada = True
    eh.resultado = datos.resultado
    eh.recomendacion = datos.recomendacion
    eh.comentario = comentario
    eh.resultado_capturado_por = "rh"
    _actualizar_ultima_actividad(c)
    await _recalcular_resultado_apto_y_notificar(db, c, u.nombre)
    resultados = await notificaciones.disparar(db, "recomendacion_final", c, u.nombre, eh=eh)
    registrar(
        db, u.nombre, "entrevista_humana_resultado_capturado_rh", "candidato", c.codigo,
        {
            "resultado": datos.resultado, "recomendacion": datos.recomendacion, "comentario": comentario,
            "corrigio_captura_previa": ya_capturada, "correo_rh": u.correo, "notificaciones": resultados,
        },
    )
    db.commit()
    return candidato_dict(c, detalle=True)


@router.post("/{codigo}/entrevista-humana/recordatorio")
async def recordatorio_entrevista_humana(
    codigo: str, forzar_prueba: bool = False, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Botón «Enviar recordatorio» — seguimiento manual junto a «Marcar entrevista realizada».
    Dispara el evento "recordatorio_entrevista" (Fase D): la regla configurada de la Cuenta
    decide el envío completo — si "Candidato · WhatsApp" está apagado, este botón no le manda
    WhatsApp al candidato (puede seguir avisando a entrevistador/cliente si así se configuró)."""
    c = _por_codigo(db, codigo, cuenta.id)
    if c.etapa != "Entrevista Humana" and not puede_forzar_prueba(db, forzar_prueba):
        raise HTTPException(409, "El candidato no está en la etapa de Entrevista Humana.")
    eh = _ultima_entrevista_humana(c)
    if eh.realizada and not puede_forzar_prueba(db, forzar_prueba):
        raise HTTPException(409, "Esta entrevista ya se marcó como realizada.")

    resultados = await notificaciones.disparar(db, "recordatorio_entrevista", c, u.nombre, eh=eh)
    registrar(
        db, u.nombre, "recordatorio_entrevista_humana_enviado", "candidato", c.codigo,
        {"notificaciones": resultados, "correo_rh": u.correo},
    )
    db.commit()
    return {"resultados": resultados, "candidato": candidato_dict(c, detalle=True)}


# ------------------------------------------------------------
# Contratación — expediente automático + formulario de condiciones finales
# ------------------------------------------------------------


@router.get("/{codigo}/expediente")
def expediente(
    codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)
):
    c = _por_codigo(db, codigo, cuenta.id)
    if not c.expediente:
        raise HTTPException(404, "El candidato aún no tiene expediente de contratación.")
    return expediente_dict(c.expediente)


class CondicionesContratacionIn(BaseModel):
    puesto: str = ""
    sueldo: str = ""
    tipo_contratacion: str = ""
    fecha_ingreso: Optional[str] = None  # ISO: 2026-09-15
    ubicacion: str = ""
    jefe_directo: str = ""


@router.patch("/{codigo}/condiciones-contratacion")
def guardar_condiciones_contratacion(
    codigo: str, datos: CondicionesContratacionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Formulario de la etapa Contratación (puesto precargado pero editable, sueldo, tipo de
    contratación, fecha de ingreso, ubicación y jefe directo). Requiere que el expediente ya
    exista — se abre solo al entrar a Contratación, ver mover_etapa/_abrir_expediente."""
    c = _por_codigo(db, codigo, cuenta.id)
    if not c.expediente:
        raise HTTPException(404, "El candidato todavía no tiene expediente de contratación.")

    exp = c.expediente
    if datos.puesto.strip():
        exp.puesto = datos.puesto.strip()
    exp.sueldo = datos.sueldo.strip()
    exp.tipo_contratacion = datos.tipo_contratacion.strip()
    exp.ubicacion = datos.ubicacion.strip()
    exp.jefe_directo = datos.jefe_directo.strip()
    if datos.fecha_ingreso:
        try:
            exp.fecha_ingreso = datetime.fromisoformat(datos.fecha_ingreso).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "fecha_ingreso inválida (usa ISO: 2026-09-15)")

    registrar(
        db, u.nombre, "condiciones_contratacion_guardadas", "candidato", c.codigo,
        {"expediente": exp.id, "sueldo": exp.sueldo, "tipo_contratacion": exp.tipo_contratacion, "correo_rh": u.correo},
    )
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Zero-Touch fase 2 — botones de Onboarding (RH detona, la IA da seguimiento)
# ------------------------------------------------------------
#
# El checklist real de documentos (qué falta, validación con IA, alta) sigue viviendo en
# contratacion.py sobre el Expediente. Estos dos endpoints son el "romper el hielo" y el
# "recordatorio" que pide RH desde la tarjeta del candidato — un mensaje simple que deja al
# agente (ia.onboarding_turno, ver procesar_prefiltro) listo para dar seguimiento a lo que
# el candidato conteste después.

async def _disparar_mensaje_onboarding(db: Session, c: Candidato, evento: str, accion: str, liga: str, u: Usuario) -> dict:
    if c.etapa != "Onboarding":
        raise HTTPException(409, "Esta acción es solo para candidatos en la etapa de Onboarding.")
    resultados = await notificaciones.disparar(db, evento, c, u.nombre, liga=liga)
    registrar(db, u.nombre, accion, "candidato", c.codigo, {"notificaciones": resultados, "correo_rh": u.correo})
    db.commit()
    return {"resultados": resultados, "candidato": candidato_dict(c, detalle=True)}


def _liga_documentos(c: Candidato) -> str:
    """Liga pública para que el candidato suba sus documentos (Lote 4, ver
    routers/expediente_publico.py) — genera el token del expediente perezosamente si es uno de
    los que existían antes de este lote (Expediente.token es nullable, ver models.py)."""
    if not c.expediente:
        raise HTTPException(409, "El candidato no tiene expediente de contratación; no se puede generar la liga de documentos.")
    if not c.expediente.token:
        c.expediente.token = secrets.token_urlsafe(24)
    return f"{settings.app_url}/expediente/{c.expediente.token}"


@router.post("/{codigo}/solicitar-documentos")
async def solicitar_documentos(
    codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)
):
    """Botón 'Solicitar documentos' — rompe el hielo por WhatsApp al entrar a Onboarding, con
    la liga pública para que el candidato suba sus documentos él mismo."""
    c = _por_codigo(db, codigo, cuenta.id)
    liga = _liga_documentos(c)
    return await _disparar_mensaje_onboarding(db, c, "solicitud_documentos", "documentos_solicitados", liga, u)


@router.post("/{codigo}/recordatorio-documentos")
async def recordatorio_documentos(
    codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)
):
    """Botón 'Enviar recordatorio' — seguimiento manual si el candidato no ha respondido."""
    c = _por_codigo(db, codigo, cuenta.id)
    liga = _liga_documentos(c)
    return await _disparar_mensaje_onboarding(db, c, "recordatorio_documentos", "recordatorio_documentos_enviado", liga, u)
