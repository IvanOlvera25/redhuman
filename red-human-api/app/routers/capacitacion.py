"""Capacitación — Fase 1 (modelo, generación con IA, ver/asignar) y Fase 2 (sala pública con
avatar, módulo por módulo — rutas `/publica/{token}/...`, mismo patrón que entrevistas.py)."""

import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import usuario_actual, usuario_decisor
from ..models import AsignacionCurso, Colaborador, Curso, ModuloCurso, Usuario, registrar
from ..serial import asignacion_dict, asignacion_publica_dict, curso_dict, hace, iso
from ..services import ia
from ..services.avatar import crear_sesion_avatar
from ..services.correo import enviar_correo
from ..services.whatsapp import enviar_mensaje

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


@router.get("/kpis")
def kpis(db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """KPIs globales del dashboard — antes de la ruta /{codigo} a propósito: 'kpis' no es un
    código de curso válido, pero si esta ruta se registrara después, /{codigo} la interceptaría
    primero (mismo cuidado que con /prueba/eliminar en candidatos.py)."""
    cursos = db.query(Curso).all()
    asignaciones = db.query(AsignacionCurso).all()
    completadas = [a for a in asignaciones if a.estado == "completado"]

    cursos_activos = sum(1 for c in cursos if c.estado == "Publicado")
    en_formacion = sum(1 for a in asignaciones if a.estado in ("pendiente", "en_curso"))
    tasa_finalizacion = round(len(completadas) / len(asignaciones) * 100) if asignaciones else 0
    horas_impartidas = sum((a.curso.duracion_horas if a.curso else 0) for a in completadas)

    return {
        "cursosActivos": cursos_activos,
        "colaboradoresEnFormacion": en_formacion,
        "tasaFinalizacionGlobal": tasa_finalizacion,
        "horasImpartidas": round(horas_impartidas, 1),
    }


@router.get("/{codigo}")
def detalle(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    return curso_dict(_por_codigo(db, codigo), detalle=True)


@router.get("/{codigo}/reporte")
def reporte(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """Vista agregada del curso: avance por estado, tasa de finalización, duración promedio
    real, % de comprensión por módulo (primer y único intento — no hay mecanismo de reintento),
    y el detalle por colaborador para la sección "Progreso" del panel."""
    curso = _por_codigo(db, codigo)
    asignaciones = db.query(AsignacionCurso).filter(AsignacionCurso.curso_id == curso.id).all()

    total = len(asignaciones)
    completadas = [a for a in asignaciones if a.estado == "completado"]
    en_curso = sum(1 for a in asignaciones if a.estado == "en_curso")
    pendientes = sum(1 for a in asignaciones if a.estado == "pendiente")

    duraciones_horas = []
    for a in completadas:
        if a.asignado_en and a.completado_en:
            inicio = a.asignado_en if a.asignado_en.tzinfo else a.asignado_en.replace(tzinfo=timezone.utc)
            fin = a.completado_en if a.completado_en.tzinfo else a.completado_en.replace(tzinfo=timezone.utc)
            duraciones_horas.append((fin - inicio).total_seconds() / 3600)
    duracion_promedio = round(sum(duraciones_horas) / len(duraciones_horas), 1) if duraciones_horas else None

    por_modulo = []
    for m in sorted(curso.modulos, key=lambda m: m.orden):
        evaluados = 0
        comprendieron = 0
        for a in asignaciones:
            entradas = (a.resultado_evaluacion or {}).get("modulos", [])
            entrada = next((e for e in entradas if e.get("modulo") == m.orden), None)
            if entrada is not None:
                evaluados += 1
                if entrada.get("comprendio"):
                    comprendieron += 1
        por_modulo.append({
            "orden": m.orden,
            "titulo": m.titulo,
            "totalEvaluados": evaluados,
            "comprendioPct": round(comprendieron / evaluados * 100) if evaluados else None,
        })

    colaboradores = []
    for a in sorted(asignaciones, key=lambda a: a.id, reverse=True):
        col = a.colaborador
        colaboradores.append({
            "asignacionId": a.codigo,
            "colaboradorId": col.codigo if col else "",
            "colaboradorNombre": col.nombre if col else "",
            "estado": a.estado,
            "moduloActual": a.modulo_actual,
            "asignado": hace(a.asignado_en),
            "completado": iso(a.completado_en),
            "resultadoEvaluacion": a.resultado_evaluacion or None,
        })

    return {
        "totalAsignados": total,
        "completados": len(completadas),
        "enCurso": en_curso,
        "pendientes": pendientes,
        "tasaFinalizacion": round(len(completadas) / total * 100) if total else 0,
        "duracionPromedioHoras": duracion_promedio,
        "porModulo": por_modulo,
        "colaboradores": colaboradores,
    }


@router.patch("/{codigo}/publicar")
def publicar(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    c = _por_codigo(db, codigo)
    c.estado = "Publicado"
    registrar(db, u.nombre, "curso_publicado", "curso", c.codigo, {})
    db.commit()
    return curso_dict(c, detalle=True)


class AsignarCursoIn(BaseModel):
    colaborador_ids: List[str]  # códigos de Colaborador (p.ej. "COL-12"), no ids numéricos


def _html_correo_asignacion(col: Colaborador, curso: Curso, liga: str) -> str:
    primer_nombre = col.nombre.split(" ")[0] if col.nombre else "colaborador(a)"
    return (
        f"<p>¡Hola {primer_nombre}!</p>"
        f"<p>Te asignamos el curso <strong>{curso.titulo}</strong> "
        f"(duración aproximada: {curso.duracion_horas} horas).</p>"
        f"<p>Puedes comenzarlo cuando gustes desde esta liga: <a href=\"{liga}\">{liga}</a></p>"
        "<p>Saludos,<br>Red Human AI</p>"
    )


@router.post("/{codigo}/asignar", status_code=201)
async def asignar(codigo: str, datos: AsignarCursoIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor)):
    curso = _por_codigo(db, codigo)
    if curso.estado != "Publicado":
        raise HTTPException(409, "Solo se pueden asignar cursos publicados.")
    if not datos.colaborador_ids:
        raise HTTPException(400, "Selecciona al menos un colaborador.")

    resultado: List[AsignacionCurso] = []
    encontrados: List[str] = []
    nuevas: List[AsignacionCurso] = []
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
        nuevas.append(a)

    if not encontrados:
        raise HTTPException(404, "Ninguno de los colaboradores indicados existe.")

    # Aviso por WhatsApp y correo — solo para asignaciones NUEVAS (si ya estaba asignado, no se
    # reavisa en un reintento/doble clic; ver el guard de arriba). Ninguno de los dos envíos debe
    # tumbar el 201: mismo try/except que ya se usa en programar_entrevista_humana.
    notificaciones = []
    for a in nuevas:
        col = a.colaborador
        liga = f"{settings.app_url}/capacitacion/{a.token}"
        primer_nombre = col.nombre.split(" ")[0] if col.nombre else "colaborador(a)"
        texto = (
            f"¡Hola {primer_nombre}! 📚 Te asignamos el curso *{curso.titulo}* "
            f"(duración aprox. {curso.duracion_horas} h). Puedes comenzarlo cuando gustes en esta liga: {liga}"
        )

        envio_whatsapp = {"enviado": False, "proveedor": "demo", "detalle": "sin teléfono"}
        if col.telefono:
            try:
                envio_whatsapp = await enviar_mensaje(col.telefono, texto)
            except Exception as ex:  # que WhatsApp falle no debe tumbar la asignación
                print(f"[whatsapp-send-error] asignar_curso -> {a.codigo}: {ex}")
                envio_whatsapp = {"enviado": False, "proveedor": "error", "detalle": str(ex)}

        try:
            envio_correo = await enviar_correo(
                col.correo, f"Nuevo curso asignado: {curso.titulo}", _html_correo_asignacion(col, curso, liga),
            )
        except Exception as ex:  # que Resend falle no debe tumbar la asignación
            print(f"[correo-send-error] asignar_curso -> {a.codigo}: {ex}")
            envio_correo = {"enviado": False, "proveedor": "error", "detalle": str(ex)}

        notificaciones.append({
            "colaborador": col.codigo,
            "asignacion": a.codigo,
            "whatsapp": envio_whatsapp,
            "correo": envio_correo,
        })

    registrar(
        db, u.nombre, "curso_asignado", "curso", curso.codigo,
        {"colaboradores": encontrados, "notificaciones": notificaciones},
    )
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


# ------------------------------------------------------------
# Fase 2 — sala pública: la persona asignada toma el curso con el avatar, módulo por módulo.
# Sin auth (como /entrevistas/publica/{token}): el token es la credencial.
# ------------------------------------------------------------


def _asignacion_por_token(db: Session, token: str) -> AsignacionCurso:
    a = db.query(AsignacionCurso).filter(AsignacionCurso.token == token).first()
    if not a:
        raise HTTPException(404, "Asignación no encontrada")
    return a


def _modulos_ordenados(a: AsignacionCurso) -> List[ModuloCurso]:
    return sorted(a.curso.modulos, key=lambda m: m.orden) if a.curso else []


def _modulo_actual(a: AsignacionCurso) -> ModuloCurso:
    modulos = _modulos_ordenados(a)
    if a.modulo_actual >= len(modulos):
        raise HTTPException(409, "No quedan módulos pendientes en este curso.")
    return modulos[a.modulo_actual]


def _prompt_modulo(a: AsignacionCurso, m: ModuloCurso, total: int) -> str:
    preguntas = "\n".join(f"- {p['pregunta']}" for p in (m.preguntas_verificacion or []))
    nombre = a.colaborador.nombre.split(" ")[0] if a.colaborador else "la persona"
    return (
        f"Eres un instructor virtual de Red Human AI (México) impartiendo el curso "
        f"«{a.curso.titulo if a.curso else ''}» a {nombre}. Estás en el módulo «{m.titulo}» "
        f"({m.orden} de {total}).\n\n"
        f"Contenido que debes explicar:\n{m.contenido}\n\n"
        "Instrucciones: (1) explica este contenido de forma conversacional, cálida y clara, en "
        "español mexicano — no lo leas tal cual, adáptalo como si fueras un instructor hablando; "
        "(2) puedes dividirlo en varios mensajes cortos, no lo digas todo de una vez; (3) AL "
        "TERMINAR de explicar todo el contenido, haz esta(s) pregunta(s) de verificación, una a "
        f"la vez, y espera la respuesta antes de la siguiente:\n{preguntas}\n"
        "(4) NO des por terminado el módulo sin haber hecho todas las preguntas y recibido una "
        "respuesta a cada una; (5) en cuanto ya hayas hecho todas las preguntas y la persona haya "
        "respondido, dile explícitamente que ya puede dar clic en 'Continuar' para seguir; "
        "(6) nunca pidas ni menciones datos sensibles (salud, embarazo, religión, estado civil, "
        "orientación)."
    )


@router.get("/publica/{token}")
def publica(token: str, db: Session = Depends(get_db)):
    a = _asignacion_por_token(db, token)
    return asignacion_publica_dict(a)


@router.post("/publica/{token}/sesion")
async def sesion(token: str, db: Session = Depends(get_db)):
    """Crea (o reinicia, para el módulo que toque) la sesión del avatar — token de Anam, o modo
    texto si no hay clave. El frontend la vuelve a llamar después de cada /avanzar exitoso."""
    a = _asignacion_por_token(db, token)
    if a.estado == "completado":
        raise HTTPException(409, "Este curso ya fue completado.")

    modulos = _modulos_ordenados(a)
    m = _modulo_actual(a)
    a.estado = "en_curso"

    saludo = f"¡Hola! Vamos a ver el módulo «{m.titulo}» del curso «{a.curso.titulo if a.curso else ''}»."
    prompt = _prompt_modulo(a, m, len(modulos))

    ses = None
    try:
        ses = await crear_sesion_avatar("Instructor", prompt, saludo)
    except Exception as ex:  # el avatar nunca debe tumbar la sesión: cae a modo texto
        registrar(db, "sistema", "avatar_error", "asignacion_curso", a.codigo, {"error": str(ex)[:300]})

    if ses is None:
        db.commit()
        return {"modo": "texto", "mensajes": [{"rol": "assistant", "texto": saludo}], **asignacion_publica_dict(a)}

    db.commit()
    return {"modo": "avatar", **ses, **asignacion_publica_dict(a)}


class TurnoIn(BaseModel):
    texto: str


@router.post("/publica/{token}/turno")
def turno(token: str, datos: TurnoIn, db: Session = Depends(get_db)):
    """Un turno en modo texto (demo o fallback sin avatar) para el módulo actual."""
    a = _asignacion_por_token(db, token)
    if a.estado != "en_curso":
        raise HTTPException(403, "El curso no está en curso.")
    m = _modulo_actual(a)

    # Historial del módulo actual: el último bloque de `transcript` si ya es de este módulo.
    bloques = list(a.transcript or [])
    if bloques and bloques[-1].get("modulo") == m.orden:
        historial = list(bloques[-1].get("mensajes", []))
    else:
        historial = []
    historial = historial + [{"rol": "user", "texto": datos.texto}]

    t, con_ia = ia.curso_turno(_prompt_modulo(a, m, len(_modulos_ordenados(a))), historial)
    historial = historial + [{"rol": "assistant", "texto": t.respuesta}]

    if bloques and bloques[-1].get("modulo") == m.orden:
        bloques[-1]["mensajes"] = historial
    else:
        bloques.append({"modulo": m.orden, "titulo": m.titulo, "mensajes": historial})
    a.transcript = bloques

    db.commit()
    return {"respuesta": t.respuesta, "ia": con_ia}


class AvanzarIn(BaseModel):
    transcript: Optional[List[dict]] = None  # mensajes del módulo que se cierra (modo avatar los manda el navegador)


@router.post("/publica/{token}/avanzar")
def avanzar(token: str, datos: AvanzarIn, db: Session = Depends(get_db)):
    """Cierra el módulo actual: evalúa las respuestas contra criterio_respuesta_correcta,
    guarda transcript/resultado_evaluacion, y avanza modulo_actual (o completa el curso)."""
    a = _asignacion_por_token(db, token)
    if a.estado == "completado":
        return asignacion_publica_dict(a)  # idempotente: no reprocesa

    m = _modulo_actual(a)

    if datos.transcript is not None:
        mensajes = [
            {"rol": ("assistant" if x.get("rol") == "assistant" else "user"), "texto": str(x.get("texto", ""))[:2000]}
            for x in datos.transcript
        ]
    else:
        # modo texto: ya se fue acumulando en /turno
        bloques_previos = list(a.transcript or [])
        mensajes = bloques_previos[-1]["mensajes"] if bloques_previos and bloques_previos[-1].get("modulo") == m.orden else []

    evaluacion, con_ia = ia.evaluar_modulo_curso(m.titulo, m.contenido, m.preguntas_verificacion or [], mensajes)

    bloques = list(a.transcript or [])
    if bloques and bloques[-1].get("modulo") == m.orden:
        bloques[-1]["mensajes"] = mensajes
    else:
        bloques.append({"modulo": m.orden, "titulo": m.titulo, "mensajes": mensajes})
    a.transcript = bloques

    resultados = list((a.resultado_evaluacion or {}).get("modulos", []))
    resultados.append({"modulo": m.orden, "titulo": m.titulo, **evaluacion.model_dump()})
    a.resultado_evaluacion = {"modulos": resultados}

    a.modulo_actual += 1
    total = len(_modulos_ordenados(a))
    actor = a.colaborador.codigo if a.colaborador else "colaborador"
    if a.modulo_actual >= total:
        a.estado = "completado"
        a.completado_en = datetime.now(timezone.utc)
        registrar(db, actor, "curso_completado", "asignacion_curso", a.codigo, {"curso": a.curso.codigo if a.curso else "", "ia": con_ia})
    else:
        registrar(db, actor, "modulo_completado", "asignacion_curso", a.codigo, {"modulo": m.orden, "ia": con_ia})

    db.commit()
    return asignacion_publica_dict(a)
