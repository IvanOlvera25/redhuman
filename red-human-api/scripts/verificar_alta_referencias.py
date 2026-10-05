"""Regresión Fraiche 2026-10-05: referencias validadas dentro del sistema («Completado», «Ver resultado», respaldo que no
valida), documentos en demo («Recibido · Demo») y en producción (motivo + qué corregir), datos para el alta (corregir en la
ficha, formato, «Completar con datos de prueba» sin sobrescribir) y alta idempotente en Colaboradores con SAP separado
(demo = «Conexión pendiente»; con conexión, «Alta confirmada en SAP» solo si SAP confirma). Base desechable, cero envíos.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_alta_referencias.py
"""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
_dir = tempfile.mkdtemp(prefix="rh_fr_alta_")
DB_URL = "sqlite:///" + str(Path(_dir) / "ci.db")
os.environ.update({"DATABASE_URL": DB_URL, "SEMBRAR_DEMO": "false", "ADMIN_PASSWORD": "prueba-ci", "FRAICHE_PUBLICACION_ESTRICTA": "false"})
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "RESEND_API_KEY", "ANAM_API_KEY", "TELEGRAM_BOT_TOKEN",
          "PSICOMETRICAS_TOKEN", "PSICOMETRICAS_PASSWORD", "PSICOMETRICAS_USUARIO", "DROPBOX_SIGN_API_KEY"):
    os.environ[k] = ""
os.environ["AMBIENTE_PRUEBA"] = "false"

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "cargar_demo_fraiche.py"), "--ejecutar"], capture_output=True, text=True, env={**os.environ}, cwd=str(RAIZ))
check(r.returncode == 0, f"datos demo cargados {r.stderr[-300:]}")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AvisoPendiente, Cuenta, EntrevistaHumana, EvaluacionCandidato, Postulacion, PruebaPsicometrica, Usuario, Vacante  # noqa: E402
from app.services import avisos, configuracion, fraiche, notificaciones, whatsapp  # noqa: E402
from app.services import correo as scorreo  # noqa: E402

# ---------- envíos simulados: registran destino y texto; un número «sin vínculo» simula Telegram sin vincular ----------
MENSAJES, CORREOS = [], []
SIN_VINCULO = {"5599990000"}


async def _msg(tel, texto):
    t = "".join(c for c in str(tel) if c.isdigit())[-10:]
    if t in SIN_VINCULO:
        return {"enviado": False, "proveedor": "telegram", "detalle": f"El {t} no ha vinculado Telegram", "sin_vinculo": True}
    MENSAJES.append((t, texto))
    return {"enviado": True, "proveedor": "prueba", "detalle": "ok", "wa_id": "x"}


async def _correo(dest, asunto, html, adjuntos=None):
    CORREOS.append((dest, asunto, html, adjuntos))
    return {"enviado": True, "proveedor": "resend", "detalle": "ok"}


whatsapp.enviar_mensaje = _msg
notificaciones.enviar_mensaje = _msg
notificaciones.enviar_correo = _correo
scorreo.enviar_correo = _correo
from app.routers import contratacion as _rc  # noqa: E402

_rc.enviar_correo = _correo
_rc.enviar_mensaje = _msg


def resp_web(v):
    filas = []
    for c in fraiche.preguntas_para_vacante(v.preguntas_filtro or [], sucursal=v.sucursal or "", sueldo=v.sueldo or ""):
        if c["tipo"] == "municipio":
            resp = f"{v.ubicacion_municipio}, {v.ubicacion_estado}"
        elif c.get("clave") == "traslado":
            resp = "Hasta 30 min"
        elif c["tipo"] == "opcion":
            resp = c["opciones"][0]
        else:
            resp = "Sí"
        filas.append({"pregunta": c["pregunta"], "respuesta": resp, **({"clave": c["clave"]} if c.get("clave") else {})})
    return filas


with TestClient(app) as client:
    db = SessionLocal()
    cuenta = db.query(Cuenta).filter(Cuenta.slug == "fraiche").first()
    recl = db.query(Usuario).filter(Usuario.correo == "reclutador@fraiche.demo").first()
    recl.telefono = "5590001111"  # el entrevistador interno tiene WhatsApp/Telegram en su perfil
    db.commit()
    app.dependency_overrides[cuenta_actual] = lambda: cuenta
    app.dependency_overrides[usuario_actual] = lambda: recl
    app.dependency_overrides[usuario_decisor] = lambda: recl
    configuracion.obtener(db).modo_prueba = False
    db.commit()

    def vacante(titulo):
        return db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.destino == "tienda_propia", Vacante.titulo == titulo, Vacante.estado == "Publicada").first()

    def postular(v, nombre, tel, correo=""):
        r = client.post("/candidatos/postular", data={"vacante": v.slug, "nombre": nombre, "telefono": tel, "correo": correo, "consentimiento": "true",
                                                      "respuestas": json.dumps(resp_web(v))})
        assert r.status_code == 201, r.text
        return r.json()["postulacion"]

    from app.config import settings as cfg  # noqa: E402
    from app.models import Colaborador, Documento, Expediente  # noqa: E402
    from app.services import ia, sap  # noqa: E402

    vc = vacante("Cajero")
    PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n" + b"x" * 2048 + b"\n%%EOF"

    print("\n=== 1. Referencias: validar dentro del sistema → Completado ===")
    P = postular(vc, "Rocío Alta Prueba", "5582220001", "rocio@demo.invalid")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "referencias", "referencias_modo": "responsable", "referencias_requeridas": 1,
                                                             "responsable": {"nombre": recl.nombre, "usuario_id": recl.id}})
    ev_r = r.json()
    check(r.status_code == 201, f"evaluación de referencias creada ({r.status_code})")
    datos_ref = {"empresa": "Tienda Z", "puesto_candidato": "Cajera", "periodo": "2021-2024", "contacto_nombre": "Marta Jefa",
                 "contacto_cargo": "Gerente", "relacion": "Jefa directa", "telefono": "5512349999", "correo": "marta@demo.invalid"}
    r = client.post(f"/evaluaciones/{ev_r['id']}/referencias", json={"referencias": [{**datos_ref, "no_contactada": True}]})
    check(r.status_code == 200 and r.json()["estadoFraiche"] == "en_proceso" and r.json()["estadoFraicheTexto"] == "En proceso",
          "sin respuesta («No contactada») queda «En proceso», no desfavorable")
    r = client.post(f"/evaluaciones/{ev_r['id']}/resultado", files={"archivo": ("informe.pdf", PDF, "application/pdf")})
    check(r.status_code == 200 and r.json()["estadoFraiche"] == "en_proceso" and r.json()["adjuntos"][-1]["tipo"] == "respaldo",
          "adjuntar el informe lo guarda como respaldo y NO valida")
    check(client.post(f"/evaluaciones/{ev_r['id']}/resultado", data={"resumen": "Todo bien", "decision": "favorable"}).status_code == 400,
          "un resultado escrito a mano no completa referencias")
    r = client.post(f"/evaluaciones/{ev_r['id']}/referencias", json={"referencias": [{**datos_ref, "contesto_nombre": "Marta Jefa", "medio": "Teléfono",
                                                                                         "confirma_puesto": "si", "recontrataria": "si", "observaciones": "Puntual",
                                                                                         "resultado": "favorable"}]})
    j = r.json()
    ref = j["referencias"][0]
    check(r.status_code == 200 and j["estadoFraiche"] == "completado" and j["estadoFraicheTexto"] == "Completado" and j["estado"] == "revisada",
          "con las requeridas validadas queda «Completado» sin otra calificación de RH")
    check(ref["validada_por"] == recl.nombre and ref["validada_en"] and ref["fecha_contacto"], "cada referencia guarda quién y cuándo la registró")
    check(j["dictamen"] == "favorable" and j["adjuntos"], "el resultado conserva respuestas y adjuntos para «Ver resultado»")
    p = db.query(Postulacion).filter(Postulacion.codigo == P).first()
    db.refresh(p)
    from app.services import fraiche_pipeline as fp  # noqa: E402

    acts = [a for a in fp.avance(p)["actividades"] if a["clave"] == "referencias"]
    check(acts and acts[0]["estado"] == "hecha" and acts[0]["resultado"].startswith("Completado"), f"el avance muestra «Completado» ({acts[0]['resultado'] if acts else '-'})")

    print("\n=== 2. Documentos: demo «Recibido · Demo»; producción con motivo concreto ===")
    r = client.patch(f"/candidatos/{P}/etapa", json={"etapa": "Contratación", "manual": True, "comentario": "Prueba alta"})
    exp = r.json()["expedienteId"]
    client.patch(f"/candidatos/{P}/condiciones-contratacion", json={"puesto": "Cajero", "sueldo": "$11,500", "tipo_contratacion": "Tiempo indeterminado",
                                                                   "fecha_ingreso": (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")})
    e = db.query(Expediente).get(exp)
    tipos = [d.tipo for d in e.documentos if not d.interno]
    llamadas_ia = []
    _orig = ia.validar_documento

    def _ia_rechaza(b64, ext, tipo, titular):
        llamadas_ia.append(tipo)
        return ia.DocumentoValidado(tipo_detectado=tipo, es_documento_oficial=True, coincide_tipo=True, legible=False, completo=True, vigente=None,
                                    nombre_detectado=None, coincide_titular=None, motivo_rechazo=None, observaciones=""), True
    ia.validar_documento = _ia_rechaza
    cfg.ambiente_prueba = True
    r = client.post(f"/contratacion/expedientes/{exp}/documentos", data={"tipo": tipos[0]}, files={"archivo": ("doc.pdf", PDF, "application/pdf")})
    d0 = next(d for d in r.json()["expediente"]["documentos"] if d["nombre"] == tipos[0])
    check(r.status_code == 200 and d0["estado"] == "recibido" and d0["demo"] and d0["recibidoEn"] and not llamadas_ia,
          "en demo se guarda de inmediato como «Recibido · Demo», sin IA ni rechazo")
    check(client.post(f"/contratacion/expedientes/{exp}/documentos", data={"tipo": tipos[1]}, files={"archivo": ("x.exe", b"MZ" + b"0" * 3000, "application/octet-stream")}).status_code == 415,
          "los controles de formato siguen activos en demo")
    cfg.ambiente_prueba = False
    r = client.post(f"/contratacion/expedientes/{exp}/documentos", data={"tipo": tipos[1]}, files={"archivo": ("doc.pdf", PDF, "application/pdf")})
    d1 = next(d for d in r.json()["expediente"]["documentos"] if d["nombre"] == tipos[1])
    check(llamadas_ia and d1["estado"] == "rechazado" and "no se lee" in d1["notas"].lower() and "sube" in d1["notas"].lower(),
          f"en producción valida y el rechazo dice el motivo y qué corregir: «{d1['notas']}»")
    ia.validar_documento = _orig

    print("\n=== 3. Datos para alta: corregir en la ficha, formato y datos de prueba ===")
    check(client.patch(f"/contratacion/expedientes/{exp}/datos-alta", json={"personales": {"curp": "ABC"}}).status_code == 400, "una CURP mal formada se rechaza con mensaje")
    check(client.patch(f"/contratacion/expedientes/{exp}/datos-alta", json={"personales": {"nss": "123"}}).status_code == 400, "un NSS que no es de 11 dígitos se rechaza")
    r = client.patch(f"/contratacion/expedientes/{exp}/datos-alta", json={"personales": {"curp": "rorr950101mdfxxx01", "rfc": ""},
                                                                          "campos": {"correo": "rocio.corregido@demo.invalid", "telefono": "+52 55 8222 0001"}})
    check(r.status_code == 200, f"correcciones guardadas ({r.text[:200]})")
    db.expire_all()
    c = db.query(Postulacion).filter(Postulacion.codigo == P).first().candidato
    check(c.correo == "rocio.corregido@demo.invalid" and c.telefono == "5582220001" and c.datos_personales["curp"] == "RORR950101MDFXXX01",
          "correo, teléfono y CURP corregidos quedan en la FICHA del candidato")
    v = r.json()
    opc = {x["clave"] for b in v["bloques"] for x in b["campos"] if x.get("opcional")}
    check({"genero", "domicilio", "jefe"} <= opc and not any(n.startswith("Género") for n in v["faltantes"]), "los opcionales se marcan y no bloquean")
    check(client.post(f"/contratacion/expedientes/{exp}/datos-alta/prueba").status_code == 403, "«Completar con datos de prueba» no existe fuera del demo")
    cfg.ambiente_prueba = True
    r = client.post(f"/contratacion/expedientes/{exp}/datos-alta/prueba")
    v = r.json()
    db.expire_all()
    c = db.query(Postulacion).filter(Postulacion.codigo == P).first().candidato
    check(r.status_code == 200 and "rfc" in v["llenados"] and "nss" in v["llenados"] and "curp" not in v["llenados"] and "correo" not in v["llenados"],
          f"llena SOLO lo vacío ({', '.join(v['llenados'])})")
    check(c.datos_personales["curp"] == "RORR950101MDFXXX01" and c.correo == "rocio.corregido@demo.invalid", "nunca sobrescribe datos existentes")
    check(v["faltantes"] == [], f"sin faltantes obligatorios ({v['faltantes']})")
    r = client.post(f"/contratacion/expedientes/{exp}/confirmar-datos-alta")
    check(r.status_code == 200 and r.json()["estadoSap"] == "listo_para_enviar_sap" and r.json()["colaborador"] is None, "datos confirmados; aún sin colaborador")

    print("\n=== 4. Alta en Colaboradores (idempotente) y SAP por separado ===")
    configuracion.obtener(db).modo_prueba = True  # salta la integridad del expediente para probar el alta en sí
    db.commit()
    r = client.post(f"/contratacion/expedientes/{exp}/alta", json={})
    j = r.json()
    check(r.status_code == 200 and j["colaborador"] and j["sap"]["estado"] == "conexion_pendiente" and j["sap"]["enviado"] is False,
          "el alta crea al colaborador; en demo SAP queda «Listo para SAP · Conexión pendiente» sin envío")
    col_id = j["colaborador"]["id"]
    db.expire_all()
    col = db.query(Colaborador).filter(Colaborador.codigo == col_id).first()
    check(col.expediente_id == exp and col.candidato_origen_id == c.id and col.datos_alta.get("curp") == "RORR950101MDFXXX01" and col.correo == c.correo,
          "el colaborador lleva datos, expediente y vínculo al candidato de origen")
    r = client.post(f"/contratacion/expedientes/{exp}/alta", json={})
    check(r.status_code == 200 and r.json()["yaExistia"] and r.json()["colaborador"]["id"] == col_id
          and db.query(Colaborador).filter(Colaborador.expediente_id == exp).count() == 1, "repetir el alta no duplica ni pide recaptura")
    v = client.get(f"/contratacion/expedientes/{exp}/datos-alta").json()
    check(v["colaborador"]["codigo"] == col_id and v["sapEnvioTexto"] == "Listo para SAP · Conexión pendiente" and not v["sapConfirmado"],
          "la vista separa el alta en Colaboradores del estado en SAP")
    configuracion.obtener(db).modo_prueba = False
    db.commit()

    # Conexión configurada (fuera del demo): primero SAP responde sin confirmar, luego confirma
    cfg.ambiente_prueba = False
    cfg.sap_api_url, cfg.sap_usuario, cfg.sap_password = "https://sap.invalid/odata", "u", "p"
    ENVIADO, RESP = [], {"status": 202, "json": {"mensaje": "en cola"}}

    class _Resp:
        def __init__(self, st, js):
            self.status_code, self._js, self.text = st, js, json.dumps(js)
            self.is_success = 200 <= st < 300

        def json(self):
            return self._js

    class _Cli:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, auth=None, headers=None):
            ENVIADO.append(json)
            return _Resp(RESP["status"], RESP["json"])
    sap.httpx.AsyncClient = _Cli
    r = client.post(f"/contratacion/expedientes/{exp}/sap/enviar")
    check(r.status_code == 200 and r.json()["sapEnvio"] == "enviado" and not r.json()["sapConfirmado"] and ENVIADO[-1]["curp"] == "RORR950101MDFXXX01",
          "con conexión se mandan los MISMOS datos confirmados; sin confirmación de SAP no se dice «confirmada»")
    RESP.update({"status": 201, "json": {"d": {"personIdExternal": "EMP-778"}}})
    r = client.post(f"/contratacion/expedientes/{exp}/sap/enviar")
    j = r.json()
    check(j["sapEnvio"] == "confirmado" and j["sapEnvioTexto"] == "Alta confirmada en SAP" and j["sapIdEmpleado"] == "EMP-778",
          "«Alta confirmada en SAP» solo cuando SAP la confirma, con la respuesta registrada")
    ex = db.query(Expediente).get(exp)
    db.refresh(ex)
    check(ex.sap_respuesta.get("status") == 201, "la respuesta de SAP queda en el expediente")
    n = len(ENVIADO)
    client.post(f"/contratacion/expedientes/{exp}/sap/enviar")
    check(len(ENVIADO) == n, "ya confirmada en SAP no se vuelve a enviar")
    cfg.sap_api_url = ""

print(f"\n🎉 Alta, referencias y documentos (2026-10-05): {OK} comprobaciones OK")
