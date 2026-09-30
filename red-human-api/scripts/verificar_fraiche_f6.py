"""Verificación Demo Fraiche · Fases 7 y 8 (2026-09-29): carga del ambiente demo (cuenta Fraiche, usuarios por rol,
Franquicia 001-400, plantillas, Evaluatest sin Cajero, vacantes y candidatos ficticios en cada paso), Tablero de
control de Reclutamiento calculado de esos registros (selector por destino, filtros, en riesgo con umbral, detenidos,
efectividad, ingresos vs franquicias separados, bajas/permanencia sin cifras), acceso por rol (Coordinación y
Administrador; Reclutador no) y bolsa Fraiche por zona. Base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_f6.py
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_dir = tempfile.mkdtemp(prefix="rh_fraiche6_")
DB_URL = "sqlite:///" + str(Path(_dir) / "f6.db").replace("\\", "/")
os.environ["DATABASE_URL"] = DB_URL
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "ANAM_API_KEY", "ANAM_LLM_ID", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-fraiche"
os.environ["SEMBRAR_DEMO"] = "false"

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


# 1) el cargador corre dos veces: la segunda no duplica
env = {**os.environ, "DATABASE_URL": DB_URL}
r1 = subprocess.run([sys.executable, str(RAIZ / "scripts" / "cargar_demo_fraiche.py"), "--ejecutar"], capture_output=True, text=True, env=env, cwd=str(RAIZ))
check(r1.returncode == 0 and "guardado" in r1.stdout, f"cargar_demo_fraiche --ejecutar termina bien\n{r1.stderr[-400:]}")
check("franquicia             creados  400" in r1.stdout and "plantilla              creados    3" in r1.stdout and "prueba                 creados    3" in r1.stdout, "400 franquicias, 3 plantillas y 3 baterías Evaluatest")
r2 = subprocess.run([sys.executable, str(RAIZ / "scripts" / "cargar_demo_fraiche.py"), "--ejecutar"], capture_output=True, text=True, env=env, cwd=str(RAIZ))
check(r2.returncode == 0 and "postulacion            creados    0" in r2.stdout and "franquicia             creados    0" in r2.stdout, "segunda corrida: idempotente (0 creados)")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Cliente, Cuenta, Plantilla, Postulacion, PruebaPsicometrica, Usuario, Vacante  # noqa: E402
from app.services import fraiche  # noqa: E402

with TestClient(app) as client:
    db = SessionLocal()
    cuenta = db.query(Cuenta).filter(Cuenta.slug == "fraiche").first()
    check(cuenta is not None and cuenta.nombre_comercial == "Fraiche", "una sola Cuenta Fraiche")
    coord = db.query(Usuario).filter(Usuario.correo == "coordinacion@fraiche.demo").first()
    recl = db.query(Usuario).filter(Usuario.correo == "reclutador@fraiche.demo").first()
    med = db.query(Usuario).filter(Usuario.correo == "medico.autorizado@fraiche.demo").first()
    check(coord.rol == "Coordinación" and recl.rol == "Usuario" and med.acceso_informes_medicos and coord.debe_cambiar_pass, "usuarios por rol (Coordinación, Reclutador, rol autorizado médico) con cambio de contraseña obligatorio")
    check(db.query(Cliente).filter(Cliente.cuenta_id == cuenta.id).count() == 400 and db.query(Cliente).filter(Cliente.cuenta_id == cuenta.id, Cliente.nombre == "Franquicia 400").first(), "Franquicia 001 a 400 como Clientes seleccionables")
    pls = {p.nombre: p for p in db.query(Plantilla).filter(Plantilla.cuenta_id == cuenta.id).all()}
    check(set(pls) == {"Demostrador", "Almacenista", "Cajero"} and pls["Cajero"].sueldo_desde == 14500 and pls["Almacenista"].sueldo_desde == 12800 and pls["Demostrador"].sueldo_desde == 11500, "plantillas con los sueldos del spec")
    check(all(p.horario == "8 horas de trabajo más 1 hora de comida" for p in pls.values()) and all(p.beneficios == [] for p in pls.values()), "jornada de 8 h + 1 h comida; prestaciones no inventadas")
    check(len(pls["Cajero"].preguntas_filtro) == 11 and len(pls["Demostrador"].preguntas_filtro) == 8 and len(pls["Almacenista"].preguntas_filtro) == 11, "preguntas web comunes + por plantilla")
    pruebas = {p.puestos[0]: p for p in db.query(PruebaPsicometrica).filter(PruebaPsicometrica.cuenta_id == cuenta.id).all()}
    check(set(pruebas) == {"Demostrador", "Almacenista", "Encargado"} and all(p.proveedor == "Evaluatest" for p in pruebas.values()), "baterías Evaluatest para Demostrador, Almacenista y Encargado — ninguna para Cajero")
    vacs = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id).all()
    check(len(vacs) == 7 and sum(1 for v in vacs if v.destino == "franquicia") == 3 and all(v.responsable_id == recl.id for v in vacs), "vacantes de tienda propia y franquicia con responsable")
    posts = db.query(Postulacion).filter(Postulacion.cuenta_id == cuenta.id).all()
    check(len(posts) == 40 and all(fraiche.paso_visible(p) in fraiche.PASOS for p in posts), "40 postulaciones ficticias con paso visible válido")
    check(any(p.paso == "listo_sap" and p.expediente and p.expediente.estado_sap == "listo_para_enviar_sap" for p in posts), "recorrido 1: Cajero de tienda propia hasta «Listo para enviar a SAP»")
    check(any(p.franquicia_estado == "aceptado" and p.motivo_cierre == "aceptado_franquicia" and p.expediente is None for p in posts), "recorrido 2: Demostrador de Franquicia 001 aceptado por el franquiciatario, sin alta SAP")
    reserva = [p for p in posts if any((e.evaluacion_ipv or {}).get("calculo", {}).get("conclusion") == "bajo_reserva" for e in p.entrevistas)]
    check(reserva and any(eh.es_ipv for eh in reserva[0].entrevistas_humanas), "recorrido 3: IPV Bajo reserva con nueva IPV humana programada y ambos resultados conservados")
    check(all("@demo.invalid" in p.candidato.correo for p in posts), "nombres y correos ficticios")

    # --- Tablero de reclutamiento: acceso por rol ---
    app.dependency_overrides[cuenta_actual] = lambda: cuenta
    app.dependency_overrides[usuario_actual] = lambda: recl
    app.dependency_overrides[usuario_decisor] = lambda: recl
    check(client.get("/metricas/reclutamiento").status_code == 403, "un Reclutador no ve el Tablero de control de Reclutamiento")
    app.dependency_overrides[usuario_actual] = lambda: coord
    app.dependency_overrides[usuario_decisor] = lambda: coord
    r = client.get("/metricas/reclutamiento")
    check(r.status_code == 200, "Coordinación sí lo ve")
    t = r.json()
    check(t["vacantes"]["activas"] == 6 and t["vacantes"]["total"] == 7 and t["vacantes"]["pendientes"] >= 1, f"vacantes activas/total/pendientes calculadas ({t['vacantes']['activas']}/{t['vacantes']['total']})")
    check(t["vacantes"]["enRiesgo"] >= 1 and t["filtros"]["umbralRiesgoDias"] == 7 and any(f["enRiesgo"] for f in t["vacantes"]["lista"]), "«en riesgo» con el umbral configurado")
    check(t["candidatos"]["postulados"] == 40 and t["candidatos"]["descartados"] == 4 and len(t["candidatos"]["descartadosPorMotivo"]) >= 2, "postulados y descartados con motivo")
    check(t["candidatos"]["contactados"] > 0 and t["candidatos"]["entrevistados"] > 0 and t["candidatos"]["viables"] > 0, "contactados, entrevistados y viables")
    check(t["pendientes"]["evaluaciones"] > 0 and t["pendientes"]["documentos"] >= 1, "evaluaciones y documentos pendientes")
    check(t["seguimiento"]["detenidos"] >= 1 and t["seguimiento"]["candidatos"][0]["diasSinSeguimiento"] >= t["filtros"]["detenidoDias"], "candidatos detenidos por último seguimiento")
    check(t["reclutadores"][0]["reclutador"] == recl.nombre and t["reclutadores"][0]["efectividad"] is not None, "citas, entrevistas y efectividad por reclutador")
    check(len(t["fuentes"]) >= 5 and all("efectividad" in f for f in t["fuentes"]), "efectividad por fuente")
    check(t["tiendasPropias"]["ingresos"] == 2 and t["franquicias"]["presentados"] == 4 and t["franquicias"]["aceptados"] == 1 and t["franquicias"]["noAceptados"] == 1, f"ingresos de tiendas propias ({t['tiendasPropias']['ingresos']}) y presentados/aceptados de franquicias ({t['franquicias']}) separados")
    check(t["futuros"]["bajas"] is None and t["futuros"]["permanencia"] is None and "SAP" in t["futuros"]["nota"], "bajas y permanencia sin cifras inventadas")
    r = client.get("/metricas/reclutamiento", params={"destino": "franquicia"})
    check(r.json()["vacantes"]["total"] == 3 and r.json()["tiendasPropias"]["ingresos"] == 0 and r.json()["franquicias"]["presentados"] == 4, "selector Franquicias")
    r = client.get("/metricas/reclutamiento", params={"destino": "tienda_propia", "zona": "Sur"})
    check(r.json()["vacantes"]["total"] == 1 and r.json()["vacantes"]["lista"][0]["titulo"] == "Cajero", "filtros por destino y zona")
    r = client.get("/metricas/reclutamiento", params={"fuente": "referido"})
    check(r.json()["candidatos"]["postulados"] >= 1 and all(f["fuente"] == "Referido" for f in r.json()["fuentes"]), "filtro por fuente")
    app.dependency_overrides[usuario_actual] = lambda: db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    check(client.get("/metricas/reclutamiento").status_code == 200, "Administrador también lo ve")

    # --- bolsa Fraiche ---
    r = client.get("/vacantes/publicas", params={"cuenta": "fraiche"})
    check(r.status_code == 200 and len(r.json()) == 6 and all(x["zona"] for x in r.json()), "bolsa /portal?cuenta=fraiche con las vacantes publicadas y su zona")
    check(client.get("/vacantes/publicas/zonas", params={"cuenta": "fraiche"}).json() == ["Centro", "Norte", "Poniente", "Sur"], "zonas del filtro de la bolsa")
    check(len(client.get("/vacantes/publicas", params={"cuenta": "fraiche", "zona": "Norte"}).json()) == 2, "filtro por zona")

print(f"\n🎉 Fraiche Fases 7-8 verificadas: {OK} comprobaciones OK.")
