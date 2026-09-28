"""Regresión de Desempeño v2 (2026-09-27). Base desechable y SIN clave de OpenAI (modo demo).

    .venv/Scripts/python.exe scripts/verificar_desempeno_v2.py

Fase 1: estados (evaluación y persona), avance = completadas ÷ incluidas, cálculos solo con resultados
válidos (vacío ≠ cero), «No aplica» con motivo fuera del promedio, tope 100 % y escala 1-5 lineal.
"""

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

_dir = tempfile.mkdtemp(prefix="rh_des2_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "des2.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "ANAM_API_KEY", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-des2"
os.environ["SEMBRAR_DEMO"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CicloDesempeno, Colaborador, Cuenta, EvaluacionDesempeno, Usuario, UsuarioCuenta  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


CRITERIOS = [
    {"tipo": "medible", "nombre": "Proyectos entregados a tiempo", "unidad": "%", "meta": 100, "sentido": "mayor_es_mejor"},
    {"tipo": "medible", "nombre": "Incidencias críticas", "unidad": "incidencias", "meta": 5, "sentido": "menor_es_mejor"},
    {"tipo": "descriptivo", "nombre": "Comunicación con el cliente", "esperado": "Informa avances y riesgos a tiempo"},
    {"tipo": "medible", "nombre": "Satisfacción del cliente", "unidad": "puntos", "meta": None},
]

with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Desempeño v2", nombre_comercial="Empresa D2", estado="Activa")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    for i, nombre in enumerate(["Sandra López", "Mario Ruiz"], start=1):
        db.add(Colaborador(codigo=f"COL-{i}", cuenta_id=cuenta.id, nombre=nombre, puesto="Gerente de proyectos", area="PMO"))
    db.commit()
    for dep in (usuario_actual, usuario_decisor):
        app.dependency_overrides[dep] = lambda: admin
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- Fase 1 · Estados, avance y cálculos base ---")
    r = client.post("/desempeno/ciclos", json={"nombre": "Gerentes 2026-S2", "periodo": "2026-S2", "equipo": "Gerentes de proyectos", "criterios": CRITERIOS})
    check(r.status_code == 201 and r.json()["estado"] == "borrador", f"la evaluación nace en Borrador ({r.status_code})")
    CIC = r.json()["id"]
    crit = {c["nombre"]: c for c in r.json()["criterios"]}
    check(crit["Satisfacción del cliente"]["meta"] is None, "una meta no capturada queda vacía (nunca se inventa ni se vuelve 0)")
    check(client.post(f"/desempeno/ciclos/{CIC}/iniciar").status_code == 400, "no se inicia sin personas incluidas")
    r = client.post(f"/desempeno/ciclos/{CIC}/participantes", json={"colaborador_ids": ["COL-1", "COL-2"]})
    check(r.json()["ciclo"]["estado"] == "borrador", "agregar personas NO inicia la evaluación")
    EV1, EV2 = [e["id"] for e in r.json()["evaluaciones"]]
    check(client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": []}).status_code == 409, "en Borrador no se evalúa")
    client.patch(f"/desempeno/ciclos/{CIC}", json={"pesos_personalizados": True, "criterios": [{**c, "peso": 30} for c in CRITERIOS]})
    check("suman 120" in client.post(f"/desempeno/ciclos/{CIC}/iniciar").json()["detail"], "pesos personalizados que no suman 100 % impiden iniciar")
    client.patch(f"/desempeno/ciclos/{CIC}", json={"pesos_personalizados": False})
    r = client.post(f"/desempeno/ciclos/{CIC}/iniciar")
    check(r.status_code == 200 and r.json()["estado"] == "en_curso", "Borrador → En curso")
    check(client.patch(f"/desempeno/ciclos/{CIC}", json={"nombre": "Otro"}).status_code == 409, "en curso la configuración ya no se edita por aquí")

    ids = {c["nombre"]: c["id"] for c in client.get(f"/desempeno/ciclos/{CIC}").json()["criterios"]}
    vacios = [{"criterio_id": i, "real": "", "valoracion": None} for i in ids.values()]
    r = client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": vacios})
    check(r.json()["estado"] == "pendiente" and r.json()["calificacion"] is None, "guardar resultados VACÍOS deja a la persona «Pendiente» y sin calificación («—»)")
    r = client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": vacios, "completar": True})
    check(r.status_code == 400 and "falta" in r.json()["detail"], "con resultados vacíos NO se puede completar (error actual corregido)")
    c = client.get(f"/desempeno/ciclos/{CIC}").json()
    check(c["avance"] == 0 and c["completadas"] == 0, "resultados vacíos jamás generan avance")

    parcial = [{"criterio_id": ids["Proyectos entregados a tiempo"], "real": 80}]
    r = client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": parcial})
    check(r.json()["estado"] == "en_proceso" and r.json()["calificacion"] == 80.0,
          "captura parcial = «En proceso» y la calificación usa SOLO lo válido (80, no 20 por los vacíos)")
    todo = [
        {"criterio_id": ids["Proyectos entregados a tiempo"], "real": 130},   # tope 100 %
        {"criterio_id": ids["Incidencias críticas"], "real": 10},            # menor es mejor: 5/10 = 50 %
        {"criterio_id": ids["Comunicación con el cliente"], "valoracion": 4},  # 1-5 lineal: 75 %
        {"criterio_id": ids["Satisfacción del cliente"], "no_aplica": True},  # sin motivo
    ]
    r = client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": todo, "completar": True})
    check(r.status_code == 400 and "No aplica" in r.json()["detail"], "«No aplica» sin motivo no deja completar")
    todo[3]["motivo_no_aplica"] = "El proyecto aún no tiene encuesta de satisfacción."
    r = client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": todo, "completar": True})
    cumpl = {d["criterio_id"]: d for d in r.json()["cumplimiento"]}
    check(r.status_code == 200 and r.json()["estado"] == "completada", "con todo lo aplicable capturado se completa")
    check(cumpl[ids["Proyectos entregados a tiempo"]]["cumplimiento"] == 100.0, "medible «mayor es mejor» con tope 100 % (130/100 → 100 %)")
    check(cumpl[ids["Incidencias críticas"]]["cumplimiento"] == 50.0, "medible «menor es mejor» = meta ÷ real (5/10 → 50 %)")
    check(cumpl[ids["Comunicación con el cliente"]]["cumplimiento"] == 75.0, "descriptivo 1-5 lineal (4 → 75 %)")
    check(cumpl[ids["Satisfacción del cliente"]]["no_aplica"] and cumpl[ids["Satisfacción del cliente"]]["cumplimiento"] is None, "«No aplica» queda fuera")
    check(r.json()["calificacion"] == 75.0, f"calificación = promedio de los válidos (100+50+75)/3 = 75 → {r.json()['calificacion']}")
    check(client.patch(f"/desempeno/evaluaciones/{EV1}", json={"resultados": []}).status_code == 409, "una persona completada ya no se edita")
    c = client.get(f"/desempeno/ciclos/{CIC}").json()
    check(c["avance"] == 50 and c["completadas"] == 1 and c["participantes"] == 2, "avance = completadas ÷ incluidas (1 de 2 = 50 %)")
    res = client.get(f"/desempeno/ciclos/{CIC}/resultados").json()
    check(res["promedio"] == 75.0 and len(res["pendientes"]) == 1, "el promedio usa solo personas completadas con calificación válida")

    check(client.post(f"/desempeno/ciclos/{CIC}/cerrar", json={}).status_code == 409, "cerrar con personas sin completar pide confirmación")
    r = client.post(f"/desempeno/ciclos/{CIC}/cerrar", json={"aun_con_pendientes": True})
    check(r.status_code == 200 and r.json()["estado"] == "cerrada", "En curso → Cerrada (con confirmación)")
    check(client.patch(f"/desempeno/evaluaciones/{EV2}", json={"resultados": parcial}).status_code == 409, "cerrada: los resultados quedan congelados")
    check(client.post(f"/desempeno/ciclos/{CIC}/iniciar").status_code == 409, "flujo de ida: una cerrada no vuelve a iniciar")

    # Compatibilidad con datos previos a v2 (objetivos/kpis con logro y pesos capturados)
    viejo = CicloDesempeno(codigo="DES-9999", cuenta_id=cuenta.id, nombre="Previo", objetivos=[{"titulo": "Cumplir responsabilidades", "peso": 60}],
                           kpis=[{"nombre": "Calidad", "meta": "95%", "peso": 40}], estado="cerrado")
    db.add(viejo)
    db.flush()
    ev_viejo = EvaluacionDesempeno(codigo="EVD-9999", cuenta_id=cuenta.id, ciclo_id=viejo.id, colaborador_id=1, estado="en_curso",
                                   resultados=[{"tipo": "objetivo", "nombre": "Cumplir responsabilidades", "logro": 90},
                                               {"tipo": "kpi", "nombre": "Calidad", "logro": 70}])
    db.add(ev_viejo)
    db.commit()
    v = client.get("/desempeno/evaluaciones/EVD-9999").json()
    check(client.get("/desempeno/ciclos/DES-9999").json()["estado"] == "cerrada" and v["estado"] == "en_proceso",
          "estados previos («cerrado», «en_curso») se leen como Cerrada / En proceso")
    from app.services import desempeno_calculo as calc  # noqa: E402
    db.expire_all()
    check(calc.calcular(db.query(EvaluacionDesempeno).filter_by(codigo="EVD-9999").one())["calificacion"] == 82.0,
          "datos previos: logros y pesos capturados se respetan ((90×60 + 70×40)/100 = 82)")

print(f"\n🎉 Desempeño v2 verificado: {OK} comprobaciones OK.")
