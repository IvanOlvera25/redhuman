"""Serializadores → formas exactas que consume el frontend (lib/data.ts / lib/phase2.ts)."""

from datetime import datetime, timezone
from typing import List, Optional

from .models import AsignacionCurso, Archivo, Candidato, Colaborador, Curso, Documento, Entrevista, Expediente, Postulacion, Vacante
from .services.avatar import avatar_activo
from .services.ia import texto_preguntas

MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def hace(dt: Optional[datetime]) -> str:
    if dt is None:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    s = int(delta.total_seconds())
    if s < 3600:
        return f"hace {max(1, s // 60)} min"
    if s < 86400:
        return f"hace {s // 3600} h"
    if s < 7 * 86400:
        d = s // 86400
        return f"hace {d} día{'s' if d > 1 else ''}"
    return f"hace {s // (7 * 86400)} semana{'s' if s // (7 * 86400) > 1 else ''}"


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def fecha_corta(dt: Optional[datetime]) -> str:
    return f"{dt.day} {MESES[dt.month - 1]}" if dt else ""


# ------------------------------------------------------------
# Módulo 1 · Vacantes
# ------------------------------------------------------------


def nombre_empresa(cuenta, cliente=None, mostrar_cliente: bool = True) -> str:
    """Regla única de identidad de empresa (Fase 4, Punto 1) SIN necesitar una Vacante: el
    Cliente (nombre visible) solo si existe y está marcado para mostrarse; si no, el nombre
    comercial de la Cuenta. La usa el generador de vacantes antes de que la vacante exista."""
    if cliente is not None and mostrar_cliente:
        return cliente.nombre_visible
    if cuenta is not None:
        return cuenta.nombre_comercial
    return ""


def nombre_empresa_candidato(v: Vacante) -> str:
    """Nombre de empresa que debe ver el candidato (Fase B, punto 10): el Cliente real solo si
    hay uno asignado y `mostrar_cliente_candidato` está activo; si no, el nombre comercial de la
    Cuenta — nunca el texto libre `empresa` salvo que la vacante no tenga Cuenta (no debería
    pasar tras la migración de Fase A, es solo un respaldo defensivo)."""
    if v.cliente_id and v.mostrar_cliente_candidato and v.cliente:
        return v.cliente.nombre_visible
    if v.cuenta:
        return v.cuenta.nombre_comercial
    return v.empresa or ""


def vacante_dict(
    v: Vacante,
    n_candidatos: int = 0,
    n_nuevos: int = 0,
    embudo: Optional[dict] = None,
    colaboradores: Optional[List[str]] = None,
) -> dict:
    return {
        "id": v.codigo,
        "slug": v.slug or "",
        "titulo": v.titulo,
        "area": v.area,
        "empresa": v.empresa,
        # --- Fase B: Cliente/Responsable/Colaboradores/visibilidad ---
        "cliente": v.cliente.nombre if v.cliente else None,
        "clienteId": v.cliente_id,
        "responsable": v.responsable.nombre if v.responsable else None,
        "colaboradores": colaboradores or [],
        "mostrarClienteCandidato": v.mostrar_cliente_candidato,
        # nombre que ve el candidato — RH siempre ve la relación real arriba, sin importar el flag
        "nombreEmpresa": nombre_empresa_candidato(v),
        "ubicacion": v.ubicacion,
        "modalidad": v.modalidad,
        "sueldo": v.sueldo,
        # Parte 3: sueldo estructurado (el texto de arriba es el derivado que se muestra)
        "sueldoDesde": v.sueldo_desde,
        "sueldoHasta": v.sueldo_hasta,
        "sueldoMoneda": v.sueldo_moneda or "MXN",
        "sueldoPeriodicidad": v.sueldo_periodicidad or "",
        "estado": v.estado,
        "enfoqueEntrevista": v.enfoque_entrevista or "profesional",
        "candidatos": n_candidatos,
        "nuevos": n_nuevos,
        "publicada": hace(v.creada_en) if v.estado == "Publicada" else "borrador",
        "plataformas": v.plataformas or [],
        # contenido base
        "descripcion": v.descripcion,
        "requisitos": v.requisitos,
        "resumen": v.resumen or "",
        "perfilIdeal": v.perfil_ideal or "",
        "responsabilidades": v.responsabilidades or [],
        "requisitosDeseables": v.requisitos_deseables or [],
        "beneficios": v.beneficios or [],
        "palabrasClave": v.palabras_clave or [],
        "seniority": v.seniority or "",
        "avisosCumplimiento": v.avisos_cumplimiento or [],
        # publicaciones por plataforma: {occ|linkedin|portal|whatsapp: {titulo, copy, page, etiquetas}}
        "publicaciones": v.publicaciones or {},
        "textoWhatsapp": v.texto_whatsapp or "",
        "textoBolsa": v.texto_bolsa or "",
        # prefiltro
        "preguntas_filtro": texto_preguntas(v.preguntas_filtro),
        "criterios": [p for p in (v.preguntas_filtro or []) if isinstance(p, dict)],
        # embudo de esta vacante (conecta con el pipeline de candidatos)
        "embudo": embudo or {},
        "creada": iso(v.creada_en),
        # Fase C: fecha de primera publicación (ISO string, null si nunca se publicó)
        "publicadaEn": iso(v.publicada_en),
        "actualizada": iso(v.actualizada_en),
    }


# ------------------------------------------------------------
# Módulo 1 · Candidatos
# ------------------------------------------------------------


def archivo_dict(a: Archivo) -> dict:
    return {
        "id": a.id,
        "tipo": a.tipo,
        "nombre": a.nombre,
        "mime": a.mime,
        "tamano": a.tamano,
        "estado": a.estado,
        "notas": a.notas_ia or "",
        "subidoPor": a.subido_por,
        "subido": hace(a.subido_en),
    }


def _entrevista_humana_dict(eh) -> dict:
    return {
        "entrevistador": eh.entrevistador,
        "tipo": eh.tipo,
        "usuarioId": eh.usuario_id,
        "correoExterno": eh.correo_externo,
        "whatsappExterno": eh.whatsapp_externo or "",
        "contactoId": eh.contacto_id,  # Fase 7A
        "teamsEventoId": eh.teams_evento_id or "",  # Fase 7B
        "porTeams": bool(eh.teams_evento_id),
        "fecha": iso(eh.fecha),
        "modalidad": eh.modalidad,
        "liga": eh.liga,
        "ubicacion": eh.ubicacion,
        "telefonoContacto": eh.telefono_contacto,
        "comentario": eh.comentario,
        "realizada": eh.realizada,
        "cancelada": eh.cancelada,
        "resultado": eh.resultado or None,
        "recomendacion": eh.recomendacion or None,
        "resultadoCapturadoPor": eh.resultado_capturado_por or None,
    }


def _dedupe_cap(items: List[Optional[str]], maximo: int) -> List[str]:
    vistos = set()
    salida: List[str] = []
    for it in items:
        if not it:
            continue
        clave = it.strip().casefold()
        if clave in vistos:
            continue
        vistos.add(clave)
        salida.append(it.strip())
        if len(salida) >= maximo:
            break
    return salida


def _sintesis_global(p: Postulacion) -> dict:
    """Puntos 3 (D/E/F/G) y 5: combina CV + Prefiltro + Entrevista IA + Entrevista Humana en
    una sola síntesis — determinista, SIN llamada a IA nueva (decisión confirmada). Se calcula
    al vuelo en cada lectura, nunca se persiste: así "recalcular cuando el CV se carga después"
    se cumple gratis, sin enganchar este cálculo en cada punto de mutación.

    Fase 2: todo sale de la Postulación — las entrevistas de OTRA postulación de la misma
    persona no cuentan para esta (cada aplicación se evalúa por sí sola)."""
    a = p.analisis or {}
    score = p.score
    resultado_apto = p.resultado_apto
    ultima_eh = p.entrevistas_humanas[-1] if p.entrevistas_humanas else None
    ultima_ent = p.entrevistas[-1] if p.entrevistas else None

    eval_ia = (ultima_ent.evaluacion or {}) if ultima_ent else {}
    match_ia = eval_ia.get("match_perfil")
    respuestas = a.get("respuestas_prefiltro") or []

    # --- C. Prefiltro: "Cumple X de Y criterios" (o solo los incumplimientos) ---
    prefiltro_resumen = None
    if respuestas:
        cumple_n = sum(1 for r in respuestas if r.get("cumple") is True)
        incumplidos = [r.get("criterio") or r.get("pregunta") for r in respuestas if r.get("cumple") is False]
        prefiltro_resumen = {"cumple": cumple_n, "total": len(respuestas), "incumplidos": incumplidos}

    # --- D. Afinidad global: score CV/Prefiltro, promediado con match de Entrevista IA si la
    # hay, ajustado por el resultado de Entrevista Humana si la hay (la señal más autoritativa:
    # una persona real ya evaluó). Cada fuente usada queda citada en `sintesisAfinidad`. ---
    afinidad: Optional[int] = None
    fuentes: List[str] = []
    if score:
        afinidad = score
        fuentes.append(f"CV/Prefiltro: {score}/100 de ajuste")
    if match_ia is not None:
        afinidad = round(((afinidad or 0) + match_ia) / 2) if afinidad is not None else match_ia
        fuentes.append(f"Entrevista IA: {match_ia}% de match")
    if ultima_eh and ultima_eh.resultado:
        legible = "aprobado" if ultima_eh.resultado == "aprobado" else "no aprobado"
        fuentes.append(f"Entrevista Humana con {ultima_eh.entrevistador or 'RH'}: {legible}")
        objetivo = 100 if ultima_eh.resultado == "aprobado" else 0
        afinidad = round(objetivo if afinidad is None else afinidad * 0.5 + objetivo * 0.5)
    if afinidad is not None:
        afinidad = max(0, min(100, afinidad))

    # --- E/F. Fortalezas principales y puntos por validar — unión deduplicada de lo que cada
    # etapa YA calificó, prioridad a la señal más reciente (Entrevista > Prefiltro > CV). ---
    fortalezas = _dedupe_cap(
        [*(eval_ia.get("fortalezas") or []),
         *[r.get("criterio") or r.get("pregunta") for r in respuestas if r.get("cumple") is True],
         *(a.get("requisitos_cumplidos") or [])],
        4,
    )
    puntos_por_validar = _dedupe_cap(
        [*(eval_ia.get("riesgos") or []),
         *[r.get("criterio") or r.get("pregunta") for r in respuestas if r.get("cumple") is False],
         *(a.get("brechas") or []),
         *([f"Segunda entrevista sugerida" + (f": {ultima_eh.comentario}" if ultima_eh.comentario else "")]
           if ultima_eh and ultima_eh.recomendacion == "segunda_entrevista" else [])],
        4,
    )

    # --- G. Recomendación de Red Human — reusa el "más reciente gana" de resultado_apto
    # (Fase C/D), nunca reinventa la lógica de negocio. ---
    recomendacion: Optional[str] = None
    motivo = ""
    if resultado_apto is False:
        recomendacion = "No avanzar"
        motivo = "El resultado más reciente del proceso marca al candidato como no apto."
    elif ultima_eh and ultima_eh.recomendacion == "no_avanzar":
        recomendacion = "No avanzar"
        motivo = "El entrevistador humano recomendó no avanzar."
    elif resultado_apto is True and ultima_eh and ultima_eh.resultado == "aprobado" and ultima_eh.recomendacion == "avanzar":
        recomendacion = "Avanzar a contratación"
        motivo = "La Entrevista Humana confirmó al candidato como aprobado, con recomendación de avanzar."
    elif resultado_apto is True:
        recomendacion = "Realizar entrevista humana"
        motivo = (
            "La Entrevista Humana sugiere una segunda ronda antes de decidir."
            if ultima_eh and ultima_eh.recomendacion == "segunda_entrevista"
            else "Compatible según CV/Prefiltro/Entrevista IA, pero falta la validación de una Entrevista Humana."
        )

    return {
        "prefiltroResumen": prefiltro_resumen,
        "afinidadGlobal": afinidad,
        "sintesisAfinidad": " · ".join(fuentes),
        "fortalezasPrincipales": fortalezas,
        "puntosPorValidar": puntos_por_validar,
        "recomendacionRedHuman": recomendacion,
        "recomendacionMotivo": motivo,
    }


def _persona_dict(c: Candidato) -> dict:
    """Ficha de la PERSONA (maestro de identidad) — va embebida en cada postulación como
    `candidato` y es lo que regresa candidato_dict()."""
    return {
        "id": c.codigo,
        "codigo": c.codigo,
        "nombre": c.nombre,
        "correo": c.correo,
        "telefono": c.telefono,
        "ubicacion": c.ubicacion or "",
        "experiencia": c.experiencia or "",
        "fuente": c.fuente,
        "esPrueba": c.es_prueba,
        "totalPostulaciones": len(c.postulaciones),
        "postulacionesActivas": len(c.postulaciones_activas),
        "archivos": len(c.archivos),
        "creadoEn": iso(c.creado_en),
    }


def _postulacion_resumen_dict(p: Postulacion) -> dict:
    """Renglón del historial de postulaciones de una persona (pestaña Resumen)."""
    return {
        "id": p.codigo,
        "puesto": p.vacante.titulo if p.vacante else "",
        "vacanteId": p.vacante.codigo if p.vacante else "",
        "etapa": p.etapa,
        "estado": p.estado,
        "score": p.score,
        "activa": p.activa,
        "motivoCierre": p.motivo_cierre,
        "creado": hace(p.creado_en),
        "creadoEn": iso(p.creado_en),
        "cerradaEn": iso(p.cerrada_en),
    }


def postulacion_dict(p: Postulacion, detalle: bool = False) -> dict:
    """La tarjeta del Kanban (decisión P4: una por Postulación). `id` es el código P-####
    — es lo que el frontend manda a /candidatos/{codigo}/...; los datos de persona vienen
    aplanados (nombre, teléfono…) por compatibilidad y también en `candidato`."""
    c = p.candidato
    v = p.vacante
    exp = p.expediente
    ultima = p.entrevistas[-1] if p.entrevistas else None
    ultima_eh = p.entrevistas_humanas[-1] if p.entrevistas_humanas else None
    total_postulaciones = len(c.postulaciones)

    base = {
        "id": p.codigo,
        "codigo": p.codigo,
        "postulacionId": p.id,
        # Convención: `candidatoId` es SIEMPRE lo que se manda a /candidatos/{codigo} (la
        # postulación) — igual que en entrevista_dict/expediente_dict; la persona va en
        # `candidatoCodigo` y en `candidato`.
        "candidatoId": p.codigo,
        "candidatoCodigo": c.codigo,
        "nombre": c.nombre,
        "puesto": v.titulo if v else "",
        "vacanteId": v.codigo if v else "",
        "vacanteTitulo": v.titulo if v else "",
        "fuente": c.fuente,
        "origen": p.origen,
        "estado": p.estado,
        "etapa": p.etapa,
        "score": p.score,
        "experiencia": c.experiencia or "",
        "ubicacion": c.ubicacion or "",
        "aplicado": hace(p.creado_en),
        "creadoEn": iso(p.creado_en),
        "tono": (c.id or 0) % 4,
        "evidencia": p.evidencia or "Prefiltro en curso.",
        "telefono": c.telefono,
        "correo": c.correo,
        "consentimiento": p.consentimiento,
        "prefiltroCompleto": p.prefiltro_completo,
        "activa": p.activa,
        "motivoCierre": p.motivo_cierre,
        "cerradaEn": iso(p.cerrada_en),
        "esPrueba": c.es_prueba or p.es_prueba,
        "totalPostulaciones": total_postulaciones,
        "yaAplicoAntes": total_postulaciones > 1,
        "enConversacion": c.postulacion_conversacion_id == p.id,
        # --- Entrevista Humana (flujo manual) — puede haber varias rondas, ver EntrevistaHumana.
        # "entrevistaHumana" es la más reciente; "entrevistasHumanas" el historial (más reciente primero).
        "entrevistaHumana": _entrevista_humana_dict(ultima_eh) if ultima_eh else None,
        "entrevistasHumanas": [_entrevista_humana_dict(eh) for eh in reversed(p.entrevistas_humanas)],
        # --- Expediente (Contratación) — pertenece a ESTA postulación (decisión P5) ---
        "expedienteId": exp.id if exp else None,
        "expedienteProgreso": exp.progreso if exp else None,
        "expedienteEstado": exp.estado if exp else None,
        "expedienteCondiciones": {
            "puesto": exp.puesto,
            "sueldo": exp.sueldo,
            "tipoContratacion": exp.tipo_contratacion,
            "ubicacion": exp.ubicacion,
            "jefeDirecto": exp.jefe_directo,
            "fechaIngreso": iso(exp.fecha_ingreso),
        }
        if exp
        else None,
        # --- Entrevista IA ---
        "entrevistaId": ultima.codigo if ultima else None,
        "entrevistaEstado": ultima.estado if ultima else None,
        "entrevistaMatch": (ultima.evaluacion or {}).get("match_perfil") if ultima else None,
        "entrevistaRecomendacion": (ultima.evaluacion or {}).get("recomendacion") if ultima else None,
        "archivos": len(c.archivos),
        "mensajes": len(p.mensajes),
        # --- Fase C ---
        "ultimaActividadEn": iso(p.ultima_actividad_en),
        "resultadoApto": p.resultado_apto,
        "clienteVacante": v.cliente.nombre if v and v.cliente else None,
        "clienteIdVacante": v.cliente_id if v else None,  # Fase 7A: para elegir contactos/entrevistador externo
        # --- Persona (maestro) ---
        "candidato": _persona_dict(c),
    }

    if not detalle:
        return base

    return {
        **base,
        **_sintesis_global(p),
        "cvDatos": c.cv_datos or {},
        "analisis": p.analisis or {},
        "listaArchivos": [archivo_dict(a) for a in c.archivos],
        "vacante": {
            "id": v.codigo,
            "titulo": v.titulo,
            "requisitos": v.requisitos,
            "preguntas": texto_preguntas(v.preguntas_filtro),
        }
        if v
        else None,
        "entrevistas": [
            {
                "id": e.codigo,
                "estado": e.estado,
                "tipo": e.tipo,
                "token": e.token,
                "evaluacion": e.evaluacion or None,
                "creada": hace(e.creada_en),
            }
            for e in p.entrevistas
        ],
        "consentimientoFecha": iso(p.consentimiento_fecha),
        # Otras postulaciones de la misma persona (más reciente primero) — pestaña Resumen.
        "historialPostulaciones": [_postulacion_resumen_dict(hp) for hp in reversed(c.postulaciones) if hp.id != p.id],
    }


def candidato_dict(c: Candidato, detalle: bool = False) -> dict:
    """Ficha de PERSONA. Fase 2: ya no es la tarjeta del Kanban (eso es postulacion_dict);
    se usa donde se habla de la persona en sí (dedup, historial). `postulaciones` trae el
    resumen de todas sus aplicaciones."""
    base = _persona_dict(c)
    base["postulaciones"] = [_postulacion_resumen_dict(p) for p in reversed(c.postulaciones)]
    if not detalle:
        return base
    return {**base, "cvDatos": c.cv_datos or {}, "listaArchivos": [archivo_dict(a) for a in c.archivos]}


# ------------------------------------------------------------
# Módulo 1 · Entrevistas
# ------------------------------------------------------------


def entrevista_dict(e: Entrevista) -> dict:
    p = e.postulacion
    c = e.candidato
    vac = p.vacante if p else None
    return {
        "id": e.codigo,
        # `candidatoId` es lo que el frontend manda a /candidatos/{codigo}: la Postulación.
        "candidatoId": p.codigo if p else (c.codigo if c else ""),
        "postulacionId": p.codigo if p else None,
        "candidatoCodigo": c.codigo if c else "",
        "nombre": c.nombre if c else "",
        "puesto": vac.titulo if vac else "",
        "tipo": e.tipo,
        "estado": e.estado,
        "token": e.token,
        "consentimiento": e.consentimiento,
        "programada": iso(e.programada_para),
        "creada": hace(e.creada_en),
        "guion": e.guion or {},
        "mensajes": len(e.transcript or []),
        "turnosCandidato": sum(1 for m in (e.transcript or []) if m.get("rol") == "user"),
        "evaluacion": e.evaluacion or None,
        # Fase 4: cómo cerró y cuándo; intentos previos si RH la reabrió.
        "cierre": e.cierre or "",
        "iniciadaEn": iso(e.iniciada_en),
        "finalizadaEn": iso(e.finalizada_en),
        "intentosPrevios": len(e.intentos_previos or []),
        "tono": (c.id if c else 0) % 4,
        "ligaMeet": e.liga_meet or "",
    }


# ------------------------------------------------------------
# Capacitación (Fase 1)
# ------------------------------------------------------------


def curso_dict(c: Curso, detalle: bool = False) -> dict:
    base = {
        "id": c.codigo,
        "titulo": c.titulo,
        "categoria": c.categoria,
        "duracionHoras": c.duracion_horas,
        "objetivo": c.objetivo,
        "estado": c.estado,
        "obligatorio": c.obligatorio,
        "creadoPor": c.creado_por,
        "creado": hace(c.creado_en),
        "modulos": len(c.modulos),
        "asignados": len(c.asignaciones),
        "completados": sum(1 for a in c.asignaciones if a.estado == "completado"),
    }
    if detalle:
        base["listaModulos"] = [
            {
                "orden": m.orden,
                "titulo": m.titulo,
                "contenido": m.contenido,
                "preguntasVerificacion": m.preguntas_verificacion or [],
            }
            for m in sorted(c.modulos, key=lambda m: m.orden)
        ]
    return base


def asignacion_dict(a: AsignacionCurso) -> dict:
    col = a.colaborador
    return {
        "id": a.codigo,
        "cursoId": a.curso.codigo if a.curso else "",
        "colaboradorId": col.codigo if col else "",
        "colaboradorNombre": col.nombre if col else "",
        "estado": a.estado,
        "moduloActual": a.modulo_actual,
        "asignado": hace(a.asignado_en),
        "completado": iso(a.completado_en),
        "token": a.token,
    }


def asignacion_publica_dict(a: AsignacionCurso) -> dict:
    """Forma que consume la sala pública (Fase 2) — a diferencia de `asignacion_dict`, nunca
    expone `contenido`/`preguntasVerificacion` de módulos que la persona todavía no alcanza."""
    curso = a.curso
    modulos = sorted(curso.modulos, key=lambda m: m.orden) if curso else []
    total = len(modulos)
    salida_modulos = []
    for i, m in enumerate(modulos):
        item = {"orden": m.orden, "titulo": m.titulo, "completado": i < a.modulo_actual}
        if i <= a.modulo_actual:  # módulo actual y anteriores: sí traen contenido
            item["contenido"] = m.contenido
            item["preguntasVerificacion"] = m.preguntas_verificacion or []
        salida_modulos.append(item)
    return {
        "colaborador": a.colaborador.nombre if a.colaborador else "",
        "curso": curso.titulo if curso else "",
        "empresa": "Red Human",
        "estado": a.estado,
        "moduloActual": min(a.modulo_actual + 1, total) if total else 0,
        "totalModulos": total,
        "avatarDisponible": avatar_activo(),
        "modulos": salida_modulos,
        "resultadoEvaluacion": a.resultado_evaluacion or None,
    }


# ------------------------------------------------------------
# Módulo 2 · Contratación e integración
# ------------------------------------------------------------


def documento_dict(d: Documento) -> dict:
    v = d.validacion or {}
    return {
        "nombre": d.tipo,
        "estado": d.estado,  # pendiente | revision | recibido | rechazado
        "obligatorio": d.obligatorio,
        "notas": d.notas_ia or "",
        "archivo": d.nombre_archivo or "",
        "tieneArchivo": bool(d.archivo),
        "mime": d.mime or "",
        "tamano": d.tamano or 0,
        "subido": hace(d.subido_en) if d.subido_en else "",
        "revisadoPor": d.revisado_por or "",
        "validacion": {
            "tipoDetectado": v.get("tipo_detectado"),
            "coincideTipo": v.get("coincide_tipo"),
            "legible": v.get("legible"),
            "completo": v.get("completo"),
            "vigente": v.get("vigente"),
            "coincideTitular": v.get("coincide_titular"),
            "motivoRechazo": v.get("motivo_rechazo"),
        }
        if v
        else None,
    }


def expediente_dict(e: Expediente) -> dict:
    p = e.postulacion
    c = e.candidato
    vac = p.vacante if p else None
    ultima = p.entrevistas[-1] if p and p.entrevistas else None
    score = p.score if p else 0
    analisis = (p.analisis if p else None) or {}
    evidencia = p.evidencia if p else ""
    # 'alta' es el único estado que persiste; el resto se deriva del avance real de los documentos
    estado = "alta" if e.estado == "alta" else ("completo" if e.progreso == 100 else "integracion")
    # documentos que la IA aprobó pero que nadie de RH ha confirmado todavía (bloquean el alta)
    sin_confirmar = [d.tipo for d in e.obligatorios if d.estado == "recibido" and not d.revisado_por]
    return {
        "id": f"N-{500 + e.id}",
        "expedienteId": e.id,
        "postulacionId": p.codigo if p else None,
        "nombre": c.nombre if c else "",
        "puesto": e.puesto,
        "ubicacion": (c.ubicacion if c else "") or "N/D",
        "ingreso": f"Ingresa el {fecha_corta(e.fecha_ingreso)}" if e.fecha_ingreso else "Fecha por definir",
        "fechaIngreso": iso(e.fecha_ingreso),
        # --- condiciones finales de contratación (formulario de la etapa Contratación) ---
        "sueldo": e.sueldo,
        "tipoContratacion": e.tipo_contratacion,
        "ubicacionTrabajo": e.ubicacion,
        "jefeDirecto": e.jefe_directo,
        # --- preparación de ingreso (Onboarding, bloque 4) ---
        "contrato": e.contrato,
        "altaAdministrativa": e.alta_administrativa,
        "equipoAccesos": e.equipo_accesos,
        "progreso": e.progreso,
        "tono": (e.id or 0) % 4,
        "estado": estado,
        "documentos": [documento_dict(d) for d in e.documentos],
        "pendientes": e.pendientes,
        "porRevisar": e.por_revisar,
        "sinConfirmar": sin_confirmar,
        "listoParaAlta": estado == "completo" and not sin_confirmar,
        # --- puentes hacia el módulo 1 (candidatoId = Postulación: es lo que /candidatos/{codigo} espera) ---
        "candidatoId": p.codigo if p else (c.codigo if c else ""),
        "candidatoCodigo": c.codigo if c else "",
        "telefono": c.telefono if c else "",
        "correo": c.correo if c else "",
        "vacanteId": vac.codigo if vac else "",
        "score": score,
        "entrevistaMatch": (ultima.evaluacion or {}).get("match_perfil") if ultima else None,
        "entrevistaRecomendacion": (ultima.evaluacion or {}).get("recomendacion") if ultima else None,
        # --- Bloque 2 (resumen de evaluación): lo que ya sabemos del candidato sin ir a buscarlo aparte ---
        "evaluacion": {
            "score": score,
            "requisitosCumplidos": analisis.get("requisitos_cumplidos", []),
            "brechas": analisis.get("brechas", []),
            "alertas": analisis.get("alertas", []),
            "evidencia": evidencia,
        }
        if c
        else None,
        # --- trazabilidad HITL ---
        "seleccionadoPor": e.seleccionado_por or "",
        "altaAutorizadaPor": e.alta_autorizada_por or "",
        "altaFecha": iso(e.alta_fecha),
        "creado": hace(e.creado_en),
    }


# ------------------------------------------------------------
# Colaboradores (alta al cierre del Onboarding)
# ------------------------------------------------------------


def colaborador_dict(col: Colaborador) -> dict:
    return {
        "id": col.codigo,
        "nombre": col.nombre,
        "correo": col.correo,
        "telefono": col.telefono,
        "puesto": col.puesto,
        "salario": col.salario,
        "empresa": col.empresa,
        "ubicacion": col.ubicacion,
        "jefeDirecto": col.jefe_directo,
        "estatus": "Activo" if col.activo else "Inactivo",
        "cvNombre": col.cv_nombre,
        "tieneCv": bool(col.cv_ruta),
        "fechaIngreso": iso(col.fecha_ingreso),
        "activo": col.activo,
        "dadoDeAltaPor": col.dado_de_alta_por,
        "candidatoOrigenId": col.candidato_origen.codigo if col.candidato_origen else None,
        "expedienteId": col.expediente_id,
        "creado": hace(col.creado_en),
    }
