"""Red Human AI — API (FastAPI).

Módulos implementados:
  1. Reclutamiento y selección  → /vacantes, /candidatos, /webhooks/whatsapp
  2. Contratación e integración → /contratacion
  4. Requisiciones inteligentes → /requisiciones

Documentación interactiva: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, SessionLocal, engine
from .migraciones import sincronizar
from .routers import auth, candidatos, contratacion, empleados, entrevistas, metricas, requisiciones, vacantes, webhooks
from .seed import sembrar, sembrar_admin
from .services.agenda import revisar_videollamadas_noshow
from .services.avatar import avatar_activo
from .services.ia import ia_activa
from .services.whatsapp import proveedor as whatsapp_proveedor, whatsapp_activo

# Zero-Touch fase 1: barre videollamadas vencidas cada 5 min (ver services/agenda.py).
scheduler = AsyncIOScheduler(timezone="UTC")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    cambios = sincronizar(engine)  # columnas nuevas sobre una base ya existente
    if cambios:
        print(f"[esquema] columnas agregadas: {', '.join(cambios)}")
    with SessionLocal() as db:
        sembrar(db)
        sembrar_admin(db)

    scheduler.add_job(
        revisar_videollamadas_noshow, "interval", minutes=5,
        id="noshow_videollamadas", replace_existing=True,
    )
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="Red Human AI · API",
    version="0.2.0",
    description="Agente integral de RH — Módulo 1 (Reclutamiento y selección) y Módulo 2 (Contratación e integración).",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://192.168.100.50:3000",
]
for d in default_origins:
    if d not in origins:
        origins.append(d)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(requisiciones.router)
app.include_router(empleados.router)
app.include_router(vacantes.router)
app.include_router(candidatos.router)
app.include_router(entrevistas.router)
app.include_router(contratacion.router)
app.include_router(metricas.router)
app.include_router(webhooks.router)


@app.get("/salud")
def salud():
    return {
        "ok": True,
        "ia_configurada": ia_activa(),
        "whatsapp_configurado": whatsapp_activo(),
        "whatsapp_proveedor": whatsapp_proveedor(),
        "whatsapp_webhook_firmado": bool(settings.meta_app_secret) if settings.whatsapp_provider == "meta" else None,
        "avatar_configurado": avatar_activo(),
        "modelo": settings.openai_model,
        "modo": "producción" if ia_activa() else "demo (sin OPENAI_API_KEY)",
    }