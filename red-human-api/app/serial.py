"""Serializadores → formas exactas que consume el frontend (lib/data.ts / lib/phase2.ts)."""

from datetime import datetime, timezone
from typing import Optional

from .models import Archivo, Candidato, Colaborador, Documento, Entrevista, Expediente, Vacante
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


def vacante_dict(v: Vacante, n_candidatos: int = 0, n_nuevos: int = 0, embudo: Optional[dict] = None) -> dict:
    return {
        "id": v.codigo,
        "slug": v.slug or "",
        "titulo": v.titulo,
        "area": v.area,
        "empresa": v.empresa,
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


def candidato_dict(c: Candidato, detalle: bool = False) -> dict:
    exp = c.expediente
    ultima = c.entrevistas[-1] if c.entrevistas else None
    base = {
        "id": c.codigo,
        "nombre": c.nombre,
        "puesto": c.vacante.titulo if c.vacante else "",
        "vacanteId": c.vacante.codigo if c.vacante else "",
        "fuente": c.fuente,
        "estado": c.estado,
        "etapa": c.etapa,
        "score": c.score,
        "experiencia": c.experiencia or "N/D",
        "ubicacion": c.ubicacion or "N/D",
        "aplicado": hace(c.creado_en),
        "tono": (c.id or 0) % 4,
        "evidencia": c.evidencia or "Prefiltro en curso.",
        "telefono": c.telefono,
        "correo": c.correo,
        "consentimiento": c.consentimiento,
        "prefiltroCompleto": c.prefiltro_completo,
        # --- Entrevista Humana (flujo manual) ---
        "entrevistaHumana": {
            "entrevistador": c.entrevista_humana_entrevistador,
            "fecha": iso(c.entrevista_humana_fecha),
            "modalidad": c.entrevista_humana_modalidad,
            "comentario": c.entrevista_humana_comentario,
            "realizada": c.entrevista_humana_realizada,
        }
        if c.entrevista_humana_fecha
        else None,
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
    }
    if not detalle:
        return base

    return {
        **base,
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
