from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

ES_SQLITE = settings.database_url.startswith("sqlite")
# Hotfix concurrencia 2026-09-24: con varios usuarios escribiendo a la vez, SQLite en modo journal
# clásico bloquea TODAS las lecturas durante cada escritura y la espera por defecto (5 s) termina en
# "database is locked". `timeout` = cuánto espera el driver un candado antes de fallar.
connect_args = {"check_same_thread": False, "timeout": 20} if ES_SQLITE else {}
engine = create_engine(settings.database_url, connect_args=connect_args)

if ES_SQLITE:

    @event.listens_for(engine, "connect")
    def _pragmas_sqlite(dbapi_con, _registro):
        """WAL: los lectores ya no esperan al escritor (y viceversa); synchronous=NORMAL es seguro en
        WAL (solo se arriesga la última transacción ante un corte de luz, nunca la integridad).
        `journal_mode` persiste en el archivo; los demás son por conexión. Ojo al respaldar: copiar
        también `redhuman.db-wal` y `-shm` (o usar `sqlite3 redhuman.db ".backup …"`)."""
        cur = dbapi_con.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=20000")
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
