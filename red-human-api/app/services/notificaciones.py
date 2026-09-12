"""Fase D — despacho central de notificaciones configurables por evento/destinatario/canal
(puntos 22-26 de la reestructuración multi-cuenta).

Punto único de entrada: `disparar()`. Reemplaza los `if c.telefono: enviar_mensaje(...)` /
`enviar_correo(...)` que antes vivían sueltos en cada endpoint — ahora cada endpoint solo dice
QUÉ EVENTO ocurrió; este módulo decide A QUIÉN y POR QUÉ CANAL según la `ReglaNotificacion` de
la Cuenta, resuelve el dato de contacto real (nunca inventa uno, nunca pide captura nueva —
punto 23), arma el texto (que sigue siendo fijo en código, Fase D no incluye un editor de
plantillas) y deja rastro en `NotificacionEnviada`.
"""

import re
from datetime import datetime
from typing import List, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..models import ClienteContacto, EntrevistaHumana, Mensaje, NotificacionEnviada, Postulacion, ReglaNotificacion, Usuario
from .correo import enviar_correo
from .whatsapp import enviar_mensaje

# RH/entrevistador capturan fecha/hora pensando en hora de México — nunca vienen con offset.
# SQLite descarta el offset de un DateTime(timezone=True) y se queda con los números de reloj
# tal cual, así que hay que convertir a UTC explícitamente antes de guardar (ya nos mordió
# antes en este proyecto, ver candidatos.py::programar_entrevista_humana histórico).
TZ_MEXICO = ZoneInfo("America/Mexico_City")

_MESES_LARGO = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

RE_CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _fecha_hora_legible_mx(dt: datetime) -> str:
    local = dt.astimezone(TZ_MEXICO)
    return f"{local.day} de {_MESES_LARGO[local.month - 1]} a las {local.strftime('%H:%M')}"


def _detalle_modalidad(eh: EntrevistaHumana, c: Postulacion) -> str:
    """Dato específico de la modalidad — se usa en el WhatsApp y en los correos."""
    if eh.modalidad == "Videollamada" and eh.liga:
        return f"Liga de la videollamada: {eh.liga}"
    if eh.modalidad == "Presencial" and eh.ubicacion:
        return f"Ubicación: {eh.ubicacion}"
    if eh.modalidad == "Llamada":
        tel = eh.telefono_contacto or c.telefono
        if tel:
            return f"Te contactaremos al {tel}"
    return ""


def _texto_cita_entrevista_humana(eh: EntrevistaHumana, c: Postulacion) -> str:
    """Fragmento reusado por agendada/recordatorio/modificada, candidato/entrevistador/cliente."""
    cuando = _fecha_hora_legible_mx(eh.fecha) if eh.fecha else "fecha por confirmar"
    texto = f"con {eh.entrevistador or 'nuestro equipo de RH'} el {cuando}, modalidad {eh.modalidad or 'por confirmar'}."
    detalle = _detalle_modalidad(eh, c)
    if detalle:
        texto += f" {detalle}."
    if eh.comentario:
        texto += f" {eh.comentario}"
    return texto


def _html_correo_candidato(eh: EntrevistaHumana, c: Postulacion) -> str:
    cuando = _fecha_hora_legible_mx(eh.fecha) if eh.fecha else "fecha por confirmar"
    detalle = _detalle_modalidad(eh, c)
    primer_nombre = c.nombre.split(" ")[0] if c.nombre else "candidato(a)"
    return (
        f"<p>¡Hola {primer_nombre}!</p>"
        f"<p>Te confirmamos tu entrevista con <strong>{eh.entrevistador or 'nuestro equipo de RH'}</strong> "
        f"el <strong>{cuando}</strong>, modalidad <strong>{eh.modalidad}</strong>.</p>"
        + (f"<p>{detalle}.</p>" if detalle else "")
        + (f"<p>{eh.comentario}</p>" if eh.comentario else "")
        + "<p>Saludos,<br>Red Human AI</p>"
    )


def _html_correo_entrevistador(eh: EntrevistaHumana, c: Postulacion) -> str:
    cuando = _fecha_hora_legible_mx(eh.fecha) if eh.fecha else "fecha por confirmar"
    detalle = _detalle_modalidad(eh, c)
    return (
        f"<p>Tienes una entrevista programada con <strong>{c.nombre}</strong> "
        f"({c.vacante.titulo if c.vacante else 'vacante sin especificar'}) "
        f"el <strong>{cuando}</strong>, modalidad <strong>{eh.modalidad}</strong>.</p>"
        + (f"<p>{detalle}.</p>" if detalle else "")
        + (f"<p>Teléfono del candidato: {c.telefono}</p>" if c.telefono else "")
        + (f"<p>{eh.comentario}</p>" if eh.comentario else "")
        + "<p>Saludos,<br>Red Human AI</p>"
    )


def _html_correo_evaluacion_entrevistador(eh: EntrevistaHumana, c: Postulacion, liga: str) -> str:
    return (
        f"<p>Gracias por entrevistar a <strong>{c.nombre}</strong> "
        f"({c.vacante.titulo if c.vacante else 'vacante sin especificar'}).</p>"
        "<p>Ayúdanos a registrar tu evaluación — te toma menos de un minuto:</p>"
        f"<p><a href=\"{liga}\">{liga}</a></p>"
        "<p>Saludos,<br>Red Human AI</p>"
    )


def _texto_solicitud_documentos(liga: str) -> str:
    return (
        "¡Felicidades por tu contratación! 🎉 Para avanzar, sube tu INE y tu comprobante de "
        f"domicilio (foto o PDF) desde esta liga: {liga}\n\nEn cuanto los reciba los reviso y "
        "seguimos con el resto de tu expediente."
    )


def _texto_recordatorio_documentos(liga: str) -> str:
    return (
        "Hola de nuevo 👋 Te escribo para dar seguimiento: ¿ya tienes a la mano tu INE y tu "
        f"comprobante de domicilio? Súbelos desde esta liga en cuanto puedas para no atrasar tu "
        f"proceso de ingreso: {liga}"
    )


# ------------------------------------------------------------
# Punto 23 — resolución de destinatarios: SIEMPRE del dato que ya existe, nunca captura nueva.
# ------------------------------------------------------------


def _correo_entrevistador(db: Session, eh: EntrevistaHumana) -> str:
    if eh.tipo == "interno" and eh.usuario_id:
        u = db.query(Usuario).filter(Usuario.id == eh.usuario_id).first()
        return u.correo if u else ""
    return eh.correo_externo


def _whatsapp_entrevistador(db: Session, eh: EntrevistaHumana) -> str:
    if eh.tipo == "interno" and eh.usuario_id:
        u = db.query(Usuario).filter(Usuario.id == eh.usuario_id).first()
        return u.telefono if u else ""
    return eh.whatsapp_externo


# ------------------------------------------------------------
# Punto 22/24/25 — el texto por (evento, audiencia, canal). Regresa None si esa combinación no
# tiene contenido definido (se omite sin error — nadie configura algo que no exista).
# ------------------------------------------------------------


def _mensaje(evento: str, audiencia: str, canal: str, c: Postulacion, eh: Optional[EntrevistaHumana], liga: str, extra: dict):
    v = c.vacante
    puesto = extra.get("puesto") or (v.titulo if v else "la vacante")
    primer_nombre = c.nombre.split(" ")[0] if c.nombre else "candidato(a)"
    cita = _texto_cita_entrevista_humana(eh, c) if eh else ""

    if evento == "entrevista_agendada" and eh:
        if audiencia == "candidato":
            texto = f"¡Hola {primer_nombre}! 📅 Con base en tu entrevista con Red Human, te programamos una entrevista {cita}"
            return texto if canal == "whatsapp" else ("Tu entrevista con Red Human AI", _html_correo_candidato(eh, c))
        if audiencia == "entrevistador":
            texto = f"Tienes una entrevista programada con {c.nombre} ({puesto}) {cita}"
            return texto if canal == "whatsapp" else (f"Entrevista programada con {c.nombre}", _html_correo_entrevistador(eh, c))
        if audiencia == "cliente":
            texto = f"Se programó una entrevista para el candidato {c.nombre} ({puesto}) {cita}"
            return texto if canal == "whatsapp" else (f"Entrevista programada — {puesto}", f"<p>{texto}</p>")

    if evento == "recordatorio_entrevista" and eh:
        if audiencia == "candidato":
            texto = f"¡Hola de nuevo, {primer_nombre}! 👋 Te recordamos tu entrevista {cita}"
            return texto if canal == "whatsapp" else ("Recordatorio de tu entrevista", f"<p>{texto}</p>")
        if audiencia == "entrevistador":
            texto = f"Recordatorio: tienes una entrevista con {c.nombre} ({puesto}) {cita}"
            return texto if canal == "whatsapp" else ("Recordatorio de entrevista", f"<p>{texto}</p>")
        if audiencia == "cliente":
            texto = f"Recordatorio: entrevista programada con {c.nombre} ({puesto}) {cita}"
            return texto if canal == "whatsapp" else ("Recordatorio de entrevista", f"<p>{texto}</p>")

    if evento == "entrevista_modificada" and eh:
        if audiencia == "candidato":
            texto = f"Hola {primer_nombre}, tu entrevista cambió — ahora es {cita}"
            return texto if canal == "whatsapp" else ("Tu entrevista fue modificada", f"<p>{texto}</p>")
        if audiencia == "entrevistador":
            texto = f"La entrevista con {c.nombre} ({puesto}) fue modificada — ahora es {cita}"
            return texto if canal == "whatsapp" else ("Entrevista modificada", f"<p>{texto}</p>")
        if audiencia == "cliente":
            texto = f"La entrevista con el candidato {c.nombre} ({puesto}) fue modificada — ahora es {cita}"
            return texto if canal == "whatsapp" else ("Entrevista modificada", f"<p>{texto}</p>")

    if evento == "entrevista_cancelada":
        if audiencia == "candidato":
            texto = f"Hola {primer_nombre}, tu entrevista programada fue cancelada. Nos pondremos en contacto para definir los siguientes pasos."
            return texto if canal == "whatsapp" else ("Tu entrevista fue cancelada", f"<p>{texto}</p>")
        if audiencia == "entrevistador":
            texto = f"La entrevista con {c.nombre} ({puesto}) fue cancelada."
            return texto if canal == "whatsapp" else ("Entrevista cancelada", f"<p>{texto}</p>")
        if audiencia == "cliente":
            texto = f"La entrevista con el candidato {c.nombre} ({puesto}) fue cancelada."
            return texto if canal == "whatsapp" else ("Entrevista cancelada", f"<p>{texto}</p>")

    if evento == "candidato_apto":
        if audiencia == "candidato":
            texto = f"¡Buenas noticias, {primer_nombre}! 🎉 Avanzas en el proceso para {puesto}."
            return texto if canal == "whatsapp" else ("¡Avanzas en el proceso!", f"<p>{texto}</p>")
        if audiencia == "cliente":
            texto = f"El candidato {c.nombre} avanza en el proceso para el puesto {puesto}."
            return texto if canal == "whatsapp" else (f"Avance de candidato — {puesto}", f"<p>{texto}</p>")

    if evento == "entrevista_humana_terminada" and eh:
        if audiencia == "entrevistador":
            liga_eval = f"{settings.app_url}/entrevista-humana/{eh.token}"
            texto = f"Gracias por entrevistar a {c.nombre} ({puesto}). Ayúdanos a registrar tu evaluación: {liga_eval}"
            return texto if canal == "whatsapp" else (f"Tu evaluación de la entrevista con {c.nombre}", _html_correo_evaluacion_entrevistador(eh, c, liga_eval))
        if audiencia == "candidato":
            texto = f"¡Gracias, {primer_nombre}! Terminamos tu entrevista para {puesto}. El equipo de RH revisará tus resultados y te contactará pronto."
            return texto if canal == "whatsapp" else ("Terminamos tu entrevista", f"<p>{texto}</p>")
        if audiencia == "cliente":
            texto = f"El candidato {c.nombre} completó su entrevista humana para el puesto {puesto}."
            return texto if canal == "whatsapp" else (f"Entrevista completada — {puesto}", f"<p>{texto}</p>")

    if evento == "recomendacion_final" and eh:
        resultado_legible = "Aprobado" if eh.resultado == "aprobado" else "No aprobado"
        if audiencia == "cliente":
            texto = f"La recomendación final para el candidato {c.nombre} ({puesto}) ya está disponible: {resultado_legible}."
            return texto if canal == "whatsapp" else (f"Recomendación final — {puesto}", f"<p>{texto}</p>")
        if audiencia == "candidato":
            texto = f"Hola {primer_nombre}, ya tenemos una recomendación sobre tu proceso para {puesto}. El equipo de RH se pondrá en contacto contigo."
            return texto if canal == "whatsapp" else ("Novedades de tu proceso", f"<p>{texto}</p>")
        if audiencia == "entrevistador":
            texto = f"Se registró la recomendación final para {c.nombre} ({puesto}): {resultado_legible}."
            return texto if canal == "whatsapp" else (f"Recomendación registrada — {c.nombre}", f"<p>{texto}</p>")

    if evento == "contratacion":
        ingreso = ""
        fecha_ingreso = extra.get("fecha_ingreso")
        if fecha_ingreso:
            ingreso = f" Te esperamos el {fecha_ingreso.day}."
        if audiencia == "candidato":
            texto = f"¡Bienvenido(a) {primer_nombre}! 🎊 Tu expediente quedó completo y tu alta fue autorizada.{ingreso} En los próximos días te comparto tu plan de inducción."
            return texto if canal == "whatsapp" else ("¡Bienvenido(a) al equipo!", f"<p>{texto}</p>")
        if audiencia == "cliente":
            texto = f"El candidato {c.nombre} fue contratado para el puesto {puesto}.{ingreso}"
            return texto if canal == "whatsapp" else (f"Contratación confirmada — {puesto}", f"<p>{texto}</p>")

    if evento == "solicitud_documentos":
        if audiencia == "candidato":
            texto = _texto_solicitud_documentos(liga)
            return texto if canal == "whatsapp" else ("Solicitud de documentos", f"<p>{texto}</p>")

    if evento == "recordatorio_documentos":
        if audiencia == "candidato":
            pendientes = extra.get("pendientes")
            if pendientes is not None:
                # contratacion.py::recordatorio — lista lo que falta del Expediente en curso.
                detalle_rechazos = extra.get("detalle_rechazos", "")
                texto = (
                    f"Hola {primer_nombre} 👋 Para completar tu expediente de {puesto} "
                    f"me falta recibir: {', '.join(pendientes)}."
                    + (f"\n\nAlgunos necesitan volver a enviarse:{detalle_rechazos}" if detalle_rechazos else "")
                    + "\n\nMándalos por aquí cuando puedas. 🙌"
                )
            else:
                # candidatos.py::recordatorio_documentos — liga pública genérica de subida.
                texto = _texto_recordatorio_documentos(liga)
            return texto if canal == "whatsapp" else ("Recordatorio de documentos", f"<p>{texto}</p>")

    return None


def _regla(db: Session, cuenta_id: int, evento: str) -> Optional[ReglaNotificacion]:
    return db.query(ReglaNotificacion).filter(
        ReglaNotificacion.cuenta_id == cuenta_id, ReglaNotificacion.evento == evento
    ).first()


async def _enviar_y_registrar(
    db: Session, p: Postulacion, evento: str, destinatario_tipo: str, canal: str, destino: str, contenido,
) -> dict:
    """Regresa {destinatario, canal, destino, enviado, proveedor, detalle} — Fase 7A: el detalle de
    por qué NO salió un envío (sin correo, RESEND_API_KEY sin configurar, Meta rechazó…) ya no se
    queda solo en NotificacionEnviada: llega hasta la respuesta para que RH lo vea."""
    cuenta_id, candidato_id = p.cuenta_id, p.candidato_id
    base = {"destinatario": destinatario_tipo, "canal": canal, "destino": destino or ""}
    if not destino or not contenido:
        detalle = "sin dato de contacto" if not destino else "sin contenido definido para esta combinación"
        db.add(NotificacionEnviada(
            cuenta_id=cuenta_id, candidato_id=candidato_id, evento=evento, destinatario_tipo=destinatario_tipo,
            canal=canal, destino=destino or "", enviado=False, detalle=detalle,
        ))
        return {**base, "enviado": False, "detalle": detalle}
    try:
        if canal == "whatsapp":
            envio = await enviar_mensaje(destino, contenido)
        else:
            asunto, html = contenido
            envio = await enviar_correo(destino, asunto, html)
    except Exception as ex:  # que un proveedor falle no debe tumbar el flujo que disparó el evento
        envio = {"enviado": False, "proveedor": "error", "detalle": str(ex)}
    db.add(NotificacionEnviada(
        cuenta_id=cuenta_id, candidato_id=candidato_id, evento=evento, destinatario_tipo=destinatario_tipo,
        canal=canal, destino=destino, enviado=bool(envio.get("enviado")), detalle=str(envio.get("detalle", "")),
    ))
    if destinatario_tipo == "candidato" and canal == "whatsapp":
        # Mensaje saliente: queda en el historial de ESTA postulación pero NO mueve la
        # conversación del candidato (B1, ver candidatos.fijar_conversacion).
        db.add(Mensaje(
            candidato_id=candidato_id, postulacion_id=p.id, rol="assistant", texto=contenido, canal="whatsapp",
            enviado=bool(envio.get("enviado")), wa_id=envio.get("wa_id", ""),
        ))
    return {**base, **envio, "detalle": str(envio.get("detalle", ""))}


FLAGS_NOTIFICACION = (
    "candidato_correo", "candidato_whatsapp",
    "entrevistador_correo", "entrevistador_whatsapp",
    "cliente_correo", "cliente_whatsapp",
)


class NotificarIn(BaseModel):
    """Cuerpo opcional `notificar` de las acciones manuales (Punto 12): lo que RH ajustó en la
    línea "Notificar: … · Editar" solo para esta acción. None = usar la regla predeterminada."""
    candidato_correo: Optional[bool] = None
    candidato_whatsapp: Optional[bool] = None
    entrevistador_correo: Optional[bool] = None
    entrevistador_whatsapp: Optional[bool] = None
    cliente_correo: Optional[bool] = None
    cliente_whatsapp: Optional[bool] = None
    # Fase 7A: contactos del Cliente elegidos por RH para ESTA acción (ids de ClienteContacto).
    # None = todos los contactos del Cliente (comportamiento de Fase D).
    cliente_contactos_ids: Optional[List[int]] = None


def override_de(datos: Optional[NotificarIn]) -> Optional[dict]:
    """Dict con los flags explícitos (los None se omiten) o None si no se ajustó nada."""
    if datos is None:
        return None
    valores = {k: v for k, v in datos.model_dump().items() if v is not None}
    return valores or None


class _ReglaEfectiva:
    """Regla predeterminada de la Cuenta + override de UNA acción (Punto 12). Los flags que el
    override no menciona (None) conservan el valor de la regla guardada; la regla en sí nunca se
    modifica desde aquí."""

    def __init__(self, regla: Optional[ReglaNotificacion], override: Optional[dict]):
        for flag in FLAGS_NOTIFICACION:
            valor = (override or {}).get(flag)
            if valor is None:
                valor = bool(getattr(regla, flag)) if regla else False
            setattr(self, flag, bool(valor))
        ids = (override or {}).get("cliente_contactos_ids")
        self.cliente_contactos_ids: Optional[List[int]] = [int(x) for x in ids] if ids is not None else None

    def alguno(self) -> bool:
        return any(getattr(self, f) for f in FLAGS_NOTIFICACION)


async def disparar(
    db: Session,
    evento: str,
    c: Postulacion,
    actor: str,
    *,
    eh: Optional[EntrevistaHumana] = None,
    liga: str = "",
    extra: Optional[dict] = None,
    override: Optional[dict] = None,
) -> List[dict]:
    """Punto único de entrada del sistema de notificaciones (Fase D). Nunca truena: si falta la
    Cuenta, la regla, o el dato de contacto, simplemente no manda ese envío en particular.

    `override` (Punto 12): flags que RH ajustó SOLO para esta acción desde la línea
    "Notificar: … · Editar"; sustituyen a la regla guardada únicamente en esta llamada. Los
    eventos automáticos (transición a apto, no-show, liga externa) nunca mandan override."""
    extra = extra or {}
    if not c.cuenta_id:
        return []
    regla_guardada = _regla(db, c.cuenta_id, evento)
    if not regla_guardada and not override:
        return []
    regla = _ReglaEfectiva(regla_guardada, override)
    if not regla.alguno():
        return []
    eh = eh or (c.entrevistas_humanas[-1] if c.entrevistas_humanas else None)

    resultados: List[dict] = []

    # --- Candidato: correo/teléfono ya en su ficha (punto 23) ---
    if regla.candidato_whatsapp:
        texto = _mensaje(evento, "candidato", "whatsapp", c, eh, liga, extra)
        resultados.append(await _enviar_y_registrar(db, c, evento, "candidato", "whatsapp", c.telefono, texto))
    if regla.candidato_correo:
        contenido = _mensaje(evento, "candidato", "correo", c, eh, liga, extra)
        resultados.append(await _enviar_y_registrar(db, c, evento, "candidato", "correo", c.correo, contenido))

    # --- Entrevistador: Usuario si es interno, datos ya registrados en la EntrevistaHumana si
    # es externo (punto 23) — sin ronda vigente no hay a quién resolver, se omite. ---
    if eh and (regla.entrevistador_whatsapp or regla.entrevistador_correo):
        if regla.entrevistador_whatsapp:
            texto = _mensaje(evento, "entrevistador", "whatsapp", c, eh, liga, extra)
            resultados.append(await _enviar_y_registrar(
                db, c, evento, "entrevistador", "whatsapp", _whatsapp_entrevistador(db, eh), texto
            ))
        if regla.entrevistador_correo:
            contenido = _mensaje(evento, "entrevistador", "correo", c, eh, liga, extra)
            resultados.append(await _enviar_y_registrar(
                db, c, evento, "entrevistador", "correo", _correo_entrevistador(db, eh), contenido
            ))

    # --- Cliente: TODOS los contactos ya registrados en ClienteContacto (punto 23) — si la
    # vacante no tiene Cliente, se ignora en silencio sin importar la regla (punto 26). ---
    cliente_id = c.vacante.cliente_id if c.vacante else None
    if cliente_id and (regla.cliente_whatsapp or regla.cliente_correo):
        q = db.query(ClienteContacto).filter(ClienteContacto.cliente_id == cliente_id)
        if regla.cliente_contactos_ids is not None:
            # Fase 7A: solo los contactos que RH marcó para esta acción (nunca se capturan datos nuevos)
            q = q.filter(ClienteContacto.id.in_(regla.cliente_contactos_ids))
        contactos = q.all()
        for contacto in contactos:
            if regla.cliente_whatsapp:
                texto = _mensaje(evento, "cliente", "whatsapp", c, eh, liga, extra)
                resultados.append(await _enviar_y_registrar(
                    db, c, evento, "cliente", "whatsapp", contacto.telefono, texto
                ))
            if regla.cliente_correo:
                contenido = _mensaje(evento, "cliente", "correo", c, eh, liga, extra)
                resultados.append(await _enviar_y_registrar(
                    db, c, evento, "cliente", "correo", contacto.correo, contenido
                ))

    db.flush()
    return resultados
