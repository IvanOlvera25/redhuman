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


def _latin(texto: str) -> str:
    """Helvetica base solo cubre Latin-1: se reemplazan los símbolos que no existen ahí."""
    return (texto or "").replace("·", "-").replace("—", "-").replace("–", "-").encode("latin-1", "replace").decode("latin-1")


def pdf_carta_intencion(d: dict) -> bytes:
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
    ]
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
    pdf.ln(18)
    pdf.set_font(_FUENTE, "", 12)
    pdf.cell(0, 7, _latin("Saludos cordiales,"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(18)
    pdf.set_draw_color(26, 26, 26)
    x = pdf.get_x()
    y = pdf.get_y()
    pdf.line(x, y, x + 95, y)
    pdf.set_y(y + 1.5)
    pdf.set_font(_FUENTE, "", 10)
    pdf.cell(95, 6, _latin(f"{d['empresa']} - Recursos Humanos"), new_x="LMARGIN", new_y="NEXT")

    salida = pdf.output()
    return bytes(salida)


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
    meta = " - ".join(x for x in [d.get("empresa") or "", f"Duración aproximada: {d.get('duracion_horas') or 1} h", f"Para: {d['persona']}" if d.get("persona") else ""] if x)
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
