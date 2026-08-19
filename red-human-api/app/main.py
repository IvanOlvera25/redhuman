"""Red Human AI — API (FastAPI).

Módulos implementados:
  1. Reclutamiento y selección  → /vacantes, /candidatos, /webhooks/whatsapp
  2. Contratación e integración → /contratacion

Documentación interactiva: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, SessionLocal, engine
from .migraciones import sincronizar
from .routers import auth, candidatos, contratacion, entrevistas, metricas, vacantes, webhooks
from .seed import sembrar, sembrar_admin
from .services.avatar import avatar_activo
from .services.ia import ia_activa
from .services.whatsapp import whatsapp_activo


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    cambios = sincronizar(engine)  # columnas nuevas sobre una base ya existente
    if cambios:
        print(f"[esquema] columnas agregadas: {', '.join(cambios)}")
    with SessionLocal() as db:
        sembrar(db)
        sembrar_admin(db)
    yield


app = FastAPI(
    title="Red Human AI · API",
    version="0.2.0",
    description="Agente integral de RH — Módulo 1 (Reclutamiento y selección) y Módulo 2 (Contratación e integración).",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    # con cookie de sesión el navegador exige orígenes explícitos: "*" no es válido junto con credenciales
    allow_origins=origins or ["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
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
        "avatar_configurado": avatar_activo(),
        "modelo": settings.openai_model,
        "modo": "producción" if ia_activa() else "demo (sin OPENAI_API_KEY)",
    }
