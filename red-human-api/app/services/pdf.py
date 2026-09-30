"""
PDFs del sistema con fpdf2 (Python puro). 2026-09-15 (Fase 1): sustituye a WeasyPrint en la carta de
intención — WeasyPrint exige Pango/Cairo/GDK-PixBuf del sistema y en el servidor no estaban, así que
el botón «Generar carta de intención» fallaba. fpdf2 no depende de nada nativo.
"""

from fpdf import FPDF

_FUENTE = "Helvetica"


class _Carta(FPDF):
    def footer(self) -> None:  # pie discreto con folio de página
        self.set_y(-15)
        self.set_font(_FUENTE, "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"Red Human AI · página {self.page_no()}", align="C")


def wordmark_red_human(pdf: FPDF, x: float, y: float, tam: int = 20) -> None:
    """Logo tipográfico oficial («Red» gris + «Human» rojo + barra roja), igual al logo.svg del
    frontend. fpdf2 no renderiza el <text> del SVG, por eso se dibuja aquí (2026-09-18)."""
    pdf.set_xy(x, y)
    pdf.set_font(_FUENTE, "", tam)
    pdf.set_text_color(0x58, 0x59, 0x5B)
    pdf.write(tam * 0.5, "Red")
    pdf.set_text_color(0xEE, 0x44, 0x44)
    pdf.write(tam * 0.5, "Human")
    ancho = pdf.get_string_width("RedHuman")
    pdf.set_fill_color(0xEE, 0x44, 0x44)
    pdf.rect(x, y + tam * 0.5 + 1.2, ancho, 1.2, style="F")
    pdf.set_text_color(26, 26, 26)


# --- Bloque de firmas con zonas para firma electrónica (2026-09-29) ---
# Dropbox Sign coloca sus campos con `form_fields_per_document` (sistema «nuevo» con `page`): 72 DPI, origen arriba a
# la izquierda y Y hacia abajo = exactamente los puntos PDF de una hoja carta (612 × 792). fpdf2 trabaja en mm con el
# mismo origen, así que basta multiplicar por `pdf.k` (puntos por mm). Con campos definidos Dropbox Sign NO anexa su
# «Signature page»: la firma se estampa sobre NUESTRO documento.
ALTO_ZONA_FIRMA_MM = 15
ALTO_BLOQUE_FIRMAS_MM = 40


def _zona(pdf: FPDF, rol: str, tipo: str, x: float, y: float, w: float, h: float) -> dict:
    k = pdf.k
    return {"rol": rol, "tipo": tipo, "pagina": pdf.page_no(),
            "x": round(x * k), "y": round(y * k), "ancho": round(w * k), "alto": round(h * k)}


def bloque_firmas(pdf: FPDF, izquierda: tuple, derecha: tuple) -> list:
    """Dos firmas lado a lado (rol, leyenda) como ÚLTIMO elemento del documento. Nunca se parte: si no cabe, empieza
    en una página nueva (así siempre queda en la última). Regresa las zonas en puntos PDF para los campos de firma."""
    limite = pdf.h - pdf.b_margin
    if pdf.get_y() + ALTO_BLOQUE_FIRMAS_MM > limite:
        pdf.add_page()
    y_linea = pdf.get_y() + ALTO_ZONA_FIRMA_MM + 4
    ancho = 80
    zonas = []
    pdf.set_draw_color(26, 26, 26)
    for x, (rol, leyenda) in ((pdf.l_margin, izquierda), (pdf.w - pdf.r_margin - ancho, derecha)):
        pdf.line(x, y_linea, x + ancho, y_linea)
        zonas.append(_zona(pdf, rol, "firma", x, y_linea - ALTO_ZONA_FIRMA_MM - 1, ancho, ALTO_ZONA_FIRMA_MM))
        pdf.set_xy(x, y_linea + 1.5)
        pdf.set_font(_FUENTE, "", 10)
        pdf.set_text_color(85, 85, 85)
        pdf.cell(ancho, 5, _latin(leyenda))
        pdf.set_xy(x, y_linea + 8)
        pdf.set_font(_FUENTE, "", 9)
        pdf.cell(26, 5, _latin("Fecha de firma:"))
        zonas.append(_zona(pdf, rol, "fecha", x + 26, y_linea + 7.5, 40, 6))
    pdf.set_text_color(26, 26, 26)
    pdf.set_y(y_linea + 16)
    return zonas


def _latin(texto: str) -> str:
    """Helvetica base solo cubre Latin-1: se reemplazan los símbolos que no existen ahí."""
    return (texto or "").replace("·", "-").replace("—", "-").replace("–", "-").encode("latin-1", "replace").decode("latin-1")


def pdf_carta_intencion(d: dict, con_zonas: bool = False):
    """Carta de intención de contratación: encabezado, condiciones en tabla, aviso legal y firma."""
    pdf = _Carta(format="letter")
    pdf.set_margins(22, 20, 22)
    pdf.set_auto_page_break(auto=True, margin=22)
    pdf.add_page()

    # Encabezado con el logo de Red Human (2026-09-18: antes el documento salía sin marca).
    wordmark_red_human(pdf, 22, 14, 18)
    pdf.set_xy(22, 30)
    pdf.set_font(_FUENTE, "B", 16)
    pdf.set_text_color(26, 26, 26)
    pdf.cell(0, 10, _latin("Carta de Intención de Contratación"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(_FUENTE, "", 11)
    pdf.set_text_color(85, 85, 85)
    pdf.cell(0, 7, _latin(f"{d['empresa']} - {d['hoy']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    pdf.set_text_color(26, 26, 26)
    pdf.set_font(_FUENTE, "", 12)
    pdf.write(7, _latin("Estimado(a) "))
    pdf.set_font(_FUENTE, "B", 12)
    pdf.write(7, _latin(f"{d['nombre']},"))
    pdf.ln(10)
    pdf.set_font(_FUENTE, "", 12)
    pdf.multi_cell(
        0, 7,
        _latin(
            f"Nos da mucho gusto confirmarte que, tras concluir el proceso de selección, {d['empresa']} te "
            "extiende esta carta de intención para incorporarte a nuestro equipo bajo las siguientes condiciones:"
        ),
    )
    pdf.ln(5)

    filas = [
        ("Puesto", d["puesto"]),
        ("Sueldo", d["sueldo"]),
        ("Tipo de contratación", d["tipo_contratacion"]),
        ("Ubicación de trabajo", d["ubicacion"]),
        ("Jefe directo", d["jefe"]),
        ("Fecha de ingreso", d["fecha_ingreso"]),
    ] + ([("Duración", d["duracion"]), ("Fecha de término", d["fecha_termino"])] if d.get("fecha_termino") else [])
    ancho = pdf.w - pdf.l_margin - pdf.r_margin
    col1 = ancho * 0.4
    pdf.set_draw_color(221, 221, 221)
    for etiqueta, valor in filas:
        y = pdf.get_y()
        pdf.set_font(_FUENTE, "B", 11)
        pdf.cell(col1, 9, _latin(etiqueta), border="B")
        pdf.set_font(_FUENTE, "", 11)
        pdf.multi_cell(ancho - col1, 9, _latin(str(valor)), border="B", new_x="LMARGIN", new_y="NEXT")
        if pdf.get_y() <= y:  # seguridad ante saltos raros
            pdf.ln(9)
    pdf.ln(6)

    pdf.set_font(_FUENTE, "", 11)
    pdf.multi_cell(
        0, 6.5,
        _latin(
            "Esta carta es una manifestación de intención y no constituye por sí misma un contrato laboral; "
            "las condiciones definitivas quedarán formalizadas en el contrato individual de trabajo correspondiente."
        ),
    )
    pdf.ln(12)
    pdf.set_font(_FUENTE, "", 12)
    pdf.cell(0, 7, _latin("Saludos cordiales,"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    # 2026-09-29: la carta la firman la empresa y el candidato (aceptación) — ambos sobre esta misma página
    zonas = bloque_firmas(pdf, ("empresa", f"{d['empresa']} - Recursos Humanos"), ("candidato", f"Acepto: {d.get('nombre') or 'Candidato'}"))
    salida = bytes(pdf.output())
    return (salida, zonas) if con_zonas else salida


class _Curso(FPDF):
    def footer(self) -> None:
        self.set_y(-15)
        self.set_font(_FUENTE, "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, _latin(f"Red Human AI - Capacitación - página {self.page_no()}"), align="C")


def pdf_curso(d: dict) -> bytes:
    """Contenido descargable de una capacitación (2026-09-18): portada (título, categoría, objetivo,
    duración, empresa), módulos completos y, si la persona ya terminó, su resultado.
    d = {titulo, categoria, objetivo, duracion_horas, empresa, modulos:[{orden,titulo,contenido}],
         persona?, resultado?: {calificacion, aprobado, aciertos, total, minimo}, evaluacion?: [{pregunta, opciones}]}"""
    pdf = _Curso(format="letter")
    pdf.set_margins(22, 20, 22)
    pdf.set_auto_page_break(auto=True, margin=22)
    pdf.add_page()
    wordmark_red_human(pdf, 22, 14, 18)
    pdf.set_xy(22, 32)
    pdf.set_font(_FUENTE, "", 9)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, _latin(f"CAPACITACIÓN - {d.get('categoria') or 'General'}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(_FUENTE, "B", 20)
    pdf.set_text_color(26, 26, 26)
    pdf.multi_cell(0, 9, _latin(d.get("titulo") or "Curso"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font(_FUENTE, "", 11)
    pdf.set_text_color(85, 85, 85)
    meta = " - ".join(x for x in [d.get("empresa") or "", f"Duración aproximada: {d.get('duracion_texto') or str(d.get('duracion_horas') or 1) + ' h'}", "Material de apoyo del curso con Instructor IA" if d.get("modalidad") == "instructor_ia" else "", f"Para: {d['persona']}" if d.get("persona") else ""] if x)
    pdf.multi_cell(0, 6, _latin(meta), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    if d.get("objetivo"):
        pdf.set_font(_FUENTE, "B", 12)
        pdf.set_text_color(0xEE, 0x44, 0x44)
        pdf.cell(0, 7, "Objetivo", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(_FUENTE, "", 11)
        pdf.set_text_color(26, 26, 26)
        pdf.multi_cell(0, 6, _latin(d["objetivo"]), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)
    modulos = d.get("modulos") or []
    if modulos:
        pdf.set_font(_FUENTE, "B", 12)
        pdf.set_text_color(0xEE, 0x44, 0x44)
        pdf.cell(0, 7, "Contenido", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(_FUENTE, "", 11)
        pdf.set_text_color(26, 26, 26)
        for m in modulos:
            pdf.cell(0, 6, _latin(f"{m.get('orden')}. {m.get('titulo')}"), new_x="LMARGIN", new_y="NEXT")
    for m in modulos:
        pdf.add_page()
        pdf.set_font(_FUENTE, "", 9)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(0, 5, _latin(f"MÓDULO {m.get('orden')} DE {len(modulos)}"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(_FUENTE, "B", 15)
        pdf.set_text_color(26, 26, 26)
        pdf.multi_cell(0, 8, _latin(m.get("titulo") or ""), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        pdf.set_font(_FUENTE, "", 11)
        for parrafo in (m.get("contenido") or "").split("\n"):
            if parrafo.strip():
                pdf.multi_cell(0, 6, _latin(parrafo.strip()), new_x="LMARGIN", new_y="NEXT")
            else:
                pdf.ln(2)
        if m.get("puntos_clave"):
            pdf.ln(2)
            pdf.set_font(_FUENTE, "B", 11)
            pdf.set_text_color(0xEE, 0x44, 0x44)
            pdf.cell(0, 6, "Puntos clave", new_x="LMARGIN", new_y="NEXT")
            pdf.set_font(_FUENTE, "", 11)
            pdf.set_text_color(26, 26, 26)
            for punto in m["puntos_clave"][:6]:
                pdf.multi_cell(0, 6, _latin(f"- {punto}"), new_x="LMARGIN", new_y="NEXT")
    if d.get("evaluacion"):
        pdf.add_page()
        pdf.set_font(_FUENTE, "B", 15)
        pdf.cell(0, 8, _latin("Evaluación final"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(_FUENTE, "", 11)
        for i, q in enumerate(d["evaluacion"], 1):
            pdf.ln(2)
            pdf.set_font(_FUENTE, "B", 11)
            pdf.multi_cell(0, 6, _latin(f"{i}. {q.get('pregunta')}"), new_x="LMARGIN", new_y="NEXT")
            pdf.set_font(_FUENTE, "", 11)
            for j, o in enumerate(q.get("opciones") or []):
                pdf.multi_cell(0, 6, _latin(f"     {chr(97 + j)}) {o}"), new_x="LMARGIN", new_y="NEXT")
    r = d.get("resultado")
    if r:
        pdf.ln(6)
        pdf.set_font(_FUENTE, "B", 13)
        pdf.set_text_color(0x16, 0xA3, 0x4A) if r.get("aprobado") else pdf.set_text_color(0xDC, 0x26, 0x26)
        pdf.cell(0, 8, _latin(f"Resultado: {'APROBADO' if r.get('aprobado') else 'NO APROBADO'} - {r.get('calificacion')}%"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(_FUENTE, "", 11)
        pdf.set_text_color(85, 85, 85)
        pdf.cell(0, 6, _latin(f"{r.get('aciertos')} de {r.get('total')} respuestas correctas - mínimo para aprobar {r.get('minimo')}%"), new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def pdf_contrato(d: dict, con_zonas: bool = False):
    """Contrato individual de trabajo (2026-09-19, Bloque 3) generado con las condiciones FINALES guardadas
    en el expediente: empresa, colaborador, puesto, sueldo, tipo de contratación, fecha de ingreso, ubicación,
    jefe directo. Cláusulas base y espacio de firmas; el texto legal definitivo lo revisa RH/legal."""
    pdf = _Carta(format="letter")
    pdf.set_margins(22, 20, 22)
    pdf.set_auto_page_break(auto=True, margin=22)
    pdf.add_page()
    wordmark_red_human(pdf, 22, 14, 18)
    pdf.set_xy(22, 30)
    pdf.set_font(_FUENTE, "B", 15)
    pdf.set_text_color(26, 26, 26)
    pdf.cell(0, 9, _latin(f"Contrato Individual de Trabajo ({d['tipo_contratacion']})"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(_FUENTE, "", 10)
    pdf.set_text_color(85, 85, 85)
    pdf.cell(0, 6, _latin(f"{d['empresa']} - {d['hoy']}"), new_x="LMARGIN", new_y="NEXT")
    if d.get("borrador"):
        pdf.set_font(_FUENTE, "B", 10)
        pdf.set_text_color(238, 68, 68)
        pdf.cell(0, 6, _latin("BORRADOR - para revision y firma. La version firmada se carga en el Onboarding."), new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(85, 85, 85)
    pdf.ln(4)
    pdf.set_font(_FUENTE, "", 11)
    pdf.set_text_color(26, 26, 26)
    pdf.multi_cell(0, 6, _latin(
        f"Contrato individual de trabajo que celebran, por una parte, {d['empresa']} (en adelante «la Empresa») y, por la otra, "
        f"{d['nombre']} (en adelante «el Colaborador»), al tenor de las siguientes declaraciones y cláusulas:"
    ), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    filas = [
        ("Puesto", d["puesto"]), ("Sueldo", d["sueldo"]), ("Tipo de contratación", d["tipo_contratacion"]),
        ("Fecha de ingreso", d["fecha_ingreso"]), ("Lugar de trabajo", d["ubicacion"]), ("Jefe directo", d["jefe"]),
    ] + ([("Duración", d["duracion"]), ("Fecha de término", d["fecha_termino"])] if d.get("fecha_termino") else [])
    for etiqueta, valor in filas:
        pdf.set_font(_FUENTE, "B", 11)
        pdf.cell(55, 7, _latin(etiqueta), border="B")
        pdf.set_font(_FUENTE, "", 11)
        pdf.cell(0, 7, _latin(str(valor)), border="B", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    clausulas = [
        ("PRIMERA. Objeto.", f"El Colaborador se obliga a prestar sus servicios personales subordinados a la Empresa en el puesto de {d['puesto']}, desempeñando las funciones propias del mismo con la diligencia y cuidado apropiados."),
        ("SEGUNDA. Duración.", (
            f"El presente contrato es por tiempo determinado con una duración de {d['duracion']}, surtirá efectos a partir del {d['fecha_ingreso']} y concluirá el {d['fecha_termino']}, conforme a la Ley Federal del Trabajo."
            if d.get("fecha_termino") else
            f"El presente contrato es de tipo {d['tipo_contratacion']} y surtirá efectos a partir del {d['fecha_ingreso']}, conforme a la Ley Federal del Trabajo."
        )),
        ("TERCERA. Salario.", f"La Empresa pagará al Colaborador un sueldo de {d['sueldo']}, en los términos y periodicidad que marca la Ley, cubriendo las prestaciones legales correspondientes."),
        ("CUARTA. Lugar y jornada.", f"El Colaborador prestará sus servicios en {d['ubicacion']}, bajo la supervisión de {d['jefe']}, dentro de la jornada legal aplicable."),
        ("QUINTA. Confidencialidad y datos personales.", "El Colaborador guardará confidencialidad sobre la información de la Empresa. Sus datos personales se tratan conforme al Aviso de Privacidad de la Empresa (LFPDPPP)."),
        ("SEXTA. Disposiciones generales.", "En lo no previsto, las partes se sujetan a la Ley Federal del Trabajo y demás ordenamientos aplicables."),
    ]
    for titulo, texto in clausulas:
        pdf.set_font(_FUENTE, "B", 11)
        pdf.cell(0, 6, _latin(titulo), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(_FUENTE, "", 11)
        pdf.multi_cell(0, 6, _latin(texto), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
    pdf.ln(4)
    # la cláusula de cierre viaja SIEMPRE junto a las firmas (nunca una hoja de firmas suelta, que se podría separar)
    if pdf.get_y() + 16 + ALTO_BLOQUE_FIRMAS_MM > pdf.h - pdf.b_margin:
        pdf.add_page()
    pdf.set_font(_FUENTE, "", 11)
    pdf.set_text_color(26, 26, 26)
    pdf.multi_cell(0, 6, _latin(
        f"Leído que fue el presente contrato y enteradas las partes de su contenido y alcance, lo firman de conformidad "
        f"el {d['hoy']}."
    ), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    zonas = bloque_firmas(pdf, ("empresa", f"{d['empresa']} - Representante"), ("candidato", d["nombre"]))
    salida = bytes(pdf.output())
    return (salida, zonas) if con_zonas else salida


# ============================================================
# Demo Fraiche (spec §13, 2026-09-29) · Ficha para presentar al encargado / franquiciatario
# ============================================================


class _Ficha(FPDF):
    def footer(self) -> None:
        self.set_y(-15)
        self.set_font(_FUENTE, "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, _latin(f"Red Human AI - Ficha para presentar - página {self.page_no()} - Sin información médica ni socioeconómica"), align="C")


def _ficha_titulo(pdf: FPDF, texto: str) -> None:
    if pdf.get_y() > pdf.h - pdf.b_margin - 30:
        pdf.add_page()
    pdf.ln(3)
    pdf.set_font(_FUENTE, "B", 12)
    pdf.set_text_color(0xEE, 0x44, 0x44)
    pdf.cell(0, 7, _latin(texto.upper()), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(221, 221, 221)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(2)
    pdf.set_text_color(26, 26, 26)


def _ficha_par(pdf: FPDF, etiqueta: str, valor: str) -> None:
    if not valor:
        return
    pdf.set_font(_FUENTE, "B", 10)
    pdf.cell(42, 6, _latin(etiqueta))
    pdf.set_font(_FUENTE, "", 10)
    pdf.multi_cell(0, 6, _latin(valor), new_x="LMARGIN", new_y="NEXT")


def _ficha_lista(pdf: FPDF, etiqueta: str, items: list) -> None:
    if not items:
        return
    pdf.set_font(_FUENTE, "B", 10)
    pdf.cell(0, 6, _latin(etiqueta), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(_FUENTE, "", 10)
    for x in items:
        pdf.multi_cell(0, 5.5, _latin(f"- {x}"), new_x="LMARGIN", new_y="NEXT")


def pdf_ficha_presentacion(d: dict) -> bytes:
    """Vacante, sucursal o cliente, experiencia, CV, resumen de entrevista inicial, IPV, psicometría disponible,
    observaciones y siguiente acción — solo los apartados que el reclutador incluyó. NUNCA lleva detalle médico
    ni socioeconómico (esas evaluaciones ni siquiera entran a `d`)."""
    pdf = _Ficha(format="letter")
    pdf.set_margins(20, 18, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    wordmark_red_human(pdf, 20, 12, 16)
    pdf.set_xy(20, 26)
    pdf.set_font(_FUENTE, "B", 15)
    pdf.set_text_color(26, 26, 26)
    pdf.cell(0, 9, _latin(f"Ficha de candidato - {d['candidato']['nombre']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(_FUENTE, "", 10)
    pdf.set_text_color(85, 85, 85)
    pdf.cell(0, 6, _latin(f"{d['vacante']['titulo']} - generada el {d['generada']} - {d['candidato']['codigo']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(26, 26, 26)
    secciones = set(d.get("secciones") or [])

    if "vacante" in secciones:
        _ficha_titulo(pdf, "Vacante")
        v = d["vacante"]
        _ficha_par(pdf, "Puesto", v["titulo"])
        _ficha_par(pdf, "Destino", v["destino"])
        _ficha_par(pdf, "Sucursal", v["sucursal"])
        _ficha_par(pdf, "Cliente", v["cliente"])
        _ficha_par(pdf, "Zona", v["zona"])
    if "candidato" in secciones:
        _ficha_titulo(pdf, "Candidato")
        c = d["candidato"]
        _ficha_par(pdf, "Nombre", c["nombre"])
        _ficha_par(pdf, "Ubicación", c["ubicacion"])
        _ficha_par(pdf, "Fuente", c["fuente"])
    if "experiencia" in secciones:
        _ficha_titulo(pdf, "Experiencia")
        _ficha_par(pdf, "Resumen", d["experiencia"]["resumen"] or "Sin resumen de experiencia.")
        _ficha_lista(pdf, "Trayectoria", d["experiencia"]["detalle"])
    if "cv" in secciones:
        _ficha_titulo(pdf, "CV")
        cv = d["cv"]
        _ficha_par(pdf, "Perfil", cv["resumen"] or ("CV adjunto disponible en la plataforma." if cv["adjunto"] else "Sin CV."))
        _ficha_lista(pdf, "Habilidades", cv["habilidades"])
        _ficha_lista(pdf, "Estudios", cv["estudios"])
    if "entrevista_inicial" in secciones:
        _ficha_titulo(pdf, "Resumen de la entrevista inicial (Red Human)")
        e = d.get("entrevista_inicial")
        if e:
            _ficha_par(pdf, "Resumen", e["resumen"])
            _ficha_lista(pdf, "Fortalezas", e["fortalezas"])
            _ficha_lista(pdf, "Alertas / puntos por validar", e["alertas"])
            _ficha_par(pdf, "Recomendación", {"avanzar": "Avanzar", "revision": "Revisión", "no_avanzar": "No avanzar"}.get(e["recomendacion"], e["recomendacion"]))
        else:
            _ficha_par(pdf, "Estado", "Sin entrevista inicial evaluada.")
    if "ipv" in secciones:
        _ficha_titulo(pdf, "Entrevista IPV")
        i = d.get("ipv")
        if i:
            _ficha_par(pdf, "Resultado", f"{i['puntaje']} / 100 - {i['conclusion']}" if i["puntaje"] is not None else i["conclusion"])
            _ficha_par(pdf, "Evaluó", i["evaluador"])
            _ficha_lista(pdf, "Competencias", [f"{x['nombre']} ({x['peso']}%): {x['nivel']}" for x in i["detalle"]])
        else:
            _ficha_par(pdf, "Estado", "Sin Entrevista IPV registrada.")
    if "psicometria" in secciones:
        _ficha_titulo(pdf, "Psicometría disponible")
        if d["psicometria"]:
            for ps in d["psicometria"]:
                _ficha_par(pdf, ps["nombre"], f"{ps['estado']}" + (f" - {ps['dictamen']}" if ps["dictamen"] else ""))
                ev = ps.get("evaluatest") or {}
                if ev:
                    _ficha_lista(pdf, "Evaluatest", [x for x in [
                        f"Índice de Afinidad: {ev.get('indice_afinidad')}%" if ev.get("indice_afinidad") is not None else "",
                        f"Etegrity / IGI: {ev.get('igi')}%" if ev.get("igi") is not None else "",
                        ("Competencias: " + ", ".join(ev.get("competencias") or [])) if ev.get("competencias") else "",
                        ("Fortalezas: " + ", ".join(ev.get("fortalezas") or [])) if ev.get("fortalezas") else "",
                        ("Áreas de oportunidad: " + ", ".join(ev.get("areas_oportunidad") or [])) if ev.get("areas_oportunidad") else "",
                        f"Riesgo: {ev.get('riesgo')}" if ev.get("riesgo") else "",
                    ] if x])
        else:
            _ficha_par(pdf, "Estado", "Sin psicometría registrada.")
    if "observaciones" in secciones and d.get("observaciones"):
        _ficha_titulo(pdf, "Observaciones")
        pdf.set_font(_FUENTE, "", 10)
        pdf.multi_cell(0, 6, _latin(d["observaciones"]), new_x="LMARGIN", new_y="NEXT")
    if "siguiente_accion" in secciones and d.get("siguiente_accion"):
        _ficha_titulo(pdf, "Siguiente acción")
        pdf.set_font(_FUENTE, "", 10)
        pdf.multi_cell(0, 6, _latin(d["siguiente_accion"]), new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())
