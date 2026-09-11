"""Webhook de WhatsApp (Meta Cloud API) — el agente de prefiltro conversa con el candidato.

Fase 2 (Puntos 7/8): un número de WhatsApp es una PERSONA (`Candidato`), pero la conversación
es siempre sobre UNA `Postulacion`. Cómo se decide cuál (decisión de negocio 2026-09-11,
"contexto de conversación + preguntar"):

1. `Candidato.postulacion_conversacion_id` apunta a la postulación en conversación. Lo mueve
   SOLO el candidato: un mensaje entrante suyo que se enruta a una postulación, o una
   selección explícita en la lista interactiva. Un mensaje saliente/proactivo (plantilla de
   inicio tras /aplicar, aviso de apto, recordatorio, notificación de RH) NUNCA lo mueve
   (decisión B1, 2026-09-11) — ver candidatos.fijar_conversacion.
2. Si el puntero apunta a una postulación que sigue esperando respuesta, el mensaje va ahí.
3. Si no, y exactamente UNA postulación activa espera respuesta, se cambia el puntero a esa.
4. Si VARIAS esperan respuesta, el agente manda una lista interactiva solo con SUS vacantes
   en curso y no procesa nada hasta que elija. Nunca adivina.
5. Si ninguna espera respuesta: se sigue en la del puntero (respuesta fija de "ya te
   contactamos"), o —si el candidato eligió explícitamente una vacante del menú— se abre una
   postulación nueva para esa vacante. Sin nada activo, nace una postulación sin vacante y se
   le manda el menú de vacantes publicadas.
"""

import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import cuenta_actual, usuario_actual
from ..models import Bitacora, Candidato, Cuenta, Postulacion, Usuario, Vacante, registrar
from ..services.configuracion import modo_prueba_activo, ventana_modo_prueba_min
from ..services.whatsapp import enviar_mensaje, enviar_lista_interactiva, parsear_webhook
from .candidatos import (
    _crear_candidato,
    crear_postulacion,
    fijar_conversacion,
    guardar_mensaje,
    postulacion_para_vacante,
    procesar_prefiltro,
)

# Modo Prueba: una conversación con actividad más vieja que la ventana configurada
# (ConfiguracionSistema.modo_prueba_ventana_min, Punto 13; 60 min por defecto) ya no se
# reutiliza — se cierra la postulación y se trata como una nueva e independiente
# (ver _resolver_postulacion). Con Modo Prueba apagado no aplica.
VENTANA_MODO_PRUEBA_DEFAULT = timedelta(minutes=60)

router = APIRouter(tags=["webhooks"])

# Regex para detectar códigos de vacante en el texto del candidato
_RE_VAC = re.compile(r"VAC[-_]?([A-Za-z0-9]+)", re.IGNORECASE)

# Palabras (completas, ya sin acentos) que interpretamos como consentimiento LFPDPPP. Se compara
# por palabra, no por subcadena: "va" no debe dispararse con "vacante" ni "si" con "sin".
_ACEPTA = {"si", "acepto", "aceptar", "autorizo", "ok", "va", "vale", "dale", "claro", "supuesto", "acuerdo", "adelante"}


# ============================================================
# Helpers internos
# ============================================================

def _normalizar_str(s: str) -> str:
    """Quita acentos y pasa a minúsculas para comparaciones flexibles."""
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


def _es_aceptacion(texto: str) -> bool:
    """True si el mensaje contiene una palabra de aceptación ("Sí", "Acepto", "De acuerdo"…)."""
    return bool(set(re.findall(r"[a-z]+", _normalizar_str(texto))) & _ACEPTA)


def _normalizar_telefono(wa_id: str) -> str:
    """521XXXXXXXXXX → 10 dígitos mexicanos para dedup con Candidato.telefono."""
    digitos = re.sub(r"\D", "", wa_id)
    if digitos.startswith("521") and len(digitos) == 13:
        return digitos[3:]  # quitar 521
    if digitos.startswith("52") and len(digitos) == 12:
        return digitos[2:]  # quitar 52
    return digitos[-10:] if len(digitos) > 10 else digitos


def _vacantes_publicadas(db: Session, cuenta_id: int) -> list:
    return (
        db.query(Vacante)
        .filter(Vacante.estado == "Publicada", Vacante.cuenta_id == cuenta_id)
        .order_by(Vacante.id.desc())
        .limit(10)
        .all()
    )


def _detectar_vacante(texto: str, db: Session, cuenta_id: int, id_seleccionado: Optional[str] = None) -> Optional[Vacante]:
    """Busca la vacante por ID interactivo, código VAC-XXXX, número de lista, título o slug."""
    candidatos_cod = [s for s in [id_seleccionado, texto] if s]

    # 1. Búsqueda por código exacto o regex VAC-XXXX
    for s in candidatos_cod:
        s_clean = s.strip()
        # Coincidencia directa por código
        v = db.query(Vacante).filter(func.lower(Vacante.codigo) == s_clean.lower(), Vacante.cuenta_id == cuenta_id).first()
        if v:
            return v
        # Regex VAC-####
        m = _RE_VAC.search(s_clean)
        if m:
            cod = f"VAC-{m.group(1)}"
            v = db.query(Vacante).filter(func.lower(Vacante.codigo) == cod.lower(), Vacante.cuenta_id == cuenta_id).first()
            if v:
                return v

    vacantes_activas = _vacantes_publicadas(db, cuenta_id)

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


def _vacante_explicita(db: Session, cuenta_id: int, texto: str, id_seleccionado: str) -> Optional[Vacante]:
    """Solo selecciones INEQUÍVOCAS (respuesta a la lista interactiva o código VAC-#### escrito):
    sirve para que una persona con procesos ya cerrados pueda abrir otra postulación desde
    WhatsApp. Un "3" suelto o un título aproximado NO cuentan aquí — podrían ser respuestas
    de prefiltro."""
    for s in [id_seleccionado, texto]:
        s = (s or "").strip()
        if not s:
            continue
        v = db.query(Vacante).filter(func.lower(Vacante.codigo) == s.lower(), Vacante.cuenta_id == cuenta_id).first()
        if v:
            return v
        m = _RE_VAC.search(s)
        if m:
            v = db.query(Vacante).filter(func.lower(Vacante.codigo) == f"vac-{m.group(1).lower()}", Vacante.cuenta_id == cuenta_id).first()
            if v:
                return v
    return None


def _buscar_o_crear_candidato(db: Session, wa_id: str, nombre: str, cuenta_id: int, prueba: bool) -> Candidato:
    """Resuelve a la PERSONA por wa_id (exacto) o por teléfono normalizado; la crea si no existe.
    order_by id desc: con Modo Prueba puede haber más de una persona con el mismo número (cada
    postulación web de prueba crea una persona nueva) — nos quedamos con la más reciente."""
    existente = (
        db.query(Candidato)
        .filter(Candidato.wa_id == wa_id, Candidato.cuenta_id == cuenta_id)
        .order_by(Candidato.id.desc())
        .first()
    )
    tel = _normalizar_telefono(wa_id)
    if not existente and tel:
        existente = (
            db.query(Candidato)
            .filter(Candidato.telefono == tel, Candidato.cuenta_id == cuenta_id)
            .order_by(Candidato.id.desc())
            .first()
        )
    if existente:
        if not existente.wa_id:
            existente.wa_id = wa_id
        if nombre and not existente.wa_nombre:
            existente.wa_nombre = nombre
        return existente

    c = _crear_candidato(
        db, cuenta_id, nombre or "Candidato WhatsApp", "WhatsApp", prueba,
        telefono=tel, wa_id=wa_id, wa_nombre=nombre,
    )
    registrar(db, "sistema", "candidato_ingresado", "candidato", c.codigo, {"fuente": "WhatsApp", "wa_id": wa_id, "es_prueba": prueba})
    return c


def _conversacion_fria(db: Session, c: Candidato) -> bool:
    ultima = c.mensajes[-1].creado_en if c.mensajes else c.creado_en
    # SQLite descarta el offset de un DateTime(timezone=True) y regresa un datetime naive con
    # los mismos números de reloj UTC — hay que reponerle el tzinfo antes de restar.
    if ultima.tzinfo is None:
        ultima = ultima.replace(tzinfo=timezone.utc)
    ventana = timedelta(minutes=ventana_modo_prueba_min(db)) or VENTANA_MODO_PRUEBA_DEFAULT
    return datetime.now(timezone.utc) - ultima >= ventana


async def _resolver_postulacion(
    db: Session, c: Candidato, texto: str, id_seleccionado: str, cuenta_id: int, prueba: bool, telefono: str
) -> Tuple[Optional[Postulacion], str]:
    """Decide sobre QUÉ postulación es el mensaje entrante (ver docstring del módulo).
    Regresa (postulacion, accion). postulacion=None significa que se le pidió al candidato
    elegir y no hay nada más que procesar en este turno."""
    conv = c.postulacion_conversacion
    if conv and not conv.activa:
        conv = None

    # Modo Prueba: la conversación en curso ya está fría → se cierra y se empieza de cero,
    # sin tocar teléfono ni wa_id de la persona.
    if prueba and conv and _conversacion_fria(db, c):
        conv.cerrar("prueba_expirada")
        registrar(db, "sistema", "postulacion_prueba_expirada", "postulacion", conv.codigo, {"candidato": c.codigo})
        conv = None
        c.postulacion_conversacion_id = None
        db.flush()

    activas = c.postulaciones_activas
    esperando = [p for p in activas if p.espera_respuesta]

    # 0. Respuesta a la lista "¿sobre cuál vacante me escribes?" (ids = P-####)
    if id_seleccionado and id_seleccionado.startswith("P-"):
        elegida = next((p for p in activas if p.codigo == id_seleccionado), None)
        if elegida:
            fijar_conversacion(elegida)
            return elegida, "postulacion_elegida"

    # 1. La conversación en curso sigue esperando respuesta → seguir ahí.
    if conv and conv.espera_respuesta:
        return conv, "conversacion"

    # 2. Sin puntero útil: ¿cuántas esperan respuesta?
    if len(esperando) == 1:
        fijar_conversacion(esperando[0])
        return esperando[0], "conversacion_unica"
    if len(esperando) > 1:
        await enviar_lista_interactiva(
            telefono,
            "📋 Tus postulaciones",
            "Tienes más de un proceso en curso. ¿Sobre cuál vacante me escribes?",
            "Elegir vacante",
            [
                {"id": p.codigo, "titulo": (p.vacante.titulo if p.vacante else "Sin vacante")[:24], "descripcion": f"Etapa: {p.etapa}"[:72]}
                for p in esperando[:10]
            ],
        )
        registrar(db, "agente-ia", "postulacion_ambigua_preguntada", "candidato", c.codigo, {"opciones": [p.codigo for p in esperando]})
        return None, "elegir_postulacion"

    # 3. Nada espera respuesta. ¿Eligió explícitamente una vacante (lista/código)? → nueva
    # postulación (o la activa que ya tenga para esa vacante).
    vac = _vacante_explicita(db, cuenta_id, texto, id_seleccionado)
    if vac and not any(p.vacante_id == vac.id for p in activas):
        p, _nueva = postulacion_para_vacante(db, c, vac, cuenta_id, "whatsapp", es_prueba=prueba)
        fijar_conversacion(p)
        return p, "postulacion_nueva_por_seleccion"
    if conv:
        return conv, "conversacion_cerrada"  # respuesta fija de post-completo
    if activas:
        fijar_conversacion(activas[-1])
        return activas[-1], "activa_mas_reciente"

    # 4. Sin nada activo → postulación nueva sin vacante; el flujo de abajo manda el menú.
    p = crear_postulacion(db, c, None, cuenta_id, "whatsapp", es_prueba=prueba)
    fijar_conversacion(p)
    return p, "postulacion_nueva"


def _cuenta_unica(db: Session) -> Cuenta:
    """El webhook de WhatsApp no tiene sesión ni Cuenta que resolver: hoy solo existe un WABA
    para toda la plataforma, así que el candidato entrante se asigna a la única Cuenta activa.
    TEMPORAL — cuando exista ruteo de WhatsApp por Cuenta, esto debe resolverse por el número
    que recibió el mensaje, no adivinando una sola Cuenta."""
    cuentas = db.query(Cuenta).filter(Cuenta.estado == "Activa").order_by(Cuenta.id).all()
    if len(cuentas) != 1:
        raise HTTPException(
            500,
            f"El webhook de WhatsApp requiere exactamente 1 Cuenta activa; hay {len(cuentas)}. "
            "Configura el ruteo por Cuenta antes de operar con varias.",
        )
    return cuentas[0]


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

    cuenta = _cuenta_unica(db)
    prueba = modo_prueba_activo(db)

    # ── 1. Persona y postulación en conversación ──────────────────────────────
    c = _buscar_o_crear_candidato(db, telefono, nombre_wa, cuenta.id, prueba)
    p, ruteo = await _resolver_postulacion(db, c, texto, id_seleccionado, cuenta.id, prueba, telefono)
    if p is None:
        db.commit()
        return {"ok": True, "accion": ruteo, "candidato": c.codigo}
    print(f"[agente] Postulación {p.codigo} ({ruteo}) — candidato={c.codigo} {c.nombre}, consentimiento={p.consentimiento}, vacante_id={p.vacante_id}")

    # ── 2. Detectar vacante SOLO si la postulación sigue en selección (sin vacante, o con
    # vacante pero sin consentimiento — sigue respondiendo el menú inicial). Con vacante +
    # consentimiento, ninguna respuesta del prefiltro (p.ej. "3" años de experiencia) puede
    # reasignar la vacante — antes un número de un dígito se interpretaba como "selección #N".
    en_seleccion_vacante = not p.vacante_id or not p.consentimiento
    vacante_detectada = _detectar_vacante(texto, db, cuenta.id, id_seleccionado) if en_seleccion_vacante else None
    if vacante_detectada:
        print(f"[agente] Vacante detectada: {vacante_detectada.codigo} - {vacante_detectada.titulo}")

    analisis_p = dict(p.analisis or {})

    # ── 2.1 Captura interactiva de nombre si Meta no lo proporcionó ──
    if analisis_p.get("esperando_nombre"):
        nombre_ingresado = texto.strip()
        c.nombre = nombre_ingresado
        c.wa_nombre = nombre_ingresado
        analisis_p.pop("esperando_nombre", None)
        p.analisis = analisis_p
        registrar(db, c.codigo, "nombre_actualizado", "candidato", c.codigo, {"nombre": nombre_ingresado, "fuente": "whatsapp_inbound"})
        db.flush()

        vac = p.vacante
        puesto = f" de *{vac.titulo}*" if vac else ""
        primer_nombre = nombre_ingresado.split()[0]
        saludo = f"¡Mucho gusto, {primer_nombre}! 👋 Vamos a iniciar con unas breves preguntas para tu postulación{puesto}."
        envio_saludo = await enviar_mensaje(telefono, saludo)
        guardar_mensaje(db, p, "assistant", saludo, "whatsapp", envio_saludo)
        db.flush()

        mensaje_inicio = f"Mi nombre es {c.nombre} y me postulo a la vacante {vac.titulo if vac else ''}."
        resultado = await procesar_prefiltro(db, p, mensaje_inicio, "whatsapp")
        return {"ok": True, "accion": "nombre_capturado_y_prefiltro_iniciado", "candidato": c.codigo, "postulacion": p.codigo, **resultado}

    # Si se detectó una vacante, asignarla a la postulación. Si la persona ya tiene otra
    # postulación ACTIVA para esa misma vacante, se sigue en aquella (no se duplica la tarjeta)
    # y esta postulación vacía se descarta.
    seleccion_nueva_vacante = False
    if vacante_detectada and p.vacante_id != vacante_detectada.id:
        otra = next((x for x in c.postulaciones_activas if x.vacante_id == vacante_detectada.id and x.id != p.id), None)
        if otra:
            if not p.vacante_id and not p.mensajes:
                db.delete(p)
            p = otra
            fijar_conversacion(p)
            db.flush()
        else:
            p.vacante_id = vacante_detectada.id
            seleccion_nueva_vacante = True
            db.flush()
    elif not vacante_detectada and p.vacante:
        vacante_detectada = p.vacante

    vacante = vacante_detectada

    # ── 3. Si aún no hay vacante asignada → enviar menú de vacantes activas ──
    if not p.vacante_id:
        print(f"[agente] Postulación {p.codigo} no tiene vacante asignada. Buscando vacantes publicadas...")
        vacantes = _vacantes_publicadas(db, cuenta.id)
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
        return {"ok": True, "accion": "menu_vacantes", "candidato": c.codigo, "postulacion": p.codigo}

    # ── 4. Si acaba de seleccionar vacante o falta consentimiento → aviso, consentimiento, prefiltro ──
    if seleccion_nueva_vacante or not p.consentimiento:
        if not p.consentimiento:
            # Decisión 2026-09-11 (LFPDPPP): elegir la vacante del menú NUNCA cuenta como
            # consentimiento. Siempre se manda el aviso de privacidad (con la vacante elegida) y
            # el prefiltro no arranca hasta un "Sí"/"Acepto" explícito en un turno posterior.
            if seleccion_nueva_vacante or not _es_aceptacion(texto):
                aviso = _texto_aviso_privacidad(c.nombre if not c.nombre.startswith("Candidato") else "", vacante)
                envio_aviso = await enviar_mensaje(telefono, aviso)
                guardar_mensaje(db, p, "assistant", aviso, "whatsapp", envio_aviso)
                db.commit()
                return {"ok": True, "accion": "aviso_privacidad_enviado", "candidato": c.codigo, "postulacion": p.codigo}

            p.consentimiento = True
            p.consentimiento_fecha = datetime.now(timezone.utc)
            registrar(
                db, c.codigo, "consentimiento_otorgado", "postulacion", p.codigo,
                {"candidato": c.codigo, "medio": "whatsapp", "vacante": vacante.codigo if vacante else "",
                 "accion": "acepto_aviso", "texto": texto[:200]},
            )

        # Si no tenemos el nombre real del candidato, solicitárselo antes de las preguntas
        nombre_desconocido = not c.nombre or c.nombre.startswith("Candidato") or c.nombre == "TMP"
        if nombre_desconocido and not nombre_wa:
            analisis_p["esperando_nombre"] = True
            p.analisis = analisis_p
            db.commit()

            pregunta_nombre = f"¡Excelente elección! Te postularás para *{vacante.titulo}*.\n\nAntes de comenzar, ¿cuál es tu *nombre completo*?"
            envio_pregunta = await enviar_mensaje(telefono, pregunta_nombre)
            guardar_mensaje(db, p, "assistant", pregunta_nombre, "whatsapp", envio_pregunta)
            db.commit()
            return {"ok": True, "accion": "solicitando_nombre", "candidato": c.codigo, "postulacion": p.codigo}

        db.flush()
        print(f"[agente] ✅ Vacante {vacante.titulo if vacante else ''} confirmada para postulación {p.codigo} ({c.nombre})")

        # Iniciar inmediatamente el prefiltro con la primera pregunta de la vacante
        mensaje_inicio = f"Me interesa postularme para la vacante de {vacante.titulo if vacante else 'la posición'}."
        resultado = await procesar_prefiltro(db, p, mensaje_inicio, "whatsapp")
        print(f"[agente] Prefiltro iniciado para postulación {p.codigo}: {resultado.get('respuesta')}")
        return {"ok": True, "accion": "prefiltro_iniciado", "candidato": c.codigo, "postulacion": p.codigo, **resultado}

    # ── 5. Turno conversacional — una sola fuente de verdad ──
    # procesar_prefiltro ya resuelve internamente si la postulación está en Onboarding,
    # coordinando videollamada, con el prefiltro completo (cita agendada o no) o si le toca
    # una pregunta más. No dupliques esa decisión aquí.
    print(f"[agente] Procesando turno con IA para {p.codigo} / {c.codigo} (etapa={p.etapa}, estado={p.estado})...")
    resultado = await procesar_prefiltro(db, p, texto, "whatsapp")
    print(f"[agente] Turno completado para {p.codigo}: ia={resultado.get('ia')}, clasificacion={resultado.get('clasificacion')}")
    return {"ok": True, "accion": "turno_prefiltro", "candidato": c.codigo, "postulacion": p.codigo, **resultado}


# ============================================================
# Bitácora
# ============================================================

@router.get("/bitacora")
def bitacora(
    limite: int = 50, db: Session = Depends(get_db), _: Usuario = Depends(usuario_actual),
    cuenta: Cuenta = Depends(cuenta_actual),
):
    """Últimos eventos de auditoría con su cadena de hashes, de la Cuenta actual."""
    filas = (
        db.query(Bitacora)
        .filter(Bitacora.cuenta_id == cuenta.id)
        .order_by(Bitacora.id.desc())
        .limit(limite)
        .all()
    )
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
