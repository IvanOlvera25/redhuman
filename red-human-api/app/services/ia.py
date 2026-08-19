"""
Servicio de IA — OpenAI.

API necesaria: OPENAI_API_KEY  →  https://platform.openai.com (API Keys)
Sin clave, cada función regresa un resultado determinista en "modo demo"
para que la plataforma siga funcionando de punta a punta.
"""

from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

from ..config import settings

MODEL = settings.openai_model  # gpt-5.6-luna (configurable con OPENAI_MODEL en .env)


def _client():
    if not settings.openai_api_key:
        return None
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


def ia_activa() -> bool:
    return bool(settings.openai_api_key)


# ============================================================
# 1) Generador de publicaciones de vacante (módulo 3.5)
# ============================================================

SENIORITY = Literal["Sin experiencia", "Junior", "Semi-senior", "Senior", "Jefatura", "Dirección"]


class BloquePlataforma(BaseModel):
    """Publicación lista para pegar en una plataforma concreta.

    `texto_copy` viaja como `copy` en el JSON (alias): `copy` chocaría con un
    atributo de BaseModel, pero es el nombre que espera el frontend.
    """

    model_config = ConfigDict(populate_by_name=True)

    titulo: str = Field(description="Título del puesto optimizado para esta plataforma.")
    texto_copy: str = Field(alias="copy", description="Texto corto de difusión (anuncio/post) para esta plataforma.")
    page: str = Field(description="Cuerpo completo de la publicación, listo para pegar en el formulario de la plataforma.")
    etiquetas: List[str] = Field(description="Palabras clave o skills que usa esta plataforma para hacer match.")

    def bloque(self) -> dict:
        return self.model_dump(by_alias=True)


class PreguntaFiltro(BaseModel):
    """Pregunta de prefiltro ligada a un requisito, con criterio de descarte explícito."""

    pregunta: str = Field(description="Pregunta cerrada, en español mexicano, directa al candidato.")
    tipo: Literal["si_no", "numero", "opcion", "texto_corto"]
    valida: str = Field(description="Requisito indispensable que valida esta pregunta.")
    respuesta_esperada: str = Field(description="Respuesta que indica que la persona cumple (ej. 'Sí', '>= 2 años').")
    descarta: bool = Field(description="true si NO cumplirla es motivo de descarte (knock-out) para este puesto.")


class VacanteGenerada(BaseModel):
    resumen: str = Field(description="Gancho de 1-2 frases que resume la oportunidad.")
    descripcion: str = Field(description="Descripción del puesto en 2-3 párrafos cortos, español mexicano, sin exagerar.")
    perfil_ideal: str = Field(description="En 2-3 frases, a quién le queda esta vacante (experiencia, actitudes, contexto).")
    responsabilidades: List[str] = Field(description="5 a 7 actividades principales del puesto, en infinitivo.")
    requisitos_indispensables: List[str] = Field(description="4 a 6 requisitos sin los cuales la persona no puede ocupar el puesto.")
    requisitos_deseables: List[str] = Field(description="2 a 4 requisitos que suman pero no descartan.")
    beneficios: List[str] = Field(description="Prestaciones y beneficios; SOLO los que se puedan sostener con los datos dados.")
    palabras_clave: List[str] = Field(description="8 a 12 términos con los que los candidatos en México buscan este puesto.")
    seniority: SENIORITY
    rango_salarial_sugerido: str = Field(description="Rango mensual bruto en MXN sugerido para el puesto y la plaza.")
    avisos_cumplimiento: List[str] = Field(
        description="Ajustes hechos por cumplimiento legal mexicano (LFT art. 3 y 133: no discriminación) o datos faltantes que RH debe confirmar."
    )
    texto_whatsapp: str = Field(description="Mensaje breve para WhatsApp/estados, emojis moderados, con llamado a la acción.")
    occ: BloquePlataforma = Field(description="Publicación para OCC Mundial.")
    linkedin: BloquePlataforma = Field(description="Publicación para LinkedIn.")
    portal: BloquePlataforma = Field(description="Publicación para el portal propio de Red Human.")
    preguntas_filtro: List[PreguntaFiltro] = Field(description="4 a 6 preguntas de prefiltro ligadas a los requisitos indispensables.")


_PLANTILLAS = (
    "PLANTILLAS POR PLATAFORMA — respeta el formato de cada una:\n\n"
    "OCC Mundial (occ.com.mx):\n"
    "· titulo: máx. 70 caracteres, sin emojis, formato «Puesto - Ciudad».\n"
    "· copy: 1 párrafo de máx. 300 caracteres para el anuncio destacado; menciona sueldo y ciudad.\n"
    "· page: TEXTO PLANO (OCC no admite markdown). Secciones en MAYÚSCULAS seguidas de viñetas con «• »:\n"
    "  SOBRE LA VACANTE / ACTIVIDADES PRINCIPALES / REQUISITOS / OFRECEMOS / CÓMO POSTULARTE.\n"
    "· etiquetas: 6-10 términos de búsqueda que usa un candidato mexicano en OCC.\n\n"
    "LinkedIn:\n"
    "· titulo: máx. 100 caracteres, incluye seniority y modalidad (Presencial/Híbrido/Remoto).\n"
    "· copy: post para el feed de la página, máx. 700 caracteres. Primera línea = gancho de una sola frase, "
    "luego 3-4 renglones cortos, cierra con llamado a la acción y exactamente 3 hashtags al final.\n"
    "· page: descripción para LinkedIn Jobs con encabezados en negritas markdown y viñetas «- »:\n"
    "  **Sobre el rol** / **Lo que harás** / **Lo que buscamos** / **Lo que ofrecemos**.\n"
    "· etiquetas: skills tal como aparecen en el catálogo de LinkedIn.\n\n"
    "Portal propio (página pública /aplicar):\n"
    "· titulo: título comercial y claro.\n"
    "· copy: meta descripción SEO de máx. 160 caracteres.\n"
    "· page: texto de la landing con markdown, cálido y en segunda persona («tú»), cerrando con la invitación a postularse.\n"
    "· etiquetas: palabras clave para SEO."
)

_REGLAS = (
    "Eres el redactor de vacantes de Red Human AI, plataforma de RH en México. Escribes en español mexicano, "
    "claro, inclusivo y concreto.\n"
    "REGLAS:\n"
    "1. Nunca inventes prestaciones, sueldos, horarios ni condiciones que no se deriven de los datos recibidos. "
    "Si falta un dato relevante, NO lo inventes: anótalo en avisos_cumplimiento para que RH lo confirme.\n"
    "2. Cumplimiento LFT (art. 3 y 133): prohibido pedir o insinuar edad, sexo, estado civil, embarazo, religión, "
    "apariencia, origen étnico, condición de salud u orientación. Si el usuario los incluyó en los requisitos, "
    "reescríbelos en términos de competencias y regístralo en avisos_cumplimiento.\n"
    "3. Usa lenguaje incluyente con la forma «(a)» del español mexicano (Cajero(a), Repartidor(a)).\n"
    "4. Las preguntas de prefiltro deben responderse en una línea y marcar descarta=true SOLO cuando el requisito "
    "sea realmente indispensable.\n"
    "5. Cada plataforma tiene su propio tono y formato: no repitas el mismo texto en las tres.\n"
    "6. Todo lo que escribas en `copy` y `page` lo lee el candidato. Nunca uses etiquetas internas como "
    "«indicado por RH», «según RH» o «no especificado»: escribe el sueldo directo («$10,500 mensuales») y, si "
    "un dato falta, simplemente omítelo del texto público y anótalo en avisos_cumplimiento.\n"
    "7. El seniority que elijas debe ser el mismo en los títulos de todas las plataformas; no lo contradigas."
)


def _demo_vacante(titulo: str, area: str, ubicacion: str, sueldo: str, requisitos: str, empresa: str) -> VacanteGenerada:
    """Plantilla determinista para modo demo (sin OPENAI_API_KEY) — misma estructura que la salida de IA."""
    reqs = [r.strip(" .") for r in requisitos.replace(";", ",").split(",") if r.strip()] or [
        "Disponibilidad de horario",
        "Documentación en regla (INE, CURP, RFC)",
    ]
    actividades = [
        f"Ejecutar las actividades diarias del puesto de {titulo}.",
        f"Coordinarte con el equipo de {area or 'la operación'} para cumplir los objetivos.",
        "Reportar avances e incidencias a tu jefe(a) directo(a).",
        "Cuidar el orden, la seguridad y la calidad en tu área de trabajo.",
        "Dar seguimiento a los indicadores del puesto.",
    ]
    beneficios = ["Sueldo " + sueldo, "Prestaciones de ley (IMSS, aguinaldo, vacaciones)", "Capacitación pagada", "Oportunidad de crecimiento"]
    viñetas = "\n".join(f"• {r}" for r in reqs)
    lista_act = "\n".join(f"• {a}" for a in actividades)
    lista_ben = "\n".join(f"• {b}" for b in beneficios)

    return VacanteGenerada(
        resumen=f"Buscamos {titulo} para {empresa} en {ubicacion}. Sueldo {sueldo} y prestaciones de ley.",
        descripcion=(
            f"{empresa} busca {titulo} para su equipo de {area or 'operación'} en {ubicacion}.\n\n"
            f"Es una posición {('clave' if area else 'operativa')} en la que tendrás actividades claras, "
            "capacitación desde el primer día y un equipo que te acompaña.\n\n"
            f"Ofrecemos sueldo de {sueldo}, prestaciones de ley y crecimiento real dentro de la empresa."
        ),
        perfil_ideal=(
            "Personas responsables, con actitud de servicio y disponibilidad para cumplir el horario del puesto. "
            "Se valora experiencia previa en actividades similares."
        ),
        responsabilidades=actividades,
        requisitos_indispensables=reqs,
        requisitos_deseables=["Experiencia previa en un puesto similar", "Vivir cerca de la zona de trabajo"],
        beneficios=beneficios,
        palabras_clave=[titulo.lower(), (area or "empleo").lower(), ubicacion.lower(), "vacante", "empleo", "contratación inmediata"],
        seniority="Junior",
        rango_salarial_sugerido=sueldo,
        avisos_cumplimiento=["Modo demo: agrega OPENAI_API_KEY en la API para generar el contenido con IA."],
        texto_whatsapp=(
            f"📢 *{titulo}* — {ubicacion}\n💰 {sueldo}\n✅ Prestaciones de ley\n\n"
            "Contéstame por aquí y en 2 minutos hacemos tu registro. ¡Va! 🙌"
        ),
        occ=BloquePlataforma(
            titulo=f"{titulo} - {ubicacion}"[:70],
            copy=f"{empresa} solicita {titulo} en {ubicacion}. Sueldo {sueldo} más prestaciones de ley. Postúlate hoy."[:300],
            page=(
                f"SOBRE LA VACANTE\n{empresa} busca {titulo} para su equipo en {ubicacion}.\n\n"
                f"ACTIVIDADES PRINCIPALES\n{lista_act}\n\nREQUISITOS\n{viñetas}\n\nOFRECEMOS\n{lista_ben}\n\n"
                "CÓMO POSTULARTE\n• Envía tu CV por este medio y el equipo de RH te contactará."
            ),
            etiquetas=[titulo.lower(), area.lower() or "empleo", ubicacion.lower(), "vacante", "tiempo completo"],
        ),
        linkedin=BloquePlataforma(
            titulo=f"{titulo} | {empresa} | {ubicacion}"[:100],
            copy=(
                f"Estamos contratando: {titulo} en {ubicacion}.\n\n"
                f"En {empresa} buscamos a alguien que quiera crecer con nosotros.\n"
                f"Sueldo: {sueldo} + prestaciones de ley.\n\n"
                "¿Te interesa o conoces a alguien? Postúlate desde la liga de esta publicación.\n\n"
                "#Empleo #Vacantes #México"
            ),
            page=(
                f"**Sobre el rol**\n{titulo} en {ubicacion} para el equipo de {area or 'operación'} de {empresa}.\n\n"
                "**Lo que harás**\n" + "\n".join(f"- {a}" for a in actividades) + "\n\n"
                "**Lo que buscamos**\n" + "\n".join(f"- {r}" for r in reqs) + "\n\n"
                "**Lo que ofrecemos**\n" + "\n".join(f"- {b}" for b in beneficios)
            ),
            etiquetas=[titulo, area or "Operaciones", "Trabajo en equipo", "Atención al cliente"],
        ),
        portal=BloquePlataforma(
            titulo=titulo,
            copy=f"{titulo} en {ubicacion}. Sueldo {sueldo}, prestaciones de ley y crecimiento. Postúlate en 2 minutos."[:160],
            page=(
                f"## {titulo}\n\n¿Buscas trabajo en {ubicacion}? En {empresa} estamos contratando.\n\n"
                "**Lo que harás**\n" + "\n".join(f"- {a}" for a in actividades) + "\n\n"
                "**Lo que necesitas**\n" + "\n".join(f"- {r}" for r in reqs) + "\n\n"
                "**Lo que te damos**\n" + "\n".join(f"- {b}" for b in beneficios) + "\n\n"
                "Postúlate en 2 minutos: solo necesitas tu CV o responder unas preguntas rápidas."
            ),
            etiquetas=[titulo.lower(), f"empleo {ubicacion.lower()}", "vacante"],
        ),
        preguntas_filtro=[
            PreguntaFiltro(
                pregunta="¿Cuentas con disponibilidad de horario para el puesto?",
                tipo="si_no", valida="Disponibilidad de horario", respuesta_esperada="Sí", descarta=True,
            ),
            PreguntaFiltro(
                pregunta="¿Cuántos años de experiencia tienes en un puesto similar?",
                tipo="numero", valida="Experiencia previa", respuesta_esperada=">= 1 año", descarta=False,
            ),
            PreguntaFiltro(
                pregunta=f"¿Vives en {ubicacion} o puedes trasladarte diariamente?",
                tipo="si_no", valida="Ubicación", respuesta_esperada="Sí", descarta=True,
            ),
            PreguntaFiltro(
                pregunta="¿Tienes tu documentación en regla (INE, CURP, RFC)?",
                tipo="si_no", valida="Documentación", respuesta_esperada="Sí", descarta=False,
            ),
        ],
    )


def generar_vacante(
    titulo: str,
    area: str,
    ubicacion: str,
    sueldo: str,
    requisitos: str,
    empresa: str = "Grupo Carbe",
    modalidad: str = "Presencial",
    notas: str = "",
) -> Tuple[VacanteGenerada, bool]:
    client = _client()
    if client is None:
        return _demo_vacante(titulo, area, ubicacion, sueldo, requisitos, empresa), False

    resp = client.responses.parse(
        model=MODEL,
        instructions=f"{_REGLAS}\n\n{_PLANTILLAS}",
        input=(
            "Ficha capturada por RH (insumo interno, no la cites literalmente):\n"
            f"- Puesto: {titulo}\n- Área: {area or '(sin dato)'}\n- Empresa: {empresa}\n"
            f"- Ubicación: {ubicacion}\n- Modalidad: {modalidad}\n- Sueldo: {sueldo}\n"
            f"- Requisitos indispensables: {requisitos or '(sin dato)'}\n"
            f"- Notas adicionales: {notas or '(ninguna)'}\n\n"
            "Genera la publicación completa a partir de esta ficha."
        ),
        text_format=VacanteGenerada,
    )
    return resp.output_parsed, True


def texto_preguntas(preguntas: Optional[list]) -> List[str]:
    """Normaliza preguntas de filtro: acepta la forma vieja (list[str]) y la nueva (list[PreguntaFiltro])."""
    salida: List[str] = []
    for p in preguntas or []:
        if isinstance(p, str):
            salida.append(p)
        elif isinstance(p, dict) and p.get("pregunta"):
            salida.append(str(p["pregunta"]))
    return salida


def criterios_prefiltro(preguntas: Optional[list]) -> str:
    """Resumen legible de los criterios de descarte para el prompt del agente de prefiltro."""
    lineas = []
    for p in preguntas or []:
        if isinstance(p, dict) and p.get("pregunta"):
            marca = "DESCARTA si no cumple" if p.get("descarta") else "suma pero no descarta"
            lineas.append(f"- {p['pregunta']} → esperado: {p.get('respuesta_esperada', 'n/d')} ({marca})")
        elif isinstance(p, str):
            lineas.append(f"- {p}")
    return "\n".join(lineas) or "- (sin criterios definidos)"


# ============================================================
# 2) Extractor de información de CVs (módulo 3.7)
# ============================================================


class AjustePerfil(BaseModel):
    """Qué tanto empata el CV con la vacante — RECOMENDACIÓN, no decisión (LFPDPPP)."""

    score: int = Field(description="0-100, empate del CV con los requisitos de la vacante.")
    estado: Literal["cumple", "revision", "no_cumple"]
    requisitos_cumplidos: List[str] = Field(description="Requisitos que el CV sí acredita, citando dónde.")
    brechas: List[str] = Field(description="Requisitos indispensables que el CV NO acredita o deja en duda.")
    evidencia: str = Field(description="1-2 frases objetivas que sustentan el score, citando el CV.")


class CVExtraido(BaseModel):
    nombre: Optional[str] = Field(default=None, description="Nombre completo del candidato.")
    correo: Optional[str] = None
    telefono: Optional[str] = Field(default=None, description="Teléfono a 10 dígitos si es posible.")
    ubicacion: Optional[str] = Field(default=None, description="Ciudad y estado.")
    anios_experiencia: Optional[float] = Field(default=None, description="Años de experiencia laboral total.")
    experiencia_resumen: str = Field(description="Resumen de la experiencia en 1-2 frases.")
    puesto_actual: Optional[str] = Field(default=None, description="Puesto más reciente que aparece en el CV.")
    ultimo_empleo: Optional[str] = Field(default=None, description="Empresa y periodo del empleo más reciente.")
    estudios: List[str] = Field(default_factory=list)
    habilidades: List[str] = Field(default_factory=list)
    idiomas: List[str] = Field(default_factory=list)
    datos_faltantes: List[str] = Field(default_factory=list, description="Datos que no aparecen o no son legibles en el CV.")
    alertas: List[str] = Field(
        default_factory=list,
        description="Focos de atención objetivos: CV ilegible, huecos largos sin explicar, incongruencias de fechas. Nunca datos sensibles.",
    )
    es_cv: bool = Field(description="false si el archivo no es un currículum (otro documento, foto no relacionada, etc.).")
    ajuste: Optional[AjustePerfil] = Field(
        default=None, description="Solo cuando se proporcionó una vacante de referencia; si no, null."
    )


_MEDIA = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}


def _bloque_archivo(archivo_b64: str, extension: str, nombre: str) -> dict:
    """Convierte un archivo base64 en un bloque de entrada de la Responses API."""
    ext = extension.lower().lstrip(".")
    media = _MEDIA.get(ext, "application/pdf")
    if media == "application/pdf":
        return {"type": "input_file", "filename": f"{nombre}.pdf", "file_data": f"data:application/pdf;base64,{archivo_b64}"}
    return {"type": "input_image", "image_url": f"data:{media};base64,{archivo_b64}"}


def extraer_cv(
    archivo_b64: str,
    extension: str,
    vacante_titulo: str = "",
    vacante_requisitos: str = "",
) -> Tuple[CVExtraido, bool]:
    """Extrae los datos del CV y, si se da una vacante, califica el ajuste en la misma llamada."""
    client = _client()
    if client is None:
        demo = CVExtraido(
            nombre=None,
            experiencia_resumen="Modo demo: agrega OPENAI_API_KEY para extraer los datos reales del CV.",
            datos_faltantes=["extracción real pendiente de API key"],
            es_cv=True,
            ajuste=AjustePerfil(
                score=60,
                estado="revision",
                requisitos_cumplidos=[],
                brechas=["Sin evaluación real (modo demo)"],
                evidencia="Modo demo: el expediente queda marcado para revisión humana.",
            )
            if vacante_titulo
            else None,
        )
        return demo, False

    contexto = (
        f"\n\nVACANTE DE REFERENCIA\n- Puesto: {vacante_titulo}\n- Requisitos indispensables: {vacante_requisitos or 'no especificados'}\n"
        "Llena `ajuste` comparando el CV contra estos requisitos. Sé conservador: si un requisito no se puede "
        "acreditar con el CV, va en brechas y el estado no puede ser 'cumple'."
        if vacante_titulo
        else "\n\nNo hay vacante de referencia: deja `ajuste` en null."
    )

    resp = client.responses.parse(
        model=MODEL,
        instructions=(
            "Eres el extractor de CVs de Red Human AI (México). Extrae SOLO lo que realmente aparece en el "
            "documento; si un dato no existe o no es legible, déjalo nulo y regístralo en datos_faltantes. "
            "Nunca inventes información ni infieras datos sensibles (edad, sexo, estado civil, embarazo, "
            "religión, salud, origen). Tu salida es insumo para una persona de RH que toma la decisión final."
            + contexto
        ),
        input=[
            {
                "role": "user",
                "content": [
                    _bloque_archivo(archivo_b64, extension, "cv"),
                    {"type": "input_text", "text": "Extrae los datos de este currículum y evalúa el ajuste con la vacante."},
                ],
            }
        ],
        text_format=CVExtraido,
    )
    return resp.output_parsed, True


# ============================================================
# 3) Agente de prefiltro conversacional (módulo 3.9)
# ============================================================


class TurnoPrefiltro(BaseModel):
    respuesta: str = Field(description="Siguiente mensaje del agente al candidato, breve y cálido, español mexicano.")
    clasificacion_lista: bool = Field(description="true solo cuando ya hay información suficiente para clasificar.")
    estado: Optional[Literal["cumple", "revision", "no_cumple"]] = Field(default=None)
    score: Optional[int] = Field(default=None, description="0-100, qué tanto empata con el perfil.")
    evidencia: Optional[str] = Field(default=None, description="Evidencia objetiva que sustenta la clasificación.")


def prefiltro_turno(
    vacante_titulo: str,
    requisitos: str,
    preguntas: list,
    historial: List[dict],
) -> Tuple[TurnoPrefiltro, bool]:
    """historial: [{"rol": "user"|"assistant", "texto": str}, ...] — el último es del candidato."""
    client = _client()
    if client is None:
        n_agente = sum(1 for m in historial if m["rol"] == "assistant")
        qs = texto_preguntas(preguntas) or ["¿Cuentas con disponibilidad de horario?", "¿Tienes experiencia en un puesto similar?"]
        if n_agente < len(qs):
            return TurnoPrefiltro(respuesta=qs[n_agente], clasificacion_lista=False), False
        return (
            TurnoPrefiltro(
                respuesta=(
                    "¡Gracias por tus respuestas! Tu información quedó registrada y el equipo de RH la revisará. "
                    "Te contactamos muy pronto por este medio. 😊"
                ),
                clasificacion_lista=True,
                estado="revision",
                score=65,
                evidencia="Modo demo: clasificación simulada. Agrega OPENAI_API_KEY para el prefiltro real.",
            ),
            False,
        )

    mensajes = [{"role": ("user" if m["rol"] == "user" else "assistant"), "content": m["texto"]} for m in historial]
    resp = client.responses.parse(
        model=MODEL,
        instructions=(
            "Eres el agente de prefiltro de Red Human AI, hablas por WhatsApp con candidatos en México.\n"
            f"Vacante: {vacante_titulo}.\nRequisitos indispensables: {requisitos}.\n"
            f"Criterios de prefiltro:\n{criterios_prefiltro(preguntas)}\n\n"
            "Reglas: (1) una sola pregunta por mensaje, tono cálido y breve; (2) recorre los criterios en orden "
            "y no repitas los que ya quedaron contestados; (3) cuando tengas suficiente información marca "
            "clasificacion_lista=true con estado, score y evidencia OBJETIVA citando lo que dijo la persona; "
            "(4) si falla un criterio marcado como DESCARTA, el estado es 'no_cumple'; si solo quedan dudas, "
            "'revision'; (5) NUNCA le comuniques un rechazo al candidato: si no cumple, agradece y di que RH "
            "revisará su caso — la decisión final siempre la toma una persona de RH; (6) no pidas datos "
            "sensibles (salud, embarazo, religión, estado civil, edad)."
        ),
        input=mensajes,
        text_format=TurnoPrefiltro,
    )
    return resp.output_parsed, True


# ============================================================
# 3b) Entrevista estructurada (módulo 3.10) — guion, turnos y evaluación
# ============================================================


class GuionEntrevista(BaseModel):
    enfoque: str = Field(description="En 1-2 frases, qué debe validar esta entrevista para este puesto y este candidato.")
    preguntas: List[str] = Field(description="5 a 7 preguntas abiertas de entrevista, ordenadas, en español mexicano.")


def _guion_demo(titulo: str) -> GuionEntrevista:
    return GuionEntrevista(
        enfoque=f"Validar experiencia real, disponibilidad y motivación para {titulo}.",
        preguntas=[
            "Cuéntame de tu experiencia más reciente relacionada con este puesto.",
            "¿Cuál ha sido el reto más difícil que has enfrentado en un trabajo y cómo lo resolviste?",
            "¿Qué te motivó a postularte a esta vacante?",
            "¿Cómo es tu disponibilidad de horario y traslado?",
            "¿Qué esperas de tu siguiente trabajo?",
        ],
    )


def guion_entrevista(titulo: str, requisitos: str, candidato_resumen: str) -> Tuple[GuionEntrevista, bool]:
    client = _client()
    if client is None:
        return _guion_demo(titulo), False

    resp = client.responses.parse(
        model=MODEL,
        instructions=(
            "Diseñas guiones de entrevista para Red Human AI (RH en México). Genera preguntas abiertas, "
            "conductuales y ligadas a los requisitos del puesto; adapta 1-2 preguntas al perfil del candidato. "
            "Prohibido preguntar datos sensibles (salud, embarazo, religión, estado civil, orientación)."
        ),
        input=(
            f"Puesto: {titulo}\nRequisitos indispensables: {requisitos}\n"
            f"Resumen del candidato: {candidato_resumen or 'sin información previa'}"
        ),
        text_format=GuionEntrevista,
    )
    return resp.output_parsed, True


def prompt_entrevistador(titulo: str, requisitos: str, candidato_nombre: str, preguntas: List[str]) -> str:
    """System prompt compartido por el avatar (Anam) y el modo texto — misma personalidad en ambos canales."""
    lista = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(preguntas))
    return (
        "Eres 'Alma', la entrevistadora virtual de Red Human AI (México). Eres una IA y lo dices con "
        f"naturalidad si te preguntan. Entrevistas a {candidato_nombre} para el puesto de {titulo}. "
        f"Requisitos indispensables: {requisitos}.\n\nGuion de preguntas:\n{lista}\n\n"
        "Reglas: (1) tono cálido, profesional y breve — una sola pregunta a la vez; (2) haz máximo una "
        "repregunta corta por tema cuando la respuesta sea vaga; (3) no prometas nada sobre el resultado: "
        "la decisión la toma una persona de RH; (4) nunca pidas datos sensibles (salud, embarazo, religión, "
        "estado civil); (5) al terminar el guion, agradece y despídete indicando que RH le contactará."
    )


class TurnoEntrevista(BaseModel):
    respuesta: str = Field(description="Siguiente mensaje de la entrevistadora, breve, español mexicano.")
    terminada: bool = Field(description="true solo cuando ya se hicieron todas las preguntas y te despediste.")


def entrevista_turno(system_prompt: str, historial: List[dict]) -> Tuple[TurnoEntrevista, bool]:
    """Modo texto (demo o fallback sin avatar). historial: [{"rol","texto"}], el último es del candidato."""
    client = _client()
    if client is None:
        n_agente = sum(1 for m in historial if m["rol"] == "assistant")
        demo_qs = _guion_demo("el puesto").preguntas
        if n_agente < len(demo_qs):
            return TurnoEntrevista(respuesta=demo_qs[n_agente], terminada=False), False
        return (
            TurnoEntrevista(
                respuesta="¡Muchas gracias por tu tiempo! El equipo de RH revisará tu entrevista y te contactará pronto. 😊",
                terminada=True,
            ),
            False,
        )

    mensajes = [{"role": ("user" if m["rol"] == "user" else "assistant"), "content": m["texto"]} for m in historial]
    resp = client.responses.parse(
        model=MODEL,
        instructions=system_prompt,
        input=mensajes,
        text_format=TurnoEntrevista,
    )
    return resp.output_parsed, True


class EvaluacionEntrevista(BaseModel):
    resumen: str = Field(description="Resumen ejecutivo de la entrevista en 2-3 frases para RH.")
    fortalezas: List[str] = Field(description="2 a 4 fortalezas observadas, con evidencia de lo que dijo la persona.")
    riesgos: List[str] = Field(default_factory=list, description="0 a 3 focos de atención o brechas contra los requisitos.")
    calif_experiencia: float = Field(description="0 a 10 — solidez de la experiencia contra los requisitos.")
    calif_comunicacion: float = Field(description="0 a 10 — claridad y estructura al comunicar.")
    match_perfil: int = Field(description="0 a 100 — empate global con el perfil del puesto.")
    recomendacion: Literal["avanzar", "revision", "no_avanzar"] = Field(
        description="Recomendación PRELIMINAR para RH; la decisión final siempre es humana."
    )
    evidencia: str = Field(description="Citas o paráfrasis concretas de la entrevista que sustentan la recomendación.")


def evaluar_entrevista(titulo: str, requisitos: str, transcript: List[dict]) -> Tuple[EvaluacionEntrevista, bool]:
    client = _client()
    if client is None:
        return (
            EvaluacionEntrevista(
                resumen="Modo demo: agrega OPENAI_API_KEY para evaluar la entrevista real.",
                fortalezas=["Completó la entrevista"],
                riesgos=[],
                calif_experiencia=7.0,
                calif_comunicacion=7.0,
                match_perfil=70,
                recomendacion="revision",
                evidencia="Evaluación simulada (modo demo).",
            ),
            False,
        )

    dialogo = "\n".join(f"{'Entrevistadora' if m['rol'] == 'assistant' else 'Candidato'}: {m['texto']}" for m in transcript)
    resp = client.responses.parse(
        model=MODEL,
        instructions=(
            "Evalúas entrevistas laborales para Red Human AI (México). Califica SOLO con base en lo dicho en la "
            "transcripción — nunca inventes ni infieras datos sensibles. Tu salida es una RECOMENDACIÓN preliminar: "
            "la decisión final la toma una persona de RH (human-in-the-loop, LFPDPPP). Sé objetivo y cita evidencia."
        ),
        input=f"Puesto: {titulo}\nRequisitos indispensables: {requisitos}\n\nTranscripción:\n{dialogo}",
        text_format=EvaluacionEntrevista,
    )
    return resp.output_parsed, True


# ============================================================
# 4) Validador de documentos del expediente (módulo 3.11)
# ============================================================


class DocumentoValidado(BaseModel):
    tipo_detectado: str = Field(description="Qué documento parece ser (INE, CURP, RFC, comprobante, NSS, otro).")
    coincide_tipo: bool = Field(description="true si corresponde al tipo de documento solicitado.")
    legible: bool = Field(description="true si el documento se lee completo, sin cortes, reflejos ni desenfoque.")
    completo: bool = Field(description="false si falta parte del documento (por ejemplo solo el frente de la INE).")
    vigente: Optional[bool] = Field(default=None, description="null si el documento no tiene vigencia visible.")
    nombre_detectado: Optional[str] = Field(default=None, description="Nombre del titular tal como aparece; null si no se lee.")
    coincide_titular: Optional[bool] = Field(
        default=None, description="true/false comparando con el titular esperado; null si no se dio o no se lee."
    )
    motivo_rechazo: Optional[str] = Field(
        default=None, description="Si el documento no sirve, la razón en una frase entendible para el candidato."
    )
    observaciones: str = Field(description="Observaciones breves para RH en español.")


def validar_documento(
    archivo_b64: str,
    extension: str,
    tipo_esperado: str,
    titular_esperado: str = "",
) -> Tuple[DocumentoValidado, bool]:
    client = _client()
    if client is None:
        return (
            DocumentoValidado(
                tipo_detectado=tipo_esperado,
                coincide_tipo=True,
                legible=True,
                completo=True,
                vigente=None,
                nombre_detectado=None,
                coincide_titular=None,
                motivo_rechazo=None,
                observaciones="Modo demo: documento marcado para revisión humana. Agrega OPENAI_API_KEY para validación real.",
            ),
            False,
        )

    bloque = _bloque_archivo(archivo_b64, extension, "documento")
    titular = (
        f"Titular esperado del documento: {titular_esperado}. Compara el nombre y llena coincide_titular "
        "(tolera abreviaturas y orden distinto de apellidos; marca false solo si claramente es otra persona)."
        if titular_esperado
        else "No se proporcionó titular esperado: deja coincide_titular en null."
    )
    resp = client.responses.parse(
        model=MODEL,
        instructions=(
            "Validas documentos de expedientes laborales en México (INE, CURP, RFC, comprobante de domicilio, NSS, "
            "acta de nacimiento, título profesional). Revisa tipo, legibilidad, integridad y vigencia visible. "
            f"{titular} Sé conservador: ante cualquier duda, deja constancia en observaciones para revisión humana. "
            "No transcribas datos personales completos (nada de CURP, RFC ni domicilio íntegros) en las observaciones."
        ),
        input=[
            {
                "role": "user",
                "content": [bloque, {"type": "input_text", "text": f"Documento esperado: {tipo_esperado}. Valida este archivo."}],
            }
        ],
        text_format=DocumentoValidado,
    )
    return resp.output_parsed, True
