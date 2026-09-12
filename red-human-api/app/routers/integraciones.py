"""Configuración → Integraciones (Fase 7B): Microsoft Teams / Microsoft 365 por Cuenta.

Flujo: POST /conectar (admin) → URL de autorización de Microsoft (el navegador va ahí) →
GET /callback (público: llega desde Microsoft con `code` + `state` firmado) → se guardan los tokens
CIFRADOS en `integraciones_teams` → redirige a la app con ?teams=ok|error. Los tokens nunca salen
por la API. Sin TEAMS_CLIENT_ID/TENANT_ID/CLIENT_SECRET → `disponible: false` y todo lo demás 409.
"""

from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import cuenta_actual, usuario_admin
from ..models import Cuenta, IntegracionTeams, Usuario, registrar
from ..services import teams

router = APIRouter(prefix="/integraciones", tags=["integraciones"])


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _estado_dict(integ: Optional[IntegracionTeams], request: Request) -> dict:
    disponible = teams.teams_configurado()
    return {
        "disponible": disponible,
        "conectado": bool(integ),
        "usuarioM365": integ.usuario_m365 if integ else "",
        "nombreM365": integ.nombre_m365 if integ else "",
        "conectadoPor": integ.conectado_por if integ else "",
        "conectadoEn": _iso(integ.conectado_en) if integ else None,
        "expiraEn": _iso(integ.expira_en) if integ else None,
        "ultimoError": (integ.ultimo_error or "") if integ else "",
        # lo que hay que registrar en el App Registration de Azure
        "redirectUri": teams.redirect_uri(str(request.base_url)),
        "scopes": teams.SCOPES,
    }


@router.get("/teams")
def estado_teams(
    request: Request, db: Session = Depends(get_db), _: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)
):
    integ = db.query(IntegracionTeams).filter(IntegracionTeams.cuenta_id == cuenta.id).first()
    return _estado_dict(integ, request)


@router.post("/teams/conectar")
def conectar_teams(
    request: Request, db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)
):
    """Regresa la URL de autorización de Microsoft; el frontend navega ahí."""
    if not teams.teams_configurado():
        raise HTTPException(409, "Microsoft Teams no está configurado en este servidor (TEAMS_CLIENT_ID / TEAMS_TENANT_ID / TEAMS_CLIENT_SECRET).")
    uri = teams.redirect_uri(str(request.base_url))
    state = teams.firmar_state(cuenta.id, u.id, u.nombre)
    registrar(db, u.nombre, "teams_conexion_iniciada", "cuenta", str(cuenta.id), {"redirect_uri": uri})
    db.commit()
    return {"url": teams.url_autorizacion(state, uri), "redirectUri": uri}


@router.get("/teams/callback")
async def callback_teams(request: Request, code: str = "", state: str = "", error: str = "", error_description: str = "", db: Session = Depends(get_db)):
    """Retorno de Microsoft (sin sesión de Red Human: la identidad viene en el `state` firmado)."""
    destino = f"{settings.app_url.rstrip('/')}/dashboard/configuracion"

    def volver(**q):
        return RedirectResponse(f"{destino}?{urlencode(q)}", status_code=302)

    if not teams.teams_configurado():
        return volver(teams="error", motivo="Teams no está configurado en el servidor")
    if error:
        return volver(teams="error", motivo=f"{error}: {error_description}"[:200])
    try:
        datos = teams.leer_state(state)
    except teams.TeamsError as e:
        return volver(teams="error", motivo=str(e))
    if not code:
        return volver(teams="error", motivo="Microsoft no regresó el código de autorización")

    cuenta = db.query(Cuenta).filter(Cuenta.id == datos["c"]).first()
    if not cuenta:
        return volver(teams="error", motivo="La Cuenta ya no existe")
    try:
        tokens = await teams.intercambiar_codigo(code, teams.redirect_uri(str(request.base_url)))
        me = await teams.perfil(tokens["access_token"])
    except teams.TeamsError as e:
        return volver(teams="error", motivo=str(e)[:200])

    integ = db.query(IntegracionTeams).filter(IntegracionTeams.cuenta_id == cuenta.id).first()
    if not integ:
        integ = IntegracionTeams(cuenta_id=cuenta.id)
        db.add(integ)
    teams.guardar_tokens(integ, tokens)
    integ.usuario_m365 = me["upn"]
    integ.nombre_m365 = me["nombre"]
    integ.conectado_por = datos.get("n", "")
    integ.conectado_en = datetime.now(timezone.utc)
    registrar(db, datos.get("n", "sistema"), "teams_conectado", "cuenta", str(cuenta.id), {"usuario_m365": me["upn"]})
    db.commit()
    return volver(teams="ok", usuario=me["upn"])


@router.post("/teams/probar")
async def probar_teams(db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)):
    """Valida la conexión sin programar nada: renueva el token si hace falta y consulta /me."""
    integ = teams.integracion_de(db, cuenta.id)
    if not integ:
        raise HTTPException(409, "Esta Cuenta no tiene Microsoft Teams conectado.")
    try:
        token = await teams.token_vigente(db, integ)
        me = await teams.perfil(token)
    except teams.TeamsError as e:
        integ.ultimo_error = str(e)[:300]
        db.commit()
        raise HTTPException(502, str(e))
    integ.ultimo_error = ""
    db.commit()
    return {"ok": True, "usuarioM365": me["upn"], "nombreM365": me["nombre"]}


@router.delete("/teams")
def desconectar_teams(db: Session = Depends(get_db), u: Usuario = Depends(usuario_admin), cuenta: Cuenta = Depends(cuenta_actual)):
    integ = db.query(IntegracionTeams).filter(IntegracionTeams.cuenta_id == cuenta.id).first()
    if not integ:
        raise HTTPException(404, "Esta Cuenta no tiene Microsoft Teams conectado.")
    registrar(db, u.nombre, "teams_desconectado", "cuenta", str(cuenta.id), {"usuario_m365": integ.usuario_m365})
    db.delete(integ)
    db.commit()
    return {"ok": True}
