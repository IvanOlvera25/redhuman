"""
Base de conocimiento con RAG (2026-09-18) — Retrieval-Augmented Generation sobre los documentos de
la Cuenta (políticas, procesos, manuales, reglamentos).

Flujo:
1. `indexar_documento`: texto (PDF/TXT/MD/CSV o texto pegado) → fragmentos de ~900 caracteres con
   solape → embedding por fragmento (OpenAI `text-embedding-3-small`) guardado en la base
   (`FragmentoConocimiento.embedding`, JSON). Sin OPENAI_API_KEY se guardan sin embedding y la
   búsqueda cae al modo léxico.
2. `buscar`: embedding de la pregunta → similitud coseno contra los fragmentos de la Cuenta (en
   memoria: para cientos/miles de fragmentos es instantáneo) + un empate léxico (palabras clave) para
   no depender solo del vector. Sin embeddings → puntaje léxico puro.
3. `responder`: el modelo redacta una respuesta ESTRUCTURADA (respuesta, pasos, fuentes citadas,
   confianza) usando SOLO los fragmentos recuperados; sin evidencia suficiente lo dice y sugiere a quién
   acudir — nunca inventa políticas. Cada fuente lleva documento + fragmento para que RH lo verifique.

Reglas: nada de if/else con respuestas quemadas; toda respuesta sale de documentos reales de la Cuenta.
"""

from __future__ import annotations

import io
import math
import re
import unicodedata
from typing import List, Optional, Tuple

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..models import DocumentoConocimiento, FragmentoConocimiento
from . import ia

MODELO_EMBEDDING = "text-embedding-3-small"
TAM_FRAGMENTO = 900
SOLAPE = 150
MAX_TEXTO = 400_000
TOP_K = 6


# ------------------------------------------------------------
# Texto y fragmentación
# ------------------------------------------------------------


def extraer_texto(nombre: str, contenido: bytes) -> str:
    """Texto plano de un archivo subido: PDF (pypdf), TXT/MD/CSV. Otros formatos → ''."""
    n = (nombre or "").lower()
    if n.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(contenido))
        return "\n".join((pg.extract_text() or "") for pg in reader.pages)[:MAX_TEXTO]
    if n.endswith((".txt", ".md", ".csv", ".markdown")):
        return contenido.decode("utf-8", errors="ignore")[:MAX_TEXTO]
    return ""


def fragmentar(texto: str, tam: int = TAM_FRAGMENTO, solape: int = SOLAPE) -> List[str]:
    """Fragmentos por párrafos, agrupados hasta ~`tam` caracteres, con solape para no cortar ideas."""
    limpio = re.sub(r"[ \t]+", " ", (texto or "").replace("\r", ""))
    parrafos = [p.strip() for p in re.split(r"\n\s*\n|\n(?=\s*(?:[A-ZÁÉÍÓÚ0-9][\.\)]|[-•*]))", limpio) if p.strip()]
    if not parrafos:
        parrafos = [limpio.strip()] if limpio.strip() else []
    fragmentos: List[str] = []
    actual = ""
    for p in parrafos:
        if len(p) > tam:  # párrafo enorme: se corta por tamaño con solape
            if actual:
                fragmentos.append(actual.strip())
                actual = ""
            i = 0
            while i < len(p):
                fragmentos.append(p[i : i + tam].strip())
                i += tam - solape
            continue
        if len(actual) + len(p) + 1 > tam and actual:
            fragmentos.append(actual.strip())
            actual = actual[-solape:] + "\n" + p if solape else p
        else:
            actual = (actual + "\n" + p) if actual else p
    if actual.strip():
        fragmentos.append(actual.strip())
    return [f for f in fragmentos if len(f) > 20]


# ------------------------------------------------------------
# Embeddings y similitud
# ------------------------------------------------------------


def embeber(textos: List[str]) -> Optional[List[List[float]]]:
    """Embeddings de OpenAI; None sin clave (modo léxico)."""
    client = ia._client()
    if client is None or not textos:
        return None
    vectores: List[List[float]] = []
    for i in range(0, len(textos), 64):
        lote = [t[:8000] for t in textos[i : i + 64]]
        resp = client.embeddings.create(model=MODELO_EMBEDDING, input=lote)
        vectores.extend([d.embedding for d in resp.data])
    return vectores


def _coseno(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    num = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return num / (na * nb) if na and nb else 0.0


_PARADAS = {
    "de", "la", "el", "los", "las", "un", "una", "y", "o", "que", "en", "a", "por", "para", "con", "se", "del", "al", "es", "como",
    "cual", "cuales", "que", "cuando", "donde", "hay", "mi", "mis", "su", "sus", "me", "te", "le", "lo", "si", "no", "puedo", "tengo",
    "hacer", "sobre", "son", "ser", "esta", "este", "esto", "tiene", "tienen", "the", "and",
}


def _tokens(texto: str) -> List[str]:
    base = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return [t for t in re.findall(r"[a-z0-9]{3,}", base) if t not in _PARADAS]


def _puntaje_lexico(consulta: str, fragmento: str) -> float:
    """Empate léxico simple (recuento de términos con peso por rareza local)."""
    q = set(_tokens(consulta))
    if not q:
        return 0.0
    toks = _tokens(fragmento)
    if not toks:
        return 0.0
    conteo: dict = {}
    for t in toks:
        conteo[t] = conteo.get(t, 0) + 1
    hits = sum(1 for t in q if t in conteo)
    if not hits:
        return 0.0
    return hits / len(q) + 0.05 * sum(math.log1p(conteo[t]) for t in q if t in conteo)


# ------------------------------------------------------------
# Indexado y búsqueda
# ------------------------------------------------------------


def indexar_documento(db: Session, doc: DocumentoConocimiento) -> int:
    """(Re)genera los fragmentos + embeddings de un documento. Regresa cuántos fragmentos quedaron."""
    for f in list(doc.fragmentos):
        db.delete(f)
    db.flush()
    fragmentos = fragmentar(doc.texto or "")
    vectores = None
    try:
        vectores = embeber(fragmentos)
    except Exception as ex:  # sin embeddings sigue funcionando en modo léxico
        print(f"[rag] embeddings no disponibles ({ex}); se indexa en modo léxico", flush=True)
    for i, texto in enumerate(fragmentos):
        db.add(FragmentoConocimiento(
            documento_id=doc.id, cuenta_id=doc.cuenta_id, orden=i, texto=texto,
            embedding=(vectores[i] if vectores else None),
        ))
    doc.fragmentos_total = len(fragmentos)
    doc.con_embeddings = bool(vectores)
    db.flush()
    return len(fragmentos)


class FragmentoEncontrado(BaseModel):
    fragmento_id: int
    documento_id: int
    documento: str
    tipo: str
    orden: int
    texto: str
    puntaje: float


def buscar(db: Session, cuenta_id: int, consulta: str, k: int = TOP_K) -> Tuple[List[FragmentoEncontrado], str]:
    """Top-k fragmentos de la Cuenta para la consulta. Regresa (fragmentos, modo) con modo
    'semantico' (vector + léxico) o 'lexico'."""
    filas = (
        db.query(FragmentoConocimiento, DocumentoConocimiento)
        .join(DocumentoConocimiento, DocumentoConocimiento.id == FragmentoConocimiento.documento_id)
        .filter(FragmentoConocimiento.cuenta_id == cuenta_id, DocumentoConocimiento.activo.is_(True))
        .all()
    )
    if not filas:
        return [], "sin_documentos"
    vector_q = None
    if any(f.embedding for f, _ in filas):
        try:
            vq = embeber([consulta])
            vector_q = vq[0] if vq else None
        except Exception as ex:
            print(f"[rag] embedding de la consulta falló ({ex}); búsqueda léxica", flush=True)
    resultados = []
    for f, d in filas:
        lex = _puntaje_lexico(consulta, f.texto)
        if vector_q is not None and f.embedding:
            sem = _coseno(vector_q, f.embedding)
            puntaje = 0.75 * sem + 0.25 * min(lex, 1.0)
        else:
            sem = 0.0
            puntaje = lex
        if puntaje <= 0:
            continue
        resultados.append(FragmentoEncontrado(
            fragmento_id=f.id, documento_id=d.id, documento=d.titulo, tipo=d.tipo, orden=f.orden, texto=f.texto, puntaje=round(puntaje, 4),
        ))
    resultados.sort(key=lambda r: r.puntaje, reverse=True)
    modo = "semantico" if vector_q is not None else "lexico"
    return resultados[:k], modo


# ------------------------------------------------------------
# Respuesta estructurada
# ------------------------------------------------------------


class FuenteCitada(BaseModel):
    documento: str = Field(description="Título del documento de donde sale la evidencia.")
    cita: str = Field(description="Frase o fragmento textual (máx. 240 caracteres) que sustenta la respuesta.")


class RespuestaConocimiento(BaseModel):
    respuesta: str = Field(description="Respuesta directa y precisa en español mexicano, 2-6 frases.")
    pasos: List[str] = Field(default_factory=list, description="Pasos concretos si la pregunta es sobre un proceso; vacío si no aplica.")
    fuentes: List[FuenteCitada] = Field(default_factory=list)
    confianza: str = Field(description="alta | media | baja según qué tan completa es la evidencia.")
    sin_evidencia: bool = Field(description="true si los documentos NO responden la pregunta; entonces la respuesta lo dice y sugiere a quién acudir.")


def _respuesta_demo(pregunta: str, fragmentos: List[FragmentoEncontrado]) -> RespuestaConocimiento:
    """Sin OPENAI_API_KEY: respuesta extractiva (los mejores fragmentos, sin redacción)."""
    if not fragmentos:
        return RespuestaConocimiento(
            respuesta="No encontré esa información en los documentos de la empresa. Consulta con Recursos Humanos o carga la política correspondiente a la base de conocimiento.",
            pasos=[], fuentes=[], confianza="baja", sin_evidencia=True,
        )
    mejor = fragmentos[0]
    return RespuestaConocimiento(
        respuesta=mejor.texto[:600],
        pasos=[],
        fuentes=[FuenteCitada(documento=f.documento, cita=f.texto[:240]) for f in fragmentos[:3]],
        confianza="media" if mejor.puntaje >= 0.5 else "baja",
        sin_evidencia=False,
    )


def responder(db: Session, cuenta_id: int, pregunta: str, historial: Optional[List[dict]] = None, empresa: str = "") -> Tuple[RespuestaConocimiento, List[FragmentoEncontrado], str, bool]:
    """(respuesta estructurada, fragmentos usados, modo de búsqueda, con_ia)."""
    fragmentos, modo = buscar(db, cuenta_id, pregunta)
    client = ia._client()
    if client is None:
        return _respuesta_demo(pregunta, fragmentos), fragmentos, modo, False
    if not fragmentos:
        return _respuesta_demo(pregunta, fragmentos), fragmentos, modo, True
    contexto = "\n\n".join(f"[{i + 1}] Documento: «{f.documento}» ({f.tipo}), fragmento {f.orden + 1}\n{f.texto}" for i, f in enumerate(fragmentos))
    instrucciones = (
        f"Eres el asistente de la base de conocimiento de Recursos Humanos de {empresa or 'la empresa'} (México). "
        "Respondes preguntas de colaboradores y de RH sobre políticas, procesos y reglamentos internos ÚNICAMENTE con la "
        "evidencia de los fragmentos proporcionados. Reglas: (1) si la evidencia no responde la pregunta, sin_evidencia=true "
        "y di claramente que no está documentado y con quién confirmarlo; nunca inventes montos, plazos ni condiciones; "
        "(2) cita cada fuente que uses (documento + frase textual); (3) si la pregunta es sobre un trámite, desglosa los pasos "
        "en orden; (4) español mexicano, tono claro y profesional, sin relleno; (5) no incluyas datos personales de nadie."
    )
    mensajes = [{"role": ("user" if m.get("rol") == "user" else "assistant"), "content": str(m.get("texto", ""))[:2000]} for m in (historial or [])[-6:]]
    mensajes.append({"role": "user", "content": f"EVIDENCIA:\n{contexto}\n\nPREGUNTA: {pregunta}"})
    resp = client.responses.parse(model=ia.MODEL, instructions=instrucciones, input=mensajes, text_format=RespuestaConocimiento)
    return resp.output_parsed, fragmentos, modo, True
