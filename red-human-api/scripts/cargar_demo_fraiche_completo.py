"""Demo Fraiche · complemento (2026-09-30): datos ficticios para TODOS los módulos de la plataforma.

`cargar_demo_fraiche.py` deja reclutamiento (vacantes, candidatos, evaluaciones, tablero). Este script corre
DESPUÉS y completa el resto para poder probar toda la funcionalidad con una sola Cuenta:

  - Roster de colaboradores (base maestra) con áreas, puestos, jefes, sedes y una baja.
  - Entrevistas humanas (agendadas, realizadas, canceladas), chats de WhatsApp en la ficha, notificaciones y bitácora.
  - Onboarding v2: plantilla por empresa, expedientes con tareas (realizadas / pendientes / atrasadas / canceladas),
    documentos en todos los estados, un contrato firmado interno y un «No ingresó».
  - Capacitación: cursos (Instructor IA y autoguiado, Publicados y Borrador) con módulos y evaluación; asignaciones a
    colaboradores, candidatos y externos en pendiente / en curso / completado (aprobado y no aprobado).
  - Desempeño v2: plantilla de criterios, una evaluación cerrada (con brechas confirmadas, fortalezas y acciones),
    una en curso (mezcla de personas) y un borrador.
  - Clima v2: plantilla, una medición cerrada con respuestas anónimas y análisis, una abierta con participación parcial
    y un borrador.
  - Base de Conocimiento: documentos publicados (uno restringido por área), un borrador y consultas de ejemplo.
  - Catálogo: pruebas psicométricas adicionales, plantilla de desempeño y de clima, configuración (Modo Prueba apagado).
  - La Cuenta Fraiche queda como predeterminada de los usuarios que la ven (Administradores y usuarios demo).

Reglas: nombres y correos ficticios (@demo.invalid), CERO comunicaciones (variables de proveedores vaciadas antes de
importar la app; los embeddings de conocimiento se indexan en modo léxico), idempotente (segunda corrida no duplica)
y no toca ninguna otra Cuenta.

Uso (desde red-human-api/, con DATABASE_URL apuntando a la base destino):
    .venv/bin/python scripts/cargar_demo_fraiche_completo.py            → simulacro (rollback)
    .venv/bin/python scripts/cargar_demo_fraiche_completo.py --ejecutar → guarda
"""

import argparse
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

for _k in ("WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "RESEND_API_KEY", "OPENAI_API_KEY", "ANAM_API_KEY",
           "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET", "DROPBOX_SIGN_API_KEY"):
    os.environ[_k] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.migraciones import sincronizar  # noqa: E402
from app.models import (  # noqa: E402
    DOCUMENTOS_BASE, TIPO_CONTRATO_FIRMADO, AccionDesempeno, AsignacionCurso, Bitacora, Candidato, CicloDesempeno, Colaborador,
    ConfiguracionSistema, ConsultaConocimiento, Cuenta, Curso, Documento, DocumentoConocimiento, EntrevistaHumana, EvaluacionDesempeno,
    Expediente, MedicionClima, Mensaje, ModuloCurso, NotificacionEnviada, ParticipacionClima, PlantillaClima, PlantillaDesempeno,
    PlantillaOnboarding, Postulacion, PruebaPsicometrica, RespuestaClima, TareaOnboarding, Usuario, UsuarioCuenta, registrar,
)
from app.routers.clima import normalizar_cuestionario  # noqa: E402
from app.routers.desempeno import normalizar_brechas  # noqa: E402
from app.services import desempeno_calculo as calc  # noqa: E402
from app.services import onboarding as onb  # noqa: E402
from app.services import rag  # noqa: E402

AHORA = datetime.now(timezone.utc)
CUENTA_SLUG = "fraiche"
RH = "Reclutador Fraiche"
COORD = "Coordinación de Reclutamiento"


class Marcador:
    def __init__(self):
        self.creados, self.existentes = {}, {}

    def nuevo(self, tipo):
        self.creados[tipo] = self.creados.get(tipo, 0) + 1

    def existe(self, tipo):
        self.existentes[tipo] = self.existentes.get(tipo, 0) + 1

    def resumen(self):
        tipos = sorted(set(self.creados) | set(self.existentes))
        return "\n".join(f"  {t:<24} creados {self.creados.get(t, 0):>4}   ya existían {self.existentes.get(t, 0):>4}" for t in tipos)


MK = Marcador()


def hace(**kw) -> datetime:
    return AHORA - timedelta(**kw)


def en(**kw) -> datetime:
    return AHORA + timedelta(**kw)


# ============================================================
# 0) Cuenta, usuarios y configuración
# ============================================================


def cuenta_y_usuarios(db):
    cuenta = db.query(Cuenta).filter(Cuenta.slug == CUENTA_SLUG).first()
    if cuenta is None:
        raise SystemExit("La Cuenta «fraiche» no existe: corre primero scripts/cargar_demo_fraiche.py --ejecutar")
    us = {u.correo: u for u in db.query(Usuario).all()}
    recl = us.get("reclutador@fraiche.demo")
    coord = us.get("coordinacion@fraiche.demo")
    med = us.get("medico.autorizado@fraiche.demo")
    if not (recl and coord and med):
        raise SystemExit("Faltan los usuarios demo: corre primero scripts/cargar_demo_fraiche.py --ejecutar")
    # Cuenta predeterminada = Fraiche para quien la ve (así el dashboard abre con datos)
    for uc in db.query(UsuarioCuenta).filter(UsuarioCuenta.cuenta_id == cuenta.id).all():
        u = db.get(Usuario, uc.usuario_id)
        if u and u.cuenta_predeterminada_id != cuenta.id:
            u.cuenta_predeterminada_id = cuenta.id
            MK.nuevo("cuenta_predeterminada")
    if not recl.telefono:
        recl.telefono, coord.telefono, med.telefono = "5570000001", "5570000002", "5570000003"
    cfg = db.query(ConfiguracionSistema).first()
    if cfg is None:
        cfg = ConfiguracionSistema()
        db.add(cfg)
    cfg.modo_prueba = False
    cuenta.correo_comunicacion = cuenta.correo_comunicacion or "reclutamiento@fraiche.demo"
    db.flush()
    return cuenta, recl, coord, med


# ============================================================
# 1) Roster de colaboradores (base maestra)
# ============================================================

# (nombre, puesto, area, sede, jefe_nombre, meses_antiguedad, correo_usuario_jefe)
ROSTER = [
    ("Patricia Nolasco Rivera", "Gerente de Operaciones", "Operaciones", "Oficinas centrales", None, 60),
    ("Rodrigo Elizondo Paz", "Coordinador de Capacitación", "Recursos Humanos", "Oficinas centrales", "Patricia Nolasco Rivera", 36),
    ("Marisol Aguirre Tena", "Encargada de tienda", "Ventas en tienda", "Coyoacán", "Patricia Nolasco Rivera", 30),
    ("Julio César Bravo Ledesma", "Encargado de tienda", "Ventas en tienda", "Santa Fe", "Patricia Nolasco Rivera", 26),
    ("Daniela Ochoa Vidal", "Demostradora", "Ventas en tienda", "Coyoacán", "Marisol Aguirre Tena", 14),
    ("Kevin Salazar Ibarra", "Demostrador", "Ventas en tienda", "Coyoacán", "Marisol Aguirre Tena", 9),
    ("Brenda Quiroz Mena", "Demostradora", "Ventas en tienda", "Santa Fe", "Julio César Bravo Ledesma", 20),
    ("Ximena Padilla Roldán", "Cajera", "Ventas en tienda", "Santa Fe", "Julio César Bravo Ledesma", 7),
    ("Óscar Villanueva Cano", "Cajero", "Ventas en tienda", "Coyoacán", "Marisol Aguirre Tena", 4),
    ("Tania Beltrán Sosa", "Almacenista", "Almacén", "CEDIS Vallejo", "Patricia Nolasco Rivera", 18),
    ("Gerardo Lugo Peralta", "Almacenista", "Almacén", "CEDIS Vallejo", "Patricia Nolasco Rivera", 11),
    ("Alejandra Muñiz Corona", "Analista de Nómina", "Recursos Humanos", "Oficinas centrales", "Rodrigo Elizondo Paz", 22),
    ("Iván Cordero Peña", "Demostrador", "Ventas en tienda", "Santa Fe", "Julio César Bravo Ledesma", 3),
    ("Lucía Ferrer Ordaz", "Cajera", "Ventas en tienda", "Coyoacán", "Marisol Aguirre Tena", 15),
]
SUELDOS = {"Gerente de Operaciones": "$38,000 MXN mensuales", "Coordinador de Capacitación": "$24,000 MXN mensuales", "Encargada de tienda": "$18,500 MXN mensuales",
           "Encargado de tienda": "$18,500 MXN mensuales", "Demostradora": "$11,500 MXN mensuales", "Demostrador": "$11,500 MXN mensuales", "Cajera": "$14,500 MXN mensuales",
           "Cajero": "$14,500 MXN mensuales", "Almacenista": "$12,800 MXN mensuales", "Analista de Nómina": "$21,000 MXN mensuales"}


def colaboradores(db, cuenta: Cuenta) -> dict:
    existentes = {c.nombre: c for c in db.query(Colaborador).filter(Colaborador.cuenta_id == cuenta.id).all()}
    salida = {}
    for i, (nombre, puesto, area, sede, jefe, meses) in enumerate(ROSTER, start=1):
        c = existentes.get(nombre)
        if c is None:
            ingreso = hace(days=30 * meses)
            c = Colaborador(codigo="TMP", cuenta_id=cuenta.id, nombre=nombre, correo=f"{nombre.split()[0].lower()}.{nombre.split()[1].lower()}@demo.invalid".replace("ó", "o").replace("á", "a").replace("é", "e").replace("í", "i").replace("ú", "u").replace("ñ", "n"),
                            telefono=f"55{80000000 + i:08d}", puesto=puesto, area=area, salario=SUELDOS.get(puesto, ""), empresa="Fraiche S.A. de C.V.",
                            tipo_contratacion="Tiempo indeterminado", ubicacion=sede, jefe_directo=jefe or "", fecha_ingreso=ingreso, dado_de_alta_por=RH,
                            condiciones_ingreso={"puesto": puesto, "sueldo": SUELDOS.get(puesto, ""), "tipo_contratacion": "Tiempo indeterminado", "fecha_ingreso": ingreso.isoformat(),
                                                 "ubicacion": sede, "jefe_directo": jefe or "", "empresa": "Fraiche S.A. de C.V.", "alta_por": RH, "alta_en": ingreso.isoformat(), "origen": "carga demo"})
            db.add(c)
            db.flush()
            c.codigo = f"COL-{100 + c.id}"
            registrar(db, RH, "colaborador_alta", "colaborador", c.codigo, {"puesto": puesto, "origen": "carga demo (sin pipeline)"})
            MK.nuevo("colaborador")
        else:
            MK.existe("colaborador")
        salida[nombre] = c
    for nombre, _p, _a, _s, jefe, _m in ROSTER:
        if jefe and salida[nombre].jefe_id is None:
            salida[nombre].jefe_id = salida[jefe].id
    # una baja reversible (aparece con el filtro de inactivos)
    baja = salida["Iván Cordero Peña"]
    if baja.activo:
        baja.activo, baja.baja_en, baja.baja_motivo, baja.baja_por = False, hace(days=5), "Renuncia voluntaria (cambio de residencia)", RH
        registrar(db, RH, "colaborador_baja", "colaborador", baja.codigo, {"motivo": baja.baja_motivo})
        MK.nuevo("baja_colaborador")
    db.flush()
    return salida


# ============================================================
# 2) Reclutamiento: entrevistas humanas, chats, notificaciones
# ============================================================


def _postulaciones(db, cuenta: Cuenta):
    return db.query(Postulacion).filter(Postulacion.cuenta_id == cuenta.id).order_by(Postulacion.id).all()


CHAT_WHATSAPP = [
    ("assistant", "Hola, soy Red Human, el asistente de reclutamiento de Fraiche. Vi tu postulación para la vacante de {vacante}. Antes de continuar necesito tu consentimiento para tratar tus datos conforme a nuestro aviso de privacidad. ¿Aceptas? (Sí / No)"),
    ("user", "Sí, acepto."),
    ("assistant", "Gracias. ¿Cuánto tiempo trabajaste en tu empleo más reciente?"),
    ("user", "Dos años, en una tienda de conveniencia."),
    ("assistant", "¿Cuál era tu puesto?"),
    ("user", "Cajera y a veces apoyaba en piso de venta."),
    ("assistant", "¿A partir de cuándo podrías iniciar?"),
    ("user", "La próxima semana sin problema."),
    ("assistant", "Última pregunta, es solo informativa: ¿tienes algún adeudo con BBVA? Sí / No"),
    ("user", "No."),
    ("assistant", "Perfecto, ya tengo lo necesario. Una persona del equipo de reclutamiento revisará tus respuestas y te contactará por este medio. ¡Gracias por tu tiempo!"),
]


def reclutamiento(db, cuenta: Cuenta, recl: Usuario, coord: Usuario):
    posts = _postulaciones(db, cuenta)
    if not posts:
        return
    # chats de WhatsApp en las postulaciones que ya pasaron el filtro (solo si no tienen mensajes)
    n_chat = 0
    if any(p.mensajes for p in posts):
        n_chat = 99  # ya se cargaron chats en una corrida anterior
        MK.existe("chat_whatsapp")
    for p in posts:
        if p.prefiltro_completo and p.vacante and not p.mensajes and n_chat < 12:
            base = p.creado_en or hace(days=5)
            for i, (rol, texto) in enumerate(CHAT_WHATSAPP):
                db.add(Mensaje(candidato_id=p.candidato_id, postulacion_id=p.id, rol=rol, texto=texto.format(vacante=p.vacante.titulo), canal="whatsapp",
                               creado_en=base + timedelta(minutes=2 * i)))
            p.candidato.wa_id = p.candidato.wa_id or f"52{p.candidato.telefono}"
            p.candidato.wa_nombre = p.candidato.wa_nombre or p.candidato.nombre.split()[0]
            n_chat += 1
            MK.nuevo("chat_whatsapp")
    # entrevistas humanas: agendadas (interna y externa), realizada con resultado, cancelada
    en_humana = [p for p in posts if p.etapa in ("Entrevista Humana", "Evaluación") and p.activa]
    plan = [
        dict(entrevistador=coord.nombre, tipo="interno", usuario_id=coord.id, fecha=en(days=1, hours=3), modalidad="Videollamada", liga="https://teams.microsoft.com/l/meetup-join/demo-fraiche-001", comentario="Entrevista de seguimiento con Coordinación."),
        dict(entrevistador="Encargado(a) Fraiche Santa Fe", tipo="externo", correo_externo="encargado.santafe@demo.invalid", whatsapp_externo="5570000009", fecha=en(days=2), modalidad="Presencial", ubicacion="Tienda Fraiche Santa Fe", comentario="Entrevista en tienda con quien sería su jefe directo."),
        dict(entrevistador=recl.nombre, tipo="interno", usuario_id=recl.id, fecha=hace(days=2), modalidad="Llamada", telefono_contacto="5570000001", realizada=True, resultado="aprobado", recomendacion="avanzar", evaluada_en=hace(days=2, hours=-1), resultado_capturado_por="rh", comentario="Buena actitud, experiencia comprobable en caja."),
        dict(entrevistador=coord.nombre, tipo="interno", usuario_id=coord.id, fecha=hace(days=4), modalidad="Videollamada", liga="https://teams.microsoft.com/l/meetup-join/demo-fraiche-002", cancelada=True, comentario="Cancelada: el candidato pidió reagendar."),
        dict(entrevistador=recl.nombre, tipo="interno", usuario_id=recl.id, fecha=hace(days=1), modalidad="Presencial", ubicacion="Oficinas centrales Fraiche", realizada=True, resultado="no_aprobado", recomendacion="no_avanzar", evaluada_en=hace(hours=20), resultado_capturado_por="entrevistador", comentario="No mostró disponibilidad real para fines de semana."),
    ]
    for p, datos in zip(en_humana, plan):
        if any(not eh.es_ipv for eh in p.entrevistas_humanas):
            MK.existe("entrevista_humana")
            continue
        eh = EntrevistaHumana(candidato_id=p.candidato_id, token=secrets.token_urlsafe(24), **datos)
        p.entrevistas_humanas.append(eh)
        db.add(eh)
        db.flush()
        for tipo, canal, destino in (("candidato", "whatsapp", p.candidato.telefono), ("candidato", "correo", p.candidato.correo), ("entrevistador", "correo", datos.get("correo_externo") or coord.correo)):
            db.add(NotificacionEnviada(cuenta_id=cuenta.id, candidato_id=p.candidato_id, evento="entrevista_agendada", destinatario_tipo=tipo, destino=destino, canal=canal,
                                       enviado=False, detalle="Carga demo: no se envió nada (proveedores desactivados).", creada_en=hace(days=3)))
        registrar(db, recl.nombre, "entrevista_humana_agendada", "postulacion", p.codigo, {"entrevistador": datos["entrevistador"], "modalidad": datos["modalidad"], "demo": True})
        MK.nuevo("entrevista_humana")
    db.flush()


# ============================================================
# 3) Onboarding v2
# ============================================================


def plantilla_onboarding(db, cuenta: Cuenta, curso_induccion_id=None) -> PlantillaOnboarding:
    p = db.query(PlantillaOnboarding).filter(PlantillaOnboarding.cuenta_id == cuenta.id, PlantillaOnboarding.alcance == "empresa", PlantillaOnboarding.activa.is_(True)).first()
    if p:
        MK.existe("plantilla_onboarding")
        if curso_induccion_id and not p.curso_induccion_id:
            p.curso_induccion_id = curso_induccion_id
        return p
    p = PlantillaOnboarding(
        cuenta_id=cuenta.id, nombre="Onboarding Fraiche · tiendas", alcance="empresa", empresa="Fraiche S.A. de C.V.",
        documentos=[{"tipo": t, "obligatorio": True} for t in DOCUMENTOS_BASE] + [{"tipo": "Carta de recomendación laboral", "obligatorio": False}],
        recursos=[{"nombre": "Uniforme y gafete", "tipo": "otro", "responsable": "Encargado(a) de tienda", "dias": -2},
                  {"nombre": "Usuario del punto de venta", "tipo": "accesos", "responsable": "Sistemas", "dias": -1},
                  {"nombre": "Correo corporativo", "tipo": "correo", "responsable": "Sistemas", "dias": 0},
                  {"nombre": "Curso de inducción Fraiche", "tipo": "otro", "responsable": RH, "dias": 3}],
        responsables={"documentos": RH, "contrato_firmado": RH, "alta_imss_nomina": "Alejandra Muñiz Corona", "confirmar_ingreso": "Encargado(a) de tienda"},
        plazos={"documentos": -3, "contrato_firmado": -1, "alta_imss_nomina": 0, "confirmar_ingreso": 0},
        curso_induccion_id=curso_induccion_id, creado_por=RH,
    )
    db.add(p)
    db.flush()
    MK.nuevo("plantilla_onboarding")
    return p


def onboarding(db, cuenta: Cuenta, recl: Usuario, plantilla: PlantillaOnboarding):
    posts = [p for p in _postulaciones(db, cuenta) if p.expediente is not None]
    en_onb = [p for p in posts if p.etapa == "Onboarding"]
    for i, p in enumerate(en_onb):
        e = p.expediente
        if db.query(TareaOnboarding).filter(TareaOnboarding.expediente_id == e.id).count():
            MK.existe("tareas_onboarding")
            continue
        e.plantilla_onboarding_id = plantilla.id
        e.documentos_hasta = e.documentos_hasta or en(days=3)
        cfg = onb.configuracion_para(db, cuenta.id, puesto=e.puesto, empresa=e.empresa)
        onb.aplicar_documentos(db, e, cfg["documentos"])
        tareas = onb.generar_tareas(db, e, cuenta.id, cfg, RH)
        # variedad de estados según la persona
        for t in tareas:
            if t.clave == "confirmar_ingreso" and e.fecha_ingreso_real:
                t.estado, t.realizada_por, t.realizada_en = "realizada", e.ingreso_confirmado_por or RH, e.ingreso_confirmado_en or hace(days=1)
            elif t.clave == "contrato_firmado" and i % 2 == 0:
                t.estado, t.realizada_por, t.realizada_en, t.notas = "realizada", RH, hace(days=2), "Contrato firmado en oficinas (carga demo)."
            elif t.nombre == "Uniforme y gafete":
                t.estado, t.realizada_por, t.realizada_en = "realizada", "Encargado(a) de tienda", hace(days=1)
            elif t.nombre == "Correo corporativo" and i % 2 == 1:
                t.estado, t.cancelada_por, t.cancelada_en, t.motivo_cancelacion = "cancelada", RH, hace(hours=6), "El puesto de tienda no usa correo corporativo."
            elif t.nombre == "Usuario del punto de venta":
                t.fecha_limite = hace(days=1)  # atrasada
        if i % 2 == 0 and not any(d.interno for d in e.documentos):
            db.add(Documento(expediente_id=e.id, tipo=TIPO_CONTRATO_FIRMADO, estado="recibido", obligatorio=False, interno=True, archivo="(demo)", nombre_archivo="contrato-firmado-demo.pdf",
                             mime="application/pdf", revisado_por=RH, subido_en=hace(days=2), recibido_en=hace(days=2), recibido_canal="rh", notas_ia="Contrato firmado cargado por RH (demo)."))
        # documentos en varios estados
        for j, d in enumerate([d for d in e.documentos if not d.interno]):
            if d.estado == "recibido" and d.revisado_por:
                continue
            if j % 4 == 0:
                d.estado, d.archivo, d.nombre_archivo, d.mime, d.subido_en, d.recibido_en, d.recibido_canal, d.notas_ia = "recibido", "(demo)", "documento-demo.pdf", "application/pdf", hace(days=1), hace(days=1), "whatsapp", "Documento legible; validado por Red Human, pendiente de revisión de RH."
            elif j % 4 == 1:
                d.estado, d.archivo, d.nombre_archivo, d.mime, d.subido_en, d.recibido_en, d.recibido_canal, d.revisado_por, d.notas_ia = "recibido", "(demo)", "documento-demo.pdf", "application/pdf", hace(days=2), hace(days=2), "liga", RH, "Aprobado por RH."
            elif j % 4 == 2:
                d.estado, d.archivo, d.nombre_archivo, d.mime, d.subido_en, d.recibido_en, d.recibido_canal, d.notas_ia = "rechazado", "(demo)", "documento-demo.jpg", "image/jpeg", hace(days=1), hace(days=1), "whatsapp", "La imagen está recortada: no se lee la fecha de expedición."
            elif not d.obligatorio:
                d.estado, d.motivo_no_aplica, d.no_aplica_por, d.no_aplica_en = "no_aplica", "No se solicita para puestos operativos de tienda.", RH, hace(days=1)
            d.solicitado_en, d.solicitado_canal, d.solicitudes = hace(days=3), "whatsapp, correo", [{"en": hace(days=3).isoformat(), "canal": "whatsapp, correo", "tipo": "solicitud", "por": RH}]
        e.recordatorios_enviados = 1 if i % 2 else 0
        onb.sincronizar_legado(db, e)
        registrar(db, RH, "onboarding_iniciado", "postulacion", p.codigo, {"plantilla": plantilla.nombre, "demo": True})
        MK.nuevo("tareas_onboarding")
    # «No ingresó»: una postulación en Onboarding que se cierra por no presentarse
    candidata = next((p for p in en_onb if p.activa and p.expediente.estado != "alta" and p.paso == "listo_alta"), None)
    ya = any((p.expediente and p.expediente.no_ingreso_en) for p in posts)
    if candidata and not ya:
        e = candidata.expediente
        e.fecha_ingreso_real, e.ingreso_confirmado_por, e.ingreso_confirmado_en = None, "", None
        for t in db.query(TareaOnboarding).filter(TareaOnboarding.expediente_id == e.id, TareaOnboarding.clave == "confirmar_ingreso").all():
            t.estado, t.realizada_por, t.realizada_en = "pendiente", "", None
        for t in db.query(TareaOnboarding).filter(TareaOnboarding.expediente_id == e.id, TareaOnboarding.estado == "pendiente").all():
            t.estado, t.cancelada_por, t.cancelada_en, t.motivo_cancelacion = "cancelada", RH, hace(hours=3), "La persona no se presentó en la fecha de ingreso."
        e.no_ingreso_en, e.no_ingreso_por, e.no_ingreso_motivo, e.documentos_hasta = hace(hours=3), RH, "No se presentó el día de ingreso y no contestó llamadas.", None
        candidata.cerrar("no_ingreso")
        candidata.historial = list(candidata.historial or []) + [{"evento": "no_ingreso", "texto": "No ingresó: no se presentó el día de ingreso.", "usuario": RH, "fecha": hace(hours=3).isoformat()}]
        registrar(db, RH, "onboarding_no_ingreso", "postulacion", candidata.codigo, {"motivo": e.no_ingreso_motivo})
        MK.nuevo("no_ingreso")
    db.flush()


# ============================================================
# 4) Capacitación
# ============================================================

CURSOS = [
    {
        "titulo": "Inducción Fraiche: quiénes somos y cómo atendemos", "categoria": "Inducción", "modalidad": "instructor_ia", "duracion_texto": "45 min", "duracion_horas": 0.75, "estado": "Publicado", "obligatorio": True,
        "objetivo": "Que toda persona de nuevo ingreso conozca la historia, los valores y el estándar de atención de Fraiche desde su primer día.",
        "contexto": "Curso de inducción para personal de tienda (demostradores, cajeros) y almacén.",
        "modulos": [
            ("Bienvenida a Fraiche", "Hola, bienvenida o bienvenido a Fraiche. En este primer módulo te cuento de dónde venimos: una marca mexicana de fragancias y productos de cuidado personal que crece con sus tiendas y franquicias. ¿Sabías que cada tienda atiende a cientos de clientes al día? Por eso tu papel es clave. Antes de seguir, ¿tienes alguna duda sobre la empresa?",
             "Historia y propósito de Fraiche.", ["Marca mexicana con tiendas propias y franquicias", "Cada persona de tienda representa la marca", "Preguntas bienvenidas en cualquier momento"]),
            ("Nuestros valores en el piso de venta", "Los valores de Fraiche no son un cartel en la pared: se viven en cada atención. Calidez, honestidad y servicio. Te pongo un ejemplo: si un cliente no encuentra su fragancia, lo acompañas, no lo señalas. ¿Cómo aplicarías la calidez con un cliente apurado? Piénsalo un momento y continuamos.",
             "Calidez, honestidad y servicio aplicados a situaciones reales.", ["Acompañar, no señalar", "Honestidad al recomendar productos", "Servicio incluso con clientes apurados"]),
            ("El estándar de atención Fraiche", "El estándar tiene cuatro pasos: saludar en los primeros diez segundos, preguntar qué busca, ofrecer una demostración y cerrar con una recomendación. Practícalo en voz alta conmigo. ¿Qué paso te parece más difícil? Cuéntame y lo trabajamos.",
             "Los cuatro pasos del estándar de atención.", ["Saludar en 10 segundos", "Preguntar qué busca", "Demostrar el producto", "Cerrar con recomendación"]),
        ],
        "evaluacion": [
            {"pregunta": "¿Cuál es el primer paso del estándar de atención Fraiche?", "tipo": "opcion", "opciones": ["Saludar en los primeros diez segundos", "Ofrecer una promoción", "Pedir el correo del cliente", "Revisar inventario"], "correcta": 0, "explicacion": "El estándar inicia con un saludo en los primeros diez segundos."},
            {"pregunta": "Si un cliente no encuentra su fragancia, lo correcto es acompañarlo hasta el producto.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 0, "explicacion": "Acompañar, no señalar, es parte de la calidez Fraiche."},
            {"pregunta": "¿Cuántos pasos tiene el estándar de atención?", "tipo": "opcion", "opciones": ["Dos", "Tres", "Cuatro", "Seis"], "correcta": 2, "explicacion": "Saludar, preguntar, demostrar y cerrar: cuatro pasos."},
            {"pregunta": "La honestidad al recomendar productos es uno de los valores de Fraiche.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 0, "explicacion": "Calidez, honestidad y servicio son los tres valores del módulo."},
        ],
    },
    {
        "titulo": "Manejo de caja y arqueo diario", "categoria": "Operación de tienda", "modalidad": "autoguiado", "duracion_texto": "1 h 30", "duracion_horas": 1.5, "estado": "Publicado", "obligatorio": False,
        "objetivo": "Que el personal de caja realice cobros, devoluciones y el arqueo diario sin diferencias.",
        "contexto": "Curso para cajeros de tiendas propias. Incluye política de devoluciones y cierre de turno.",
        "modulos": [
            ("Apertura de caja", "Al iniciar el turno se cuenta el fondo fijo frente al encargado, se registra en el formato de apertura y se firma. Cualquier diferencia se reporta ANTES de cobrar al primer cliente.", "Conteo y registro del fondo fijo.", ["Contar el fondo con el encargado", "Registrar y firmar la apertura", "Reportar diferencias antes del primer cobro"]),
            ("Cobros y formas de pago", "Se aceptan efectivo, tarjeta y vales. En efectivo se cuenta el billete en voz alta; en tarjeta se verifica el voucher aprobado; los vales se sellan al recibirlos. Nunca se guarda dinero fuera del cajón.", "Reglas por forma de pago.", ["Efectivo en voz alta", "Voucher aprobado", "Vales sellados", "Nada fuera del cajón"]),
            ("Devoluciones y cambios", "Toda devolución requiere ticket y autorización del encargado en el sistema. Se registra el motivo. Los cambios por talla o aroma no requieren autorización si son del mismo precio.", "Política de devoluciones.", ["Ticket obligatorio", "Autorización del encargado", "Registrar motivo"]),
            ("Arqueo y cierre de turno", "Al cerrar se cuenta el efectivo, se compara con el reporte del sistema y se registra el resultado. Una diferencia mayor a $50 se documenta en el formato de incidencias.", "Cierre sin diferencias.", ["Contar y comparar con el sistema", "Documentar diferencias > $50", "Firmar el cierre"]),
        ],
        "evaluacion": [
            {"pregunta": "¿Cuándo se reporta una diferencia en el fondo fijo?", "tipo": "opcion", "opciones": ["Al cierre del turno", "Antes de cobrar al primer cliente", "Al día siguiente", "Solo si es mayor a $500"], "correcta": 1, "explicacion": "La apertura se valida antes del primer cobro."},
            {"pregunta": "Los cambios por aroma del mismo precio requieren autorización del encargado.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 1, "explicacion": "Solo las devoluciones requieren autorización; los cambios del mismo precio no."},
            {"pregunta": "¿A partir de qué monto se documenta una diferencia en el arqueo?", "tipo": "opcion", "opciones": ["$10", "$50", "$100", "$500"], "correcta": 1, "explicacion": "Una diferencia mayor a $50 va al formato de incidencias."},
            {"pregunta": "Los vales se sellan al recibirlos.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 0, "explicacion": "Es la regla para vales en el módulo de cobros."},
            {"pregunta": "Toda devolución requiere ticket.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 0, "explicacion": "El ticket es obligatorio para devolver."},
        ],
    },
    {
        "titulo": "Técnicas de demostración de fragancias", "categoria": "Ventas", "modalidad": "instructor_ia", "duracion_texto": "1 h", "duracion_horas": 1.0, "estado": "Publicado", "obligatorio": False,
        "objetivo": "Aumentar la conversión de demostraciones en venta con una técnica consistente.",
        "contexto": "Para demostradores de tiendas propias y franquicias.",
        "modulos": [
            ("Leer al cliente", "Antes de rociar nada, observa: ¿viene con prisa, busca regalo, ya conoce la marca? Con dos preguntas abiertas identificas qué familia olfativa ofrecer. ¿Qué preguntas usarías tú?", "Diagnóstico en 30 segundos.", ["Observar antes de ofrecer", "Dos preguntas abiertas", "Identificar familia olfativa"]),
            ("La demostración en tres tiempos", "Primero la tira de papel, luego la muñeca, luego dejar respirar. Nunca más de tres fragancias seguidas. Cuéntame cómo cerrarías después de la tercera.", "Tira, muñeca, respirar.", ["Máximo tres fragancias", "Dejar respirar entre cada una", "Cerrar con la favorita"]),
            ("Objeciones frecuentes", "«Está caro», «lo pienso», «no es para mí». Cada una tiene una respuesta honesta: valor por mililitro, presentación pequeña, otra familia. Practiquemos: yo hago de cliente.", "Respuestas a las tres objeciones.", ["Valor por mililitro", "Ofrecer presentación pequeña", "Cambiar de familia olfativa"]),
        ],
        "evaluacion": [
            {"pregunta": "¿Cuántas fragancias como máximo se demuestran seguidas?", "tipo": "opcion", "opciones": ["Una", "Dos", "Tres", "Cinco"], "correcta": 2, "explicacion": "Más de tres satura el olfato del cliente."},
            {"pregunta": "La demostración empieza directamente en la muñeca del cliente.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 1, "explicacion": "Primero la tira de papel."},
            {"pregunta": "Ante «está caro», la respuesta sugerida es hablar del valor por mililitro.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 0, "explicacion": "Es la respuesta honesta del módulo de objeciones."},
        ],
    },
    {
        "titulo": "Recepción y acomodo de mercancía en almacén", "categoria": "Almacén", "modalidad": "autoguiado", "duracion_texto": "50 min", "duracion_horas": 0.85, "estado": "Borrador", "obligatorio": False,
        "objetivo": "Estandarizar la recepción, el conteo y el acomodo PEPS de la mercancía.",
        "contexto": "Borrador pendiente de revisión por el Coordinador de Capacitación.",
        "modulos": [
            ("Recepción contra factura", "Se cuenta cada caja contra la factura y se anota cualquier faltante en el mismo documento antes de firmar.", "Contar antes de firmar.", ["Cotejar contra factura", "Anotar faltantes", "Firmar al final"]),
            ("Acomodo PEPS", "Primeras entradas, primeras salidas: lo nuevo atrás, lo anterior al frente. Se rotula cada tarima con fecha de recepción.", "Rotación de inventario.", ["Lo nuevo atrás", "Rotular con fecha", "Revisar caducidades"]),
        ],
        "evaluacion": [
            {"pregunta": "PEPS significa que lo más nuevo se coloca al frente.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 1, "explicacion": "Lo nuevo va atrás para que salga primero lo anterior."},
            {"pregunta": "Los faltantes se anotan en la factura antes de firmar.", "tipo": "vf", "opciones": ["Verdadero", "Falso"], "correcta": 0, "explicacion": "Así queda evidencia frente al proveedor."},
        ],
    },
]


def cursos(db, cuenta: Cuenta, coord: Usuario) -> dict:
    existentes = {c.titulo: c for c in db.query(Curso).filter(Curso.cuenta_id == cuenta.id).all()}
    salida = {}
    for datos in CURSOS:
        c = existentes.get(datos["titulo"])
        if c is None:
            c = Curso(codigo="TMP", cuenta_id=cuenta.id, titulo=datos["titulo"], categoria=datos["categoria"], duracion_horas=datos["duracion_horas"], modalidad=datos["modalidad"],
                      duracion_texto=datos["duracion_texto"], objetivo=datos["objetivo"], estado=datos["estado"], obligatorio=datos["obligatorio"], creado_por="Rodrigo Elizondo Paz",
                      contexto=datos["contexto"], evaluacion=datos["evaluacion"], calificacion_minima=70, creado_en=hace(days=20))
            db.add(c)
            db.flush()
            c.codigo = f"CUR-{100 + c.id}"
            for i, (titulo, contenido, resumen, puntos) in enumerate(datos["modulos"], start=1):
                db.add(ModuloCurso(curso_id=c.id, orden=i, titulo=titulo, contenido=contenido, resumen=resumen, puntos_clave=puntos,
                                   preguntas_verificacion=[f"¿Qué te llevas del módulo «{titulo}»?"]))
            registrar(db, "Rodrigo Elizondo Paz", "curso_creado", "curso", c.codigo, {"modalidad": c.modalidad, "demo": True})
            MK.nuevo("curso")
        else:
            MK.existe("curso")
        salida[datos["titulo"]] = c
    db.flush()
    return salida


def _asignacion(db, curso: Curso, tipo: str, estado: str, **campos) -> AsignacionCurso:
    a = AsignacionCurso(codigo="TMP", curso_id=curso.id, tipo=tipo, token=secrets.token_urlsafe(24), asignado_por="Rodrigo Elizondo Paz", asignado_en=hace(days=10), **campos)
    db.add(a)
    db.flush()
    a.codigo = f"ASIG-{5000 + a.id}"
    total_mod = len(curso.modulos)
    if estado in ("en_curso", "completado", "reprobado"):
        a.iniciado_en = hace(days=8)
        a.estado = "en_curso"
        a.modulo_actual = max(1, total_mod - 1) if estado == "en_curso" else total_mod
        a.transcript = [{"modulo": 1, "rol": "user", "texto": "¿Puedes repetir el último punto?"}, {"modulo": 1, "rol": "assistant", "texto": "Claro: el punto clave es contar el fondo con el encargado antes del primer cobro."}] if curso.modalidad == "instructor_ia" else []
    if estado in ("completado", "reprobado"):
        preguntas = curso.evaluacion or []
        aprobar = estado == "completado"
        respuestas = []
        for i, q in enumerate(preguntas):
            ok = aprobar or (i % 2 == 0 and False)
            elegida = int(q["correcta"]) if ok else (int(q["correcta"]) + 1) % len(q["opciones"])
            respuestas.append({"indice": i, "respuesta": elegida, "correcta": elegida == int(q["correcta"])})
        aciertos = sum(1 for r in respuestas if r["correcta"])
        calif = round(aciertos / len(preguntas) * 100) if preguntas else 0
        a.calificacion, a.aprobado, a.estado, a.completado_en = calif, calif >= (curso.calificacion_minima or 70), "completado", hace(days=6)
        a.resultado_evaluacion = {"respuestas": respuestas, "aciertos": aciertos, "total": len(preguntas), "calificacion": calif, "aprobado": a.aprobado, "minimo": curso.calificacion_minima}
        if a.tipo == "candidato" and a.postulacion is not None:
            p = a.postulacion
            an = dict(p.analisis or {})
            an["capacitacion"] = [x for x in (an.get("capacitacion") or []) if x.get("curso") != curso.codigo] + [{"curso": curso.codigo, "titulo": curso.titulo, "calificacion": calif, "aprobado": a.aprobado, "fecha": a.completado_en.isoformat(), "asignacion": a.codigo}]
            p.analisis = an
        registrar(db, a.nombre_persona or "persona", "curso_completado", "asignacion_curso", a.codigo, {"curso": curso.codigo, "tipo": a.tipo, "calificacion": calif, "aprobado": a.aprobado})
    MK.nuevo("asignacion_curso")
    return a


def asignaciones(db, cuenta: Cuenta, curs: dict, cols: dict):
    if db.query(AsignacionCurso).join(Curso).filter(Curso.cuenta_id == cuenta.id).count():
        MK.existe("asignacion_curso")
        return
    ind, caja, demo = curs["Inducción Fraiche: quiénes somos y cómo atendemos"], curs["Manejo de caja y arqueo diario"], curs["Técnicas de demostración de fragancias"]
    plan_col = [
        (ind, "Óscar Villanueva Cano", "completado"), (ind, "Ximena Padilla Roldán", "completado"), (ind, "Kevin Salazar Ibarra", "en_curso"), (ind, "Gerardo Lugo Peralta", "pendiente"),
        (caja, "Óscar Villanueva Cano", "reprobado"), (caja, "Ximena Padilla Roldán", "en_curso"), (caja, "Lucía Ferrer Ordaz", "completado"),
        (demo, "Daniela Ochoa Vidal", "completado"), (demo, "Kevin Salazar Ibarra", "pendiente"), (demo, "Brenda Quiroz Mena", "en_curso"),
    ]
    for curso, nombre, estado in plan_col:
        _asignacion(db, curso, "colaborador", estado, colaborador_id=cols[nombre].id)
    # candidatos en proceso (curso filtro / inducción anticipada)
    posts = [p for p in _postulaciones(db, cuenta) if p.activa and p.etapa in ("Evaluación", "Entrevista Humana", "Contratación")][:3]
    for p, estado in zip(posts, ("completado", "en_curso", "pendiente")):
        _asignacion(db, demo if "Demostrador" in (p.vacante.titulo if p.vacante else "") else ind, "candidato", estado, postulacion_id=p.id)
    # externos (franquicia)
    _asignacion(db, demo, "externo", "completado", externo_nombre="Personal Franquicia 002 · Paola Reyna", externo_correo="paola.reyna@demo.invalid", externo_telefono="5570000021", externo_organizacion="Franquicia 002")
    _asignacion(db, demo, "externo", "pendiente", externo_nombre="", externo_correo="nuevo.ingreso@demo.invalid", externo_organizacion="Franquicia 003")
    db.flush()


# ============================================================
# 5) Desempeño v2
# ============================================================

CRITERIOS_TIENDA = [
    {"id": "c1", "tipo": "medible", "nombre": "Ventas contra meta mensual", "descripcion": "Venta neta de la persona contra su meta", "unidad": "MXN", "meta": 180000, "sentido": "mayor_es_mejor", "peso": 35},
    {"id": "c2", "tipo": "medible", "nombre": "Conversión de demostraciones", "descripcion": "Demostraciones que terminan en venta", "unidad": "%", "meta": 35, "sentido": "mayor_es_mejor", "peso": 20},
    {"id": "c3", "tipo": "medible", "nombre": "Diferencias en arqueo", "descripcion": "Número de arqueos con diferencia en el mes", "unidad": "incidencias", "meta": 1, "sentido": "menor_es_mejor", "peso": 15},
    {"id": "c4", "tipo": "descriptivo", "nombre": "Estándar de atención Fraiche", "descripcion": "Aplica los cuatro pasos con cada cliente", "esperado": "Saluda, pregunta, demuestra y cierra de forma consistente", "peso": 20},
    {"id": "c5", "tipo": "descriptivo", "nombre": "Trabajo en equipo", "descripcion": "Apoya a compañeros y al encargado", "esperado": "Cubre huecos, comparte información y mantiene buen ambiente", "peso": 10},
]


def plantilla_desempeno(db, cuenta: Cuenta) -> PlantillaDesempeno:
    p = db.query(PlantillaDesempeno).filter(PlantillaDesempeno.cuenta_id == cuenta.id, PlantillaDesempeno.nombre == "Personal de tienda Fraiche").first()
    if p:
        MK.existe("plantilla_desempeno")
        return p
    p = PlantillaDesempeno(cuenta_id=cuenta.id, nombre="Personal de tienda Fraiche", descripcion="Criterios estándar para demostradores y cajeros de tiendas propias.", equipo="Ventas en tienda",
                           criterios=calc.normalizar_criterios(CRITERIOS_TIENDA), pesos_personalizados=True, creado_por=COORD)
    db.add(p)
    db.flush()
    MK.nuevo("plantilla_desempeno")
    return p


def _ciclo(db, cuenta, nombre, periodo, estado, plantilla, creado_dias, **extra) -> CicloDesempeno:
    c = CicloDesempeno(codigo="TMP", cuenta_id=cuenta.id, nombre=nombre, periodo=periodo, descripcion=extra.pop("descripcion", ""), puesto_objetivo="Ventas en tienda", equipo="Ventas en tienda",
                       criterios=calc.normalizar_criterios(CRITERIOS_TIENDA), origen_criterios="plantilla", pesos_personalizados=True, plantilla_id=plantilla.id, estado=estado,
                       creado_por=COORD, creado_en=hace(days=creado_dias), **extra)
    db.add(c)
    db.flush()
    c.codigo = f"DES-{700 + c.id}"
    MK.nuevo("ciclo_desempeno")
    return c


def _eval_desempeno(db, cuenta, ciclo, col, evaluador: Usuario, resultados=None, completar=False, conclusion="", fortalezas=None, brechas=None, resumen=""):
    e = EvaluacionDesempeno(codigo="TMP", cuenta_id=cuenta.id, ciclo_id=ciclo.id, colaborador_id=col.id, evaluador=evaluador.nombre, evaluador_usuario_id=evaluador.id,
                            resultados=resultados or [], conclusion=conclusion, resumen=resumen, fortalezas=fortalezas or [], brechas=normalizar_brechas(brechas or []), creado_en=ciclo.creado_en)
    db.add(e)
    db.flush()
    e.codigo = f"EVD-{3000 + e.id}"
    ca = calc.calcular(e)
    e.calificacion = ca["calificacion"]
    if completar:
        e.estado, e.completada_en, e.completada_por = "completada", hace(days=3), evaluador.nombre
    else:
        e.estado = calc.estado_persona(e, ca)
    MK.nuevo("evaluacion_desempeno")
    return e


def _res(real_ventas, conv, arqueo, atencion, equipo):
    return [{"criterio_id": "c1", "real": real_ventas, "valoracion": None, "no_aplica": False, "motivo_no_aplica": "", "comentario": ""},
            {"criterio_id": "c2", "real": conv, "valoracion": None, "no_aplica": False, "motivo_no_aplica": "", "comentario": ""},
            {"criterio_id": "c3", "real": arqueo, "valoracion": None, "no_aplica": False, "motivo_no_aplica": "", "comentario": ""},
            {"criterio_id": "c4", "real": None, "valoracion": atencion, "no_aplica": False, "motivo_no_aplica": "", "comentario": ""},
            {"criterio_id": "c5", "real": None, "valoracion": equipo, "no_aplica": False, "motivo_no_aplica": "", "comentario": ""}]


def desempeno(db, cuenta: Cuenta, coord: Usuario, cols: dict, curs: dict, plantilla: PlantillaDesempeno):
    if db.query(CicloDesempeno).filter(CicloDesempeno.cuenta_id == cuenta.id).count():
        MK.existe("ciclo_desempeno")
        return
    # 1) cerrada: primer semestre
    c1 = _ciclo(db, cuenta, "Evaluación semestral tiendas · 1S 2026", "2026-S1", "cerrada", plantilla, 120, descripcion="Primer ciclo de desempeño del personal de tienda con la plantilla estándar.",
                iniciado_en=hace(days=110), cerrado_en=hace(days=3), cerrado_por=COORD)
    personas = [
        ("Daniela Ochoa Vidal", _res(196000, 41, 0, 5, 4), "Supera la meta de ventas y es referente en atención. Sin brechas.", ["Cierre de ventas consistente", "Aplica el estándar con naturalidad"], []),
        ("Kevin Salazar Ibarra", _res(150000, 28, 2, 3, 4), "Cumple parcialmente: la conversión y el arqueo requieren acompañamiento.", ["Buen trabajo en equipo"],
         [{"tema": "Manejo de objeciones", "descripcion": "Conversión por debajo de meta: pierde ventas ante «está caro».", "criterio_id": "c2", "confirmada": True, "origen": "manual"},
          {"tema": "Disciplina de arqueo", "descripcion": "Dos arqueos con diferencia en el semestre.", "criterio_id": "c3", "confirmada": True, "origen": "manual"}]),
        ("Brenda Quiroz Mena", _res(183000, 36, 1, 4, 5), "Cumple todos los criterios; excelente compañera.", ["Trabajo en equipo ejemplar", "Ventas sobre meta"], []),
        ("Ximena Padilla Roldán", _res(120000, 30, 3, 3, 3), "Por debajo en ventas y arqueo; se acuerda plan de acción.", [],
         [{"tema": "Arqueo diario", "descripcion": "Tres diferencias en caja durante el semestre.", "criterio_id": "c3", "confirmada": True, "origen": "manual"}]),
        ("Lucía Ferrer Ordaz", _res(176000, 34, 0, 4, 4), "Casi en meta de ventas; arqueo impecable.", ["Cero diferencias en caja"], []),
    ]
    evs = {}
    for nombre, res, concl, fort, bre in personas:
        evs[nombre] = _eval_desempeno(db, cuenta, c1, cols[nombre], coord, resultados=res, completar=True, conclusion=concl, fortalezas=fort, brechas=bre,
                                      resumen=f"Resumen del evaluador para {nombre.split()[0]}: {concl}")
    # acciones desde brechas confirmadas (una es curso → asignación en Capacitación)
    kevin = evs["Kevin Salazar Ibarra"]
    curso_demo = curs["Técnicas de demostración de fragancias"]
    a = AsignacionCurso(codigo="TMP", curso_id=curso_demo.id, tipo="colaborador", colaborador_id=cols["Kevin Salazar Ibarra"].id, token=secrets.token_urlsafe(24), asignado_por=COORD, asignado_en=hace(days=2))
    db.add(a)
    db.flush()
    a.codigo = f"ASIG-{5000 + a.id}"
    db.add(AccionDesempeno(cuenta_id=cuenta.id, evaluacion_id=kevin.id, colaborador_id=kevin.colaborador_id, brecha_id=kevin.brechas[0]["id"], brecha=kevin.brechas[0]["tema"], tipo="curso",
                           descripcion=f"Curso «{curso_demo.titulo}»", responsable="Rodrigo Elizondo Paz", fecha_compromiso=en(days=21), estado="abierta", curso_id=curso_demo.id, asignacion_curso_id=a.id, creado_por=COORD))
    db.add(AccionDesempeno(cuenta_id=cuenta.id, evaluacion_id=kevin.id, colaborador_id=kevin.colaborador_id, brecha_id=kevin.brechas[1]["id"], brecha=kevin.brechas[1]["tema"], tipo="accion",
                           descripcion="Arqueo acompañado por la encargada durante dos semanas.", responsable="Marisol Aguirre Tena", fecha_compromiso=en(days=14), estado="en_proceso", creado_por=COORD))
    xim = evs["Ximena Padilla Roldán"]
    db.add(AccionDesempeno(cuenta_id=cuenta.id, evaluacion_id=xim.id, colaborador_id=xim.colaborador_id, brecha_id=xim.brechas[0]["id"], brecha=xim.brechas[0]["tema"], tipo="accion",
                           descripcion="Revisión de cierre con el encargado cada día durante un mes.", responsable="Julio César Bravo Ledesma", fecha_compromiso=hace(days=1), estado="completada", creado_por=COORD))
    MK.nuevo("accion_desempeno"); MK.nuevo("accion_desempeno"); MK.nuevo("accion_desempeno")
    # 2) en curso: segundo semestre con avance parcial
    c2 = _ciclo(db, cuenta, "Evaluación semestral tiendas · 2S 2026", "2026-S2", "en_curso", plantilla, 20, descripcion="Ciclo en curso: mitad del equipo ya evaluado.", iniciado_en=hace(days=15))
    _eval_desempeno(db, cuenta, c2, cols["Daniela Ochoa Vidal"], coord, resultados=_res(201000, 43, 0, 5, 5), completar=True, conclusion="Mantiene el nivel del semestre anterior.", fortalezas=["Referente de ventas"])
    _eval_desempeno(db, cuenta, c2, cols["Kevin Salazar Ibarra"], coord, resultados=_res(171000, 33, 0, 4, None), completar=False)
    _eval_desempeno(db, cuenta, c2, cols["Brenda Quiroz Mena"], coord)
    _eval_desempeno(db, cuenta, c2, cols["Óscar Villanueva Cano"], coord)
    c2.historial_cambios = [{"fecha": hace(days=10).isoformat(), "usuario": COORD, "criterio_id": "c1", "campo": "meta", "anterior": 180000, "nuevo": 190000, "motivo": "Temporada alta: se ajusta la meta general de ventas."}]
    # 3) borrador
    _ciclo(db, cuenta, "Evaluación almacén · Q4 2026", "Q4 2026", "borrador", plantilla, 2, descripcion="Borrador: falta definir personas y revisar criterios para almacén.")
    db.flush()


# ============================================================
# 6) Clima v2
# ============================================================

PREGUNTAS_CLIMA = [
    {"texto": "Sé qué se espera de mí en mi puesto.", "tipo": "escala", "dimension": "Claridad de rol"},
    {"texto": "Recibo la información que necesito para hacer bien mi trabajo.", "tipo": "escala", "dimension": "Claridad de rol"},
    {"texto": "Mi encargado(a) reconoce mi trabajo cuando lo hago bien.", "tipo": "escala", "dimension": "Liderazgo"},
    {"texto": "Puedo hablar con mi encargado(a) cuando tengo un problema.", "tipo": "escala", "dimension": "Liderazgo"},
    {"texto": "En mi tienda nos apoyamos entre compañeros.", "tipo": "escala", "dimension": "Ambiente de trabajo"},
    {"texto": "Mi carga de trabajo es razonable para mi horario.", "tipo": "escala", "dimension": "Ambiente de trabajo"},
    {"texto": "Recomendaría trabajar en Fraiche a un amigo o familiar.", "tipo": "escala", "dimension": "Compromiso"},
    {"texto": "¿Qué turno prefieres?", "tipo": "opcion", "opciones": ["Matutino", "Vespertino", "Rolado"], "dimension": "General"},
    {"texto": "¿Qué cambiarías de tu tienda para trabajar mejor?", "tipo": "abierta", "dimension": "General"},
]
ABIERTAS = ["Más personal los fines de semana.", "Que el uniforme llegue a tiempo.", "Nada, estoy contenta con el equipo.", "Mejor iluminación en el almacén de la tienda.",
            "Más capacitación en productos nuevos.", "Que las juntas sean más cortas.", "Un espacio para comer más cómodo.", "Horarios publicados con más anticipación."]


def plantilla_clima(db, cuenta: Cuenta) -> PlantillaClima:
    p = db.query(PlantillaClima).filter(PlantillaClima.cuenta_id == cuenta.id, PlantillaClima.nombre == "Clima tiendas Fraiche").first()
    if p:
        MK.existe("plantilla_clima")
        return p
    preguntas, dims = normalizar_cuestionario(PREGUNTAS_CLIMA)
    p = PlantillaClima(cuenta_id=cuenta.id, nombre="Clima tiendas Fraiche", descripcion="Cuestionario base de clima para personal de tienda (4 dimensiones).", dimensiones=dims, preguntas=preguntas, creado_por=COORD)
    db.add(p)
    db.flush()
    MK.nuevo("plantilla_clima")
    return p


def _respuesta(preguntas, semilla: int, buena: bool) -> dict:
    out = {}
    for i, q in enumerate(preguntas):
        if q["tipo"] == "escala":
            base = 4 if buena else 3
            out[q["id"]] = max(1, min(5, base + ((semilla + i) % 3) - 1))
        elif q["tipo"] == "opcion":
            out[q["id"]] = q["opciones"][(semilla + i) % len(q["opciones"])]
        else:
            out[q["id"]] = ABIERTAS[semilla % len(ABIERTAS)]
    return out


def clima(db, cuenta: Cuenta, cols: dict, plantilla: PlantillaClima):
    if db.query(MedicionClima).filter(MedicionClima.cuenta_id == cuenta.id).count():
        MK.existe("medicion_clima")
        return
    activos = [c for c in cols.values() if c.activo]
    preguntas, dims = normalizar_cuestionario(plantilla.preguntas, plantilla.dimensiones)
    # 1) cerrada, anónima, con análisis
    m1 = MedicionClima(codigo="TMP", cuenta_id=cuenta.id, titulo="Clima laboral tiendas · 1S 2026", descripcion="Medición semestral anónima del personal de tienda y almacén.", preguntas=preguntas, dimensiones=dims,
                       anonima=True, estado="cerrada", token=secrets.token_urlsafe(24), permite_externos=False, abierta_en=hace(days=60), cierra_en=hace(days=46), cerrada_en=hace(days=46), cerrada_por="sistema",
                       plantilla_id=plantilla.id, filtros_envio={"areas": ["Ventas en tienda", "Almacén"]}, creado_por=COORD, creado_en=hace(days=62))
    db.add(m1)
    db.flush()
    m1.codigo = f"CLI-{900 + m1.id}"
    respondieron = 0
    for i, c in enumerate(activos):
        respondio = i % 4 != 3
        db.add(ParticipacionClima(cuenta_id=cuenta.id, medicion_id=m1.id, colaborador_id=c.id, token=secrets.token_urlsafe(24), respondio=respondio, invitado_en=hace(days=60), invitado_por=COORD, recordatorios_enviados=1 if not respondio else 0))
        if respondio:
            db.add(RespuestaClima(cuenta_id=cuenta.id, medicion_id=m1.id, colaborador_id=None, origen="colaborador", respuestas=_respuesta(preguntas, i, buena=(i % 3 != 0)), enviado_en=hace(days=55 - (i % 6)).replace(hour=0, minute=0, second=0, microsecond=0)))
            respondieron += 1
    m1.analisis = [{"fecha": hace(days=45).isoformat(), "respuestas_consideradas": respondieron, "alcance": "final", "usuario": COORD,
                    "resumen": "El índice general es favorable. «Liderazgo» y «Ambiente de trabajo» destacan; «Claridad de rol» es la dimensión más baja: varias respuestas piden información oportuna sobre productos nuevos y horarios.",
                    "hallazgos": ["Claridad de rol por debajo del resto de dimensiones", "Alta disposición a recomendar Fraiche", "Comentarios abiertos: fines de semana con poco personal"],
                    "recomendaciones": ["Publicar horarios con dos semanas de anticipación", "Capacitación breve al lanzar cada producto", "Revisar dotación de fines de semana en Santa Fe"]}]
    registrar(db, "sistema", "clima_cerrada", "clima", m1.codigo, {"respuestas": respondieron})
    MK.nuevo("medicion_clima")
    # 2) abierta, identificada, con participación parcial y una respuesta de prueba
    m2 = MedicionClima(codigo="TMP", cuenta_id=cuenta.id, titulo="Pulso rápido · Temporada alta 2026", descripcion="Pulso de tres semanas antes de temporada alta (identificada para dar seguimiento por tienda).", preguntas=preguntas, dimensiones=dims,
                       anonima=False, estado="abierta", token=secrets.token_urlsafe(24), permite_externos=True, abierta_en=hace(days=4), cierra_en=en(days=17), plantilla_id=plantilla.id,
                       filtros_envio={"areas": ["Ventas en tienda"]}, creado_por=COORD, creado_en=hace(days=5))
    db.add(m2)
    db.flush()
    m2.codigo = f"CLI-{900 + m2.id}"
    tienda = [c for c in activos if c.area == "Ventas en tienda"]
    for i, c in enumerate(tienda):
        respondio = i % 2 == 0
        db.add(ParticipacionClima(cuenta_id=cuenta.id, medicion_id=m2.id, colaborador_id=c.id, token=secrets.token_urlsafe(24), respondio=respondio, invitado_en=hace(days=4), invitado_por=COORD))
        if respondio:
            db.add(RespuestaClima(cuenta_id=cuenta.id, medicion_id=m2.id, colaborador_id=c.id, origen="colaborador", respuestas=_respuesta(preguntas, i + 3, buena=True), enviado_en=hace(days=2, hours=i)))
    db.add(RespuestaClima(cuenta_id=cuenta.id, medicion_id=m2.id, colaborador_id=None, origen="externo", es_externa=True, externo_nombre="Personal Franquicia 002", externo_correo="franquicia002@demo.invalid", respuestas=_respuesta(preguntas, 7, buena=True), enviado_en=hace(days=1)))
    db.add(RespuestaClima(cuenta_id=cuenta.id, medicion_id=m2.id, colaborador_id=None, origen="colaborador", es_prueba=True, respuestas=_respuesta(preguntas, 1, buena=False), enviado_en=hace(days=4)))
    MK.nuevo("medicion_clima")
    # 3) borrador
    m3 = MedicionClima(codigo="TMP", cuenta_id=cuenta.id, titulo="Clima laboral tiendas · 2S 2026", descripcion="Borrador de la medición del segundo semestre (copia de la plantilla).", preguntas=preguntas, dimensiones=dims,
                       anonima=True, estado="borrador", token=secrets.token_urlsafe(24), plantilla_id=plantilla.id, creado_por=COORD, creado_en=hace(days=1))
    db.add(m3)
    db.flush()
    m3.codigo = f"CLI-{900 + m3.id}"
    MK.nuevo("medicion_clima")
    db.flush()


# ============================================================
# 7) Base de Conocimiento
# ============================================================

DOCUMENTOS_CONOCIMIENTO = [
    {"titulo": "Reglamento interior de trabajo · Tiendas Fraiche", "tipo": "reglamento", "publicado": True, "areas": [], "puestos": [], "texto": """
Reglamento interior de trabajo de Fraiche S.A. de C.V. (tiendas propias). Versión demo.

1. Jornada y horarios. La jornada es de 8 horas de trabajo más 1 hora de comida. Los horarios se publican en la tienda con al menos una semana de anticipación. El personal debe registrar su entrada y salida en el sistema de asistencia.

2. Uniforme e imagen. El uniforme y el gafete se portan completos durante toda la jornada. La empresa entrega dos juegos de uniforme al ingreso y los repone cada doce meses.

3. Descansos. Corresponde un día de descanso a la semana; en temporada alta puede moverse con aviso de 48 horas. La hora de comida se toma escalonada para no dejar la tienda sin cobertura.

4. Faltas y retardos. Un retardo es llegar más de 10 minutos después de la hora de entrada. Tres retardos en un mes se consideran una falta. Las faltas injustificadas se descuentan conforme a la ley.

5. Permisos. Los permisos se solicitan al encargado(a) con al menos tres días de anticipación, salvo emergencias. Los permisos por consulta médica requieren comprobante.

6. Vacaciones. Se disfrutan conforme a la Ley Federal del Trabajo: doce días el primer año, aumentando dos por cada año hasta veinte. Se solicitan con quince días de anticipación y se autorizan según la cobertura de la tienda.

7. Manejo de efectivo. Solo el personal de caja autorizado opera el punto de venta. El arqueo se realiza al inicio y al cierre de cada turno frente al encargado(a).

8. Sanciones. Las faltas al reglamento se atienden con amonestación verbal, amonestación escrita y, en caso de reincidencia, con las medidas que marca la ley.
"""},
    {"titulo": "Política de devoluciones y cambios en tienda", "tipo": "politica", "publicado": True, "areas": ["Ventas en tienda"], "puestos": [], "texto": """
Política de devoluciones y cambios · Fraiche (demo).

Alcance: aplica a todas las tiendas propias y se recomienda a franquicias.

Devoluciones. Se aceptan dentro de los 15 días naturales siguientes a la compra presentando el ticket. El producto debe estar cerrado y en buen estado. La devolución se registra en el punto de venta y requiere autorización del encargado(a) con su clave.

Cambios. Un cambio por otro producto del mismo precio (por ejemplo, otro aroma de la misma presentación) no requiere autorización y se registra como cambio. Si hay diferencia de precio, el cliente paga o recibe la diferencia y sí requiere autorización.

Excepciones. Productos en promoción con etiqueta de liquidación no tienen devolución. Productos con defecto de fábrica se reciben sin ticket siempre que sean de la línea vigente.

Reembolsos. En efectivo si la compra fue en efectivo; a la misma tarjeta si fue con tarjeta (el abono tarda de 3 a 10 días hábiles). Nunca se reembolsa en efectivo una compra con tarjeta.

Registro. Cada devolución se anota con motivo. El encargado(a) revisa el reporte semanal de devoluciones con la coordinación.
"""},
    {"titulo": "Procedimiento de apertura y cierre de tienda", "tipo": "proceso", "publicado": True, "areas": ["Ventas en tienda"], "puestos": ["Encargada de tienda", "Encargado de tienda"], "texto": """
Procedimiento de apertura y cierre de tienda · Solo encargados (demo).

Apertura (30 minutos antes): desactivar alarma con la clave personal, encender luces y equipo, revisar que la caja fuerte esté cerrada, contar el fondo fijo de cada caja con el cajero y firmar el formato de apertura, revisar limpieza y exhibición, abrir puertas a la hora publicada.

Cierre: cerrar puertas a la hora publicada, realizar arqueo de cada caja con su cajero, guardar el efectivo en la caja fuerte y registrar el depósito, apagar equipos, activar la alarma, registrar la hora de cierre en la bitácora. Nunca se cierra la tienda con una sola persona.

Incidencias: cualquier diferencia mayor a $50 en el arqueo o cualquier evento de seguridad se reporta a la coordinación el mismo día por el canal de encargados.
"""},
    {"titulo": "Preguntas frecuentes de nómina y prestaciones", "tipo": "faq", "publicado": True, "areas": [], "puestos": [], "texto": """
Preguntas frecuentes de nómina y prestaciones · Fraiche (demo).

¿Cuándo se paga la nómina? La nómina es quincenal y se deposita los días 15 y último de cada mes. Si cae en fin de semana, se deposita el viernes anterior.

¿Cómo consulto mi recibo de nómina? El recibo llega al correo registrado en tu expediente el mismo día del pago. Si no lo recibes, escribe a nomina@fraiche.demo.

¿Qué prestaciones tengo? Las de ley: IMSS, aguinaldo de 15 días, vacaciones con prima del 25 % y fondo de ahorro voluntario a partir del sexto mes.

¿Cómo doy de alta a mis beneficiarios en el IMSS? Con tu número de seguridad social en la página del IMSS o en la subdelegación; Recursos Humanos entrega tu constancia de alta en la primera semana.

¿Puedo pedir un adelanto de nómina? Sí, hasta el 30 % de la quincena, una vez por trimestre, solicitándolo a Recursos Humanos con tres días de anticipación.
"""},
    {"titulo": "Manual de producto · Familias olfativas (borrador)", "tipo": "manual", "publicado": False, "areas": ["Ventas en tienda"], "puestos": [], "texto": """
Borrador del manual de producto (no publicado). Las familias olfativas se agrupan en cítricas, florales, amaderadas y orientales. [por definir: tabla de productos por familia y presentaciones]. Este documento no debe alimentar respuestas hasta que Marketing lo valide.
"""},
]


def conocimiento(db, cuenta: Cuenta, cols: dict):
    if not rag.disponible():
        print("  ⚠️ Base de Conocimiento no disponible en esta base:", rag.error_inicializacion())
        return
    existentes = {d.titulo: d for d in db.query(DocumentoConocimiento).filter(DocumentoConocimiento.cuenta_id == cuenta.id).all()}
    for datos in DOCUMENTOS_CONOCIMIENTO:
        if datos["titulo"] in existentes:
            MK.existe("documento_conocimiento")
            continue
        d = DocumentoConocimiento(cuenta_id=cuenta.id, titulo=datos["titulo"], tipo=datos["tipo"], texto=datos["texto"].strip(), publicado=datos["publicado"], areas=datos["areas"], puestos=datos["puestos"],
                                  creado_por="Rodrigo Elizondo Paz", creado_en=hace(days=15))
        db.add(d)
        db.flush()
        rag.indexar_documento(db, d)
        MK.nuevo("documento_conocimiento")
    if not db.query(ConsultaConocimiento).filter(ConsultaConocimiento.cuenta_id == cuenta.id).count():
        ejemplos = [("¿Cuántos días de vacaciones me tocan el primer año?", "Doce días el primer año, aumentando dos por cada año hasta veinte.", ["Reglamento interior de trabajo · Tiendas Fraiche"], False),
                    ("¿Puedo devolver un producto sin ticket?", "Solo si tiene defecto de fábrica y es de la línea vigente; en otro caso el ticket es obligatorio.", ["Política de devoluciones y cambios en tienda"], False),
                    ("¿Cuál es la política de home office?", "No encontré evidencia en los documentos publicados: es una política por documentar.", [], True)]
        for pregunta, respuesta, fuentes, sin_ev in ejemplos:
            db.add(ConsultaConocimiento(cuenta_id=cuenta.id, usuario=RH, pregunta=pregunta, sin_evidencia=sin_ev, modo="lexico", creado_en=hace(days=3),
                                        respuesta={"respuesta": respuesta, "pasos": [], "fuentes": fuentes, "confianza": "baja" if sin_ev else "alta", "sin_evidencia": sin_ev}))
            MK.nuevo("consulta_conocimiento")
    db.flush()


# ============================================================
# 8) Catálogo extra
# ============================================================


def catalogo(db, cuenta: Cuenta, recl: Usuario):
    existentes = {p.clave for p in db.query(PruebaPsicometrica).filter(PruebaPsicometrica.cuenta_id == cuenta.id).all()}
    extras = [
        ("CLEAVER-DEMO", "Cleaver (perfil DISC) · manual", "Prueba de estilo de comportamiento; el resultado se captura a mano.", ["Encargado", "Coordinador"], "manual", "", "", ""),
        ("TERMAN-ENLACE", "Terman Merrill · enlace externo", "Prueba de inteligencia por liga del proveedor.", ["Analista", "Coordinador"], "enlace", "Proveedor demo", "", "https://pruebas.proveedor.invalid/terman"),
        ("PSICOMX-INT", "Batería integral Psicométricas.mx", "Modo Integrada (simulado hasta conectar llaves).", ["Demostrador", "Cajero"], "integrada", "Psicométricas.mx", "1,7", ""),
    ]
    campos = {c.name for c in PruebaPsicometrica.__table__.columns}
    for clave, nombre, desc, puestos, modo, prov, idp, url in extras:
        if clave in existentes:
            MK.existe("prueba_psicometrica")
            continue
        fila = {"cuenta_id": cuenta.id, "clave": clave, "nombre": nombre, "descripcion": desc, "puestos": puestos, "modo": modo, "proveedor": prov, "id_proveedor": idp, "url": url, "activa": True, "creado_por": recl.nombre}
        db.add(PruebaPsicometrica(**{k: v for k, v in fila.items() if k in campos}))
        MK.nuevo("prueba_psicometrica")
    db.flush()


# ============================================================
# Orquestación
# ============================================================


def cargar(db) -> dict:
    cuenta, recl, coord, med = cuenta_y_usuarios(db)
    cols = colaboradores(db, cuenta)
    reclutamiento(db, cuenta, recl, coord)
    curs = cursos(db, cuenta, coord)
    asignaciones(db, cuenta, curs, cols)
    pl_onb = plantilla_onboarding(db, cuenta, curso_induccion_id=curs["Inducción Fraiche: quiénes somos y cómo atendemos"].id)
    onboarding(db, cuenta, recl, pl_onb)
    pl_des = plantilla_desempeno(db, cuenta)
    desempeno(db, cuenta, coord, cols, curs, pl_des)
    pl_cli = plantilla_clima(db, cuenta)
    clima(db, cuenta, cols, pl_cli)
    conocimiento(db, cuenta, cols)
    catalogo(db, cuenta, recl)
    registrar(db, "sistema", "carga_demo_fraiche_completo", "cuenta", str(cuenta.id), {"colaboradores": len(cols), "cursos": len(curs)})
    return {"cuenta": cuenta}


def main() -> int:
    ap = argparse.ArgumentParser(description="Complemento del ambiente demo de Fraiche (todos los módulos)")
    ap.add_argument("--ejecutar", action="store_true", help="guardar (sin esta bandera es simulacro con rollback)")
    args = ap.parse_args()
    Base.metadata.create_all(bind=engine)
    sincronizar(engine)
    from app.migraciones import crear_tablas_conocimiento, crear_tablas_modulos_rh  # noqa: WPS433

    crear_tablas_conocimiento(engine)
    crear_tablas_modulos_rh(engine)
    db = SessionLocal()
    try:
        r = cargar(db)
        print("\n── Resumen ──")
        print(MK.resumen())
        print(f"\n  Cuenta: {r['cuenta'].nombre} (slug «{r['cuenta'].slug}») · ahora es la Cuenta predeterminada de quienes la ven")
        if args.ejecutar:
            db.commit()
            print("\n✅ Datos demo de todos los módulos guardados.")
        else:
            db.rollback()
            print("\nℹ️  Simulacro: nada se guardó. Vuelve a correr con --ejecutar.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
