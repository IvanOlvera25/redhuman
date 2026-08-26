"""Webhook de entrada de WhatsApp (ruta 2 de captación, módulo 2.1).

Meta · WhatsApp Cloud API (WHATSAPP_PROVIDER=meta)
  1. En developers.facebook.com → tu app → WhatsApp → Configuración → Webhook:
       URL de devolución de llamada:  https://api.tudominio.mx/webhooks/whatsapp
       Token de verificación:         el valor de META_VERIFY_TOKEN
     Meta pega un GET a esa URL y espera de vuelta el hub.challenge (abajo).
  2. Suscríbete al campo "messages".
  3. Copia el App Secret de la app a META_APP_SECRET para que se valide la
     firma de cada POST; si no, cualquiera puede inyectar mensajes falsos.
  · La URL debe ser HTTPS pública: por eso esto no funciona en localhost.

Gateway propio
  · WAHA:      apunta WHATSAPP_HOOK_URL a la misma ruta (evento "message")
  · Evolution: webhook por instancia → misma URL (evento "messages.upsert")
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal, get_db
from ..deps import usuario_actual
from ..models import Bitacora, Candidato, Mensaje, Usuario, Vacante, registrar
from ..routers.candidatos import procesar_prefiltro
from ..services.whatsapp import clave_telefono, enviar_mensaje, firma_valida, parsear_webhook

router = APIRouter(tags=["webhooks"])

# Lo que se le contesta a quien manda una foto o un PDF: todavía no leemos
# adjuntos por WhatsApp, pero el mensaje sí queda en el expediente de RH.
AVISO_ADJUNTO = (
    "Recibí tu archivo 📎 Por ahora solo puedo leer mensajes de texto; "
    "una persona del equipo de RH lo va a revisar. Si quieres seguir, "
    "escríbeme tu respuesta en texto."
)


@router.get("/webhooks/whatsapp")
def whatsapp_verificacion(request: Request):
    """Handshake que Meta pide una sola vez al dar de alta el webhook."""
    params = request.query_params
    modo = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge", "")

    if modo == "subscribe" and settings.meta_verify_token and token == settings.meta_verify_token:
        return PlainTextResponse(challenge)
    raise HTTPException(403, "Token de verificación inválido.")


@router.post("/webhooks/whatsapp")
async def whatsapp_entrante(
    request: Request,
    tareas: BackgroundTasks,
    db: Session = Depends(get_db),
):
    crudo = await request.body()

    # Meta firma cada POST. Si tenemos el App Secret, se exige la firma;
    # sin él, se procesa igual pero queda avisado en el log (endpoint abierto).
    if settings.whatsapp_provider == "meta":
        if settings.meta_app_secret:
            if not firma_valida(crudo, request.headers.get("x-hub-signature-256", "")):
                raise HTTPException(403, "Firma inválida.")
        else:
            print("[whatsapp] AVISO: META_APP_SECRET vacío — el webhook acepta POST sin firmar.")

    try:
        payload = await request.json()
    except Exception:
        return {"ok": True, "ignorado": "cuerpo no es JSON"}

    msg = parsear_webhook(payload)
    if not msg:
        return {"ok": True, "ignorado": True}  # acuses de entrega, eventos de estado, etc.

    # Meta reintenta el webhook si tardamos en contestar: no procesar dos veces.
    if msg.get("wa_id") and db.query(Mensaje).filter(Mensaje.wa_id == msg["wa_id"]).first():
        return {"ok": True, "duplicado": msg["wa_id"]}

    telefono = clave_telefono(msg["telefono"])
    if not telefono:
        return {"ok": True, "ignorado": "sin teléfono"}

    c = db.query(Candidato).filter(Candidato.telefono == telefono).first()
    if not c:
        # candidato nuevo que llega por WhatsApp: se registra y se liga a la
        # vacante publicada más reciente (o se le pregunta cuál le interesa)
        vac = (
            db.query(Vacante)
            .filter(Vacante.estado == "Publicada")
            .order_by(Vacante.id.desc())
            .first()
        )
        c = Candidato(
            codigo="TMP",
            nombre=msg["nombre"] or f"Candidato {telefono[-4:]}",
            telefono=telefono,
            fuente="WhatsApp",
            vacante_id=vac.id if vac else None,
            consentimiento=True,  # el candidato inició la conversación
        )
        db.add(c)
        db.flush()
        c.codigo = f"C-{8800 + c.id}"
        registrar(db, "sistema", "candidato_ingresado", "candidato", c.codigo, {"fuente": "WhatsApp", "via": "webhook"})
        db.commit()

    # Adjuntos: se registran en la conversación, pero el agente no los interpreta.
    if not (msg.get("texto") or "").strip():
        db.add(Mensaje(
            candidato_id=c.id,
            rol="user",
            texto=f"[{msg.get('tipo', 'adjunto')} recibido por WhatsApp]",
            canal="whatsapp",
            wa_id=msg.get("wa_id", ""),
        ))
        db.commit()
        tareas.add_task(_responder_adjunto, c.id, c.telefono)
        return {"ok": True, "candidato": c.codigo, "adjunto": msg.get("tipo")}

    # El prefiltro llama a OpenAI y puede tardar varios segundos. Meta reintenta
    # si no ve un 200 rápido, así que se contesta ya y se procesa aparte.
    tareas.add_task(_procesar_en_segundo_plano, c.id, msg["texto"], msg.get("wa_id", ""))
    return {"ok": True, "candidato": c.codigo, "encolado": True}


async def _procesar_en_segundo_plano(candidato_id: int, texto: str, wa_id: str) -> None:
    """Corre el turno del agente con su propia sesión (la del request ya cerró)."""
    with SessionLocal() as db:
        c = db.get(Candidato, candidato_id)
        if not c:
            return
        try:
            await procesar_prefiltro(db, c, texto, "whatsapp", wa_id=wa_id)
        except Exception as e:  # el webhook ya contestó 200; solo dejamos rastro
            db.rollback()
            print(f"[whatsapp] falló el prefiltro del candidato {candidato_id}: {e}")


async def _responder_adjunto(candidato_id: int, telefono: str) -> None:
    envio = await enviar_mensaje(telefono, AVISO_ADJUNTO)
    with SessionLocal() as db:
        db.add(Mensaje(
            candidato_id=candidato_id,
            rol="assistant",
            texto=AVISO_ADJUNTO,
            canal="whatsapp",
            enviado=envio["enviado"],
            wa_id=envio.get("wa_id", ""),
        ))
        db.commit()


@router.get("/bitacora")
def bitacora(limite: int = 50, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """Últimos eventos de auditoría con su cadena de hashes."""
    filas = db.query(Bitacora).order_by(Bitacora.id.desc()).limit(limite).all()
    return [
        {
            "id": b.id,
            "ts": b.ts.isoformat(),
            "actor": b.actor,
            "accion": b.accion,
            "entidad": b.entidad,
            "entidad_id": b.entidad_id,
            "detalle": b.detalle,
            "hash": b.hash,
            "hash_prev": b.hash_prev,
        }
        for b in filas
    ]
