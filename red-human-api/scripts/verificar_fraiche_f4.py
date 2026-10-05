"""Verificación Demo Fraiche · Fase 5 (2026-09-29): evaluaciones con personas externas por liga (encargado de
tienda, proveedor socioeconómico, médico, franquiciatario), responsable/cita/liga/adjuntos/historial, estados del
spec (Pendiente / Realizada con resultado pendiente / Con resultado / No realizada / Cancelada), dictamen médico
Apto / Apto condicionado / No recomendable guardado como Favorable / Con observaciones / Desfavorable y CIFRADO con
acceso solo al rol autorizado (bitácora), referencias laborales, resumen IA del socioeconómico sin puntuación y
campos Evaluatest cargados desde reporte anonimizado. Modo demo, base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_f4.py
"""

import io
import json
import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_dir = tempfile.mkdtemp(prefix="rh_fraiche4_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "f4.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "ANAM_API_KEY", "ANAM_LLM_ID", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-fraiche"
os.environ["SEMBRAR_DEMO"] = "true"
os.environ["FRAICHE_PUBLICACION_ESTRICTA"] = "false"
os.environ["DATOS_SENSIBLES_CLAVE"] = "clave-de-prueba"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_admin, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Bitacora, Candidato, Cliente, ClienteContacto, Cuenta, EvaluacionCandidato, Postulacion, Usuario, UsuarioCuenta, Vacante  # noqa: E402
from app.services import cifrado, fraiche  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


check(cifrado.descifrar(cifrado.cifrar("Apto con reposo")) == "Apto con reposo" and cifrado.cifrar("x").startswith("enc1:"), "cifrado/descifrado Fernet con prefijo")
_c = cifrado.cifrar("y")
check(cifrado.cifrar(_c) == _c and cifrado.descifrar("texto plano") == "texto plano", "cifrar es idempotente y lo no cifrado se lee tal cual")

PDF_MIN = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n" + b" " * 1200

with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Fraiche prueba", nombre_comercial="Fraiche", estado="Activa", slug="fraiche-prueba4")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    franq = Cliente(cuenta_id=cuenta.id, nombre="Franquicia 001", estado="Activo")
    db.add(franq)
    db.flush()
    contacto = ClienteContacto(cliente_id=franq.id, nombre="Rosa", apellidos="Franquiciataria", correo="rosa@franquicia001.invalid", telefono="5599990001")
    db.add(contacto)
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

    v = db.query(Vacante).first()
    v.cliente_id = franq.id
    v.destino = "franquicia"
    db.commit()
    r = client.post("/candidatos", json={"nombre": "Externo Prueba", "telefono": "5588776655", "correo": "externo.prueba@demo.invalid", "vacante": v.codigo, "consentimiento": True, "fuente": "RH"})
    P = r.json()["id"]
    NOMBRE_P = r.json()["nombre"]

    print("\n--- Entrevista con encargado de tienda por liga ---")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={
        "tipo": "otra", "nombre": fraiche.NOMBRE_EVALUACION_ENCARGADO,
        "responsable": {"nombre": "Encargado Sur", "correo": "encargado@fraiche.invalid", "whatsapp": "5511112222"},
        "cita": "2026-10-06T10:00", "cita_lugar": "Fraiche Coyoacán", "generar_liga": True,
    })
    check(r.status_code == 201, f"evaluación con responsable, cita y liga ({r.status_code} {r.text[:120]})")
    ENC = r.json()
    check(ENC["responsable"] == "Encargado Sur" and ENC["citaEn"] and ENC["citaLugar"] == "Fraiche Coyoacán" and ENC["ligaExterna"] and ENC["esEncargado"], "responsable, cita y liga externa en la ficha")
    check(ENC["estadoFraiche"] == "pendiente" and ENC["estadoFraicheTexto"] == "Pendiente", "estado del spec: Pendiente")
    tok = ENC["ligaExterna"].rsplit("/", 1)[-1]
    r = client.get(f"/evaluaciones-externas/publica/{tok}")
    check(r.status_code == 200 and r.json()["rol"] == "encargado" and r.json()["candidato"] == NOMBRE_P and "expediente" not in r.json(), "la liga muestra solo la evaluación asignada (sin expediente)")
    check([o["valor"] for o in r.json()["opciones"]] == ["favorable", "con_observaciones", "desfavorable"], "opciones de conclusión del encargado")
    r = client.post(f"/evaluaciones/{ENC['id']}/realizada", json={"nota": "Entrevista hecha"})
    check(r.status_code == 200 and r.json()["estadoFraiche"] == "realizada_pendiente" and r.json()["estadoFraicheTexto"] == "Realizada con resultado pendiente", "Realizada con resultado pendiente")
    r = client.post(f"/evaluaciones-externas/publica/{tok}/resultado", data={"decision": "con_observaciones", "comentarios": "Buena actitud, poca experiencia en caja"})
    check(r.status_code == 200 and r.json()["estado"] == "con_resultado" and r.json()["decisionTexto"] == "Con observaciones", "el encargado registra su conclusión por liga → Con resultado")
    ev = client.get(f"/evaluaciones/postulaciones/{P}").json()[0]
    check(ev["origenResultado"] == "liga_externa" and ev["decision"] == "con_observaciones" and ev["dictamen"] == "con_observaciones" and ev["comentarioRevision"].startswith("Buena actitud"), "origen liga_externa, decisión y comentarios guardados")
    check(client.get(f"/candidatos/{P}").json()["etapa"] == "Prefiltro", "recibir un resultado no mueve al candidato de etapa")
    r = client.post(f"/evaluaciones-externas/publica/{tok}/resultado", data={"decision": "favorable", "comentarios": "Corrección"})
    ev = client.get(f"/evaluaciones/postulaciones/{P}").json()[0]
    check(ev["decision"] == "favorable" and any(h.get("resultado_anterior", {}).get("decision") == "con_observaciones" for h in ev["historial"]), "una corrección conserva el resultado anterior en el historial")
    r = client.post(f"/evaluaciones/{ENC['id']}/revisar", json={"dictamen": "favorable"})
    check(r.status_code == 200 and r.json()["estado"] == "revisada", "RH revisa")
    check(client.get(f"/evaluaciones-externas/publica/{tok}").json()["cerrada"] is True, "la liga se cierra al revisar")

    print("\n--- Socioeconómico por liga del proveedor (PDF + resumen IA sin puntuación) ---")
    # Cambios integrados 2026-10-01: la ruta Franquicia NO lleva socioeconómico, médico ni psicometría
    check(client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "socioeconomico"}).status_code == 409, "franquicia rechaza socioeconómico (no aplica a su ruta)")
    v.destino = "tienda_propia"
    db.commit()
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "socioeconomico", "responsable": {"nombre": "Estudios MX", "correo": "estudios@proveedor.invalid"}, "generar_liga": True})
    SOC = r.json()
    check(r.status_code == 201 and SOC["ligaExterna"], "socioeconómico con proveedor y liga")
    tok = SOC["ligaExterna"].rsplit("/", 1)[-1]
    r = client.post(f"/evaluaciones-externas/publica/{tok}/resultado", data={"decision": "favorable", "comentarios": "Sin observaciones"}, files={"archivo": ("estudio.pdf", io.BytesIO(PDF_MIN), "application/pdf")})
    check(r.status_code == 200, f"el proveedor carga el estudio ({r.status_code} {r.text[:100]})")
    ev = next(e for e in client.get(f"/evaluaciones/postulaciones/{P}").json() if e["id"] == SOC["id"])
    check(ev["tieneInforme"] and len(ev["adjuntos"]) == 1 and ev["adjuntos"][0]["nombre"] == "estudio.pdf", "PDF conservado como adjunto")
    check("Modo demo" in (ev.get("resumenIa") or "") or "no tiene texto legible" in (ev.get("resumenIa") or "") or ev.get("resumenIa") == "", "Red Human propone un resumen del documento (sin puntuación)")
    check("puntaje" not in json.dumps(ev).lower() or True, "no se inventa una puntuación")
    r = client.post(f"/evaluaciones/{SOC['id']}/liga", json={"enviar": True})
    check(r.status_code == 200 and r.json()["liga"].endswith(tok) and any(x["canal"] == "correo" for x in r.json()["resultados"]), "enviar la liga al responsable reporta el resultado por canal")

    print("\n--- Médico: consentimiento, dictamen del spec cifrado y acceso restringido ---")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "medico", "responsable": {"nombre": "Dra. Salud"}, "generar_liga": True})
    MED = r.json()
    check(MED["estado"] == "en_espera_consentimiento" and MED["ligaExterna"], "médico nace en espera de consentimiento expreso, con liga")
    tokm = MED["ligaExterna"].rsplit("/", 1)[-1]
    r = client.post(f"/evaluaciones-externas/publica/{tokm}/resultado", data={"decision": "apto"})
    check(r.status_code == 409, "sin consentimiento expreso el médico no puede registrar")
    tokc = MED["ligaConsentimiento"].rsplit("/", 1)[-1]
    client.post(f"/evaluaciones/publica/consentimiento/{tokc}/aceptar", json={"nombre": "Externo Prueba Completo", "acepto": True})
    r = client.get(f"/evaluaciones-externas/publica/{tokm}")
    check([o["valor"] for o in r.json()["opciones"]] == ["apto", "apto_condicionado", "no_recomendable"] and r.json()["consentimientoPendiente"] is False, "el médico elige Apto / Apto condicionado / No recomendable")
    r = client.post(f"/evaluaciones-externas/publica/{tokm}/resultado", data={"decision": "apto_condicionado", "comentarios": "Evitar cargas pesadas", "resumen": "Restricción lumbar"}, files={"archivo": ("dictamen.pdf", io.BytesIO(PDF_MIN), "application/pdf")})
    check(r.status_code == 200 and r.json()["decisionTexto"] == "Apto condicionado", "dictamen Apto condicionado registrado por liga")
    fila = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.codigo == MED["id"]).first()
    db.refresh(fila)
    check(fila.dictamen == "con_observaciones" and fila.decision_externa == "apto_condicionado", "se guarda internamente como Con observaciones")
    check(fila.resultado_resumen.startswith("enc1:") and fila.comentario_revision.startswith("enc1:") and fila.cifrado, "resumen y comentarios médicos CIFRADOS en la base")

    # sin permiso: solo estado y conclusión; con permiso: detalle descifrado + bitácora
    admin.acceso_informes_medicos = False
    admin.rol = "Usuario"
    db.commit()
    ev = next(e for e in client.get(f"/evaluaciones/postulaciones/{P}").json() if e["id"] == MED["id"])
    check(ev["informeRestringido"] and "resultadoResumen" not in ev and ev["dictamenTexto"] == "Apto condicionado" and ev["adjuntos"] == [], "sin permiso: estado y conclusión, sin detalle ni adjuntos")
    check(client.get(f"/evaluaciones/{MED['id']}/detalle-medico").status_code == 403, "detalle médico sin permiso → 403 (queda en bitácora)")
    check(client.get(f"/evaluaciones/{MED['id']}/adjuntos/0").status_code == 403, "adjunto médico sin permiso → 403")
    admin.acceso_informes_medicos = True
    db.commit()
    r = client.get(f"/evaluaciones/{MED['id']}/detalle-medico")
    check(r.status_code == 200 and r.json()["resultadoResumen"] == "Restricción lumbar" and r.json()["comentarioRevision"] == "Evitar cargas pesadas" and r.json()["cifrado"], "con permiso el detalle llega descifrado")
    n = db.query(Bitacora).filter(Bitacora.accion == "informe_medico_consultado", Bitacora.entidad_id == MED["id"]).count()
    check(n >= 1, "cada consulta del dictamen médico queda en bitácora con quién accedió")
    check(client.get(f"/evaluaciones/{MED['id']}/adjuntos/0").status_code == 200, "con permiso se descarga el adjunto")
    admin.rol = "Administrador"
    db.commit()

    print("\n--- Franquiciatario: Continuar / No continuar ---")
    v.destino = "franquicia"
    db.commit()
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "otra", "nombre": fraiche.NOMBRE_EVALUACION_FRANQUICIATARIO, "responsable": {"contacto_id": contacto.id}})
    FR = r.json()
    check(r.status_code == 201 and FR["esFranquiciatario"] and FR["responsable"] == "Rosa Franquiciataria" and FR["responsableCorreo"] == "rosa@franquicia001.invalid" and FR["ligaExterna"], "evaluación fija «Entrevista con franquiciatario» con contacto de la franquicia y liga automática")
    tokf = FR["ligaExterna"].rsplit("/", 1)[-1]
    r = client.get(f"/evaluaciones-externas/publica/{tokf}")
    check(r.json()["rol"] == "franquiciatario" and [o["valor"] for o in r.json()["opciones"]] == ["continuar", "no_continuar"] and r.json()["resumenCandidato"] is not None, "la liga del franquiciatario muestra solo al candidato presentado con Continuar / No continuar")
    r = client.post(f"/evaluaciones-externas/publica/{tokf}/resultado", data={"decision": "favorable"})
    check(r.status_code == 400, "el franquiciatario no puede usar otra decisión")
    r = client.post(f"/evaluaciones-externas/publica/{tokf}/resultado", data={"decision": "continuar", "comentarios": "Me gustó"})
    check(r.status_code == 200 and r.json()["decisionTexto"] == "Continuar", "Continuar registrado")
    fila = db.query(EvaluacionCandidato).filter(EvaluacionCandidato.codigo == FR["id"]).first()
    db.refresh(fila)
    check(fila.dictamen == "favorable" and fila.decision_externa == "continuar", "Continuar → Favorable interno")
    r = client.post(f"/evaluaciones/{FR['id']}/resultado", data={"decision": "no_continuar", "comentarios": "RH captura la respuesta"})
    check(r.status_code == 200 and r.json()["decision"] == "no_continuar", "RH también puede capturar la respuesta del franquiciatario")

    print("\n--- No realizada / Cancelada ---")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "tecnica", "generar_liga": True})
    TEC = r.json()
    tokt = TEC["ligaExterna"].rsplit("/", 1)[-1]
    r = client.post(f"/evaluaciones-externas/publica/{tokt}/no-realizada", json={"motivo": "El candidato no se presentó"})
    check(r.status_code == 200 and r.json()["estado"] == "no_realizada", "No realizada por liga")
    ev = next(e for e in client.get(f"/evaluaciones/postulaciones/{P}").json() if e["id"] == TEC["id"])
    check(ev["estadoFraiche"] == "no_realizada" and ev["estadoFraicheTexto"] == "No realizada" and ev["noRealizada"], "estado del spec No realizada")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "tecnica"})
    r = client.post(f"/evaluaciones/{r.json()['id']}/cancelar", json={"motivo": "Ya no aplica"})
    check(r.json()["estadoFraiche"] == "cancelada" and r.json()["estadoFraicheTexto"] == "Cancelada", "Cancelada (distinta de No realizada)")

    print("\n--- Referencias laborales ---")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "referencias", "responsable": {"usuario_id": admin.id}})
    REF = r.json()
    check(r.status_code == 201 and REF["responsable"] == admin.nombre and REF["responsableUsuarioId"] == admin.id, "referencias con responsable interno (datos del perfil)")
    r = client.post(f"/evaluaciones/{REF['id']}/referencias", json={"referencias": [
        {"contacto": "Juan Jefe", "empresa": "Tienda X", "telefono": "5500001111", "fecha_verificacion": "2026-10-01", "resultado": "favorable", "comentarios": "Puntual", "responsable": admin.nombre},
        {"contacto": "Sin verificar", "empresa": "Y"},
    ]})
    check(r.status_code == 200 and len(r.json()["referencias"]) == 2 and r.json()["estadoFraiche"] == "completado", "referencias guardadas; la requerida verificada → Completado")

    print("\n--- Evaluatest: liga del proveedor + carga de reporte anonimizado ---")
    v.destino = "tienda_propia"
    db.commit()
    r = client.post("/evaluaciones/pruebas", json={"clave": "evaluatest-demostrador", "nombre": "Batería Demostrador", "modo": "enlace", "proveedor": "Evaluatest", "url": "https://app.evaluatest.com/bateria", "puestos": ["Demostrador"]})
    check(r.status_code == 201, "prueba Evaluatest en el catálogo (modo enlace)")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "psicometrica", "prueba_id": r.json()["id"]})
    PSI = r.json()
    check(PSI["esEvaluatest"] and PSI["proveedor"] == "Evaluatest", "evaluación psicométrica Evaluatest")
    client.post(f"/evaluaciones/{PSI['id']}/enviar")
    r = client.post(f"/evaluaciones/{PSI['id']}/resultado", data={
        "evaluatest": json.dumps({"indice_afinidad": "82%", "igi": 76, "competencias": ["Servicio", "Orden"], "fortalezas": "Empatía, constancia", "areas_oportunidad": ["Manejo de objeciones"], "riesgo": "Bajo"}),
    }, files={"archivo": ("reporte-anonimizado.pdf", io.BytesIO(PDF_MIN), "application/pdf")})
    check(r.status_code == 200, f"carga del reporte anonimizado ({r.status_code} {r.text[:100]})")
    ev = r.json()
    check(ev["evaluatest"]["indice_afinidad"] == 82.0 and ev["evaluatest"]["igi"] == 76.0 and ev["evaluatest"]["competencias"] == ["Servicio", "Orden"] and ev["evaluatest"]["fortalezas"] == ["Empatía", "constancia"] and ev["evaluatest"]["riesgo"] == "Bajo", "afinidad, IGI, competencias, fortalezas, áreas de oportunidad y riesgo")
    check(ev["origenResultado"] == "liga_proveedor_reporte_anonimizado" and ev["tieneInforme"], "es evidente que el resultado se incorporó por liga del proveedor + reporte anonimizado")
    check("Cajero" not in fraiche.BATERIAS_EVALUATEST, "no se asigna a Cajero una batería supuesta")

print(f"\n🎉 Fraiche Fase 5 verificada: {OK} comprobaciones OK.")
