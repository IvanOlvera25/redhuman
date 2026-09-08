"""Capacitación (Fase 1) — modelo real, generación con IA, ver/asignar. Sin avatar todavía:
`AsignacionCurso.token` se genera pero ninguna ruta pública lo sirve aún (eso es Fase 2)."""

import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import AsignacionCurso, Colaborador, Curso, ModuloCurso, Usuario, registrar
from ..serial import asignacion_dict, curso_dict
from ..services import ia

router = APIRouter(prefix="/capacitacion", tags=["capacitacion"])


def _por_codigo(db: Session, codigo: str) -> Curso:
    c = db.query(Curso).filter(Curso.codigo == codigo).first()
    if not c:
        raise HTTPException(404, "Curso no encontrado")
    return c


class GenerarCursoIn(BaseModel):
    tema: str
    duracion_horas: float
    categoria: str = ""
    obligatorio: bool = False


@router.post("/generar", status_code=201)
def generar(datos: GenerarCursoIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    if not datos.tema.strip():
        raise HTTPException(400, "El tema del curso es obligatorio.")

    guion, con_ia = ia.guion_curso(datos.tema.strip(), datos.duracion_horas)

    c = Curso(
        codigo="TMP",
        titulo=datos.tema.strip(),
        categoria=datos.categoria.strip(),
        duracion_horas=datos.duracion_horas,
        objetivo=guion.objetivo,
        estado="Borrador",
        obligatorio=datos.obligatorio,
        creado_por=u.nombre,
    )
    db.add(c)
    db.flush()
    c.codigo = f"CUR-{100 + c.id}"

    for i, m in enumerate(guion.modulos, start=1):
        db.add(ModuloCurso(
            curso_id=c.id,
            orden=i,
            titulo=m.titulo,
            contenido=m.contenido,
            preguntas_verificacion=[p.model_dump() for p in m.preguntas_verificacion],
        ))

    registrar(
        db, u.nombre, "curso_generado", "curso", c.codigo,
        {"tema": datos.tema, "ia": con_ia, "modulos": len(guion.modulos)},
    )
    db.commit()
    return curso_dict(c, detalle=True)


@router.get("")
def listar(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return [curso_dict(c) for c in db.query(Curso).order_by(Curso.id.desc()).all()]


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return curso_dict(_por_codigo(db, codigo), detalle=True)


@router.patch("/{codigo}/publicar")
def publicar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    c = _por_codigo(db, codigo)
    c.estado = "Publicado"
    registrar(db, u.nombre, "curso_publicado", "curso", c.codigo, {})
    db.commit()
    return curso_dict(c, detalle=True)


class AsignarCursoIn(BaseModel):
    colaborador_ids: List[str]  # códigos de Colaborador (p.ej. "COL-12"), no ids numéricos


@router.post("/{codigo}/asignar", status_code=201)
def asignar(codigo: str, datos: AsignarCursoIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    curso = _por_codigo(db, codigo)
    if curso.estado != "Publicado":
        raise HTTPException(409, "Solo se pueden asignar cursos publicados.")
    if not datos.colaborador_ids:
        raise HTTPException(400, "Selecciona al menos un colaborador.")

    resultado: List[AsignacionCurso] = []
    encontrados: List[str] = []
    for cod_col in datos.colaborador_ids:
        col = db.query(Colaborador).filter(Colaborador.codigo == cod_col).first()
        if not col:
            continue
        encontrados.append(cod_col)

        # Idempotente: si ya tiene una asignación activa (no completada) de este curso, se reusa
        # en vez de duplicarla — evita ligas repetidas si RH reintenta o hace doble clic.
        existente = (
            db.query(AsignacionCurso)
            .filter(
                AsignacionCurso.curso_id == curso.id,
                AsignacionCurso.colaborador_id == col.id,
                AsignacionCurso.estado != "completado",
            )
            .first()
        )
        if existente:
            resultado.append(existente)
            continue

        a = AsignacionCurso(codigo="TMP", curso_id=curso.id, colaborador_id=col.id, token=secrets.token_urlsafe(24))
        db.add(a)
        db.flush()
        a.codigo = f"ASIG-{5000 + a.id}"
        resultado.append(a)

    if not encontrados:
        raise HTTPException(404, "Ninguno de los colaboradores indicados existe.")

    registrar(db, u.nombre, "curso_asignado", "curso", curso.codigo, {"colaboradores": encontrados})
    db.commit()
    return [asignacion_dict(a) for a in resultado]


@router.get("/{codigo}/asignaciones")
def asignaciones(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    curso = _por_codigo(db, codigo)
    filas = (
        db.query(AsignacionCurso)
        .filter(AsignacionCurso.curso_id == curso.id)
        .order_by(AsignacionCurso.id.desc())
        .all()
    )
    return [asignacion_dict(a) for a in filas]
