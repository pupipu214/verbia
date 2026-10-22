# db.py
import os
from datetime import datetime, timezone
from uuid import uuid4, UUID

from dotenv import load_dotenv
from sqlalchemy import (
    DateTime, ForeignKey, Integer, String, Text, create_engine, JSON, text
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = (
    create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5},
    )
    if DATABASE_URL
    else None
)
SessionLocal = (
    sessionmaker(bind=engine, autoflush=False, autocommit=False)
    if engine
    else None
)


class Base(DeclarativeBase):
    pass


class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    google_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    foto_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# ============================================================
# Tabla: sesiones
# ============================================================
class Sesion(Base):
    __tablename__ = "sesiones"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    # Sin FK a usuarios: en Supabase existe `usuarios` (no `users`) y la sesión
    # anónima de la cookie puede no existir ahí. Evita el 500 ForeignKeyViolation.
    user_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    personaje_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    personaje_nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fecha_inicio: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    fecha_fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duracion_segundos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mensajes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# ============================================================
# Tabla: analisis
# ============================================================
class Analisis(Base):
    __tablename__ = "analisis"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    sesion_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sesiones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    claridad: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ritmo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    muletillas: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pausas: Mapped[int | None] = mapped_column(Integer, nullable=True)
    palabras_por_minuto: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duracion_segundos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transcripcion_completa: Mapped[str | None] = mapped_column(Text, nullable=True)
    recomendaciones: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Coherencia: qué tan bien responde el usuario al hilo de la conversación.
    coherencia: Mapped[int | None] = mapped_column(Integer, nullable=True)
    desvios: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    resumen_coherencia: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Manejo del tema: qué tan bien se mantuvo el usuario en el tema de la sesión.
    manejo_tema: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retroalimentacion: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# ============================================================
# Tabla: personajes personalizados (Constructor)
# ============================================================
class PersonajeCustom(Base):
    __tablename__ = "personajes_custom"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    nombre: Mapped[str] = mapped_column(String(80), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tema: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    imagen_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    voice_id: Mapped[str] = mapped_column(String(80), nullable=False, default="fish-luis")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


def init_db() -> None:
    if engine is None:
        raise RuntimeError("Falta DATABASE_URL en la configuración del servidor")

    try:
        with engine.connect() as conn:
            # La BD ya existe con tabla `usuarios` (no `users`): quitar la FK rota
            # `sesiones_user_id_fkey -> users(id)` que causa el 500 al iniciar sesión.
            # Es idempotente: si no existe, no hace nada.
            conn.execute(text("ALTER TABLE sesiones DROP CONSTRAINT IF EXISTS sesiones_user_id_fkey"))
            # Nuevas columnas de coherencia (idempotente para BD ya creadas).
            conn.execute(text("ALTER TABLE analisis ADD COLUMN IF NOT EXISTS coherencia INTEGER"))
            conn.execute(text("ALTER TABLE analisis ADD COLUMN IF NOT EXISTS desvios JSON DEFAULT '[]'"))
            conn.execute(text("ALTER TABLE analisis ADD COLUMN IF NOT EXISTS resumen_coherencia TEXT"))
            conn.execute(text("ALTER TABLE analisis ADD COLUMN IF NOT EXISTS manejo_tema INTEGER"))
            conn.execute(text("ALTER TABLE analisis ADD COLUMN IF NOT EXISTS retroalimentacion TEXT"))
            # Tema de práctica del Constructor (saludo inicial del personaje).
            conn.execute(text("ALTER TABLE personajes_custom ADD COLUMN IF NOT EXISTS tema VARCHAR(80) NOT NULL DEFAULT ''"))
            conn.commit()
        Base.metadata.create_all(bind=engine)
        print("Conexion a PostgreSQL/Supabase verificada")
    except Exception:
        print("No se pudo conectar a PostgreSQL/Supabase")
        raise