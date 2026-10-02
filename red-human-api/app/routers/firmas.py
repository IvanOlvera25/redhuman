"""Firma electrónica incrustada (Dropbox Sign) de la carta de intención y el contrato — 2026-09-29.

Flujo (marca blanca, todo dentro de nuestra interfaz):
  1. RH pulsa «Generar carta de intención» / «Generar contrato» → `POST /firmas/expedientes/{id}` genera el PDF con las
     condiciones guardadas y crea el *Embedded Signature Request* con DOS firmantes: la persona de RH (representante
     de la empresa) y el candidato. Regresa el `sign_url` de RH → modal incrustado en el tablero.
  2. El candidato firma en SU liga de expediente (`/expediente/{token}`): `POST /firmas/publica/{token}/{firma}/sign-url`
     le da su `sign_url` → mismo modal incrustado. Nadie firma por otra persona.
  3. `POST /api/webhooks/dropbox` (routers/webhooks_proveedores.py) marca las firmas y, con
     `signature_request_downloadable`, descarga el PDF final y lo guarda en el expediente (documento interno).
Sin DROPBOX_SIGN_API_KEY / DROPBOX_SIGN_CLIENT_ID → 503 claro y la UI sigue con la vista previa del PDF.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import DOCUMENTOS_FIRMA, Cuenta, Expediente, FirmaDocumento, Usuario, registrar
from ..services import dropbox_sign as dsign
from ..services.modulos_rh import requiere_modulos_rh

router = APIRouter(prefix="/firmas", tags=["firmas"], dependencies=[Depends(requiere_modulos_rh)])


def firma_dict(f: FirmaDocumento) -> dict:
    return {
        "id": f.id,
        "expedienteId": f.expediente_id,
        "documento": f.documento,
        "documentoTexto": DOCUMENTOS_FIRMA.get(f.documento, f.documento),
        "estado": f.estado,
        "testMode": bool(f.test_mode),
        "firmantes": [{"rol": x.get("rol"), "nombre": x.get("nombre"), "estado": x.get("estado", "pendiente")} for x in (f.firmantes or [])],
        "firmadoPdf": bool(f.documento_id),
        "error": f.error or "",
        "creadoPor": f.creado_por or "",
        "creadoEn": f.creado_en.isoformat() if f.creado_en else None,
        "firmadaEn": f.firmada_en.isoformat() if f.firmada_en else None,
    }


@router.get("/estado")
def estado(_: Usuario = Depends(usuario_actual)):
    """Lo que el frontend necesita para abrir el modal incrustado (el client_id es público por diseño)."""
    return {"configurado": dsign.configurado(), "clientId": settings.dropbox_sign_client_id if dsign.configurado() else None,
            "testMode": bool(settings.dropbox_sign_test_mode)}


def _firmante(f: FirmaDocumento, rol: str) -> Optional[dict]:
    return next((x for x in (f.firmantes or []) if x.get("rol") == rol), None)


def _sign_url(f: FirmaDocumento, rol: str) -> Optional[str]:
    x = _firmante(f, rol)
    if not x or x.get("estado") == "firmado" or f.estado != "enviada":
        return None
    try:
        return dsign.sign_url(x["signature_id"])
    except dsign.FirmaError as ex:
        raise HTTPException(502 if ex.status is None or ex.status >= 500 or ex.status in (401, 403) else 409, str(ex))


# Orden de `signers` en la solicitud: 0 = representante de RH (empresa), 1 = candidato. Los campos usan este índice.
INDICE_FIRMANTE = {"empresa": 0, "candidato": 1}


def _paginas(pdf: bytes) -> int:
    import io

    from pypdf import PdfReader

    return len(PdfReader(io.BytesIO(pdf)).pages)


class CrearFirmaIn(BaseModel):
    documento: str  # carta | contrato


@router.post("/expedientes/{exp_id}")
def crear_firma(exp_id: int, datos: CrearFirmaIn, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    from ..services.configuracion import modo_prueba_activo
    from ..services.pdf import pdf_carta_intencion, pdf_contrato
    from .contratacion import _datos_carta_intencion, _documentos_listos, _expediente

    if datos.documento not in DOCUMENTOS_FIRMA:
        raise HTTPException(400, "Documento inválido: usa carta o contrato.")
    if not dsign.configurado():
        raise HTTPException(503, "La firma electrónica no está configurada en este servidor (DROPBOX_SIGN_API_KEY / DROPBOX_SIGN_CLIENT_ID).")
    e: Expediente = _expediente(db, exp_id, cuenta.id)
    if e.estado == "alta" and datos.documento == "carta":
        raise HTTPException(409, "El colaborador ya fue dado de alta.")
    # una solicitud viva del mismo documento se REUTILIZA (no se manda doble a firmar)
    viva = (
        db.query(FirmaDocumento)
        .filter(FirmaDocumento.expediente_id == e.id, FirmaDocumento.cuenta_id == cuenta.id, FirmaDocumento.documento == datos.documento, FirmaDocumento.estado == "enviada")
        .order_by(FirmaDocumento.id.desc())
        .first()
    )
    if viva:
        return {**firma_dict(viva), "signUrl": _sign_url(viva, "rh"), "reutilizada": True}

    prueba = modo_prueba_activo(db)
    if not (e.puesto and e.sueldo and e.tipo_contratacion and e.fecha_ingreso) and not prueba:
        raise HTTPException(409, "Captura y guarda las condiciones de contratación antes de mandar a firmar.")
    if datos.documento == "contrato" and not _documentos_listos(e) and not prueba:
        raise HTTPException(409, f"El contrato se firma cuando el expediente tiene el 100 % de documentos Aprobados (hoy {e.progreso} %).")
    p = e.postulacion
    correo_cand = (p.correo if p else "") or (e.candidato.correo if e.candidato else "")
    if not correo_cand:
        raise HTTPException(409, "El candidato no tiene correo: Dropbox Sign lo necesita para identificar al firmante.")
    if not u.correo:
        raise HTTPException(409, "Tu usuario no tiene correo para firmar como representante de la empresa.")
    if u.correo.strip().lower() == correo_cand.strip().lower():
        raise HTTPException(409, "El correo del candidato es el mismo que el tuyo: cada firmante necesita su propio correo.")
    d = _datos_carta_intencion(e)
    # 2026-09-29 (marca blanca): el PDF trae la posición exacta de cada firma; los campos se colocan SOBRE su última
    # página y Dropbox Sign ya no anexa su «Signature page».
    pdf, zonas = pdf_carta_intencion(d, con_zonas=True) if datos.documento == "carta" else pdf_contrato({**d, "borrador": False}, con_zonas=True)
    if not zonas or {z["pagina"] for z in zonas} != {_paginas(pdf)}:
        raise HTTPException(500, "No se pudieron ubicar las firmas en la última página del documento.")
    nombre_cand = (p.nombre if p else "") or (e.candidato.nombre if e.candidato else "Candidato")
    titulo = f"{DOCUMENTOS_FIRMA[datos.documento]} — {nombre_cand}"
    try:
        sr = dsign.crear_solicitud_embebida(
            pdf, f"{datos.documento}-{e.id}.pdf", titulo, titulo,
            f"{d.get('empresa') or cuenta.nombre_visible}: firma de {DOCUMENTOS_FIRMA[datos.documento].lower()} para el puesto {e.puesto}.",
            [{"nombre": u.nombre, "correo": u.correo}, {"nombre": nombre_cand, "correo": correo_cand}],
            {"expediente_id": e.id, "cuenta_id": cuenta.id, "documento": datos.documento},
            zonas=zonas, indice_por_rol=INDICE_FIRMANTE,
        )
    except dsign.FirmaError as ex:
        raise HTTPException(503 if ex.status == 503 else 502, str(ex))
    por_correo = {s["correo"]: s for s in sr["signatures"]}
    firmantes = []
    for rol, nombre, correo in (("rh", u.nombre, u.correo), ("candidato", nombre_cand, correo_cand)):
        s = por_correo.get(correo.lower())
        firmantes.append({"rol": rol, "nombre": nombre, "correo": correo, "signature_id": s["signature_id"] if s else "", "estado": "pendiente"})
    f = FirmaDocumento(
        cuenta_id=cuenta.id, expediente_id=e.id, documento=datos.documento, signature_request_id=sr["signature_request_id"],
        firmantes=firmantes, estado="enviada", test_mode=bool(settings.dropbox_sign_test_mode), creado_por=u.nombre, eventos=[],
    )
    db.add(f)
    db.flush()
    registrar(db, u.nombre, "firma_solicitada", "expediente", str(e.id),
              {"documento": datos.documento, "signature_request_id": f.signature_request_id, "test_mode": f.test_mode, "correo_rh": u.correo})
    db.commit()
    return {**firma_dict(f), "signUrl": _sign_url(f, "rh"), "reutilizada": False}


@router.get("/expedientes/{exp_id}")
def listar_firmas(exp_id: int, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual), cuenta: Cuenta = Depends(cuenta_actual)):
    from .contratacion import _expediente

    e = _expediente(db, exp_id, cuenta.id)
    return [firma_dict(f) for f in db.query(FirmaDocumento).filter(FirmaDocumento.expediente_id == e.id, FirmaDocumento.cuenta_id == cuenta.id).order_by(FirmaDocumento.id.desc()).all()]


@router.post("/{firma_id}/sign-url")
def sign_url_rh(firma_id: int, db: Session = Depends(get_db), u: Usuario = Depends(usuario_decisor), cuenta: Cuenta = Depends(cuenta_actual)):
    """URL fresca para que la persona de RH firme (caduca en minutos). Solo la firma quien la creó."""
    f = db.query(FirmaDocumento).filter(FirmaDocumento.id == firma_id, FirmaDocumento.cuenta_id == cuenta.id).first()
    if not f:
        raise HTTPException(404, "Firma no encontrada.")
    rh = _firmante(f, "rh")
    if rh and (rh.get("correo") or "").lower() != (u.correo or "").lower():
        raise HTTPException(403, f"Esta firma la debe hacer {rh.get('nombre')} (representante registrado).")
    return {**firma_dict(f), "signUrl": _sign_url(f, "rh")}


# ---------------- Pública: el candidato firma en su liga de expediente ----------------

def _exp_publico(db: Session, token: str) -> Expediente:
    e = db.query(Expediente).filter(Expediente.token == token).first() if token else None
    if not e:
        raise HTTPException(404, "Esta liga no es válida.")
    return e


@router.get("/publica/{token}")
def firmas_publicas(token: str, db: Session = Depends(get_db)):
    e = _exp_publico(db, token)
    salida = []
    for f in db.query(FirmaDocumento).filter(FirmaDocumento.expediente_id == e.id).order_by(FirmaDocumento.id.desc()).all():
        c = _firmante(f, "candidato")
        salida.append({"id": f.id, "documento": DOCUMENTOS_FIRMA.get(f.documento, f.documento),
                       "estado": f.estado, "yoFirme": bool(c and c.get("estado") == "firmado")})
    return {"configurado": dsign.configurado(), "clientId": settings.dropbox_sign_client_id if dsign.configurado() else None,
            "testMode": bool(settings.dropbox_sign_test_mode), "firmas": salida}


@router.post("/publica/{token}/{firma_id}/sign-url")
def sign_url_candidato(token: str, firma_id: int, db: Session = Depends(get_db)):
    e = _exp_publico(db, token)
    f = db.query(FirmaDocumento).filter(FirmaDocumento.id == firma_id, FirmaDocumento.expediente_id == e.id).first()
    if not f:
        raise HTTPException(404, "Documento no encontrado.")
    url = _sign_url(f, "candidato")
    if not url:
        raise HTTPException(409, "Este documento ya está firmado o ya no está disponible para firma.")
    return {"signUrl": url, "clientId": settings.dropbox_sign_client_id, "testMode": bool(settings.dropbox_sign_test_mode)}


def procesar_evento_firma(db: Session, evento: dict) -> str:
    """Aplica un evento YA VERIFICADO de Dropbox Sign. Idempotente (Dropbox reintenta)."""
    from ..models import TIPO_CARTA_FIRMADA, TIPO_CONTRATO_FIRMADO
    from ..services import onboarding as onb

    ev = evento.get("event") or {}
    tipo = ev.get("event_type") or ""
    sr = evento.get("signature_request") or {}
    sr_id = sr.get("signature_request_id") or ""
    if not sr_id:
        return "sin_solicitud"
    f = db.query(FirmaDocumento).filter(FirmaDocumento.signature_request_id == sr_id).first()
    if not f:
        return "desconocida"
    f.eventos = list(f.eventos or []) + [{"fecha": datetime.now(timezone.utc).isoformat(), "tipo": tipo}]
    # estado por firmante según lo que reporta la solicitud
    firmados = {(s.get("signature_id") or "") for s in (sr.get("signatures") or []) if s.get("status_code") == "signed"}
    relacionado = ((ev.get("event_metadata") or {}).get("related_signature_id")) or ""
    if tipo == "signature_request_signed" and relacionado:
        firmados.add(relacionado)
    f.firmantes = [{**x, "estado": "firmado" if x.get("signature_id") in firmados else x.get("estado", "pendiente")} for x in (f.firmantes or [])]
    if tipo in ("signature_request_declined", "signature_request_canceled", "signature_request_expired"):
        f.estado = "cancelada"
    elif tipo in ("signature_request_all_signed", "signature_request_downloadable") and f.estado in ("enviada", "firmada", "error"):
        f.estado = "firmada"
        f.firmada_en = f.firmada_en or datetime.now(timezone.utc)
        f.firmantes = [{**x, "estado": "firmado"} for x in f.firmantes]
        if not f.documento_id:
            # el PDF final puede no estar listo con all_signed; con `downloadable` sí (se reintenta ahí)
            try:
                pdf = dsign.descargar_pdf(sr_id)
                e = db.get(Expediente, f.expediente_id)
                tipo_doc = TIPO_CONTRATO_FIRMADO if f.documento == "contrato" else TIPO_CARTA_FIRMADA
                doc = onb.guardar_documento_firmado(db, e, tipo_doc, pdf, f"{f.documento}-firmado-{e.id}.pdf", "Dropbox Sign (firma electrónica)", canal="firma_electronica")
                f.documento_id = doc.id
                f.estado, f.error = "descargada", ""
                registrar(db, "dropbox-sign", "documento_firmado_guardado", "expediente", str(e.id),
                          {"documento": f.documento, "signature_request_id": sr_id, "evento": tipo})
            except Exception as ex:  # noqa: BLE001
                f.error = str(ex)[:500]
    db.commit()
    return f.estado
