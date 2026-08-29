import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from .database import Base


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def slugificar(texto: str) -> str:
    """'Cajero(a) de sucursal' → 'cajero-a-de-sucursal' (para /aplicar/[slug])."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", plano.lower())).strip("-") or "vacante"


# Plataformas de publicación soportadas por el distribuidor (módulo 3.5).
PLATAFORMAS = ["WhatsApp", "OCC", "LinkedIn", "Portal"]


class Vacante(Base):
    __tablename__ = "vacantes"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(160), default="", index=True)
    titulo: Mapped[str] = mapped_column(String(200))
    area: Mapped[str] = mapped_column(String(100), default="")
    empresa: Mapped[str] = mapped_column(String(150), default="Grupo Carbe")
    ubicacion: Mapped[str] = mapped_column(String(150), default="")
    modalidad: Mapped[str] = mapped_column(String(30), default="Presencial")
    sueldo: Mapped[str] = mapped_column(String(80), default="A convenir")
    estado: Mapped[str] = mapped_column(String(30), default="Borrador")  # Publicada | Borrador | En revisión | Cerrada
    requisitos: Mapped[str] = mapped_column(Text, default="")
    descripcion: Mapped[str] = mapped_column(Text, default="")
    texto_whatsapp: Mapped[str] = mapped_column(Text, default="")
    texto_bolsa: Mapped[str] = mapped_column(Text, default="")
    preguntas_filtro: Mapped[list] = mapped_column(JSON, default=list)  # [str] (legado) o [PreguntaFiltro]
    plataformas: Mapped[list] = mapped_column(JSON, default=list)

    # --- contenido enriquecido del generador (módulo 3.5) ---
    resumen: Mapped[str] = mapped_column(Text, default="")
    perfil_ideal: Mapped[str] = mapped_column(Text, default="")
    responsabilidades: Mapped[list] = mapped_column(JSON, default=list)
    requisitos_deseables: Mapped[list] = mapped_column(JSON, default=list)
    beneficios: Mapped[list] = mapped_column(JSON, default=list)
    palabras_clave: Mapped[list] = mapped_column(JSON, default=list)
    seniority: Mapped[str] = mapped_column(String(40), default="")
    avisos_cumplimiento: Mapped[list] = mapped_column(JSON, default=list)
    # {"occ": {titulo, copy, page, etiquetas}, "linkedin": {...}, "portal": {...}, "whatsapp": {...}}
    publicaciones: Mapped[dict] = mapped_column(JSON, default=dict)

    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    actualizada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora, onupdate=ahora)

    # Origen: si esta vacante nació de una requisición autorizada (módulo 4). Puede ser null
    # para vacantes creadas directamente por RH sin pasar por el flujo de requisición.
    requisicion_id: Mapped[Optional[int]] = mapped_column(ForeignKey("requisiciones.id"), nullable=True)
    requisicion: Mapped[Optional["Requisicion"]] = relationship(back_populates="vacante")

    candidatos: Mapped[List["Candidato"]] = relationship(back_populates="vacante")


class Candidato(Base):
    __tablename__ = "candidatos"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(200))
    correo: Mapped[str] = mapped_column(String(200), default="")
    telefono: Mapped[str] = mapped_column(String(30), default="", index=True)
    ubicacion: Mapped[str] = mapped_column(String(150), default="")
    experiencia: Mapped[str] = mapped_column(String(250), default="")
    fuente: Mapped[str] = mapped_column(String(30), default="Formulario")  # Formulario|WhatsApp|OCC|LinkedIn|Indeed|RH
    estado: Mapped[str] = mapped_column(String(20), default="pendiente")  # cumple|revision|no_cumple|pendiente
    etapa: Mapped[str] = mapped_column(String(20), default="Prefiltro")  # Prefiltro|Entrevista|Evaluación|Contratación
    score: Mapped[int] = mapped_column(Integer, default=0)
    evidencia: Mapped[str] = mapped_column(Text, default="")
    cv_datos: Mapped[dict] = mapped_column(JSON, default=dict)
    # detalle del match del CV contra la vacante: {requisitos_cumplidos[], brechas[], origen}
    analisis: Mapped[dict] = mapped_column(JSON, default=dict)
    consentimiento: Mapped[bool] = mapped_column(Boolean, default=False)
    consentimiento_fecha: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    prefiltro_completo: Mapped[bool] = mapped_column(Boolean, default=False)
    # --- Zero-Touch fase 1: videollamada agendada por la IA (herramienta agendar_videollamada) ---
    # No confundir con el módulo de Entrevista (avatar/token público, tabla `entrevistas`): esto es
    # la liga de videollamada que el agente ofrece por WhatsApp justo después del prefiltro.
    videollamada_agendada_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    videollamada_liga: Mapped[str] = mapped_column(String(300), default="")
    # true en cuanto se manda el mensaje de rescate por inasistencia — evita reenviarlo cada 5 min
    videollamada_aviso_noshow_enviado: Mapped[bool] = mapped_column(Boolean, default=False)
    wa_nombre: Mapped[str] = mapped_column(String(200), default="")  # nombre del perfil de WhatsApp
    wa_id: Mapped[str] = mapped_column(String(30), default="", index=True)  # ID de WhatsApp (tel tal como lo envía Meta)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    vacante_id: Mapped[Optional[int]] = mapped_column(ForeignKey("vacantes.id"), nullable=True)
    vacante: Mapped[Optional[Vacante]] = relationship(back_populates="candidatos")
    mensajes: Mapped[List["Mensaje"]] = relationship(back_populates="candidato", order_by="Mensaje.id")
    expediente: Mapped[Optional["Expediente"]] = relationship(back_populates="candidato", uselist=False)
    entrevistas: Mapped[List["Entrevista"]] = relationship(back_populates="candidato", order_by="Entrevista.id")
    archivos: Mapped[List["Archivo"]] = relationship(
        back_populates="candidato", order_by="Archivo.id", cascade="all, delete-orphan"
    )


class Archivo(Base):
    """Archivo del prospecto (CV y anexos) — el expediente de contratación usa `Documento`."""

    __tablename__ = "archivos"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidato_id: Mapped[int] = mapped_column(ForeignKey("candidatos.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(40), default="cv")  # cv | carta | certificado | otro
    nombre: Mapped[str] = mapped_column(String(255), default="")  # nombre original del archivo
    ruta: Mapped[str] = mapped_column(String(400), default="")
    mime: Mapped[str] = mapped_column(String(80), default="")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    estado: Mapped[str] = mapped_column(String(20), default="recibido")  # recibido | revision | rechazado
    notas_ia: Mapped[str] = mapped_column(Text, default="")
    extraccion: Mapped[dict] = mapped_column(JSON, default=dict)
    subido_por: Mapped[str] = mapped_column(String(150), default="RH")
    subido_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    candidato: Mapped[Candidato] = relationship(back_populates="archivos")


class Entrevista(Base):
    """Entrevista estructurada con agente IA (módulo 3.10) — avatar de video o texto."""

    __tablename__ = "entrevistas"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    candidato_id: Mapped[int] = mapped_column(ForeignKey("candidatos.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # liga pública para el candidato
    tipo: Mapped[str] = mapped_column(String(12), default="avatar")  # avatar | texto
    estado: Mapped[str] = mapped_column(String(20), default="programada")  # programada | en_curso | completada | evaluada
    guion: Mapped[dict] = mapped_column(JSON, default=dict)  # {enfoque, preguntas[]}
    transcript: Mapped[list] = mapped_column(JSON, default=list)  # [{rol, texto}]
    evaluacion: Mapped[dict] = mapped_column(JSON, default=dict)  # EvaluacionEntrevista
    consentimiento: Mapped[bool] = mapped_column(Boolean, default=False)
    consentimiento_fecha: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    programada_para: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    candidato: Mapped[Candidato] = relationship(back_populates="entrevistas")


class Mensaje(Base):
    __tablename__ = "mensajes"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidato_id: Mapped[int] = mapped_column(ForeignKey("candidatos.id"), index=True)
    rol: Mapped[str] = mapped_column(String(12))  # user | assistant
    texto: Mapped[str] = mapped_column(Text)
    canal: Mapped[str] = mapped_column(String(20), default="whatsapp")  # whatsapp | web | simulador
    enviado: Mapped[bool] = mapped_column(Boolean, default=True)
    # id del mensaje en WhatsApp (wamid…). Meta reenvía el webhook si no le
    # contestamos rápido; guardarlo evita procesar dos veces el mismo mensaje.
    wa_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    candidato: Mapped[Candidato] = relationship(back_populates="mensajes")


# ============================================================
# Módulo 4 · Requisiciones inteligentes — Cazatalentos de IA
# ============================================================
#
# Flujo: un gerente levanta una Requisicion (por qué se abre la plaza, skills,
# sueldo) → RH la autoriza → al autorizar se corre el Radar Interno, que compara
# la requisición contra los Empleado activos y guarda cada resultado como
# SugerenciaMovilidad → si no hay match interno suficiente, RH decide publicar
# hacia afuera y la Requisicion se convierte en una Vacante (Vacante.requisicion_id).
# A partir de ahí corre el pipeline que ya existe: generador de contenido,
# prefiltro conversacional y extracción/ranking de CVs externos.


MOTIVOS_REQUISICION = ["Crecimiento", "Reemplazo"]
ESTADOS_REQUISICION = ["borrador", "pendiente_autorizacion", "autorizada", "rechazada", "convertida_vacante"]


class Requisicion(Base):
    """Solicitud de un gerente para abrir una plaza — vive ANTES de que exista la Vacante pública."""

    __tablename__ = "requisiciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)

    solicitante_id: Mapped[Optional[int]] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    solicitante_nombre: Mapped[str] = mapped_column(String(150), default="")
    area: Mapped[str] = mapped_column(String(100), default="")

    motivo: Mapped[str] = mapped_column(String(20), default="Crecimiento")  # Crecimiento | Reemplazo
    reemplazo_de: Mapped[str] = mapped_column(String(150), default="")  # solo si motivo == "Reemplazo"

    puesto: Mapped[str] = mapped_column(String(200))
    ubicacion: Mapped[str] = mapped_column(String(150), default="")
    modalidad: Mapped[str] = mapped_column(String(30), default="Presencial")
    sueldo_propuesto: Mapped[str] = mapped_column(String(80), default="A convenir")
    habilidades_requeridas: Mapped[list] = mapped_column(JSON, default=list)  # [str] — insumo del Radar Interno
    requisitos: Mapped[str] = mapped_column(Text, default="")
    justificacion: Mapped[str] = mapped_column(Text, default="")

    estado: Mapped[str] = mapped_column(String(30), default="borrador")
    autorizada_por: Mapped[str] = mapped_column(String(150), default="")
    autorizada_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    comentario_autorizacion: Mapped[str] = mapped_column(Text, default="")

    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    actualizada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora, onupdate=ahora)

    solicitante: Mapped[Optional["Usuario"]] = relationship()
    vacante: Mapped[Optional["Vacante"]] = relationship(back_populates="requisicion", uselist=False)
    sugerencias: Mapped[List["SugerenciaMovilidad"]] = relationship(
        back_populates="requisicion", order_by="SugerenciaMovilidad.porcentaje_match.desc()"
    )


class Empleado(Base):
    """Colaborador activo de la empresa — universo del Radar Interno y, a futuro, base del
    ciclo de vida del Colaborador (onboarding, capacitación, desempeño, clima)."""

    __tablename__ = "empleados"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(200))
    correo: Mapped[str] = mapped_column(String(200), default="")
    telefono: Mapped[str] = mapped_column(String(30), default="")
    puesto_actual: Mapped[str] = mapped_column(String(200), default="")
    area: Mapped[str] = mapped_column(String(100), default="")
    ubicacion: Mapped[str] = mapped_column(String(150), default="")
    seniority: Mapped[str] = mapped_column(String(40), default="")
    skills: Mapped[list] = mapped_column(JSON, default=list)  # [str] — insumo del match del Radar Interno
    anios_experiencia: Mapped[float] = mapped_column(Float, default=0.0)
    fecha_ingreso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    jefe_directo_id: Mapped[Optional[int]] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # si esta persona fue contratada a través de la plataforma, queda la trazabilidad completa
    candidato_origen_id: Mapped[Optional[int]] = mapped_column(ForeignKey("candidatos.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    jefe_directo: Mapped[Optional["Empleado"]] = relationship(remote_side=[id])
    candidato_origen: Mapped[Optional["Candidato"]] = relationship()
    sugerencias: Mapped[List["SugerenciaMovilidad"]] = relationship(back_populates="empleado")


ESTADOS_SUGERENCIA = ["sugerida", "notificada", "interesado", "no_interesado", "avanzo", "descartada"]


class SugerenciaMovilidad(Base):
    """Resultado del Radar Interno: qué tanto empata un empleado actual con una requisición,
    antes de salir a buscar afuera. La decisión final de avanzarlo siempre es de RH (HITL)."""

    __tablename__ = "sugerencias_movilidad"

    id: Mapped[int] = mapped_column(primary_key=True)
    requisicion_id: Mapped[int] = mapped_column(ForeignKey("requisiciones.id"), index=True)
    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), index=True)
    porcentaje_match: Mapped[int] = mapped_column(Integer, default=0)
    habilidades_coincidentes: Mapped[list] = mapped_column(JSON, default=list)
    habilidades_faltantes: Mapped[list] = mapped_column(JSON, default=list)
    evidencia: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="sugerida")
    revisado_por: Mapped[str] = mapped_column(String(150), default="")
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    requisicion: Mapped["Requisicion"] = relationship(back_populates="sugerencias")
    empleado: Mapped["Empleado"] = relationship(back_populates="sugerencias")


DOCUMENTOS_BASE = ["INE", "CURP", "RFC", "Comprobante de domicilio", "NSS"]


class Expediente(Base):
    __tablename__ = "expedientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidato_id: Mapped[int] = mapped_column(ForeignKey("candidatos.id"), unique=True)
    puesto: Mapped[str] = mapped_column(String(200), default="")
    fecha_ingreso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    estado: Mapped[str] = mapped_column(String(20), default="integracion")  # integracion | completo | alta
    alta_autorizada_por: Mapped[str] = mapped_column(String(150), default="")
    alta_fecha: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seleccionado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    candidato: Mapped[Candidato] = relationship(back_populates="expediente")
    documentos: Mapped[List["Documento"]] = relationship(
        back_populates="expediente", order_by="Documento.id", cascade="all, delete-orphan"
    )

    @property
    def obligatorios(self) -> List["Documento"]:
        return [d for d in self.documentos if d.obligatorio]

    @property
    def progreso(self) -> int:
        """% de documentos OBLIGATORIOS ya recibidos — es lo que habilita el alta."""
        docs = self.obligatorios
        if not docs:
            return 0
        recibidos = sum(1 for d in docs if d.estado == "recibido")
        return round(recibidos / len(docs) * 100)

    @property
    def pendientes(self) -> List[str]:
        return [d.tipo for d in self.obligatorios if d.estado in ("pendiente", "rechazado")]

    @property
    def por_revisar(self) -> List[str]:
        return [d.tipo for d in self.documentos if d.estado == "revision"]


class Documento(Base):
    __tablename__ = "documentos"

    id: Mapped[int] = mapped_column(primary_key=True)
    expediente_id: Mapped[int] = mapped_column(ForeignKey("expedientes.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(80))
    estado: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente | revision | recibido | rechazado
    obligatorio: Mapped[bool] = mapped_column(Boolean, default=True)
    archivo: Mapped[str] = mapped_column(String(300), default="")  # ruta en disco
    nombre_archivo: Mapped[str] = mapped_column(String(255), default="")  # nombre original
    mime: Mapped[str] = mapped_column(String(80), default="")
    tamano: Mapped[int] = mapped_column(Integer, default=0)
    notas_ia: Mapped[str] = mapped_column(Text, default="")
    validacion: Mapped[dict] = mapped_column(JSON, default=dict)  # salida cruda de ia.validar_documento
    revisado_por: Mapped[str] = mapped_column(String(150), default="")
    subido_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora, onupdate=ahora)

    expediente: Mapped[Expediente] = relationship(back_populates="documentos")


ROLES = ("admin", "rh", "lectura")


class Usuario(Base):
    """Persona de RH que opera la plataforma.

    La LFPDPPP exige que detrás de cada decisión haya alguien identificable, así
    que la bitácora firma con el usuario de la sesión, nunca con lo que mande el
    cliente. La contraseña se guarda como scrypt con sal por usuario.
    """

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    correo: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(150))
    puesto: Mapped[str] = mapped_column(String(120), default="")
    rol: Mapped[str] = mapped_column(String(20), default="rh")  # admin | rh | lectura
    hash_pass: Mapped[str] = mapped_column(String(255))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    debe_cambiar_pass: Mapped[bool] = mapped_column(Boolean, default=False)
    intentos_fallidos: Mapped[int] = mapped_column(Integer, default=0)
    bloqueado_hasta: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ultimo_acceso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    sesiones: Mapped[List["Sesion"]] = relationship(back_populates="usuario", cascade="all, delete-orphan")

    @property
    def bloqueado(self) -> bool:
        if not self.bloqueado_hasta:
            return False
        limite = self.bloqueado_hasta
        if limite.tzinfo is None:
            limite = limite.replace(tzinfo=timezone.utc)
        return limite > ahora()

    def puede_decidir(self) -> bool:
        """El rol 'lectura' consulta pero no firma decisiones."""
        return self.rol in ("admin", "rh")


class Sesion(Base):
    """Sesión en servidor: se puede revocar al instante (logout, baja de usuario)."""

    __tablename__ = "sesiones"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # sha256 del token de la cookie
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), index=True)
    expira_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ip: Mapped[str] = mapped_column(String(60), default="")
    agente: Mapped[str] = mapped_column(String(255), default="")
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    usuario: Mapped[Usuario] = relationship(back_populates="sesiones")


class Bitacora(Base):
    """Bitácora de auditoría append-only con cadena de hashes (LFPDPPP)."""

    __tablename__ = "bitacora"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    actor: Mapped[str] = mapped_column(String(150))
    accion: Mapped[str] = mapped_column(String(80))
    entidad: Mapped[str] = mapped_column(String(40))
    entidad_id: Mapped[str] = mapped_column(String(40))
    detalle: Mapped[dict] = mapped_column(JSON, default=dict)
    hash_prev: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


def registrar(db: Session, actor: str, accion: str, entidad: str, entidad_id: str, detalle: Optional[dict] = None) -> Bitacora:
    """Escribe un evento en la bitácora encadenando el hash del evento anterior."""
    prev = db.query(Bitacora).order_by(Bitacora.id.desc()).first()
    hash_prev = prev.hash if prev else "GENESIS"
    ts = ahora()
    payload = json.dumps(
        {"ts": ts.isoformat(), "actor": actor, "accion": accion, "entidad": entidad, "entidad_id": entidad_id, "detalle": detalle or {}},
        sort_keys=True,
        ensure_ascii=False,
    )
    h = hashlib.sha256((hash_prev + payload).encode("utf-8")).hexdigest()
    ev = Bitacora(ts=ts, actor=actor, accion=accion, entidad=entidad, entidad_id=entidad_id, detalle=detalle or {}, hash_prev=hash_prev, hash=h)
    db.add(ev)
    return ev