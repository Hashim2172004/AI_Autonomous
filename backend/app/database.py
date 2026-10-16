import secrets
from collections.abc import Iterator

from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

if settings.is_sqlite:
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()
else:
    # Hosted Postgres drops idle connections, and serverless instances come and go: check before use.
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=2, max_overflow=3, pool_recycle=300)


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _load_shared_secret_key() -> None:
    """Without SECRET_KEY, Postgres deployments keep one generated key in the database for all instances."""
    from .models import AppSecret

    with SessionLocal() as db:
        row = db.get(AppSecret, "jwt_secret")
        if row is None:
            db.add(AppSecret(name="jwt_secret", value=secrets.token_urlsafe(48)))
            try:
                db.commit()
            except IntegrityError:  # another instance created it first
                db.rollback()
            row = db.scalars(select(AppSecret).where(AppSecret.name == "jwt_secret")).one()
        settings.secret_key = row.value


def init_db() -> None:
    from . import models  # noqa: F401  (registers the tables)

    Base.metadata.create_all(bind=engine)
    if not settings.secret_key:
        _load_shared_secret_key()
