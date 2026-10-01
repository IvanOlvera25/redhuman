"""Demo Fraiche (2026-09-29) — constantes y reglas específicas del proceso de reclutamiento de Fraiche.

Fraiche tiene un equipo de reclutamiento que atiende dos operaciones: TIENDAS PROPIAS (recluta para sus
sucursales y prepara la contratación) y FRANQUICIAS CLIENTE (presta el servicio; presenta candidatos
evaluados al franquiciatario, quien decide y contrata). Todo lo que aquí vive es DATO de la especificación
(`Fraiche — especificación autónoma para desarrollo de la demo.pdf`), no inventos: preguntas, portales,
fuentes, rúbrica IPV y ruta visible. Los routers y `services/ia.py` lo leen; nunca lo duplican.
"""

import re
from typing import Dict, List, Optional, Tuple

from . import canal as _canal

# ============================================================
# §2 · Destinos y §4 · Fuentes de postulación
# ============================================================

# Fuente de CADA postulación (spec §4): portal, red social, referido, campo o contacto directo. Se captura
# desde la liga (`?fuente=` / `?utm_source=`), desde el QR de referidos (`?fuente=referido&ref=`) o la fija
# RH al dar de alta a mano. Las llaves son lo que viaja en la URL; el texto es lo que ve RH.
FUENTES_POSTULACION: Dict[str, str] = {
    "portal": "Portal",
    "indeed": "Indeed",
    "computrabajo": "Computrabajo",
    "talenteca": "Talenteca",
    "occ": "OCC",
    "linkedin": "LinkedIn",
    "google": "Google Empleos",
    "jooble": "Jooble",
    "talent": "Talent.com",
    "red_social": "Red social",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "tiktok": "TikTok",
    "referido": "Referido",
    "campo": "Campo",
    "contacto_directo": "Contacto directo",
    "whatsapp": _canal.nombre(),
    "rh": "RH",
}

_ALIAS_FUENTE = {
    "portal_propio": "portal", "bolsa": "portal", "web": "portal", "formulario": "portal",
    "fb": "facebook", "ig": "instagram", "redes": "red_social", "social": "red_social",
    "referidos": "referido", "qr": "referido", "volanteo": "campo", "feria": "campo",
    "directo": "contacto_directo", "walk_in": "contacto_directo",
}


def normalizar_fuente(valor: Optional[str]) -> str:
    """`?fuente=` / `?utm_source=` → llave del catálogo. Lo que no se reconoce se conserva en minúsculas
    (máx. 40) para no perder información; RH lo ve tal cual."""
    v = (valor or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not v:
        return ""
    v = _ALIAS_FUENTE.get(v, v)
    return v[:40]


def nombre_fuente(clave: str) -> str:
    return FUENTES_POSTULACION.get(clave, (clave or "").replace("_", " ").capitalize())


# ============================================================
# §4 · Textos por portal (Indeed, Computrabajo, Talenteca) — se generan, NUNCA se publican solos
# ============================================================

# Claves de `Vacante.publicaciones` que Fraiche copia a mano en cada portal. OCC/LinkedIn/portal/whatsapp
# ya existían; estas tres se agregan al generador (ia.VacanteGenerada) y al bloque «Publicaciones».
PORTALES_TEXTO: List[str] = ["indeed", "computrabajo", "talenteca"]
NOMBRE_PORTAL = {"indeed": "Indeed", "computrabajo": "Computrabajo", "talenteca": "Talenteca"}

# ============================================================
# §5 · Prefiltro web — preguntas COMUNES a toda vacante Fraiche
# ============================================================

# Tipos nuevos de pregunta (además de si_no/numero/opcion/texto_corto de ia.PreguntaFiltro):
#   municipio  → selector Estado/Municipio del catálogo INEGI (lib/estados-municipios.json)
# Placeholders que el servidor sustituye al servir la vacante: [sucursal], [monto mensual].
PREGUNTAS_WEB_COMUNES: List[dict] = [
    {"clave": "municipio", "pregunta": "¿En qué municipio o alcaldía vives?", "tipo": "municipio", "opciones": [],
     "valida": "Ubicación", "respuesta_esperada": "", "descarta": False, "comun": True},
    {"clave": "traslado", "pregunta": "¿Cuánto tardarías en llegar a [sucursal]?", "tipo": "opcion",
     "opciones": ["Hasta 30 min", "31–60", "61–90", "Más de 90", "No sé"],
     "valida": "Traslado a la sucursal", "respuesta_esperada": "Hasta 30 min|31–60", "descarta": False, "comun": True},
    {"clave": "lunes_domingo", "pregunta": "¿Puedes trabajar de lunes a domingo con descanso entre semana?", "tipo": "si_no",
     "opciones": ["Sí", "No"], "valida": "Disponibilidad de lunes a domingo", "respuesta_esperada": "Sí", "descarta": True, "comun": True},
    {"clave": "rolados", "pregunta": "¿Puedes trabajar en horarios rolados?", "tipo": "si_no",
     "opciones": ["Sí", "No"], "valida": "Horarios rolados", "respuesta_esperada": "Sí", "descarta": True, "comun": True},
    {"clave": "sueldo", "pregunta": "El sueldo es [monto mensual]. ¿Está dentro de lo que buscas?", "tipo": "opcion",
     "opciones": ["Sí", "No", "Necesito conocer más"], "valida": "Expectativa salarial", "respuesta_esperada": "Sí", "descarta": False, "comun": True},
    {"clave": "puesto_similar", "pregunta": "¿Has trabajado en un puesto similar?", "tipo": "si_no",
     "opciones": ["Sí", "No"], "valida": "Experiencia en puesto similar", "respuesta_esperada": "Sí", "descarta": False, "comun": True},
    {"clave": "ventas", "pregunta": "¿Puedes realizar actividades de venta y atención al cliente?", "tipo": "si_no",
     "opciones": ["Sí", "No"], "valida": "Ventas y atención al cliente", "respuesta_esperada": "Sí", "descarta": True, "comun": True},
]

# Preguntas Sí/No por plantilla (spec §5). Se agregan DESPUÉS de las comunes. Ninguna es de escolaridad:
# «No configurar un requisito de escolaridad hasta tener el mínimo exacto para cada puesto».
PREGUNTAS_WEB_PLANTILLA: Dict[str, List[dict]] = {
    "Demostrador": [
        {"pregunta": "¿Tienes experiencia reciente en ventas?", "valida": "Experiencia reciente en ventas", "descarta": True},
    ],
    "Almacenista": [
        {"pregunta": "¿Has realizado inventarios?", "valida": "Inventarios", "descarta": True},
        {"pregunta": "¿Has recibido mercancía?", "valida": "Recepción de mercancía", "descarta": False},
        {"pregunta": "¿Has trabajado con primeras entradas y primeras salidas?", "valida": "Primeras entradas y salidas", "descarta": False},
        {"pregunta": "¿Has realizado acomodo y control de mercancía?", "valida": "Acomodo y control de mercancía", "descarta": False},
    ],
    "Cajero": [
        {"pregunta": "¿Has manejado efectivo?", "valida": "Manejo de efectivo", "descarta": True},
        {"pregunta": "¿Has usado terminal bancaria?", "valida": "Terminal bancaria", "descarta": False},
        {"pregunta": "¿Has realizado cortes de caja?", "valida": "Cortes de caja", "descarta": False},
        {"pregunta": "¿Has realizado entrega de valores y arqueos?", "valida": "Entrega de valores y arqueos", "descarta": False},
    ],
}


def preguntas_web_plantilla(nombre: str) -> List[dict]:
    """Preguntas Sí/No de la plantilla `nombre` (Demostrador/Almacenista/Cajero) en la forma PreguntaFiltro."""
    return [
        {"pregunta": p["pregunta"], "tipo": "si_no", "opciones": ["Sí", "No"], "valida": p["valida"],
         "respuesta_esperada": "Sí", "descarta": p["descarta"], "comun": False}
        for p in PREGUNTAS_WEB_PLANTILLA.get(nombre, [])
    ]


def preguntas_web_fraiche(nombre_plantilla: str = "") -> List[dict]:
    """Comunes + las de la plantilla. Es lo que se precarga en `preguntas_filtro` de las 3 plantillas."""
    return [dict(p) for p in PREGUNTAS_WEB_COMUNES] + preguntas_web_plantilla(nombre_plantilla)


def sustituir_placeholders(pregunta: str, *, sucursal: str = "", sueldo: str = "") -> str:
    """[sucursal] y [monto mensual] se sustituyen con lo capturado en la vacante; si RH no lo capturó, se
    deja una redacción neutra (nunca se inventa una sucursal ni un monto)."""
    texto = pregunta.replace("[sucursal]", sucursal.strip() or "la sucursal")
    if "[monto mensual]" in texto:
        texto = texto.replace("[monto mensual]", sueldo.strip()) if sueldo and sueldo != "A convenir" else \
            "¿El sueldo que se te informó está dentro de lo que buscas?"
    return texto


# Resultado del prefiltro web (spec §5): Cumple / Requiere revisión / No cumple, con motivo visible.
RESULTADOS_PREFILTRO_WEB = {"cumple": "Cumple", "revision": "Requiere revisión", "no_cumple": "No cumple"}

# Respuestas que NO deciden (spec §5: «Una respuesta incierta no descarta automáticamente»).
_RESPUESTAS_INCIERTAS = {"parcial", "no se", "no sé", "necesito conocer mas", "necesito conocer más", "no lo se", "tal vez", "depende", ""}


def _norm(t: str) -> str:
    import unicodedata

    return " ".join(unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower().split())


def preguntas_para_vacante(criterios: List[dict], *, sucursal: str = "", sueldo: str = "") -> List[dict]:
    """Criterios de la vacante con los placeholders sustituidos: lo que ve el candidato y lo que se guarda
    como `pregunta` en sus respuestas."""
    salida = []
    for c in criterios or []:
        if not isinstance(c, dict):
            continue
        d = dict(c)
        d["pregunta"] = sustituir_placeholders(str(c.get("pregunta", "")), sucursal=sucursal, sueldo=sueldo)
        salida.append(d)
    return salida


def _clasificar_respuesta(criterio: dict, respuesta: str) -> Optional[bool]:
    """True = cumple, False = no cumple, None = incierta / informativa."""
    tipo = criterio.get("tipo", "si_no")
    r = _norm(respuesta)
    if tipo == "municipio" or tipo == "texto_corto":
        return None  # informativa: se guarda, no se califica
    if r in {_norm(x) for x in _RESPUESTAS_INCIERTAS}:
        return None
    esperadas = {_norm(x) for x in str(criterio.get("respuesta_esperada", "")).split("|") if _norm(x)}
    if not esperadas:
        return None
    if r in esperadas:
        return True
    if tipo == "si_no":
        return False if r in ("no", "no.") else None
    if tipo == "numero":
        return None  # rangos: la IA/RH los interpreta; aquí nunca se descarta por un rango
    return False  # opción concreta distinta de las esperadas


def evaluar_prefiltro_web(criterios: List[dict], respuestas: List[dict], *, sucursal: str = "", sueldo: str = "") -> dict:
    """Spec §5: cada respuesta se clasifica contra los requisitos indispensables de la vacante. Resultado
    Cumple / Requiere revisión / No cumple con motivo visible. Un «No» claro a una pregunta eliminatoria
    (`descarta`) → No cumple; una respuesta incierta (Parcial, No sé, Necesito conocer más, vacía) o un
    «No» a una pregunta no eliminatoria → Requiere revisión; nada de eso → Cumple."""
    preguntas = preguntas_para_vacante(criterios, sucursal=sucursal, sueldo=sueldo)
    por_clave = {c.get("clave"): c for c in preguntas if c.get("clave")}
    por_texto = {_norm(c.get("pregunta", "")): c for c in preguntas}
    detalle: List[dict] = []
    motivos_no: List[str] = []
    motivos_rev: List[str] = []
    for r in respuestas or []:
        pregunta = str(r.get("pregunta", "")).strip()
        crit = por_clave.get(r.get("clave")) if r.get("clave") else None
        crit = crit or por_texto.get(_norm(pregunta))
        respuesta = str(r.get("respuesta", "")).strip()
        if crit is None:
            detalle.append({"pregunta": pregunta, "respuesta": respuesta, "cumple": None, "descarta": False, "valida": "", "comun": False})
            continue
        cumple = _clasificar_respuesta(crit, respuesta)
        valida = crit.get("valida") or pregunta
        descarta = bool(crit.get("descarta"))
        detalle.append({
            "clave": crit.get("clave", ""), "pregunta": crit.get("pregunta", pregunta), "respuesta": respuesta,
            "cumple": cumple, "descarta": descarta, "valida": valida, "comun": bool(crit.get("comun")), "tipo": crit.get("tipo", "si_no"),
        })
        if crit.get("tipo") in ("municipio", "texto_corto"):
            continue
        if cumple is False and descarta:
            motivos_no.append(f"No cumple indispensable: {valida}")
        elif cumple is False:
            motivos_rev.append(f"Por validar: {valida} (respondió «{respuesta}»)")
        elif cumple is None:
            motivos_rev.append(f"Por confirmar: {valida}" + (f" (respondió «{respuesta}»)" if respuesta else " (sin respuesta)"))
    if motivos_no:
        resultado = "no_cumple"
        motivo = "; ".join(motivos_no + motivos_rev)
    elif motivos_rev:
        resultado = "revision"
        motivo = "; ".join(motivos_rev)
    else:
        resultado = "cumple"
        motivo = "Cumple los requisitos indispensables consultados en el formulario."
    return {"resultado": resultado, "etiqueta": RESULTADOS_PREFILTRO_WEB[resultado], "motivo": motivo, "detalle": detalle,
            "cumplidos": sum(1 for d in detalle if d["cumple"] is True), "evaluadas": sum(1 for d in detalle if d.get("tipo") not in ("municipio", "texto_corto") and d["cumple"] is not None)}

# ============================================================
# §6 · Segundo filtro por WhatsApp — guion FIJO, una pregunta por criterio
# ============================================================

# Orden exacto del spec. `informativa=True` (BBVA): se guarda y se muestra en la ficha; NUNCA descarta,
# cambia etapa ni genera revisión. Los placeholders [puesto] se sustituyen con la vacante.
GUION_WHATSAPP: List[dict] = [
    {"clave": "tiempo_reciente", "pregunta": "¿Cuánto tiempo trabajaste en tu empleo más reciente?", "criterio": "Estabilidad laboral"},
    {"clave": "puesto_reciente", "pregunta": "¿Cuál era tu puesto?", "criterio": "Puesto más reciente"},
    {"clave": "funcion_frecuente", "pregunta": "¿Qué función realizabas con más frecuencia?", "criterio": "Funciones"},
    {"clave": "experiencia_acumulada", "pregunta": "¿Cuánto tiempo acumulado tienes en puestos como [puesto]?", "criterio": "Experiencia similar",
     "condicion": "reporto_experiencia_similar"},
    {"clave": "duda_web", "pregunta": "", "criterio": "Duda del prefiltro web", "condicion": "duda_pendiente"},
    {"clave": "inicio", "pregunta": "¿Cuándo podrías empezar a trabajar en [empresa]?", "criterio": "Disponibilidad de inicio"},
    # 2026-10-01 (§7): el sueldo se muestra y se valida AQUÍ (monto, moneda y periodicidad explícitos)
    {"clave": "sueldo_vacante", "pregunta": "El sueldo de esta vacante es de [sueldo]. ¿Estás de acuerdo con ese sueldo? Sí / No",
     "criterio": "Sueldo de la vacante", "condicion": "con_sueldo"},
    {"clave": "adeudo_bbva", "pregunta": "¿Tienes algún adeudo con BBVA? Sí / No", "criterio": "Adeudo con BBVA", "informativa": True},
]

# Resultado del filtro por WhatsApp (spec §6) y su etiqueta para RH.
RESULTADOS_WHATSAPP = {
    "cumple": "Invitar a entrevista inicial",
    "revision": "Revisar por reclutador",
    "no_cumple": "No cumple indispensable",
}

# Aviso que se agrega al consentimiento del candidato por WhatsApp (spec §6: «Incluir esta captura en el
# aviso y consentimiento mostrado al candidato»).
AVISO_CAPTURA_BBVA = (
    "Durante el registro se te preguntará si tienes algún adeudo con BBVA; tu respuesta solo se guarda en tu "
    "expediente y no influye en el resultado de tu postulación."
)
CLAVE_BBVA = "adeudo_bbva"


def _respuesta_web(analisis: dict, clave: str) -> Optional[dict]:
    for d in ((analisis or {}).get("prefiltro_web") or {}).get("detalle") or []:
        if d.get("clave") == clave:
            return d
    return None


def duda_web_pendiente(analisis: dict, *, sucursal: str = "", sueldo: str = "") -> Optional[dict]:
    """Spec §6 pregunta 5: «Si quedó una duda de traslado, sueldo o disponibilidad: una pregunta sobre ese
    único punto». Regresa {clave, criterio, pregunta} de la PRIMERA duda o None."""
    pw = (analisis or {}).get("prefiltro_web") or {}
    for d in pw.get("detalle") or []:
        if not d.get("comun") or d.get("cumple") is not None:
            continue
        clave = d.get("clave", "")
        resp = d.get("respuesta") or "sin respuesta"
        if clave == "traslado":
            lugar = sucursal.strip() or "la sucursal"
            return {"clave": clave, "criterio": "Traslado a la sucursal",
                    "pregunta": f"En el formulario indicaste «{resp}» sobre el tiempo de traslado a {lugar}. ¿Podrías estimarlo con más precisión?"}
        if clave == "sueldo":
            monto = f" ({sueldo})" if sueldo and sueldo != "A convenir" else ""
            return {"clave": clave, "criterio": "Expectativa salarial",
                    "pregunta": f"Sobre el sueldo{monto}, en el formulario pediste conocer más: ¿hay algo que te aclare o está dentro de lo que buscas?"}
        if clave in ("lunes_domingo", "rolados"):
            return {"clave": clave, "criterio": d.get("valida") or "Disponibilidad",
                    "pregunta": f"En el formulario indicaste «{resp}» sobre {str(d.get('valida') or 'tu disponibilidad').lower()}. ¿Me confirmas si sí puedes?"}
    return None


def reporto_experiencia_similar(analisis: dict) -> Optional[bool]:
    d = _respuesta_web(analisis, "puesto_similar")
    if d is None:
        return None
    return d.get("cumple")


def guion_whatsapp(*, titulo_vacante: str, analisis: dict, sucursal: str = "", sueldo: str = "", extras: Optional[List[dict]] = None,
                   empresa: str = "") -> List[dict]:
    """Preguntas del segundo filtro por WhatsApp en la forma que consume `ia.prefiltro_turno` (dicts tipo
    PreguntaFiltro + `clave` / `informativa` / `solo_si`). Orden EXACTO del spec §6; la 4 solo si reportó
    experiencia similar (o no se sabe), la 5 solo si quedó una duda del formulario web; las preguntas
    propias de la vacante (`extras`, si RH capturó alguna) van al final, antes de BBVA."""
    salida: List[dict] = []
    exp = reporto_experiencia_similar(analisis)
    duda = duda_web_pendiente(analisis, sucursal=sucursal, sueldo=sueldo)
    con_sueldo = bool(sueldo) and "convenir" not in sueldo.lower()
    if duda and duda.get("clave") == "sueldo" and con_sueldo:
        duda = None  # la pregunta explícita del sueldo ya cubre esa duda
    for q in GUION_WHATSAPP:
        cond = q.get("condicion")
        if cond == "con_sueldo":
            if not con_sueldo:
                continue
            salida.append({"clave": q["clave"], "pregunta": q["pregunta"].replace("[sueldo]", sueldo), "tipo": "si_no", "valida": q["criterio"],
                           "respuesta_esperada": "Sí", "descarta": False, "informativa": False, "solo_si": ""})
            continue
        if cond == "reporto_experiencia_similar" and exp is False:
            continue
        if cond == "duda_pendiente":
            if not duda:
                continue
            salida.append({"clave": duda["clave"], "pregunta": duda["pregunta"], "tipo": "texto_corto", "valida": duda["criterio"],
                           "respuesta_esperada": "", "descarta": False, "informativa": False})
            continue
        pregunta = q["pregunta"].replace("[puesto]", titulo_vacante or "este").replace("[empresa]", empresa or "la empresa")
        if cond == "reporto_experiencia_similar" and exp is None:
            pregunta = pregunta  # se pregunta igual; el modelo la omite si el candidato dijo no tener experiencia similar
        salida.append({"clave": q["clave"], "pregunta": pregunta, "tipo": "si_no" if q.get("informativa") else "texto_corto",
                       "valida": q["criterio"], "respuesta_esperada": "", "descarta": False, "informativa": bool(q.get("informativa")),
                       "solo_si": "reportó experiencia similar" if cond == "reporto_experiencia_similar" and exp is None else ""})
    bbva = salida.pop()  # BBVA siempre al final, después de las propias de la vacante
    for e in extras or []:
        if isinstance(e, dict) and str(e.get("pregunta", "")).strip():
            salida.append({**e, "informativa": False})
    salida.append(bbva)
    return salida


def respuestas_web_resumen(analisis: dict) -> List[str]:
    """«No repite lo contestado en web»: líneas «pregunta → respuesta» que el agente ya conoce."""
    pw = (analisis or {}).get("prefiltro_web") or {}
    filas = pw.get("detalle") or [{"pregunta": r.get("pregunta"), "respuesta": r.get("respuesta")} for r in (analisis or {}).get("respuestas_web") or []]
    return [f"{f.get('pregunta')} → {f.get('respuesta') or 'sin respuesta'}" for f in filas if f.get("pregunta")]


def extraer_bbva(respuestas_extraidas: List[dict]) -> Optional[str]:
    for r in respuestas_extraidas or []:
        texto = f"{r.get('criterio', '')} {r.get('pregunta', '')}".lower()
        if "bbva" in texto:
            return (r.get("respuesta") or "").strip()[:120]
    return None


def sin_bbva(respuestas_extraidas: List[dict]) -> List[dict]:
    return [r for r in respuestas_extraidas or [] if "bbva" not in f"{r.get('criterio', '')} {r.get('pregunta', '')}".lower()]


def siguiente_accion_whatsapp(resultado: str) -> str:
    return RESULTADOS_WHATSAPP.get(resultado, RESULTADOS_WHATSAPP["revision"])

# ============================================================
# §7 · Entrevista inicial — temas fijos
# ============================================================

# Cambios integrados 2026-10-01 (§7): el sueldo se valida SOLO en el prefiltro por mensaje — la entrevista no lo
# menciona ni lo pregunta (se quitó «expectativa salarial»).
TEMAS_ENTREVISTA_INICIAL: List[str] = [
    "experiencia", "funciones", "estabilidad laboral", "motivos de salida", "disponibilidad",
    "servicio al cliente",
]

# ============================================================
# §8 · Entrevista IPV — rúbrica (misma para Red Human y entrevistador humano)
# ============================================================

COMPETENCIAS_IPV: List[dict] = [
    {"clave": "orientacion_cliente", "nombre": "Orientación al cliente", "peso": 30,
     "situacion": "Un cliente está molesto o exige demasiado", "evidencia": "Escucha, identifica necesidad, ofrece solución"},
    {"clave": "motivacion", "nombre": "Motivación y energía", "peso": 15,
     "situacion": "Hay pocas ventas durante el día", "evidencia": "Iniciativa y constancia"},
    {"clave": "resiliencia", "nombre": "Resiliencia y manejo de estrés", "peso": 10,
     "situacion": "Existe presión por cumplir la meta", "evidencia": "Respuesta ante presión y rechazo"},
    {"clave": "trabajo_equipo", "nombre": "Trabajo en equipo", "peso": 20,
     "situacion": "Apoyó a un compañero", "evidencia": "Colaboración y manejo de conflictos"},
    {"clave": "etica", "nombre": "Ética y responsabilidad", "peso": 20,
     "situacion": "Cometió un error en tienda", "evidencia": "Lo reconoce, comunica y corrige"},
    {"clave": "adaptabilidad", "nombre": "Adaptabilidad", "peso": 5,
     "situacion": "Cambia una promoción o se asignan otras tareas", "evidencia": "Apertura y ejecución"},
]

# Observaciones SIN peso ni porcentaje (spec §8).
OBSERVACIONES_IPV: List[dict] = [
    {"clave": "comunicacion", "nombre": "Comunicación"},
    {"clave": "facilidad_palabra", "nombre": "Facilidad de palabra"},
    {"clave": "manejo_objeciones", "nombre": "Manejo de objeciones"},
]

NIVELES_IPV = ["alto", "medio", "bajo", "sin_evidencia"]
NOMBRE_NIVEL_IPV = {"alto": "Alto", "medio": "Medio", "bajo": "Bajo", "sin_evidencia": "Sin evidencia"}
# Equivalencia por default (ajustable en ConfiguracionSistema.ipv_equivalencias).
EQUIVALENCIAS_IPV_DEFAULT = {"alto": 100, "medio": 70, "bajo": 30}

CONCLUSIONES_IPV = {"recomendable": "Recomendable", "bajo_reserva": "Bajo reserva", "no_recomendable": "No recomendable"}


# Frase FIJA con la que Red Human abre la segunda parte cuando hace las dos entrevistas en la misma
# sesión (spec §8). El servidor parte el transcript aquí para guardar DOS resultados separados.
MARCADOR_IPV = "Ahora pasemos a la segunda parte de la entrevista"

FASES_ENTREVISTA = ["inicial", "ipv", "inicial_ipv"]


def equivalencias_de(db) -> Dict[str, int]:
    """Equivalencias vigentes (ConfiguracionSistema.ipv_equivalencias sobre los defaults)."""
    try:
        from .configuracion import obtener

        cfg = obtener(db)
        extra = {k: int(v) for k, v in (cfg.ipv_equivalencias or {}).items() if k in EQUIVALENCIAS_IPV_DEFAULT}
    except Exception:  # noqa: BLE001 — sin tabla/fila de configuración: defaults
        extra = {}
    return {**EQUIVALENCIAS_IPV_DEFAULT, **extra}


def normalizar_rubrica(rubrica: Optional[dict]) -> dict:
    """{niveles, respuestas, evidencias, observaciones} solo con claves de la rúbrica; niveles válidos."""
    r = rubrica or {}
    claves = [c["clave"] for c in COMPETENCIAS_IPV]
    niveles = {k: (str((r.get("niveles") or {}).get(k, "sin_evidencia") or "sin_evidencia").lower()) for k in claves}
    niveles = {k: (v if v in NIVELES_IPV else "sin_evidencia") for k, v in niveles.items()}
    respuestas = {k: str((r.get("respuestas") or {}).get(k, ""))[:1000] for k in claves}
    evidencias = {k: str((r.get("evidencias") or {}).get(k, ""))[:1000] for k in claves}
    obs_claves = [o["clave"] for o in OBSERVACIONES_IPV]
    observaciones = {k: str((r.get("observaciones") or {}).get(k, ""))[:600] for k in obs_claves}
    return {"niveles": niveles, "respuestas": respuestas, "evidencias": evidencias, "observaciones": observaciones}


def resultado_desde_ipv(calculo: dict) -> Tuple[str, str]:
    """(resultado, recomendacion) de EntrevistaHumana derivados de la conclusión IPV — solo recomendación:
    Recomendable → aprobado/avanzar · Bajo reserva → aprobado/segunda_entrevista · No recomendable →
    no_aprobado/no_avanzar · sin conclusión (falta evidencia) → ""/segunda_entrevista."""
    c = calculo.get("conclusion") or ""
    if c == "recomendable":
        return "aprobado", "avanzar"
    if c == "bajo_reserva":
        return "aprobado", "segunda_entrevista"
    if c == "no_recomendable":
        return "no_aprobado", "no_avanzar"
    return "", "segunda_entrevista"


def sugiere_nueva_ipv(calculo: Optional[dict]) -> bool:
    """Spec §8: «Si sale Bajo reserva o No recomendable, mostrar “Programar nueva IPV humana”»."""
    return bool(calculo) and calculo.get("conclusion") in ("bajo_reserva", "no_recomendable")


def contexto_previo_entrevista(analisis: Optional[dict]) -> List[str]:
    """Spec §7: la entrevista inicial «parte de las respuestas anteriores y repregunta para obtener
    ejemplos; no vuelve a leerle el prefiltro». Líneas «pregunta → respuesta» del prefiltro web y de
    WhatsApp (sin BBVA, que es informativa y sensible)."""
    a = analisis or {}
    lineas = respuestas_web_resumen(a)
    for r in a.get("respuestas_prefiltro") or []:
        if "bbva" in f"{r.get('criterio', '')} {r.get('pregunta', '')}".lower():
            continue
        if r.get("pregunta") and r.get("respuesta"):
            lineas.append(f"{r['pregunta']} → {r['respuesta']}")
    # 2026-10-01: nada de sueldo en la entrevista; ningún código interno de franquicia frente al candidato
    lineas = [texto_publico(x) for x in lineas if not re.search(r"sueldo|salari|\$|monto", x, re.I)]
    return lineas[:20]


def conclusion_ipv(puntaje: Optional[float]) -> str:
    """80–100 Recomendable · 60–79 Bajo reserva · <60 No recomendable. Sin puntaje (falta evidencia) → ""."""
    if puntaje is None:
        return ""
    if puntaje >= 80:
        return "recomendable"
    if puntaje >= 60:
        return "bajo_reserva"
    return "no_recomendable"


def calcular_ipv(niveles: Dict[str, str], equivalencias: Optional[Dict[str, int]] = None) -> dict:
    """Suma ponderada de las 6 competencias. `niveles` = {clave: alto|medio|bajo|sin_evidencia}. Si falta
    evidencia en alguna, NO se genera nota ficticia: el resultado queda `requiere_revision=True` y sin
    conclusión (spec §8)."""
    eq = {**EQUIVALENCIAS_IPV_DEFAULT, **(equivalencias or {})}
    total = 0.0
    sin_evidencia = []
    detalle = []
    for c in COMPETENCIAS_IPV:
        nivel = (niveles or {}).get(c["clave"], "sin_evidencia") or "sin_evidencia"
        if nivel not in eq:
            sin_evidencia.append(c["nombre"])
            detalle.append({"clave": c["clave"], "nombre": c["nombre"], "peso": c["peso"], "nivel": "sin_evidencia", "puntos": None})
            continue
        puntos = round(eq[nivel] * c["peso"] / 100, 2)
        total += puntos
        detalle.append({"clave": c["clave"], "nombre": c["nombre"], "peso": c["peso"], "nivel": nivel, "puntos": puntos})
    if sin_evidencia:
        return {"puntaje": None, "conclusion": "", "requiere_revision": True, "sin_evidencia": sin_evidencia, "detalle": detalle, "equivalencias": eq}
    puntaje = round(total, 1)
    return {"puntaje": puntaje, "conclusion": conclusion_ipv(puntaje), "requiere_revision": False, "sin_evidencia": [], "detalle": detalle, "equivalencias": eq}


# ============================================================
# §9 · Psicometría (Evaluatest) — campos que muestra la ficha
# ============================================================

PROVEEDOR_EVALUATEST = "Evaluatest"
CAMPOS_EVALUATEST: List[dict] = [
    {"clave": "indice_afinidad", "nombre": "Índice Evaluatest de Afinidad", "tipo": "porcentaje"},
    {"clave": "igi", "nombre": "Etegrity / Índice General de Integridad", "tipo": "porcentaje"},
    {"clave": "competencias", "nombre": "Competencias", "tipo": "lista"},
    {"clave": "fortalezas", "nombre": "Fortalezas", "tipo": "lista"},
    {"clave": "areas_oportunidad", "nombre": "Áreas de oportunidad", "tipo": "lista"},
    {"clave": "riesgo", "nombre": "Riesgo", "tipo": "texto"},
]
# Baterías informadas por plantilla (spec §9). Cajero NO tiene batería asignada: «No asignar a Cajero una
# batería supuesta».
BATERIAS_EVALUATEST = {"Demostrador": "Batería Demostrador", "Almacenista": "Batería Almacenista", "Encargado": "Batería Encargado"}

# ============================================================
# §10 · Evaluaciones con personas externas
# ============================================================

ESTADOS_EVALUACION_EXTERNA = {
    "pendiente": "Pendiente",
    "realizada_pendiente": "Realizada con resultado pendiente",
    "con_resultado": "Con resultado",
    "no_realizada": "No realizada",
    "cancelada": "Cancelada",
}
# Dictamen médico (spec §10): el médico elige Apto / Apto condicionado / No recomendable; se guarda
# internamente como Favorable / Con observaciones / Desfavorable.
DICTAMEN_MEDICO_FRAICHE = {"apto": "Apto", "apto_condicionado": "Apto condicionado", "no_recomendable": "No recomendable"}
DICTAMEN_MEDICO_A_INTERNO = {"apto": "favorable", "apto_condicionado": "con_observaciones", "no_recomendable": "desfavorable"}
NOMBRE_EVALUACION_FRANQUICIATARIO = "Entrevista con franquiciatario"
NOMBRE_EVALUACION_ENCARGADO = "Entrevista con encargado de tienda"
DECISIONES_FRANQUICIATARIO = {"continuar": "Continuar", "no_continuar": "No continuar"}
DECISION_FRANQUICIATARIO_A_INTERNO = {"continuar": "favorable", "no_continuar": "desfavorable"}

# ============================================================
# §11-12 · Ruta visible por destino (pasos) → etapa interna
# ============================================================

# La etapa interna (models.ETAPAS_CANDIDATO) NO cambia: el paso visible se mapea a ella para que conteos,
# notificaciones, WhatsApp y todo lo existente sigan funcionando.
PASOS: Dict[str, dict] = {
    "nuevo": {"nombre": "Nuevo", "etapa": "Prefiltro"},
    "prefiltro_web": {"nombre": "Prefiltro web", "etapa": "Prefiltro"},
    # Pipeline v2 (2026-10-01): columnas Prefiltro → Filtro Red Human → Filtro humano → Contratación → Onboarding
    "filtro_whatsapp": {"nombre": f"Filtro {_canal.nombre()}", "etapa": "Entrevista IA"},
    "entrevista_inicial": {"nombre": "Entrevista Red Human", "etapa": "Entrevista IA"},
    "ipv": {"nombre": "IPV", "etapa": "Entrevista Humana"},
    "psicometria": {"nombre": "Psicometría", "etapa": "Entrevista Humana"},
    "evaluaciones_adicionales": {"nombre": "Evaluaciones adicionales", "etapa": "Entrevista Humana"},
    "referencias": {"nombre": "Referencias laborales", "etapa": "Entrevista Humana"},
    "documentacion": {"nombre": "Documentación y onboarding", "etapa": "Contratación"},
    "listo_alta": {"nombre": "Listo para alta", "etapa": "Onboarding"},
    "listo_sap": {"nombre": "Listo para enviar a SAP", "etapa": "Onboarding"},
    "presentacion": {"nombre": "Presentación al franquiciatario", "etapa": "Entrevista Humana"},
}
RUTA_TIENDA_PROPIA: List[str] = [
    "nuevo", "prefiltro_web", "filtro_whatsapp", "entrevista_inicial", "ipv", "psicometria",
    "evaluaciones_adicionales", "referencias", "documentacion", "listo_alta", "listo_sap",
]
# Franquicia: sin IPV ni psicometría (Cambios integrados 2026-10-01)
RUTA_FRANQUICIA: List[str] = [
    "nuevo", "prefiltro_web", "filtro_whatsapp", "entrevista_inicial", "presentacion",
]
ESTADOS_FRANQUICIA = {"presentado": "Presentado", "aceptado": "Aceptado por franquiciatario", "no_aceptado": "No aceptado"}


def ruta_de(destino: str) -> List[str]:
    return RUTA_FRANQUICIA if destino == "franquicia" else RUTA_TIENDA_PROPIA


def etapa_de_paso(paso: str) -> str:
    return PASOS.get(paso, {}).get("etapa", "Prefiltro")


def paso_default(etapa: str, destino: str = "tienda_propia") -> str:
    """Primer paso de la ruta que cae en esa etapa interna (postulaciones previas sin `paso`)."""
    for p in ruta_de(destino):
        if PASOS[p]["etapa"] == etapa:
            return p
    return ruta_de(destino)[0]


def destino_de(p) -> str:
    v = getattr(p, "vacante", None)
    return (getattr(v, "destino", "") or "tienda_propia") if v else "tienda_propia"


def paso_visible(p) -> str:
    """Paso de la ruta que muestra el Kanban: el guardado si sigue siendo válido para la ruta, si no el que
    corresponde a la etapa interna."""
    ruta = ruta_de(destino_de(p))
    paso = getattr(p, "paso", "") or ""
    if paso in ruta and PASOS[paso]["etapa"] == p.etapa:
        return paso
    if paso in ruta and p.etapa == "Onboarding" and paso in ("listo_alta", "listo_sap"):
        return paso
    return paso_default(p.etapa, destino_de(p))


def ruta_visible(p) -> List[dict]:
    return [{"clave": k, "nombre": PASOS[k]["nombre"], "etapa": PASOS[k]["etapa"]} for k in ruta_de(destino_de(p))]


def avanzar_paso(p, paso: str) -> bool:
    """Los EVENTOS del proceso registran el paso alcanzado sin retroceder nunca (el retroceso lo decide RH con
    PATCH /paso). Regresa True si cambió. No toca `etapa`."""
    ruta = ruta_de(destino_de(p))
    if paso not in ruta:
        return False
    actual = paso_visible(p)
    if ruta.index(paso) <= ruta.index(actual) and (p.paso or "") == actual:
        return False
    if ruta.index(paso) < ruta.index(actual):
        return False
    p.paso = paso
    return True


# ============================================================
# §11 · Datos para alta en SAP SuccessFactors — vista previa con origen por campo
# ============================================================

ORIGEN_RH = "Capturado por RH"


def datos_alta_sap(p, e, cuenta=None) -> dict:
    """Arma los bloques del spec §11 con valor y ORIGEN por campo. Excluye SIEMPRE lo médico y lo socioeconómico.
    Nada se envía a SAP; no se asigna número de empleado."""
    c = p.candidato
    v = p.vacante
    dp = dict((c.datos_personales or {}) if c else {})
    origenes = dict(dp.get("origen") or {})
    da = dict((e.datos_alta or {}) if e else {})

    def campo(clave, valor, origen):
        if clave in da and str(da[clave]).strip():
            return {"clave": clave, "valor": str(da[clave]), "origen": (da.get("origen") or {}).get(clave) or ORIGEN_RH, "faltante": False}
        val = "" if valor is None else str(valor)
        return {"clave": clave, "valor": val, "origen": origen if val else "Pendiente de capturar", "faltante": not val}

    def personal(clave):
        if clave == "domicilio" and not dp.get("domicilio") and c is not None and (c.ubicacion or "").strip():
            # 2026-10-01: domicilio vigente ÚNICO — sin captura propia se usa el de la ficha
            return campo("domicilio", c.ubicacion, "Ficha del candidato")
        return campo(clave, dp.get(clave, ""), origenes.get(clave) or (ORIGEN_RH if dp.get(clave) else ""))

    fecha_ingreso = (e.fecha_ingreso_real or e.fecha_ingreso) if e else None
    sueldo = (e.sueldo if e else "") or ""
    bloques = []
    for b in BLOQUES_SAP:
        campos = []
        for clave, nombre in b["campos"]:
            if clave == "nombre":
                x = campo("nombre", c.nombre if c else "", "Ficha del candidato")
            elif clave in ("fecha_nacimiento", "genero", "curp", "rfc", "nss", "domicilio"):
                x = personal(clave)
            elif clave == "correo":
                x = campo("correo", c.correo if c else "", "Ficha del candidato")
            elif clave == "telefono":
                x = campo("telefono", c.telefono if c else "", "Ficha del candidato")
            elif clave == "empresa":
                x = campo("empresa", (e.empresa if e else "") or "", "Condiciones de contratación")
            elif clave == "sucursal":
                x = campo("sucursal", (v.sucursal if v else "") or "", "Vacante")
            elif clave == "puesto":
                x = campo("puesto", (e.puesto if e else "") or (v.titulo if v else ""), "Condiciones de contratación" if e and e.puesto else "Vacante")
            elif clave == "jefe":
                x = campo("jefe", (e.jefe_directo if e else "") or "", "Condiciones de contratación")
            elif clave == "fecha_ingreso":
                x = campo("fecha_ingreso", fecha_ingreso.date().isoformat() if fecha_ingreso else "", "Ingreso confirmado" if e and e.fecha_ingreso_real else "Condiciones de contratación")
            elif clave == "tipo_contratacion":
                x = campo("tipo_contratacion", (e.tipo_contratacion if e else "") or "", "Condiciones de contratación")
            elif clave == "sueldo":
                x = campo("sueldo", sueldo, "Condiciones de contratación")
            elif clave == "horario":
                x = campo("horario", (v.horario if v else "") or "", "Vacante")
            elif clave == "periodicidad":
                x = campo("periodicidad", (v.sueldo_periodicidad if v else "") or "", "Vacante")
            else:
                x = campo(clave, "", "")
            x["nombre"] = nombre
            campos.append(x)
        bloques.append({"clave": b["clave"], "nombre": b["nombre"], "campos": campos})
    faltantes = [x["nombre"] for b in bloques for x in b["campos"] if x["faltante"] and x["clave"] not in ("genero", "horario", "periodicidad", "jefe", "domicilio", "correo")]
    return {
        "bloques": bloques,
        "faltantes": faltantes,
        "excluye": ["Información médica", "Información socioeconómica"],
        "estadoSap": (e.estado_sap if e else "") or "",
        "estadoSapTexto": "Listo para enviar a SAP" if e and e.estado_sap == ESTADO_LISTO_SAP else "Por preparar",
        "mensaje": MENSAJE_SAP_PENDIENTE,
        "confirmadoPor": (e.sap_confirmado_por if e else "") or "",
        "confirmadoEn": e.sap_confirmado_en.isoformat() if e and e.sap_confirmado_en else None,
    }


CAMPOS_PERSONALES_SAP = ("curp", "rfc", "nss", "domicilio", "fecha_nacimiento", "genero")
CAMPOS_ALTA_EDITABLES = ("nombre", "correo", "telefono", "empresa", "sucursal", "puesto", "jefe", "fecha_ingreso", "tipo_contratacion", "sueldo", "horario", "periodicidad")


# ============================================================
# §11 · Alta en SAP SuccessFactors — bloques de la vista previa
# ============================================================

BLOQUES_SAP: List[dict] = [
    {"clave": "datos_personales", "nombre": "Datos personales",
     "campos": [("nombre", "Nombre completo"), ("fecha_nacimiento", "Fecha de nacimiento"), ("genero", "Género (opcional)")]},
    {"clave": "identificadores", "nombre": "Identificadores",
     "campos": [("curp", "CURP"), ("rfc", "RFC"), ("nss", "NSS")]},
    {"clave": "contacto", "nombre": "Contacto y domicilio",
     "campos": [("correo", "Correo"), ("telefono", f"Teléfono / {_canal.nombre()}"), ("domicilio", "Domicilio")]},
    {"clave": "puesto", "nombre": "Empresa, sucursal, puesto, jefe y fecha de ingreso",
     "campos": [("empresa", "Empresa"), ("sucursal", "Sucursal"), ("puesto", "Puesto"), ("jefe", "Jefe directo"), ("fecha_ingreso", "Fecha de ingreso")]},
    {"clave": "condiciones", "nombre": "Condiciones de empleo y compensación",
     "campos": [("tipo_contratacion", "Tipo de contratación"), ("sueldo", "Sueldo"), ("horario", "Horario"), ("periodicidad", "Periodicidad de pago")]},
]
ESTADO_LISTO_SAP = "listo_para_enviar_sap"
MENSAJE_SAP_PENDIENTE = "Conexión con SAP pendiente de configurar"


# ============================================================
# Cambios integrados 2026-10-01 · lo que ve el candidato
# ============================================================

_RE_FRANQUICIA = re.compile(r"\bFranquicia\s*(?:No\.?\s*)?\d{1,4}\b\s*[·\-–,:]?\s*", re.I)


def sucursal_publica(sucursal: str) -> str:
    """Sucursal tal como la ve el candidato: sin «Franquicia 001»/«002» ni códigos internos (se conservan en la base)."""
    return re.sub(r"\s{2,}", " ", _RE_FRANQUICIA.sub("", sucursal or "")).strip(" ·-–,")


def texto_publico(texto: str, empresa: str = "Fraiche") -> str:
    """Quita identificadores internos de franquicia de cualquier texto que llegue al candidato (guion, audio, subtítulos)."""
    t = _RE_FRANQUICIA.sub(f"{empresa} ", texto or "")
    t = re.sub(rf"\b{re.escape(empresa)}\s+{re.escape(empresa)}\b", empresa, t)
    return re.sub(r"\s{2,}", " ", t).strip()


_UNIDADES = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
             "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
             "veintiséis", "veintisiete", "veintiocho", "veintinueve"]
_DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
_CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"]


def _menor_mil(n: int) -> str:
    if n == 0:
        return ""
    if n == 100:
        return "cien"
    c, r = divmod(n, 100)
    partes = [_CENTENAS[c]] if c else []
    if r < 30:
        partes.append(_UNIDADES[r])
    else:
        d, u = divmod(r, 10)
        partes.append(_DECENAS[d] + (f" y {_UNIDADES[u]}" if u else ""))
    return " ".join(x for x in partes if x)


def numero_a_palabras(n: int) -> str:
    """Entero 0-999,999,999 en palabras (español de México), para que un sueldo nunca se lea como decimales o dólares."""
    n = int(n)
    if n == 0:
        return "cero"
    millones, resto = divmod(n, 1_000_000)
    miles, unidades = divmod(resto, 1000)
    partes = []
    if millones:
        partes.append("un millón" if millones == 1 else f"{_menor_mil(millones)} millones")
    if miles:
        partes.append("mil" if miles == 1 else f"{_menor_mil(miles)} mil")
    if unidades:
        partes.append(_menor_mil(unidades))
    return " ".join(partes).strip()


_PERIODO_PALABRAS = {"mensual": "al mes", "quincenal": "a la quincena", "semanal": "a la semana", "diario": "al día", "anual": "al año", "por_hora": "por hora"}


def sueldo_candidato(v) -> str:
    """Sueldo inequívoco para el candidato: «$11,500 MXN mensuales (once mil quinientos pesos mexicanos al mes)».
    Corrige la lectura «11 dólares con 50 centavos» de «$11,500». Sin monto capturado → «A convenir»."""
    if v is None:
        return ""
    desde, hasta = v.sueldo_desde, v.sueldo_hasta
    base = v.sueldo or ""
    monto = desde or hasta
    if not monto or "convenir" in base.lower():
        return base or "A convenir"
    moneda = (v.sueldo_moneda or "MXN").upper()
    nombre_moneda = "pesos mexicanos" if moneda == "MXN" else ("dólares estadounidenses" if moneda == "USD" else moneda)
    periodo = _PERIODO_PALABRAS.get(v.sueldo_periodicidad or "", "")
    if desde and hasta and hasta != desde:
        palabras = f"de {numero_a_palabras(desde)} a {numero_a_palabras(hasta)} {nombre_moneda}"
    else:
        palabras = f"{numero_a_palabras(monto)} {nombre_moneda}"
    return f"{base} ({palabras}{(' ' + periodo) if periodo else ''})"



def cambiar_domicilio(dp: dict, c, nuevo: str, por: str, origen: str) -> bool:
    """2026-10-01: domicilio vigente ÚNICO (ficha y formulario de alta). Escribe `dp["domicilio"]` y deja el valor
    anterior en `dp["historial_domicilio"]` (quién, cuándo, desde dónde). Regresa True si cambió."""
    from datetime import datetime, timezone

    anterior = str(dp.get("domicilio") or (c.ubicacion if c is not None else "") or "").strip()
    nuevo = (nuevo or "").strip()
    if nuevo == anterior:
        return False
    dp["domicilio"] = nuevo
    dp["historial_domicilio"] = list(dp.get("historial_domicilio") or []) + [
        {"anterior": anterior, "nuevo": nuevo, "por": por, "origen": origen, "fecha": datetime.now(timezone.utc).isoformat()}
    ]
    return True
