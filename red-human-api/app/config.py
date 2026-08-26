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

    # WhatsApp oficial (Meta Cloud API)
    meta_whatsapp_token: str = ""
    meta_phone_number_id: str = ""
    meta_waba_id: str = ""
    meta_verify_token: str = "redhuman_webhook_verify_token_2026_x89a"
    whatsapp_public_number: str = ""  # número legible para deep-links wa.me

    # WhatsApp gateway propio alternativo
    whatsapp_provider: str = ""  # "meta" | "waha" | "evolution" | "" (demo)
    waha_url: str = "http://localhost:3001"
    waha_api_key: str = ""
    waha_session: str = "default"
    evolution_url: str = "http://localhost:8080"
    evolution_api_key: str = ""
    evolution_instance: str = "redhuman"

    cors_origins: str = "http://localhost:3000"


settings = Settings()
