import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import usuario_actual
from ..models import Bitacora, Candidato, Mensaje, Usuario, Vacante, registrar
from ..services.configuracion import modo_prueba_activo
from ..services.whatsapp import enviar_mensaje, enviar_lista_interactiva, parsear_webhook

# Modo Prueba: una conversación con actividad más vieja que esta ventana ya no se
# reutiliza — se trata como una postulación nueva e independiente (ver _buscar_o_crear_candidato).
VENTANA_MODO_PRUEBA = timedelta(minutes=60)

router = APIRouter(tags=["webhooks"])

# Regex para detectar códigos de vacante en el texto del candidato
_RE_VAC = re.compile(r"VAC[-_]?([A-Za-z0-9]+)", re.IGNORECASE)

# Palabras que interpretamos como consentimiento LFPDPPP
_ACEPTA = {"sí", "si", "acepto", "aceptar", "ok", "va", "dale", "claro", "por supuesto", "de acuerdo"}


# ============================================================
# Helpers internos
# ============================================================

def _normalizar_str(s: str) -> str:
    """Quita acentos y pasa a minúsculas para comparaciones flexibles."""
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


def _normalizar_telefono(wa_id: str) -> str:
    """521XXXXXXXXXX → 10 dígitos mexicanos para dedup con Candidato.telefono."""
    digitos = re.sub(r"\D", "", wa_id)
    if digitos.startswith("521") and len(digitos) == 13:
        return digitos[3:]  # quitar 521
    if digitos.startswith("52") and len(digitos) == 12:
        return digitos[2:]  # quitar 52
    return digitos[-10:] if len(digitos) > 10 else digitos


def _detectar_vacante(texto: str, db: Session, id_seleccionado: Optional[str] = None) -> Optional[Vacante]:
    """Busca la vacante por ID interactivo, código VAC-XXXX, número de lista, título o slug."""
    candidatos_cod = [s for s in [id_seleccionado, texto] if s]

    # 1. Búsqueda por código exacto o regex VAC-XXXX
    for s in candidatos_cod:
        s_clean = s.strip()
        # Coincidencia directa por código
        v = db.query(Vacante).filter(func.lower(Vacante.codigo) == s_clean.lower()).first()
        if v:
            return v
        # Regex VAC-####
        m = _RE_VAC.search(s_clean)
        if m:
            cod = f"VAC-{m.group(1)}"
            v = db.query(Vacante).filter(func.lower(Vacante.codigo) == cod.lower()).first()
            if v:
                return v

    vacantes_activas = db.query(Vacante).filter(Vacante.estado == "Publicada").order_by(Vacante.id.desc()).limit(10).all()

    # 2. Búsqueda por número si el usuario respondió "1", "2", etc.
    t_clean = (texto or "").strip()
    if t_clean.isdigit():
        num = int(t_clean)
        if 1 <= num <= len(vacantes_activas):
            return vacantes_activas[num - 1]

    # 3. Búsqueda por título o slug (flexible / sin acentos)
    t_norm = _normalizar_str(texto)
    id_norm = _normalizar_str(id_seleccionado or "")
    if t_norm or id_norm:
        for v in vacantes_activas:
            v_tit = _normalizar_str(v.titulo)
            v_slug = _normalizar_str(v.slug)
            if t_norm and (v_tit in t_norm or t_norm in v_tit or v_slug == t_norm):
                return v
            if id_norm and (v_tit in id_norm or id_norm in v_tit or v_slug == id_norm):
                return v

    return None


def _buscar_o_crear_candidato(
    db: Session, wa_id: str, nombre: str, vacante: Optional[Vacante], prueba: bool = False
) -> Candidato:
    """Dedup por wa_id (exacto) o por teléfono normalizado; crea si no existe.

    Con Modo Prueba activo (`prueba=True`), una conversación ya fría (sin actividad en
    VENTANA_MODO_PRUEBA) deja de reutilizarse: se trata como una postulación nueva e
    independiente, marcada `es_prueba=True`. Una conversación en curso (mensajes recientes)
    se sigue reutilizando igual que siempre, para no romper un flujo de prueba de varios
    turnos. Con Modo Prueba apagado el comportamiento es exactamente el de siempre.
    """
    # 1. Buscar por wa_id (el más confiable). order_by id desc: con Modo Prueba puede haber
    # más de un candidato con el mismo wa_id — nos quedamos con el más reciente.
    existente = db.query(Candidato).filter(Candidato.wa_id == wa_id).order_by(Candidato.id.desc()).first()

    # 2. Buscar por teléfono normalizado
    tel = _normalizar_telefono(wa_id)
    if not existente and tel:
        existente = db.query(Candidato).filter(Candidato.telefono == tel).order_by(Candidato.id.desc()).first()

    if existente:
        ultima_actividad = existente.mensajes[-1].creado_en if existente.mensajes else existente.creado_en
        # SQLite descarta el offset de un DateTime(timezone=True) y regresa un datetime naive
        # con los mismos números de reloj UTC (mismo caso que _parsear_fecha_cita) — hay que
        # reponerle el tzinfo antes de restar contra un aware, si no truena.
        if ultima_actividad.tzinfo is None:
            ultima_actividad = ultima_actividad.replace(tzinfo=timezone.utc)
        reciente = datetime.now(timezone.utc) - ultima_actividad < VENTANA_MODO_PRUEBA
        if not prueba or reciente:
            # Llenar wa_id si faltaba
            if not existente.wa_id:
                existente.wa_id = wa_id
            if nombre and not existente.wa_nombre:
                existente.wa_nombre = nombre
            return existente
        # Modo Prueba activo y la conversación anterior ya está fría: no se reutiliza,
        # sigue abajo para crear una postulación nueva e independiente.

    # 3. Crear candidato nuevo
    c = Candidato(
        codigo="TMP",
        nombre=nombre or "Candidato WhatsApp",
        telefono=tel,
        fuente="WhatsApp",
        wa_id=wa_id,
        wa_nombre=nombre,
        vacante_id=vacante.id if vacante else None,
        es_prueba=prueba,
    )
    db.add(c)
    db.flush()
    c.codigo = f"C-{8800 + c.id}"
    registrar(
        db, "sistema", "candidato_ingresado", "candidato", c.codigo,
        {"fuente": "WhatsApp", "wa_id": wa_id, "es_prueba": prueba},
    )
    return c


def _texto_aviso_privacidad(nombre: str, vacante: Optional[Vacante]) -> str:
    """Mensaje de bienvenida + aviso de privacidad LFPDPPP."""
    saludo = f"¡Hola{' ' + nombre if nombre else ''}! 👋"
    puesto = f" para *{vacante.titulo}*" if vacante else ""
    return (
        f"{saludo} Gracias por tu interés{puesto}. Soy Red Human.\n\n"
        "Antes de comenzar, necesito tu autorización: tus datos personales serán tratados conforme "
        "a nuestro Aviso de Privacidad, exclusivamente para este proceso de selección. "
        "Puedes consultar el aviso completo en redhuman.mx/privacidad.\n\n"
        "¿Autorizas el uso de tus datos para continuar? (Responde *Sí* o *Acepto*)"
    )


# ============================================================
# Webhook GET — Handshake de verificación de Meta
# ============================================================

@router.get("/webhooks/whatsapp")
def verificar_webhook(
    mode: Optional[str] = Query(None, alias="hub.mode"),
    verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
    """Handshake de verificación requerido por Meta al registrar el Webhook."""
    print(f"\n[webhook-get] Verificación recibida: mode={mode}, token={verify_token}, challenge={challenge}")
    if mode == "subscribe" and verify_token == settings.meta_verify_token:
        print(f"[webhook-get] ✅ Handshake de Meta exitoso. Challenge: {challenge}")
        return PlainTextResponse(content=challenge or "", status_code=200)

    print(f"[webhook-get] ❌ Fallo de verificación: token esperado={settings.meta_verify_token}, recibido={verify_token}")
    raise HTTPException(status_code=403, detail="Token de verificación inválido o modo incorrecto.")


# ============================================================
# Webhook POST — Agente de IA para pre-filtro de candidatos
# ============================================================

@router.post("/webhooks/whatsapp")
async def whatsapp_entrante(request: Request, db: Session = Depends(get_db)):
    """Agente de reclutamiento IA — recibe webhook de Meta / WAHA / Evolution."""
    try:
        payload = await request.json()
    except Exception as e:
        print(f"[webhook-post-error] No se pudo parsear JSON: {e}")
        return {"ok": False, "error": "JSON no válido"}

    print("\n" + "=" * 60)
    print(f"[webhook-post] Recibido POST en /webhooks/whatsapp")
    print(f"[webhook-post] Payload: {json.dumps(payload, ensure_ascii=False)}")
    print("=" * 60)

    msg = parsear_webhook(payload)
    if not msg:
        print("[webhook-post] Webhook procesado sin mensaje de candidato (estado de entrega o evento ignorado).")
        return {"ok": True, "ignorado": True}

    telefono = msg["telefono"]
    texto = msg["texto"].strip()
    nombre_wa = msg.get("nombre", "")
    id_seleccionado = msg.get("id_seleccionado", "")

    print(f"[agente] Procesando mensaje de {nombre_wa} ({telefono}): '{texto}' (id_sel='{id_seleccionado}')")

    # ── 1. Buscar o crear candidato (todavía sin vacante: hace falta saber su estado
    # actual antes de decidir si corresponde detectar/reasignar vacante) ──────────
    c = _buscar_o_crear_candidato(db, telefono, nombre_wa, None, prueba=modo_prueba_activo(db))
    print(f"[agente] Candidato asociado: {c.codigo} ({c.nombre}), consentimiento={c.consentimiento}, vacante_id={c.vacante_id}")

    # ── 2. Detectar vacante SOLO si el candidato sigue en proceso de selección
    # (sin vacante_id todavía, o con vacante pero sin consentimiento otorgado — sigue
    # respondiendo el menú inicial). Con vacante_id + consentimiento ya confirmados,
    # ninguna respuesta del prefiltro (p.ej. "3" años de experiencia) puede reasignar
    # la vacante del candidato — antes _detectar_vacante corría en cada turno y un
    # número de un dígito se interpretaba como "selección #N de la lista", pisando
    # silenciosamente c.vacante_id con una vacante ajena a su postulación.
    en_seleccion_vacante = not c.vacante_id or not c.consentimiento
    vacante_detectada = _detectar_vacante(texto, db, id_seleccionado) if en_seleccion_vacante else None
    if vacante_detectada:
        print(f"[agente] Vacante detectada: {vacante_detectada.codigo} - {vacante_detectada.titulo}")

    analisis_c = dict(c.analisis or {})

    # ── 2.1 Captura interactiva de nombre si Meta no lo proporcionó ──
    if analisis_c.get("esperando_nombre"):
        nombre_ingresado = texto.strip()
        c.nombre = nombre_ingresado
        c.wa_nombre = nombre_ingresado
        analisis_c.pop("esperando_nombre", None)
        c.analisis = analisis_c
        registrar(db, c.codigo, "nombre_actualizado", "candidato", c.codigo, {"nombre": nombre_ingresado, "fuente": "whatsapp_inbound"})
        db.flush()

        from .candidatos import procesar_prefiltro
        vac = c.vacante
        puesto = f" de *{vac.titulo}*" if vac else ""
        primer_nombre = nombre_ingresado.split()[0]
        saludo = f"¡Mucho gusto, {primer_nombre}! 👋 Vamos a iniciar con unas breves preguntas para tu postulación{puesto}."
        
        envio_saludo = await enviar_mensaje(telefono, saludo)
        db.add(Mensaje(
            candidato_id=c.id, rol="assistant", texto=saludo, canal="whatsapp",
            enviado=envio_saludo.get("enviado", False), wa_id=envio_saludo.get("wa_id", ""),
        ))
        db.flush()

        mensaje_inicio = f"Mi nombre es {c.nombre} y me postulo a la vacante {vac.titulo if vac else ''}."
        resultado = await procesar_prefiltro(db, c, mensaje_inicio, "whatsapp")
        return {"ok": True, "accion": "nombre_capturado_y_prefiltro_iniciado", "candidato": c.codigo, **resultado}

    # Si se detectó una vacante, asignarla al candidato
    seleccion_nueva_vacante = False
    if vacante_detectada and c.vacante_id != vacante_detectada.id:
        c.vacante_id = vacante_detectada.id
        seleccion_nueva_vacante = True
        db.flush()
    elif not vacante_detectada and c.vacante:
        vacante_detectada = c.vacante

    vacante = vacante_detectada

    # ── 3. Si aún no hay vacante asignada → enviar menú de vacantes activas ──
    if not c.vacante_id:
        print(f"[agente] Candidato {c.codigo} no tiene vacante asignada. Buscando vacantes publicadas...")
        vacantes = db.query(Vacante).filter(Vacante.estado == "Publicada").order_by(Vacante.id.desc()).limit(10).all()
        if vacantes:
            print(f"[agente] Enviando lista interactiva con {len(vacantes)} vacantes a {telefono}")
            res_envio = await enviar_lista_interactiva(
                telefono,
                "📋 Vacantes disponibles",
                "Selecciona la vacante que te interesa:",
                "Ver vacantes",
                [{"id": v.codigo, "titulo": v.titulo, "descripcion": f"{v.ubicacion} · {v.sueldo}"[:72]} for v in vacantes],
            )
            print(f"[agente] Resultado envío lista: {res_envio}")
        else:
            print(f"[agente] Sin vacantes publicadas. Enviando mensaje estándar a {telefono}")
            await enviar_mensaje(telefono, "Por el momento no tenemos vacantes abiertas, pero guardo tu contacto. ¡Te avisamos cuando haya una oportunidad! 😊")
        db.commit()
        return {"ok": True, "accion": "menu_vacantes"}

    from .candidatos import procesar_prefiltro

    # ── 4. Si acaba de seleccionar vacante → registrar consentimiento y disparar prefiltro ──
    if seleccion_nueva_vacante or not c.consentimiento:
        c.consentimiento = True
        c.consentimiento_fecha = datetime.now(timezone.utc)
        registrar(
            db, c.codigo, "consentimiento_otorgado", "candidato", c.codigo,
            {"medio": "whatsapp", "vacante": vacante.codigo if vacante else "", "accion": "seleccion_vacante"}
        )

        # Si no tenemos el nombre real del candidato, solicitárselo antes de las preguntas
        nombre_desconocido = not c.nombre or c.nombre.startswith("Candidato") or c.nombre == "TMP"
        if nombre_desconocido and not nombre_wa:
            analisis_c["esperando_nombre"] = True
            c.analisis = analisis_c
            db.commit()

            pregunta_nombre = f"¡Excelente elección! Te postularás para *{vacante.titulo}*.\n\nAntes de comenzar, ¿cuál es tu *nombre completo*?"
            envio_pregunta = await enviar_mensaje(telefono, pregunta_nombre)
            db.add(Mensaje(
                candidato_id=c.id, rol="assistant", texto=pregunta_nombre, canal="whatsapp",
                enviado=envio_pregunta.get("enviado", False), wa_id=envio_pregunta.get("wa_id", ""),
            ))
            db.commit()
            return {"ok": True, "accion": "solicitando_nombre", "candidato": c.codigo}

        db.flush()
        print(f"[agente] ✅ Vacante asignada y consentimiento registrado para {c.codigo} ({vacante.titulo if vacante else ''})")

        # Iniciar inmediatamente el prefiltro con la primera pregunta de la vacante
        mensaje_inicio = f"Me interesa postularme para la vacante de {vacante.titulo if vacante else 'la posición'}."
        resultado = await procesar_prefiltro(db, c, mensaje_inicio, "whatsapp")
        print(f"[agente] Prefiltro iniciado exitosamente para {c.codigo}: {resultado.get('respuesta')}")
        return {"ok": True, "accion": "prefiltro_iniciado", "candidato": c.codigo, **resultado}

    # ── 5. Turno conversacional — una sola fuente de verdad ──
    # procesar_prefiltro ya resuelve internamente si el candidato está en Onboarding,
    # coordinando videollamada, con el prefiltro completo (cita agendada o no) o si le toca
    # una pregunta más (ver su propio enrutamiento en candidatos.py). Antes este webhook
    # reimplementaba esa misma decisión a mano — se desincronizó con el original y mandaba
    # un mensaje de despedida que ya no reflejaba en qué iba el candidato. No la dupliques.
    print(f"[agente] Procesando turno con IA para {c.codigo} (etapa={c.etapa}, estado={c.estado})...")
    resultado = await procesar_prefiltro(db, c, texto, "whatsapp")
    print(f"[agente] Turno completado para {c.codigo}: ia={resultado.get('ia')}, clasificacion={resultado.get('clasificacion')}")
    return {"ok": True, "accion": "turno_prefiltro", "candidato": c.codigo, **resultado}


# ============================================================
# Bitácora de auditoría
# ============================================================

@router.get("/bitacora")
def bitacora(limite: int = 50, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual)):
    """Últimos eventos de auditoría con su cadena de hashes."""
    filas = db.query(Bitacora).order_by(Bitacora.id.desc()).limit(limite).all()
    return [
        {
            "id": b.id,
            "ts": b.ts.isoformat(),
            "actor": b.actor,
            "accion": b.accion,
            "entidad": b.entidad,
            "entidad_id": b.entidad_id,
            "detalle": b.detalle,
            "hash": b.hash,
            "hash_prev": b.hash_prev,
        }
        for b in filas
    ]
