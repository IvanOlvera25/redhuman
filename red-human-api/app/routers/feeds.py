"""Feeds XML públicos para bolsas de empleo (2026-09-27) — ver docs/arquitectura_bolsas_empleo.md (3.2-d).

GET /feeds/jooble.xml y GET /feeds/talent.xml: sin sesión a propósito (solo datos de vacantes, ningún
dato de candidato). Una vacante entra SOLO si está Publicada, su Cuenta está activa y RH marcó ese
portal (`bolsas.vacantes_para`); al cerrarla o desmarcar el portal sale en la siguiente lectura del
feed — el portal no necesita aviso. Nunca se inventa: sin sueldo capturado no hay <salary>.

Los nombres de etiquetas siguen el formato habitual de cada portal; la especificación exacta hay que
confirmarla con la que Jooble y Talent.com entregan al dar de alta el feed.
"""

import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..services import bolsas

router = APIRouter(prefix="/feeds", tags=["feeds"])

# Los portales leen el feed cada varias horas; 5 min de caché basta para no recalcularlo en cada lectura.
CABECERAS = {"Cache-Control": "public, max-age=300"}


def _hijo(padre: ET.Element, etiqueta: str, texto: Optional[str]) -> None:
    """Agrega la etiqueta solo si hay dato: un feed nunca lleva campos vacíos inventados."""
    if texto:
        ET.SubElement(padre, etiqueta).text = str(texto)


def _xml(raiz: ET.Element) -> Response:
    ET.indent(raiz)
    cuerpo = ET.tostring(raiz, encoding="utf-8", xml_declaration=True)
    return Response(content=cuerpo, media_type="application/xml; charset=utf-8", headers=CABECERAS)


def _region(d: dict) -> str:
    partes = [p for p in (d["municipio"], d["estado"]) if p]
    texto = ", ".join(partes) or d["ubicacion"]
    return f"{texto} (Remoto)" if d["remoto"] and texto else ("Remoto" if d["remoto"] else texto)


@router.get("/jooble.xml")
def feed_jooble(db: Session = Depends(get_db)):
    raiz = ET.Element("jobs")
    for v in bolsas.vacantes_para(db, bolsas.JOOBLE):
        d = bolsas.datos_publicos(v)
        job = ET.SubElement(raiz, "job", id=d["id"])
        _hijo(job, "link", bolsas.url_publica(v, "jooble"))
        _hijo(job, "name", d["titulo"])
        _hijo(job, "region", _region(d))
        _hijo(job, "salary", d["sueldo"]["texto"] if d["sueldo"] else None)
        _hijo(job, "description", d["descripcion_html"])
        _hijo(job, "company", d["empresa"])
        _hijo(job, "pubdate", d["publicada_en"].strftime("%d.%m.%Y") if d["publicada_en"] else None)
        _hijo(job, "updated", d["actualizada_en"].strftime("%d.%m.%Y") if d["actualizada_en"] else None)
    return _xml(raiz)


@router.get("/talent.xml")
def feed_talent(db: Session = Depends(get_db)):
    raiz = ET.Element("source")
    _hijo(raiz, "publisher", "Red Human AI")
    _hijo(raiz, "publisherurl", settings.app_url.rstrip("/"))
    _hijo(raiz, "lastbuilddate", format_datetime(datetime.now(timezone.utc), usegmt=True))
    for v in bolsas.vacantes_para(db, bolsas.TALENT):
        d = bolsas.datos_publicos(v)
        job = ET.SubElement(raiz, "job")
        _hijo(job, "referencenumber", d["id"])
        _hijo(job, "title", d["titulo"])
        _hijo(job, "company", d["empresa"])
        _hijo(job, "city", d["municipio"] or (d["ubicacion"] if not d["estado"] else None))
        _hijo(job, "state", d["estado"])
        _hijo(job, "country", d["pais"])
        _hijo(job, "dateposted", format_datetime(d["publicada_en"], usegmt=True) if d["publicada_en"] else None)
        _hijo(job, "url", bolsas.url_publica(v, "talent"))
        _hijo(job, "description", d["descripcion_html"])
        _hijo(job, "salary", d["sueldo"]["texto"] if d["sueldo"] else None)
        _hijo(job, "remotetype", "Remoto" if d["remoto"] else None)
    return _xml(raiz)
