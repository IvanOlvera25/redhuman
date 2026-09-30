"""Verificación Demo Fraiche · Fase 1 (2026-09-29): destino/sucursal/zona/horario/posiciones/fecha objetivo en
la vacante, validación al publicar, textos por portal (Indeed/Computrabajo/Talenteca) con fuente en la liga,
liga y QR de referidos, imagen de la publicación, bolsa con filtro por zona, horario en plantillas y fuente +
referido en la postulación. Modo demo, base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_f1.py
"""

import io
import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_dir = tempfile.mkdtemp(prefix="rh_fraiche1_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "f1.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "ANAM_API_KEY", "ANAM_LLM_ID", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-fraiche"
os.environ["SEMBRAR_DEMO"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CAMPOS_PLANTILLA, Candidato, Cliente, Cuenta, Postulacion, Usuario, UsuarioCuenta, Vacante  # noqa: E402
from app.services import fraiche  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


check("horario" in CAMPOS_PLANTILLA, "«horario» viaja con las plantillas (CAMPOS_PLANTILLA)")
check(fraiche.normalizar_fuente("Indeed") == "indeed" and fraiche.normalizar_fuente("QR") == "referido", "normalizar_fuente reconoce portal y alias")
check(len(fraiche.preguntas_web_fraiche("Cajero")) == 7 + 4 and len(fraiche.preguntas_web_fraiche("Demostrador")) == 8, "preguntas web comunes (7) + por plantilla")
check(fraiche.sustituir_placeholders("¿Cuánto tardarías en llegar a [sucursal]?", sucursal="Sucursal Centro") == "¿Cuánto tardarías en llegar a Sucursal Centro?", "placeholder [sucursal]")
check("¿El sueldo que se te informó" in fraiche.sustituir_placeholders("El sueldo es [monto mensual]. ¿Está dentro de lo que buscas?", sueldo="A convenir"), "[monto mensual] sin sueldo → redacción neutra (no inventa)")

PNG_1PX = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")

with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Fraiche prueba", nombre_comercial="Fraiche", estado="Activa", slug="fraiche-prueba")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    franq = Cliente(cuenta_id=cuenta.id, nombre="Franquicia 001", estado="Activo")
    db.add(franq)
    for v in db.query(Vacante).all():
        v.cuenta_id = cuenta.id
    for c in db.query(Candidato).all():
        c.cuenta_id = cuenta.id
        for p in c.postulaciones:
            p.cuenta_id = cuenta.id
    db.commit()
    app.dependency_overrides[usuario_actual] = lambda: admin
    app.dependency_overrides[usuario_decisor] = lambda: admin
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- Vacante con destino, sucursal, zona, horario, posiciones y fecha objetivo ---")
    r = client.post("/vacantes", json={
        "titulo": "Cajero(a) Fraiche", "area": "Tienda", "seniority": "Junior", "descripcion": "Caja de tienda",
        "ubicacion_estado": "Ciudad de México", "ubicacion_municipio": "Coyoacán", "modalidad": "Presencial",
        "sueldo_desde": 14500, "sueldo_periodicidad": "mensual",
        "destino": "tienda_propia", "sucursal": "Fraiche Coyoacán", "zona": "Sur", "horario": "8 horas de trabajo más 1 hora de comida",
        "posiciones": 2, "fecha_objetivo": "2026-10-31",
    })
    check(r.status_code == 201, f"POST /vacantes con campos Fraiche ({r.status_code} {r.text[:120]})")
    v = r.json()
    VAC = v["id"]
    check(v["destino"] == "tienda_propia" and v["destinoNombre"] == "Tienda propia", "destino guardado y nombre visible")
    check(v["sucursal"] == "Fraiche Coyoacán" and v["zona"] == "Sur" and v["horario"].startswith("8 horas"), "sucursal, zona y horario guardados")
    check(v["posiciones"] == 2 and v["fechaObjetivo"] == "2026-10-31" and v["responsableId"] == admin.id, "posiciones, fecha objetivo y responsableId")
    check(all(k in v["publicaciones"] for k in ("indeed", "computrabajo", "talenteca", "occ", "linkedin", "portal")), "el generador produce textos para Indeed, Computrabajo y Talenteca")
    check(any("Horario" in a for a in v["avisosCumplimiento"]) is False, "con horario capturado no hay aviso de horario pendiente")

    r = client.post("/vacantes", json={"titulo": "Sin datos", "descripcion": "x", "generar_si_falta": False, "publicar": True})
    check(r.status_code == 409 and "sucursal" in r.json()["detail"] and "fecha objetivo" in r.json()["detail"], "publicar al crear sin la ficha completa → 409 con lo que falta")
    r = client.post("/vacantes", json={"titulo": "Destino malo", "destino": "otro"})
    check(r.status_code == 400, "destino inválido → 400")
    r = client.post("/vacantes", json={"titulo": "Fecha mala", "fecha_objetivo": "31/10/2026"})
    check(r.status_code == 400, "fecha objetivo no ISO → 400")

    r = client.patch(f"/vacantes/{VAC}", json={"destino": "franquicia", "zona": "Norte", "posiciones": 3, "fecha_objetivo": ""})
    check(r.status_code == 200 and r.json()["destino"] == "franquicia" and r.json()["zona"] == "Norte" and r.json()["posiciones"] == 3 and r.json()["fechaObjetivo"] is None, "PATCH destino/zona/posiciones y quitar fecha objetivo")
    r = client.post(f"/vacantes/{VAC}/publicar", json={"plataformas": ["Portal"]})
    check(r.status_code == 409 and "cliente (franquicia)" in r.json()["detail"] and "fecha objetivo" in r.json()["detail"], "publicar franquicia sin cliente ni fecha → 409")
    r = client.patch(f"/vacantes/{VAC}", json={"cliente_id": franq.id, "fecha_objetivo": "2026-11-15"})
    r = client.post(f"/vacantes/{VAC}/publicar", json={"plataformas": ["Portal"]})
    check(r.status_code == 200 and r.json()["estado"] == "Publicada", "con la ficha completa sí publica")
    SLUG = r.json()["slug"]

    print("\n--- Textos por portal, liga por fuente, QR de referidos ---")
    r = client.get(f"/vacantes/{VAC}/publicacion/indeed")
    check(r.status_code == 200 and "fuente=indeed" in r.json()["liga"] and r.json()["copyConLiga"].endswith(r.json()["liga"]), "publicación Indeed lleva la liga con fuente=indeed")
    r = client.get(f"/vacantes/{VAC}/publicacion/computrabajo")
    check(r.status_code == 200 and "fuente=computrabajo" in r.json()["liga"], "publicación Computrabajo con su fuente")
    r = client.get(f"/vacantes/{VAC}/liga", params={"ref": "Laura Pérez 1023"})
    check(r.status_code == 200 and r.json()["fuente"] == "referido" and "ref=Laura" in r.json()["liga"] and r.json()["qrPath"].startswith(f"/vacantes/{VAC}/qr"), "liga de referidos con ref y ruta del QR")
    r = client.get(f"/vacantes/{VAC}/qr", params={"ref": "Laura Pérez 1023"})
    check(r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n", "QR PNG generado")
    r = client.get(f"/vacantes/{VAC}/liga", params={"fuente": "campo"})
    check(r.json()["fuente"] == "campo" and "fuente=campo" in r.json()["liga"], "liga con fuente=campo")

    print("\n--- Imagen de la publicación ---")
    r = client.post(f"/vacantes/{VAC}/imagen", files={"archivo": ("flyer.png", io.BytesIO(PNG_1PX * 40), "image/png")})
    check(r.status_code == 200 and r.json()["imagenPath"] == f"/vacantes/{VAC}/imagen" and r.json()["imagenNombre"] == "flyer.png", f"imagen cargada ({r.status_code} {r.text[:100]})")
    r = client.get(f"/vacantes/{VAC}/imagen")
    check(r.status_code == 200 and r.content[:4] == b"\x89PNG", "imagen descargable")
    r = client.get(f"/vacantes/slug/{SLUG}/imagen")
    check(r.status_code == 200, "imagen pública por slug")
    r = client.post(f"/vacantes/{VAC}/imagen", files={"archivo": ("cv.pdf", io.BytesIO(b"%PDF-1.4" + b"0" * 2000), "application/pdf")})
    check(r.status_code == 415, "un PDF no es imagen → 415")
    r = client.delete(f"/vacantes/{VAC}/imagen")
    check(r.status_code == 200 and r.json()["imagenPath"] == "", "quitar imagen")

    print("\n--- Bolsa con filtro por zona ---")
    r = client.get("/vacantes/publicas", params={"cuenta": "fraiche-prueba", "zona": "Norte"})
    check(r.status_code == 200 and [x["id"] for x in r.json()] == [VAC], "publicas?zona=Norte regresa solo la vacante de esa zona")
    r = client.get("/vacantes/publicas", params={"cuenta": "fraiche-prueba", "zona": "Sur"})
    check(r.json() == [], "publicas?zona=Sur vacía")
    r = client.get("/vacantes/publicas/zonas", params={"cuenta": "fraiche-prueba"})
    check(r.json() == ["Norte"], "publicas/zonas lista las zonas publicadas")
    r = client.get("/vacantes", params={"destino": "franquicia"})
    check([x["id"] for x in r.json()] == [VAC], "GET /vacantes?destino=franquicia")

    print("\n--- Plantillas con horario ---")
    r = client.post("/plantillas", json={"nombre": "Cajero", "titulo": "Cajero", "horario": "8 horas de trabajo más 1 hora de comida"})
    check(r.status_code == 201 and r.json()["horario"].startswith("8 horas"), "plantilla guarda horario")
    r = client.post(f"/plantillas/desde-vacante/{VAC}", json={"nombre": "Desde Fraiche"})
    check(r.status_code == 201 and r.json()["horario"].startswith("8 horas"), "guardar como plantilla copia el horario")

    print("\n--- Postulación con fuente y referido ---")
    r = client.post("/candidatos/postular", data={
        "vacante": SLUG, "nombre": "Referida Prueba", "telefono": "5512345678", "consentimiento": "true",
        "respuestas": "[]", "fuente": "referido", "ref": "Laura Pérez 1023",
    })
    check(r.status_code == 201, f"postular con fuente/ref ({r.status_code} {r.text[:100]})")
    p = db.query(Postulacion).filter(Postulacion.codigo == r.json()["postulacion"]).first()
    check(p.fuente_postulacion == "referido" and p.referido_por == "Laura Pérez 1023", "la postulación guarda fuente=referido y referido_por")
    r = client.post("/candidatos/postular", data={"vacante": SLUG, "nombre": "Desde Indeed", "correo": "indeed@demo.invalid", "consentimiento": "true", "respuestas": "[]", "fuente": "Indeed"})
    p2 = db.query(Postulacion).filter(Postulacion.codigo == r.json()["postulacion"]).first()
    check(p2.fuente_postulacion == "indeed", "fuente «Indeed» normalizada a indeed")
    r = client.post("/candidatos/postular", data={"vacante": SLUG, "nombre": "Sin fuente", "correo": "sf@demo.invalid", "consentimiento": "true", "respuestas": "[]"})
    p3 = db.query(Postulacion).filter(Postulacion.codigo == r.json()["postulacion"]).first()
    check(p3.fuente_postulacion == "portal", "sin fuente → portal")

print(f"\n🎉 Fraiche Fase 1 verificada: {OK} comprobaciones OK.")
