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


def _latin(texto: str) -> str:
    """Helvetica base solo cubre Latin-1: se reemplazan los símbolos que no existen ahí."""
    return (texto or "").replace("·", "-").replace("—", "-").replace("–", "-").encode("latin-1", "replace").decode("latin-1")


def pdf_carta_intencion(d: dict) -> bytes:
    """Carta de intención de contratación: encabezado, condiciones en tabla, aviso legal y firma."""
    pdf = _Carta(format="letter")
    pdf.set_margins(22, 20, 22)
    pdf.set_auto_page_break(auto=True, margin=22)
    pdf.add_page()

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
