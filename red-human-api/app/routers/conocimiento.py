"""Base de conocimiento con RAG (2026-09-18) — ver services/rag.py.

Documentos de la Cuenta (políticas, procesos, manuales, reglamentos, FAQ) que se indexan en fragmentos con
embedding; las preguntas se responden SOLO con esa evidencia, con fuentes citadas. Sustituye al Q&A de
maqueta (respuestas quemadas) que tenía el frontend."""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import Colaborador, TIPOS_CONOCIMIENTO, ConsultaConocimiento, Cuenta, DocumentoConocimiento, Usuario, registrar
from ..serial import iso
from ..services import archivos as fs
from ..services import ia, rag

def _requiere_rag() -> None:
    """Hotfix 2026-09-18: si las tablas no se pudieron crear al arrancar, el módulo responde 503 con el
    motivo en vez de tumbar la API."""
    if not rag.disponible():
        raise HTTPException(503, f"La Base de Conocimiento no está disponible en este servidor: {rag.error_inicializacion() or 'tablas no inicializadas'}. Revisa el log de arranque de la API.")


router = APIRouter(prefix="/conocimiento", tags=["conocimiento"], dependencies=[Depends(_requiere_rag)])

MAX_ARCHIVO = 15 * 1024 * 1024


def _doc_dict(d: DocumentoConocimiento) -> dict:
    return {
        "id": d.id,
        "titulo": d.titulo,
        "tipo": d.tipo,
        "nombreArchivo": d.nombre_archivo,
        "caracteres": len(d.texto or ""),
        "fragmentos": d.fragmentos_total,
        "conEmbeddings": d.con_embeddings,
        "activo": d.activo,
        # 2026-09-22 (permisos con la base maestra): publicado + a qué áreas/puestos se les muestra
        "publicado": bool(d.publicado),
        "areas": list(d.areas or []),
        "puestos": list(d.puestos or []),
        "creadoPor": d.creado_por,
        "creadoEn": iso(d.creado_en),
        "extracto": (d.texto or "")[:220],
    }


def _doc(db: Session, doc_id: int, cuenta_id: int) -> DocumentoConocimiento:
    d = db.query(DocumentoConocimiento).filter(DocumentoConocimiento.id == doc_id, DocumentoConocimiento.cuenta_id == cuenta_id).first()
    if not d:
        raise HTTPException(404, "Documento no encontrado")
    return d


@router.get("/documentos")
def listar(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    docs = db.query(DocumentoConocimiento).filter(DocumentoConocimiento.cuenta_id == cuenta.id, DocumentoConocimiento.activo.is_(True)).order_by(DocumentoConocimiento.id.desc()).all()
    return [_doc_dict(d) for d in docs]


@router.get("/estado")
def estado(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    docs = db.query(DocumentoConocimiento).filter(DocumentoConocimiento.cuenta_id == cuenta.id, DocumentoConocimiento.activo.is_(True)).all()
    consultas = db.query(ConsultaConocimiento).filter(ConsultaConocimiento.cuenta_id == cuenta.id).count()
    sin_ev = db.query(ConsultaConocimiento).filter(ConsultaConocimiento.cuenta_id == cuenta.id, ConsultaConocimiento.sin_evidencia.is_(True)).count()
    return {
        "disponible": rag.disponible(),
        "documentos": len(docs),
        "fragmentos": sum(d.fragmentos_total for d in docs),
        "semantico": ia.ia_activa() and any(d.con_embeddings for d in docs),
        "iaActiva": ia.ia_activa(),
        "consultas": consultas,
        "consultasSinEvidencia": sin_ev,
        "tipos": TIPOS_CONOCIMIENTO,
    }


@router.post("/documentos", status_code=201)
async def subir(
    titulo: str = Form(default=""),
    tipo: str = Form(default="politica"),
    texto: str = Form(default=""),
    archivos: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Carga uno o varios archivos (PDF/TXT/MD/CSV) o un texto pegado; cada uno se indexa al instante."""
    if tipo not in TIPOS_CONOCIMIENTO:
        tipo = "otro"
    creados: List[DocumentoConocimiento] = []
    if texto.strip():
        if not titulo.strip():
            raise HTTPException(400, "Ponle un título al texto.")
        d = DocumentoConocimiento(cuenta_id=cuenta.id, titulo=titulo.strip()[:200], tipo=tipo, texto=texto.strip(), creado_por=u.nombre)
        db.add(d)
        db.flush()
        rag.indexar_documento(db, d)
        creados.append(d)
    for archivo in archivos:
        contenido = await archivo.read()
        if not contenido:
            continue
        if len(contenido) > MAX_ARCHIVO:
            raise HTTPException(413, f"«{archivo.filename}» pesa más de 15 MB.")
        try:
            extraido = rag.extraer_texto(archivo.filename or "", contenido)
        except Exception as ex:  # noqa: BLE001
            raise HTTPException(400, f"No se pudo leer «{archivo.filename}»: {ex}")
        if not extraido.strip():
            raise HTTPException(400, f"«{archivo.filename}» no tiene texto legible (usa PDF con texto, TXT o Markdown; un PDF escaneado no sirve).")
        ruta = fs.guardar_bytes(contenido, f"conocimiento/{cuenta.id}", archivo.filename or "documento")
        nombre_base = (archivo.filename or "documento").rsplit(".", 1)[0]
        d = DocumentoConocimiento(
            cuenta_id=cuenta.id, titulo=(titulo.strip() if titulo.strip() and len(archivos) == 1 else nombre_base)[:200],
            tipo=tipo, nombre_archivo=archivo.filename or "", ruta=ruta, texto=extraido, creado_por=u.nombre,
        )
        db.add(d)
        db.flush()
        rag.indexar_documento(db, d)
        creados.append(d)
    if not creados:
        raise HTTPException(400, "Sube al menos un archivo o pega un texto.")
    for d in creados:
        registrar(db, u.nombre, "conocimiento_documento_cargado", "documento_conocimiento", str(d.id), {"titulo": d.titulo, "fragmentos": d.fragmentos_total, "embeddings": d.con_embeddings})
    db.commit()
    return [_doc_dict(d) for d in creados]


class GenerarDocIn(BaseModel):
    tema: str
    tipo: str = "politica"
    notas: str = ""


@router.post("/generar")
def generar(datos: GenerarDocIn, _: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Generar con Red Human»: redacta un BORRADOR editable (no lo guarda ni lo publica). RH revisa,
    completa lo marcado como «[por definir]», define accesos y hasta entonces lo publica."""
    if not datos.tema.strip():
        raise HTTPException(400, "Dime de qué trata el documento.")
    borrador, con_ia = ia.borrador_conocimiento(datos.tema, datos.tipo, datos.notas, empresa=cuenta.nombre_visible)
    return {"titulo": borrador.titulo, "texto": borrador.texto, "avisos": list(borrador.avisos or []), "generadoConIa": con_ia}


class PermisosDocIn(BaseModel):
    publicado: Optional[bool] = None
    areas: Optional[List[str]] = None    # vacío = todas las áreas
    puestos: Optional[List[str]] = None  # vacío = todos los puestos


@router.patch("/documentos/{doc_id}/permisos")
def permisos(doc_id: int, datos: PermisosDocIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """2026-09-22 — quién puede ver este documento, con las ÁREAS y PUESTOS de `colaboradores` (base
    maestra; este módulo nunca define su propio padrón de personas). Sin áreas ni puestos = toda la
    empresa. Un documento NO publicado solo lo ve RH y la IA jamás lo usa para responder."""
    d = _doc(db, doc_id, cuenta.id)
    if datos.publicado is not None:
        d.publicado = bool(datos.publicado)
    if datos.areas is not None:
        d.areas = [a.strip() for a in datos.areas if a.strip()]
    if datos.puestos is not None:
        d.puestos = [p.strip() for p in datos.puestos if p.strip()]
    registrar(db, u.nombre, "conocimiento_permisos", "conocimiento", str(d.id),
              {"documento": d.titulo, "publicado": d.publicado, "areas": d.areas, "puestos": d.puestos, "correo_rh": u.correo})
    db.commit()
    return _doc_dict(d)


@router.get("/areas")
def areas_y_puestos(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Opciones REALES para los permisos: áreas y puestos que existen hoy en el roster de colaboradores."""
    filas = db.query(Colaborador.area, Colaborador.puesto).filter(
        Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None), Colaborador.activo.is_(True)
    ).all()
    areas = sorted({(a or "").strip() for a, _ in filas if (a or "").strip()})
    puestos = sorted({(p or "").strip() for _, p in filas if (p or "").strip()})
    return {"areas": areas, "puestos": puestos}


@router.post("/documentos/{doc_id}/reindexar")
def reindexar(doc_id: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    d = _doc(db, doc_id, cuenta.id)
    n = rag.indexar_documento(db, d)
    registrar(db, u.nombre, "conocimiento_documento_reindexado", "documento_conocimiento", str(d.id), {"fragmentos": n})
    db.commit()
    return _doc_dict(d)


@router.delete("/documentos/{doc_id}")
def eliminar(doc_id: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Baja lógica: deja de responder con él; el archivo y el texto se conservan."""
    d = _doc(db, doc_id, cuenta.id)
    d.activo = False
    registrar(db, u.nombre, "conocimiento_documento_eliminado", "documento_conocimiento", str(d.id), {"titulo": d.titulo})
    db.commit()
    return {"ok": True}


@router.get("/buscar")
def buscar(q: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Búsqueda semántica directa (sin redacción): los fragmentos más relevantes con su documento."""
    if not q.strip():
        return {"modo": "sin_consulta", "resultados": []}
    frags, modo = rag.buscar(db, cuenta.id, q.strip())  # RH: solo publicados (ver rag.buscar)
    return {"modo": modo, "resultados": [f.model_dump() for f in frags]}


class PreguntaIn(BaseModel):
    pregunta: str
    historial: Optional[List[dict]] = None  # [{rol, texto}] turnos previos del chat
    # 2026-09-22: si la pregunta es «como» un colaborador (código COL-####), la IA solo usa los
    # documentos publicados que su área/puesto puede ver. Sin código = sesión de RH (ve todo lo publicado).
    colaborador_id: Optional[str] = None


@router.post("/preguntar")
def preguntar(datos: PreguntaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    pregunta = datos.pregunta.strip()
    if not pregunta:
        raise HTTPException(400, "Escribe una pregunta.")
    col = None
    if datos.colaborador_id:
        col = db.query(Colaborador).filter(
            Colaborador.codigo == datos.colaborador_id, Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None)
        ).first()
        if not col:
            raise HTTPException(404, "Ese colaborador no existe en el roster.")
    respuesta, frags, modo, con_ia = rag.responder(db, cuenta.id, pregunta, datos.historial, empresa=cuenta.nombre_visible, colaborador=col)
    db.add(ConsultaConocimiento(cuenta_id=cuenta.id, usuario=u.nombre, pregunta=pregunta, respuesta=respuesta.model_dump(), sin_evidencia=respuesta.sin_evidencia, modo=modo))
    db.commit()
    return {
        **respuesta.model_dump(),
        "ia": con_ia,
        "modo": modo,
        "fragmentos": [{"documentoId": f.documento_id, "documento": f.documento, "tipo": f.tipo, "orden": f.orden, "puntaje": f.puntaje, "texto": f.texto[:400]} for f in frags],
        "creadoEn": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/consultas")
def consultas(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Últimas preguntas: las «sin evidencia» son las políticas que faltan documentar."""
    filas = db.query(ConsultaConocimiento).filter(ConsultaConocimiento.cuenta_id == cuenta.id).order_by(ConsultaConocimiento.id.desc()).limit(50).all()
    return [{"id": c.id, "usuario": c.usuario, "pregunta": c.pregunta, "sinEvidencia": c.sin_evidencia, "modo": c.modo, "creadoEn": iso(c.creado_en)} for c in filas]
