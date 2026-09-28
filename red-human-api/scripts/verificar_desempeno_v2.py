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
    db.add(Colaborador(codigo="COL-3", cuenta_id=cuenta.id, nombre="Ana Datos", puesto="Analista de datos", area="BI"))
    evaluadora = Usuario(correo="jefa.pmo@empresa.mx", nombre="Jefa PMO", rol="Usuario", hash_pass="x", activo=True)
    ajeno = Usuario(correo="otro@otra.mx", nombre="Usuario de otra Cuenta", rol="Usuario", hash_pass="x", activo=True)
    db.add_all([evaluadora, ajeno])
    db.flush()
    db.add(UsuarioCuenta(usuario_id=evaluadora.id, cuenta_id=cuenta.id))
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

    print("\n--- Fase 2 · Orden de creación, tipos de criterio, pesos, evaluadores y ajustes ---")
    check(client.post("/desempeno/criterios/generar", json={"puesto": " "}).status_code == 400, "la IA no propone sin puesto/equipo")
    r = client.post("/desempeno/criterios/generar", json={"puesto": "Gerentes de proyectos", "periodo": "2027-S1"})
    prop = r.json()["criterios"]
    check(r.status_code == 200 and {c["tipo"] for c in prop} == {"medible", "descriptivo"}, "propone criterios medibles y descriptivos para el puesto")
    check(all(c["meta"] is None for c in prop if c["tipo"] == "medible"), "la IA NO inventa metas numéricas (medibles sin meta)")
    med = next(c for c in prop if c["tipo"] == "medible")
    desc = next(c for c in prop if c["tipo"] == "descriptivo")
    check({"unidad", "meta", "sentido", "formula"} <= set(med) and "escala" not in med, "medible: unidad, meta, sentido y fórmula (sin escala)")
    check({"esperado", "escala"} <= set(desc) and "meta" not in desc and len(desc["escala"]) == 5, "descriptivo: qué se espera y escala 1-5 con significado (sin meta ni real)")
    r = client.post("/desempeno/ciclos", json={"nombre": "Gerentes 2027-S1", "periodo": "2027-S1", "equipo": "Gerentes de proyectos",
                                               "criterios": prop, "origen_criterios": "ia"})
    CIC2 = r.json()["id"]
    check(r.json()["origenCriterios"] == "ia" and not r.json()["pesosPersonalizados"], "por defecto todos los pesos son iguales")
    rev = client.post(f"/desempeno/ciclos/{CIC2}/participantes/revisar", json={"colaborador_ids": ["COL-1", "COL-3"]}).json()
    check([o["id"] for o in rev["otrosPuestos"]] == ["COL-3"] and "criterios distintos" in rev["advertencia"],
          "advierte que alguien de otro puesto podría necesitar criterios distintos (sin marcar a Sandra)")
    check(client.post(f"/desempeno/ciclos/{CIC2}/participantes", json={"colaborador_ids": ["COL-1"], "evaluador_usuario_id": ajeno.id}).status_code == 400,
          "el evaluador debe ser un usuario de ESTA Cuenta")
    r = client.post(f"/desempeno/ciclos/{CIC2}/participantes", json={"colaborador_ids": ["COL-1", "COL-3"], "evaluadores": {"COL-1": evaluadora.id}})
    evs = {e["colaboradorId"]: e for e in r.json()["evaluaciones"]}
    check(evs["COL-1"]["evaluador"] == "Jefa PMO" and evs["COL-1"]["evaluadorUsuarioId"] == evaluadora.id, "evaluador por persona (usuario del sistema)")
    check(len(evs) == 2, "aplicar los mismos criterios a otro puesto es decisión de RH: no se bloquea")
    EVS = evs["COL-1"]["id"]
    crit2 = client.get(f"/desempeno/ciclos/{CIC2}").json()["criterios"]
    pers = [{**c, "peso": 100 / len(crit2)} for c in crit2]
    pers[0]["peso"] += 5
    client.patch(f"/desempeno/ciclos/{CIC2}", json={"pesos_personalizados": True, "criterios": pers})
    check("deben sumar 100" in client.post(f"/desempeno/ciclos/{CIC2}/iniciar").json()["detail"], "«Personalizar pesos» exige sumar 100 % antes de iniciar")
    pers[0]["peso"] -= 5
    client.patch(f"/desempeno/ciclos/{CIC2}", json={"criterios": pers})
    check(client.post(f"/desempeno/ciclos/{CIC2}/iniciar").status_code == 200, "con 100 % exacto se inicia")
    check(client.patch(f"/desempeno/evaluaciones/{EVS}/ajustes", json={"criterio_id": med["id"], "meta": 12}).status_code == 400, "un ajuste individual exige motivo")
    r = client.patch(f"/desempeno/evaluaciones/{EVS}/ajustes", json={"criterio_id": med["id"], "meta": 12, "motivo": "Sandra lleva la cartera más grande"})
    ajustado = next(c for c in r.json()["criterios"] if c["id"] == med["id"])
    check(ajustado["meta"] == 12 and ajustado["ajustado"] and ajustado["motivo_ajuste"], "el ajuste individual queda marcado como tal, con su motivo")
    general = next(c for c in client.get(f"/desempeno/ciclos/{CIC2}").json()["criterios"] if c["id"] == med["id"])
    check(general["meta"] is None, "el ajuste individual NO cambia el criterio general de la evaluación")

    print("\n--- Fase 3 · Plantillas, duplicar e importar criterios ---")
    antes_plantillas = len(client.get("/desempeno/plantillas").json())
    r = client.post(f"/desempeno/ciclos/{CIC2}/plantilla", json={"nombre": "Gerentes de proyectos base"})
    PL = r.json()["id"]
    lista = {c["id"]: c for c in r.json()["listaCriterios"]}
    check(r.status_code == 201 and lista[med["id"]]["meta"] is None and r.json()["pesosPersonalizados"],
          "«Guardar como plantilla» toma criterios, definiciones, forma de evaluar y pesos generales (sin el ajuste de Sandra)")
    crit_cic2_antes = client.get(f"/desempeno/ciclos/{CIC2}").json()["criterios"]
    crit_cic_antes = client.get(f"/desempeno/ciclos/{CIC}").json()["criterios"]
    r = client.post("/desempeno/ciclos", json={"nombre": "Desde plantilla", "periodo": "2027-S2", "equipo": "Gerentes de proyectos",
                                               "criterios": r.json()["listaCriterios"], "pesos_personalizados": True, "origen_criterios": "plantilla", "plantilla_id": PL})
    DESDE = r.json()["id"]
    check(r.json()["origenCriterios"] == "plantilla", "una evaluación nace de la plantilla (copia de sus criterios)")
    editados = [{**c, "nombre": c["nombre"] + " (v2)"} for c in client.get(f"/desempeno/plantillas/{PL}").json()["listaCriterios"]]
    client.patch(f"/desempeno/plantillas/{PL}", json={"criterios": editados})
    check(client.get(f"/desempeno/plantillas/{PL}").json()["listaCriterios"][0]["nombre"].endswith("(v2)"), "la plantilla se edita")
    check(client.get(f"/desempeno/ciclos/{CIC2}").json()["criterios"] == crit_cic2_antes
          and client.get(f"/desempeno/ciclos/{CIC}").json()["criterios"] == crit_cic_antes
          and not client.get(f"/desempeno/ciclos/{DESDE}").json()["criterios"][0]["nombre"].endswith("(v2)"),
          "editar la plantilla NO modifica evaluaciones iniciadas, cerradas ni creadas con ella (cada una conserva su versión)")

    client.patch(f"/desempeno/evaluaciones/{EVS}", json={"resultados": [{"criterio_id": med["id"], "real": 10, "comentario": "va bien"}],
                                                         "brechas": [{"tema": "Planeación"}], "comentarios": "Notas"})
    r = client.post(f"/desempeno/ciclos/{CIC2}/duplicar", json={"nombre": "Gerentes 2027-S2", "periodo": "2027-S2"})
    dup = r.json()
    check(r.status_code == 201 and dup["estado"] == "borrador" and dup["duplicadoDe"] == CIC2 and dup["periodo"] == "2027-S2",
          "«Duplicar evaluación» crea un borrador para otro periodo")
    check(dup["criterios"] == crit_cic2_antes and dup["pesosPersonalizados"], "copia la configuración (criterios y pesos)")
    check(dup["participantes"] == 0 and dup["evaluaciones"] == [], "NO copia personas evaluadas, resultados, comentarios, brechas ni ajustes")

    csv = ("tipo,nombre,descripcion,unidad,meta,sentido,esperado,peso,nivel_1,nivel_2,nivel_3,nivel_4,nivel_5,columna_rara\n"
           "medible,Proyectos a tiempo,,%,95,mayor,,,,,,,,x\n"
           "descriptivo,Liderazgo,,,,,Guía al equipo,,Nada,Poco,Suficiente,Mucho,Referente,\n"
           "raro,Sin tipo valido,,,,,,,,,,,,\n"
           "medible,Meta mala,,,abc,menor,,,,,,,,\n")
    ciclos_antes = len(client.get("/desempeno/ciclos").json())
    r = client.post("/desempeno/criterios/importar", files={"archivo": ("criterios.csv", csv.encode("utf-8"), "text/csv")})
    prev = r.json()
    check(r.status_code == 200 and len(prev["validos"]) == 2 and prev["conErrores"] == 2, "vista previa: 2 criterios válidos y 2 filas con error")
    check(any("no reconocido" in e for f in prev["filas"] for e in f["errores"]) and any("no es un número" in e for f in prev["filas"] for e in f["errores"]),
          "cada fila con error dice por qué")
    check(prev["columnasDesconocidas"] == ["columna_rara"] and "tipo" in prev["columnasDetectadas"], "muestra las columnas detectadas y las que no reconoce")
    desc_imp = next(c for c in prev["validos"] if c["tipo"] == "descriptivo")
    check([n["significado"] for n in desc_imp["escala"]] == ["Nada", "Poco", "Suficiente", "Mucho", "Referente"], "la escala con significado viene del archivo")
    check(len(client.get("/desempeno/ciclos").json()) == ciclos_antes and len(client.get("/desempeno/plantillas").json()) == antes_plantillas + 1,
          "la importación NO guarda nada hasta confirmar")
    r = client.post("/desempeno/plantillas", json={"nombre": "Importada", "criterios": prev["validos"]})
    check(r.status_code == 201 and r.json()["criterios"] == 2, "al confirmar, los criterios válidos se guardan (aquí como plantilla)")
    client.delete(f"/desempeno/plantillas/{PL}")
    check(all(p["id"] != PL for p in client.get("/desempeno/plantillas").json()), "eliminar plantilla = desactivar (ya no se ofrece)")

    print("\n--- Fase 4 · Colaboradores (alta manual e importación) y evaluadores ---")
    r = client.post("/colaboradores", json={"nombre": "Directora PMO", "correo": "jefa.pmo@empresa.mx", "puesto": "Directora de PMO", "area": "PMO"})
    check(r.status_code == 201 and r.json()["origenAlta"] == "manual" and r.json()["empresa"], "alta manual sin pasar por Vacantes/Contratación (toma la empresa de la Cuenta)")
    DIRECTORA = r.json()["id"]
    r = client.post("/colaboradores", json={"nombre": "Otra persona", "correo": "JEFA.PMO@empresa.mx"})
    check(r.status_code == 409 and "Posible duplicado" in r.json()["detail"], "el alta manual avisa de un posible duplicado (mismo correo)")
    check(client.post("/colaboradores", json={"nombre": "Otra persona", "correo": "jefa.pmo@empresa.mx", "confirmar_duplicado": True}).status_code == 201,
          "…y RH puede confirmar si de verdad es otra persona")
    csv = ("Nombre,Correo,Telefono,Puesto,Departamento,Sede,Jefe directo,Fecha de ingreso\n"
           "Sandra Importada,sandra.imp@empresa.mx,55 1234 5678,Gerente de proyectos,PMO,CDMX,jefa.pmo@empresa.mx,2024-03-01\n"
           "Jefe Nuevo,jefe.nuevo@empresa.mx,,Líder de célula,TI,,,\n"
           "Empleada Nueva,empleada@empresa.mx,,Desarrolladora,TI,,jefe.nuevo@empresa.mx,2025-01-15\n"
           "Ana Datos,,,Analista de datos,BI,,,\n"
           "Correo Malo,no-es-correo,,,,,,\n"
           "Sandra Repetida,sandra.imp@empresa.mx,,,,,,\n")
    total_antes = len(client.get("/colaboradores").json())
    r = client.post("/colaboradores/importar/vista-previa", files={"archivo": ("empleados.csv", csv.encode("utf-8"), "text/csv")})
    vp = r.json()
    filas = {f["datos"]["nombre"]: f for f in vp["filas"]}
    check(r.status_code == 200 and vp["conErrores"] == 1 and "Correo inválido" in filas["Correo Malo"]["errores"][0], "la vista previa marca errores por fila")
    check(filas["Ana Datos"]["duplicados"] and filas["Sandra Repetida"]["duplicados"][0]["motivos"] == ["repetido en el archivo"],
          "muestra posibles duplicados contra el roster y dentro del archivo")
    check(filas["Sandra Importada"]["datos"]["area"] == "PMO" and filas["Sandra Importada"]["datos"]["jefe"] == "jefa.pmo@empresa.mx",
          "encabezados homologados (Departamento → área, Jefe directo → jefe)")
    check(len(client.get("/colaboradores").json()) == total_antes, "la vista previa NO guarda nada")
    aceptadas = [f["datos"] for f in vp["filas"] if not f["errores"]]
    r = client.post("/colaboradores/importar/confirmar", json={"filas": aceptadas})
    creados = {c["nombre"]: c for c in r.json()["creados"]}
    check(set(creados) == {"Sandra Importada", "Jefe Nuevo", "Empleada Nueva"} and len(r.json()["omitidos"]) == 2,
          "al confirmar se dan de alta las filas válidas y se omiten los posibles duplicados")
    check(creados["Empleada Nueva"]["jefeId"] == creados["Jefe Nuevo"]["id"], "el jefe puede venir en el mismo archivo (se enlaza al final)")
    check(creados["Sandra Importada"]["jefeId"] == DIRECTORA and creados["Sandra Importada"]["jefeDirecto"] == "Directora PMO", "jefe resuelto por correo contra el roster")
    SANDRA = creados["Sandra Importada"]["id"]
    r = client.patch(f"/colaboradores/{creados['Jefe Nuevo']['id']}", json={"jefe": "Directora PMO"})
    check(r.status_code == 200 and client.get(f"/colaboradores/{creados['Jefe Nuevo']['id']}").json()["jefeId"] == DIRECTORA, "el jefe se edita en la ficha del roster")

    prop = client.get(f"/desempeno/evaluadores/propuesta?ids={SANDRA},COL-2,{creados['Empleada Nueva']['id']}").json()
    check(prop[SANDRA]["usuario"]["id"] == evaluadora.id, "si el jefe tiene usuario (mismo correo), se propone como evaluador")
    check(prop["COL-2"]["usuario"] is None and "Sin jefe" in prop["COL-2"]["motivo"], "sin jefe registrado: se pide elegir evaluador (no bloquea)")
    check(prop[creados["Empleada Nueva"]["id"]]["usuario"] is None and "no tiene usuario" in prop[creados["Empleada Nueva"]["id"]]["motivo"],
          "jefe sin usuario en el sistema: se explica y se elige a mano")
    r = client.post("/desempeno/ciclos", json={"nombre": "Gerentes 2028", "equipo": "Gerentes de proyectos", "criterios": CRITERIOS})
    CIC3 = r.json()["id"]
    evs3 = {e["colaboradorId"]: e for e in client.post(f"/desempeno/ciclos/{CIC3}/participantes", json={"colaborador_ids": [SANDRA, "COL-2"]}).json()["evaluaciones"]}
    check(evs3[SANDRA]["evaluadorUsuarioId"] == evaluadora.id and evs3[SANDRA]["evaluador"] == "Jefa PMO", "sin elegir evaluador, a Sandra la evalúa su jefa (propuesta)")
    check(evs3["COL-2"]["evaluadorUsuarioId"] is None and evs3["COL-2"]["evaluador"] == admin.nombre, "sin jefe no se bloquea: evalúa quien la agregó hasta que RH elija")
    check(evs3[SANDRA]["area"] == "PMO" and evs3[SANDRA]["jefe"] == "Directora PMO" and evs3[SANDRA]["empresa"],
          "Desempeño toma empresa, área, puesto y jefe de la base de Colaboradores")

print(f"\n🎉 Desempeño v2 verificado: {OK} comprobaciones OK.")
