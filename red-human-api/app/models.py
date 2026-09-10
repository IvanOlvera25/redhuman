import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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

# Kanban de Candidato.etapa — flujo confirmado con el cliente (documento + audio, 2026-08-29):
# Prefiltro -> Entrevista IA -> Evaluación -> Entrevista Humana -> Contratación -> Onboarding.
# "Entrevista IA" cubre TANTO la videollamada mock que agenda el agente (Zero-Touch,
# ver candidatos._procesar_turno_agenda) COMO la entrevista con avatar del módulo 3.10
# (ver entrevistas.py): ambas las conduce la IA. "Entrevista Humana" es la única etapa
# nueva que RH mueve a mano sin automatización detrás.
ETAPAS_CANDIDATO = ["Prefiltro", "Entrevista IA", "Evaluación", "Entrevista Humana", "Contratación", "Onboarding"]


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
    # Fase C: fecha de primera publicación — se estampa automáticamente en publicar(), nunca captura manual.
    # NULL para vacantes que aún no se han publicado o que existían antes del deploy de Fase C.
    publicada_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Origen: si esta vacante nació de una requisición autorizada (módulo 4). Puede ser null
    # para vacantes creadas directamente por RH sin pasar por el flujo de requisición.
    requisicion_id: Mapped[Optional[int]] = mapped_column(ForeignKey("requisiciones.id"), nullable=True)
    requisicion: Mapped[Optional["Requisicion"]] = relationship(back_populates="vacante")

    # --- Cuenta/Cliente (Fase A multi-cuenta) — nullable a nivel de esquema (SQLite sin Alembic
    # no puede agregar NOT NULL retroactivo); la obligatoriedad de cuenta_id se aplica en capa de
    # aplicación. cliente_id es opcional de verdad: una Cuenta sin Clientes recluta directo.
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)
    cliente_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clientes.id"), nullable=True, index=True)

    # --- Fase B: creación de vacante (Responsable/Colaboradores/plantilla/visibilidad del Cliente) ---
    responsable_id: Mapped[Optional[int]] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    # lista de ids de Usuario — sin tabla puente, mismo patrón que Vacante.plataformas/preguntas_filtro
    colaboradores_ids: Mapped[list] = mapped_column(JSON, default=list)
    # solo aplica si cliente_id está definido; default True = comportamiento de hoy (se muestra)
    mostrar_cliente_candidato: Mapped[bool] = mapped_column(Boolean, default=True)
    # de qué Plantilla nació esta vacante, si de alguna — solo trazabilidad, no fuerza nada
    plantilla_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plantillas.id"), nullable=True)

    responsable: Mapped[Optional["Usuario"]] = relationship(foreign_keys=[responsable_id])
    cliente: Mapped[Optional["Cliente"]] = relationship()
    cuenta: Mapped[Optional["Cuenta"]] = relationship()

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
    etapa: Mapped[str] = mapped_column(String(30), default="Prefiltro")  # ver ETAPAS_CANDIDATO
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
    # --- Entrevista Humana: LEGADO — puente para scripts/migrar_entrevistas_humanas.py.
    # Reemplazadas por la tabla EntrevistaHumana (uno a muchos, ver abajo); ya no las lee ni
    # las escribe ningún endpoint. Se conservan sin tocar hasta correr la migración de datos.
    entrevista_humana_entrevistador: Mapped[str] = mapped_column(String(150), default="")  # nombre a mostrar (usuario.nombre si es interno, tecleado si es externo)
    entrevista_humana_tipo: Mapped[str] = mapped_column(String(20), default="")  # interno | externo
    entrevista_humana_usuario_id: Mapped[Optional[int]] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    entrevista_humana_correo_externo: Mapped[str] = mapped_column(String(200), default="")
    entrevista_humana_fecha: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    entrevista_humana_modalidad: Mapped[str] = mapped_column(String(20), default="")  # Presencial|Videollamada|Llamada
    entrevista_humana_liga: Mapped[str] = mapped_column(String(300), default="")  # obligatoria si modalidad=Videollamada
    entrevista_humana_ubicacion: Mapped[str] = mapped_column(String(300), default="")  # obligatoria si modalidad=Presencial
    entrevista_humana_telefono_contacto: Mapped[str] = mapped_column(String(30), default="")  # opcional si modalidad=Llamada
    entrevista_humana_comentario: Mapped[str] = mapped_column(Text, default="")
    entrevista_humana_realizada: Mapped[bool] = mapped_column(Boolean, default=False)
    entrevista_humana_resultado: Mapped[str] = mapped_column(String(20), default="")  # aprobado | no_aprobado
    entrevista_humana_recomendacion: Mapped[str] = mapped_column(String(30), default="")  # avanzar | no_avanzar | segunda_entrevista
    wa_nombre: Mapped[str] = mapped_column(String(200), default="")  # nombre del perfil de WhatsApp
    wa_id: Mapped[str] = mapped_column(String(30), default="", index=True)  # ID de WhatsApp (tel tal como lo envía Meta)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    # Fase C: última actividad relevante (cambio de etapa, evaluación, entrevista, mensaje, documento,
    # nota, contratación, onboarding). Se actualiza en los endpoints correspondientes; NULL para
    # candidatos sin actividad registrada desde el deploy de Fase C (backfill via script).
    ultima_actividad_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Fase C: resultado vigente más reciente de todas las evaluaciones (Prefiltro IA, Entrevista IA,
    # Entrevista Humana). True=Apto, False=No apto, None=sin evaluación todavía. El filtro "Aptos" usa
    # este campo en vez de `estado` para respetar la regla "el más reciente gana".
    resultado_apto: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Modo Prueba (solo admin, ver ConfiguracionSistema): nunca aparece en listados/reportes de RH.
    es_prueba: Mapped[bool] = mapped_column(Boolean, default=False)
    # Cuenta (Fase A multi-cuenta) — directo, no vía join a Vacante: vacante_id es nullable y no
    # todo candidato tiene una vacante asignada.
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)

    vacante_id: Mapped[Optional[int]] = mapped_column(ForeignKey("vacantes.id"), nullable=True)
    vacante: Mapped[Optional[Vacante]] = relationship(back_populates="candidatos")
    mensajes: Mapped[List["Mensaje"]] = relationship(back_populates="candidato", order_by="Mensaje.id")
    expediente: Mapped[Optional["Expediente"]] = relationship(back_populates="candidato", uselist=False)
    entrevistas: Mapped[List["Entrevista"]] = relationship(back_populates="candidato", order_by="Entrevista.id")
    entrevistas_humanas: Mapped[List["EntrevistaHumana"]] = relationship(
        back_populates="candidato", order_by="EntrevistaHumana.id", cascade="all, delete-orphan"
    )
    archivos: Mapped[List["Archivo"]] = relationship(
        back_populates="candidato", order_by="Archivo.id", cascade="all, delete-orphan"
    )


class EntrevistaHumana(Base):
    """Una ronda de entrevista humana (flujo manual de RH, ver ETAPAS_CANDIDATO). Un candidato
    puede tener varias a lo largo del proceso — cada "Agendar otra Entrevista Humana" crea una
    fila nueva en vez de sobreescribir la anterior, para no perder el resultado de rondas
    previas."""

    __tablename__ = "entrevistas_humanas"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidato_id: Mapped[int] = mapped_column(ForeignKey("candidatos.id"), index=True)
    entrevistador: Mapped[str] = mapped_column(String(150), default="")  # nombre a mostrar (usuario.nombre si es interno, tecleado si es externo)
    tipo: Mapped[str] = mapped_column(String(20), default="")  # interno | externo
    usuario_id: Mapped[Optional[int]] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    correo_externo: Mapped[str] = mapped_column(String(200), default="")
    fecha: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    modalidad: Mapped[str] = mapped_column(String(20), default="")  # Presencial|Videollamada|Llamada
    liga: Mapped[str] = mapped_column(String(300), default="")  # obligatoria si modalidad=Videollamada
    ubicacion: Mapped[str] = mapped_column(String(300), default="")  # obligatoria si modalidad=Presencial
    telefono_contacto: Mapped[str] = mapped_column(String(30), default="")  # opcional si modalidad=Llamada
    comentario: Mapped[str] = mapped_column(Text, default="")
    realizada: Mapped[bool] = mapped_column(Boolean, default=False)
    resultado: Mapped[str] = mapped_column(String(20), default="")  # aprobado | no_aprobado
    recomendacion: Mapped[str] = mapped_column(String(30), default="")  # avanzar | no_avanzar | segunda_entrevista
    # --- evaluación del entrevistador por liga (Lote 3) ---
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # liga pública para que el entrevistador registre su evaluación
    # "" hasta que alguien capture el resultado; "rh" | "entrevistador" según quién ganó la
    # carrera (ver candidatos.py: RH siempre puede sobreescribir después, para corregir).
    resultado_capturado_por: Mapped[str] = mapped_column(String(20), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    candidato: Mapped["Candidato"] = relationship(back_populates="entrevistas_humanas")


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
    # Videollamada de Google Meet generada a mano por RH (botones del panel) — independiente
    # de `token`/avatar Anam de arriba. Usa el mismo generador mock que la herramienta
    # agendar_videollamada del agente (ver services/ia.agendar_videollamada_mock).
    liga_meet: Mapped[str] = mapped_column(String(300), default="")
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

    # Cuenta/Cliente (Fase A multi-cuenta) — la Vacante que nace de esta Requisición hereda
    # estos valores automáticamente (regla de Fase E).
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)
    cliente_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clientes.id"), nullable=True, index=True)

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
    # Cuenta/Cliente (Fase A multi-cuenta) — el Radar Interno compara Requisición contra
    # Empleados del mismo Cliente.
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)
    cliente_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clientes.id"), nullable=True, index=True)

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


# Checklist exacto pedido por el cliente para el expediente de contratación.
DOCUMENTOS_BASE = [
    "Identificación oficial",
    "CURP",
    "Constancia de Situación Fiscal / RFC",
    "Número de Seguridad Social",
    "Comprobante de domicilio",
    "Cuenta bancaria / CLABE",
]


class Expediente(Base):
    __tablename__ = "expedientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidato_id: Mapped[int] = mapped_column(ForeignKey("candidatos.id"), unique=True)
    puesto: Mapped[str] = mapped_column(String(200), default="")
    # --- condiciones finales de contratación (formulario de la etapa Contratación) ---
    sueldo: Mapped[str] = mapped_column(String(80), default="")
    tipo_contratacion: Mapped[str] = mapped_column(String(60), default="")
    ubicacion: Mapped[str] = mapped_column(String(150), default="")
    jefe_directo: Mapped[str] = mapped_column(String(150), default="")
    fecha_ingreso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # --- preparación de ingreso (Onboarding, bloque 4) ---
    contrato: Mapped[str] = mapped_column(String(20), default="Pendiente")  # Pendiente | Firmado
    alta_administrativa: Mapped[str] = mapped_column(String(20), default="Pendiente")  # Pendiente | Realizada
    equipo_accesos: Mapped[str] = mapped_column(String(20), default="Pendiente")  # Pendiente | Listo | No aplica
    estado: Mapped[str] = mapped_column(String(20), default="integracion")  # integracion | completo | alta
    alta_autorizada_por: Mapped[str] = mapped_column(String(150), default="")
    alta_fecha: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seleccionado_por: Mapped[str] = mapped_column(String(150), default="")
    # Liga pública para que el candidato suba sus documentos sin sesión (Lote 4). Nullable:
    # los expedientes creados antes de este lote no tienen uno hasta que se genera perezosamente
    # (ver candidatos._disparar_mensaje_onboarding) — no es de un solo uso como el de
    # EntrevistaHumana, sigue válido hasta que el expediente llega a estado "alta".
    token: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
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


class Colaborador(Base):
    """Colaborador activo — se crea al presionar «Dar de alta como colaborador» al cierre del
    Onboarding (ver contratacion.alta). Hereda del candidato y del expediente lo definitivo:
    nombre, puesto, CV, sueldo, ubicación, jefe directo y empresa.
    """

    __tablename__ = "colaboradores"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(200))
    correo: Mapped[str] = mapped_column(String(200), default="")
    telefono: Mapped[str] = mapped_column(String(30), default="")
    puesto: Mapped[str] = mapped_column(String(200), default="")
    salario: Mapped[str] = mapped_column(String(80), default="")
    empresa: Mapped[str] = mapped_column(String(150), default="")
    ubicacion: Mapped[str] = mapped_column(String(150), default="")
    jefe_directo: Mapped[str] = mapped_column(String(150), default="")
    cv_ruta: Mapped[str] = mapped_column(String(400), default="")
    cv_nombre: Mapped[str] = mapped_column(String(255), default="")
    fecha_ingreso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    dado_de_alta_por: Mapped[str] = mapped_column(String(150), default="")
    candidato_origen_id: Mapped[Optional[int]] = mapped_column(ForeignKey("candidatos.id"), nullable=True)
    expediente_id: Mapped[Optional[int]] = mapped_column(ForeignKey("expedientes.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    # Cuenta/Cliente (Fase A multi-cuenta) — hereda de la Vacante/Candidato de origen al dar de alta.
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)
    cliente_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clientes.id"), nullable=True, index=True)

    candidato_origen: Mapped[Optional["Candidato"]] = relationship()


# ============================================================
# Cuentas y Clientes (Fase A · reestructuración multi-cuenta)
# ============================================================
#
# Cuenta = empresa reclutadora que opera la plataforma (puede tener cero o varios
# Clientes: empresas para las que recluta). Un Usuario puede tener acceso a varias
# Cuentas (ver UsuarioCuenta) — si solo tiene una, el frontend no muestra ningún selector.


class Cuenta(Base):
    __tablename__ = "cuentas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre_comercial: Mapped[str] = mapped_column(String(200))
    razon_social: Mapped[str] = mapped_column(String(200), default="")
    logo: Mapped[str] = mapped_column(String(400), default="")  # ruta en disco
    contacto_nombre: Mapped[str] = mapped_column(String(150), default="")
    correo_comunicacion: Mapped[str] = mapped_column(String(200), default="")
    whatsapp_comunicacion: Mapped[str] = mapped_column(String(30), default="")
    estado: Mapped[str] = mapped_column(String(20), default="Activa")  # Activa | Inactiva
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    actualizada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora, onupdate=ahora)

    clientes: Mapped[List["Cliente"]] = relationship(back_populates="cuenta")
    usuarios: Mapped[List["UsuarioCuenta"]] = relationship(back_populates="cuenta")


class Cliente(Base):
    """Empresa para la que recluta una Cuenta."""

    __tablename__ = "clientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    cuenta_id: Mapped[int] = mapped_column(ForeignKey("cuentas.id"), index=True)
    nombre: Mapped[str] = mapped_column(String(200))
    estado: Mapped[str] = mapped_column(String(20), default="Activo")  # Activo | Inactivo
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    cuenta: Mapped["Cuenta"] = relationship(back_populates="clientes")
    contactos: Mapped[List["ClienteContacto"]] = relationship(
        back_populates="cliente", cascade="all, delete-orphan"
    )


class ClienteContacto(Base):
    """Persona de contacto en el Cliente — NO es un usuario del sistema."""

    __tablename__ = "cliente_contactos"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("clientes.id"), index=True)
    nombre: Mapped[str] = mapped_column(String(150))
    puesto: Mapped[str] = mapped_column(String(120), default="")
    correo: Mapped[str] = mapped_column(String(200), default="")
    telefono: Mapped[str] = mapped_column(String(30), default="")

    cliente: Mapped["Cliente"] = relationship(back_populates="contactos")


class Plantilla(Base):
    """Plantilla reutilizable de vacante (Fase B, punto 11) — General de la Cuenta
    (cliente_id=None) o de un Cliente específico. No hay nivel intermedio."""

    __tablename__ = "plantillas"

    id: Mapped[int] = mapped_column(primary_key=True)
    cuenta_id: Mapped[int] = mapped_column(ForeignKey("cuentas.id"), index=True)
    cliente_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clientes.id"), nullable=True, index=True)
    nombre: Mapped[str] = mapped_column(String(150))  # para identificarla en el selector
    # "eliminar" = desactivar, nunca borrado físico — una Vacante ya creada desde ella conserva
    # plantilla_id para trazabilidad aunque la plantilla ya no se ofrezca para nuevas vacantes.
    activa: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- contenido reutilizable: mismos campos/tipos que Vacante ---
    titulo: Mapped[str] = mapped_column(String(200), default="")
    area: Mapped[str] = mapped_column(String(100), default="")
    modalidad: Mapped[str] = mapped_column(String(30), default="Presencial")
    sueldo: Mapped[str] = mapped_column(String(80), default="A convenir")
    requisitos: Mapped[str] = mapped_column(Text, default="")
    descripcion: Mapped[str] = mapped_column(Text, default="")
    resumen: Mapped[str] = mapped_column(Text, default="")
    perfil_ideal: Mapped[str] = mapped_column(Text, default="")
    responsabilidades: Mapped[list] = mapped_column(JSON, default=list)
    requisitos_deseables: Mapped[list] = mapped_column(JSON, default=list)
    beneficios: Mapped[list] = mapped_column(JSON, default=list)
    palabras_clave: Mapped[list] = mapped_column(JSON, default=list)
    seniority: Mapped[str] = mapped_column(String(40), default="")
    avisos_cumplimiento: Mapped[list] = mapped_column(JSON, default=list)
    preguntas_filtro: Mapped[list] = mapped_column(JSON, default=list)  # = "evaluaciones" (ver spec Fase B)
    texto_whatsapp: Mapped[str] = mapped_column(Text, default="")
    texto_bolsa: Mapped[str] = mapped_column(Text, default="")

    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)

    cuenta: Mapped["Cuenta"] = relationship()
    cliente: Mapped[Optional["Cliente"]] = relationship()


class UsuarioCuenta(Base):
    """Puente muchos-a-muchos: qué Cuenta(s) puede ver cada Usuario."""

    __tablename__ = "usuario_cuentas"
    __table_args__ = (UniqueConstraint("usuario_id", "cuenta_id", name="uq_usuario_cuenta"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), index=True)
    cuenta_id: Mapped[int] = mapped_column(ForeignKey("cuentas.id"), index=True)

    usuario: Mapped["Usuario"] = relationship(back_populates="cuentas")
    cuenta: Mapped["Cuenta"] = relationship(back_populates="usuarios")


ROLES = ("Administrador", "Usuario")


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
    rol: Mapped[str] = mapped_column(String(20), default="Usuario")  # Administrador | Usuario
    hash_pass: Mapped[str] = mapped_column(String(255))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    debe_cambiar_pass: Mapped[bool] = mapped_column(Boolean, default=False)
    intentos_fallidos: Mapped[int] = mapped_column(Integer, default=0)
    bloqueado_hasta: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ultimo_acceso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    # Visibilidad automática (Fase A): si puede alternar Mío/Mi equipo, y a quién reporta.
    ve_equipo: Mapped[bool] = mapped_column(Boolean, default=False)
    reporta_a_id: Mapped[Optional[int]] = mapped_column(ForeignKey("usuarios.id"), nullable=True)

    sesiones: Mapped[List["Sesion"]] = relationship(back_populates="usuario", cascade="all, delete-orphan")
    cuentas: Mapped[List["UsuarioCuenta"]] = relationship(back_populates="usuario", cascade="all, delete-orphan")
    reporta_a: Mapped[Optional["Usuario"]] = relationship(remote_side=[id])

    @property
    def bloqueado(self) -> bool:
        if not self.bloqueado_hasta:
            return False
        limite = self.bloqueado_hasta
        if limite.tzinfo is None:
            limite = limite.replace(tzinfo=timezone.utc)
        return limite > ahora()

    def puede_decidir(self) -> bool:
        """Ya no hay perfil de solo lectura (Fase A): Administrador y Usuario deciden por
        igual, la diferencia entre ellos es de alcance de visibilidad. Se deja el método
        para no tocar los call-sites existentes de `usuario_decisor`."""
        return True


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
    # Cuenta (Fase A multi-cuenta) — informativa, fuera del payload que se hashea en registrar():
    # agregarla no rompe la cadena. Nullable: eventos de sistema (login fallido antes de resolver
    # usuario, semilla) pueden no tener una Cuenta a la que atribuirse.
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)


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


class ConfiguracionSistema(Base):
    """Configuración global editable solo por admins. Fila única (id=1) — ver services/configuracion.py."""

    __tablename__ = "configuracion_sistema"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Modo Prueba: mientras esté activo, webhooks._buscar_o_crear_candidato deja de deduplicar
    # conversaciones frías (Candidato.es_prueba=True); nunca aparecen en listados/reportes de RH.
    modo_prueba: Mapped[bool] = mapped_column(Boolean, default=False)


# ============================================================
# Capacitación (Fase 1) — modelo, generación con IA, asignación.
# El avatar (Fase 2) queda pendiente: AsignacionCurso.token ya se genera con el mismo patrón
# que Entrevista.token, pero todavía no hay ninguna ruta pública que lo sirva.
# ============================================================


class Curso(Base):
    __tablename__ = "cursos"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    titulo: Mapped[str] = mapped_column(String(200))
    categoria: Mapped[str] = mapped_column(String(100), default="")
    duracion_horas: Mapped[float] = mapped_column(Float, default=0)
    objetivo: Mapped[str] = mapped_column(Text, default="")  # generado por IA
    estado: Mapped[str] = mapped_column(String(20), default="Borrador")  # Borrador | Publicado
    obligatorio: Mapped[bool] = mapped_column(Boolean, default=False)
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    # Cuenta (Fase A multi-cuenta) — a diferencia del resto, Curso no cuelga de ningún
    # Candidato/Vacante, así que necesita su propia columna en vez de resolverse por join.
    cuenta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cuentas.id"), nullable=True, index=True)

    modulos: Mapped[List["ModuloCurso"]] = relationship(
        back_populates="curso", order_by="ModuloCurso.orden", cascade="all, delete-orphan"
    )
    asignaciones: Mapped[List["AsignacionCurso"]] = relationship(back_populates="curso", cascade="all, delete-orphan")


class ModuloCurso(Base):
    __tablename__ = "modulos_curso"

    id: Mapped[int] = mapped_column(primary_key=True)
    curso_id: Mapped[int] = mapped_column(ForeignKey("cursos.id"), index=True)
    orden: Mapped[int] = mapped_column(Integer)
    titulo: Mapped[str] = mapped_column(String(200))
    contenido: Mapped[str] = mapped_column(Text, default="")  # guion que explicará el avatar (Fase 2)
    # [{"pregunta": str, "criterio_respuesta_correcta": str}] — con qué evaluar la comprensión (Fase 2)
    preguntas_verificacion: Mapped[list] = mapped_column(JSON, default=list)

    curso: Mapped["Curso"] = relationship(back_populates="modulos")


class AsignacionCurso(Base):
    __tablename__ = "asignaciones_curso"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    curso_id: Mapped[int] = mapped_column(ForeignKey("cursos.id"), index=True)
    colaborador_id: Mapped[int] = mapped_column(ForeignKey("colaboradores.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # liga pública (Fase 2, sin servir aún)
    estado: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente | en_curso | completado
    modulo_actual: Mapped[int] = mapped_column(Integer, default=0)
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    resultado_evaluacion: Mapped[dict] = mapped_column(JSON, default=dict)
    asignado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=ahora)
    completado_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    curso: Mapped["Curso"] = relationship(back_populates="asignaciones")
    colaborador: Mapped["Colaborador"] = relationship()