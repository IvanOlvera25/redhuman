"""Regresión de Onboarding v2 (2026-09-28). Base desechable y SIN claves externas (modo demo).

    .venv/Scripts/python.exe scripts/verificar_onboarding_v2.py

Fase 1: Plantillas de Onboarding (CRUD en Configuración, jerarquía puesto > empresa > predeterminada, la
configuración aplicada es una COPIA), documentos con estados Pendiente / Por revisar / Aprobado / Rechazado /
No aplica («No aplica» solo RH y con motivo, fuera del porcentaje, no se le pide al candidato) y tareas
Pendiente / Realizada / Cancelada (motivo obligatorio; tres fijas obligatorias que no se cancelan).
"""

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

_dir = tempfile.mkdtemp(prefix="rh_onb2_")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_dir) / "onb2.db").replace("\\", "/")
for k in ("OPENAI_API_KEY", "WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "ANAM_API_KEY", "RESEND_API_KEY"):
    os.environ[k] = ""
os.environ["ADMIN_PASSWORD"] = "prueba-onb2"
os.environ["SEMBRAR_DEMO"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.deps import cuenta_actual, usuario_actual, usuario_decisor  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Cliente, Cuenta, Curso, Expediente, PlantillaOnboarding, TareaOnboarding, Usuario, UsuarioCuenta, Vacante  # noqa: E402
from app.services import onboarding as onb  # noqa: E402
from app.services.configuracion import obtener  # noqa: E402

OK = 0
PDF_MIN = b"%PDF-1.4\n" + b"%" * 600 + b"\n%%EOF\n"


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
    cuenta = Cuenta(nombre="Onboarding v2", nombre_comercial="Empresa O2", razon_social="Empresa O2 SA de CV", estado="Activa")
    otra = Cuenta(nombre="Otra", nombre_comercial="Otra", estado="Activa")
    db.add_all([cuenta, otra])
    db.flush()
    db.add(UsuarioCuenta(usuario_id=admin.id, cuenta_id=cuenta.id))
    db.add(Cliente(cuenta_id=cuenta.id, nombre="Cliente Logística", razon_social="Logística Norte SA", estado="Activo"))
    for v in db.query(Vacante).all():
        v.cuenta_id = cuenta.id
    curso = Curso(codigo="CUR-ONB", titulo="Inducción general", cuenta_id=cuenta.id, estado="Publicado")
    curso_ajeno = Curso(codigo="CUR-OTRA", titulo="De otra Cuenta", cuenta_id=otra.id)
    db.add_all([curso, curso_ajeno])
    cfg = obtener(db)
    cfg.modo_prueba = False
    db.commit()
    for dep in (usuario_actual, usuario_decisor):
        app.dependency_overrides[dep] = lambda: admin
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- 1. Plantillas de Onboarding (Configuración) ---")
    op = client.get("/onboarding/plantillas/opciones").json()
    check(op["razonesSociales"][0] == "Empresa O2 SA de CV" and "Logística Norte SA" in op["razonesSociales"], "opciones: razones sociales de la Cuenta y de sus Clientes")
    check([t["clave"] for t in op["tareasFijas"]] == ["contrato_firmado", "alta_imss_nomina", "confirmar_ingreso"], "las tres tareas fijas: Contrato firmado, Alta IMSS/nómina, Confirmar ingreso")
    check(op["estadosDocumento"] == ["Pendiente", "Por revisar", "Aprobado", "Rechazado", "No aplica"], "vocabulario de estados de documento")
    check(any(c["titulo"] == "Inducción general" for c in op["cursos"]) and not any(c["titulo"] == "De otra Cuenta" for c in op["cursos"]), "cursos de inducción: solo los de la Cuenta")

    r = client.post("/onboarding/plantillas", json={"nombre": "General", "alcance": "empresa"})
    check(r.status_code == 201 and len(r.json()["documentos"]) == 6, "plantilla de empresa sin documentos = los 6 predeterminados")
    GEN = r.json()["id"]
    check(r.json()["plazos"]["documentos"] == -3 and r.json()["plazos"]["confirmar_ingreso"] == 0, "plazos predeterminados relativos a la fecha de ingreso")
    check(client.post("/onboarding/plantillas", json={"nombre": "Otra general", "alcance": "empresa"}).status_code == 409,
          "no hay dos plantillas activas para el mismo alcance")
    check(client.post("/onboarding/plantillas", json={"nombre": "X", "alcance": "empresa", "empresa": "Inventada SA"}).status_code == 400,
          "la empresa debe ser una razón social configurada (nunca texto libre)")
    check(client.post("/onboarding/plantillas", json={"nombre": "X", "alcance": "puesto"}).status_code == 400, "plantilla de puesto sin puesto → 400")
    check(client.post("/onboarding/plantillas", json={"nombre": "X", "alcance": "planeta"}).status_code == 400, "alcance inválido → 400")
    check(client.post("/onboarding/plantillas", json={"nombre": "X", "alcance": "empresa", "empresa": "Logística Norte SA", "documentos": []}).status_code == 400,
          "una plantilla sin documentos requeridos → 400")
    check(client.post("/onboarding/plantillas", json={"nombre": "X", "alcance": "empresa", "empresa": "Logística Norte SA", "curso_induccion_id": curso_ajeno.id}).status_code == 400,
          "curso de inducción de otra Cuenta → 400")

    r = client.post("/onboarding/plantillas", json={
        "nombre": "Logística", "alcance": "empresa", "empresa": "logística norte sa",
        "documentos": [{"tipo": "Identificación oficial"}, {"tipo": "CURP"}, {"tipo": "Licencia de manejo", "obligatorio": False}, {"tipo": "curp"}],
        "responsables": {"alta_imss_nomina": "Nómina Norte"},
    })
    check(r.status_code == 201 and r.json()["empresa"] == "Logística Norte SA", "la razón social se guarda con su escritura oficial")
    check([d["tipo"] for d in r.json()["documentos"]] == ["Identificación oficial", "CURP", "Licencia de manejo"], "documentos sin duplicados (CURP/curp)")
    LOG = r.json()["id"]

    r = client.post("/onboarding/plantillas", json={
        "nombre": "Chofer", "alcance": "puesto", "puesto": "Chofer repartidor",
        "documentos": [{"tipo": "Identificación oficial"}, {"tipo": "Licencia federal"}, {"tipo": "Carta de no antecedentes", "obligatorio": False}],
        "recursos": [{"nombre": "Unidad asignada", "tipo": "equipo", "responsable": "Flotilla", "dias": -1},
                     {"nombre": "Acceso a la app de rutas", "tipo": "accesos", "responsable": "TI", "dias": 0},
                     {"nombre": "Correo corporativo", "tipo": "raro", "dias": "x"}],
        "responsables": {"contrato_firmado": "Jurídico", "confirmar_ingreso": "Jefe de patio"},
        "plazos": {"contrato_firmado": -2, "documentos": "no-num"},
        "curso_induccion_id": curso.id,
    })
    check(r.status_code == 201, "plantilla de puesto con recursos internos, responsables, plazos y curso")
    CH = r.json()
    check(CH["cursoInduccion"] == "Inducción general", "la plantilla muestra el curso de inducción")
    check([x["tipo"] for x in CH["recursos"]] == ["equipo", "accesos", "otro"] and CH["recursos"][2]["dias"] == 0,
          "recursos normalizados (tipo desconocido → otro, días inválidos → 0)")
    check(CH["plazos"]["contrato_firmado"] == -2 and CH["plazos"]["documentos"] == -3, "plazos: lo capturado se respeta y lo inválido queda en el predeterminado")

    lista = client.get("/onboarding/plantillas").json()
    check([p["nombre"] for p in lista][0] == "Chofer", "el listado muestra primero las de puesto (prevalecen)")

    print("\n--- 2. Jerarquía: puesto > empresa > predeterminada ---")
    r = client.get("/onboarding/plantillas/resolver", params={"puesto": "chofer  REPARTIDOR", "empresa": "Empresa O2 SA de CV"}).json()
    check(r["origen"] == "puesto" and r["plantilla"] == "Chofer", "la plantilla de PUESTO prevalece (sin distinguir mayúsculas/espacios)")
    r = client.get("/onboarding/plantillas/resolver", params={"puesto": "Almacenista", "empresa": "Logística Norte SA"}).json()
    check(r["origen"] == "empresa" and r["plantilla"] == "Logística", "sin plantilla de puesto: la de la EMPRESA contratante gana a la general")
    r = client.get("/onboarding/plantillas/resolver", params={"puesto": "Almacenista", "empresa": "Empresa O2 SA de CV"}).json()
    check(r["origen"] == "empresa" and r["plantilla"] == "General", "otra razón social → la plantilla general de la Cuenta")
    client.delete(f"/onboarding/plantillas/{GEN}")
    r = client.get("/onboarding/plantillas/resolver", params={"puesto": "Almacenista"}).json()
    check(r["origen"] == "predeterminada" and len(r["documentos"]) == 6, "sin plantilla activa → configuración predeterminada")
    check(all(p["id"] != GEN for p in client.get("/onboarding/plantillas").json()), "«eliminar» = desactivar (sale del listado)")
    check(any(p["id"] == GEN for p in client.get("/onboarding/plantillas", params={"incluir_inactivas": True}).json()), "…pero sigue existiendo (baja lógica)")
    r = client.patch(f"/onboarding/plantillas/{GEN}", json={"activa": True})
    check(r.status_code == 200 and r.json()["activa"], "se puede reactivar")
    check(client.patch(f"/onboarding/plantillas/{LOG}", json={"empresa": ""}).status_code == 409, "editar hacia un alcance ya ocupado → 409")
    check(client.get(f"/onboarding/plantillas/{LOG}").json()["empresa"] == "Logística Norte SA", "…y la edición rechazada no dejó cambios a medias")
    app.dependency_overrides[cuenta_actual] = lambda: otra
    check(client.get(f"/onboarding/plantillas/{LOG}").status_code == 404, "otra Cuenta no ve las plantillas (404)")
    check(client.get("/onboarding/plantillas").json() == [], "…ni en su listado")
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- 3. La configuración aplicada es una COPIA ---")
    cfg_p = onb.configuracion_para(db, cuenta.id, "Chofer repartidor", "")
    cfg_p["documentos"].append({"tipo": "Solo para esta persona", "obligatorio": True})
    cfg_p["recursos"].pop()
    db.expire_all()
    check(len(db.get(PlantillaOnboarding, CH["id"]).documentos) == 3 and len(db.get(PlantillaOnboarding, CH["id"]).recursos) == 3,
          "cambiar la selección de una persona no altera la plantilla")

    print("\n--- 4. Documentos: Pendiente / Por revisar / Aprobado / Rechazado / No aplica ---")
    vac = client.get("/vacantes").json()[0]
    r = client.post("/candidatos", json={"nombre": "Jorge Pérez", "telefono": "5511112222", "correo": "jorge@correo.mx", "vacante": vac["id"], "consentimiento": True, "fuente": "RH"})
    P = r.json()["id"]
    EXP = client.patch(f"/candidatos/{P}/etapa", json={"etapa": "Contratación", "manual": True}).json()["expedienteId"]
    e = db.get(Expediente, EXP)
    docs = {d["nombre"]: d for d in client.get(f"/contratacion/expedientes/{EXP}").json()["documentos"]}
    check(all(d["estadoOnboarding"] == "Pendiente" for d in docs.values()), "al abrir el expediente todos los documentos están «Pendiente»")

    client.post(f"/contratacion/expedientes/{EXP}/documentos", data={"tipo": "CURP"}, files={"archivo": ("curp.pdf", PDF_MIN, "application/pdf")})
    d = {x["nombre"]: x for x in client.get(f"/contratacion/expedientes/{EXP}").json()["documentos"]}["CURP"]
    check(d["estadoOnboarding"] == "Por revisar", f"un documento subido sin revisión de RH queda «Por revisar» ({d['estado']})")
    r = client.post(f"/contratacion/expedientes/{EXP}/documentos/estado", json={"tipo": "CURP", "estado": "aprobado"})
    d = {x["nombre"]: x for x in r.json()["documentos"]}["CURP"]
    check(d["estado"] == "recibido" and d["estadoOnboarding"] == "Aprobado", "RH lo aprueba (alias «aprobado» → recibido) = «Aprobado»")
    r = client.post(f"/contratacion/expedientes/{EXP}/documentos/estado", json={"tipo": "Comprobante de domicilio", "estado": "rechazado", "notas": "Ilegible"})
    check({x["nombre"]: x for x in r.json()["documentos"]}["Comprobante de domicilio"]["estadoOnboarding"] == "Rechazado", "«Rechazado»")
    check(client.post(f"/contratacion/expedientes/{EXP}/documentos/estado", json={"tipo": "Número de Seguridad Social", "estado": "aprobado"}).status_code == 409,
          "aprobar sin archivo ni entrega física → 409 (igual que antes)")

    antes = db.get(Expediente, EXP)
    db.refresh(antes)
    progreso_antes = antes.progreso
    r = client.post(f"/contratacion/expedientes/{EXP}/documentos/estado", json={"tipo": "Cuenta bancaria / CLABE", "estado": "no_aplica"})
    check(r.status_code == 400 and "motivo" in r.json()["detail"], "«No aplica» sin motivo → 400")
    r = client.post(f"/contratacion/expedientes/{EXP}/documentos/estado", json={"tipo": "Cuenta bancaria / CLABE", "estado": "No aplica", "motivo": "Se le paga con cuenta de nómina existente"})
    d = {x["nombre"]: x for x in r.json()["documentos"]}["Cuenta bancaria / CLABE"]
    check(r.status_code == 200 and d["estadoOnboarding"] == "No aplica" and d["motivoNoAplica"].startswith("Se le paga") and d["noAplicaPor"] == admin.nombre,
          "RH marca «No aplica» con motivo y queda quién lo decidió")
    db.refresh(antes)
    check(antes.progreso > progreso_antes and "Cuenta bancaria / CLABE" not in antes.pendientes,
          f"«No aplica» sale del porcentaje y de los pendientes ({progreso_antes} % → {antes.progreso} %)")
    tok = antes.token
    if tok:
        pub = client.get(f"/expedientes/publica/{tok}").json()
        check(all(x["tipo"] != "Cuenta bancaria / CLABE" for x in pub["documentos"]), "la liga del candidato no le pide un documento «No aplica»")
        r = client.post(f"/expedientes/publica/{tok}/documentos", data={"tipo": "Cuenta bancaria / CLABE"}, files={"archivo": ("c.pdf", PDF_MIN, "application/pdf")})
        check(r.status_code == 409, "el candidato no puede subir a un documento «No aplica»")
    from app.routers.contratacion import documento_para_adjunto  # noqa: E402

    db.refresh(antes)
    destino = documento_para_adjunto(db, antes, "mi clabe", "estado_cuenta.pdf")
    check(destino.tipo != "Cuenta bancaria / CLABE", f"un adjunto de WhatsApp nunca cae en un documento «No aplica» (→ {destino.tipo})")
    db.rollback()
    r = client.post(f"/contratacion/expedientes/{EXP}/documentos/estado", json={"tipo": "Cuenta bancaria / CLABE", "estado": "pendiente"})
    d = {x["nombre"]: x for x in r.json()["documentos"]}["Cuenta bancaria / CLABE"]
    check(d["estadoOnboarding"] == "Pendiente" and d["motivoNoAplica"] == "", "RH puede volver a pedirlo: regresa a «Pendiente» y se limpia el motivo")

    print("\n--- 5. Tareas: Pendiente / Realizada / Cancelada ---")
    db.expire_all()
    e = db.get(Expediente, EXP)
    e.fecha_ingreso = datetime(2026, 10, 12, tzinfo=timezone.utc)
    db.commit()
    cfg_p = onb.configuracion_para(db, cuenta.id, "Chofer repartidor", "")
    tareas = onb.generar_tareas(db, e, cuenta.id, cfg_p, admin.nombre)
    db.commit()
    check([t.clave for t in tareas[:3]] == ["contrato_firmado", "alta_imss_nomina", "confirmar_ingreso"] and all(t.fija and t.obligatoria for t in tareas[:3]),
          "se generan las tres tareas fijas y obligatorias")
    check(len(tareas) == 6 and tareas[3].nombre == "Unidad asignada", "más una tarea por cada recurso interno de la plantilla")
    fija = {t.clave: t for t in tareas}
    check(fija["contrato_firmado"].responsable == "Jurídico" and fija["confirmar_ingreso"].responsable == "Jefe de patio", "responsables por defecto de la plantilla")
    check(fija["contrato_firmado"].fecha_limite.date() == datetime(2026, 10, 10).date(), "plazo relativo: contrato 2 días antes del ingreso")
    check(tareas[3].fecha_limite.date() == datetime(2026, 10, 11).date(), "plazo relativo del recurso: 1 día antes")
    check(len(onb.generar_tareas(db, e, cuenta.id, cfg_p, admin.nombre)) == 6, "generar de nuevo es idempotente (no duplica)")

    r = client.get(f"/onboarding/expedientes/{EXP}/tareas").json()
    check(len(r) == 6 and r[0]["estado"] == "pendiente", "GET tareas del expediente")
    T_REC = r[3]["id"]
    T_CONTRATO = r[0]["id"]
    T_IMSS = r[1]["id"]
    r = client.patch(f"/onboarding/tareas/{T_REC}", json={"estado": "cancelada"})
    check(r.status_code == 400 and "motivo" in r.json()["detail"], "cancelar sin motivo → 400")
    r = client.patch(f"/onboarding/tareas/{T_REC}", json={"estado": "cancelada", "motivo": "Usará su propio vehículo"})
    check(r.status_code == 200 and r.json()["estado"] == "cancelada" and r.json()["canceladaPor"] == admin.nombre, "cancelada con motivo y quién")
    r = client.patch(f"/onboarding/tareas/{T_REC}", json={"estado": "pendiente"})
    check(r.json()["estado"] == "pendiente" and r.json()["motivoCancelacion"] == "", "se puede reabrir (queda en bitácora)")
    r = client.patch(f"/onboarding/tareas/{T_IMSS}", json={"estado": "cancelada", "motivo": "x"})
    check(r.status_code == 409 and "fija" in r.json()["detail"], "una tarea fija no se cancela por separado")
    r = client.patch(f"/onboarding/tareas/{T_CONTRATO}", json={"estado": "realizada"})
    check(r.status_code == 409 and "contrato firmado" in r.json()["detail"].lower(), "«Contrato firmado» no se marca a mano: exige cargar el contrato firmado")
    r = client.patch(f"/onboarding/tareas/{T_IMSS}", json={"estado": "realizada"})
    check(r.json()["estado"] == "realizada" and r.json()["realizadaPor"] == admin.nombre, "«Alta IMSS / nómina» realizada con quién")
    check(client.patch(f"/onboarding/tareas/{T_IMSS}", json={"estado": "lista"}).status_code == 400, "estado inválido → 400")
    r = client.post(f"/onboarding/expedientes/{EXP}/tareas", json={"nombre": "Uniforme talla M", "tipo": "equipo", "dias": -5})
    check(r.status_code == 201 and r.json()["fechaLimite"].startswith("2026-10-07"), "tarea adicional solo para esta persona con su plazo")
    check(client.post(f"/onboarding/expedientes/{EXP}/tareas", json={"nombre": "uniforme talla m"}).status_code == 409, "sin tareas duplicadas")
    check(len(db.get(PlantillaOnboarding, CH["id"]).recursos) == 3, "…y la plantilla sigue intacta")

    print("\n--- 6. Plazos: recálculo y atraso ---")
    db.expire_all()
    e = db.get(Expediente, EXP)
    e.fecha_ingreso = datetime(2026, 10, 19, tzinfo=timezone.utc)
    n = onb.recalcular_fechas(db, e)
    db.commit()
    t = {x.clave: x for x in onb.tareas_de(db, e)}
    check(t["contrato_firmado"].fecha_limite.date() == datetime(2026, 10, 17).date(), "al cambiar la fecha de ingreso se recalculan los plazos pendientes")
    check(t["alta_imss_nomina"].fecha_limite.date() == datetime(2026, 10, 12).date() and n >= 1, "…pero no los de tareas ya realizadas")
    vieja = TareaOnboarding(cuenta_id=cuenta.id, expediente_id=EXP, clave="otra", nombre="Vencida", fecha_limite=datetime.now(timezone.utc) - timedelta(days=2))
    db.add(vieja)
    db.commit()
    check(onb.atrasada(vieja) and not onb.atrasada(t["alta_imss_nomina"]), "una pendiente vencida es «atrasada»; una realizada nunca")
    app.dependency_overrides[cuenta_actual] = lambda: otra
    check(client.get(f"/onboarding/expedientes/{EXP}/tareas").status_code == 404, "otra Cuenta no ve las tareas (404)")
    check(client.patch(f"/onboarding/tareas/{T_REC}", json={"estado": "realizada"}).status_code == 404, "…ni las modifica")
    app.dependency_overrides[cuenta_actual] = lambda: cuenta

    print("\n--- 7. Sin tocar la etapa (B5) ---")
    etapa = client.get(f"/candidatos/{P}").json()
    check(etapa.get("etapa") == "Contratación", f"nada de lo anterior movió la etapa ({etapa.get('etapa')})")

    db.close()

print(f"\n🎉 Onboarding v2 — Fase 1: {OK} verificaciones OK")
