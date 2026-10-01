"""Verificación Telegram como canal (2026-10-01): vinculación por «Compartir mi número» y por liga firmada,
/start con vacante, agente de prefiltro completo por Telegram, botones (callback), envío a un teléfono sin
vincular (falla con motivo claro), secret token del webhook y la liga en /postular. La API de Telegram se
simula (nunca sale nada a internet). Base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_telegram.py
"""

import asyncio
import os
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
_dir = tempfile.mkdtemp(prefix="rh_tg_")
DB_URL = "sqlite:///" + str(Path(_dir) / "tg.db")
os.environ.update({"DATABASE_URL": DB_URL, "SEMBRAR_DEMO": "false", "ADMIN_PASSWORD": "prueba-tg", "WHATSAPP_PROVIDER": "telegram",
                   "TELEGRAM_BOT_TOKEN": "123:abc", "TELEGRAM_BOT_USERNAME": "FraicheDemoBot", "TELEGRAM_WEBHOOK_SECRET": "s3cr3t",
                   "FRAICHE_PUBLICACION_ESTRICTA": "false"})
for k in ("OPENAI_API_KEY", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "RESEND_API_KEY", "ANAM_API_KEY"):
    os.environ[k] = ""

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "cargar_demo_fraiche.py"), "--ejecutar"], capture_output=True, text=True,
                   env={**os.environ}, cwd=str(RAIZ))
check(r.returncode == 0, f"datos demo cargados\n{r.stderr[-300:]}")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Candidato, Mensaje, Postulacion, Vacante, VinculoTelegram  # noqa: E402
from app.routers import webhooks  # noqa: E402
from app.services import canal, telegram as tg, whatsapp  # noqa: E402

ENVIADOS = []


async def api_falsa(metodo, datos=None, timeout=20):
    ENVIADOS.append((metodo, datos or {}))
    if metodo == "sendMessage":
        return {"ok": True, "result": {"message_id": len(ENVIADOS)}}
    return {"ok": True, "result": {}}


tg.api = api_falsa
check(canal.nombre() == "Telegram" and whatsapp.proveedor() == "telegram", "el canal visible es «Telegram» y el proveedor efectivo es telegram")


def textos(chat):
    return [d.get("text", "") for m, d in ENVIADOS if m == "sendMessage" and str(d.get("chat_id")) == str(chat)]


def turno(update):
    asyncio.run(webhooks._turno_telegram(update))


UID = [1000]


def msg(chat, texto=None, **extra):
    UID[0] += 1
    m = {"message_id": UID[0], "chat": {"id": chat, "type": "private"}, "from": {"id": chat, "first_name": "Ana", "last_name": "Prueba", "username": "anaprueba"}}
    if texto is not None:
        m["text"] = texto
    m.update(extra)
    return {"update_id": UID[0], "message": m}


with TestClient(app) as client:
    # secret token
    check(client.post("/webhooks/telegram", json={"update_id": 1}).status_code == 403, "webhook sin secret token → 403")
    check(client.post("/webhooks/telegram", json={"update_id": 1}, headers={"X-Telegram-Bot-Api-Secret-Token": "s3cr3t"}).status_code == 200, "webhook con secret token → 200")

    db = SessionLocal()
    v = db.query(Vacante).filter(Vacante.estado == "Publicada").first()
    db.close()

    # 1) /start con vacante, sin vincular → pide el número
    CHAT = 555001
    turno(msg(CHAT, f"/start {v.codigo}"))
    t = textos(CHAT)
    check(t and "Compartir mi número" in t[-1], "/start sin vincular → pide «Compartir mi número»")
    check(any(d.get("reply_markup", {}).get("keyboard", [[{}]])[0][0].get("request_contact") for m, d in ENVIADOS if m == "sendMessage"), "el teclado usa el botón nativo request_contact")

    # 2) comparte el contacto de OTRA persona → no vincula
    turno(msg(CHAT, contact={"phone_number": "+525511112222", "user_id": 999}))
    db = SessionLocal()
    check(not (db.query(VinculoTelegram).filter(VinculoTelegram.chat_id == str(CHAT)).first().telefono), "un contacto ajeno no vincula")
    db.close()

    # 3) comparte SU número → vincula y arranca con la vacante del /start (aviso de privacidad)
    turno(msg(CHAT, contact={"phone_number": "+52 1 55 4444 3333", "user_id": CHAT}))
    db = SessionLocal()
    vin = db.query(VinculoTelegram).filter(VinculoTelegram.chat_id == str(CHAT)).first()
    check(vin.telefono == "5544443333", "su propio número queda vinculado a 10 dígitos")
    p = db.query(Postulacion).join(Candidato, Candidato.id == Postulacion.candidato_id).filter(Candidato.telefono.like("%5544443333")).first()
    check(p is not None and p.vacante_id == v.id, "la vacante del /start queda elegida en la postulación")
    check(p.candidato.fuente == "Telegram", "la persona nace con fuente «Telegram»")
    db.close()
    check(any("Autorizas" in x or "autorización" in x for x in textos(CHAT)), "se manda el aviso de privacidad (elegir vacante nunca es consentimiento)")

    # 4) acepta → arranca el filtro
    antes = len(textos(CHAT))
    turno(msg(CHAT, "Sí, acepto"))
    db = SessionLocal()
    p = db.query(Postulacion).join(Candidato, Candidato.id == Postulacion.candidato_id).filter(Candidato.telefono.like("%5544443333")).first()
    check(p.consentimiento, "«Sí, acepto» registra el consentimiento")
    check(len(textos(CHAT)) > antes, "el agente manda la primera pregunta del filtro por Telegram")
    check(db.query(Mensaje).filter(Mensaje.postulacion_id == p.id).count() >= 3, "la conversación queda en la ficha de la postulación")
    db.close()

    # 5) texto sin vincular desde otro chat → pide número
    turno(msg(777, "hola"))
    check("Compartir mi número" in textos(777)[-1], "un chat sin vincular que escribe recibe la petición de número")

    # 6) enviar a un teléfono sin vincular → falla con motivo claro
    res = asyncio.run(whatsapp.enviar_mensaje("5599998888", "hola"))
    check(not res["enviado"] and "no ha vinculado Telegram" in res["detalle"] and res.get("sin_vinculo"), "enviar a un número sin vincular no truena y explica el motivo")
    res = asyncio.run(whatsapp.enviar_mensaje("5544443333", "*hola* <b>"))
    ultimo = [d for m, d in ENVIADOS if m == "sendMessage"][-1]
    check(res["enviado"] and ultimo["text"] == "<b>hola</b> &lt;b&gt;" and ultimo["parse_mode"] == "HTML", "el marcado *negritas* se convierte a HTML y lo demás se escapa")

    # 7) liga firmada → vincula sin pedir número; manipulada → no
    liga = tg.liga_vinculo("5533332222", "P8899")
    payload = liga.split("start=")[1]
    check(liga.startswith("https://t.me/FraicheDemoBot?start=L-5533332222-P8899-") and len(payload) <= 64, "liga firmada t.me/<bot>?start=… de ≤ 64 caracteres")
    turno(msg(888, f"/start {payload}"))
    db = SessionLocal()
    check(db.query(VinculoTelegram).filter(VinculoTelegram.chat_id == "888").first().telefono == "5533332222", "la liga firmada vincula el chat sin compartir el número")
    db.close()
    turno(msg(889, "/start L-5500000000-P8899-" + payload[-12:]))
    db = SessionLocal()
    vv = db.query(VinculoTelegram).filter(VinculoTelegram.chat_id == "889").first()
    check(vv is None or not vv.telefono, "una liga con el teléfono alterado NO vincula")
    db.close()

    # 8) botones: lista → inline keyboard; callback → selección
    ENVIADOS.clear()
    res = asyncio.run(whatsapp.enviar_lista_interactiva("5544443333", "Vacantes", "Elige una", "Ver", [{"id": "VAC-1", "titulo": "Cajero", "descripcion": "Sur"}]))
    kb = [d for m, d in ENVIADOS if m == "sendMessage"][-1]["reply_markup"]["inline_keyboard"]
    check(res["enviado"] and kb[0][0]["callback_data"] == "VAC-1", "la lista interactiva sale como botones en línea con el código de la opción")
    turno({"update_id": 99999, "callback_query": {"id": "cb1", "data": v.codigo, "from": {"id": 888, "first_name": "Luis"}, "message": {"chat": {"id": 888, "type": "private"}}}})
    check(any(m == "answerCallbackQuery" for m, _ in ENVIADOS), "el callback se contesta (quita el «cargando» del botón)")
    db = SessionLocal()
    p2 = db.query(Postulacion).join(Candidato, Candidato.id == Postulacion.candidato_id).filter(Candidato.telefono.like("%5533332222")).first()
    check(p2 is not None and p2.vacante_id == v.id, "tocar el botón elige la vacante igual que la lista de WhatsApp")
    db.close()

    # 9) /postular regresa la liga firmada y el portal la liga de la vacante
    from app.deps import cuenta_actual  # noqa: F401

    r = client.post("/candidatos/postular", data={"vacante": v.slug or v.codigo, "nombre": "Beto Web", "telefono": "5522221111", "correo": "beto@demo.invalid", "consentimiento": "true"})
    check(r.status_code == 201 and r.json().get("ligaTelegram", "").startswith("https://t.me/FraicheDemoBot?start=L-5522221111-"), "/postular regresa la liga para continuar en Telegram")
    pub = client.get("/vacantes/publicas").json()
    check(pub and pub[0].get("ligaTelegram", "").startswith("https://t.me/FraicheDemoBot?start=VAC-"), "las vacantes públicas traen su liga de Telegram")

print(f"\n🎉 Telegram verificado: {OK} comprobaciones OK.")
