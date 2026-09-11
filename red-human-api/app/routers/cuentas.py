"""Gestión de la Cuenta activa del usuario (solo admin).

Punto 2 — sección 'Cuenta y Portal' de Configuración:
  GET  /cuentas/actual          → datos editables de la Cuenta activa
  PATCH /cuentas/actual         → editar campos de texto de la Cuenta
  POST  /cuentas/actual/logo    → subir/reemplazar logo (imagen)
"""
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_admin
from ..models import Cuenta, Usuario, registrar

router = APIRouter(prefix="/cuentas", tags=["cuentas"])

LOGOS_DIR = Path("archivos/logos")
EXTENSIONES_LOGO = {".png", ".jpg", ".jpeg", ".svg", ".webp"}


def _cuenta_dict(cu: Cuenta) -> dict:
    return {
        "id": cu.id,
        "nombreComercial": cu.nombre_comercial,
        "razonSocial": cu.razon_social,
        "logo": cu.logo,          # ruta en disco; el frontend construye la URL con urlArchivo()
        "contactoNombre": cu.contacto_nombre,
        "correoComunicacion": cu.correo_comunicacion,
        "whatsappComunicacion": cu.whatsapp_comunicacion,
        "estado": cu.estado,
    }


@router.get("/actual")
def obtener(
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_admin),
    cuenta: Cuenta = Depends(cuenta_actual),
) -> dict:
    """Datos editables de la Cuenta activa del usuario (solo administradores)."""
    return _cuenta_dict(cuenta)


class ActualizarCuentaIn(BaseModel):
    nombre_comercial: Optional[str] = None
    razon_social: Optional[str] = None
    contacto_nombre: Optional[str] = None
    correo_comunicacion: Optional[str] = None
    whatsapp_comunicacion: Optional[str] = None
    estado: Optional[str] = None


@router.patch("/actual")
def actualizar(
    datos: ActualizarCuentaIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_admin),
    cuenta: Cuenta = Depends(cuenta_actual),
) -> dict:
    """Editar campos de texto de la Cuenta activa (solo administradores)."""
    payload = datos.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(400, "No se enviaron campos a actualizar.")
    if "estado" in payload and payload["estado"] not in ("Activa", "Inactiva"):
        raise HTTPException(400, "Estado inválido. Usa 'Activa' o 'Inactiva'.")
    cambios = []
    for campo, valor in payload.items():
        setattr(cuenta, campo, valor)
        cambios.append(campo)
    registrar(db, u.nombre, "cuenta_actualizada", "cuenta", str(cuenta.id), {"campos": cambios})
    db.commit()
    db.refresh(cuenta)
    return _cuenta_dict(cuenta)


@router.post("/actual/logo")
async def subir_logo(
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_admin),
    cuenta: Cuenta = Depends(cuenta_actual),
) -> dict:
    """Reemplazar el logo de la Cuenta activa (PNG, JPG, SVG o WebP — solo administradores)."""
    ext = Path(archivo.filename or "logo.png").suffix.lower()
    if ext not in EXTENSIONES_LOGO:
        raise HTTPException(400, f"Formato no soportado. Usa: {', '.join(sorted(EXTENSIONES_LOGO))}")
    LOGOS_DIR.mkdir(parents=True, exist_ok=True)
    # Si ya había un logo anterior con el mismo prefijo, lo borramos para no acumular archivos.
    nombre_nuevo = f"logo_{cuenta.id}_{uuid.uuid4().hex[:8]}{ext}"
    ruta_nueva = LOGOS_DIR / nombre_nuevo
    if cuenta.logo:
        ruta_anterior = Path(cuenta.logo)
        if ruta_anterior.exists() and ruta_anterior.parent == LOGOS_DIR:
            try:
                os.remove(ruta_anterior)
            except OSError:
                pass  # si no se puede borrar, continúa de todos modos
    with ruta_nueva.open("wb") as f:
        shutil.copyfileobj(archivo.file, f)
    cuenta.logo = str(ruta_nueva)
    registrar(db, u.nombre, "cuenta_logo_actualizado", "cuenta", str(cuenta.id), {})
    db.commit()
    db.refresh(cuenta)
    return _cuenta_dict(cuenta)
