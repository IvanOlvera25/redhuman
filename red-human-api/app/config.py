from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./redhuman.db"

    # IA (OpenAI)
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-luna"

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

    # --- Meta · WhatsApp Cloud API ---
    meta_phone_number_id: str = ""   # id del número emisor (panel de Meta)
    meta_waba_id: str = ""           # id de la cuenta de WhatsApp Business
    meta_whatsapp_token: str = ""    # token de acceso (System User, permanente)
    meta_verify_token: str = ""      # el mismo string que capturas al dar de alta el webhook
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

    cors_origins: str = "http://localhost:3000"


settings = Settings()
