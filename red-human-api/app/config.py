from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./redhuman.db"

    # IA (OpenAI)
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-luna"

    # Fase F — agente global "Pregunta a Red Human" (punto 29): tope diario de mensajes por
    # usuario (Q7) — evita abuso/costo descontrolado, sin bloquear el uso normal.
    agente_limite_mensajes_dia: int = 60

    # Avatar de entrevistas (Anam) — vacío = modo demo (entrevista por texto)
    anam_api_key: str = ""
    anam_avatar_id: str = ""
    anam_voice_id: str = ""
    anam_llm_id: str = ""
    anam_max_sesion_seg: int = 900

    # URL pública del frontend (ligas de entrevista para candidatos)
    app_url: str = "http://localhost:3000"

    # Primer administrador. Si no se define contraseña, se genera una al arrancar
    # y se imprime UNA sola vez en el log del servicio.
    admin_email: str = "admin@redhuman.mx"
    admin_nombre: str = "Administrador"
    admin_password: str = ""

    # WhatsApp
    # "meta" = WhatsApp Cloud API oficial (Meta) · "waha"/"evolution" = gateway propio
    # "" = modo demo (el mensaje se guarda en la base pero no sale)
    whatsapp_provider: str = ""
    whatsapp_public_number: str = ""  # número legible para deep-links wa.me

    # --- Meta · WhatsApp Cloud API ---
    meta_phone_number_id: str = ""   # id del número emisor (panel de Meta)
    meta_waba_id: str = ""           # id de la cuenta de WhatsApp Business
    meta_whatsapp_token: str = ""    # token de acceso (System User, permanente)
    # Mismo string que capturas al dar de alta el webhook en Meta.
    # TODO: mover a .env — este default quedó en el repo y conviene rotarlo.
    meta_verify_token: str = "redhuman_webhook_verify_token_2026_x89a"
    meta_app_secret: str = ""        # App Secret: valida la firma X-Hub-Signature-256
    meta_api_version: str = "v21.0"
    # Plantilla aprobada para escribirle a alguien fuera de la ventana de 24 h.
    # Sin ella, esos mensajes los rechaza Meta con el error 131047.
    meta_plantilla_aviso: str = ""
    meta_plantilla_idioma: str = "es_MX"

    # --- Gateway propio (alternativa sin costo por mensaje) ---
    waha_url: str = "http://localhost:3001"
    waha_api_key: str = ""
    waha_session: str = "default"
    evolution_url: str = "http://localhost:8080"
    evolution_api_key: str = ""
    evolution_instance: str = "redhuman"

    # --- Correo (Resend) ---
    # Vacío = modo demo (el envío se registra en bitácora como "no enviado"). El remitente
    # de sandbox (onboarding@resend.dev) solo entrega al correo con el que se creó la cuenta;
    # al verificar un dominio propio en Resend basta con cambiar RESEND_FROM, sin tocar código.
    resend_api_key: str = ""
    resend_from: str = "Red Human AI <onboarding@resend.dev>"

    # --- Microsoft Teams / Microsoft 365 (Fase 7B) ---
    # Nombres EXACTOS de las variables: TEAMS_CLIENT_ID, TEAMS_TENANT_ID, TEAMS_CLIENT_SECRET.
    # Vacías = integración no disponible (la videollamada pide la liga a mano, como siempre).
    # TEAMS_REDIRECT_URI es opcional: sin ella se usa el host real de la API + /integraciones/teams/callback.
    teams_client_id: str = ""
    teams_tenant_id: str = ""
    teams_client_secret: str = ""
    teams_redirect_uri: str = ""

    cors_origins: str = "http://localhost:3000"


settings = Settings()
