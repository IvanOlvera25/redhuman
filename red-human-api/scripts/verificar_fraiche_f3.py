"""Verificación Demo Fraiche · Fase 4 (2026-09-29): entrevista inicial con temas fijos que parte del prefiltro,
Entrevista IPV con rúbrica (6 competencias ponderadas, niveles Alto/Medio/Bajo con equivalencia ajustable,
«Sin evidencia» → revisión, conclusiones Recomendable / Bajo reserva / No recomendable), Red Human haciendo las
dos entrevistas en la misma sesión con DOS resultados separados, sesión solo IPV, IPV con entrevistador humano
(misma rúbrica, por liga y por RH) y «Programar nueva IPV humana». Modo demo, base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_f3.py
"""

import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_dir = tempfile.mkdtemp(prefix="rh_fraiche3_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "f3.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "ANAM_API_KEY", "ANAM_LLM_ID", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-fraiche"
os.environ["SEMBRAR_DEMO"] = "true"
os.environ["FRAICHE_PUBLICACION_ESTRICTA"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_admin, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Candidato, Cuenta, Entrevista, EntrevistaHumana, Postulacion, Usuario, UsuarioCuenta, Vacante  # noqa: E402
from app.services import fraiche, ia  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


print("\n--- Reglas puras ---")
c = fraiche.calcular_ipv({"orientacion_cliente": "alto", "motivacion": "alto", "resiliencia": "alto", "trabajo_equipo": "alto", "etica": "alto", "adaptabilidad": "alto"})
check(c["puntaje"] == 100 and c["conclusion"] == "recomendable", "todo Alto → 100 → Recomendable")
c = fraiche.calcular_ipv({"orientacion_cliente": "medio", "motivacion": "medio", "resiliencia": "medio", "trabajo_equipo": "medio", "etica": "medio", "adaptabilidad": "medio"})
check(c["puntaje"] == 70 and c["conclusion"] == "bajo_reserva", "todo Medio → 70 → Bajo reserva")
c = fraiche.calcular_ipv({"orientacion_cliente": "bajo", "motivacion": "bajo", "resiliencia": "bajo", "trabajo_equipo": "alto", "etica": "alto", "adaptabilidad": "alto"})
check(c["puntaje"] == 61.5 and c["conclusion"] == "bajo_reserva", f"mezcla ponderada 30/15/10 bajo + 20/20/5 alto = 61.5 → Bajo reserva ({c['puntaje']})")
c = fraiche.calcular_ipv({"orientacion_cliente": "bajo", "motivacion": "bajo", "resiliencia": "bajo", "trabajo_equipo": "bajo", "etica": "medio", "adaptabilidad": "bajo"})
check(c["puntaje"] == 38 and c["conclusion"] == "no_recomendable", "mayoría Bajo → 38 → No recomendable")
c = fraiche.calcular_ipv({"orientacion_cliente": "alto", "motivacion": "alto", "resiliencia": "alto", "trabajo_equipo": "alto", "etica": "alto"})
check(c["puntaje"] is None and c["requiere_revision"] and c["sin_evidencia"] == ["Adaptabilidad"] and c["conclusion"] == "", "falta evidencia en una competencia → sin nota, requiere revisión")
c = fraiche.calcular_ipv({k["clave"]: "alto" for k in fraiche.COMPETENCIAS_IPV}, {"alto": 90})
check(c["puntaje"] == 90 and c["conclusion"] == "recomendable", "equivalencia ajustada (alto=90) cambia el cálculo")
check(fraiche.resultado_desde_ipv({"conclusion": "bajo_reserva"}) == ("aprobado", "segunda_entrevista") and fraiche.resultado_desde_ipv({"conclusion": ""}) == ("", "segunda_entrevista"), "mapeo de conclusión a resultado/recomendación")
check(sum(k["peso"] for k in fraiche.COMPETENCIAS_IPV) == 100 and [k["peso"] for k in fraiche.COMPETENCIAS_IPV] == [30, 15, 10, 20, 20, 5], "pesos del spec: 30/15/10/20/20/5")

g = ia.guion_entrevista_inicial_fraiche("Cajero(a)")
check(g.temas == fraiche.TEMAS_ENTREVISTA_INICIAL and len(g.preguntas) == 6, "guion de la entrevista inicial con los 6 temas fijos (sin sueldo, 2026-10-01)")
check(not any("sueldo" in x.lower() or "salari" in x.lower() for x in g.preguntas + [g.enfoque] if "No hablar de sueldo" not in x) and "¿Cuándo podrías empezar a trabajar en Fraiche?" in g.preguntas, "sin sueldo y con la pregunta exacta de disponibilidad")
prompt = ia.prompt_entrevistador("Cajero(a)", "Manejo de efectivo", "Ana", g.preguntas, temas=g.temas, contexto_previo=["¿Has manejado efectivo? → Sí"], incluye_ipv=True)
check("¿Has manejado efectivo? → Sí" in prompt and "NO vuelvas a hacer estas preguntas" in prompt, "el prompt parte del prefiltro y no lo relee")
check(fraiche.MARCADOR_IPV in prompt and "Orientación al cliente (30%)" in prompt and "manejo de objeciones" in prompt, "el prompt incluye el bloque IPV con la rúbrica y el marcador")
ini, ipv = ia.dividir_transcript_ipv([{"rol": "assistant", "texto": "Hola"}, {"rol": "user", "texto": "sí"}, {"rol": "assistant", "texto": f"{fraiche.MARCADOR_IPV}. Un cliente está molesto…"}, {"rol": "user", "texto": "Lo escucho"}])
check(len(ini) == 2 and len(ipv) == 2, "el transcript se parte en el marcador")

with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Fraiche prueba", nombre_comercial="Fraiche", estado="Activa", slug="fraiche-prueba3")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    for v in db.query(Vacante).all():
        v.cuenta_id = cuenta.id
    for cand in db.query(Candidato).all():
        cand.cuenta_id = cuenta.id
        for p in cand.postulaciones:
            p.cuenta_id = cuenta.id
    db.commit()
    app.dependency_overrides[usuario_actual] = lambda: admin
    app.dependency_overrides[usuario_decisor] = lambda: admin
    app.dependency_overrides[usuario_admin] = lambda: admin
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- Configuración: equivalencias ---")
    r = client.get("/configuracion")
    check(r.status_code == 200 and r.json()["ipvEquivalencias"] == {"alto": 100, "medio": 70, "bajo": 30}, "equivalencias por default 100/70/30")
    r = client.patch("/configuracion", json={"ipv_equivalencias": {"medio": 65}})
    check(r.status_code == 200 and r.json()["ipvEquivalencias"]["medio"] == 65, "PATCH ajusta una equivalencia")
    r = client.patch("/configuracion", json={"ipv_equivalencias": {"bajo": 80}})
    check(r.status_code == 400, "Alto ≥ Medio ≥ Bajo se valida")
    client.patch("/configuracion", json={"ipv_equivalencias": {"medio": 70}})

    print("\n--- Entrevista inicial + IPV en la misma sesión (Red Human) ---")
    v = db.query(Vacante).first()
    r = client.post("/candidatos", json={"nombre": "Sandra IPV", "telefono": "5533334444", "vacante": v.codigo, "consentimiento": True, "fuente": "RH"})
    P = r.json()["id"]
    r = client.post("/entrevistas", json={"candidato": P})
    check(r.status_code == 201 and r.json()["fase"] == "inicial", f"entrevista inicial creada ({r.status_code})")
    ENT, TOKEN = r.json()["id"], r.json()["token"]
    e = db.query(Entrevista).filter(Entrevista.codigo == ENT).first()
    check(e.guion["temas"] == fraiche.TEMAS_ENTREVISTA_INICIAL, "la entrevista inicial usa el guion fijo de Fraiche")
    r = client.post(f"/candidatos/{P}/ipv", json={"modo": "red_human"})
    check(r.status_code == 201 and r.json()["modo"] == "misma_sesion" and r.json()["entrevista"]["fase"] == "inicial_ipv", "Programar IPV → Red Human continúa en la misma sesión")

    client.post(f"/entrevistas/publica/{TOKEN}/consentimiento", json={"acepta": True})
    r = client.post(f"/entrevistas/publica/{TOKEN}/sesion", json={"modo": "texto"})
    check(r.status_code == 200 and r.json()["modo"] == "texto", "sesión en modo texto")
    respuestas = [
        "Sí, comencemos",
        "Trabajé dos años como cajera en una tienda de conveniencia atendiendo público todo el día.",
        "Cobraba en caja, hacía cortes y acomodaba mercancía en piso de venta.",
        "Duré dos años en el último y año y medio en el anterior.",
        "Salí porque cerraron la sucursal donde trabajaba.",
        "Tengo disponibilidad de lunes a domingo y puedo iniciar la próxima semana.",
        "Una vez un cliente llegó molesto por un cobro doble; lo escuché y le devolví el cargo.",
        "Espero alrededor de catorce mil pesos mensuales.",
        # bloque IPV (6 situaciones)
        "Escuché al cliente molesto, identifiqué que quería su reembolso y lo resolví con mi encargada.",
        "Cuando hay pocas ventas ofrezco productos en promoción a cada persona que entra.",
        "Con presión por la meta me organizo y sigo intentando sin desanimarme.",
        "Apoyé a un compañero cubriendo su caja cuando se enfermó.",
        "Cometí un error de cobro, lo reconocí de inmediato y lo corregí con mi jefa.",
        "Cuando cambian una promoción la aprendo rápido y la aplico ese mismo día.",
        "Gracias",
    ]
    ultimo = {}
    for t in respuestas:
        ultimo = client.post(f"/entrevistas/publica/{TOKEN}/turno", json={"texto": t}).json()
        if ultimo.get("terminada"):
            break
    check(ultimo.get("terminada") is True, "la sesión demo recorre inicial + IPV y termina")
    db.refresh(e)
    check(any(fraiche.MARCADOR_IPV in m["texto"] for m in e.transcript if m["rol"] == "assistant"), "el transcript contiene el marcador de la segunda parte")
    r = client.post(f"/entrevistas/publica/{TOKEN}/finalizar", json={"cierre": "texto"})
    check(r.status_code == 200 and r.json()["estado"] == "evaluada", "finalizar evalúa")
    db.refresh(e)
    check(bool(e.evaluacion) and bool(e.evaluacion_ipv), "se guardan DOS resultados separados: evaluación inicial y evaluación IPV")
    calc = e.evaluacion_ipv["calculo"]
    check(calc["puntaje"] == 70 and calc["conclusion"] == "bajo_reserva" and all(n == "medio" for n in e.evaluacion_ipv["niveles"].values()), f"IPV demo: 6 competencias con evidencia → Medio → 70 → Bajo reserva ({calc})")
    ficha = client.get(f"/candidatos/{P}").json()
    ent = ficha["entrevistas"][-1]
    check(ent["fase"] == "inicial_ipv" and ent["evaluacionIpv"]["calculo"]["puntaje"] == 70 and ent["sugiereNuevaIpv"] is True and len(ent["transcript"]) > 10, "la ficha expone fase, transcripción, resultado IPV y sugiere nueva IPV humana")
    check(ficha["etapa"] == "Entrevista IA", "la etapa se queda en Filtro Red Human (sin columna Evaluación); la puntuación no decide nada")

    print("\n--- Sesión solo IPV (Red Human) ---")
    r = client.post(f"/candidatos/{P}/ipv", json={"modo": "red_human"})
    check(r.status_code == 201 and r.json()["modo"] == "sesion_ipv" and r.json()["entrevista"]["fase"] == "ipv", "sin inicial pendiente → sesión nueva solo IPV")
    T2 = r.json()["entrevista"]["token"]
    client.post(f"/entrevistas/publica/{T2}/consentimiento", json={"acepta": True})
    r = client.post(f"/entrevistas/publica/{T2}/sesion", json={"modo": "texto"})
    check("situaciones de tienda" in r.json()["mensajes"][0]["texto"], "la sesión IPV se presenta con su propia introducción")
    for t in ["Sí", "Escuché al cliente y le ofrecí una solución concreta.", "Sigo ofreciendo aunque venda poco.", "Corta", "Cubrí a un compañero enfermo en su turno.", "Reconocí mi error y lo corregí.", "Me adapto rápido a promociones nuevas.", "Gracias"]:
        ultimo = client.post(f"/entrevistas/publica/{T2}/turno", json={"texto": t}).json()
        if ultimo.get("terminada"):
            break
    r = client.post(f"/entrevistas/publica/{T2}/finalizar", json={"cierre": "texto"})
    e2 = db.query(Entrevista).filter(Entrevista.token == T2).first()
    db.refresh(e2)
    check(e2.estado == "evaluada" and e2.evaluacion_ipv["niveles"]["resiliencia"] == "sin_evidencia" and e2.evaluacion_ipv["calculo"]["requiere_revision"] is True, "una respuesta sin evidencia («Corta») → Sin evidencia → pide revisión, sin nota ficticia")

    print("\n--- IPV con entrevistador humano (misma rúbrica) ---")
    r = client.post(f"/candidatos/{P}/entrevista-humana", json={
        "tipo_entrevistador": "interno", "entrevistador_usuario_id": admin.id, "fecha": "2026-10-05", "hora": "10:00",
        "modalidad": "Presencial", "ubicacion": "Fraiche Coyoacán", "es_ipv": True, "usar_teams": False,
    })
    check(r.status_code == 201, f"IPV humana programada ({r.status_code} {r.text[:120]})")
    eh = db.query(EntrevistaHumana).order_by(EntrevistaHumana.id.desc()).first()
    check(eh.es_ipv is True, "la ronda queda marcada como IPV")
    r = client.get(f"/entrevista-humana/publica/{eh.token}")
    check(r.status_code == 200 and r.json()["esIpv"] and len(r.json()["rubricaIpv"]["competencias"]) == 6 and r.json()["rubricaIpv"]["equivalencias"]["alto"] == 100, "la liga del entrevistador trae la rúbrica y las equivalencias")
    r = client.post(f"/entrevista-humana/publica/{eh.token}", json={"comentario": "Muy buena actitud"})
    check(r.status_code == 400, "una IPV sin rúbrica no se puede registrar")
    rubrica = {
        "niveles": {"orientacion_cliente": "alto", "motivacion": "alto", "resiliencia": "medio", "trabajo_equipo": "alto", "etica": "alto", "adaptabilidad": "medio"},
        "respuestas": {"orientacion_cliente": "Escuchó y resolvió"}, "evidencias": {"orientacion_cliente": "«Le devolví el cargo»"},
        "observaciones": {"comunicacion": "Clara", "facilidad_palabra": "Buena", "manejo_objeciones": "Adecuado"},
    }
    r = client.post(f"/entrevista-humana/publica/{eh.token}", json={"rubrica": rubrica, "comentario": "Recomendable"})
    check(r.status_code == 200 and r.json()["resultadoIpv"]["puntaje"] == 95.5 and r.json()["resultadoIpv"]["conclusion"] == "recomendable", f"rúbrica por liga → 95.5 Recomendable ({r.json().get('resultadoIpv', {}).get('puntaje')})")
    db.refresh(eh)
    check(eh.resultado == "aprobado" and eh.recomendacion == "avanzar" and eh.rubrica["observaciones"]["comunicacion"] == "Clara", "resultado/recomendación derivados y observaciones guardadas sin peso")
    ficha = client.get(f"/candidatos/{P}").json()
    check(ficha["entrevistaHumana"]["esIpv"] and ficha["entrevistaHumana"]["resultadoIpv"]["conclusion"] == "recomendable" and ficha["entrevistaHumana"]["sugiereNuevaIpv"] is False, "la ficha expone la IPV humana con su cálculo")

    # segunda IPV humana con Bajo reserva → sugiere nueva IPV; la primera permanece
    r = client.post(f"/candidatos/{P}/entrevista-humana", json={
        "tipo_entrevistador": "interno", "entrevistador_usuario_id": admin.id, "fecha": "2026-10-06", "hora": "11:00",
        "modalidad": "Llamada", "es_ipv": True, "usar_teams": False,
    })
    check(r.status_code == 201, "Programar nueva IPV humana crea otro registro")
    r = client.post(f"/candidatos/{P}/entrevista-humana/resultado", json={"rubrica": {"niveles": {k["clave"]: "medio" for k in fraiche.COMPETENCIAS_IPV}}, "comentario": "Regular"})
    check(r.status_code == 200 and r.json()["entrevistaHumana"]["resultadoIpv"]["conclusion"] == "bajo_reserva" and r.json()["entrevistaHumana"]["sugiereNuevaIpv"] is True, "RH captura la rúbrica → Bajo reserva → «Programar nueva IPV humana»")
    check(len(r.json()["entrevistasHumanas"]) == 2 and any(x["resultadoIpv"] and x["resultadoIpv"]["conclusion"] == "recomendable" for x in r.json()["entrevistasHumanas"]), "la primera IPV permanece visible en el historial")
    check(r.json()["etapa"] == "Entrevista Humana", "ninguna puntuación mueve de etapa por sí sola")

print(f"\n🎉 Fraiche Fase 4 verificada: {OK} comprobaciones OK.")
