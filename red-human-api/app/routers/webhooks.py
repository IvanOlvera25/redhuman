import json
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import usuario_actual
from ..models import Bitacora, Candidato, Mensaje, Usuario, Vacante, registrar
from ..services.whatsapp import enviar_mensaje, enviar_lista_interactiva, parsear_webhook

router = APIRouter(tags=["webhooks"])

# Regex para detectar códigos de vacante en el texto del candidato
_RE_VAC = re.compile(r"VAC-(\d+)", re.IGNORECASE)

# Palabras que interpretamos como consentimiento LFPDPPP
_ACEPTA = {"sí", "si", "acepto", "aceptar", "ok", "va", "dale", "claro", "por supuesto", "de acuerdo"}


# ============================================================
# Helpers internos
# ============================================================

def _normalizar_telefono(wa_id: str) -> str:
    """521XXXXXXXXXX → 10 dígitos mexicanos para dedup con Candidato.telefono."""
    digitos = re.sub(r"\D", "", wa_id)
    if digitos.startswith("521") and len(digitos) == 13:
        return digitos[3:]  # quitar 521
    if digitos.startswith("52") and len(digitos) == 12:
        return digitos[2:]  # quitar 52
    return digitos[-10:] if len(digitos) > 10 else digitos


def _detectar_vacante(texto: str, db: Session) -> Optional[Vacante]:
    """Extrae VAC-XXXX del texto y busca la vacante en la BD."""
    m = _RE_VAC.search(texto)
    if not m:
        return None
    codigo = f"VAC-{m.group(1)}"
    return db.query(Vacante).filter(Vacante.codigo == codigo).first()


def _buscar_o_crear_candidato(
    db: Session, wa_id: str, nombre: str, vacante: Optional[Vacante]
) -> Candidato:
    """Dedup por wa_id (exacto) o por teléfono normalizado; crea si no existe."""
    # 1. Buscar por wa_id (el más confiable)
    c = db.query(Candidato).filter(Candidato.wa_id == wa_id).first()
    if c:
        return c

    # 2. Buscar por teléfono normalizado
    tel = _normalizar_telefono(wa_id)
    if tel:
        c = db.query(Candidato).filter(Candidato.telefono == tel).first()
        if c:
            # Llenar wa_id si faltaba
            if not c.wa_id:
                c.wa_id = wa_id
            if nombre and not c.wa_nombre:
                c.wa_nombre = nombre
            return c

    # 3. Crear candidato nuevo
    c = Candidato(
        codigo="TMP",
        nombre=nombre or "Candidato WhatsApp",
        telefono=tel,
        fuente="WhatsApp",
        wa_id=wa_id,
        wa_nombre=nombre,
        vacante_id=vacante.id if vacante else None,
    )
    db.add(c)
    db.flush()
    c.codigo = f"C-{8800 + c.id}"
    registrar(db, "sistema", "candidato_ingresado", "candidato", c.codigo, {"fuente": "WhatsApp", "wa_id": wa_id})
    return c


def _texto_aviso_privacidad(nombre: str, vacante: Optional[Vacante]) -> str:
    """Mensaje de bienvenida + aviso de privacidad LFPDPPP."""
    saludo = f"¡Hola{' ' + nombre if nombre else ''}! 👋"
    puesto = f" para *{vacante.titulo}*" if vacante else ""
    return (
        f"{saludo} Gracias por tu interés{puesto}. Soy el asistente de reclutamiento de Red Human AI.\n\n"
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

    print(f"[agente] Procesando mensaje de {nombre_wa} ({telefono}): '{texto}'")

    # ── 1. Detectar vacante en el texto ──────────────────────
    vacante = _detectar_vacante(texto, db)
    if vacante:
        print(f"[agente] Vacante detectada en mensaje: {vacante.codigo} - {vacante.titulo}")

    # ── 2. Buscar o crear candidato ──────────────────────────
    c = _buscar_o_crear_candidato(db, telefono, nombre_wa, vacante)
    print(f"[agente] Candidato asociado: {c.codigo} ({c.nombre}), consentimiento={c.consentimiento}, vacante_id={c.vacante_id}")

    # Si detectamos una vacante y el candidato no tenía una, asignarla
    if vacante and not c.vacante_id:
        c.vacante_id = vacante.id
        db.flush()
    elif not vacante and c.vacante:
        vacante = c.vacante  # heredar la vacante que ya tenía

    # ── 3. Si no hay vacante → enviar menú de vacantes activas ──
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

    # ── 4. Consentimiento LFPDPPP ────────────────────────────
    if not c.consentimiento:
        ya_pidio = any(m.rol == "assistant" and "Aviso de Privacidad" in m.texto for m in c.mensajes)

        if not ya_pidio:
            # Primer contacto: enviar aviso de privacidad
            aviso = _texto_aviso_privacidad(nombre_wa or c.wa_nombre, vacante)
            print(f"[agente] Enviando aviso de privacidad a {c.codigo} ({telefono})...")
            resultado = await enviar_mensaje(telefono, aviso)
            print(f"[agente] Resultado envío aviso de privacidad: {resultado}")
            db.add(Mensaje(candidato_id=c.id, rol="user", texto=texto, canal="whatsapp"))
            db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=aviso, canal="whatsapp", enviado=resultado.get("enviado", False)))
            db.commit()
            print(f"[agente] Aviso de privacidad registrado para {c.codigo}")
            return {"ok": True, "accion": "aviso_privacidad", "candidato": c.codigo}

        # Ya se pidió el consentimiento, verificar respuesta
        respuesta = texto.lower().strip().rstrip(".!¡")
        if respuesta in _ACEPTA:
            c.consentimiento = True
            c.consentimiento_fecha = datetime.now(timezone.utc)
            registrar(db, c.codigo, "consentimiento_otorgado", "candidato", c.codigo, {"medio": "whatsapp", "aviso_privacidad": "aceptado"})
            db.add(Mensaje(candidato_id=c.id, rol="user", texto=texto, canal="whatsapp"))
            db.flush()
            print(f"[agente] ✅ Consentimiento otorgado por {c.codigo}")

            # Arrancar el prefiltro con un mensaje inicial de bienvenida
            from .candidatos import procesar_prefiltro
            resultado = await procesar_prefiltro(db, c, f"Acepto el aviso de privacidad. Quiero aplicar a {vacante.titulo if vacante else 'la vacante'}.", "whatsapp")
            print(f"[agente] Primer turno de prefiltro arrancado para {c.codigo}: {resultado}")
            return {"ok": True, "accion": "prefiltro_iniciado", "candidato": c.codigo, **resultado}
        else:
            # Respuesta no es un consentimiento claro
            recordatorio = "Para continuar con el proceso necesito tu autorización. ¿Aceptas el tratamiento de tus datos conforme al Aviso de Privacidad? (Responde *Sí* o *Acepto*)"
            print(f"[agente] Respuesta de consentimiento no clara ('{texto}'). Re-enviando solicitud a {telefono}")
            resultado = await enviar_mensaje(telefono, recordatorio)
            db.add(Mensaje(candidato_id=c.id, rol="user", texto=texto, canal="whatsapp"))
            db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=recordatorio, canal="whatsapp", enviado=resultado.get("enviado", False)))
            db.commit()
            return {"ok": True, "accion": "esperando_consentimiento", "candidato": c.codigo}

    # ── 5. Prefiltro conversacional (el candidato ya dio consentimiento) ──
    if c.prefiltro_completo:
        despedida = "¡Gracias! Tu pre-filtro ya está completo. El equipo de RH revisará tu información y te contactará pronto. 😊"
        print(f"[agente] Candidato {c.codigo} ya completó prefiltro. Enviando despedida a {telefono}")
        await enviar_mensaje(telefono, despedida)
        db.add(Mensaje(candidato_id=c.id, rol="user", texto=texto, canal="whatsapp"))
        db.add(Mensaje(candidato_id=c.id, rol="assistant", texto=despedida, canal="whatsapp", enviado=True))
        db.commit()
        return {"ok": True, "accion": "prefiltro_ya_completo", "candidato": c.codigo}

    from .candidatos import procesar_prefiltro
    print(f"[agente] Procesando turno de prefiltro con IA para {c.codigo}...")
    resultado = await procesar_prefiltro(db, c, texto, "whatsapp")
    print(f"[agente] Turno completado para {c.codigo}: ia={resultado.get('ia')}, clasificacion={resultado.get('clasificacion')}, resp={resultado.get('respuesta')}")
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

