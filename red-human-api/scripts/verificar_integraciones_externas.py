"""Regresión de las integraciones externas: Dropbox Sign (firma electrónica) y Psicométricas.mx — 2026-10-02.

    .venv/Scripts/python.exe scripts/verificar_integraciones_externas.py

Complementa `verificar_firmas_psicometricas.py` (que simula a nivel de nuestras funciones de servicio): aquí se simula
UN NIVEL MÁS ABAJO — los métodos del SDK oficial `dropbox-sign` y `httpx` — para probar el manejo real de errores de
cada proveedor (credencial rechazada, timeout, sin conexión, respuesta sin JSON, códigos propios) y que un fallo nunca
deje datos a medias ni tumbe la API. Base desechable, sin red.
"""

import hashlib
import hmac
import json
import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

_dir = tempfile.mkdtemp(prefix="rh_integraciones_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "integraciones.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "ANAM_API_KEY", "RESEND_API_KEY",
          "DROPBOX_SIGN_API_KEY", "DROPBOX_SIGN_CLIENT_ID", "PSICOMETRICAS_TOKEN", "PSICOMETRICAS_PASSWORD", "PSICOMETRICAS_USUARIO",
          "PSICOMETRICAS_WEBHOOK_SECRET", "PSICOMETRICAS_URL_CANDIDATO"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-integraciones"
os.environ["SEMBRAR_DEMO"] = "true"

import dropbox_sign as ds  # noqa: E402
import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from urllib3.exceptions import MaxRetryError, NewConnectionError, ReadTimeoutError  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.deps import usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Bitacora, Cuenta, Evaluacion, FirmaDocumento, UsuarioCuenta, Usuario, Vacante  # noqa: E402
from app.services import dropbox_sign as dsign  # noqa: E402
from app.services import psicometricas as psi  # noqa: E402
from app.services.configuracion import obtener  # noqa: E402

OK = 0
PDF = b"%PDF-1.4\n" + b"%" * 900 + b"\n%%EOF\n"


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


def evento(tipo, sr_id, firmas=None):
    t = "1759400000"
    h = hmac.new(settings.dropbox_sign_api_key.encode(), f"{t}{tipo}".encode(), hashlib.sha256).hexdigest()
    return {"event": {"event_time": t, "event_type": tipo, "event_hash": h, "event_metadata": {}},
            "signature_request": {"signature_request_id": sr_id, "signatures": firmas or []}}


# ------------------------------------------------------------------ simulación del SDK de Dropbox Sign
SDK = {"modo": "ok", "timeouts": [], "n": 0}


def _falla_sdk():
    modo = SDK["modo"]
    if modo == "401":
        raise ds.ApiException(status=401, reason="Unauthorized", body='{"error":{"error_msg":"Unauthorized api key"}}')
    if modo == "400":
        raise ds.ApiException(status=400, reason="Bad Request", body='{"error":{"error_msg":"client_id inválido"}}')
    if modo == "timeout":
        raise MaxRetryError(None, "https://api.hellosign.com/v3", ReadTimeoutError(None, "https://api.hellosign.com/v3", "Read timed out. (read timeout=30)"))
    if modo == "sin_red":
        raise MaxRetryError(None, "https://api.hellosign.com/v3", NewConnectionError(None, "Failed to establish a new connection"))


class _Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _sdk_crear(self, req, _request_timeout=None, **_):
    SDK["timeouts"].append(("crear", _request_timeout))
    _falla_sdk()
    SDK["n"] += 1
    n = SDK["n"]
    firmas = [_Obj(signature_id=f"sig-{n}-{i}", signer_email_address=s.email_address, signer_name=s.name) for i, s in enumerate(req.signers)]
    return _Obj(signature_request=_Obj(signature_request_id=f"sr-{n}", signatures=firmas))


def _sdk_sign_url(self, signature_id, _request_timeout=None, **_):
    SDK["timeouts"].append(("sign_url", _request_timeout))
    _falla_sdk()
    return _Obj(embedded=_Obj(sign_url=f"https://app.hellosign.com/editor/embeddedSign?signature_id={signature_id}"))


def _sdk_archivo(self, signature_request_id, file_type=None, _request_timeout=None, **_):
    SDK["timeouts"].append(("pdf", _request_timeout))
    _falla_sdk()
    if SDK["modo"] == "no_pdf":
        return b"<html>error</html>"
    return PDF


ds.apis.SignatureRequestApi.signature_request_create_embedded = _sdk_crear
ds.apis.SignatureRequestApi.signature_request_files = _sdk_archivo
ds.apis.EmbeddedApi.embedded_sign_url = _sdk_sign_url


# ------------------------------------------------------------------ simulación de httpx (Psicométricas.mx)
class R:
    def __init__(self, status, datos=None, contenido=b""):
        self.status_code, self._d, self.content = status, datos, contenido

    def json(self):
        if self._d is None:
            raise ValueError("sin json")
        return self._d


PSI = {"post": "ok", "get": "ok", "fecha_fin": None, "timeouts": []}


def _falla_httpx(modo, url):
    if modo == "timeout":
        raise httpx.ReadTimeout("timed out", request=httpx.Request("GET", url))
    if modo == "sin_red":
        raise httpx.ConnectError("Name or service not known", request=httpx.Request("GET", url))
    if modo == "500_html":
        return R(500, None, b"<html>Internal Server Error</html>")
    if modo == "1001":
        return R(200, {"code": "1001", "msg": "Token inválido"})
    if modo == "1002":
        return R(200, {"code": "1002", "msg": "Sin paquete"})
    if modo == "sin_clave":
        return R(200, {"status": "200", "msg": "ok"})
    return None


def _psi_post(url, data=None, timeout=None):
    PSI["timeouts"].append(timeout)
    r = _falla_httpx(PSI["post"], url)
    return r or R(200, {"status": "200", "clave": "9-INTG-1002-001", "msg": "Candidato agregado correctamente."})


def _psi_get(url, params=None, timeout=None):
    PSI["timeouts"].append(timeout)
    r = _falla_httpx(PSI["get"], url)
    if r:
        return r
    if url.endswith("consultaCandidato"):
        return R(200, [{"clave": params["Clave"], "id_prueba": 1, "fecha_fin": PSI["fecha_fin"]}])
    if params.get("Pdf") == "true":
        return R(200, None, PDF)
    return R(200, {"cleaver": {"D": 10, "I": 9}})


psi.httpx.post = _psi_post
psi.httpx.get = _psi_get


with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    C = Cuenta(nombre="Integraciones", nombre_comercial="Integraciones", razon_social="Integraciones SA", estado="Activa")
    db.add(C)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=C.id))
    admin.cuenta_predeterminada_id = C.id
    cuenta_id = C.id
    for v in db.query(Vacante).all():
        v.cuenta_id = cuenta_id
    obtener(db).modo_prueba = True  # el bloqueo de condiciones/documentos ya lo prueba verificar_firmas_psicometricas.py
    db.commit()
    for dep in (usuario_actual, usuario_decisor):
        app.dependency_overrides[dep] = lambda: admin
    H = {"X-Cuenta-Id": str(cuenta_id)}
    vac = client.get("/vacantes", headers=H).json()[0]

    def nueva_postulacion(nombre, tel, correo):
        r = client.post("/candidatos", headers=H, json={"nombre": nombre, "telefono": tel, "correo": correo, "vacante": vac["id"], "consentimiento": True, "fuente": "RH"})
        assert r.status_code in (200, 201), r.text
        return r.json()["id"]

    # ======================================================== 1. Configuración (settings) leída del entorno
    print("\n--- 1. Variables de entorno → settings ---")
    import importlib

    import app.config as cfgmod

    os.environ.update({"DROPBOX_SIGN_API_KEY": "env-key", "DROPBOX_SIGN_CLIENT_ID": "env-client", "DROPBOX_SIGN_TEST_MODE": "true",
                       "PSICOMETRICAS_TOKEN": "env-token", "PSICOMETRICAS_USUARIO": "env-usuario", "PSICOMETRICAS_WEBHOOK_SECRET": "env-secreto"})
    s2 = cfgmod.Settings()
    check(s2.dropbox_sign_api_key == "env-key" and s2.dropbox_sign_client_id == "env-client" and s2.dropbox_sign_test_mode is True,
          "DROPBOX_SIGN_API_KEY / CLIENT_ID / TEST_MODE se leen del entorno")
    check(s2.psicometricas_token == "env-token" and s2.psicometricas_usuario == "env-usuario" and s2.psicometricas_webhook_secret == "env-secreto",
          "PSICOMETRICAS_TOKEN / USUARIO / WEBHOOK_SECRET se leen del entorno")
    for k in ("DROPBOX_SIGN_API_KEY", "DROPBOX_SIGN_CLIENT_ID", "DROPBOX_SIGN_TEST_MODE", "PSICOMETRICAS_TOKEN", "PSICOMETRICAS_USUARIO", "PSICOMETRICAS_WEBHOOK_SECRET"):
        os.environ[k] = ""
    importlib.reload  # noqa: B018 — no se recarga el módulo: la app sigue con su `settings`
    check(not dsign.configurado() and not psi.configurado(), "sin variables: ambas integraciones se reportan NO configuradas (degradan, no truenan)")

    # ======================================================== 2. Dropbox Sign — llamadas exitosas al SDK
    print("\n--- 2. Dropbox Sign: éxito a través del SDK ---")
    settings.dropbox_sign_api_key = "llave-integ-1"
    settings.dropbox_sign_client_id = "cliente-integ"
    P = nueva_postulacion("Firma Externa", "5512340001", "firma.externa@correo.mx")
    EXP = client.patch(f"/candidatos/{P}/etapa", headers=H, json={"etapa": "Contratación", "manual": True}).json()["expedienteId"]
    client.patch(f"/candidatos/{P}/condiciones-contratacion", headers=H,
                 json={"puesto": "Analista", "sueldo": "$15,000", "tipo_contratacion": "Tiempo indeterminado", "fecha_ingreso": "2026-11-03"})
    r = client.post(f"/firmas/expedientes/{EXP}", headers=H, json={"documento": "carta"})
    F = r.json()
    check(r.status_code == 200 and F["estado"] == "enviada" and "signature_id=sig-1-0" in (F["signUrl"] or ""),
          "crear solicitud incrustada vía SDK → estado «enviada» y sign_url del representante de RH")
    check(dict(SDK["timeouts"]).get("crear") == dsign.TIMEOUT_ARCHIVO and dict(SDK["timeouts"]).get("sign_url") == dsign.TIMEOUT,
          f"el SDK recibe timeouts explícitos (crear {dsign.TIMEOUT_ARCHIVO}, sign_url {dsign.TIMEOUT})")
    lista = client.get(f"/firmas/expedientes/{EXP}", headers=H).json()
    check(lista[0]["estado"] == "enviada" and {x["estado"] for x in lista[0]["firmantes"]} == {"pendiente"},
          "el expediente refleja la firma como «Pendiente» (en firma)")

    # ======================================================== 3. Dropbox Sign — fallos del proveedor
    print("\n--- 3. Dropbox Sign: fallos del proveedor ---")
    P2 = nueva_postulacion("Firma Fallida", "5512340002", "firma.fallida@correo.mx")
    EXP2 = client.patch(f"/candidatos/{P2}/etapa", headers=H, json={"etapa": "Contratación", "manual": True}).json()["expedienteId"]
    client.patch(f"/candidatos/{P2}/condiciones-contratacion", headers=H,
                 json={"puesto": "Analista", "sueldo": "$15,000", "tipo_contratacion": "Tiempo indeterminado", "fecha_ingreso": "2026-11-03"})
    for modo, esperado, texto in (("401", 502, "credencial"), ("400", 502, "400"), ("timeout", 502, "a tiempo"), ("sin_red", 502, "conectar")):
        SDK["modo"] = modo
        r = client.post(f"/firmas/expedientes/{EXP2}", headers=H, json={"documento": "carta"})
        db.expire_all()
        sin_fila = db.query(FirmaDocumento).filter(FirmaDocumento.expediente_id == EXP2).count() == 0
        check(r.status_code == esperado and texto in r.json()["detail"] and sin_fila,
              f"SDK {modo} → HTTP {esperado} con motivo claro («{r.json()['detail'][:60]}…») y NO se guarda solicitud a medias")
    SDK["modo"] = "timeout"
    r = client.post(f"/firmas/{F['id']}/sign-url", headers=H)
    check(r.status_code == 502 and "a tiempo" in r.json()["detail"], "sign_url con timeout → 502 (la UI muestra el aviso, no se cuelga)")
    tok = client.get(f"/contratacion/expedientes/{EXP}", headers=H).json().get("token")
    if not tok:
        from app.models import Expediente

        tok = db.get(Expediente, EXP).token
    SDK["modo"] = "401"
    r = client.post(f"/firmas/publica/{tok}/{F['id']}/sign-url")
    check(r.status_code == 502 and "credencial" in r.json()["detail"], "liga del candidato con credencial rechazada → error controlado (sin 500)")
    SDK["modo"] = "ok"
    check(client.post(f"/firmas/publica/{tok}/{F['id']}/sign-url").status_code == 200, "recuperado el proveedor, el candidato obtiene su sign_url")

    # ======================================================== 4. Dropbox Sign — webhook con descarga fallida y recuperación
    print("\n--- 4. Dropbox Sign: webhook y descarga del PDF firmado ---")
    todos = [{"signature_id": "sig-1-0", "status_code": "signed"}, {"signature_id": "sig-1-1", "status_code": "signed"}]
    SDK["modo"] = "timeout"
    r = client.post("/api/webhooks/dropbox", data={"json": json.dumps(evento("signature_request_all_signed", "sr-1", todos))})
    db.expire_all()
    f = db.query(FirmaDocumento).filter(FirmaDocumento.signature_request_id == "sr-1").one()
    check(r.status_code == 200 and r.text == "Hello API Event Received", "el webhook contesta de inmediato aunque el proveedor falle después")
    check(f.estado == "firmada" and not f.documento_id and "a tiempo" in (f.error or ""),
          "all_signed con descarga fallida → «Firmada» (firmantes al día), error registrado, sin documento a medias")
    SDK["modo"] = "no_pdf"
    client.post("/api/webhooks/dropbox", data={"json": json.dumps(evento("signature_request_downloadable", "sr-1", todos))})
    db.expire_all()
    f = db.query(FirmaDocumento).filter(FirmaDocumento.signature_request_id == "sr-1").one()
    check(not f.documento_id and "PDF" in (f.error or ""), "respuesta que no es PDF → se rechaza (nunca se guarda basura como documento firmado)")
    SDK["modo"] = "ok"
    client.post("/api/webhooks/dropbox", data={"json": json.dumps(evento("signature_request_downloadable", "sr-1", todos))})
    db.expire_all()
    f = db.query(FirmaDocumento).filter(FirmaDocumento.signature_request_id == "sr-1").one()
    check(f.estado == "descargada" and f.documento_id and not f.error, "el reintento `downloadable` recupera el PDF → «Firmada · PDF en el expediente»")
    est = client.get(f"/firmas/expedientes/{EXP}", headers=H).json()[0]
    check(est["firmadoPdf"] and {x["estado"] for x in est["firmantes"]} == {"firmado"}, "el expediente refleja «Firmado» para ambos firmantes")
    check(client.post("/api/webhooks/dropbox", data={"json": "{no es json"}).status_code == 400, "evento malformado → 400 (sin 500)")
    r = client.post("/api/webhooks/dropbox", data={"json": json.dumps(evento("signature_request_signed", "sr-desconocida"))})
    check(r.status_code == 200, "evento de una solicitud ajena/desconocida → se acusa y se ignora")

    # ======================================================== 5. Psicométricas.mx — éxito y fallos
    print("\n--- 5. Psicométricas.mx: éxito a través de httpx ---")
    settings.psicometricas_token = "T" * 20
    settings.psicometricas_password = "P" * 20
    settings.psicometricas_webhook_secret = "secreto-integ"
    PR = client.post("/evaluaciones/pruebas", headers=H, json={"clave": "PSI-INTEG", "nombre": "Cleaver", "modo": "integrada",
                                                              "proveedor": "Psicométricas.mx", "id_proveedor": "1"}).json()["id"]
    PE = nueva_postulacion("Psico Externa", "5512340003", "psico.externa@correo.mx")
    NUEVA = {"tipo": "psicometrica", "forma": "integrada", "prueba_id": PR}

    def crear_ev():
        r = client.post(f"/evaluaciones/postulaciones/{PE}", headers=H, json=NUEVA)
        assert r.status_code in (200, 201), r.text
        return r.json()["evaluacion"]["id"]

    def ev_db(codigo):
        db.expire_all()
        return db.query(Evaluacion).filter(Evaluacion.codigo == codigo).one()

    # fallos al ENVIAR: la evaluación no debe cambiar
    print("\n--- 6. Psicométricas.mx: fallos al enviar ---")
    E_FALLA = crear_ev()
    for modo, texto in (("timeout", "a tiempo"), ("sin_red", "conectar"), ("500_html", "sin JSON"), ("1001", "1001"), ("1002", "1002"), ("sin_clave", "clave")):
        PSI["post"] = modo
        r = client.post(f"/evaluaciones/{E_FALLA}/enviar", headers=H)
        e = ev_db(E_FALLA)
        check(r.status_code == 502 and texto in r.json()["detail"] and e.estado == "pendiente" and not e.clave_proveedor and (e.paso_integrada or "asignada") == "asignada",
              f"agregaCandidato {modo} → 502 («{r.json()['detail'][:55]}…») y la evaluación queda intacta")
    PSI["post"] = "ok"
    PSI["timeouts"].clear()
    r = client.post(f"/evaluaciones/{E_FALLA}/enviar", headers=H)
    e = ev_db(E_FALLA)
    check(r.status_code == 200 and e.clave_proveedor == "9-INTG-1002-001" and e.paso_integrada == "enviada",
          "recuperado el proveedor, «Enviar» desde «Agregar evaluación» → clave guardada y paso «Enviada»")
    check(PSI["timeouts"] and all(t for t in PSI["timeouts"]), "toda llamada a Psicométricas.mx lleva timeout")

    # fallos al CONSULTAR resultado (botón y webhook)
    print("\n--- 7. Psicométricas.mx: fallos al recibir la calificación ---")
    PSI["get"] = "timeout"
    r = client.post(f"/evaluaciones/{E_FALLA}/sincronizar", headers=H)
    check(r.status_code == 502 and "a tiempo" in r.json()["detail"] and ev_db(E_FALLA).estado == "pendiente", "«Consultar resultado» con timeout → 502 y nada cambia")
    PSI["get"] = "sin_red"
    r = client.post("/api/webhooks/psicometricas?secreto=secreto-integ", json={"clave": "9-INTG-1002-001", "type": "termina_prueba"})
    e = ev_db(E_FALLA)
    bit = db.query(Bitacora).filter(Bitacora.accion == "evaluacion_webhook").order_by(Bitacora.id.desc()).first()
    check(r.status_code == 200 and e.estado == "pendiente" and bit and "error" in json.dumps(bit.detalle, ensure_ascii=False, default=str),
          "webhook con Psicométricas caído → 200 al proveedor, nada guardado y el error queda en bitácora")
    PSI["get"] = "ok"
    PSI["fecha_fin"] = None
    client.post("/api/webhooks/psicometricas?secreto=secreto-integ", json={"clave": "9-INTG-1002-001", "type": "termina_prueba"})
    check(ev_db(E_FALLA).estado == "pendiente", "aviso sin confirmación del proveedor (sin fecha_fin) → no se guarda calificación")
    PSI["fecha_fin"] = "2026-10-02 09:00:00"
    client.post("/api/webhooks/psicometricas?secreto=secreto-integ", data={"clave": "9-INTG-1002-001", "type": "termina_prueba"})
    e = ev_db(E_FALLA)
    check(e.estado == "con_resultado" and e.resultado_json.get("cleaver") and len(e.adjuntos or []) == 1,
          "aviso confirmado (form-encoded) → calificación JSON + informe PDF en la evaluación del candidato")
    tarjeta = next(x for x in client.get(f"/evaluaciones/postulaciones/{PE}", headers=H).json() if x["codigo"] == E_FALLA)
    check(tarjeta["estado"] == "con_resultado" and tarjeta["nuevoResultado"] is True, "la tarjeta del panel de evaluaciones muestra el resultado recibido")
    check(client.post("/api/webhooks/psicometricas?secreto=secreto-integ", json={"clave": "x", "type": "otro"}).json().get("ignorado"),
          "aviso de un tipo desconocido → se ignora sin error")
    check(client.post("/api/webhooks/psicometricas", json={"clave": "9-INTG-1002-001", "type": "termina_prueba"}).status_code == 401,
          "webhook sin el secreto configurado → 401")

    # ======================================================== 8. Degradación: apagar las integraciones no rompe el flujo
    print("\n--- 8. Degradación sin llaves ---")
    settings.dropbox_sign_api_key = settings.dropbox_sign_client_id = ""
    settings.psicometricas_token = settings.psicometricas_password = ""
    check(client.post(f"/firmas/expedientes/{EXP2}", headers=H, json={"documento": "carta"}).status_code == 503, "sin Dropbox Sign: 503 claro (la UI cae a la vista previa del PDF)")
    check(client.get(f"/contratacion/expedientes/{EXP2}/carta-intencion?cuenta_id={cuenta_id}").status_code == 200, "…y la carta en PDF se sigue generando")
    E_SIM = crear_ev()
    r = client.post(f"/evaluaciones/{E_SIM}/enviar", headers=H)
    check(r.status_code == 200 and not ev_db(E_SIM).clave_proveedor, "sin Psicométricas.mx: «Enviar» cae al modo integrado simulado")
    db.close()

print(f"\n🎉 Integraciones externas (Dropbox Sign + Psicométricas.mx): {OK} verificaciones OK")
