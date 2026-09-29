"""Dropbox Sign (antes HelloSign) — firma electrónica INCRUSTADA con el SDK oficial `dropbox-sign` (2026-09-29).

* Llaves SOLO por entorno: DROPBOX_SIGN_API_KEY y DROPBOX_SIGN_CLIENT_ID (`settings`). Sin ellas `configurado()` es
  False y el flujo sigue como antes (PDF + carga manual del firmado): nunca rompe la contratación.
* Marca blanca: la firma se hace en un modal dentro de NUESTRA interfaz (`@dropbox/sign-embedded` con el client_id de
  la API app). El logo/colores del modal se configuran en la API app de Dropbox Sign (white labeling), no aquí.
* Callbacks: llegan como multipart con el campo `json`; se validan con HMAC-SHA256 (llave = API key, mensaje =
  event_time + event_type), la misma fórmula de `dropbox_sign.EventCallbackHelper`, comparada en tiempo constante.
"""

import hashlib
import hmac
import io
from typing import List, Optional

from ..config import settings


class FirmaError(Exception):
    def __init__(self, mensaje: str, status: Optional[int] = None):
        super().__init__(mensaje)
        self.status = status


def configurado() -> bool:
    return bool(settings.dropbox_sign_api_key and settings.dropbox_sign_client_id)


def _cliente():
    if not configurado():
        raise FirmaError("La firma electrónica no está configurada (DROPBOX_SIGN_API_KEY / DROPBOX_SIGN_CLIENT_ID).", 503)
    try:
        import dropbox_sign
    except ImportError as ex:  # pragma: no cover — dependencia en requirements.txt
        raise FirmaError(f"Falta el SDK dropbox-sign en el servidor: {ex}", 503)
    return dropbox_sign, dropbox_sign.ApiClient(dropbox_sign.Configuration(username=settings.dropbox_sign_api_key))


def _error_sdk(ex: Exception) -> FirmaError:
    status = getattr(ex, "status", None)
    cuerpo = str(getattr(ex, "body", "") or ex)[:300]
    if status in (401, 403):
        return FirmaError(f"Dropbox Sign rechazó la credencial ({status}). Revisa DROPBOX_SIGN_API_KEY.", status)
    return FirmaError(f"Dropbox Sign respondió {status or 'error'}: {cuerpo}", status)


def crear_solicitud_embebida(pdf: bytes, nombre_archivo: str, titulo: str, asunto: str, mensaje: str,
                             firmantes: List[dict], metadata: dict) -> dict:
    """firmantes = [{nombre, correo}] → {signature_request_id, signatures: [{signature_id, correo, nombre}]}."""
    ds, cliente = _cliente()
    archivo = io.BytesIO(pdf)
    archivo.name = nombre_archivo
    try:
        with cliente as api_client:
            api = ds.apis.SignatureRequestApi(api_client)
            req = ds.models.SignatureRequestCreateEmbeddedRequest(
                client_id=settings.dropbox_sign_client_id,
                title=titulo[:255],
                subject=asunto[:255],
                message=mensaje[:5000],
                signers=[ds.models.SubSignatureRequestSigner(email_address=f["correo"], name=f["nombre"][:255]) for f in firmantes],
                files=[archivo],
                metadata={k: str(v)[:500] for k, v in metadata.items()},
                test_mode=bool(settings.dropbox_sign_test_mode),
            )
            resp = api.signature_request_create_embedded(req)
    except FirmaError:
        raise
    except Exception as ex:  # noqa: BLE001
        raise _error_sdk(ex)
    sr = resp.signature_request
    return {
        "signature_request_id": sr.signature_request_id,
        "signatures": [
            {"signature_id": s.signature_id, "correo": (s.signer_email_address or "").lower(), "nombre": s.signer_name or ""}
            for s in (sr.signatures or [])
        ],
    }


def sign_url(signature_id: str) -> str:
    """URL de firma incrustada (caduca en minutos: se pide justo antes de abrir el modal)."""
    ds, cliente = _cliente()
    try:
        with cliente as api_client:
            resp = ds.apis.EmbeddedApi(api_client).embedded_sign_url(signature_id)
    except Exception as ex:  # noqa: BLE001
        raise _error_sdk(ex)
    return resp.embedded.sign_url


def descargar_pdf(signature_request_id: str) -> bytes:
    """PDF final (todas las firmas + auditoría). Disponible cuando llega `signature_request_downloadable`."""
    ds, cliente = _cliente()
    try:
        with cliente as api_client:
            archivo = ds.apis.SignatureRequestApi(api_client).signature_request_files(signature_request_id, file_type="pdf")
    except Exception as ex:  # noqa: BLE001
        raise _error_sdk(ex)
    datos = archivo.read() if hasattr(archivo, "read") else bytes(archivo)
    if not datos.startswith(b"%PDF"):
        raise FirmaError("Dropbox Sign no regresó un PDF válido.")
    return datos


def evento_valido(evento: dict) -> bool:
    """event_hash == HMAC-SHA256(api_key, event_time + event_type), en tiempo constante."""
    ev = (evento or {}).get("event") or {}
    if not settings.dropbox_sign_api_key or not ev.get("event_hash"):
        return False
    esperado = hmac.new(
        settings.dropbox_sign_api_key.encode("utf-8"),
        f"{ev.get('event_time', '')}{ev.get('event_type', '')}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(esperado, str(ev.get("event_hash")))
