"""Verificación Demo Fraiche · Fases 2 y 3 (2026-09-29): prefiltro web con preguntas comunes + por plantilla,
placeholders [sucursal]/[monto mensual], clasificación Cumple / Requiere revisión / No cumple con motivo, el CV
no pisa ese resultado; segundo filtro por WhatsApp con guion fijo (orden, sin repetir la web, BBVA informativa
que nunca descarta), etiquetas «Invitar a entrevista inicial / Revisar por reclutador / No cumple indispensable»
y aviso de la captura de BBVA en el consentimiento. Modo demo, base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_f2.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_dir = tempfile.mkdtemp(prefix="rh_fraiche2_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "f2.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "ANAM_API_KEY", "ANAM_LLM_ID", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-fraiche"
os.environ["SEMBRAR_DEMO"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Candidato, Cuenta, Postulacion, Usuario, UsuarioCuenta, Vacante  # noqa: E402
from app.routers.webhooks import _texto_aviso_privacidad  # noqa: E402
from app.services import fraiche, ia  # noqa: E402
import app.routers.candidatos as rc  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


PREGUNTAS_USADAS = []
_orig = ia.prefiltro_turno


def _espia(titulo, requisitos, preguntas, historial, **kw):
    PREGUNTAS_USADAS.append({"preguntas": preguntas, "respuestas_web": kw.get("respuestas_web"), "guion_fijo": kw.get("guion_fijo")})
    return _orig(titulo, requisitos, preguntas, historial, **kw)


ia.prefiltro_turno = _espia
rc.ia = ia

check("BBVA" in _texto_aviso_privacidad("Ana", None) and "no influye" in _texto_aviso_privacidad("Ana", None), "el aviso de privacidad por WhatsApp menciona la captura del adeudo con BBVA")

with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Fraiche prueba", nombre_comercial="Fraiche", estado="Activa", slug="fraiche-prueba2")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
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

    print("\n--- Vacante Cajero con preguntas comunes + de plantilla ---")
    r = client.post("/vacantes", json={
        "titulo": "Cajero(a)", "area": "Tienda", "seniority": "Junior", "descripcion": "Caja", "generar_si_falta": False,
        "ubicacion_estado": "Ciudad de México", "ubicacion_municipio": "Coyoacán", "sueldo_desde": 14500, "sueldo_periodicidad": "mensual",
        "destino": "tienda_propia", "sucursal": "Fraiche Coyoacán", "zona": "Sur", "horario": "8 horas de trabajo más 1 hora de comida",
        "posiciones": 1, "fecha_objetivo": "2026-10-31", "requisitos_indispensables": ["Manejo de efectivo"],
        "preguntas_filtro": fraiche.preguntas_web_fraiche("Cajero"), "publicar": True, "plataformas": ["Portal"],
    })
    check(r.status_code == 201, f"vacante Cajero publicada con 11 preguntas web ({r.status_code} {r.text[:120]})")
    v = r.json()
    VAC, SLUG = v["id"], v["slug"]
    crit = v["criterios"]
    check(len(crit) == 11 and crit[0]["tipo"] == "municipio" and crit[1]["pregunta"] == "¿Cuánto tardarías en llegar a Fraiche Coyoacán?", "criterios con placeholder [sucursal] sustituido")
    check("$14,500" in crit[4]["pregunta"] and crit[4]["opciones"] == ["Sí", "No", "Necesito conocer más"], "[monto mensual] sustituido con el sueldo capturado y opciones del spec")
    check(client.get(f"/vacantes/slug/{SLUG}").json()["criterios"][1]["pregunta"].endswith("Fraiche Coyoacán?"), "la página pública recibe las preguntas ya sustituidas")

    def respuestas(**cambios):
        base = {
            "municipio": "Coyoacán, Ciudad de México", "traslado": "Hasta 30 min", "lunes_domingo": "Sí", "rolados": "Sí",
            "sueldo": "Sí", "puesto_similar": "Sí", "ventas": "Sí",
        }
        base.update(cambios)
        filas = [{"clave": c["clave"], "pregunta": c["pregunta"], "respuesta": base.get(c["clave"], "Sí")} for c in crit if c.get("clave")]
        filas += [{"pregunta": c["pregunta"], "respuesta": cambios.get(c["pregunta"], "Sí")} for c in crit if not c.get("clave")]
        return json.dumps(filas)

    def postular(nombre, tel, resp):
        r = client.post("/candidatos/postular", data={"vacante": SLUG, "nombre": nombre, "telefono": tel, "consentimiento": "true", "respuestas": resp, "fuente": "portal"})
        check(r.status_code == 201, f"postular {nombre} ({r.status_code} {r.text[:100]})")
        return db.query(Postulacion).filter(Postulacion.codigo == r.json()["postulacion"]).first()

    print("\n--- Clasificación del prefiltro web ---")
    p1 = postular("Cumple Todo", "5511110001", respuestas())
    db.refresh(p1)
    web = p1.analisis["prefiltro_web"]
    check(web["resultado"] == "cumple" and p1.estado == "cumple" and web["etiqueta"] == "Cumple", "todo Sí → Cumple y Postulacion.estado=cumple")
    check(client.get(f"/candidatos/{p1.codigo}").json()["prefiltroWeb"]["resultado"] == "cumple", "la ficha expone prefiltroWeb")

    p2 = postular("Revision Sueldo", "5511110002", respuestas(sueldo="Necesito conocer más", traslado="No sé"))
    db.refresh(p2)
    web = p2.analisis["prefiltro_web"]
    check(web["resultado"] == "revision" and p2.estado == "revision" and "Expectativa salarial" in web["motivo"] and "Traslado" in web["motivo"], f"respuestas inciertas → Requiere revisión con motivo: {web['motivo'][:90]}")

    p3 = postular("No Cumple Rolados", "5511110003", respuestas(rolados="No"))
    db.refresh(p3)
    web = p3.analisis["prefiltro_web"]
    check(web["resultado"] == "no_cumple" and p3.estado == "no_cumple" and "Horarios rolados" in web["motivo"], "No a una eliminatoria → No cumple con el requisito en el motivo")
    check(p3.activa and p3.etapa == "Prefiltro", "No cumple NO descarta ni cierra: RH decide")

    p4 = postular("No Terminal", "5511110004", respuestas(**{"¿Has usado terminal bancaria?": "No"}))
    db.refresh(p4)
    check(p4.analisis["prefiltro_web"]["resultado"] == "revision" and "Terminal bancaria" in p4.analisis["prefiltro_web"]["motivo"], "No a una pregunta de plantilla no eliminatoria → Requiere revisión")

    # el CV no pisa el resultado del prefiltro web
    rc._aplicar_cv(p1.candidato, p1, ia.CVExtraido(nombre="Cumple Todo", experiencia_resumen="Cajera 2 años", resumen_profesional="Cajera", es_cv=True, ajuste=ia.AjustePerfil(score=20, estado="no_cumple", evidencia="cv", requisitos_cumplidos=[], brechas=[])), p1.vacante, False)
    check(p1.estado == "cumple" and p1.score == 20, "un CV con estado no_cumple no pisa el resultado del prefiltro web (solo score/evidencia)")

    print("\n--- Segundo filtro por WhatsApp: guion fijo ---")
    PREGUNTAS_USADAS.clear()
    r = client.post(f"/candidatos/{p1.codigo}/prefiltro", json={"texto": "Hola"})
    check(r.status_code == 200 and PREGUNTAS_USADAS, "turno de prefiltro corre con el guion")
    guion = [q["pregunta"] for q in PREGUNTAS_USADAS[-1]["preguntas"]]
    check(guion[:3] == ["¿Cuánto tiempo trabajaste en tu empleo más reciente?", "¿Cuál era tu puesto?", "¿Qué función realizabas con más frecuencia?"], "las 3 primeras preguntas en el orden del spec")
    check(guion[3] == "¿Cuánto tiempo acumulado tienes en puestos como Cajero(a)?", "pregunta 4 (experiencia similar reportada) con [puesto] sustituido")
    check(guion[4] == "¿A partir de cuándo podrías iniciar?" and guion[-1].startswith("¿Tienes algún adeudo con BBVA?"), "sin duda web no hay pregunta 5; BBVA cierra el guion")
    check(PREGUNTAS_USADAS[-1]["guion_fijo"] is True and any("Horarios rolados" in x or "rolados" in x for x in PREGUNTAS_USADAS[-1]["respuestas_web"]), "el turno recibe guion_fijo y lo contestado en la web (no se repite)")
    check(PREGUNTAS_USADAS[-1]["preguntas"][-1]["informativa"] is True, "BBVA marcada como informativa")
    check("INFORMATIVA" in ia.criterios_prefiltro(PREGUNTAS_USADAS[-1]["preguntas"]), "el prompt marca BBVA como INFORMATIVA")

    PREGUNTAS_USADAS.clear()
    client.post(f"/candidatos/{p2.codigo}/prefiltro", json={"texto": "Hola"})
    guion2 = [q["pregunta"] for q in PREGUNTAS_USADAS[-1]["preguntas"]]
    check(any("tiempo de traslado" in q for q in guion2) and sum(1 for q in guion2 if "traslado" in q or "sueldo" in q.lower()) == 1, "con duda web (traslado «No sé») se agrega UNA pregunta sobre ese único punto")

    # recorrer el guion en modo demo: 6 preguntas (sin duda) + BBVA
    respuestas_chat = ["2 años", "Cajero en tienda", "Cobrar y atender clientes", "3 años", "La próxima semana", "Sí"]
    for t in respuestas_chat:
        r = client.post(f"/candidatos/{p1.codigo}/prefiltro", json={"texto": t})
    db.refresh(p1)
    check(p1.prefiltro_completo, "el guion completo cierra el prefiltro")
    check(p1.analisis.get("adeudo_bbva") == "Sí", f"la respuesta de BBVA se guarda en la ficha: {p1.analisis.get('adeudo_bbva')}")
    check(p1.estado == "cumple" and p1.etapa == "Entrevista IA", "un «Sí» al adeudo con BBVA NO descarta ni cambia el resultado")
    pw = p1.analisis["prefiltro_whatsapp"]
    check(pw["etiqueta"] == "Invitar a entrevista inicial" and pw["siguiente_accion"] == "Invitar a entrevista inicial", "resultado etiquetado «Invitar a entrevista inicial»")
    ficha = client.get(f"/candidatos/{p1.codigo}").json()
    check(ficha["adeudoBbva"] == "Sí" and ficha["prefiltroWhatsapp"]["etiqueta"] == "Invitar a entrevista inicial", "la ficha expone adeudoBbva y prefiltroWhatsapp")
    check(all(r.get("cumple") is None for r in p1.analisis["respuestas_prefiltro"] if "BBVA" in r.get("pregunta", "")), "en respuestas_prefiltro BBVA queda con cumple=null")

    check(fraiche.siguiente_accion_whatsapp("revision") == "Revisar por reclutador" and fraiche.siguiente_accion_whatsapp("no_cumple") == "No cumple indispensable", "etiquetas del spec para revisión y no cumple")

print(f"\n🎉 Fraiche Fases 2-3 verificadas: {OK} comprobaciones OK.")
