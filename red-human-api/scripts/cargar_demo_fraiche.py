"""Demo Fraiche (spec §2-3, §9, §15 · 2026-09-29) — carga del ambiente de demostración.

Crea UNA Cuenta «Fraiche» con: usuarios por rol (Reclutador, Coordinación de Reclutamiento, rol autorizado de
información médica), Clientes «Franquicia 001» a «Franquicia 400» (solo algunas con actividad), las 3 plantillas
(Demostrador $11,500 · Almacenista $12,800 · Cajero $14,500; jornada de 8 h + 1 h de comida; preguntas web comunes
+ por plantilla), el catálogo Evaluatest (Demostrador, Almacenista y Encargado — NUNCA Cajero), vacantes de tienda
propia y de franquicia, y candidatos FICTICIOS en cada paso de las dos rutas (incluido «IPV bajo reserva» con nueva
IPV humana) para que los contadores del Tablero de control salgan de registros reales.

Reglas: no inventa nombres reales (todos son ficticios, correos @demo.invalid), NUNCA manda WhatsApp ni correo
(variables de proveedores vaciadas antes de importar la app), es idempotente (segunda corrida no duplica) y no
toca ninguna otra Cuenta. Las cifras de dimensionamiento que informó Fraiche (110/42/67 vacantes mensuales y
12,000/5,000/6,000 postulaciones) NO son datos de actividad y no se cargan.

Uso (desde red-human-api/, con DATABASE_URL apuntando a la base destino):
    .venv/bin/python scripts/cargar_demo_fraiche.py            → simulacro (rollback), muestra qué haría
    .venv/bin/python scripts/cargar_demo_fraiche.py --ejecutar → guarda
Opcional: --password <contraseña inicial de los usuarios demo> (default Fraiche2026!)
"""

import argparse
import os
import secrets
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

# Cero comunicaciones: las variables de entorno mandan sobre el .env del servidor.
for _k in ("WHATSAPP_PROVIDER", "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "RESEND_API_KEY", "OPENAI_API_KEY", "ANAM_API_KEY", "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"):
    os.environ[_k] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.migraciones import sincronizar  # noqa: E402
from app.models import (  # noqa: E402
    DOCUMENTOS_BASE, REGLAS_NOTIFICACION_DEFAULT, Candidato, Cliente, ClienteContacto, Cuenta, Documento, Entrevista, EntrevistaHumana,
    EvaluacionCandidato, Expediente, Plantilla, Postulacion, PruebaPsicometrica, Usuario, UsuarioCuenta, Vacante, registrar, slugificar,
    texto_sueldo, texto_ubicacion,
)
from app.routers.candidatos import crear_postulacion  # noqa: E402
from app.services import auth, fraiche  # noqa: E402
from app.services import evaluaciones as sev  # noqa: E402

AHORA = datetime.now(timezone.utc)
HOY = AHORA.date()
CUENTA_SLUG = "fraiche"
PASSWORD = "Fraiche2026!"


class Marcador:
    def __init__(self):
        self.creados: dict = {}
        self.existentes: dict = {}

    def nuevo(self, tipo):
        self.creados[tipo] = self.creados.get(tipo, 0) + 1

    def existe(self, tipo):
        self.existentes[tipo] = self.existentes.get(tipo, 0) + 1

    def resumen(self):
        tipos = sorted(set(self.creados) | set(self.existentes))
        return "\n".join(f"  {t:<22} creados {self.creados.get(t, 0):>4}   ya existían {self.existentes.get(t, 0):>4}" for t in tipos)


MK = Marcador()


# ============================================================
# Cuenta, usuarios, franquicias, plantillas, pruebas
# ============================================================


def cuenta_fraiche(db) -> Cuenta:
    c = db.query(Cuenta).filter(Cuenta.slug == CUENTA_SLUG).first()
    if c:
        MK.existe("cuenta")
        return c
    c = Cuenta(nombre="Fraiche", nombre_comercial="Fraiche", razon_social="Fraiche S.A. de C.V.", slug=CUENTA_SLUG,
               contacto_nombre="Coordinación de Reclutamiento", estado="Activa")
    db.add(c)
    db.flush()
    from app.models import ReglaNotificacion  # noqa: WPS433

    for evento, regla in REGLAS_NOTIFICACION_DEFAULT.items():
        if not db.query(ReglaNotificacion).filter(ReglaNotificacion.cuenta_id == c.id, ReglaNotificacion.evento == evento).first():
            db.add(ReglaNotificacion(cuenta_id=c.id, evento=evento, **{k: v for k, v in regla.items() if k in ReglaNotificacion.__table__.columns.keys()}))
    MK.nuevo("cuenta")
    return c


USUARIOS = [
    ("reclutador@fraiche.demo", "Reclutador Fraiche", "Reclutador", "Usuario", False),
    ("coordinacion@fraiche.demo", "Coordinación de Reclutamiento", "Coordinación de Reclutamiento", "Coordinación", False),
    ("medico.autorizado@fraiche.demo", "Rol autorizado de información médica", "Salud ocupacional", "Usuario", True),
]


def usuarios(db, cuenta: Cuenta, password: str) -> dict:
    salida = {}
    for correo, nombre, puesto, rol, medico in USUARIOS:
        u = db.query(Usuario).filter(Usuario.correo == correo).first()
        if u is None:
            u = Usuario(correo=correo, nombre=nombre, puesto=puesto, rol=rol, hash_pass=auth.hashear(password), debe_cambiar_pass=True, acceso_informes_medicos=medico)
            db.add(u)
            db.flush()
            MK.nuevo("usuario")
        else:
            MK.existe("usuario")
        if not db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id == u.id, UsuarioCuenta.cuenta_id == cuenta.id).first():
            db.add(UsuarioCuenta(usuario_id=u.id, cuenta_id=cuenta.id))
        salida[rol if rol != "Usuario" else ("Medico" if medico else "Reclutador")] = u
    # los Administradores existentes ven la Cuenta demo
    for a in db.query(Usuario).filter(Usuario.rol == "Administrador", Usuario.activo.is_(True)).all():
        if not db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id == a.id, UsuarioCuenta.cuenta_id == cuenta.id).first():
            db.add(UsuarioCuenta(usuario_id=a.id, cuenta_id=cuenta.id))
    db.flush()
    return salida


CONTACTOS_FRANQUICIA = {
    1: ("Franquiciatario", "Franquicia 001", "franquicia001@demo.invalid", "5550000001"),
    2: ("Franquiciatario", "Franquicia 002", "franquicia002@demo.invalid", "5550000002"),
    3: ("Franquiciatario", "Franquicia 003", "franquicia003@demo.invalid", "5550000003"),
}


def franquicias(db, cuenta: Cuenta) -> dict:
    existentes = {c.nombre: c for c in db.query(Cliente).filter(Cliente.cuenta_id == cuenta.id).all()}
    salida = {}
    for n in range(1, 401):
        nombre = f"Franquicia {n:03d}"
        c = existentes.get(nombre)
        if c is None:
            c = Cliente(cuenta_id=cuenta.id, nombre=nombre, nombre_comercial=nombre, razon_social=f"{nombre} (identificador provisional)", estado="Activo")
            db.add(c)
            MK.nuevo("franquicia")
        else:
            MK.existe("franquicia")
        salida[n] = c
    db.flush()
    for n, (nom, ape, correo, tel) in CONTACTOS_FRANQUICIA.items():
        c = salida[n]
        if not any(x.correo == correo for x in c.contactos):
            db.add(ClienteContacto(cliente_id=c.id, nombre=nom, apellidos=ape, puesto="Franquiciatario", correo=correo, telefono=tel))
            MK.nuevo("contacto")
    db.flush()
    return salida


JORNADA = "8 horas de trabajo más 1 hora de comida"
PLANTILLAS = {
    "Demostrador": {
        "sueldo": 11500,
        "requisitos": ["Experiencia reciente en ventas", "Atención al cliente", "Facilidad de palabra"],
        "descripcion": "Demostrador(a) en tienda Fraiche: presenta y ofrece los productos, atiende a cada cliente con calidez y "
                       "lo acompaña hasta la venta. Requiere experiencia reciente en ventas, atención al cliente y facilidad de palabra.",
        "responsabilidades": ["Recibir y atender a los clientes en piso de venta.", "Presentar y demostrar los productos Fraiche.",
                              "Cerrar ventas y ofrecer promociones vigentes.", "Mantener el orden y la imagen del área de exhibición."],
        "area": "Ventas en tienda",
    },
    "Almacenista": {
        "sueldo": 12800,
        "requisitos": ["Experiencia en almacén", "Primeras entradas y salidas", "Inventarios", "Recepción, acomodo y control de mercancía",
                       "Ventas", "Atención al cliente", "Facilidad de palabra"],
        "descripcion": "Almacenista en tienda Fraiche: recibe, acomoda y controla la mercancía, realiza inventarios con primeras entradas y "
                       "primeras salidas, y también apoya en ventas y atención al cliente con facilidad de palabra.",
        "responsabilidades": ["Recibir y registrar la mercancía que llega a la tienda.", "Acomodar y controlar el almacén con primeras entradas y salidas.",
                              "Realizar inventarios y reportar diferencias.", "Apoyar en piso de venta y atención al cliente."],
        "area": "Almacén y tienda",
    },
    "Cajero": {
        "sueldo": 14500,
        "requisitos": ["Manejo de caja y efectivo", "Entrega de valores", "Cortes de caja", "Arqueos", "Uso de terminal bancaria",
                       "Ventas", "Atención al cliente", "Facilidad de palabra"],
        "descripcion": "Cajero(a) en tienda Fraiche: opera la caja, maneja efectivo y terminal, realiza cortes, arqueos y entrega de valores, y "
                       "también vende y atiende a los clientes con facilidad de palabra.",
        "responsabilidades": ["Cobrar en caja con efectivo y terminal bancaria.", "Realizar cortes de caja, arqueos y entrega de valores.",
                              "Atender y orientar a los clientes en el cobro.", "Apoyar en ventas y promociones vigentes."],
        "area": "Caja y tienda",
    },
}


def plantillas(db, cuenta: Cuenta, reclutador: Usuario) -> dict:
    salida = {}
    for nombre, d in PLANTILLAS.items():
        p = db.query(Plantilla).filter(Plantilla.cuenta_id == cuenta.id, Plantilla.nombre == nombre).first()
        if p is None:
            p = Plantilla(cuenta_id=cuenta.id, nombre=nombre, creado_por=reclutador.nombre)
            db.add(p)
            MK.nuevo("plantilla")
        else:
            MK.existe("plantilla")
        p.titulo = nombre
        p.area = d["area"]
        p.modalidad = "Presencial"
        p.sueldo_desde, p.sueldo_hasta, p.sueldo_moneda, p.sueldo_periodicidad = d["sueldo"], None, "MXN", "mensual"
        p.sueldo = texto_sueldo(d["sueldo"], None, "MXN", "mensual")
        p.horario = JORNADA
        p.requisitos = " · ".join(d["requisitos"])
        p.descripcion = d["descripcion"]
        p.responsabilidades = d["responsabilidades"]
        p.requisitos_deseables = []
        p.beneficios = []  # no capturadas: nunca se inventan
        p.seniority = "Junior"
        p.enfoque_entrevista = "profesional"
        p.preguntas_filtro = fraiche.preguntas_web_fraiche(nombre)
        p.preguntas_filtro_whatsapp = []  # el segundo filtro es el guion fijo de Fraiche
        p.texto_whatsapp = f"📢 *{nombre}* en Fraiche · {p.sueldo} · {JORNADA}. Contéstame por aquí y en 2 minutos hacemos tu registro. 🙌"
        p.texto_bolsa = f"{d['descripcion']}\n\nSueldo: {p.sueldo}. Jornada: {JORNADA}."
        p.palabras_clave = [nombre.lower(), "tienda", "fraiche", "ventas", "atención al cliente"]
        p.avisos_cumplimiento = ["Prestaciones no capturadas: RH debe confirmarlas antes de publicar (no se inventaron)."]
        salida[nombre] = p
    db.flush()
    return salida


def pruebas_evaluatest(db, cuenta: Cuenta, reclutador: Usuario) -> dict:
    salida = {}
    for puesto, nombre in fraiche.BATERIAS_EVALUATEST.items():  # Demostrador, Almacenista, Encargado — Cajero NO
        clave = f"evaluatest-{slugificar(puesto)}"
        pr = db.query(PruebaPsicometrica).filter(PruebaPsicometrica.cuenta_id == cuenta.id, PruebaPsicometrica.clave == clave).first()
        if pr is None:
            pr = PruebaPsicometrica(cuenta_id=cuenta.id, clave=clave, nombre=nombre, creado_por=reclutador.nombre)
            db.add(pr)
            MK.nuevo("prueba")
        else:
            MK.existe("prueba")
        pr.descripcion = "Índice Evaluatest de Afinidad + Etegrity / Índice General de Integridad. Hasta tener la conexión técnica: liga del proveedor y carga de reporte anonimizado."
        pr.puestos = [puesto]
        pr.modo, pr.proveedor, pr.url, pr.activa = "enlace", fraiche.PROVEEDOR_EVALUATEST, "https://evaluatest.example.invalid/bateria/" + slugificar(puesto), True
        salida[puesto] = pr
    db.flush()
    return salida


# ============================================================
# Vacantes
# ============================================================

VACANTES = [
    # (plantilla, destino, sucursal, zona, franquicia_n, posiciones, dias_para_objetivo, estado)
    ("Cajero", "tienda_propia", "Fraiche Coyoacán", "Sur", None, 2, 6, "Publicada"),
    ("Demostrador", "tienda_propia", "Fraiche Polanco", "Norte", None, 1, 20, "Publicada"),
    ("Almacenista", "tienda_propia", "Fraiche Centro", "Centro", None, 1, 12, "Publicada"),
    ("Demostrador", "tienda_propia", "Fraiche Santa Fe", "Poniente", None, 2, 5, "Publicada"),  # queda «en riesgo»: objetivo cercano, 2 posiciones y pocos viables
    ("Demostrador", "franquicia", "Franquicia 001 Polanco", "Norte", 1, 1, 10, "Publicada"),
    ("Cajero", "franquicia", "Franquicia 002 Coyoacán", "Sur", 2, 1, 15, "Publicada"),
    ("Almacenista", "franquicia", "Franquicia 003 Centro", "Centro", 3, 1, 25, "Borrador"),
]


def vacantes(db, cuenta: Cuenta, reclutador: Usuario, plantillas_: dict, franq: dict) -> list:
    salida = []
    for plantilla, destino, sucursal, zona, fn, posiciones, dias, estado in VACANTES:
        pl = plantillas_[plantilla]
        v = db.query(Vacante).filter(Vacante.cuenta_id == cuenta.id, Vacante.titulo == pl.titulo, Vacante.sucursal == sucursal).first()
        if v is None:
            v = Vacante(codigo="TMP", cuenta_id=cuenta.id, titulo=pl.titulo, plantilla_id=pl.id)
            db.add(v)
            db.flush()
            v.codigo = f"VAC-{1036 + v.id}"
            v.slug = f"{slugificar(pl.titulo)}-fraiche-{slugificar(sucursal)}"
            MK.nuevo("vacante")
        else:
            MK.existe("vacante")
        for campo in ("area", "modalidad", "sueldo", "sueldo_desde", "sueldo_hasta", "sueldo_moneda", "sueldo_periodicidad", "requisitos", "descripcion",
                      "resumen", "perfil_ideal", "responsabilidades", "requisitos_deseables", "beneficios", "palabras_clave", "seniority",
                      "avisos_cumplimiento", "preguntas_filtro", "preguntas_filtro_whatsapp", "texto_whatsapp", "texto_bolsa", "enfoque_entrevista", "horario"):
            valor = getattr(pl, campo)
            setattr(v, campo, list(valor) if isinstance(valor, list) else valor)
        v.destino, v.sucursal, v.zona, v.posiciones = destino, sucursal, zona, posiciones
        v.fecha_objetivo = HOY + timedelta(days=dias)
        v.cliente_id = franq[fn].id if fn else None
        v.mostrar_cliente_candidato = True
        v.responsable_id = reclutador.id
        v.ubicacion_estado, v.ubicacion_municipio = "Ciudad de México", {"Sur": "Coyoacán", "Norte": "Miguel Hidalgo", "Centro": "Cuauhtémoc", "Poniente": "Álvaro Obregón"}[zona]
        v.ubicacion = texto_ubicacion(v.ubicacion_estado, v.ubicacion_municipio)
        v.empresa = franq[fn].nombre_visible if fn else cuenta.nombre_comercial
        v.estado = estado
        v.plataformas = ["Portal", "WhatsApp"] if estado == "Publicada" else []
        v.publicada_en = v.publicada_en or (AHORA - timedelta(days=18) if estado == "Publicada" else None)
        v.publicaciones = {
            "whatsapp": {"titulo": v.titulo, "copy": v.texto_whatsapp, "page": v.texto_whatsapp, "etiquetas": []},
            **{k: {"titulo": f"{v.titulo} - {v.ubicacion_municipio}", "copy": f"{v.empresa} busca {v.titulo}. {v.sueldo}. {JORNADA}.",
                   "page": v.texto_bolsa, "etiquetas": v.palabras_clave} for k in ("indeed", "computrabajo", "talenteca", "occ", "linkedin", "portal")},
        }
        salida.append(v)
    db.flush()
    return salida


# ============================================================
# Candidatos ficticios en cada paso
# ============================================================

NOMBRES = [
    "Mariana Ejemplo López", "Luis Ficticio Ramírez", "Daniela Prueba Hernández", "Jorge Demo Castillo", "Fernanda Muestra Díaz",
    "Ricardo Simulado Torres", "Paola Ilustrativa Vega", "Andrés Ensayo Molina", "Valeria Hipotética Ruiz", "Emilio Modelo Navarro",
    "Sofía Piloto Mendoza", "Diego Referencia Ortega", "Camila Escenario Flores", "Mateo Prototipo Aguilar", "Regina Boceto Salinas",
    "Iván Esquema Rojas", "Ximena Borrador Campos", "Tomás Plantilla Ibarra", "Renata Ejemplar Cortés", "Sebastián Maqueta Peña",
    "Lucía Supuesta Miranda", "Bruno Imaginario Lara", "Isabela Figurada Ponce", "Gael Genérico Escobar", "Natalia Aparente Ríos",
    "Alonso Nominal Cabrera", "Julieta Ficticia Serrano", "Emiliano Muestra Guzmán", "Victoria Prueba Delgado", "Santiago Demo Fuentes",
]
FUENTES_CICLO = ["portal", "indeed", "computrabajo", "talenteca", "referido", "campo", "red_social", "contacto_directo", "whatsapp"]

# Por vacante (índice en VACANTES): lista de pasos en los que hay candidatos; "descartado" cierra con motivo.
PLAN = {
    0: ["nuevo", "prefiltro_web", "filtro_whatsapp", "entrevista_inicial", "ipv_bajo_reserva", "psicometria", "evaluaciones_adicionales", "referencias", "documentacion", "listo_sap", "contratado", "descartado"],
    1: ["prefiltro_web", "filtro_whatsapp", "entrevista_inicial", "ipv", "psicometria", "documentacion", "descartado"],
    2: ["nuevo", "filtro_whatsapp", "ipv", "referencias", "listo_alta", "contratado"],
    3: ["prefiltro_web", "entrevista_inicial", "descartado"],
    4: ["prefiltro_web", "filtro_whatsapp", "entrevista_inicial", "ipv", "psicometria", "presentado", "aceptado", "no_aceptado"],
    5: ["nuevo", "entrevista_inicial", "presentado", "descartado"],
}
MOTIVOS_DESCARTE = ["No cumple horarios rolados", "Expectativa salarial fuera de rango", "Sin experiencia en ventas", "No se presentó a la entrevista"]


def _respuestas_web(v: Vacante, todo_si: bool = True, dudas: bool = False):
    crit = fraiche.preguntas_para_vacante(v.preguntas_filtro, sucursal=v.sucursal, sueldo=v.sueldo)
    filas = []
    for c in crit:
        clave = c.get("clave", "")
        if c["tipo"] == "municipio":
            r = f"{v.ubicacion_municipio}, {v.ubicacion_estado}"
        elif clave == "traslado":
            r = "No sé" if dudas else "Hasta 30 min"
        elif clave == "sueldo":
            r = "Necesito conocer más" if dudas else "Sí"
        elif c["tipo"] == "opcion":
            r = c["opciones"][0]
        else:
            r = "Sí" if todo_si else "No"
        filas.append({"clave": clave, "pregunta": c["pregunta"], "respuesta": r} if clave else {"pregunta": c["pregunta"], "respuesta": r})
    return filas


def _evaluacion_inicial(nombre: str, titulo: str, rec: str = "avanzar") -> dict:
    return {
        "resumen": f"{nombre.split(' ')[0]} muestra experiencia reciente en tienda y disponibilidad completa para {titulo}; expectativa salarial dentro del rango.",
        "fortalezas": ["Atención al cliente con ejemplos concretos", "Estabilidad laboral (más de un año en el último empleo)", "Disponibilidad de lunes a domingo"],
        "riesgos": ["Validar manejo de terminal bancaria en la IPV"] if rec != "avanzar" else [],
        "areas_desarrollo": [], "calif_experiencia": 7.5, "calif_comunicacion": 8.0, "match_perfil": 78 if rec == "avanzar" else 62,
        "recomendacion": rec, "evidencia": "«Duré dos años en mi último empleo y atendía público todo el día»", "perfil": None, "faltante": [],
    }


def _ipv(niveles: dict, evaluador: str = "Red Human") -> dict:
    rub = fraiche.normalizar_rubrica({"niveles": niveles,
                                      "respuestas": {k: "Dio un ejemplo concreto de tienda." for k in niveles},
                                      "evidencias": {k: "«Lo resolví yo mismo y avisé a mi encargada»" for k in niveles},
                                      "observaciones": {"comunicacion": "Clara y directa", "facilidad_palabra": "Buena", "manejo_objeciones": "Adecuado"}})
    return {**rub, "calculo": fraiche.calcular_ipv(rub["niveles"]), "ia": False, "evaluador": evaluador, "evaluada_en": (AHORA - timedelta(days=2)).isoformat()}


NIVELES_BUENOS = {"orientacion_cliente": "alto", "motivacion": "alto", "resiliencia": "medio", "trabajo_equipo": "alto", "etica": "alto", "adaptabilidad": "medio"}
NIVELES_RESERVA = {"orientacion_cliente": "medio", "motivacion": "medio", "resiliencia": "bajo", "trabajo_equipo": "medio", "etica": "alto", "adaptabilidad": "medio"}


def _entrevista(db, p: Postulacion, fase: str, dias: int, evaluacion=None, evaluacion_ipv=None) -> Entrevista:
    e = Entrevista(codigo="TMP", candidato_id=p.candidato_id, token=secrets.token_urlsafe(24), tipo="texto", fase=fase,
                   guion={"enfoque": "Entrevista inicial Fraiche", "temas": list(fraiche.TEMAS_ENTREVISTA_INICIAL), "preguntas": []},
                   consentimiento=True, consentimiento_fecha=AHORA - timedelta(days=dias),
                   iniciada_en=AHORA - timedelta(days=dias), finalizada_en=AHORA - timedelta(days=dias, hours=-1) if evaluacion or evaluacion_ipv else None,
                   estado="evaluada" if (evaluacion or evaluacion_ipv) else "programada", cierre="texto" if (evaluacion or evaluacion_ipv) else "",
                   transcript=[{"rol": "assistant", "texto": "Hola, soy Red Human. Gracias por participar en el proceso. ¿Comenzamos?"}, {"rol": "user", "texto": "Sí, comencemos."},
                               {"rol": "assistant", "texto": "Cuéntame de tu experiencia más reciente relacionada con este puesto."},
                               {"rol": "user", "texto": "Trabajé dos años en una tienda de conveniencia atendiendo público y cobrando en caja."}] if (evaluacion or evaluacion_ipv) else [],
                   evaluacion=evaluacion or {}, evaluacion_ipv=evaluacion_ipv or {})
    p.entrevistas.append(e)
    db.add(e)
    db.flush()
    e.codigo = f"ENT-{300 + e.id}"
    return e


def _evaluacion(db, cuenta, p, tipo, nombre, estado, dias, **extra) -> EvaluacionCandidato:
    ev = EvaluacionCandidato(codigo="TMP", cuenta_id=cuenta.id, postulacion_id=p.id, tipo=tipo, nombre=nombre, modo=extra.pop("modo", "manual"),
                             asignada_por="Reclutador Fraiche", estado=estado, historial=[{"fecha": (AHORA - timedelta(days=dias)).isoformat(), "usuario": "Reclutador Fraiche", "de": "", "a": estado, "detalle": "Carga demo"}],
                             requiere_consentimiento_expreso=(tipo == "medico"), **extra)
    db.add(ev)
    db.flush()
    ev.codigo = f"EVA-{7000 + ev.id}"
    return ev


def _expediente(db, p: Postulacion, completo: bool, sap: bool) -> Expediente:
    v = p.vacante
    e = Expediente(candidato_id=p.candidato_id, puesto=v.titulo, seleccionado_por="Reclutador Fraiche", token=secrets.token_urlsafe(24),
                   sueldo=v.sueldo, tipo_contratacion="Tiempo indeterminado", ubicacion=v.ubicacion, jefe_directo="Encargado(a) de tienda",
                   fecha_ingreso=AHORA + timedelta(days=7), empresa="Fraiche S.A. de C.V.", condiciones_guardadas_en=AHORA - timedelta(days=1),
                   instrucciones_ingreso="Presentarse a las 9:00 con identificación en la sucursal.")
    p.expediente = e
    db.add(e)
    db.flush()
    for tipo in DOCUMENTOS_BASE:
        d = Documento(expediente_id=e.id, tipo=tipo, obligatorio=True)
        if completo:
            d.estado, d.archivo, d.nombre_archivo, d.mime, d.revisado_por, d.recibido_en, d.recibido_canal = "recibido", "(demo)", f"{slugificar(tipo)}.pdf", "application/pdf", "Reclutador Fraiche", AHORA - timedelta(days=1), "liga"
        db.add(d)
    if completo:
        e.estado = "completo"
    if sap:
        p.candidato.datos_personales = {"curp": "XEXX010101HNEXXXA4", "rfc": "XEXX010101000", "nss": "00000000000", "domicilio": "Domicilio ficticio 123, Ciudad de México",
                                        "fecha_nacimiento": "1996-05-14", "origen": {k: fraiche.ORIGEN_RH for k in ("curp", "rfc", "nss", "domicilio", "fecha_nacimiento")}}
        e.estado_sap, e.sap_confirmado_por, e.sap_confirmado_en = fraiche.ESTADO_LISTO_SAP, "Reclutador Fraiche", AHORA - timedelta(hours=5)
    db.flush()
    return e


def candidatos(db, cuenta: Cuenta, vacs: list, franq: dict, pruebas: dict, reclutador: Usuario) -> int:
    i = 0
    total = 0
    for idx, pasos in PLAN.items():
        v = vacs[idx]
        for paso in pasos:
            nombre = NOMBRES[i % len(NOMBRES)]
            i += 1
            correo = f"{slugificar(nombre)}@demo.invalid"
            c = db.query(Candidato).filter(Candidato.cuenta_id == cuenta.id, Candidato.correo == correo).first()
            if c is None:
                c = Candidato(codigo="TMP", cuenta_id=cuenta.id, nombre=nombre, correo=correo, telefono=f"55{70000000 + i:08d}", ubicacion=v.ubicacion,
                              experiencia="Experiencia reciente en tienda: ventas, caja y atención al cliente (ficticia).", fuente="Formulario",
                              cv_datos={"resumen_profesional": "Perfil operativo de tienda con experiencia en ventas y caja (datos ficticios).",
                                        "habilidades": ["Atención al cliente", "Manejo de efectivo", "Trabajo en equipo"], "estudios": ["Preparatoria concluida"],
                                        "experiencia": [{"puesto": "Cajera/o", "empresa": "Tienda de conveniencia (ficticia)", "periodo": "2024-2026"}]})
                db.add(c)
                db.flush()
                c.codigo = f"C-{8800 + c.id}"
                MK.nuevo("candidato")
            else:
                MK.existe("candidato")
            p = db.query(Postulacion).filter(Postulacion.candidato_id == c.id, Postulacion.vacante_id == v.id).first()
            if p is not None:
                MK.existe("postulacion")
                continue
            p = crear_postulacion(db, c, v, cuenta.id, "formulario", consentimiento=True)
            MK.nuevo("postulacion")
            total += 1
            p.fuente_postulacion = FUENTES_CICLO[i % len(FUENTES_CICLO)]
            if p.fuente_postulacion == "referido":
                p.referido_por = "Colaborador(a) de tienda 1023"
            dias = 14 - min(13, len(pasos))
            p.creado_en = AHORA - timedelta(days=dias + 2)
            p.ultima_actividad_en = AHORA - timedelta(days=dias)
            analisis = {}

            if paso == "nuevo":
                p.paso = "nuevo"
                p.ultima_actividad_en = AHORA - timedelta(days=7)  # detenido
            else:
                resp = _respuestas_web(v, dudas=(paso == "descartado"))
                analisis["respuestas_web"] = resp
                analisis["prefiltro_web"] = fraiche.evaluar_prefiltro_web(v.preguntas_filtro, resp, sucursal=v.sucursal, sueldo=v.sueldo)
                p.estado = analisis["prefiltro_web"]["resultado"]
                p.paso = "prefiltro_web"
            if paso not in ("nuevo", "prefiltro_web"):
                analisis["respuestas_prefiltro"] = [
                    {"criterio": "Estabilidad laboral", "pregunta": "¿Cuánto tiempo trabajaste en tu empleo más reciente?", "respuesta": "Dos años", "cumple": True},
                    {"criterio": "Puesto más reciente", "pregunta": "¿Cuál era tu puesto?", "respuesta": "Cajera en tienda", "cumple": True},
                    {"criterio": "Disponibilidad de inicio", "pregunta": "¿A partir de cuándo podrías iniciar?", "respuesta": "La próxima semana", "cumple": True},
                    {"criterio": "Adeudo con BBVA", "pregunta": "¿Tienes algún adeudo con BBVA? Sí / No", "respuesta": "No" if i % 3 else "Sí", "cumple": None},
                ]
                analisis["adeudo_bbva"] = "No" if i % 3 else "Sí"
                analisis["prefiltro_resultado"] = "cumple"
                analisis["prefiltro_whatsapp"] = {"resultado": "cumple", "etiqueta": "Invitar a entrevista inicial", "siguiente_accion": "Invitar a entrevista inicial", "evidencia": "Guion completo (demo)", "adeudo_bbva": analisis["adeudo_bbva"]}
                p.prefiltro_completo, p.estado, p.paso = True, "cumple", "filtro_whatsapp"
            p.analisis = analisis

            if paso == "descartado":
                p.etapa, p.estado, p.paso = "Prefiltro", "no_cumple", "prefiltro_web"
                p.cerrar("descartado")
                p.cerrada_en = AHORA - timedelta(days=1)
                motivo = MOTIVOS_DESCARTE[i % len(MOTIVOS_DESCARTE)]
                registrar(db, reclutador.nombre, "decision_descartar", "postulacion", p.codigo, {"comentario": motivo, "candidato": c.codigo})
                p.historial = [{"evento": "descartado", "texto": f"Descartado: {motivo}", "usuario": reclutador.nombre, "fecha": p.cerrada_en.isoformat()}]
                continue
            if paso in ("nuevo", "prefiltro_web", "filtro_whatsapp"):
                continue
            # --- entrevista inicial y más allá ---
            p.etapa = "Entrevista IA"
            if paso == "entrevista_inicial":
                _entrevista(db, p, "inicial", 2, evaluacion=None)
                p.paso = "entrevista_inicial"
                continue
            _entrevista(db, p, "inicial_ipv", 4, evaluacion=_evaluacion_inicial(nombre, v.titulo, "revision" if paso == "ipv_bajo_reserva" else "avanzar"),
                        evaluacion_ipv=_ipv(NIVELES_RESERVA if paso == "ipv_bajo_reserva" else NIVELES_BUENOS))
            p.etapa, p.paso = "Evaluación", "ipv"
            if paso == "ipv_bajo_reserva":
                # spec §15 recorrido 3: Bajo reserva → nueva IPV humana; ambos resultados se conservan
                eh = EntrevistaHumana(candidato_id=c.id, entrevistador="Encargado(a) Fraiche Coyoacán", tipo="externo", correo_externo="encargado.coyoacan@demo.invalid",
                                      fecha=AHORA + timedelta(days=2), modalidad="Presencial", ubicacion=v.sucursal, token=secrets.token_urlsafe(24), es_ipv=True)
                p.entrevistas_humanas.append(eh)
                p.etapa = "Entrevista Humana"
                p.historial = [{"evento": "ipv_bajo_reserva", "texto": "IPV de Red Human: Bajo reserva → se programó nueva IPV humana (se conservan ambos resultados)", "usuario": reclutador.nombre, "fecha": AHORA.isoformat()}]
                continue
            if paso == "ipv":
                continue
            # psicometría (Evaluatest) — Cajero sin batería asignada
            pr = pruebas.get(v.titulo)
            if pr:
                _evaluacion(db, cuenta, p, "psicometrica", pr.nombre, "resultado_recibido" if paso != "psicometria" else "en_proceso", 3, modo="enlace", proveedor=pr.proveedor, url=pr.url, prueba_id=pr.id,
                            origen_resultado="liga_proveedor_reporte_anonimizado" if paso != "psicometria" else "",
                            resultado_json={"evaluatest": {"indice_afinidad": 81.0, "igi": 77.0, "competencias": ["Servicio", "Orden"], "fortalezas": ["Empatía", "Constancia"], "areas_oportunidad": ["Manejo de objeciones"], "riesgo": "Bajo"}} if paso != "psicometria" else {},
                            realizada_en=AHORA - timedelta(days=2) if paso != "psicometria" else None)
            else:
                _evaluacion(db, cuenta, p, "psicometrica", "Batería psicométrica por definir (Cajero: sin batería asignada)", "pendiente", 3, notas="Configuración pendiente: Fraiche no especificó batería para Cajero.")
            p.paso = "psicometria"
            if paso == "psicometria":
                continue
            if v.destino == "franquicia":
                # presentación al franquiciatario
                contacto = franq[int(v.cliente.nombre.split()[-1])].contactos[0] if v.cliente and v.cliente.contactos else None
                ev = _evaluacion(db, cuenta, p, "otra", fraiche.NOMBRE_EVALUACION_FRANQUICIATARIO, "resultado_recibido" if paso in ("aceptado", "no_aceptado") else "pendiente", 2,
                                 responsable=f"{contacto.nombre} {contacto.apellidos}" if contacto else "Franquiciatario", responsable_correo=contacto.correo if contacto else "",
                                 responsable_contacto_id=contacto.id if contacto else None, token_externo=secrets.token_urlsafe(24),
                                 decision_externa="continuar" if paso == "aceptado" else "no_continuar" if paso == "no_aceptado" else "",
                                 dictamen="favorable" if paso == "aceptado" else "desfavorable" if paso == "no_aceptado" else "", origen_resultado="liga_externa" if paso != "presentado" else "")
                p.etapa, p.paso = "Entrevista Humana", "presentacion"
                p.franquicia_estado = {"presentado": "presentado", "aceptado": "aceptado", "no_aceptado": "no_aceptado"}[paso]
                p.franquicia_presentado_en = AHORA - timedelta(days=3)
                if paso != "presentado":
                    p.franquicia_decidido_en = AHORA - timedelta(days=1)
                if paso == "aceptado":
                    p.cerrar("aceptado_franquicia")
                continue
            # tienda propia: evaluaciones adicionales (socioeconómico / médico solo Cajero), referencias, documentación, alta, SAP
            if v.titulo == "Cajero":
                _evaluacion(db, cuenta, p, "socioeconomico", "Estudio socioeconómico", "resultado_recibido" if paso != "evaluaciones_adicionales" else "pendiente", 3,
                            responsable="Estudios Socioeconómicos MX (ficticio)", responsable_correo="estudios@proveedor.invalid", token_externo=secrets.token_urlsafe(24),
                            origen_resultado="liga_externa" if paso != "evaluaciones_adicionales" else "", decision_externa="favorable" if paso != "evaluaciones_adicionales" else "",
                            dictamen="favorable" if paso != "evaluaciones_adicionales" else "")
            med = _evaluacion(db, cuenta, p, "medico", "Estudio médico", "pendiente" if paso == "evaluaciones_adicionales" else "resultado_recibido", 3,
                              responsable="Dra. Ficticia Salud", token_externo=secrets.token_urlsafe(24), consentimiento_token=secrets.token_urlsafe(24),
                              consentimiento_aceptado_en=AHORA - timedelta(days=3), consentimiento_texto="(demo) consentimiento expreso aceptado",
                              origen_resultado="liga_externa" if paso != "evaluaciones_adicionales" else "")
            if paso != "evaluaciones_adicionales":
                sev.aplicar_decision(med, "apto")
                sev.guardar_texto(med, "resultado_resumen", "Apto sin restricciones (dato ficticio, cifrado).")
            p.paso = "evaluaciones_adicionales"
            if paso == "evaluaciones_adicionales":
                continue
            _evaluacion(db, cuenta, p, "referencias", "Referencias laborales", "resultado_recibido" if paso != "referencias" else "pendiente", 2,
                        responsable=reclutador.nombre, responsable_usuario_id=reclutador.id,
                        referencias=[{"contacto": "Jefe anterior (ficticio)", "empresa": "Tienda de conveniencia", "telefono": "5500000000", "puesto": "Encargado", "fecha_verificacion": (HOY - timedelta(days=2)).isoformat(),
                                      "resultado": "favorable", "comentarios": "Puntual y honesta", "responsable": reclutador.nombre}] if paso != "referencias" else [])
            p.paso = "referencias"
            if paso == "referencias":
                continue
            p.etapa = "Contratación"
            e = _expediente(db, p, completo=(paso in ("listo_alta", "listo_sap", "contratado")), sap=(paso in ("listo_sap", "contratado")))
            p.paso = "documentacion"
            if paso == "documentacion":
                continue
            p.etapa = "Onboarding"
            e.fecha_ingreso_real, e.ingreso_confirmado_por, e.ingreso_confirmado_en = AHORA - timedelta(days=1), reclutador.nombre, AHORA - timedelta(days=1)
            p.paso = "listo_alta"
            if paso == "listo_alta":
                continue
            p.paso = "listo_sap"
            if paso == "contratado":
                e.estado, e.alta_autorizada_por, e.alta_fecha = "alta", reclutador.nombre, AHORA - timedelta(days=1)
                p.cerrar("contratado")
    db.flush()
    return total


# ============================================================
# Orquestación
# ============================================================


def cargar(db, password: str) -> dict:
    cuenta = cuenta_fraiche(db)
    us = usuarios(db, cuenta, password)
    franq = franquicias(db, cuenta)
    pls = plantillas(db, cuenta, us["Reclutador"])
    pruebas = pruebas_evaluatest(db, cuenta, us["Reclutador"])
    vacs = vacantes(db, cuenta, us["Reclutador"], pls, franq)
    n = candidatos(db, cuenta, vacs, franq, pruebas, us["Reclutador"])
    registrar(db, "sistema", "carga_demo_fraiche", "cuenta", str(cuenta.id), {"vacantes": len(vacs), "postulaciones_nuevas": n, "franquicias": len(franq)})
    return {"cuenta": cuenta, "usuarios": us, "vacantes": vacs, "postulaciones_nuevas": n}


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga del ambiente demo de Fraiche")
    ap.add_argument("--ejecutar", action="store_true", help="guardar (sin esta bandera es simulacro con rollback)")
    ap.add_argument("--password", default=PASSWORD, help="contraseña inicial de los usuarios demo (deben cambiarla al entrar)")
    args = ap.parse_args()
    Base.metadata.create_all(bind=engine)
    sincronizar(engine)
    db = SessionLocal()
    try:
        r = cargar(db, args.password)
        print("\n── Resumen ──")
        print(MK.resumen())
        print(f"\n  Cuenta: {r['cuenta'].nombre} (slug «{r['cuenta'].slug}») · portal: /portal?cuenta={r['cuenta'].slug}")
        print("  Usuarios demo (contraseña inicial: " + args.password + ", deben cambiarla al entrar):")
        for correo, nombre, _p, rol, _m in USUARIOS:
            print(f"    - {nombre:<40} {correo:<36} rol {rol}")
        if args.ejecutar:
            db.commit()
            print("\n✅ Ambiente demo de Fraiche guardado.")
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
