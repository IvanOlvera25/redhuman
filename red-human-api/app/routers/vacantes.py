"""Módulo 1 · Reclutamiento — Vacantes y distribuidor (3.4, 3.5).

El generador produce, en una sola llamada, el contenido base de la vacante y la
publicación adaptada a cada plataforma (WhatsApp, OCC, LinkedIn y portal propio),
cada una con su `copy` (difusión) y su `page` (cuerpo listo para pegar).
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import PLATAFORMAS, Candidato, Usuario, Vacante, registrar, slugificar
from ..serial import vacante_dict
from ..services import ia

router = APIRouter(prefix="/vacantes", tags=["vacantes"])

ESTADOS = ["Borrador", "En revisión", "Publicada", "Cerrada"]


def _por_codigo(db: Session, codigo: str) -> Vacante:
    v = db.query(Vacante).filter(Vacante.codigo == codigo).first()
    if not v:
        raise HTTPException(404, "Vacante no encontrada")
    return v


def _slug_unico(db: Session, titulo: str, vacante_id: int) -> str:
    base = slugificar(titulo)
    tomado = (
        db.query(Vacante.id)
        .filter(Vacante.slug == base, Vacante.id != vacante_id)
        .first()
    )
    return f"{base}-{vacante_id}" if tomado else base


def _embudo(db: Session, vacante_id: int) -> dict:
    """Conteo por etapa y por clasificación del agente — alimenta la tarjeta de la vacante."""
    filas = (
        db.query(Candidato.etapa, Candidato.estado, func.count(Candidato.id))
        .filter(Candidato.vacante_id == vacante_id)
        .group_by(Candidato.etapa, Candidato.estado)
        .all()
    )
    etapas: Dict[str, int] = {}
    estados: Dict[str, int] = {}
    for etapa, estado, n in filas:
        etapas[etapa] = etapas.get(etapa, 0) + n
        estados[estado] = estados.get(estado, 0) + n
    return {"etapas": etapas, "estados": estados}


def _conteos(db: Session, v: Vacante):
    total = db.query(Candidato).filter(Candidato.vacante_id == v.id).count()
    hace_24h = datetime.now(timezone.utc) - timedelta(days=1)
    nuevos = db.query(Candidato).filter(Candidato.vacante_id == v.id, Candidato.creado_en >= hace_24h).count()
    return total, nuevos


def _salida(db: Session, v: Vacante) -> dict:
    total, nuevos = _conteos(db, v)
    return vacante_dict(v, total, nuevos, _embudo(db, v.id))


@router.get("")
def listar(estado: Optional[str] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    q = db.query(Vacante).order_by(Vacante.id.desc())
    if estado:
        q = q.filter(Vacante.estado == estado)
    return [_salida(db, v) for v in q.all()]


# ------------------------------------------------------------
# Generador con IA (no persiste — RH revisa antes de guardar)
# ------------------------------------------------------------


class GenerarIn(BaseModel):
    titulo: str
    area: str = ""
    ubicacion: str = ""
    sueldo: str = "A convenir"
    requisitos: str = ""
    empresa: str = "Grupo Carbe"
    modalidad: str = "Presencial"
    notas: str = ""


def _generar(datos: GenerarIn):
    if not datos.titulo.strip():
        raise HTTPException(400, "El título del puesto es obligatorio para generar la publicación.")
    return ia.generar_vacante(
        datos.titulo, datos.area, datos.ubicacion, datos.sueldo,
        datos.requisitos, datos.empresa, datos.modalidad, datos.notas,
    )


@router.post("/generar")
def generar(datos: GenerarIn, _: Usuario = Depends(usuario_decisor)):
    """Genera contenido base + publicación por plataforma + criterios de prefiltro."""
    resultado, con_ia = _generar(datos)
    return {"ia": con_ia, **resultado.model_dump(by_alias=True)}


def _aplicar_generado(v: Vacante, g: ia.VacanteGenerada) -> None:
    """Vuelca la salida del generador sobre la vacante."""
    v.resumen = g.resumen
    v.descripcion = g.descripcion
    v.perfil_ideal = g.perfil_ideal
    v.responsabilidades = g.responsabilidades
    v.requisitos_deseables = g.requisitos_deseables
    v.beneficios = g.beneficios
    v.palabras_clave = g.palabras_clave
    v.seniority = g.seniority
    v.avisos_cumplimiento = g.avisos_cumplimiento
    v.texto_whatsapp = g.texto_whatsapp
    v.texto_bolsa = g.occ.page  # compatibilidad con la forma anterior
    v.preguntas_filtro = [p.model_dump() for p in g.preguntas_filtro]
    v.publicaciones = {
        "whatsapp": {"titulo": v.titulo, "copy": g.texto_whatsapp, "page": g.texto_whatsapp, "etiquetas": []},
        "occ": g.occ.bloque(),
        "linkedin": g.linkedin.bloque(),
        "portal": g.portal.bloque(),
    }
    if not v.requisitos and g.requisitos_indispensables:
        v.requisitos = " · ".join(g.requisitos_indispensables)


# ------------------------------------------------------------
# Alta y edición
# ------------------------------------------------------------


class CrearIn(GenerarIn):
    descripcion: str = ""
    texto_whatsapp: str = ""
    texto_bolsa: str = ""
    preguntas_filtro: List[dict] = []
    publicaciones: Dict[str, dict] = {}
    resumen: str = ""
    perfil_ideal: str = ""
    responsabilidades: List[str] = []
    requisitos_deseables: List[str] = []
    beneficios: List[str] = []
    palabras_clave: List[str] = []
    seniority: str = ""
    avisos_cumplimiento: List[str] = []
    publicar: bool = False
    plataformas: List[str] = []
    generar_si_falta: bool = True  # si no llega contenido, lo genera antes de guardar


@router.post("", status_code=201)
def crear(datos: CrearIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    if not datos.titulo.strip():
        raise HTTPException(400, "El título del puesto es obligatorio.")

    plataformas = [p for p in datos.plataformas if p in PLATAFORMAS]
    if datos.publicar and not plataformas:
        plataformas = ["WhatsApp", "Portal"]

    v = Vacante(
        codigo="TMP",
        titulo=datos.titulo.strip(),
        area=datos.area,
        empresa=datos.empresa,
        ubicacion=datos.ubicacion,
        modalidad=datos.modalidad,
        sueldo=datos.sueldo,
        estado="Publicada" if datos.publicar else "Borrador",
        requisitos=datos.requisitos,
        descripcion=datos.descripcion,
        texto_whatsapp=datos.texto_whatsapp,
        texto_bolsa=datos.texto_bolsa,
        preguntas_filtro=datos.preguntas_filtro,
        plataformas=plataformas if datos.publicar else [],
        resumen=datos.resumen,
        perfil_ideal=datos.perfil_ideal,
        responsabilidades=datos.responsabilidades,
        requisitos_deseables=datos.requisitos_deseables,
        beneficios=datos.beneficios,
        palabras_clave=datos.palabras_clave,
        seniority=datos.seniority,
        avisos_cumplimiento=datos.avisos_cumplimiento,
        publicaciones=datos.publicaciones,
    )

    con_ia = None
    if datos.generar_si_falta and not datos.publicaciones and not datos.descripcion:
        generado, con_ia = _generar(GenerarIn(**datos.model_dump(include=set(GenerarIn.model_fields))))
        _aplicar_generado(v, generado)

    db.add(v)
    db.flush()
    v.codigo = f"VAC-{1036 + v.id}"
    v.slug = _slug_unico(db, v.titulo, v.id)
    registrar(
        db, u.nombre, "vacante_creada", "vacante", v.codigo,
        {"titulo": v.titulo, "estado": v.estado, "ia": con_ia, "plataformas": v.plataformas},
    )
    db.commit()
    return _salida(db, v)


@router.get("/slug/{slug}")
def por_slug(slug: str, db: Session = Depends(get_db)):
    """Vacante para la página pública de postulación (/aplicar/[slug])."""
    v = db.query(Vacante).filter(Vacante.slug == slug).first()
    if not v:
        raise HTTPException(404, "Vacante no encontrada")
    if v.estado != "Publicada":
        raise HTTPException(410, "Esta vacante ya no está recibiendo postulaciones.")
    return _salida(db, v)


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return _salida(db, _por_codigo(db, codigo))


class ActualizarIn(BaseModel):
    titulo: Optional[str] = None
    area: Optional[str] = None
    empresa: Optional[str] = None
    ubicacion: Optional[str] = None
    modalidad: Optional[str] = None
    sueldo: Optional[str] = None
    requisitos: Optional[str] = None
    descripcion: Optional[str] = None
    resumen: Optional[str] = None
    perfil_ideal: Optional[str] = None
    responsabilidades: Optional[List[str]] = None
    requisitos_deseables: Optional[List[str]] = None
    beneficios: Optional[List[str]] = None
    palabras_clave: Optional[List[str]] = None
    seniority: Optional[str] = None
    texto_whatsapp: Optional[str] = None
    preguntas_filtro: Optional[List[dict]] = None
    publicaciones: Optional[Dict[str, dict]] = None
    estado: Optional[str] = None


@router.patch("/{codigo}")
def actualizar(codigo: str, datos: ActualizarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Edición manual de RH sobre lo que generó la IA (el agente propone, RH dispone)."""
    v = _por_codigo(db, codigo)
    cambios = datos.model_dump(exclude_none=True, exclude={"autor"})
    if datos.estado is not None and datos.estado not in ESTADOS:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS)}")

    for campo, valor in cambios.items():
        setattr(v, campo, valor)
    if datos.titulo:
        v.slug = _slug_unico(db, v.titulo, v.id)
    if datos.publicaciones:
        v.texto_bolsa = (datos.publicaciones.get("occ") or {}).get("page", v.texto_bolsa)

    registrar(db, u.nombre, "vacante_editada", "vacante", v.codigo, {"campos": sorted(cambios)})
    db.commit()
    return _salida(db, v)


class RegenerarIn(BaseModel):
    notas: str = ""


@router.post("/{codigo}/regenerar")
def regenerar(codigo: str, datos: RegenerarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    """Vuelve a generar todo el contenido de una vacante existente con los datos ya capturados."""
    v = _por_codigo(db, codigo)
    generado, con_ia = ia.generar_vacante(
        v.titulo, v.area, v.ubicacion, v.sueldo, v.requisitos, v.empresa, v.modalidad, datos.notas
    )
    _aplicar_generado(v, generado)
    registrar(db, u.nombre, "vacante_regenerada", "vacante", v.codigo, {"ia": con_ia, "notas": datos.notas})
    db.commit()
    return {"ia": con_ia, **_salida(db, v)}


# ------------------------------------------------------------
# Distribución
# ------------------------------------------------------------


class PublicarIn(BaseModel):
    plataformas: List[str] = ["WhatsApp", "Portal"]


@router.post("/{codigo}/publicar")
def publicar(codigo: str, datos: PublicarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    v = _por_codigo(db, codigo)
    plataformas = [p for p in datos.plataformas if p in PLATAFORMAS]
    if not plataformas:
        raise HTTPException(400, f"Elige al menos una plataforma válida: {', '.join(PLATAFORMAS)}")
    if not (v.publicaciones or v.descripcion):
        raise HTTPException(409, "La vacante no tiene contenido. Genera la publicación antes de distribuirla.")

    v.estado = "Publicada"
    v.plataformas = sorted(set((v.plataformas or []) + plataformas), key=PLATAFORMAS.index)
    if not v.slug:
        v.slug = _slug_unico(db, v.titulo, v.id)
    registrar(db, u.nombre, "vacante_publicada", "vacante", v.codigo, {"plataformas": v.plataformas})
    db.commit()
    return _salida(db, v)


@router.post("/{codigo}/cerrar")
def cerrar(codigo: str, datos: PublicarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    v = _por_codigo(db, codigo)
    v.estado = "Cerrada"
    v.plataformas = []
    registrar(db, u.nombre, "vacante_cerrada", "vacante", v.codigo, {})
    db.commit()
    return _salida(db, v)


@router.get("/{codigo}/publicacion/{plataforma}")
def publicacion(codigo: str, plataforma: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """Texto listo para copiar y pegar en la plataforma indicada, con la liga de postulación."""
    v = _por_codigo(db, codigo)
    clave = plataforma.lower()
    bloque = (v.publicaciones or {}).get(clave)
    if not bloque:
        raise HTTPException(404, f"La vacante no tiene publicación generada para '{plataforma}'. Usa /regenerar.")
    liga = f"{settings.app_url}/aplicar/{v.slug or slugificar(v.titulo)}"
    return {
        "plataforma": clave,
        "vacante": v.codigo,
        "liga": liga,
        "titulo": bloque.get("titulo", v.titulo),
        "copy": bloque.get("copy", ""),
        "page": bloque.get("page", ""),
        "etiquetas": bloque.get("etiquetas", []),
        # el copy con la liga ya incrustada, que es lo que RH pega en la plataforma
        "copyConLiga": f"{bloque.get('copy', '')}\n\n👉 Postúlate aquí: {liga}".strip(),
    }
