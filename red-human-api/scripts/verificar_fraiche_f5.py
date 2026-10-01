"""Verificación Demo Fraiche · Fase 6 (2026-09-29): ruta visible por destino (pasos sobre las etapas internas,
avances automáticos y confirmación de RH), ruta de franquicia con «Presentar al franquiciatario» y estados
Presentado / Aceptado por franquiciatario / No aceptado (Aceptado no cuenta como ingreso), «Preparar alta de
colaborador» → «Datos para alta en SAP SuccessFactors» (bloques con origen por campo, sin médico ni socioeconómico)
→ «Listo para enviar a SAP» sin enviar nada, y la ficha PDF para presentar con registro de destinatario y fecha.
Modo demo, base desechable.

Uso (desde red-human-api/):
    .venv/bin/python scripts/verificar_fraiche_f5.py
"""

import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_dir = tempfile.mkdtemp(prefix="rh_fraiche5_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "f5.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "ANAM_API_KEY", "ANAM_LLM_ID", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-fraiche"
os.environ["SEMBRAR_DEMO"] = "true"
os.environ["FRAICHE_PUBLICACION_ESTRICTA"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_admin, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Bitacora, Candidato, Cliente, ClienteContacto, Cuenta, Postulacion, Usuario, UsuarioCuenta, Vacante  # noqa: E402
from app.services import fraiche  # noqa: E402

OK = 0


def check(cond, msg):
    global OK
    if not cond:
        print(f"❌ FALLO: {msg}")
        sys.exit(1)
    OK += 1
    print(f"✅ {msg}")


check(fraiche.RUTA_TIENDA_PROPIA[-1] == "listo_sap" and len(fraiche.RUTA_TIENDA_PROPIA) == 11 and fraiche.RUTA_FRANQUICIA[-1] == "presentacion", "rutas del spec: 11 pasos tienda propia, 7 franquicia")
check(all(fraiche.PASOS[p]["etapa"] in ("Prefiltro", "Entrevista IA", "Evaluación", "Entrevista Humana", "Contratación", "Onboarding") for p in fraiche.PASOS), "cada paso mapea a una etapa interna existente")

with TestClient(app) as client:
    db = SessionLocal()
    admin = db.query(Usuario).filter(Usuario.rol == "Administrador").first()
    cuenta = Cuenta(nombre="Fraiche prueba", nombre_comercial="Fraiche", estado="Activa", slug="fraiche-prueba5", razon_social="Fraiche SA de CV")
    db.add(cuenta)
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    franq = Cliente(cuenta_id=cuenta.id, nombre="Franquicia 001", estado="Activo")
    db.add(franq)
    db.flush()
    contacto = ClienteContacto(cliente_id=franq.id, nombre="Rosa", apellidos="Franquiciataria", correo="rosa@f001.invalid", telefono="5599990001")
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

    print("\n--- Ruta de tienda propia: pasos automáticos y confirmación de RH ---")
    r = client.post("/vacantes", json={"titulo": "Cajero(a) propia", "descripcion": "x", "generar_si_falta": False, "destino": "tienda_propia", "sucursal": "Fraiche Centro", "zona": "Centro", "horario": "8 h + 1 h comida", "publicar": True, "plataformas": ["Portal"]})
    VP = r.json()["id"]
    SLUG = r.json()["slug"]
    r = client.post("/candidatos/postular", data={"vacante": SLUG, "nombre": "Ruta Propia", "telefono": "5566001122", "consentimiento": "true", "respuestas": "[]", "fuente": "portal"})
    P = r.json()["postulacion"]
    ficha = client.get(f"/candidatos/{P}").json()
    check(ficha["paso"] == "prefiltro_web" and ficha["pasoNombre"] == "Prefiltro web" and ficha["destino"] == "tienda_propia" and len(ficha["ruta"]) == 11, "al postularse el paso es Prefiltro web y la ficha trae la ruta de 11 pasos")
    r = client.get("/candidatos", params={"paso": "prefiltro_web"})
    check(any(x["id"] == P for x in r.json()), "GET /candidatos?paso= filtra por paso visible")
    r = client.get("/candidatos", params={"destino": "tienda_propia"})
    check(any(x["id"] == P for x in r.json()), "GET /candidatos?destino= filtra por destino de la vacante")
    r = client.patch(f"/candidatos/{P}/paso", json={"paso": "entrevista_inicial", "comentario": "Pasa a entrevista"})
    check(r.status_code == 200 and r.json()["paso"] == "entrevista_inicial" and r.json()["etapa"] == "Entrevista IA", "RH confirma Entrevista inicial → etapa interna Entrevista IA")
    check(any(h["evento"] == "paso_confirmado" for h in r.json()["historial"]), "el movimiento queda en el historial")
    r = client.patch(f"/candidatos/{P}/paso", json={"paso": "presentacion"})
    check(r.status_code == 400, "un paso de otra ruta se rechaza")
    r = client.patch(f"/candidatos/{P}/paso", json={"paso": "listo_sap"})
    check(r.status_code == 409, "Listo para enviar a SAP exige Onboarding (Iniciar Onboarding)")
    r = client.post("/entrevistas", json={"candidato": P, "avisar_whatsapp": False})
    check(client.get(f"/candidatos/{P}").json()["paso"] == "entrevista_inicial", "agendar la entrevista inicial mantiene/registra el paso")
    r = client.post(f"/candidatos/{P}/ipv", json={"modo": "red_human"})
    ipv = next(a for a in client.get(f"/candidatos/{P}").json()["avance"]["actividades"] if a["clave"] == "ipv")
    check(ipv["estado"] == "en_curso", "programar IPV la deja en curso en el avance (actividad de Filtro humano)")
    r = client.patch(f"/candidatos/{P}/paso", json={"paso": "psicometria"})
    check(r.status_code == 200 and r.json()["etapa"] == "Entrevista Humana" and r.json()["paso"] == "psicometria", "Psicometría → Filtro humano (la columna Evaluación ya no existe)")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "referencias"})
    check(client.get(f"/candidatos/{P}").json()["paso"] == "referencias", "agregar Referencias avanza a Referencias laborales")
    r = client.post(f"/evaluaciones/postulaciones/{P}", json={"tipo": "psicometrica", "prueba_id": None})
    check(client.get(f"/candidatos/{P}").json()["paso"] == "referencias", "un evento anterior en la ruta no retrocede el paso")
    r = client.patch(f"/candidatos/{P}/paso", json={"paso": "documentacion"})
    check(r.status_code == 200 and r.json()["etapa"] == "Contratación" and r.json()["expedienteId"], "Documentación y onboarding → Contratación con expediente abierto")

    print("\n--- Preparar alta → Datos para alta en SAP SuccessFactors ---")
    EXP = r.json()["expedienteId"]
    r = client.get(f"/contratacion/expedientes/{EXP}/datos-alta")
    check(r.status_code == 200 and [b["clave"] for b in r.json()["bloques"]] == ["datos_personales", "identificadores", "contacto", "puesto", "condiciones"], "5 bloques del spec")
    vista = r.json()
    nombre = next(x for b in vista["bloques"] for x in b["campos"] if x["clave"] == "nombre")
    curp = next(x for b in vista["bloques"] for x in b["campos"] if x["clave"] == "curp")
    check(nombre["valor"] == "Ruta Propia" and nombre["origen"] == "Ficha del candidato" and curp["faltante"] and curp["origen"] == "Pendiente de capturar", "cada campo muestra su origen y marca los faltantes")
    check(vista["excluye"] == ["Información médica", "Información socioeconómica"] and "medic" not in str(vista["bloques"]).lower(), "excluye información médica y socioeconómica")
    r = client.post(f"/contratacion/expedientes/{EXP}/confirmar-datos-alta")
    check(r.status_code == 409 and "CURP" in r.json()["detail"], "no se confirma con faltantes")
    r = client.patch(f"/candidatos/{P}/condiciones-contratacion", json={"puesto": "Cajero(a)", "sueldo": "$14,500 MXN mensuales", "tipo_contratacion": "Tiempo indeterminado", "fecha_ingreso": "2026-11-03", "empresa": "Fraiche SA de CV"})
    check(r.status_code == 200, f"condiciones guardadas ({r.status_code} {r.text[:100]})")
    r = client.patch(f"/contratacion/expedientes/{EXP}/datos-alta", json={"personales": {"curp": "rupr900101hdfxxx01", "rfc": "RUPR900101ABC", "nss": "12345678901", "domicilio": "Calle 1, CDMX", "fecha_nacimiento": "1990-01-01"}, "campos": {"jefe": "Encargada Centro"}})
    check(r.status_code == 200, "RH captura CURP/RFC/NSS/domicilio")
    curp = next(x for b in r.json()["bloques"] for x in b["campos"] if x["clave"] == "curp")
    jefe = next(x for b in r.json()["bloques"] for x in b["campos"] if x["clave"] == "jefe")
    check(curp["valor"] == "RUPR900101HDFXXX01" and curp["origen"] == "Capturado por RH" and jefe["origen"] == "Capturado por RH", "lo capturado queda con origen «Capturado por RH»")
    check(r.json()["faltantes"] == [], f"ya no hay faltantes ({r.json()['faltantes']})")
    r = client.post(f"/contratacion/expedientes/{EXP}/confirmar-datos-alta")
    check(r.status_code == 200 and r.json()["estadoSap"] == "listo_para_enviar_sap" and r.json()["mensaje"] == "Conexión con SAP pendiente de configurar", "«Listo para enviar a SAP» + «Conexión con SAP pendiente de configurar»")
    e_dict = r.json()["expediente"]
    check(e_dict["estadoSapTexto"] == "Listo para enviar a SAP" and e_dict["sapConfirmadoPor"] == admin.nombre, "el expediente expone el estado SAP y quién confirmó")
    check("numero_empleado" not in str(r.json()).lower() and db.query(Bitacora).filter(Bitacora.accion == "datos_alta_confirmados").count() == 1, "no se asigna número de empleado ni se afirma alta en SAP; queda en bitácora")
    p_obj = db.query(Postulacion).filter(Postulacion.codigo == P).first()
    db.refresh(p_obj)
    check(p_obj.paso == "listo_sap", "el paso queda «Listo para enviar a SAP»")

    print("\n--- Ficha PDF para presentar ---")
    r = client.get(f"/candidatos/{P}/ficha-presentacion", params={"secciones": "vacante,candidato,experiencia,ipv"})
    check(r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content[:4] == b"%PDF", "vista previa PDF con apartados elegidos")
    n_antes = db.query(Bitacora).filter(Bitacora.accion == "ficha_presentacion_generada").count()
    r = client.post(f"/candidatos/{P}/ficha-presentacion", json={"destinatario": "Encargada Centro", "secciones": ["vacante", "candidato", "entrevista_inicial", "ipv", "psicometria"], "observaciones": "Buena actitud", "siguiente_accion": "Entrevista con encargada"})
    check(r.status_code == 200 and r.content[:4] == b"%PDF", "generar ficha regresa el PDF")
    check(db.query(Bitacora).filter(Bitacora.accion == "ficha_presentacion_generada").count() == n_antes + 1, "se registra destinatario y fecha en bitácora")
    ficha = client.get(f"/candidatos/{P}").json()
    check(any(h["evento"] == "ficha_presentada" and "Encargada Centro" in h["texto"] for h in ficha["historial"]), "y en el historial de la postulación")

    print("\n--- Ruta de franquicia ---")
    r = client.post("/vacantes", json={"titulo": "Demostrador franquicia", "descripcion": "x", "generar_si_falta": False, "destino": "franquicia", "cliente_id": franq.id, "sucursal": "F001 Polanco", "zona": "Norte", "publicar": True, "plataformas": ["Portal"]})
    VF, SLUGF = r.json()["id"], r.json()["slug"]
    r = client.post("/candidatos/postular", data={"vacante": SLUGF, "nombre": "Ruta Franquicia", "telefono": "5566003344", "consentimiento": "true", "respuestas": "[]"})
    PF = r.json()["postulacion"]
    ficha = client.get(f"/candidatos/{PF}").json()
    check(ficha["destino"] == "franquicia" and [x["clave"] for x in ficha["ruta"]] == fraiche.RUTA_FRANQUICIA, "la ruta de franquicia tiene 7 pasos y termina en Presentación al franquiciatario")
    check(client.patch(f"/candidatos/{PF}/paso", json={"paso": "documentacion"}).status_code == 400, "franquicia no tiene documentación ni alta SAP")
    r = client.post(f"/candidatos/{PF}/presentar-franquiciatario", json={"contacto_id": contacto.id, "enviar_liga": True})
    check(r.status_code == 201 and r.json()["liga"].startswith("http") and "/evaluacion/" in r.json()["liga"], f"Presentar al franquiciatario crea la evaluación y su liga ({r.status_code} {r.text[:120]})")
    ficha = r.json()["candidato"]
    check(ficha["franquiciaEstado"] == "presentado" and ficha["franquiciaEstadoTexto"] == "Presentado" and ficha["paso"] == "presentacion" and ficha["etapa"] == "Entrevista Humana", "postulación Presentado, paso Presentación, etapa interna Entrevista Humana")
    evs = client.get(f"/evaluaciones/postulaciones/{PF}").json()
    fr = next(e for e in evs if e["esFranquiciatario"])
    check(fr["responsable"] == "Rosa Franquiciataria" and fr["responsableContactoId"] == contacto.id, "la evaluación queda asignada al contacto de la franquicia")
    tok = fr["ligaExterna"].rsplit("/", 1)[-1]
    r = client.post(f"/evaluaciones-externas/publica/{tok}/resultado", data={"decision": "continuar", "comentarios": "Sí"})
    ficha_pf = client.get(f"/candidatos/{PF}").json()
    check(r.status_code == 200 and ficha_pf["franquiciaEstado"] == "aceptado" and ficha_pf["activa"] is True and ficha_pf["etapa"] == "Entrevista Humana",
          "2026-10-01: la decisión del franquiciatario se refleja (Aceptado) sin cerrar ni mover la postulación")
    check(client.post(f"/candidatos/{P}/presentar-franquiciatario", json={"contacto_id": contacto.id}).status_code == 409, "una vacante de tienda propia no se presenta a franquiciatario")
    r = client.patch(f"/candidatos/{PF}/franquicia", json={"estado": "aceptado", "comentario": "Contrata la franquicia"})
    check(r.status_code == 200 and r.json()["franquiciaEstado"] == "aceptado" and r.json()["activa"] is True, "2026-10-01: Aceptado ya no cierra — sigue a Contratación")
    check(db.query(Postulacion).filter(Postulacion.codigo == PF).first().expediente is None, "sin expediente ni alta: la contratación la hace el franquiciatario")
    r = client.post("/candidatos/postular", data={"vacante": SLUGF, "nombre": "Ruta Franquicia Dos", "telefono": "5566005566", "consentimiento": "true", "respuestas": "[]"})
    PF2 = r.json()["postulacion"]
    client.post(f"/candidatos/{PF2}/presentar-franquiciatario", json={"nombre": "Otro Franquiciatario", "correo": "otro@f.invalid", "enviar_liga": False})
    r = client.patch(f"/candidatos/{PF2}/franquicia", json={"estado": "no_aceptado"})
    check(r.status_code == 200 and r.json()["franquiciaEstado"] == "no_aceptado" and r.json()["activa"] is True, "No aceptado deja la postulación activa para que RH decida")
    r = client.get(f"/candidatos/{PF2}/ficha-presentacion")
    check(r.status_code == 200 and r.content[:4] == b"%PDF", "la ficha PDF funciona también en franquicia (opcional)")

print(f"\n🎉 Fraiche Fase 6 verificada: {OK} comprobaciones OK.")
