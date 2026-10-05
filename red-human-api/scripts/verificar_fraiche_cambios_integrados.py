"""Regresión «Cambios integrados para desarrollo — Fraiche» (2026-10-02): envío automático de la IPV Red Human,
reprogramación con avisos, entrevistas en cualquier etapa sin regresar, cola de avisos por vincular, IPV provisional,
varias psicometrías, liga del candidato, consentimiento médico automático, referencias estructuradas, contrato en
Contratación/Onboarding y movimiento excepcional con motivo. Base desechable; los envíos se simulan (cero mensajes).

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_cambios_integrados.py
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
_dir = tempfile.mkdtemp(prefix="rh_fr_ci_")
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

    vc, vd = vacante("Cajero"), vacante("Demostrador")

    print("\n=== §1 IPV Red Human: la liga sale sola, con estado real, Copiar y Reenviar ===")
    P1 = postular(vc, "Iván Prueba Uno", "5581110001", "ivan1@demo.invalid")
    MENSAJES.clear()
    r = client.post(f"/candidatos/{P1}/ipv", json={"modo": "red_human"})
    d = r.json()
    check(r.status_code == 201 and d["liga"].endswith(d["entrevista"]["token"]) and "/entrevista/" in d["liga"], "crear la IPV Red Human regresa la liga del candidato")
    check(any(t == "5581110001" and d["liga"] in x for t, x in MENSAJES), "la liga se envió automáticamente al candidato por su canal")
    check(any(e["estado"] == "enviado" and e["canal"] == "whatsapp" for e in d["envios"]), "estado real del envío: enviado (por canal)")
    r = client.post(f"/candidatos/{P1}/ipv/reenviar", json={})
    check(r.status_code == 200 and r.json()["envios"], "Reenviar registra canal, fecha y estado")
    ficha = client.get(f"/candidatos/{P1}").json()
    e_ipv = next(e for e in ficha["entrevistas"] if e["fase"] in ("ipv", "inicial_ipv"))
    check(len(e_ipv["envios"]) >= 2 and e_ipv["liga"], "la ficha guarda el historial de envíos de la IPV")
    check(ficha["etapa"] == "Entrevista IA", "la IPV Red Human corresponde a Filtro Red Human (no mueve de columna)")

    print("\n=== §5/§12 Entrevista humana e IPV humana: mueve solo hacia adelante ===")
    base_eh = {"tipo_entrevistador": "interno", "entrevistador_usuario_id": recl.id, "fecha": (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d"),
               "hora": "10:00", "modalidad": "Presencial", "ubicacion": "Sucursal Centro"}
    CORREOS.clear()
    r = client.post(f"/candidatos/{P1}/entrevista-humana", json={**base_eh, "es_ipv": True})
    check(r.status_code == 201 and r.json()["movioAFiltroHumano"] is True and r.json()["candidato"]["etapa"] == "Entrevista Humana",
          "IPV humana desde Filtro Red Human → pasa a Filtro humano al guardar")
    adj = [c for c in CORREOS if c[3]]
    check(adj and adj[0][3][0]["filename"].startswith("ficha-") and adj[0][3][0]["content"][:4] == b"%PDF", "el entrevistador recibe la ficha del candidato (PDF) con su cita")
    ficha = client.get(f"/candidatos/{P1}").json()
    mods = next(a for a in ficha["avance"]["actividades"] if a["clave"] == "ipv")["modalidades"]
    check({m["modo"] for m in mods} == {"red_human", "humano"} and next(m for m in mods if m["modo"] == "humano")["columna"] == "Entrevista Humana",
          "IPV Red Human e IPV humana identificadas por separado, con responsable y estado propios")
    eh_ipv = ficha["entrevistasHumanas"][-1]
    check(eh_ipv["claseNombre"] == "IPV humana" and eh_ipv["envios"] and eh_ipv["ligaEntrevistador"], "la entrevista guarda sus avisos y la liga del entrevistador")
    inicial = next(a for a in ficha["avance"]["actividades"] if a["clave"] == "entrevista_inicial")
    check(inicial["estado"] == "pendiente", "omitir/hacer IPV humana no equivale a la entrevista humana de Reclutamiento")

    print("\n=== §2 Reprogramar: avisos por defecto, recordatorio nuevo, estado por destinatario ===")
    eh = db.query(EntrevistaHumana).get(eh_ipv["id"])
    eh.recordatorio_enviado_en = datetime.now(timezone.utc)
    db.commit()
    MENSAJES.clear(); CORREOS.clear()
    nueva = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
    r = client.patch(f"/candidatos/{P1}/entrevista-humana", json={"entrevista_id": eh_ipv["id"], "fecha": nueva, "hora": "12:30", "modalidad": "Videollamada",
                                                               "liga": "https://meet.example/abc", "comentario": "Trae tu INE"})
    res = r.json()
    dest = {(x["destinatario"], x["canal"]) for x in res["resultados"]}
    check(r.status_code == 200 and {("candidato", "whatsapp"), ("entrevistador", "whatsapp"), ("candidato", "correo"), ("entrevistador", "correo")} <= dest,
          "reprogramar avisa POR DEFECTO a candidato y entrevistador (mensaje y correo)")
    check(any("https://meet.example/abc" in x and "Trae tu INE" in x for _, x in MENSAJES), "el aviso trae nueva fecha/hora, modalidad, liga e instrucciones")
    db.expire_all()
    check(db.query(EntrevistaHumana).get(eh_ipv["id"]).recordatorio_enviado_en is None, "el recordatorio anterior se cancela (se programará el de la nueva cita)")
    r = client.post(f"/candidatos/{P1}/entrevista-humana/reenviar", json={"entrevista_id": eh_ipv["id"], "destinatario": "candidato"})
    check(r.status_code == 200 and {x["destinatario"] for x in r.json()["resultados"]} == {"candidato"}, "Reintentar/Reenviar por destinatario")

    print("\n=== §6 IPV: provisional con peso pendiente, sin «Medio» automático ===")
    calc = fraiche.calcular_ipv({"orientacion_cliente": "alto", "motivacion": "medio", "resiliencia": "sin_evidencia", "trabajo_equipo": "alto", "etica": "alto", "adaptabilidad": "sin_evidencia"})
    check(calc["puntaje"] is None and calc["conclusion"] == "" and calc["peso_pendiente"] == 15 and calc["puntaje_provisional"] == 80.5,
          f"faltan competencias → resultado provisional {calc['puntaje_provisional']} con {calc['peso_pendiente']} % pendiente, sin redistribuir")
    check(fraiche.NOMBRE_NIVEL_IPV["sin_evidencia"] == "Por validar — evidencia insuficiente", "«Por validar — evidencia insuficiente» en lugar de «Sin evidencia»")
    check([c["pregunta"] for c in fraiche.COMPETENCIAS_IPV][0] == "Cuéntame una ocasión en que atendiste a un cliente inconforme.", "preguntas base de Fraiche")
    check([c["peso"] for c in fraiche.COMPETENCIAS_IPV] == [30, 15, 10, 20, 20, 5], "pesos de Fraiche sin cambio")

    print("\n=== §12/§14 Entrevista adicional desde una etapa posterior: no regresa, no reemplaza la aprobada ===")
    p1 = db.query(Postulacion).filter(Postulacion.codigo == P1).first()
    p1.etapa = "Contratación"
    db.commit()
    r = client.post(f"/candidatos/{P1}/entrevista-humana", json={**base_eh, "clase": "encargado"})
    check(r.status_code == 201 and r.json()["movioAFiltroHumano"] is False and r.json()["candidato"]["etapa"] == "Contratación",
          "entrevista con encargado desde Contratación: se agrega SIN regresar al candidato")
    acts = r.json()["candidato"]["avance"]["actividades"]
    adicional = next(a for a in acts if a["nombre"] == "Entrevista con encargado de tienda")
    check(adicional["obligatoria"] is False, "una entrevista adicional no bloquea si no se definió obligatoria")
    r = client.post(f"/candidatos/{P1}/ipv", json={"modo": "red_human"})
    check(r.status_code == 201 and r.json()["candidato"]["etapa"] == "Contratación", "IPV Red Human desde una etapa posterior no regresa al candidato")

    print("\n=== §11 Movimiento excepcional: motivo obligatorio ===")
    r = client.patch(f"/candidatos/{P1}/etapa", json={"etapa": "Entrevista IA", "manual": True})
    check(r.status_code == 400 and "motivo" in r.json()["detail"], "retroceder sin motivo → 400")
    r = client.patch(f"/candidatos/{P1}/etapa", json={"etapa": "Entrevista Humana", "manual": True, "comentario": "Falta validar referencias en persona"})
    check(r.status_code == 200 and r.json()["etapa"] == "Entrevista Humana", "con motivo sí se mueve (y las evaluaciones se conservan)")

    print("\n=== §4 Mismo número, avisos por rol y cola por vincular ===")
    async def _cola():
        e1 = await avisos.avisar(db, rol="medico", nombre="Dra. Prueba", telefono="5599990000", correo="dra@demo.invalid", asunto="Dictamen", texto="Registra el dictamen: https://x/1", liga="https://x/1")
        e2 = await avisos.avisar(db, rol="medico", nombre="Dra. Prueba", telefono="5599990000", asunto="Dictamen", texto="Otro aviso https://x/2", canales=("whatsapp",))
        db.commit()
        return e1, e2
    e1, e2 = asyncio.run(_cola())
    w1 = next(x for x in e1 if x["canal"] == "whatsapp")
    check(w1["estado"] == "pendiente" and "vincule su chat" in w1["detalle"], "sin vínculo → estado «pendiente» (no fallido) con el motivo y la liga para vincular")
    check(any("vincula tu chat una sola vez" in c[2] for c in CORREOS if c[0] == "dra@demo.invalid"), "se le solicita vincular UNA vez (por correo)")
    check(db.query(AvisoPendiente).filter(AvisoPendiente.telefono == "5599990000", AvisoPendiente.entregado_en.is_(None)).count() == 2, "los avisos quedan en cola")
    SIN_VINCULO.clear()
    MENSAJES.clear()
    n = asyncio.run(avisos.entregar_pendientes(db, "5599990000"))
    db.commit()
    check(n == 2 and all(x.startswith("📋 Aviso para médico") for _, x in MENSAJES), "al vincular se entregan los pendientes, identificados por rol")
    check(avisos._encabezado("candidato", "hola") == "hola", "al candidato no se le antepone rol (su conversación no se mezcla)")

    print("\n=== §7/§8 Varias psicometrías, liga del candidato y estados claros ===")
    P2 = postular(vd, "Daniela Prueba Dos", "5581110002", "daniela@demo.invalid")
    pruebas = db.query(PruebaPsicometrica).filter(PruebaPsicometrica.cuenta_id == cuenta.id, PruebaPsicometrica.proveedor == fraiche.PROVEEDOR_EVALUATEST).all()
    check(all(p.incluye for p in pruebas), "cada batería dice qué pruebas incluye")
    ids = [p.id for p in pruebas[:2]]
    # 2026-10-04: sin liga real (los datos demo no inventan una) → no se manda nada al candidato y RH ve el motivo
    r = client.post(f"/evaluaciones/postulaciones/{P2}", json={"tipo": "psicometrica", "prueba_ids": [ids[0]]})
    ev0 = r.json()["evaluaciones"][0]
    check(ev0["ligaCandidato"] is None and any(x["estado"] == "fallido" and "liga real" in x["detalle"] for x in r.json()["envios"]),
          "prueba sin liga real del proveedor: no se envía una liga que no abre y RH ve el motivo")
    r = client.patch(f"/evaluaciones/{ev0['id']}", json={"liga_candidato": "https://evaluatest.example.invalid/x"})
    check(r.status_code == 400, "una liga de ejemplo se rechaza")
    r = client.patch(f"/evaluaciones/{ev0['id']}", json={"liga_candidato": "https://app.evaluatest.com/acceso/ABC123"})
    check(r.status_code == 200 and r.json()["ligaCandidato"] == "https://app.evaluatest.com/acceso/ABC123", "RH pega la liga real en la evaluación")
    r = client.post(f"/evaluaciones/{ev0['id']}/avisos", json={"destinatario": "candidato"})
    check(any(t == "5581110002" and "app.evaluatest.com/acceso/ABC123" in x for t, x in MENSAJES), "…y se le envía al candidato")
    client.post(f"/evaluaciones/{ev0['id']}/cancelar", json={"motivo": "prueba"})
    for pr in pruebas:
        pr.url = f"https://app.evaluatest.com/bateria/{pr.id}"
    db.commit()
    MENSAJES.clear()
    r = client.post(f"/evaluaciones/postulaciones/{P2}", json={"tipo": "psicometrica", "prueba_ids": ids})
    d = r.json()
    check(r.status_code == 201 and len(d["evaluaciones"]) == 2, "dos pruebas en una sola asignación, cada una con su registro")
    check(all(ev["ligaCandidato"] and "/evaluacion/" not in ev["ligaCandidato"] for ev in d["evaluaciones"]), "Copiar liga entrega la liga del CANDIDATO, nunca el formulario del evaluador")
    check(sum(1 for t, x in MENSAJES if t == "5581110002" and "te asignamos la prueba" in x) == 2, "el candidato recibe nombre de la prueba, instrucciones y su liga (una por prueba)")
    check(all(ev["estadoPsicometriaTexto"] == "En curso" for ev in d["evaluaciones"]), "estado claro: En curso (sin etiqueta «Integrada»)")
    r = client.post(f"/evaluaciones/postulaciones/{P2}", json={"tipo": "psicometrica", "prueba_ids": ids + [pruebas[2].id]})
    check(r.status_code == 201 and len(r.json()["evaluaciones"]) == 1 and len(r.json()["omitidas"]) == 2, "agregar después no duplica ni sustituye las anteriores")
    f2 = client.get(f"/candidatos/{P2}").json()
    psi = next(a for a in f2["avance"]["actividades"] if a["clave"] == "psicometria")
    check(psi["resultado"] == "0 de 3 completadas" and len(psi["partes"]) == 3, "avance conjunto: «0 de 3 completadas»")

    print("\n=== §9 Médico: consentimiento automático, dictamen bloqueado, aviso al médico ===")
    MENSAJES.clear(); CORREOS.clear()
    r = client.post(f"/evaluaciones/postulaciones/{P2}", json={"tipo": "medico", "responsable": {"nombre": "Dr. Salud", "correo": "dr@demo.invalid", "whatsapp": "5581119999"}})
    ev_m = r.json()
    check(r.status_code == 201 and ev_m["estado"] == "en_espera_consentimiento", "al crear el estudio médico queda en espera de consentimiento")
    check(any(t == "5581110002" and "/consentimiento/" in x for t, x in MENSAJES), "la solicitud de consentimiento se envía SOLA al candidato")
    check(not any(t == "5581119999" for t, _ in MENSAJES), "el médico todavía no recibe su liga")
    check(client.post(f"/evaluaciones/{ev_m['id']}/resultado", data={"decision": "apto"}).status_code == 409, "el dictamen está bloqueado mientras el consentimiento está pendiente")
    tok = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.codigo == ev_m["id"]).first().consentimiento_token
    r = client.post(f"/evaluaciones/publica/consentimiento/{tok}/aceptar", json={"nombre": "Daniela Prueba Dos", "acepto": True})
    check(r.status_code == 200 and r.json()["estado"] == "pendiente", "al aceptar se habilita el registro")
    check(any(t == "5581119999" and "/evaluacion/" in x for t, x in MENSAJES), "y se avisa al médico con SU liga")

    print("\n=== §10 Referencias estructuradas ===")
    MENSAJES.clear()
    r = client.post(f"/evaluaciones/postulaciones/{P2}", json={"tipo": "referencias", "referencias_modo": "candidato", "referencias_requeridas": 2,
                                                              "responsable": {"nombre": "Ana Refs", "whatsapp": "5581118888"}})
    ev_r = r.json()
    check(r.status_code == 201 and ev_r["referenciasResumen"]["requeridas"] == 2 and ev_r["ligaReferenciasCandidato"], "cantidad configurable (2, no 3 fijo) y liga de captura para el candidato")
    check(any(t == "5581110002" and "/referencias/" in x for t, x in MENSAJES), "se envía al candidato su liga de captura")
    tok_c = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.codigo == ev_r["id"]).first().token_candidato
    MENSAJES.clear()
    refs = [{"empresa": "Tienda A", "puesto_candidato": "Vendedora", "periodo": "2022-2024", "contacto_nombre": "Laura Jefa", "contacto_cargo": "Gerente",
             "relacion": "Jefa directa", "telefono": "5512340001"},
            {"empresa": "Tienda B", "puesto_candidato": "Cajera", "periodo": "2020-2022", "contacto_nombre": "Pedro Jefe", "contacto_cargo": "Supervisor",
             "relacion": "Jefe directo", "telefono": "5512340002", "resultado": "favorable", "fecha_contacto": "2026-10-01"}]
    r = client.post(f"/evaluaciones-externas/referencias/{tok_c}", json={"referencias": refs})
    check(r.status_code == 200, "el candidato captura sus referencias")
    ev = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.codigo == ev_r["id"]).first()
    db.refresh(ev)
    check(all(x["estado"] == "por_contactar" and not x.get("resultado") for x in ev.referencias), "capturar contactos NO es validarlos (el candidato no puede validar)")
    check(any(t == "5581118888" and "/evaluacion/" in x for t, x in MENSAJES), "se avisa al responsable cuando el candidato completa los datos")
    check(client.post(f"/evaluaciones/{ev_r['id']}/revisar", json={"dictamen": "favorable"}).status_code == 409, "no se puede cerrar como Favorable sin referencias verificadas")
    tok_e = ev.token_externo
    val = [dict(x) for x in ev.referencias]
    val[0].update({"no_contactada": True})
    val[1].update({"contesto_nombre": "Pedro Jefe", "contesto_cargo": "Supervisor", "fecha_contacto": "2026-10-02", "medio": "Teléfono", "confirma_puesto": "si",
                   "confirma_periodo": "si", "desempeno": "Muy bueno", "motivo_salida": "No informado", "recontrataria": "si", "resultado": "favorable"})
    r = client.post(f"/evaluaciones-externas/publica/{tok_e}/referencias", json={"referencias": val})
    check(r.status_code == 200 and r.json()["resumen"]["validadas"] == 1 and r.json()["referencias"][0]["estado"] == "no_contactada",
          "«No contactada» no es desfavorable y no cuenta como validada")
    val[0].update({"no_contactada": False, "contesto_nombre": "Laura Jefa", "fecha_contacto": "2026-10-02", "medio": "Teléfono", "resultado": "con_observaciones",
                   "recontrataria": "no_informado"})
    CORREOS.clear()
    r = client.post(f"/evaluaciones-externas/publica/{tok_e}/referencias", json={"referencias": val})
    check(r.json()["resumen"]["completas"] and r.json()["estadoTexto"] == "Con resultado", "con las requeridas validadas → resultado recibido")
    check(any("Referencias laborales validadas" in c[1] for c in CORREOS), "se avisa a RH al terminar la validación")

    print("\n=== §13 Contrato en Contratación y Onboarding ===")
    p2 = db.query(Postulacion).filter(Postulacion.codigo == P2).first()
    r = client.patch(f"/candidatos/{P2}/etapa", json={"etapa": "Contratación", "manual": True, "comentario": "Prueba de contrato"})
    exp = r.json()["expedienteId"]
    r = client.get(f"/contratacion/expedientes/{exp}/contrato")
    check(r.status_code == 409 and "falta" in r.json()["detail"].lower() and "sueldo" in r.json()["detail"].lower(), f"sin condiciones dice exactamente qué falta: {r.json()['detail'][:120]}")
    client.patch(f"/candidatos/{P2}/condiciones-contratacion", json={"puesto": "Demostrador", "sueldo": "$11,500", "tipo_contratacion": "Tiempo indeterminado",
                                                                    "fecha_ingreso": (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")})
    r = client.get(f"/contratacion/expedientes/{exp}/contrato")
    check(r.status_code == 200 and r.content[:4] == b"%PDF", "con condiciones guardadas se genera aunque falten documentos")
    r = client.post(f"/contratacion/expedientes/{exp}/contrato/enviar", json={"canal": "correo"})
    check(r.status_code == 200 and r.json()["enviado"] and CORREOS[-1][3][0]["filename"] == "contrato.pdf", "envío del contrato por correo con el PDF")
    e = client.get(f"/contratacion/expedientes/{exp}").json()
    check(e.get("contratoFaltan") == [] and e.get("contratoFirmado") is False, "el expediente dice qué falta y si ya hay contrato firmado")
    res = client.get(f"/onboarding/expedientes/{exp}/resumen").json()
    check(res["documentosPendientes"] and res["fechaIngreso"], "el resumen de Onboarding muestra documentos pendientes y la fecha base de los plazos")
    plazos = {**res["configuracion"]["plazos"], "documentos": -2}
    # la postulación llegó a Contratación por movimiento excepcional (saltó actividades): para probar SOLO que documentos y
    # contrato pendientes no bloquean el inicio, se activa Modo Prueba durante esta llamada
    configuracion.obtener(db).modo_prueba = True
    db.commit()
    r = client.post(f"/onboarding/expedientes/{exp}/iniciar", json={"documentos": res["configuracion"]["documentos"], "recursos": res["configuracion"]["recursos"],
                                                                     "responsables": res["configuracion"]["responsables"], "plazos": plazos})
    check(r.status_code == 200, f"se inicia Onboarding con documentos y contrato pendientes ({r.status_code} {r.text[:300]})")
    configuracion.obtener(db).modo_prueba = False
    db.commit()
    db.expire_all()
    from app.models import Expediente  # noqa: E402

    ex = db.query(Expediente).get(exp)
    check(ex.plazo_documentos_dias == -2 and ex.documentos_hasta is not None, "el plazo «Documentos completos» fija la fecha límite de documentos")
    r = client.get(f"/contratacion/expedientes/{exp}/contrato")
    check(r.status_code == 200, "el contrato también se genera en Onboarding con las mismas condiciones")

    print("\n=== Alcance Fraiche ===")
    from app.services import fraiche_pipeline as fp  # noqa: E402

    check(fp.aplica_socioeconomico(db.query(Postulacion).filter(Postulacion.codigo == P1).first()), "socioeconómico aplica a Cajero")
    check(not fp.aplica_socioeconomico(p2), "y no a Demostrador")
    r = client.post(f"/evaluaciones/postulaciones/{P2}", json={"tipo": "socioeconomico", "enviar": False})
    check(r.status_code == 409, "agregar socioeconómico a un Demostrador de tienda propia → 409")

    print("\n=== Envío de ficha al entrevistador (2026-10-04) ===")
    P3 = postular(vc, "Fernanda Ficha Tres", "5581110003", "fer3@demo.invalid")
    CORREOS.clear()
    r = client.post(f"/candidatos/{P3}/entrevista-humana", json={**base_eh, "tipo_entrevistador": "externo", "entrevistador_nombre": "Encargada Ext",
                                                                "entrevistador_correo": "ext@demo.invalid", "entrevistador_whatsapp": "5581117777"})
    eh3 = r.json()["candidato"]["entrevistasHumanas"][-1]
    check(r.status_code == 201 and eh3["compartir"] == "ficha", "«Solo ficha» es la opción por defecto")
    html_ent = next(c for c in CORREOS if c[0] == "ext@demo.invalid")
    check("Abrir ficha y evaluar" in html_ent[2] and html_ent[3] and html_ent[3][0]["content"][:4] == b"%PDF", "el correo trae datos de la entrevista, la ficha en PDF y «Abrir ficha y evaluar»")
    tok3 = db.query(EntrevistaHumana).get(eh3["id"]).token
    pub = client.get(f"/entrevista-humana/publica/{tok3}").json()
    check(pub["ficha"]["candidato"]["nombre"] == "Fernanda Ficha Tres" and "expediente" not in pub and pub["puedeVerExpediente"] is False,
          "la liga muestra la ficha y no trae expediente ni análisis adicional")
    from app.routers.candidatos import datos_ficha_entrevistador  # noqa: E402

    p3 = db.query(Postulacion).filter(Postulacion.codigo == P3).first()
    db.refresh(p3)
    misma = datos_ficha_entrevistador(db, p3, db.query(EntrevistaHumana).get(eh3["id"]))
    check({k: v for k, v in pub["ficha"].items() if k != "generada"} == {k: v for k, v in misma.items() if k != "generada"}, "la ficha de la liga es la misma que genera el PDF")
    check(client.get(f"/entrevista-humana/publica/{tok3}/ficha.pdf").content[:4] == b"%PDF", "la liga ofrece el mismo PDF")
    check(client.get(f"/entrevista-humana/publica/{tok3}/expediente").status_code == 403, "«Solo ficha»: el expediente se niega también por acceso directo")
    check(client.get(f"/entrevista-humana/publica/{tok3}/archivo/1").status_code == 403, "…y los archivos del candidato también")
    r = client.post(f"/candidatos/{P3}/entrevista-humana/reenviar", json={"entrevista_id": eh3["id"], "destinatario": "entrevistador", "compartir": "ficha_expediente"})
    check(r.status_code == 200 and client.get(f"/entrevista-humana/publica/{tok3}").json()["puedeVerExpediente"] is True, "Reenviar con «Ficha + expediente» habilita «Ver expediente»")
    ex = client.get(f"/entrevista-humana/publica/{tok3}/expediente").json()
    check({"cv", "documentos", "respuestas", "evaluacionesPrevias"} <= set(ex) and ex["respuestas"] and ex["candidato"]["telefono"] == "",
          "expediente: CV, documentos, respuestas y evaluaciones previas (externo sin datos de contacto)")
    r = client.patch(f"/candidatos/{P3}/entrevista-humana/compartir", json={"entrevista_id": eh3["id"], "compartir": "ficha"})
    check(r.status_code == 200 and client.get(f"/entrevista-humana/publica/{tok3}/expediente").status_code == 403, "volver a «Solo ficha» bloquea de nuevo el expediente")
    r = client.post(f"/entrevista-humana/publica/{tok3}", json={"resultado": "aprobado", "recomendacion": "avanzar", "comentario": "Buena actitud"})
    check(r.status_code == 200 and r.json()["mensaje"] == "Evaluación guardada", "«Guardar evaluación» confirma «Evaluación guardada»")
    f3 = client.get(f"/candidatos/{P3}").json()
    eh3b = next(x for x in f3["entrevistasHumanas"] if x["id"] == eh3["id"])
    check(eh3b["resultado"] == "aprobado" and eh3b["recomendacion"] == "avanzar" and eh3b["comentario"] == "Buena actitud" and eh3b["resultadoCapturadoPor"] == "entrevistador",
          "el resultado queda vinculado a ESA entrevista humana y se ve en Evaluaciones del candidato")

print(f"\n🎉 Cambios integrados Fraiche (2026-10-02): {OK} comprobaciones OK")
