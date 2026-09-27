"""Módulo de Clima laboral — andamiaje 2026-09-22, Clima v2 2026-09-27.

REGLA DE ORO: los participantes internos SON los `Colaborador` del roster maestro; este módulo nunca
captura personas ni crea usuarios.

Clima v2 (decisiones del usuario, 2026-09-27):
  * Estados ESTRICTOS de ida: borrador → abierta → cerrada. En borrador se edita todo; abierta solo
    admite mover la fecha de cierre; cerrada queda congelada (nunca se reabre).
  * Preguntas con dimensión, tipo (escala 1-5 | opción | abierta) y orden numérico.
  * Liga PERSONAL por invitado (`ParticipacionClima.token`): al responder se marca «respondió» en la tabla
    de participación, SEPARADA de las respuestas (sin llave entre ellas y sin hora de respuesta). La liga
    compartida de la medición (`MedicionClima.token`) es la liga EXTERNA: sus respuestas llevan
    `es_externa` y no suman a la participación; solo funciona con «permite externos».
  * Anonimato estricto: en una medición anónima la respuesta no guarda quién la dio (ni aunque el cliente
    lo mande) y solo guarda el DÍA, no la hora.
  * «Probar encuesta»: respuestas con `es_prueba`, jamás mezcladas con las reales; se pueden reiniciar.
"""

import secrets
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import (
    DIMENSION_CLIMA_DEFAULT,
    ESCALA_CLIMA,
    ESTADOS_MEDICION_CLIMA,
    TIPOS_PREGUNTA_CLIMA,
    TRANSICIONES_CLIMA,
    Colaborador,
    Cuenta,
    MedicionClima,
    ParticipacionClima,
    RespuestaClima,
    Usuario,
    registrar,
)
from ..serial import medicion_clima_dict, medicion_clima_publica_dict
from ..services import ia, plantillas_correo
from ..services.correo import enviar_correo
from ..services.whatsapp import enviar_texto_sin_plantilla
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/clima", tags=["clima"], dependencies=[Depends(requiere_modulos_rh)])


def _medicion(db: Session, codigo: str, cuenta_id: int) -> MedicionClima:
    m = db.query(MedicionClima).filter(MedicionClima.codigo == codigo, MedicionClima.cuenta_id == cuenta_id).first()
    if not m:
        raise HTTPException(404, "Medición de clima no encontrada.")
    return m


def _resolver_token(db: Session, token: str) -> Tuple[MedicionClima, Optional[ParticipacionClima]]:
    """Liga personal (participación) → (medición, participación); liga externa (de la medición) →
    (medición, None)."""
    part = db.query(ParticipacionClima).filter(ParticipacionClima.token == token).first()
    if part:
        return part.medicion, part
    m = db.query(MedicionClima).filter(MedicionClima.token == token).first()
    if not m:
        raise HTTPException(404, "Esta liga no existe o fue dada de baja.")
    return m, None


def liga_publica(m: MedicionClima) -> str:
    """Liga EXTERNA (compartida) de la medición."""
    return f"{settings.app_url}/clima/{m.token}"


def liga_personal(p: ParticipacionClima) -> str:
    return f"{settings.app_url}/clima/{p.token}"


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _fecha_iso(texto: Optional[str], campo: str = "cierra_en") -> Optional[datetime]:
    if not texto:
        return None
    try:
        dt = datetime.fromisoformat(texto)
    except ValueError:
        raise HTTPException(400, f"{campo} inválida (usa ISO: 2026-10-15T18:00)")
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def normalizar_cuestionario(preguntas: List[dict], dimensiones: Optional[List[str]] = None) -> Tuple[List[dict], List[str]]:
    """Cada pregunta queda con id estable, texto, tipo válido, dimensión y orden 1..n (ordenadas por el
    `orden` que mande RH). La escala es SIEMPRE 1-5. Regresa (preguntas, dimensiones en orden)."""
    crudas = []
    for i, p in enumerate(preguntas or []):
        texto = str(p.get("texto") or "").strip()
        if not texto:
            continue
        try:
            orden = float(p.get("orden")) if p.get("orden") not in (None, "") else float(i + 1)
        except (TypeError, ValueError):
            orden = float(i + 1)
        crudas.append((orden, i, p, texto))
    crudas.sort(key=lambda x: (x[0], x[1]))

    usados = {str(p.get("id")) for _, _, p, _ in crudas if p.get("id")}
    salida = []
    for n, (_, i, p, texto) in enumerate(crudas, start=1):
        tipo = str(p.get("tipo") or "escala").strip()
        if tipo not in TIPOS_PREGUNTA_CLIMA:
            raise HTTPException(400, f"Tipo de pregunta inválido «{tipo}». Usa: {', '.join(TIPOS_PREGUNTA_CLIMA)}")
        pid = str(p.get("id") or "")
        if not pid:
            pid = f"p{i + 1}"
            while pid in usados:
                pid = f"p{secrets.token_hex(3)}"
            usados.add(pid)
        fila = {
            "id": pid, "texto": texto, "tipo": tipo, "orden": n,
            "dimension": str(p.get("dimension") or "").strip() or DIMENSION_CLIMA_DEFAULT,
        }
        if tipo == "escala":
            fila["escala_max"] = ESCALA_CLIMA
        if tipo == "opcion":
            opciones = [str(o).strip() for o in (p.get("opciones") or []) if str(o).strip()]
            if len(opciones) < 2:
                raise HTTPException(400, f"La pregunta «{texto}» es de opción y necesita al menos 2 opciones.")
            fila["opciones"] = opciones
        salida.append(fila)
    if len({p["id"] for p in salida}) != len(salida):
        raise HTTPException(400, "Hay preguntas con el mismo id.")

    orden_dims = [str(d).strip() for d in (dimensiones or []) if str(d).strip()]
    for p in salida:
        if p["dimension"] not in orden_dims:
            orden_dims.append(p["dimension"])
    return salida, list(dict.fromkeys(orden_dims))


def _momento(m: MedicionClima) -> datetime:
    """Marca de tiempo de una respuesta: en anónimas solo el día (anonimato estricto)."""
    ahora = datetime.now(timezone.utc)
    return ahora.replace(hour=0, minute=0, second=0, microsecond=0) if m.anonima else ahora


# ------------------------------------------------------------
# Administración (RH)
# ------------------------------------------------------------


class MedicionIn(BaseModel):
    titulo: str
    descripcion: str = ""
    preguntas: List[dict] = []
    dimensiones: List[str] = []
    anonima: bool = True
    permite_externos: bool = False
    cierra_en: Optional[str] = None  # ISO
    plantilla_id: Optional[int] = None


@router.post("/mediciones", status_code=201)
def crear_medicion(datos: MedicionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    if not datos.titulo.strip():
        raise HTTPException(400, "El título de la medición es obligatorio.")
    preguntas, dimensiones = normalizar_cuestionario(datos.preguntas, datos.dimensiones)
    if not preguntas:
        raise HTTPException(400, "Captura al menos una pregunta.")
    m = MedicionClima(
        codigo="TMP", cuenta_id=cuenta.id, titulo=datos.titulo.strip(), descripcion=datos.descripcion.strip(),
        preguntas=preguntas, dimensiones=dimensiones, anonima=bool(datos.anonima), permite_externos=bool(datos.permite_externos),
        estado="borrador", token=secrets.token_urlsafe(24), creado_por=u.nombre, plantilla_id=datos.plantilla_id,
        cierra_en=_fecha_iso(datos.cierra_en),
    )
    db.add(m)
    db.flush()
    m.codigo = f"CLI-{900 + m.id}"
    registrar(db, u.nombre, "medicion_clima_creada", "clima", m.codigo, {"titulo": m.titulo, "anonima": m.anonima, "preguntas": len(preguntas), "correo_rh": u.correo})
    db.commit()
    return medicion_clima_dict(m, liga=liga_publica(m))


class GenerarClimaIn(BaseModel):
    prompt: str  # «¿Qué quieres saber de tu equipo?»


@router.post("/generar")
def generar_encuesta(datos: GenerarClimaIn, u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Crear encuesta con Red Human»: propone nombre, dimensiones y preguntas a partir de lo que RH quiere
    saber. NO guarda nada: RH revisa y edita, y luego crea la medición con POST /mediciones."""
    if not datos.prompt.strip():
        raise HTTPException(400, "Escribe qué quieres saber de tu equipo.")
    enc, con_ia = ia.encuesta_clima(datos.prompt, cuenta.nombre_visible)
    crudas = []
    for p in enc.preguntas:
        fila = p.model_dump()
        if fila["tipo"] == "opcion" and len([o for o in fila.get("opciones") or [] if str(o).strip()]) < 2:
            fila["tipo"], fila["opciones"] = "abierta", []  # opción mal formada: se conserva como abierta
        crudas.append(fila)
    preguntas, dimensiones = normalizar_cuestionario(crudas, enc.dimensiones)
    return {"ia": con_ia, "titulo": enc.titulo, "descripcion": enc.descripcion, "dimensiones": dimensiones, "preguntas": preguntas}


@router.get("/mediciones")
def listar_mediciones(estado: Optional[str] = None, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    q = db.query(MedicionClima).filter(MedicionClima.cuenta_id == cuenta.id).order_by(MedicionClima.id.desc())
    if estado:
        q = q.filter(MedicionClima.estado == estado)
    return [medicion_clima_dict(m, liga=liga_publica(m)) for m in q.all()]


@router.get("/mediciones/{codigo}")
def ver_medicion(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    m = _medicion(db, codigo, cuenta.id)
    return medicion_clima_dict(m, liga=liga_publica(m), detalle=True)


class EditarMedicionIn(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    preguntas: Optional[List[dict]] = None
    dimensiones: Optional[List[str]] = None
    anonima: Optional[bool] = None
    permite_externos: Optional[bool] = None
    cierra_en: Optional[str] = None


@router.patch("/mediciones/{codigo}")
def editar_medicion(codigo: str, datos: EditarMedicionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Borrador: se edita todo (reordenar, dimensiones, tipos, modalidad). Abierta: SOLO la fecha de cierre
    (y debe quedar en el futuro). Cerrada: nada."""
    m = _medicion(db, codigo, cuenta.id)
    campos = datos.model_dump(exclude_unset=True)
    if m.estado == "cerrada":
        raise HTTPException(409, "La medición está cerrada: sus resultados quedan congelados.")
    if m.estado == "abierta":
        if set(campos) - {"cierra_en"}:
            raise HTTPException(409, "Con la medición abierta solo se puede cambiar la fecha de cierre.")
        nueva = _fecha_iso(datos.cierra_en)
        if nueva is None or nueva <= datetime.now(timezone.utc):
            raise HTTPException(400, "La nueva fecha de cierre debe estar en el futuro.")
        m.cierra_en = nueva
    else:
        if datos.titulo is not None:
            if not datos.titulo.strip():
                raise HTTPException(400, "El título de la medición es obligatorio.")
            m.titulo = datos.titulo.strip()
        if datos.descripcion is not None:
            m.descripcion = datos.descripcion.strip()
        if datos.preguntas is not None or datos.dimensiones is not None:
            preguntas, dimensiones = normalizar_cuestionario(
                datos.preguntas if datos.preguntas is not None else list(m.preguntas or []),
                datos.dimensiones if datos.dimensiones is not None else list(m.dimensiones or []),
            )
            if not preguntas:
                raise HTTPException(400, "Captura al menos una pregunta.")
            m.preguntas, m.dimensiones = preguntas, dimensiones
        if datos.anonima is not None:
            m.anonima = bool(datos.anonima)
        if datos.permite_externos is not None:
            m.permite_externos = bool(datos.permite_externos)
        if "cierra_en" in campos:
            m.cierra_en = _fecha_iso(datos.cierra_en)
    registrar(db, u.nombre, "medicion_clima_editada", "clima", m.codigo, {"campos": sorted(campos), "correo_rh": u.correo})
    db.commit()
    return medicion_clima_dict(m, liga=liga_publica(m), detalle=True)


class EstadoMedicionIn(BaseModel):
    estado: str  # borrador | abierta | cerrada


def cerrar_medicion(m: MedicionClima, por: str) -> None:
    m.estado = "cerrada"
    m.cerrada_en = datetime.now(timezone.utc)
    m.cerrada_por = por


@router.patch("/mediciones/{codigo}/estado")
def cambiar_estado(codigo: str, datos: EstadoMedicionIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Flujo estricto de ida: borrador → abierta → cerrada. Abrir = empieza a recibir respuestas reales;
    cerrar = deja de recibirlas y los resultados quedan congelados (nunca se reabre)."""
    m = _medicion(db, codigo, cuenta.id)
    if datos.estado not in ESTADOS_MEDICION_CLIMA:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS_MEDICION_CLIMA)}")
    if datos.estado == m.estado:
        return medicion_clima_dict(m, liga=liga_publica(m), detalle=True)
    if datos.estado not in TRANSICIONES_CLIMA.get(m.estado, ()):
        raise HTTPException(409, f"Una medición {m.estado} no puede pasar a {datos.estado} (flujo: borrador → abierta → cerrada).")
    if datos.estado == "abierta":
        if not m.preguntas:
            raise HTTPException(400, "La medición no tiene preguntas.")
        if m.cierra_en and _utc(m.cierra_en) <= datetime.now(timezone.utc):
            raise HTTPException(400, "La fecha de cierre ya pasó: cámbiala antes de abrir.")
        m.estado = "abierta"
        m.abierta_en = m.abierta_en or datetime.now(timezone.utc)
    else:
        cerrar_medicion(m, u.nombre)
    registrar(db, u.nombre, "medicion_clima_estado", "clima", m.codigo, {"estado": m.estado, "correo_rh": u.correo})
    db.commit()
    return medicion_clima_dict(m, liga=liga_publica(m), detalle=True)


@router.post("/mediciones/{codigo}/liga")
def regenerar_liga(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Genera una liga EXTERNA nueva (la anterior deja de funcionar). Las ligas personales no cambian."""
    m = _medicion(db, codigo, cuenta.id)
    m.token = secrets.token_urlsafe(24)
    registrar(db, u.nombre, "medicion_clima_liga", "clima", m.codigo, {"correo_rh": u.correo})
    db.commit()
    return {"liga": liga_publica(m), "medicion": medicion_clima_dict(m, liga=liga_publica(m))}


# ------------------------------------------------------------
# Participación
# ------------------------------------------------------------


class ResponderIn(BaseModel):
    respuestas: Dict[str, object] = {}
    colaborador_id: str = ""   # código COL-#### (solo captura de RH desde el tablero)
    externo_nombre: str = ""   # solo liga externa en medición identificada
    externo_correo: str = ""


def _validar_respuestas(m: MedicionClima, respuestas: Dict[str, object]) -> dict:
    """Solo preguntas del cuestionario; la escala debe ser un entero 1-5 y la opción una de las listadas."""
    preguntas = {p["id"]: p for p in (m.preguntas or [])}
    limpias = {}
    for k, v in (respuestas or {}).items():
        p = preguntas.get(k)
        if p is None or v in (None, ""):
            continue
        if p["tipo"] == "escala":
            try:
                n = int(float(v))
            except (TypeError, ValueError):
                raise HTTPException(400, f"«{p['texto']}» se responde con un número del 1 al {ESCALA_CLIMA}.")
            if not 1 <= n <= int(p.get("escala_max") or ESCALA_CLIMA):
                raise HTTPException(400, f"«{p['texto']}» se responde con un número del 1 al {ESCALA_CLIMA}.")
            limpias[k] = n
        elif p["tipo"] == "opcion":
            if str(v) not in (p.get("opciones") or []):
                raise HTTPException(400, f"«{v}» no es una opción de «{p['texto']}».")
            limpias[k] = str(v)
        else:
            limpias[k] = str(v).strip()[:2000]
    if not limpias:
        raise HTTPException(400, "No llegó ninguna respuesta válida.")
    return limpias


def _exigir_abierta(m: MedicionClima) -> None:
    if m.estado != "abierta":
        raise HTTPException(409, "Esta medición no está recibiendo respuestas.")
    if m.cierra_en and datetime.now(timezone.utc) > _utc(m.cierra_en):
        raise HTTPException(409, "El periodo para responder esta medición ya terminó.")


def _guardar_respuesta(
    db: Session, m: MedicionClima, datos: ResponderIn, *, origen: str, colaborador: Optional[Colaborador] = None,
    es_externa: bool = False, es_prueba: bool = False,
) -> RespuestaClima:
    r = RespuestaClima(
        cuenta_id=m.cuenta_id, medicion_id=m.id, origen=origen, es_externa=es_externa, es_prueba=es_prueba,
        # ANÓNIMA: nunca se guarda a quién pertenece (ni siquiera si el frontend lo manda).
        colaborador_id=None if (m.anonima or es_prueba) else (colaborador.id if colaborador else None),
        externo_nombre="" if (m.anonima or not es_externa) else datos.externo_nombre.strip()[:200],
        externo_correo="" if (m.anonima or not es_externa) else datos.externo_correo.strip().lower()[:200],
        respuestas=_validar_respuestas(m, datos.respuestas),
        enviado_en=_momento(m),
    )
    db.add(r)
    return r


@router.post("/mediciones/{codigo}/responder", status_code=201)
def responder_interno(codigo: str, datos: ResponderIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """RH captura la respuesta de un colaborador INVITADO desde el tablero. El participante se elige del
    roster (COL-####) y debe estar invitado: así se controla la participación y no hay duplicados."""
    m = _medicion(db, codigo, cuenta.id)
    _exigir_abierta(m)
    if not datos.colaborador_id:
        raise HTTPException(400, "Indica el colaborador (COL-####) que responde.")
    col = db.query(Colaborador).filter(
        Colaborador.codigo == datos.colaborador_id, Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None)
    ).first()
    if not col:
        raise HTTPException(404, "Ese colaborador no existe en el roster.")
    part = db.query(ParticipacionClima).filter(ParticipacionClima.medicion_id == m.id, ParticipacionClima.colaborador_id == col.id).first()
    if not part:
        raise HTTPException(409, "Ese colaborador no está invitado a esta medición: invítalo primero.")
    if part.respondio:
        raise HTTPException(409, "Ese colaborador ya respondió esta medición.")
    _guardar_respuesta(db, m, datos, origen="colaborador", colaborador=col)
    part.respondio = True
    registrar(db, u.nombre, "clima_respuesta", "clima", m.codigo, {"anonima": m.anonima, "colaborador": None if m.anonima else col.codigo})
    db.commit()
    return {"guardada": True, "anonima": m.anonima}


@router.post("/mediciones/{codigo}/prueba/responder", status_code=201)
def responder_prueba(codigo: str, datos: ResponderIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """«Probar encuesta»: guarda una respuesta de PRUEBA (borrador o abierta). Nunca cuenta en los
    resultados reales ni en la participación; se ve solo en los resultados de prueba."""
    m = _medicion(db, codigo, cuenta.id)
    if m.estado == "cerrada":
        raise HTTPException(409, "La medición está cerrada.")
    _guardar_respuesta(db, m, datos, origen="prueba", es_prueba=True)
    db.commit()
    return {"guardada": True, "prueba": True}


@router.delete("/mediciones/{codigo}/prueba")
def reiniciar_prueba(codigo: str, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Borra SOLO las respuestas de prueba (las reales jamás se tocan)."""
    m = _medicion(db, codigo, cuenta.id)
    n = db.query(RespuestaClima).filter(RespuestaClima.medicion_id == m.id, RespuestaClima.es_prueba.is_(True)).delete(synchronize_session=False)
    registrar(db, u.nombre, "clima_prueba_reiniciada", "clima", m.codigo, {"borradas": n, "correo_rh": u.correo})
    db.commit()
    return {"borradas": n}


@router.get("/publica/{token}")
def ver_publica(token: str, db: Session = Depends(get_db)):
    """Lo que ve quien abre la liga (personal o externa): título, aviso de anonimato y preguntas. Sin sesión."""
    m, part = _resolver_token(db, token)
    return {
        **medicion_clima_publica_dict(m),
        "tipoLiga": "personal" if part else "externa",
        "yaRespondio": bool(part and part.respondio),
        # la liga externa solo sirve si la medición acepta externos
        "aceptaRespuestas": m.estado == "abierta" and (part is not None or bool(m.permite_externos)) and not (part and part.respondio),
    }


@router.post("/publica/{token}/responder", status_code=201)
def responder_publica(token: str, datos: ResponderIn = Body(...), db: Session = Depends(get_db)):
    """Liga PERSONAL: responde el invitado (una sola vez) y se marca su participación; la respuesta no
    guarda su identidad si la medición es anónima. Liga EXTERNA: solo con «permite externos»; la respuesta
    queda marcada como externa (no suma a la participación) y nunca se crea un colaborador."""
    m, part = _resolver_token(db, token)
    _exigir_abierta(m)
    if part:
        if part.respondio:
            raise HTTPException(409, "Ya respondiste esta encuesta. ¡Gracias!")
        _guardar_respuesta(db, m, datos, origen="colaborador", colaborador=part.colaborador)
        part.respondio = True
    else:
        if not m.permite_externos:
            raise HTTPException(403, "Esta medición es solo para colaboradores invitados: usa la liga que te llegó.")
        _guardar_respuesta(db, m, datos, origen="externo", es_externa=True)
    db.commit()
    return {"guardada": True, "anonima": m.anonima}


class InvitarIn(BaseModel):
    colaborador_ids: List[str] = []  # códigos COL-#### del roster (nunca se capturan personas aquí)
    mensaje: str = ""                # nota opcional de RH al inicio del aviso


def _invitar_colaboradores(db: Session, m: MedicionClima, codigos: List[str], cuenta: Cuenta, por: str):
    """Crea (o reutiliza) la participación de cada colaborador ACTIVO del roster, con su liga personal.
    Regresa (participaciones, no_encontrados)."""
    partes, no_encontrados = [], []
    for cod in dict.fromkeys(codigos):
        col = db.query(Colaborador).filter(
            Colaborador.codigo == cod, Colaborador.cuenta_id == cuenta.id,
            Colaborador.eliminado_en.is_(None), Colaborador.activo.is_(True),
        ).first()
        if not col:
            no_encontrados.append(cod)
            continue
        part = db.query(ParticipacionClima).filter(ParticipacionClima.medicion_id == m.id, ParticipacionClima.colaborador_id == col.id).first()
        if not part:
            part = ParticipacionClima(
                cuenta_id=m.cuenta_id, medicion_id=m.id, colaborador_id=col.id,
                token=secrets.token_urlsafe(24), invitado_por=por,
            )
            db.add(part)
            db.flush()
        partes.append(part)
    return partes, no_encontrados


async def _avisar(m: MedicionClima, part: ParticipacionClima, cuenta: Cuenta, nota: str) -> dict:
    """Manda la liga PERSONAL por correo y/o WhatsApp; un proveedor caído nunca rompe la invitación."""
    col = part.colaborador
    liga = liga_personal(part)
    primer = (col.nombre or "").split(" ")[0]
    texto = (
        f"Hola {primer}, en {cuenta.nombre_visible} queremos saber cómo te sientes: contesta «{m.titulo}» en unos minutos. "
        + (f"{nota} " if nota else "")
        + ("Tus respuestas son ANÓNIMAS. " if m.anonima else "")
        + f"Esta es tu liga personal: {liga}"
    )
    fila = {"colaborador": col.codigo, "nombre": col.nombre, "correo": None, "whatsapp": None}
    if col.correo:
        try:
            asunto, html = plantillas_correo.html_aviso(
                f"Encuesta de clima: {m.titulo}", texto, cuenta.nombre_visible, [], ("Contestar la encuesta", liga),
            )
            fila["correo"] = await enviar_correo(col.correo, asunto, html)
        except Exception as ex:  # noqa: BLE001
            fila["correo"] = {"enviado": False, "proveedor": "error", "detalle": str(ex)[:200]}
    if col.telefono:
        try:
            fila["whatsapp"] = await enviar_texto_sin_plantilla(col.telefono, texto)
        except Exception as ex:  # noqa: BLE001
            fila["whatsapp"] = {"enviado": False, "proveedor": "error", "detalle": str(ex)[:200]}
    return fila


@router.post("/mediciones/{codigo}/invitar")
async def invitar(codigo: str, datos: InvitarIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """Invita colaboradores a una medición ABIERTA: cada quien queda en la tabla de participación con su
    liga personal y se le avisa por correo y/o WhatsApp. A quien ya respondió no se le vuelve a escribir;
    a quien ya estaba invitado y no ha respondido, el aviso cuenta como recordatorio."""
    m = _medicion(db, codigo, cuenta.id)
    if m.estado != "abierta":
        raise HTTPException(409, "Abre la medición antes de invitar (solo una medición abierta recibe respuestas).")
    if not datos.colaborador_ids:
        raise HTTPException(400, "Elige al menos un colaborador.")
    ya_invitados = {p.colaborador_id for p in m.participaciones}
    partes, no_encontrados = _invitar_colaboradores(db, m, datos.colaborador_ids, cuenta, u.nombre)
    if not partes:
        raise HTTPException(404, "Ninguno de los colaboradores indicados existe o está activo.")
    resultados = []
    for part in partes:
        if part.respondio:
            resultados.append({"colaborador": part.colaborador.codigo, "nombre": part.colaborador.nombre, "yaRespondio": True})
            continue
        if part.colaborador_id in ya_invitados:
            part.recordatorios_enviados = (part.recordatorios_enviados or 0) + 1
            part.ultimo_recordatorio_en = datetime.now(timezone.utc)
        resultados.append(await _avisar(m, part, cuenta, datos.mensaje.strip()))
    registrar(db, u.nombre, "clima_invitaciones", "clima", m.codigo,
              {"invitados": [r["colaborador"] for r in resultados], "no_encontrados": no_encontrados, "correo_rh": u.correo})
    db.commit()
    return {"liga": liga_publica(m), "invitados": resultados, "noEncontrados": no_encontrados}


# ------------------------------------------------------------
# Resultados
# ------------------------------------------------------------


@router.get("/mediciones/{codigo}/resultados")
def resultados(codigo: str, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    """Agregados por pregunta, SOLO con respuestas reales internas (sin prueba ni externas). En una
    medición anónima NUNCA se regresa quién respondió; las abiertas vienen sin autor."""
    m = _medicion(db, codigo, cuenta.id)
    respuestas = [r for r in m.respuestas if not r.es_prueba and not r.es_externa and r.origen != "externo"]
    invitados = len(m.participaciones)
    respondieron = sum(1 for p in m.participaciones if p.respondio)
    total_roster = db.query(Colaborador).filter(
        Colaborador.cuenta_id == cuenta.id, Colaborador.eliminado_en.is_(None), Colaborador.activo.is_(True)
    ).count()
    por_pregunta = []
    for p in m.preguntas or []:
        valores = [r.respuestas.get(p["id"]) for r in respuestas if r.respuestas and r.respuestas.get(p["id"]) not in (None, "")]
        fila = {"id": p["id"], "texto": p["texto"], "tipo": p["tipo"], "respuestas": len(valores)}
        if p["tipo"] == "escala":
            numeros = [float(v) for v in valores if str(v).replace(".", "", 1).isdigit()]
            fila["promedio"] = round(sum(numeros) / len(numeros), 2) if numeros else None
            fila["escalaMax"] = p.get("escala_max", ESCALA_CLIMA)
            fila["distribucion"] = {str(n): numeros.count(n) for n in sorted(set(numeros))}
        elif p["tipo"] == "opcion":
            fila["distribucion"] = {o: [str(v) for v in valores].count(o) for o in p.get("opciones", [])}
        else:
            fila["textos"] = [str(v)[:500] for v in valores]  # sin autor, siempre
        por_pregunta.append(fila)
    return {
        "medicion": medicion_clima_dict(m, liga=liga_publica(m)),
        "totalRespuestas": len(respuestas),
        "colaboradoresActivos": total_roster,  # compatibilidad del tablero actual (Fase 4 lo reemplaza)
        "invitados": invitados,
        "respondieron": respondieron,
        "participacion": round(respondieron / invitados * 100) if invitados else None,
        "externos": sum(1 for r in m.respuestas if not r.es_prueba and (r.es_externa or r.origen == "externo")),
        "pruebas": sum(1 for r in m.respuestas if r.es_prueba),
        "porPregunta": por_pregunta,
    }
