"""Sincronización de esquema para SQLite (sin Alembic).

`Base.metadata.create_all` crea tablas nuevas pero nunca agrega columnas a una
tabla que ya existe. Como `redhuman.db` vive en disco entre versiones, aquí se
agregan las columnas faltantes con ALTER TABLE, tomando el default declarado en
el modelo para que los renglones viejos no queden en NULL.
"""

import json
from typing import List, Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .database import Base


def _default_sql(col) -> str:
    """Cláusula DEFAULT constante para la columna, o cadena vacía si no aplica."""
    d = col.default
    if d is None:
        return ""
    arg = getattr(d, "arg", None)
    if callable(arg):
        try:
            arg = arg(None)  # default_factory (list, dict, …)
        except Exception:
            return ""
    if isinstance(arg, (list, dict)):
        return f" DEFAULT '{json.dumps(arg)}'"
    if isinstance(arg, bool):
        return f" DEFAULT {1 if arg else 0}"
    if isinstance(arg, (int, float)):
        return f" DEFAULT {arg}"
    if isinstance(arg, str):
        return " DEFAULT '{}'".format(arg.replace("'", "''"))
    return ""  # datetimes u otros callables → la columna queda NULL


def crear_tablas_base(engine: Engine) -> None:
    """Tablas del núcleo (todas menos las de la Base de Conocimiento y los módulos nuevos de RH): si esto
    falla, la API NO arranca, como siempre."""
    from .models import TABLAS_CONOCIMIENTO, TABLAS_MODULOS_RH

    aparte = set(TABLAS_CONOCIMIENTO) | set(TABLAS_MODULOS_RH)
    nucleo = [t for t in Base.metadata.sorted_tables if t.name not in aparte]
    Base.metadata.create_all(bind=engine, tables=nucleo)


def crear_tablas_modulos_rh(engine: Engine) -> Optional[str]:
    """Tablas de Desempeño y Clima (andamiaje 2026-09-22), en el MISMO paso NO fatal que las de
    conocimiento: si el motor de producción rechaza alguna, esos módulos responden 503 con el motivo y
    el resto de la plataforma arranca normal. Regresa None si quedaron listas, o el error."""
    from .models import TABLAS_MODULOS_RH

    return _crear_una_por_una(engine, TABLAS_MODULOS_RH)


def _crear_una_por_una(engine: Engine, nombres) -> Optional[str]:
    errores = []
    for nombre in nombres:
        tabla = Base.metadata.tables.get(nombre)
        if tabla is None:
            continue
        try:
            Base.metadata.create_all(bind=engine, tables=[tabla])
        except Exception as ex:  # noqa: BLE001 — se reporta, nunca tumba el arranque
            errores.append(f"{nombre}: {str(ex).splitlines()[0][:300]}")
    return "; ".join(errores) if errores else None


def crear_tablas_conocimiento(engine: Engine) -> Optional[str]:
    """Tablas de la Base de Conocimiento (RAG) en un paso aparte y NO fatal (hotfix 2026-09-18): regresa
    None si quedaron listas, o el texto del error si no — en ese caso el módulo queda deshabilitado (503)
    y el resto de la plataforma arranca normal. Se crean una por una para que un fallo aislado no
    bloquee a las demás y el error diga exactamente qué tabla y qué dijo el motor."""
    from .models import TABLAS_CONOCIMIENTO

    errores = []
    for nombre in TABLAS_CONOCIMIENTO:
        tabla = Base.metadata.tables.get(nombre)
        if tabla is None:
            continue
        try:
            Base.metadata.create_all(bind=engine, tables=[tabla])
        except Exception as ex:  # noqa: BLE001 — se reporta, nunca tumba el arranque
            errores.append(f"{nombre}: {str(ex).splitlines()[0][:300]}")
    return "; ".join(errores) if errores else None


def sincronizar(engine: Engine, omitir: Optional[set] = None) -> List[str]:
    """Agrega a la base las columnas que existen en los modelos y no en las tablas.
    `omitir`: tablas que no se tocan (p. ej. las de conocimiento cuando no se pudieron crear)."""
    insp = inspect(engine)
    tablas = set(insp.get_table_names())
    cambios: List[str] = []
    omitir = omitir or set()

    with engine.begin() as con:
        for tabla in Base.metadata.sorted_tables:
            if tabla.name not in tablas or tabla.name in omitir:
                continue  # create_all ya la creó completa (o está deshabilitada)
            existentes = {c["name"] for c in insp.get_columns(tabla.name)}
            for col in tabla.columns:
                if col.name in existentes:
                    continue
                tipo = col.type.compile(engine.dialect)
                con.execute(text(f"ALTER TABLE {tabla.name} ADD COLUMN {col.name} {tipo}{_default_sql(col)}"))
                cambios.append(f"{tabla.name}.{col.name}")

    return cambios


# ============================================================
# Fase 2 — datos: de "un Candidato = una postulación" a Candidato (persona) + Postulacion
# ============================================================


def candidatos_sin_postulacion(db) -> int:
    """Cuántas personas siguen sin ninguna Postulación — si es > 0, falta correr
    scripts/migrar_postulaciones.py (se avisa en el arranque, ver main.py)."""
    from .models import Candidato, Postulacion

    tiene = db.query(Postulacion.candidato_id).distinct()
    return db.query(Candidato).filter(Candidato.id.not_in(tiene)).count()


def migrar_postulaciones(db) -> dict:
    """Crea la Postulación inicial de cada Candidato que aún no tiene ninguna, copiando el
    estado de proceso que vivía en la persona (columnas LEGADO de `Candidato`), y liga a esa
    postulación los mensajes, entrevistas, entrevistas humanas y expediente que todavía
    cuelgan solo de la persona (postulacion_id NULL).

    Decisión 2026-09-11: los candidatos SIN vacante también reciben su postulación (sin
    vacante) para seguir visibles en Prefiltro. Idempotente: se puede correr N veces.
    NO hace commit — el llamador decide (script → commit; seed → mismo commit de la semilla)."""
    from .models import Candidato, Entrevista, EntrevistaHumana, Expediente, Mensaje, Postulacion

    conteo = {"postulaciones": 0, "mensajes": 0, "entrevistas": 0, "entrevistas_humanas": 0, "expedientes": 0}
    candidatos = db.query(Candidato).order_by(Candidato.id).all()
    for c in candidatos:
        if c.postulaciones:
            p = c.postulacion_conversacion if (c.postulacion_conversacion and c.postulacion_conversacion.activa) else None
            p = p or (c.postulaciones_activas[-1] if c.postulaciones_activas else c.postulaciones[-1])
        else:
            p = Postulacion(
                codigo="TMP",
                candidato_id=c.id,
                vacante_id=c.vacante_id,
                cuenta_id=c.cuenta_id,
                origen="migracion",
                es_prueba=bool(c.es_prueba),
                etapa=c.etapa or "Prefiltro",
                estado=c.estado or "pendiente",
                score=c.score or 0,
                evidencia=c.evidencia or "",
                analisis=dict(c.analisis or {}),
                prefiltro_completo=bool(c.prefiltro_completo),
                resultado_apto=c.resultado_apto,
                ultima_actividad_en=c.ultima_actividad_en,
                consentimiento=bool(c.consentimiento),
                consentimiento_fecha=c.consentimiento_fecha,
                videollamada_agendada_en=c.videollamada_agendada_en,
                videollamada_liga=c.videollamada_liga or "",
                videollamada_aviso_noshow_enviado=bool(c.videollamada_aviso_noshow_enviado),
                creado_en=c.creado_en,
            )
            db.add(p)
            db.flush()
            p.codigo = f"P-{8800 + p.id}"
            c.postulaciones.append(p)
            c.postulacion_conversacion_id = p.id
            conteo["postulaciones"] += 1

        # Hijos huérfanos (previos a Fase 2) → a la postulación inicial de la persona.
        conteo["mensajes"] += (
            db.query(Mensaje).filter(Mensaje.candidato_id == c.id, Mensaje.postulacion_id.is_(None))
            .update({Mensaje.postulacion_id: p.id}, synchronize_session=False)
        )
        conteo["entrevistas"] += (
            db.query(Entrevista).filter(Entrevista.candidato_id == c.id, Entrevista.postulacion_id.is_(None))
            .update({Entrevista.postulacion_id: p.id}, synchronize_session=False)
        )
        conteo["entrevistas_humanas"] += (
            db.query(EntrevistaHumana).filter(EntrevistaHumana.candidato_id == c.id, EntrevistaHumana.postulacion_id.is_(None))
            .update({EntrevistaHumana.postulacion_id: p.id}, synchronize_session=False)
        )
        if not p.expediente:
            exp = (
                db.query(Expediente)
                .filter(Expediente.candidato_id == c.id, Expediente.postulacion_id.is_(None))
                .order_by(Expediente.id.desc())
                .first()
            )
            if exp:
                exp.postulacion_id = p.id
                conteo["expedientes"] += 1
    db.flush()
    db.expire_all()
    return conteo


def asegurar_reglas_entrevistador(db) -> int:
    """2026-09-15 (Fase 1). Bug reportado: al agendar Entrevista Humana solo le llegaba al candidato.
    Causa: la regla `entrevista_agendada` de Cuentas creadas antes de 7A nació con el entrevistador
    apagado (siembra de Fase D: solo correo; o todo apagado) y 7A decidió no tocar reglas guardadas.
    Aquí se enciende correo+WhatsApp al entrevistador SOLO si ningún admin editó esa regla a mano
    (no hay `regla_notificacion_actualizada` en bitácora para ese evento). Idempotente."""
    from sqlalchemy import func as _f

    from .models import Bitacora, ReglaNotificacion

    editadas = {
        int(b.entidad_id)
        for b in db.query(Bitacora)
        .filter(Bitacora.accion == "regla_notificacion_actualizada", Bitacora.entidad == "cuenta")
        .all()
        if (b.detalle or {}).get("evento") == "entrevista_agendada" and str(b.entidad_id).isdigit()
    }
    n = 0
    for r in db.query(ReglaNotificacion).filter(ReglaNotificacion.evento == "entrevista_agendada").all():
        if r.cuenta_id in editadas or (r.entrevistador_correo and r.entrevistador_whatsapp):
            continue
        r.entrevistador_correo = True
        r.entrevistador_whatsapp = True
        n += 1
    if n:
        db.commit()
    return n
