"""Regresión de Clima v2 (2026-09-27). Base desechable y SIN clave de OpenAI (modo demo, nada sale a la IA).

    .venv/Scripts/python.exe scripts/verificar_clima_v2.py

Cubre: generación de encuesta con Red Human (propuesta, no guarda nada).
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

_dir = tempfile.mkdtemp(prefix="rh_clima2_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "clima2.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "ANAM_API_KEY", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-clima2"
os.environ["SEMBRAR_DEMO"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ESCALA_CLIMA, Colaborador, Cuenta, MedicionClima, Usuario, UsuarioCuenta  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Clima v2", nombre_comercial="Empresa Clima", estado="Activa")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    for i, (area, sede) in enumerate([("Ventas", "CDMX"), ("Ventas", "Puebla"), ("Operaciones", "CDMX"), ("Operaciones", "Puebla")], start=1):
        db.add(Colaborador(codigo=f"COL-{i}", cuenta_id=cuenta.id, nombre=f"Persona {i}", area=area, ubicacion=sede))
    db.commit()
    for dep in (usuario_actual, usuario_decisor):
        app.dependency_overrides[dep] = lambda: admin
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- Fase 2a · Crear encuesta con Red Human ---")
    check(client.post("/clima/generar", json={"prompt": "  "}).status_code == 400, "sin prompt → 400")
    r = client.post("/clima/generar", json={"prompt": "¿Cómo se siente mi equipo con su jefe y la carga de trabajo?"})
    check(r.status_code == 200, f"genera una propuesta ({r.status_code})")
    g = r.json()
    check(g["ia"] is False and g["titulo"] and g["dimensiones"] and len(g["preguntas"]) >= 8, "sin clave: propuesta demo con nombre, dimensiones y preguntas")
    check([p["orden"] for p in g["preguntas"]] == list(range(1, len(g["preguntas"]) + 1)), "preguntas con orden 1..n")
    check(all(p["dimension"] in g["dimensiones"] for p in g["preguntas"]), "cada pregunta pertenece a una dimensión de la lista")
    check({p["tipo"] for p in g["preguntas"]} == {"escala", "opcion", "abierta"}, "trae escala 1-5, opción múltiple y abierta")
    check(all(p.get("escala_max") == ESCALA_CLIMA for p in g["preguntas"] if p["tipo"] == "escala"), "la escala es 1-5")
    check(db.query(MedicionClima).count() == 0, "generar NO guarda nada: RH revisa primero")
    r = client.post("/clima/mediciones", json={"titulo": g["titulo"], "dimensiones": g["dimensiones"], "preguntas": g["preguntas"]})
    check(r.status_code == 201 and r.json()["estado"] == "borrador" and r.json()["dimensiones"] == g["dimensiones"],
          "la propuesta se guarda tal cual como borrador")

print(f"\n🎉 Clima v2 verificado: {OK} comprobaciones OK.")
