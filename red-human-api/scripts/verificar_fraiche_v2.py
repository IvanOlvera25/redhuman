"""Validación final «Cambios integrados — Fraiche» (2026-10-01): una postulación de TIENDA PROPIA y otra de
FRANQUICIA desde el formulario hasta su cierre, comprobando ruta, columnas, continuidad en chat, guion, sueldo,
resultados («Revisado por»), requisitos para avanzar y bloqueos con lo que falta. Base desechable, cero mensajes.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_v2.py
"""

import asyncio
import json
import os
import secrets
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
_dir = tempfile.mkdtemp(prefix="rh_fr_v2_")
DB_URL = "sqlite:///" + str(Path(_dir) / "v2.db")
os.environ.update({"DATABASE_URL": DB_URL, "SEMBRAR_DEMO": "false", "ADMIN_PASSWORD": "prueba-v2", "FRAICHE_PUBLICACION_ESTRICTA": "false"})
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "RESEND_API_KEY", "ANAM_API_KEY", "TELEGRAM_BOT_TOKEN"):
    os.environ[k] = ""

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
from app.models import Cuenta, Entrevista, EvaluacionCandidato, Postulacion, Usuario, Vacante  # noqa: E402
from app.routers import entrevistas as r_ent  # noqa: E402
from app.services import fraiche, fraiche_pipeline as fp  # noqa: E402
from app.services.entrevistas import crear_entrevista_para_candidato  # noqa: E402


def respuestas_web(v):
    filas = []
    for c in fraiche.preguntas_para_vacante(v.preguntas_filtro or [], sucursal=v.sucursal or "", sueldo=v.sueldo or ""):
        if c["tipo"] == "municipio":
            resp = f"{v.ubicacion_municipio}, {v.ubicacion_estado}"
        elif c.get("clave") == "traslado":
            resp = "Hasta 30 min"
        elif c.get("clave") == "sueldo":
            resp = "Sí"
        elif c["tipo"] == "opcion":
            resp = c["opciones"][0]
        else:
            resp = "Sí"
        filas.append({"pregunta": c["pregunta"], "respuesta": resp, **({"clave": c["clave"]} if c.get("clave") else {})})
    return filas


def eval_revisada(db, cuenta, p, tipo, nombre, dictamen="favorable", revisor="Revisora RH"):
    ev = EvaluacionCandidato(codigo="TMP", cuenta_id=cuenta.id, postulacion_id=p.id, tipo=tipo, nombre=nombre, modo="manual", asignada_por="Prueba",
                             estado="revisada", dictamen=dictamen, revisada_por=revisor, revisada_en=datetime.now(timezone.utc),
                             resultado_cargado_por=revisor, resultado_cargado_en=datetime.now(timezone.utc), historial=[])
    db.add(ev)
    db.flush()
    ev.codigo = f"EVA-{9000 + ev.id}"
    return ev


def entrevista_evaluada(db, p):
    e, _ = crear_entrevista_para_candidato(db, p, "Prueba", fase="inicial")
    e.estado, e.finalizada_en = "evaluada", datetime.now(timezone.utc)
    e.evaluacion = {"recomendacion": "avanzar", "match_perfil": 82, "resumen": "Bien", "fortalezas": [], "riesgos": [], "faltante": []}
    db.commit()
    return e


def act(ficha, clave):
    return next((a for a in ficha["avance"]["actividades"] if a["clave"] == clave), None)


with TestClient(app) as client:
    db = SessionLocal()
    cuenta = db.query(Cuenta).filter(Cuenta.slug == "fraiche").first()
    recl = db.query(Usuario).filter(Usuario.correo == "reclutador@fraiche.demo").first()
    app.dependency_overrides[cuenta_actual] = lambda: cuenta
    app.dependency_overrides[usuario_actual] = lambda: recl
    app.dependency_overrides[usuario_decisor] = lambda: recl
    vt = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.destino == "tienda_propia", Vacante.titulo == "Cajero", Vacante.estado == "Publicada").first()
    vf = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.destino == "franquicia", Vacante.estado == "Publicada").first()
    vt.sueldo_hasta, vt.sueldo = vt.sueldo_desde, "$14,500 MXN mensuales"
    db.commit()

    print("\n=== Columnas ===")
    check([c["nombre"] for c in fp.COLUMNAS] == ["Prefiltro", "Filtro Red Human", "Filtro humano", "Contratación", "Onboarding"], "un solo pipeline de cinco columnas")
    check(client.patch(f"/candidatos/{db.query(Postulacion).filter(Postulacion.cuenta_id == cuenta.id, Postulacion.activa.is_(True)).first().codigo}/etapa",
                       json={"etapa": "Evaluación", "manual": True}).status_code == 400, "nadie puede mover a la columna retirada «Evaluación»")

    # ------------------------------------------------------------------
    print("\n=== TIENDA PROPIA (Cajero) ===")
    r = client.post("/candidatos/postular", data={"vacante": vt.slug, "nombre": "Teresa Propia Uno", "telefono": "5591110001", "correo": "teresa@demo.invalid",
                                                  "consentimiento": "true", "respuestas": json.dumps(respuestas_web(vt))})
    check(r.status_code == 201, "postulación desde el formulario")
    PT = r.json()["postulacion"]
    f = client.get(f"/candidatos/{PT}").json()
    check(f["etapa"] == "Entrevista IA" and f["avance"]["columnaNombre"] == "Filtro Red Human" and f["avance"]["ruta"] == "Tienda propia",
          "formulario y requisitos superados → Filtro Red Human; hereda la ruta de la vacante")
    check(act(f, "formulario")["estado"] == "hecha" and act(f, "formulario")["revisadoPor"].startswith("Red Human"), "Prefiltro: resultado y «Revisado por»")
    check(act(f, "psicometria") is None, "Cajero sin batería: la psicometría no aplica y no genera pendiente")
    check(act(f, "socioeconomico") is not None and act(f, "medico") is not None and act(f, "ipv") is not None, "tienda propia: IPV, médico y socioeconómico (Cajero)")
    check(not any("CV" in x for x in f["avance"]["pendientes"]), "el resumen no exige CV")

    # filtro por mensaje (modo demo): el sueldo se muestra y valida con monto, moneda y periodicidad
    respuestas_chat = ["Hola", "2 años", "Cajera", "Cobrar", "2 años", "La próxima semana", "Sí", "No"]
    for t in respuestas_chat:
        client.post(f"/candidatos/{PT}/prefiltro", json={"texto": t})
    msgs = client.get(f"/candidatos/{PT}/mensajes").json()
    textos = " ".join(m["texto"] for m in (msgs if isinstance(msgs, list) else msgs.get("mensajes", [])))
    check("$14,500 MXN mensuales (catorce mil quinientos pesos mexicanos al mes)" in textos, "el prefiltro por mensaje muestra el sueldo correcto (nunca «dólares con centavos»)")
    check("¿Cuándo podrías empezar a trabajar en Fraiche?" in textos, "disponibilidad: «¿Cuándo podrías empezar a trabajar en Fraiche?»")
    f = client.get(f"/candidatos/{PT}").json()
    check(f["prefiltroCompleto"] and act(f, "filtro_mensaje")["estado"] == "hecha" and f["etapa"] == "Entrevista IA", "filtro por mensaje completo; sigue en Filtro Red Human")

    p = db.query(Postulacion).filter(Postulacion.codigo == PT).first()
    db.refresh(p)
    e = entrevista_evaluada(db, p)
    g = e.guion or {}
    check(not any("sueldo" in str(x).lower() or "salari" in str(x).lower() for x in g.get("preguntas", [])) and "¿Cuándo podrías empezar a trabajar en Fraiche?" in g.get("preguntas", []),
          "guion de la entrevista: sin sueldo y con la disponibilidad exacta")
    f = client.get(f"/candidatos/{PT}").json()
    check(f["etapa"] == "Entrevista IA" and f["avance"]["siguienteAccion"]["tipo"] == "agregar_evaluacion" and f["avance"]["siguienteAccion"].get("evaluacion") == "ipv"
          and f["avance"]["siguienteAccion"].get("modo") == "red_human",
          "con la entrevista del agente hecha, se RECOMIENDA la IPV con Red Human antes de la entrevista humana (2026-10-02)")
    r = client.patch(f"/candidatos/{PT}/etapa", json={"etapa": "Contratación"})
    check(r.status_code == 409 and "falta" in r.json()["detail"].lower() and "Entrevista inicial" in r.json()["detail"], f"pasar a Contratación antes de tiempo dice EXACTAMENTE qué falta: {r.json()['detail'][:140]}")

    manana = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    r = client.post(f"/candidatos/{PT}/entrevista-humana", json={"tipo_entrevistador": "interno", "entrevistador_usuario_id": recl.id, "fecha": manana, "hora": "10:00", "modalidad": "Llamada"})
    check(r.status_code == 201, f"agregar entrevista humana ({r.status_code} {r.text[:120]})")
    f = client.get(f"/candidatos/{PT}").json()
    check(f["etapa"] == "Entrevista Humana" and f["avance"]["columnaNombre"] == "Filtro humano", "crear una entrevista humana mueve a Filtro humano")
    r = client.post(f"/candidatos/{PT}/entrevista-humana/resultado", json={"resultado": "aprobado", "recomendacion": "avanzar"})
    check(r.status_code == 200 and act(r.json(), "entrevista_inicial")["estado"] == "hecha" and act(r.json(), "entrevista_inicial")["revisadoPor"], "entrevista inicial aprobada con «Revisado por»")
    r = client.post(f"/candidatos/{PT}/entrevista-humana", json={"tipo_entrevistador": "interno", "entrevistador_usuario_id": recl.id, "fecha": manana, "hora": "12:00", "modalidad": "Llamada", "es_ipv": True})
    niveles = {c["clave"]: "alto" for c in fraiche.COMPETENCIAS_IPV}
    r = client.post(f"/candidatos/{PT}/entrevista-humana/resultado", json={"rubrica": {"niveles": niveles}})
    f = client.get(f"/candidatos/{PT}").json()
    check(act(f, "ipv")["estado"] == "hecha" and "Recomendable" in act(f, "ipv")["resultado"], "IPV humana con rúbrica: Recomendable")
    check(f["etapa"] == "Entrevista Humana", "agregar evaluaciones o recibir resultados no cambia la columna")
    db.expire_all()
    p = db.query(Postulacion).filter(Postulacion.codigo == PT).first()
    eval_revisada(db, cuenta, p, "medico", "Estudio médico")
    eval_revisada(db, cuenta, p, "socioeconomico", "Estudio socioeconómico")
    db.commit()
    f = client.get(f"/candidatos/{PT}").json()
    check(not f["avance"]["puedeAvanzar"] and any("Referencias" in x for x in f["avance"]["faltaParaAvanzar"]), "falta Referencias → no puede avanzar y lo dice")
    eval_revisada(db, cuenta, p, "referencias", "Referencias laborales")
    db.commit()
    f = client.get(f"/candidatos/{PT}").json()
    check(f["avance"]["puedeAvanzar"] and f["avance"]["integral"]["conclusion"] == "apto" and f["avance"]["siguienteAccion"]["etapa"] == "Contratación",
          "todo lo aplicable completo: Evaluación integral «Apto» y siguiente acción «Pasar a Contratación»")
    check(all(x["revisadoPor"] for x in f["avance"]["integral"]["resultados"]), "cada validación muestra «Revisado por»")
    r = client.patch(f"/candidatos/{PT}/etapa", json={"etapa": "Contratación"})
    check(r.status_code == 200 and r.json()["etapa"] == "Contratación" and r.json().get("expedienteId"), "pasa a Contratación (condiciones y documentación de Fraiche)")
    db.expire_all()
    p = db.query(Postulacion).filter(Postulacion.codigo == PT).first()
    p.etapa = "Onboarding"
    p.expediente.estado_sap = fraiche.ESTADO_LISTO_SAP
    db.commit()
    f = client.get(f"/candidatos/{PT}").json()
    sap = act(f, "sap")
    check(sap["estado"] == "hecha" and "Listo para enviar a SAP" in sap["resultado"] and "nviado" not in sap["resultado"], "«Listo para enviar a SAP» nunca se muestra como «Enviado»")

    print("\n--- Requisito obligatorio No apto prevalece sobre un score alto ---")
    r = client.post("/candidatos/postular", data={"vacante": vt.slug, "nombre": "Ulises Propio Dos", "telefono": "5591110002", "consentimiento": "true", "respuestas": json.dumps(respuestas_web(vt))})
    P2 = r.json()["postulacion"]
    db.expire_all()
    p2 = db.query(Postulacion).filter(Postulacion.codigo == P2).first()
    p2.score, p2.etapa = 96, "Entrevista Humana"
    eval_revisada(db, cuenta, p2, "medico", "Estudio médico", dictamen="desfavorable", revisor="Dra. Prueba")
    db.commit()
    f = client.get(f"/candidatos/{P2}").json()
    check(f["avance"]["integral"]["conclusion"] == "no_apto" and "prevalece" in f["avance"]["integral"]["texto"] and f["avance"]["siguienteAccion"]["tipo"] == "no_cumple",
          "médico No apto con score 96 → Evaluación integral «No apto» (prevalece)")
    r = client.patch(f"/candidatos/{P2}/etapa", json={"etapa": "Contratación"})
    check(r.status_code == 409 and "requisito obligatorio" in r.json()["detail"], "y no puede pasar a Contratación")
    check(f["activa"] and f["etapa"] == "Entrevista Humana", "No cumple permanece en su columna (se oculta con el filtro existente)")

    # ------------------------------------------------------------------
    print("\n=== FRANQUICIA ===")
    r = client.post("/candidatos/postular", data={"vacante": vf.slug, "nombre": "Fabiola Franquicia", "telefono": "5591110003", "correo": "fabiola@demo.invalid",
                                                  "consentimiento": "true", "respuestas": json.dumps(respuestas_web(vf))})
    PF = r.json()["postulacion"]
    f = client.get(f"/candidatos/{PF}").json()
    check(f["avance"]["ruta"] == "Franquicia" and f["etapa"] == "Entrevista IA", "hereda la ruta Franquicia y entra a Filtro Red Human")
    claves = [a["clave"] for a in f["avance"]["actividades"]]
    check(not {"ipv", "psicometria", "medico", "socioeconomico", "contratacion", "sap"} & set(claves), "franquicia sin IPV, psicometría, médico, socioeconómico, kit de precontratación ni SAP")
    check(client.post(f"/evaluaciones/postulaciones/{PF}", json={"tipo": "medico"}).status_code == 409 and client.post(f"/candidatos/{PF}/ipv", json={"modo": "red_human"}).status_code == 409,
          "y la API rechaza agregarlos")
    db.expire_all()
    pf = db.query(Postulacion).filter(Postulacion.codigo == PF).first()
    pf.prefiltro_completo = True
    ef = entrevista_evaluada(db, pf)
    prompt = r_ent._system_prompt(ef)
    check("Franquicia 0" not in prompt and "Franquicia 0" not in json.dumps(ef.guion, ensure_ascii=False) and "Fraiche" in prompt, "guion y prompt dicen «Fraiche», nunca «Franquicia 001»")
    check("sueldo:" not in prompt.lower() and "NO menciones ni preguntes el sueldo" in prompt, "la entrevista no menciona ni pregunta el sueldo")
    pub = client.get("/vacantes/publicas", params={"cuenta": "fraiche"}).json()
    vpub = next(x for x in pub if x["id"] == vf.codigo)
    check(not any("Franquicia 0" in str(vpub.get(k) or "") for k in ("sucursal", "empresa", "nombreEmpresa", "cliente")) and vpub["nombreEmpresa"] == "Fraiche",
          "el portal no muestra el código interno de la franquicia")

    client.post(f"/candidatos/{PF}/entrevista-humana", json={"tipo_entrevistador": "interno", "entrevistador_usuario_id": recl.id, "fecha": manana, "hora": "10:00", "modalidad": "Llamada"})
    client.post(f"/candidatos/{PF}/entrevista-humana/resultado", json={"resultado": "aprobado", "recomendacion": "avanzar"})
    f = client.get(f"/candidatos/{PF}").json()
    check(f["etapa"] == "Entrevista Humana" and f["avance"]["franquiciaEstadoTexto"] == "Pendiente de presentar", "entrevista inicial de Reclutamiento → «Pendiente de presentar» (Filtro humano)")
    r = client.post(f"/candidatos/{PF}/presentar-franquiciatario", json={"nombre": "Franquiciatario Prueba", "correo": "fp@demo.invalid", "enviar_liga": False})
    check(r.status_code == 201 and r.json()["candidato"]["avance"]["franquiciaEstadoTexto"] == "Presentado", "presentación → «Presentado»")
    db.expire_all()
    evf = next(e for e in db.query(EvaluacionCandidato).filter(EvaluacionCandidato.postulacion_id == pf.id).all() if e.nombre == fraiche.NOMBRE_EVALUACION_FRANQUICIATARIO)
    evf.cita_en = datetime.now(timezone.utc) - timedelta(hours=2)
    db.commit()
    f = client.get(f"/candidatos/{PF}").json()
    check(f["avance"]["franquiciaEstadoTexto"] == "Pendiente de decisión", "después de la entrevista con el franquiciatario → «Pendiente de decisión»")
    r = client.patch(f"/candidatos/{PF}/etapa", json={"etapa": "Contratación"})
    check(r.status_code == 409 and "franquiciatario" in r.json()["detail"], "sin decisión del franquiciatario no pasa a Contratación (y lo dice)")
    r = client.post(f"/evaluaciones/{evf.codigo}/resultado", data={"decision": "continuar"})
    f = client.get(f"/candidatos/{PF}").json()
    check(r.status_code == 200 and f["avance"]["franquiciaEstadoTexto"] == "Aceptado" and f["activa"] and f["etapa"] == "Entrevista Humana", "decisión «Continuar» → «Aceptado», sin cerrar ni mover")
    r = client.patch(f"/candidatos/{PF}/etapa", json={"etapa": "Contratación"})
    check(r.status_code == 200 and r.json()["etapa"] == "Contratación" and not r.json().get("expedienteId"), "pasa a Contratación SIN expediente ni kit de Fraiche")
    check(r.json()["avance"]["siguienteAccion"]["tipo"] == "confirmar_contratacion_franquicia", "siguiente acción: registrar la confirmación de contratación del franquiciatario")
    check(client.patch(f"/candidatos/{PF}/etapa", json={"etapa": "Onboarding"}).status_code == 409, "sin esa confirmación no pasa a Onboarding")
    check(client.post(f"/candidatos/{PF}/franquicia/contratacion", json={}).status_code == 200, "RH registra la confirmación de contratación")
    r = client.patch(f"/candidatos/{PF}/etapa", json={"etapa": "Onboarding"})
    check(r.status_code == 200 and r.json()["etapa"] == "Onboarding" and r.json()["avance"]["siguienteAccion"]["tipo"] == "confirmar_ingreso_franquicia", "Onboarding: falta registrar el ingreso confirmado")
    r = client.post(f"/candidatos/{PF}/franquicia/ingreso", json={})
    check(r.status_code == 200 and r.json()["activa"] is False and r.json()["motivoCierre"] == "ingreso_franquicia", "ingreso confirmado por el franquiciatario → cierre")
    lista = r.json()["avance"]["lista"]
    check([x["nombre"] for x in lista] == ["Prefiltro", "Entrevista Red Human", "Entrevista de Reclutamiento", "Presentación al franquiciatario",
                                          "Entrevista y decisión del franquiciatario", "Confirmación de contratación", "Confirmación de ingreso"],
          "ficha · franquicia: exactamente las 7 actividades del spec, sin IPV/psicometría/médico/socioeconómico/kit/SAP")
    check(all(x["estadoTexto"] in ("Completado", "En curso", "Pendiente") for x in lista) and lista[-1]["estadoTexto"] == "Completado", "cada actividad: Completado / En curso / Pendiente según registros")

    print("\n--- Ficha y resumen (2026-10-01) ---")
    ft = client.get(f"/candidatos/{PT}").json()
    check([x["nombre"] for x in ft["ruta"]] == ["Prefiltro", "Filtro Red Human", "Filtro humano", "Contratación", "Onboarding"] and ft["pasoNombre"] in ("Onboarding",),
          "etapas de la ficha = pipeline estándar (sin «Nuevo», «Prefiltro web», «Filtro Telegram» ni «Presentación»)")
    check("validaciones" not in json.dumps(ft["avance"]["integral"], ensure_ascii=False), "sin el contador «N de M validaciones»")
    pre = ft["prefiltroResumen"]
    check(pre and pre["total"] == len(pre["detalle"]) and not any("BBVA" in d["criterio"] for d in pre["detalle"]) and pre["cumple"] + len(pre["incumplidos"]) + len(pre["porValidar"]) == pre["total"],
          f"«Cumple N de M»: el adeudo BBVA no cuenta y cada criterio tiene su estado ({pre['cumple']} de {pre['total']})")
    rf = ft["resumenFicha"]
    check(len(rf["fortalezas"]) <= 3 and len(rf["porValidar"]) <= 3 and all(len(x.rstrip("…").split()) <= 12 for x in rf["fortalezas"] + rf["porValidar"] + [rf["recomendacionBreve"]]),
          "resumen: máximo 3 por lista y 12 palabras por frase")
    from app.services import ia as _ia
    check(_ia.es_no_evaluado("No se cubrió en la entrevista: disponibilidad") and not _ia.es_no_evaluado("Poca experiencia en caja"), "un tema no preguntado es «No evaluado», no un incumplimiento")
    r = client.patch(f"/candidatos/{PT}/domicilio", json={"domicilio": "Calle Ficticia 12, Coyoacán, CDMX"})
    db.expire_all()
    pt = db.query(Postulacion).filter(Postulacion.codigo == PT).first()
    alta = client.get(f"/contratacion/expedientes/{pt.expediente.id}/datos-alta").json()
    dom_alta = next(x for b in alta["bloques"] for x in b["campos"] if x["clave"] == "domicilio")
    check(r.json()["domicilio"] == "Calle Ficticia 12, Coyoacán, CDMX" and dom_alta["valor"] == "Calle Ficticia 12, Coyoacán, CDMX", "domicilio vigente único entre ficha y formulario de alta")
    client.patch(f"/contratacion/expedientes/{pt.expediente.id}/datos-alta", json={"personales": {"domicilio": "Av. Demo 45, Tlalpan, CDMX"}, "campos": {}})
    f2 = client.get(f"/candidatos/{PT}").json()
    check(f2["domicilio"] == "Av. Demo 45, Tlalpan, CDMX" and len(f2["historialDomicilio"]) == 2 and f2["historialDomicilio"][-1]["anterior"] == "Calle Ficticia 12, Coyoacán, CDMX",
          "el cambio desde el formulario de alta se ve en la ficha y queda en el historial")
    t = client.get("/metricas/reclutamiento", params={"destino": "franquicia"}).json() if recl.rol in ("Administrador", "Coordinación") else None

    print("\n--- Corregir el Tipo de tienda conserva resultados y ajusta pendientes ---")
    r = client.post("/candidatos/postular", data={"vacante": vt.slug, "nombre": "Victor Cambio", "telefono": "5591110004", "consentimiento": "true", "respuestas": json.dumps(respuestas_web(vt))})
    PC = r.json()["postulacion"]
    db.expire_all()
    pc = db.query(Postulacion).filter(Postulacion.codigo == PC).first()
    pend = EvaluacionCandidato(codigo="TMP", cuenta_id=cuenta.id, postulacion_id=pc.id, tipo="medico", nombre="Estudio médico", modo="manual", estado="pendiente", historial=[])
    db.add(pend)
    db.flush()
    pend.codigo = f"EVA-{9500 + pend.id}"
    hecha = eval_revisada(db, cuenta, pc, "referencias", "Referencias laborales")
    db.commit()
    r = client.patch(f"/vacantes/{vt.codigo}", json={"destino": "franquicia"})
    check(r.status_code == 200, "la vacante pasa a Franquicia")
    db.expire_all()
    check(db.get(EvaluacionCandidato, pend.id).estado == "fallida" and "No aplica" in db.get(EvaluacionCandidato, pend.id).motivo_fallida, "el médico PENDIENTE se cancela con motivo")
    check(db.get(EvaluacionCandidato, hecha.id).estado == "revisada", "el resultado ya recibido se conserva")
    check(any(h.get("evento") == "ruta_cambiada" for h in db.query(Postulacion).filter(Postulacion.codigo == PC).first().historial), "queda en el historial")
    client.patch(f"/vacantes/{vt.codigo}", json={"destino": "tienda_propia"})

    print("\n--- Contadores en cinco columnas ---")
    vac = client.get(f"/vacantes/{vf.codigo}").json()
    check("Evaluación" not in (vac.get("embudo") or {}).get("etapas", {}), "los contadores de la vacante ya no tienen columna «Evaluación»")

print(f"\n🎉 Cambios integrados Fraiche verificados: {OK} comprobaciones OK.")
