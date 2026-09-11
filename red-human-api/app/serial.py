"""Serializadores → formas exactas que consume el frontend (lib/data.ts / lib/phase2.ts)."""

from datetime import datetime, timezone
from typing import List, Optional

from .models import AsignacionCurso, Archivo, Candidato, Colaborador, Curso, Documento, Entrevista, Expediente, Vacante
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


def nombre_empresa_candidato(v: Vacante) -> str:
    """Nombre de empresa que debe ver el candidato (Fase B, punto 10): el Cliente real solo si
    hay uno asignado y `mostrar_cliente_candidato` está activo; si no, el nombre comercial de la
    Cuenta — nunca el texto libre `empresa` salvo que la vacante no tenga Cuenta (no debería
    pasar tras la migración de Fase A, es solo un respaldo defensivo)."""
    if v.cliente_id and v.mostrar_cliente_candidato and v.cliente:
        return v.cliente.nombre
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
        "responsable": v.responsable.nombre if v.responsable else None,
        "colaboradores": colaboradores or [],
        "mostrarClienteCandidato": v.mostrar_cliente_candidato,
        # nombre que ve el candidato — RH siempre ve la relación real arriba, sin importar el flag
        "nombreEmpresa": nombre_empresa_candidato(v),
        "ubicacion": v.ubicacion,
        "modalidad": v.modalidad,
        "sueldo": v.sueldo,
        "estado": v.estado,
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


def _sintesis_global(c: Candidato) -> dict:
    """Puntos 3 (D/E/F/G) y 5: combina CV + Prefiltro + Entrevista IA + Entrevista Humana en
    una sola síntesis — determinista, SIN llamada a IA nueva (decisión confirmada). Se calcula
    al vuelo en cada lectura, nunca se persiste: así "recalcular cuando el CV se carga después"
    se cumple gratis, sin enganchar este cálculo en cada punto de mutación."""
    a = c.analisis or {}
    ultima_eh = c.entrevistas_humanas[-1] if c.entrevistas_humanas else None
    ultima_ent = c.entrevistas[-1] if c.entrevistas else None
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
    if c.score:
        afinidad = c.score
        fuentes.append(f"CV/Prefiltro: {c.score}/100 de ajuste")
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
    if c.resultado_apto is False:
        recomendacion = "No avanzar"
        motivo = "El resultado más reciente del proceso marca al candidato como no apto."
    elif ultima_eh and ultima_eh.recomendacion == "no_avanzar":
        recomendacion = "No avanzar"
        motivo = "El entrevistador humano recomendó no avanzar."
    elif c.resultado_apto is True and ultima_eh and ultima_eh.resultado == "aprobado" and ultima_eh.recomendacion == "avanzar":
        recomendacion = "Avanzar a contratación"
        motivo = "La Entrevista Humana confirmó al candidato como aprobado, con recomendación de avanzar."
    elif c.resultado_apto is True:
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


def candidato_dict(c: Candidato, detalle: bool = False) -> dict:
    exp = c.expediente
    ultima = c.entrevistas[-1] if c.entrevistas else None
    ultima_eh = c.entrevistas_humanas[-1] if c.entrevistas_humanas else None
    base = {
        "id": c.codigo,
        "nombre": c.nombre,
        "puesto": c.vacante.titulo if c.vacante else "",
        "vacanteId": c.vacante.codigo if c.vacante else "",
        "fuente": c.fuente,
        "estado": c.estado,
        "etapa": c.etapa,
        "score": c.score,
        "experiencia": c.experiencia or "",
        "ubicacion": c.ubicacion or "",
        "aplicado": hace(c.creado_en),
        "tono": (c.id or 0) % 4,
        "evidencia": c.evidencia or "Prefiltro en curso.",
        "telefono": c.telefono,
        "correo": c.correo,
        "consentimiento": c.consentimiento,
        "prefiltroCompleto": c.prefiltro_completo,
        "esPrueba": c.es_prueba,
        # --- Entrevista Humana (flujo manual) — puede haber varias rondas, ver EntrevistaHumana.
        # "entrevistaHumana" es la más reciente (compatibilidad con lo que ya lee el frontend);
        # "entrevistasHumanas" es el historial completo, más reciente primero.
        "entrevistaHumana": _entrevista_humana_dict(ultima_eh) if ultima_eh else None,
        "entrevistasHumanas": [_entrevista_humana_dict(eh) for eh in reversed(c.entrevistas_humanas)],
        # --- puentes entre módulos ---
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
        "entrevistaId": ultima.codigo if ultima else None,
        "entrevistaEstado": ultima.estado if ultima else None,
        "entrevistaMatch": (ultima.evaluacion or {}).get("match_perfil") if ultima else None,
        "entrevistaRecomendacion": (ultima.evaluacion or {}).get("recomendacion") if ultima else None,
        "archivos": len(c.archivos),
        "mensajes": len(c.mensajes),
        # --- Fase C: actividad, resultado vigente y cliente de la vacante ---
        # ultima_actividad_en: None para candidatos previos al deploy de Fase C hasta que se ejecute
        # el script backfill_resultado_apto.py (o hasta su próximo evento de actividad).
        "ultimaActividadEn": iso(c.ultima_actividad_en),
        # resultado_apto: True=Apto, False=No apto, None=sin evaluación. La regla "el más reciente gana"
        # se aplica en _recalcular_resultado_apto() dentro de routers/candidatos.py.
        "resultadoApto": c.resultado_apto,
        # clienteVacante: nombre del Cliente de la vacante del candidato, si aplica — permite mostrar
        # la columna Cliente en la vista lista de candidatos sin JOIN extra desde el frontend.
        "clienteVacante": c.vacante.cliente.nombre if c.vacante and c.vacante.cliente else None,
    }
    if not detalle:
        return base

    return {
        **base,
        **_sintesis_global(c),
        "cvDatos": c.cv_datos or {},
        "analisis": c.analisis or {},
        "listaArchivos": [archivo_dict(a) for a in c.archivos],
        "vacante": {
            "id": c.vacante.codigo,
            "titulo": c.vacante.titulo,
            "requisitos": c.vacante.requisitos,
            "preguntas": texto_preguntas(c.vacante.preguntas_filtro),
        }
        if c.vacante
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
            for e in c.entrevistas
        ],
        "consentimientoFecha": iso(c.consentimiento_fecha),
    }


# ------------------------------------------------------------
# Módulo 1 · Entrevistas
# ------------------------------------------------------------


def entrevista_dict(e: Entrevista) -> dict:
    c = e.candidato
    return {
        "id": e.codigo,
        "candidatoId": c.codigo if c else "",
        "nombre": c.nombre if c else "",
        "puesto": c.vacante.titulo if c and c.vacante else "",
        "tipo": e.tipo,
        "estado": e.estado,
        "token": e.token,
        "consentimiento": e.consentimiento,
        "programada": iso(e.programada_para),
        "creada": hace(e.creada_en),
        "guion": e.guion or {},
        "mensajes": len(e.transcript or []),
        "evaluacion": e.evaluacion or None,
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
    c = e.candidato
    vac = c.vacante if c else None
    ultima = c.entrevistas[-1] if c and c.entrevistas else None
    # 'alta' es el único estado que persiste; el resto se deriva del avance real de los documentos
    estado = "alta" if e.estado == "alta" else ("completo" if e.progreso == 100 else "integracion")
    # documentos que la IA aprobó pero que nadie de RH ha confirmado todavía (bloquean el alta)
    sin_confirmar = [d.tipo for d in e.obligatorios if d.estado == "recibido" and not d.revisado_por]
    return {
        "id": f"N-{500 + e.id}",
        "expedienteId": e.id,
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
        # --- puentes hacia el módulo 1 ---
        "candidatoId": c.codigo if c else "",
        "telefono": c.telefono if c else "",
        "correo": c.correo if c else "",
        "vacanteId": vac.codigo if vac else "",
        "score": c.score if c else 0,
        "entrevistaMatch": (ultima.evaluacion or {}).get("match_perfil") if ultima else None,
        "entrevistaRecomendacion": (ultima.evaluacion or {}).get("recomendacion") if ultima else None,
        # --- Bloque 2 (resumen de evaluación): lo que ya sabemos del candidato sin ir a buscarlo aparte ---
        "evaluacion": {
            "score": c.score,
            "requisitosCumplidos": (c.analisis or {}).get("requisitos_cumplidos", []),
            "brechas": (c.analisis or {}).get("brechas", []),
            "alertas": (c.analisis or {}).get("alertas", []),
            "evidencia": c.evidencia or "",
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
