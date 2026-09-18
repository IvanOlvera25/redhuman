"""
Plantillas HTML corporativas de correo (2026-09-18) — Entrevista Humana.

Dos plantillas, limpias y responsivas (tablas + CSS inline, compatibles con Gmail/Outlook/Apple Mail),
con el logotipo de Red Human y, si la Cuenta tiene logo, el de la empresa:
- `html_entrevistador`: aviso de nueva entrevista asignada + CTA «Ver expediente del candidato».
- `html_candidato`: confirmación de la entrevista con una persona + fecha, hora y liga de conexión.

Vista previa en el navegador con datos de prueba: GET /api/emails/preview/entrevistador y
GET /api/emails/preview/candidato (routers/emails_preview.py).
"""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from typing import Optional
from zoneinfo import ZoneInfo

from ..config import settings

TZ_MEXICO = ZoneInfo("America/Mexico_City")
_DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

ROJO = "#ee4444"
GRIS = "#58595b"
INK = "#1a1a1a"
INK2 = "#555555"
FONDO = "#f4f5f7"


def fecha_hora_mx(dt: Optional[datetime]) -> tuple[str, str]:
    """('jueves 24 de septiembre de 2026', '10:30 h') en hora de México; vacíos si no hay fecha."""
    if not dt:
        return "", ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(TZ_MEXICO)
    return f"{_DIAS[local.weekday()]} {local.day} de {_MESES[local.month - 1]} de {local.year}", f"{local:%H:%M} h"


def _logo_html(empresa: str, logo_url: str = "") -> str:
    """Encabezado: wordmark Red Human (texto, se ve igual en todos los clientes de correo) y, si hay, el
    logotipo de la empresa que entrevista."""
    marca = (
        f'<span style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:26px;font-weight:600;letter-spacing:-0.5px;">'
        f'<span style="color:{GRIS};">Red</span><span style="color:{ROJO};">Human</span></span>'
        f'<div style="height:4px;width:96px;background:{ROJO};border-radius:2px;margin-top:4px;"></div>'
    )
    if logo_url:
        return (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td align="left" valign="middle">{marca}</td>'
            f'<td align="right" valign="middle"><img src="{escape(logo_url)}" alt="{escape(empresa)}" height="40" style="height:40px;max-width:160px;object-fit:contain;border:0;"></td>'
            f'</tr></table>'
        )
    return marca


def _boton(texto: str, url: str) -> str:
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px;"><tr>'
        f'<td align="center" bgcolor="{ROJO}" style="border-radius:12px;">'
        f'<a href="{escape(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;'
        f'font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">{escape(texto)}</a>'
        f'</td></tr></table>'
    )


def _fila(etiqueta: str, valor: str, ultima: bool = False) -> str:
    borde = "" if ultima else "border-bottom:1px solid #eceef1;"
    return (
        f'<tr><td style="padding:10px 0;{borde}font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8d91;width:38%;">{escape(etiqueta)}</td>'
        f'<td style="padding:10px 0;{borde}font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:15px;color:{INK};font-weight:600;">{valor}</td></tr>'
    )


def _base(titulo: str, preheader: str, empresa: str, logo_url: str, contenido: str, pie: str) -> str:
    """Esqueleto responsivo: contenedor de 600 px que se vuelve fluido en móvil."""
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>{escape(titulo)}</title>
<style>
  @media only screen and (max-width: 620px) {{
    .contenedor {{ width: 100% !important; }}
    .relleno {{ padding: 24px 20px !important; }}
    .titulo {{ font-size: 22px !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background:{FONDO};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{FONDO};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" class="contenedor" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(20,20,25,.08);">
    <tr><td class="relleno" style="padding:28px 40px 12px;">{_logo_html(empresa, logo_url)}</td></tr>
    <tr><td class="relleno" style="padding:12px 40px 8px;">{contenido}</td></tr>
    <tr><td style="padding:20px 40px 28px;border-top:1px solid #eceef1;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8d91;">
      {pie}
    </td></tr>
  </table>
  <p style="margin:18px 0 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:11px;color:#a0a3a8;">Red Human AI · Plataforma de reclutamiento y talento · Este correo se generó automáticamente.</p>
</td></tr>
</table>
</body>
</html>"""


def html_entrevistador(d: dict) -> tuple[str, str]:
    """(asunto, html) para la persona que entrevista. d: entrevistador, candidato, vacante, empresa,
    fecha, hora, modalidad, detalle_conexion, liga_expediente, telefono_candidato, comentario, logo_url."""
    empresa = d.get("empresa") or "tu empresa"
    nombre = (d.get("entrevistador") or "").split(" ")[0] or "Hola"
    asunto = f"Nueva entrevista asignada: {d.get('candidato', '')} · {d.get('vacante', '')}"
    filas = (
        _fila("Candidato", escape(d.get("candidato", "")))
        + _fila("Vacante", escape(d.get("vacante", "")))
        + _fila("Fecha", escape(d.get("fecha") or "Por confirmar"))
        + _fila("Hora", escape(d.get("hora") or "Por confirmar"))
        + _fila("Modalidad", escape(d.get("modalidad") or "Por confirmar"))
        + (_fila("Conexión / lugar", escape(d["detalle_conexion"])) if d.get("detalle_conexion") else "")
        + _fila("Teléfono del candidato", escape(d.get("telefono_candidato") or "—"), ultima=True)
    )
    contenido = (
        f'<p style="margin:0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:{ROJO};font-weight:700;">Entrevista asignada</p>'
        f'<h1 class="titulo" style="margin:8px 0 12px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;color:{INK};">Hola {escape(nombre)}, tienes una nueva entrevista</h1>'
        f'<p style="margin:0 0 20px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:{INK2};">'
        f'Se te asignó la entrevista de <strong style="color:{INK};">{escape(d.get("candidato", ""))}</strong> para la vacante '
        f'<strong style="color:{INK};">{escape(d.get("vacante", ""))}</strong> en {escape(empresa)}. Red Human ya hizo el prefiltro y la primera entrevista: '
        f'en el expediente encontrarás su CV, la evaluación integral y los puntos por validar.</p>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafb;border:1px solid #eceef1;border-radius:14px;padding:6px 18px;">{filas}</table>'
        + (f'<p style="margin:18px 0 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:{INK2};"><strong>Nota de RH:</strong> {escape(d["comentario"])}</p>' if d.get("comentario") else "")
        + _boton("Ver expediente del candidato", d.get("liga_expediente") or settings.app_url)
        + f'<p style="margin:6px 0 0;text-align:center;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;color:#8a8d91;">Desde ahí también registras tu evaluación al terminar.</p>'
    )
    pie = f"Recibes este aviso porque {escape(empresa)} te asignó como entrevistador(a) en Red Human AI. Si no te corresponde, responde a Recursos Humanos."
    return asunto, _base(asunto, f"Entrevista con {d.get('candidato', '')} · {d.get('fecha', '')} {d.get('hora', '')}", empresa, d.get("logo_url", ""), contenido, pie)


def html_candidato(d: dict) -> tuple[str, str]:
    """(asunto, html) para el candidato. d: candidato, entrevistador, vacante, empresa, fecha, hora, modalidad,
    liga_conexion, ubicacion, telefono_contacto, comentario, logo_url."""
    empresa = d.get("empresa") or "la empresa"
    nombre = (d.get("candidato") or "").split(" ")[0] or "Hola"
    asunto = f"Tu entrevista para {d.get('vacante', '')} quedó agendada"
    modalidad = d.get("modalidad") or "Por confirmar"
    if d.get("liga_conexion"):
        conexion = _fila("Liga de conexión", f'<a href="{escape(d["liga_conexion"])}" style="color:{ROJO};text-decoration:none;word-break:break-all;">{escape(d["liga_conexion"])}</a>', ultima=True)
    elif d.get("ubicacion"):
        conexion = _fila("Lugar", escape(d["ubicacion"]), ultima=True)
    elif d.get("telefono_contacto"):
        conexion = _fila("Te llamaremos al", escape(d["telefono_contacto"]), ultima=True)
    else:
        conexion = _fila("Conexión", "Te compartiremos los detalles antes de la entrevista", ultima=True)
    filas = (
        _fila("Entrevista con", escape(d.get("entrevistador") or "el equipo de Recursos Humanos"))
        + _fila("Vacante", escape(d.get("vacante", "")))
        + _fila("Fecha", escape(d.get("fecha") or "Por confirmar"))
        + _fila("Hora", escape(d.get("hora") or "Por confirmar"))
        + _fila("Modalidad", escape(modalidad))
        + conexion
    )
    boton = _boton("Unirme a la entrevista", d["liga_conexion"]) if d.get("liga_conexion") else ""
    contenido = (
        f'<p style="margin:0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:{ROJO};font-weight:700;">Entrevista agendada</p>'
        f'<h1 class="titulo" style="margin:8px 0 12px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;color:{INK};">¡{escape(nombre)}, ya tienes fecha para tu entrevista!</h1>'
        f'<p style="margin:0 0 20px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:{INK2};">'
        f'Gracias por tu entrevista con Red Human. Con base en tus resultados, <strong style="color:{INK};">{escape(empresa)}</strong> quiere conocerte en persona: '
        f'te agendamos una entrevista con <strong style="color:{INK};">{escape(d.get("entrevistador") or "el equipo de Recursos Humanos")}</strong>.</p>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafb;border:1px solid #eceef1;border-radius:14px;padding:6px 18px;">{filas}</table>'
        + (f'<p style="margin:18px 0 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:{INK2};">{escape(d["comentario"])}</p>' if d.get("comentario") else "")
        + boton
        + f'<p style="margin:16px 0 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:{INK2};">Te recomendamos conectarte 5 minutos antes{" y probar tu cámara y micrófono" if modalidad == "Videollamada" else ""}. Si necesitas cambiar la fecha, respóndenos por WhatsApp.</p>'
    )
    pie = f"Tus datos se tratan conforme al Aviso de Privacidad de {escape(empresa)} exclusivamente para este proceso de selección (LFPDPPP)."
    return asunto, _base(asunto, f"Entrevista el {d.get('fecha', '')} a las {d.get('hora', '')} · {d.get('vacante', '')}", empresa, d.get("logo_url", ""), contenido, pie)


# ------------------------------------------------------------
# Datos de prueba para las vistas previas
# ------------------------------------------------------------

MOCK_ENTREVISTA = {
    "entrevistador": "Mariana López",
    "candidato": "Carlos Hernández Ruiz",
    "vacante": "Abogado Fiscalista",
    "empresa": "Grupo CARBE",
    "fecha": "jueves 24 de septiembre de 2026",
    "hora": "10:30 h",
    "modalidad": "Videollamada",
    "detalle_conexion": "Microsoft Teams · https://teams.microsoft.com/l/meetup-join/ejemplo",
    "liga_conexion": "https://teams.microsoft.com/l/meetup-join/ejemplo",
    "liga_expediente": f"{settings.app_url}/entrevista-humana/ejemplo-token",
    "telefono_candidato": "55 1234 5678",
    "telefono_contacto": "",
    "ubicacion": "",
    "comentario": "Enfocar la conversación en experiencia con auditorías del SAT y manejo de equipo.",
    "logo_url": "",
}
