"""Webhook de entrada de WhatsApp (ruta 2 de captación, módulo 2.1).

Configura tu gateway para apuntar aquí:
  · WAHA:      WHATSAPP_HOOK_URL=http://tu-api:8000/webhooks/whatsapp  (evento "message")
  · Evolution: webhook por instancia → misma URL (evento "messages.upsert")
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import usuario_actual
from ..models import Bitacora, Candidato, Usuario, Vacante, registrar
from ..routers.candidatos import procesar_prefiltro
from ..services.whatsapp import parsear_webhook

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/whatsapp")
async def whatsapp_entrante(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    msg = parsear_webhook(payload)
    if not msg:
        return {"ok": True, "ignorado": True}

    c = db.query(Candidato).filter(Candidato.telefono == msg["telefono"]).first()
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
            nombre=msg["nombre"] or f"Candidato {msg['telefono'][-4:]}",
            telefono=msg["telefono"],
            fuente="WhatsApp",
            vacante_id=vac.id if vac else None,
            consentimiento=True,  # el candidato inició la conversación
        )
        db.add(c)
        db.flush()
        c.codigo = f"C-{8800 + c.id}"
        registrar(db, "sistema", "candidato_ingresado", "candidato", c.codigo, {"fuente": "WhatsApp", "via": "webhook"})
        db.commit()

    resultado = await procesar_prefiltro(db, c, msg["texto"], "whatsapp")
    return {"ok": True, "candidato": c.codigo, **resultado}


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
