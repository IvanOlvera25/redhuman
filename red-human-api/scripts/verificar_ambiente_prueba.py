"""Validación «Modo prueba general en ambientes de desarrollo y demo» (2026-10-02).

Con la MISMA cuenta de Telegram: completar un proceso, reiniciarlo y realizarlo de nuevo desde cero, sin cambiar de
número ni borrar registros a mano. Además: todo nace como prueba, el reinicio solo toca esa postulación, el bot no
recupera la cita de la prueba anterior, otra postulación de la persona no se mezcla ni bloquea, los reenvíos
solicitados salen, las métricas se ven dentro del ambiente y se excluyen fuera de él, y `preparar_produccion.py`
arranca producción sin datos de prueba. La API de Telegram se simula. Base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_ambiente_prueba.py
"""

import asyncio
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
_dir = tempfile.mkdtemp(prefix="rh_amb_")
DB_URL = "sqlite:///" + str(Path(_dir) / "amb.db")
os.environ.update({"DATABASE_URL": DB_URL, "SEMBRAR_DEMO": "false", "ADMIN_PASSWORD": "prueba-amb", "WHATSAPP_PROVIDER": "telegram",
                   "TELEGRAM_BOT_TOKEN": "123:abc", "TELEGRAM_BOT_USERNAME": "FraicheDemoBot", "TELEGRAM_WEBHOOK_SECRET": "s3cr3t",
                   "FRAICHE_PUBLICACION_ESTRICTA": "false", "AMBIENTE_PRUEBA": "true"})
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
check(r.returncode == 0, f"datos demo cargados {r.stderr[-200:]}")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Candidato, Cuenta, Mensaje, Postulacion, Usuario, Vacante, VinculoTelegram  # noqa: E402
from app.routers import webhooks  # noqa: E402
from app.services import telegram as tg  # noqa: E402

ENVIADOS = []


async def api_falsa(metodo, datos=None, timeout=20):
    ENVIADOS.append((metodo, datos or {}))
    return {"ok": True, "result": {"message_id": len(ENVIADOS)}}


tg.api = api_falsa
CHAT, TEL = 777001, "5544009988"
UID = [5000]


def turno(texto=None, **extra):
    UID[0] += 1
    m = {"message_id": UID[0], "chat": {"id": CHAT, "type": "private"}, "from": {"id": CHAT, "first_name": "Iván", "username": "ivanprueba"}}
    if texto is not None:
        m["text"] = texto
    m.update(extra)
    asyncio.run(webhooks._turno_telegram({"update_id": UID[0], "message": m}))


def ultimos(n=1):
    return [d.get("text", "") for mtd, d in ENVIADOS if mtd == "sendMessage" and str(d.get("chat_id")) == str(CHAT)][-n:]


def postulacion_activa(db, vac_id):
    return (db.query(Postulacion).join(Candidato, Candidato.id == Postulacion.candidato_id)
            .filter(Candidato.telefono == TEL, Postulacion.vacante_id == vac_id, Postulacion.activa.is_(True)).first())


RESPUESTAS = ["2 años", "Cajera", "Cobrar", "2 años", "La próxima semana", "Sí", "No"]


def completar_proceso(vac):
    """Aviso → «Sí» → guion completo por chat. Regresa la postulación."""
    turno("Sí, acepto")
    for t in RESPUESTAS:
        turno(t)
    db = SessionLocal()
    p = postulacion_activa(db, vac.id)
    if p is not None:
        _ = (p.candidato.es_prueba, p.codigo, p.prefiltro_completo, p.es_prueba)  # carga antes de cerrar la sesión
    db.expunge_all()
    db.close()
    return p


with TestClient(app) as client:
    db = SessionLocal()
    cuenta = db.query(Cuenta).filter(Cuenta.slug == "fraiche").first()
    rh = db.query(Usuario).filter(Usuario.correo == "reclutador@fraiche.demo").first()
    app.dependency_overrides[cuenta_actual] = lambda: cuenta
    app.dependency_overrides[usuario_actual] = lambda: rh
    app.dependency_overrides[usuario_decisor] = lambda: rh
    vac = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.estado == "Publicada", Vacante.destino == "tienda_propia").first()
    otra_vac = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.estado == "Publicada", Vacante.id != vac.id).first()
    db.close()

    print("\n=== 1 · Activación por ambiente ===")
    check(settings.ambiente_prueba and client.get("/salud").json()["ambiente_prueba"] is True,
          "AMBIENTE_PRUEBA activo y visible para la interfaz («Ambiente de prueba»)")
    from app.services import configuracion as _cfg
    _d = SessionLocal(); check(not _cfg.modo_prueba_activo(_d), "no depende del Modo Prueba de Configuración (las reglas del proceso no se relajan)"); _d.close()

    print("\n=== Primera prueba completa con la cuenta de Telegram ===")
    turno(f"/start {vac.codigo}")
    turno(contact={"phone_number": f"+52{TEL}", "user_id": CHAT})
    check(any("Autorizas" in x or "autorización" in x for x in ultimos(3)), "vinculado: aviso de privacidad de la vacante")
    p1 = completar_proceso(vac)
    check(p1 is not None and p1.prefiltro_completo and p1.es_prueba and p1.candidato.es_prueba, "proceso completo por chat; postulación y persona nacen como PRUEBA sin marcarlas a mano")
    db = SessionLocal()
    p1 = db.get(Postulacion, p1.id)
    p1.videollamada_agendada_en, p1.videollamada_liga = datetime.now(timezone.utc) + timedelta(days=1), "https://meet.demo.invalid/abc"
    p1.estado, p1.etapa = "cumple", "Entrevista IA"
    # otra postulación ACTIVA de la misma persona (otra vacante) con su propia cita: no debe mezclarse ni bloquear
    otra = Postulacion(codigo="TMP", candidato_id=p1.candidato_id, vacante_id=otra_vac.id, cuenta_id=cuenta.id, origen="formulario", etapa="Entrevista IA",
                       estado="cumple", prefiltro_completo=True, consentimiento=True, es_prueba=True,
                       videollamada_agendada_en=datetime.now(timezone.utc) + timedelta(days=2), videollamada_liga="https://meet.demo.invalid/otra")
    db.add(otra)
    db.flush()
    otra.codigo = f"P-{8800 + otra.id}"
    db.commit()
    P1, OTRA = p1.codigo, otra.codigo
    db.close()
    turno("hola")
    check("Ya tienes tu videollamada agendada" in ultimos(1)[0], "antes del reinicio el bot responde por la cita de esa prueba (estado real)")

    print("\n=== 3-4 · «Reiniciar prueba» y reinicio efectivo del bot ===")
    n_antes = len(ENVIADOS)
    r = client.post(f"/candidatos/{P1}/reiniciar")
    check(r.status_code == 200 and r.json()["nueva"] != P1, f"«Reiniciar prueba» disponible en la postulación ({r.status_code})")
    P2 = r.json()["nueva"]
    check(any("Reiniciamos tu proceso de prueba" in d.get("text", "") for _, d in ENVIADOS[n_antes:]), "el candidato recibe el aviso del reinicio por Telegram")
    db = SessionLocal()
    p1v, p2 = db.query(Postulacion).filter_by(codigo=P1).one(), db.query(Postulacion).filter_by(codigo=P2).one()
    check(not p1v.activa and p1v.motivo_cierre == "reinicio_prueba" and db.query(Mensaje).filter(Mensaje.postulacion_id == p1v.id).count() > 5,
          "la postulación anterior queda cerrada con sus respuestas, resultados y conversación como historial")
    check(p2.etapa == "Prefiltro" and not p2.prefiltro_completo and not p2.videollamada_agendada_en and not (p2.analisis or {}) and p2.es_prueba,
          "la nueva arranca limpia: sin respuestas, resultados, etapa avanzada, citas ni estado de conversación")
    check(p2.candidato_id == p1v.candidato_id and db.query(VinculoTelegram).filter_by(chat_id=str(CHAT)).one().telefono == TEL,
          "se conserva la identidad y la vinculación con Telegram")
    check(db.query(Postulacion).filter_by(codigo=OTRA).one().activa, "la otra postulación de la persona no se toca")
    db.close()
    turno("Hola")
    check(not any("Ya tienes tu videollamada agendada" in x for x in ultimos(2)) and any("Autorizas" in x or "autorización" in x for x in ultimos(2)),
          "tras el reinicio el bot empieza desde el primer paso (aviso), sin la cita de la prueba anterior")

    print("\n=== Segunda prueba completa, misma cuenta de Telegram ===")
    p2 = completar_proceso(vac)
    check(p2 is not None and p2.codigo == P2 and p2.prefiltro_completo, "el proceso se vuelve a completar desde cero sobre la postulación nueva")
    db = SessionLocal()
    check(db.query(Mensaje).filter(Mensaje.postulacion_id == db.query(Postulacion).filter_by(codigo=OTRA).one().id).count() == 0,
          "5 · no se mezclan avances: nada de esta prueba cayó en la otra postulación")
    db.close()

    print("\n=== 6 · Comunicaciones repetibles ===")
    n_antes = len(ENVIADOS)
    r1 = client.post("/candidatos/postular", data={"vacante": vac.slug, "nombre": "Iván Prueba", "telefono": TEL, "consentimiento": "true"})
    r2 = client.post("/candidatos/postular", data={"vacante": vac.slug, "nombre": "Iván Prueba", "telefono": TEL, "consentimiento": "true"})
    avisos = [d for _, d in ENVIADOS[n_antes:] if str(d.get("chat_id")) == str(CHAT)]
    check(r1.status_code == 201 and r2.status_code == 201 and len(avisos) >= 2, f"volver a postularse vuelve a mandar el aviso solicitado ({len(avisos)} envíos)")

    print("\n=== 7 · Métricas: dentro del ambiente sí, en producción no ===")
    total_amb = client.get("/metricas/pipeline").json()["candidatos"]["total"]
    settings.ambiente_prueba = False
    try:
        total_prod = client.get("/metricas/pipeline").json()["candidatos"]["total"]
        check(total_amb > total_prod, f"las pruebas cuentan en las métricas del ambiente ({total_amb}) y se excluyen del reporte productivo ({total_prod})")
        db = SessionLocal()
        pruebas = db.query(Postulacion).filter(Postulacion.cuenta_id == cuenta.id, Postulacion.es_prueba.is_(True)).count()
        db.close()
        r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "preparar_produccion.py"), "--ejecutar"], capture_output=True, text=True,
                           env={**os.environ, "AMBIENTE_PRUEBA": "false"}, cwd=str(RAIZ))
        check(r.returncode == 0 and "Listo para producción" in r.stdout, "preparar_produccion.py: arranca producción sin datos de prueba")
        db = SessionLocal()
        check(pruebas > 0 and db.query(Postulacion).filter(Postulacion.es_prueba.is_(True), Postulacion.activa.is_(True)).count() == 0,
              "todas las postulaciones de prueba quedan cerradas (fuera de tableros y reportes); nada se borra")
        db.close()
    finally:
        settings.ambiente_prueba = True

print(f"\n🎉 Ambiente de prueba verificado: {OK} comprobaciones OK.")
