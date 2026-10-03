"""Avisos de actividades a cada destinatario por su función (Fraiche, cambios integrados 2026-10-02 §1, §4, §9).

* Un aviso = un destinatario con su ROL (candidato, entrevistador, responsable, médico…), su texto y SU liga. Sale por
  el canal de mensajería (WhatsApp o Telegram) y por correo con lo que haya; nunca se omite porque otro rol comparta el
  número: cada aviso se manda por separado y, si no es para el candidato, va encabezado con el rol para no mezclarlo
  con la conversación del candidato (y no se guarda en su chat).
* Estado REAL por envío: `enviado` · `pendiente` (el contacto aún no vincula su chat: se guarda en `AvisoPendiente` y
  se entrega solo, una vez, cuando se vincule) · `fallido` (con el motivo). La lista se guarda en el `envios` del
  registro (entrevista, evaluación) para mostrarla con Copiar liga / Reenviar.
* Un canal caído NUNCA rompe la acción que disparó el aviso.
"""

from datetime import datetime, timezone
from typing import List, Optional

from ..config import settings

ROLES = {
    "candidato": "Candidato",
    "entrevistador": "Entrevistador",
    "responsable": "Responsable de la evaluación",
    "medico": "Médico",
    "franquiciatario": "Franquiciatario",
    "rh": "Recursos Humanos",
}


def estado_de(r: dict) -> str:
    if r.get("enviado"):
        return "enviado"
    if r.get("sin_vinculo"):
        return "pendiente"
    return "fallido"


def _encabezado(rol: str, texto: str) -> str:
    """En Telegram un mismo número puede ser candidato Y entrevistador (modo prueba): el aviso que no es para el
    candidato se identifica por rol."""
    if rol == "candidato":
        return texto
    return f"📋 Aviso para {ROLES.get(rol, rol).lower()}:\n{texto}"


async def _mensaje(telefono: str, texto: str) -> dict:
    from .whatsapp import enviar_mensaje

    try:
        return await enviar_mensaje(telefono, texto)
    except Exception as ex:  # noqa: BLE001
        return {"enviado": False, "detalle": str(ex)[:200]}


async def _correo(correo: str, asunto: str, html: str, adjuntos: Optional[List[dict]] = None) -> dict:
    from .correo import enviar_correo

    try:
        return await (enviar_correo(correo, asunto, html, adjuntos=adjuntos) if adjuntos else enviar_correo(correo, asunto, html))
    except Exception as ex:  # noqa: BLE001
        return {"enviado": False, "detalle": str(ex)[:200]}


def encolar_pendiente(db, telefono: str, rol: str, texto: str, referencia: str = "") -> bool:
    """Guarda el aviso para entregarlo al vincular. Regresa True si es el PRIMER pendiente de ese número (solo
    entonces se le pide vincular: «solicitarlo una vez»)."""
    from ..models import AvisoPendiente
    from .telegram import clave

    tel = clave(telefono)
    if not tel:
        return False
    previos = db.query(AvisoPendiente).filter(AvisoPendiente.telefono == tel, AvisoPendiente.entregado_en.is_(None)).all()
    if not any(a.texto == texto for a in previos):
        db.add(AvisoPendiente(telefono=tel, rol=rol, texto=texto, referencia=referencia[:60]))
    return not previos


async def entregar_pendientes(db, telefono: str) -> int:
    """Al vincular un chat: manda los avisos que esperaban a ese teléfono (en orden, una sola vez)."""
    from ..models import AvisoPendiente
    from .telegram import clave

    tel = clave(telefono)
    n = 0
    for a in db.query(AvisoPendiente).filter(AvisoPendiente.telefono == tel, AvisoPendiente.entregado_en.is_(None)).order_by(AvisoPendiente.id).all():
        r = await _mensaje(tel, a.texto)
        if r.get("enviado"):
            a.entregado_en = datetime.now(timezone.utc)
            n += 1
    return n


async def avisar(
    db, *, rol: str, nombre: str = "", telefono: str = "", correo: str = "", asunto: str, texto: str,
    liga: str = "", cta: str = "Abrir", empresa: str = "", filas: Optional[list] = None, evento: str = "",
    referencia: str = "", postulacion=None, adjuntos: Optional[List[dict]] = None, canales: tuple = ("whatsapp", "correo"),
) -> List[dict]:
    """Manda UN aviso a UN destinatario por sus canales. Regresa [{fecha, evento, destinatario, nombre, canal,
    destino, enviado, estado, detalle}]. `texto` ya trae la liga si aplica (para el mensaje de chat)."""
    from . import canal as _canal
    from . import plantillas_correo

    ahora = datetime.now(timezone.utc).isoformat()
    salida: List[dict] = []
    base = {"fecha": ahora, "evento": evento, "destinatario": rol, "nombre": nombre or ""}
    if "whatsapp" in canales:
        if telefono:
            cuerpo = _encabezado(rol, texto)
            r = await _mensaje(telefono, cuerpo)
            if r.get("sin_vinculo"):
                from .telegram import liga_vinculo

                primera = encolar_pendiente(db, telefono, rol, cuerpo, referencia)
                liga_tg = liga_vinculo(telefono, "R" if rol != "candidato" else "")
                r = {**r, "detalle": f"Falta que vincule su chat: se entregará en cuanto lo haga. Liga para vincularlo: {liga_tg}", "ligaVinculo": liga_tg}
                if primera and correo and rol != "candidato":
                    texto = f"{texto}\n\nPara recibir estos avisos en {_canal.nombre()}, vincula tu chat una sola vez: {liga_tg}"
            if rol == "candidato" and postulacion is not None:
                from ..models import Mensaje

                db.add(Mensaje(candidato_id=postulacion.candidato_id, postulacion_id=postulacion.id, rol="assistant", texto=texto,
                               canal="whatsapp", enviado=bool(r.get("enviado")), wa_id=r.get("wa_id", "") or ""))
            salida.append({**base, "canal": "whatsapp", "canalNombre": _canal.nombre(), "destino": telefono, "enviado": bool(r.get("enviado")),
                           "estado": estado_de(r), "detalle": str(r.get("detalle") or "")[:400], "ligaVinculo": r.get("ligaVinculo") or ""})
        else:
            salida.append({**base, "canal": "whatsapp", "canalNombre": _canal.nombre(), "destino": "", "enviado": False, "estado": "fallido",
                           "detalle": f"Sin número de {_canal.nombre()} registrado"})
    if "correo" in canales and correo:
        try:
            parrafo = texto.replace(liga, "").strip() if liga else texto
            asunto_html, html = plantillas_correo.html_aviso(asunto, parrafo, empresa, filas or [], (cta, liga) if liga else None)
            r = await _correo(correo, asunto_html, html, adjuntos)
        except Exception as ex:  # noqa: BLE001
            r = {"enviado": False, "detalle": str(ex)[:200]}
        salida.append({**base, "canal": "correo", "canalNombre": "Correo", "destino": correo, "enviado": bool(r.get("enviado")),
                       "estado": estado_de(r), "detalle": str(r.get("detalle") or "")[:300]})
    return salida


def registrar_envios(obj, envios: List[dict]) -> None:
    """Agrega los envíos al historial `envios` del registro (sin perder los anteriores)."""
    obj.envios = list(obj.envios or []) + [dict(e) for e in envios]


def resumen(envios: List[dict]) -> str:
    """«enviado» si algún canal salió; «pendiente» si alguno espera vínculo; si no «fallido»; «» si no hubo envíos."""
    if not envios:
        return ""
    estados = {e.get("estado") for e in envios}
    return "enviado" if "enviado" in estados else "pendiente" if "pendiente" in estados else "fallido"


def app_url() -> str:
    return settings.app_url.rstrip("/")
