"""Clientes — empresas para las que recluta una Cuenta (Fase B, reestructuración multi-cuenta,
punto 8). Sin contactos de Cliente todavía — fuera de alcance de esta fase."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import cuenta_actual, usuario_actual, usuario_decisor
from ..models import Cliente, Cuenta, Usuario, registrar

router = APIRouter(prefix="/clientes", tags=["clientes"])

ESTADOS = ("Activo", "Inactivo")


def _cliente_dict(c: Cliente) -> dict:
    return {"id": c.id, "nombre": c.nombre, "estado": c.estado, "creado": c.creado_en.isoformat()}


def _por_id(db: Session, cliente_id: int, cuenta_id: int) -> Cliente:
    c = db.query(Cliente).filter(Cliente.id == cliente_id, Cliente.cuenta_id == cuenta_id).first()
    if not c:
        raise HTTPException(404, "Cliente no encontrado")
    return c


@router.get("")
def listar(
    estado: Optional[str] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    q = db.query(Cliente).filter(Cliente.cuenta_id == cuenta.id).order_by(Cliente.nombre)
    if estado:
        q = q.filter(Cliente.estado == estado)
    return [_cliente_dict(c) for c in q.all()]


class CrearIn(BaseModel):
    nombre: str
    estado: str = "Activo"


@router.post("", status_code=201)
def crear(
    datos: CrearIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    nombre = datos.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre del Cliente es obligatorio.")
    if datos.estado not in ESTADOS:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS)}")
    existente = db.query(Cliente).filter(Cliente.cuenta_id == cuenta.id, Cliente.nombre.ilike(nombre)).first()
    if existente:
        raise HTTPException(409, f"Ya existe un Cliente llamado '{existente.nombre}' en esta Cuenta.")

    c = Cliente(cuenta_id=cuenta.id, nombre=nombre, estado=datos.estado)
    db.add(c)
    db.flush()
    registrar(db, u.nombre, "cliente_creado", "cliente", str(c.id), {"nombre": c.nombre})
    db.commit()
    return _cliente_dict(c)


class ActualizarIn(BaseModel):
    nombre: Optional[str] = None
    estado: Optional[str] = None


@router.patch("/{cliente_id}")
def actualizar(
    cliente_id: int,
    datos: ActualizarIn,
    db: Session = Depends(get_db),
    u: Usuario = Depends(usuario_decisor),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    c = _por_id(db, cliente_id, cuenta.id)
    if datos.estado is not None and datos.estado not in ESTADOS:
        raise HTTPException(400, f"Estado inválido. Usa uno de: {', '.join(ESTADOS)}")

    cambios = []
    if datos.nombre is not None and datos.nombre.strip():
        c.nombre = datos.nombre.strip()
        cambios.append("nombre")
    if datos.estado is not None:
        c.estado = datos.estado
        cambios.append("estado")

    if cambios:
        registrar(db, u.nombre, "cliente_editado", "cliente", str(c.id), {"campos": cambios})
        db.commit()
    return _cliente_dict(c)
