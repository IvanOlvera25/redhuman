"""Módulo 1 · Reclutamiento — Candidatos: ingesta, CV, prefiltro y decisión HITL (3.6–3.9).

La salida del pipeline es el enlace con el Módulo 2: `/candidatos/{codigo}/seleccionar`
crea el expediente de contratación y arranca la solicitud de documentos.
"""

import base64
import json
import re
import unicodedata
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import (
    DOCUMENTOS_BASE,
    Archivo,
    Candidato,
    Documento,
    Expediente,
    Mensaje,
    Usuario,
    Vacante,
    registrar,
)
from ..serial import archivo_dict, candidato_dict, expediente_dict
from ..services import archivos as fs
from ..services import ia
from ..services.whatsapp import enviar_mensaje

router = APIRouter(prefix="/candidatos", tags=["candidatos"])

TIPOS_ARCHIVO = ["cv", "carta", "certificado", "identificacion", "otro"]


def _por_codigo(db: Session, codigo: str) -> Candidato:
    c = db.query(Candidato).filter(Candidato.codigo == codigo).first()
    if not c:
        raise HTTPException(404, "Candidato no encontrado")
    return c


def _vacante(db: Session, codigo: Optional[str]) -> Optional[Vacante]:
    if not codigo:
        return None
    v = db.query(Vacante).filter(Vacante.codigo == codigo).first()
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


def _duplicado(db: Session, telefono: str, correo: str, excluir: Optional[int] = None) -> Optional[Candidato]:
    q = db.query(Candidato)
    if excluir:
        q = q.filter(Candidato.id != excluir)
    if telefono:
        existente = q.filter(Candidato.telefono == telefono).first()
        if existente:
            return existente
    if correo:
        return q.filter(func.lower(Candidato.correo) == correo.strip().lower()).first()
    return None


@router.get("")
def listar(
    vacante: Optional[str] = None,
    etapa: Optional[str] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
):
    q = db.query(Candidato).order_by(Candidato.id.desc())
    if vacante:
        v = _vacante(db, vacante)
        q = q.filter(Candidato.vacante_id == v.id)
    if etapa:
        q = q.filter(Candidato.etapa == etapa)
    if estado:
        q = q.filter(Candidato.estado == estado)
    return [candidato_dict(c) for c in q.all()]


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return candidato_dict(_por_codigo(db, codigo), detalle=True)


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
def ingresar(datos: IngresarIn, db: Session = Depends(get_db), _: Usuario = Depends(usuario_decisor)):
    if not datos.nombre.strip():
        raise HTTPException(400, "El nombre del candidato es obligatorio.")
    vac = _vacante(db, datos.vacante)
    telefono = _telefono(datos.telefono)

    # dedup básico por teléfono o correo (módulo 3.6)
    existente = _duplicado(db, telefono, datos.correo)
    if existente:
        return {"duplicado": True, **candidato_dict(existente)}

    c = Candidato(
        codigo="TMP",
        nombre=datos.nombre.strip(),
        correo=datos.correo.strip(),
        telefono=telefono,
        ubicacion=datos.ubicacion,
        experiencia=datos.experiencia,
        fuente=datos.fuente,
        vacante_id=vac.id if vac else None,
        consentimiento=datos.consentimiento,
        consentimiento_fecha=datetime.now(timezone.utc) if datos.consentimiento else None,
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
    if c is None:
        telefono = _telefono(datos.telefono)
        c = _duplicado(db, telefono, datos.correo or "")
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
            nombre=datos.nombre or archivo.nombre.rsplit(".", 1)[0],
            fuente=fuente,
            vacante_id=vac.id if vac else None,
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
):
    """Carga masiva de CVs: valida, extrae con IA y califica contra la vacante."""
    if not archivos:
        raise HTTPException(400, "No se recibió ningún archivo.")
    if len(archivos) > 20:
        raise HTTPException(400, "Máximo 20 CVs por carga.")
    vac = _vacante(db, vacante)

    resultados = []
    for subida in archivos:
        try:
            resultados.append(await _procesar_cv(db, subida, vac, fuente, u.nombre))
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
    c = _duplicado(db, tel, correo)
    nuevo = c is None
    if c is None:
        c = Candidato(codigo="TMP", nombre=nombre.strip(), telefono=tel, correo=correo.strip(), fuente="Formulario")
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

    if not c.vacante_id:
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
            resultado_cv = await _procesar_cv(db, cv, vac, "Formulario", c.codigo, candidato=c)
        except Exception as e:
            print(f"[postular-cv-error] Error procesando CV: {e}")
            resultado_cv = {"ok": False, "avisos": [f"No se pudo extraer el CV: {e}"]}

    registrar(db, "sistema", "postulacion_recibida", "candidato", c.codigo, {"vacante": vac.codigo, "nuevo": nuevo})
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
):
    """Adjunta un archivo a un prospecto existente. Si es CV, vuelve a extraer y recalificar."""
    c = _por_codigo(db, codigo)
    if tipo not in TIPOS_ARCHIVO:
        raise HTTPException(400, f"Tipo inválido. Usa uno de: {', '.join(TIPOS_ARCHIVO)}")

    if tipo == "cv":
        resultado = await _procesar_cv(db, archivo, c.vacante, c.fuente, u.nombre, candidato=c)
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
    db.commit()
    return {"ok": True, "archivo": archivo_dict(reg), "candidato": candidato_dict(c, detalle=True)}


@router.get("/{codigo}/archivos/{archivo_id}")
def descargar_archivo(codigo: str, archivo_id: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    c = _por_codigo(db, codigo)
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
def asignar(codigo: str, datos: AsignarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Mueve al prospecto a otra vacante y, si tiene CV, recalcula el match."""
    c = _por_codigo(db, codigo)
    vac = _vacante(db, datos.vacante)
    anterior = c.vacante.codigo if c.vacante else None
    c.vacante_id = vac.id

    if datos.reevaluar and c.cv_datos:
        cv = next((a for a in reversed(c.archivos) if a.tipo == "cv" and fs.existe(a.ruta)), None)
        if cv:
            with open(cv.ruta, "rb") as f:
                b64 = base64.standard_b64encode(f.read()).decode()
            datos_cv, con_ia = ia.extraer_cv(b64, cv.ruta.rsplit(".", 1)[-1], vac.titulo, vac.requisitos)
            _aplicar_cv(db, c, datos_cv, vac, con_ia)

    registrar(db, u.nombre, "candidato_reasignado", "candidato", c.codigo, {"de": anterior, "a": vac.codigo})
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Prefiltro conversacional (módulo 3.9)
# ------------------------------------------------------------


@router.get("/{codigo}/mensajes")
def mensajes(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    c = _por_codigo(db, codigo)
    return [
        {"rol": m.rol, "texto": m.texto, "canal": m.canal, "enviado": m.enviado, "ts": m.creado_en.isoformat()}
        for m in c.mensajes
    ]


class MensajeIn(BaseModel):
    texto: str
    canal: str = "simulador"  # simulador | whatsapp | web


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
    turno, con_ia = ia.prefiltro_turno(
        v.titulo if v else "vacante general",
        v.requisitos if v else "",
        (v.preguntas_filtro or []) if v else [],
        historial,
        empresa=v.empresa if v else "",
        ubicacion=v.ubicacion if v else "",
        sueldo=v.sueldo if v else "",
        modalidad=v.modalidad if v else "",
        beneficios=(v.beneficios or []) if v else [],
        perfil_ideal=v.perfil_ideal if v else "",
        nombre_candidato=c.wa_nombre or c.nombre.split(" ")[0],
    )

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

    analisis_actual = dict(c.analisis or {})
    if turno.respuestas_extraidas:
        analisis_actual["respuestas_prefiltro"] = [r.model_dump() for r in turno.respuestas_extraidas]

    clasificacion = None
    if turno.clasificacion_lista and turno.estado and not c.prefiltro_completo:
        c.estado = turno.estado
        c.score = turno.score or 0
        c.evidencia = turno.evidencia or ""
        c.prefiltro_completo = True
        analisis_actual.update({"origen": "prefiltro", "ia": con_ia})
        clasificacion = {"estado": c.estado, "score": c.score, "evidencia": c.evidencia}
        registrar(db, "agente-ia", "prefiltro_clasificado", "candidato", c.codigo, {"ia": con_ia, **clasificacion})

    c.analisis = analisis_actual
    db.commit()
    return {"respuesta": turno.respuesta, "clasificacion": clasificacion, "ia": con_ia, "whatsapp": envio}


@router.post("/{codigo}/prefiltro")
async def prefiltro(codigo: str, datos: MensajeIn, db: Session = Depends(get_db), _: Usuario = Depends(usuario_decisor)):
    c = _por_codigo(db, codigo)
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
def consentimiento(codigo: str, datos: ConsentimientoIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Deja constancia del consentimiento en la bitácora hash-encadenada."""
    c = _por_codigo(db, codigo)
    if not datos.acepta:
        c.consentimiento = False
        c.consentimiento_fecha = None
        registrar(db, u.nombre, "consentimiento_revocado", "candidato", c.codigo, {"medio": datos.medio})
        db.commit()
        return candidato_dict(c, detalle=True)

    c.consentimiento = True
    c.consentimiento_fecha = datetime.now(timezone.utc)
    registrar(
        db, u.nombre, "consentimiento_otorgado", "candidato", c.codigo,
        {"medio": datos.medio, "evidencia": datos.evidencia[:500], "correo_rh": u.correo},
    )
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Decisión humana (HITL — LFPDPPP: RH decide, la IA recomienda)
# ------------------------------------------------------------

ETAPAS = ["Prefiltro", "Entrevista", "Evaluación", "Contratación"]


class DecisionIn(BaseModel):
    accion: str  # avanzar | descartar
    comentario: str = ""


@router.post("/{codigo}/decision")
def decision(codigo: str, datos: DecisionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    c = _por_codigo(db, codigo)
    if datos.accion not in ("avanzar", "descartar"):
        raise HTTPException(400, "Acción inválida")
    if c.expediente and datos.accion == "descartar":
        raise HTTPException(
            409,
            "El candidato ya tiene expediente de contratación abierto. Cancélalo desde el módulo de contratación antes de descartarlo.",
        )

    recomendacion_ia = {"estado": c.estado, "score": c.score}
    if datos.accion == "descartar":
        c.etapa = "Prefiltro"
        c.estado = "no_cumple"
    else:
        idx = ETAPAS.index(c.etapa) if c.etapa in ETAPAS else 0
        if idx >= ETAPAS.index("Evaluación"):
            raise HTTPException(
                409,
                "Para pasar a Contratación usa «Seleccionar y crear expediente»: ahí queda registrada la autorización de RH.",
            )
        c.etapa = ETAPAS[idx + 1]

    registrar(
        db, u.nombre, f"decision_{datos.accion}", "candidato", c.codigo,
        {"recomendacion_ia": recomendacion_ia, "comentario": datos.comentario, "nueva_etapa": c.etapa, "correo_rh": u.correo},
    )
    db.commit()
    return candidato_dict(c, detalle=True)


# ------------------------------------------------------------
# Selección → inicia Módulo 2 (Contratación e integración)
# ------------------------------------------------------------


class SeleccionarIn(BaseModel):
    fecha_ingreso: Optional[str] = None  # ISO: 2026-07-28
    documentos: List[str] = []  # documentos extra además de DOCUMENTOS_BASE
    avisar_whatsapp: bool = True


@router.get("/{codigo}/expediente")
def expediente(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    c = _por_codigo(db, codigo)
    if not c.expediente:
        raise HTTPException(404, "El candidato aún no tiene expediente de contratación.")
    return expediente_dict(c.expediente)


@router.post("/{codigo}/seleccionar", status_code=201)
async def seleccionar(codigo: str, datos: SeleccionarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Puente Módulo 1 → Módulo 2: abre el expediente y pide los documentos."""
    c = _por_codigo(db, codigo)
    if c.expediente:
        raise HTTPException(409, "El candidato ya tiene expediente de contratación.")
    if not c.consentimiento:
        raise HTTPException(
            409,
            "El candidato no tiene consentimiento registrado para el tratamiento de sus datos (LFPDPPP). "
            "Regístralo antes de abrir el expediente.",
        )

    fecha = None
    if datos.fecha_ingreso:
        try:
            fecha = datetime.fromisoformat(datos.fecha_ingreso).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "fecha_ingreso inválida (usa ISO: 2026-07-28)")

    c.etapa = "Contratación"
    exp = Expediente(
        candidato_id=c.id,
        puesto=c.vacante.titulo if c.vacante else "",
        fecha_ingreso=fecha,
        seleccionado_por=u.nombre,
    )
    db.add(exp)
    db.flush()

    extra = [d.strip() for d in datos.documentos if d.strip() and d.strip() not in DOCUMENTOS_BASE]
    for tipo in DOCUMENTOS_BASE:
        db.add(Documento(expediente_id=exp.id, tipo=tipo, obligatorio=True))
    for tipo in extra:
        db.add(Documento(expediente_id=exp.id, tipo=tipo, obligatorio=True))

    registrar(
        db, u.nombre, "candidato_seleccionado", "candidato", c.codigo,
        {"expediente": exp.id, "puesto": exp.puesto, "documentos": DOCUMENTOS_BASE + extra, "correo_rh": u.correo},
    )

    # el agente informa al candidato y solicita documentos (módulo 3.11 paso 2-3)
    solicitados = ", ".join(DOCUMENTOS_BASE + extra)
    texto = (
        f"¡Felicidades {c.nombre.split(' ')[0]}! 🎉 Fuiste seleccionado(a) para {exp.puesto or 'la vacante'}. "
        f"Para tu expediente necesito foto o PDF de: {solicitados}. "
        "Puedes mandarlos por aquí uno por uno cuando gustes."
    )
    envio = {"enviado": False, "proveedor": "demo"}
    if datos.avisar_whatsapp and c.telefono:
        envio = await enviar_mensaje(c.telefono, texto)
        db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=texto, canal="whatsapp", enviado=envio["enviado"]))
    db.commit()
    return {
        "expediente_id": exp.id,
        "whatsapp": envio,
        "expediente": expediente_dict(exp),
        **candidato_dict(c, detalle=True),
    }
