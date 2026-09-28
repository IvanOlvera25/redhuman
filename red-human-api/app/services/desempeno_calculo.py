"""Motor de cálculo de Desempeño v2 (2026-09-27) — ÚNICA fuente de calificaciones, estados y avance.

Criterio (en `CicloDesempeno.criterios`, ajustable por persona en `EvaluacionDesempeno.ajustes`):
    {id, tipo: medible|descriptivo, nombre, descripcion, peso,
     # medible:     unidad, meta, sentido: mayor_es_mejor|menor_es_mejor, formula
     # descriptivo: esperado (qué se espera observar), escala: [{valor 1-5, significado}]}
Resultado por persona (en `EvaluacionDesempeno.resultados`):
    {criterio_id, real, valoracion, no_aplica, motivo_no_aplica, comentario}

Reglas (decisiones del usuario):
  * Cumplimiento medible con TOPE 100 %: mayor es mejor = real ÷ meta; menor es mejor = meta ÷ real.
  * Descriptivo 1-5 lineal: 1 = 0 %, 2 = 25 %, 3 = 50 %, 4 = 75 %, 5 = 100 %.
  * Solo cuentan resultados VÁLIDOS: un real vacío, una meta vacía o un criterio sin valoración NO es cero —
    simplemente no tiene cumplimiento. «No aplica» exige motivo y sale del promedio.
  * Calificación = promedio ponderado de los criterios con cumplimiento (pesos iguales salvo «Personalizar
    pesos»; los pesos se renormalizan entre los criterios válidos). Sin ninguno válido: None («—»).
  * Estado por persona: Pendiente (nada válido) → En proceso (captura parcial) → Completada (solo con
    `completar` y todos los criterios aplicables con resultado; ver `faltantes`).
  * Avance de la evaluación = personas completadas ÷ personas incluidas.

Datos previos a v2 (objetivos/kpis con `logro`) se convierten al leer: objetivo → descriptivo, KPI →
medible, y un `logro` capturado se respeta tal cual como cumplimiento.
"""

from typing import Dict, List, Optional

from ..models import ESCALA_DESCRIPTIVA_DEFAULT, normalizar_estado_persona


def _num(v) -> Optional[float]:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------
# Criterios
# ------------------------------------------------------------


def _criterios_legado(ciclo) -> List[dict]:
    salida = []
    for i, o in enumerate(ciclo.objetivos or [], start=1):
        salida.append({
            "id": f"o{i}", "tipo": "descriptivo", "nombre": o.get("titulo") or o.get("nombre") or f"Objetivo {i}",
            "descripcion": o.get("descripcion") or "", "esperado": o.get("descripcion") or "",
            "escala": ESCALA_DESCRIPTIVA_DEFAULT, "peso": o.get("peso"), "legado": True,
        })
    for i, k in enumerate(ciclo.kpis or [], start=1):
        salida.append({
            "id": f"k{i}", "tipo": "medible", "nombre": k.get("nombre") or f"KPI {i}", "descripcion": k.get("descripcion") or "",
            "unidad": k.get("unidad") or "", "meta": k.get("meta"), "sentido": "mayor_es_mejor", "formula": "",
            "peso": k.get("peso"), "legado": True,
        })
    return salida


def criterios_de(ciclo) -> List[dict]:
    """Criterios de la evaluación general (v2, o convertidos desde objetivos/kpis de antes)."""
    return list(ciclo.criterios or []) or _criterios_legado(ciclo)


def criterios_efectivos(e) -> List[dict]:
    """Criterios de UNA persona: los de la evaluación con sus ajustes individuales encima (marcados)."""
    ajustes = e.ajustes or {}
    salida = []
    for c in criterios_de(e.ciclo):
        a = ajustes.get(c["id"])
        if a:
            c = {**c, **{k: v for k, v in a.items() if k != "motivo"}, "ajustado": True, "motivo_ajuste": a.get("motivo", "")}
        salida.append(c)
    return salida


def usa_pesos(ciclo) -> bool:
    """«Personalizar pesos» activo; las evaluaciones previas a v2 que capturaron pesos los conservan."""
    if ciclo is None:
        return False
    if ciclo.pesos_personalizados:
        return True
    return not ciclo.criterios and any(_num(c.get("peso")) for c in (ciclo.objetivos or []) + (ciclo.kpis or []))


def pesos(criterios: List[dict], personalizados: bool) -> Dict[str, float]:
    if personalizados:
        return {c["id"]: float(_num(c.get("peso")) or 0) for c in criterios}
    return {c["id"]: 1.0 for c in criterios}


def validar_pesos(criterios: List[dict], personalizados: bool) -> Optional[str]:
    """Con «Personalizar pesos» todos deben tener peso y sumar exactamente 100 % (antes de iniciar)."""
    if not personalizados:
        return None
    total = sum(float(_num(c.get("peso")) or 0) for c in criterios)
    if any(_num(c.get("peso")) is None for c in criterios):
        return "Con pesos personalizados, cada criterio necesita su peso."
    if abs(total - 100) > 0.01:
        return f"Los pesos personalizados deben sumar 100 % (hoy suman {round(total, 2)} %)."
    return None


# ------------------------------------------------------------
# Resultados
# ------------------------------------------------------------


def _resultados_por_criterio(e, criterios: List[dict]) -> Dict[str, dict]:
    """{criterio_id: resultado}. Filas previas a v2 (sin criterio_id) se emparejan por nombre."""
    por_nombre = {c["nombre"].strip().lower(): c["id"] for c in criterios}
    salida = {}
    for r in e.resultados or []:
        cid = r.get("criterio_id")
        if not cid:
            cid = por_nombre.get(str(r.get("nombre") or "").strip().lower())
        if cid:
            salida[cid] = r
    return salida


def cumplimiento(criterio: dict, r: Optional[dict]) -> Optional[float]:
    """% de cumplimiento 0-100 de un criterio, o None si no hay un resultado VÁLIDO (vacío ≠ cero)."""
    if not r or r.get("no_aplica"):
        return None
    if r.get("logro") is not None and not r.get("criterio_id"):  # legado: logro capturado a mano
        v = _num(r.get("logro"))
        return None if v is None else max(0.0, min(100.0, v))
    if criterio.get("tipo") == "descriptivo":
        v = _num(r.get("valoracion"))
        if v is None or not 1 <= v <= 5:
            return None
        return (v - 1) / 4 * 100
    real, meta = _num(r.get("real")), _num(criterio.get("meta"))
    if real is None or meta is None:
        return None
    if criterio.get("sentido") == "menor_es_mejor":
        if real <= 0:
            return 100.0
        return max(0.0, min(100.0, meta / real * 100))
    if meta <= 0:
        return 100.0 if real >= meta else 0.0
    return max(0.0, min(100.0, real / meta * 100))


def calcular(e) -> dict:
    """Detalle por criterio, calificación ponderada (None sin resultados válidos) y qué falta para completar."""
    criterios = criterios_efectivos(e)
    res = _resultados_por_criterio(e, criterios)
    w = pesos(criterios, usa_pesos(e.ciclo))
    detalle, faltantes, suma, peso_total, validos = [], [], 0.0, 0.0, 0
    for c in criterios:
        r = res.get(c["id"])
        no_aplica = bool(r and r.get("no_aplica"))
        valor = cumplimiento(c, r)
        if no_aplica and not str((r or {}).get("motivo_no_aplica") or "").strip():
            faltantes.append(f"«{c['nombre']}»: «No aplica» necesita un motivo.")
        elif not no_aplica and valor is None:
            if c.get("tipo") == "medible" and _num(c.get("meta")) is None:
                faltantes.append(f"«{c['nombre']}»: no tiene meta; captúrala (ajuste individual) o márcalo como «No aplica».")
            else:
                faltantes.append(f"«{c['nombre']}»: falta {'la valoración' if c.get('tipo') == 'descriptivo' else 'el resultado real'}.")
        if valor is not None:
            validos += 1
            suma += valor * w.get(c["id"], 0)
            peso_total += w.get(c["id"], 0)
        detalle.append({"criterio_id": c["id"], "cumplimiento": None if valor is None else round(valor, 1), "no_aplica": no_aplica})
    calificacion = round(suma / peso_total, 1) if peso_total > 0 else None
    return {"calificacion": calificacion, "detalle": detalle, "faltantes": faltantes, "validos": validos,
            "aplicables": sum(1 for d in detalle if not d["no_aplica"])}


def estado_persona(e, calculo: Optional[dict] = None) -> str:
    """Completada solo si ya se completó explícitamente; si no, En proceso con cualquier resultado válido
    (o «No aplica» registrado), Pendiente sin nada. Nunca «completada» por tener filas vacías."""
    if normalizar_estado_persona(e.estado) == "completada":
        return "completada"
    calculo = calculo or calcular(e)
    hay_algo = calculo["validos"] > 0 or any(d["no_aplica"] for d in calculo["detalle"])
    return "en_proceso" if hay_algo else "pendiente"


def incluidas(ciclo) -> list:
    return [e for e in ciclo.evaluaciones if e.colaborador and e.colaborador.eliminado_en is None]


def avance(ciclo) -> dict:
    evs = incluidas(ciclo)
    completadas = [e for e in evs if normalizar_estado_persona(e.estado) == "completada"]
    return {
        "incluidas": len(evs),
        "completadas": len(completadas),
        "porcentaje": round(len(completadas) / len(evs) * 100) if evs else 0,
    }


# ------------------------------------------------------------
# Normalización de criterios (captura de RH, IA, plantillas e importación)
# ------------------------------------------------------------


class CriterioInvalido(ValueError):
    pass


def normalizar_criterios(criterios: List[dict]) -> List[dict]:
    """Deja cada criterio con id estable, tipo válido y SOLO los campos de su tipo. Nunca inventa metas:
    una meta vacía queda en None (el criterio no se puede calificar hasta que alguien la capture)."""
    from ..models import SENTIDOS_INDICADOR, TIPOS_CRITERIO_DESEMPENO

    usados = {str(c.get("id")) for c in criterios or [] if c.get("id")}
    salida = []
    for i, c in enumerate(criterios or [], start=1):
        nombre = str(c.get("nombre") or c.get("titulo") or "").strip()
        if not nombre:
            continue
        tipo = str(c.get("tipo") or "descriptivo").strip().lower()
        if tipo not in TIPOS_CRITERIO_DESEMPENO:
            raise CriterioInvalido(f"Tipo de criterio inválido «{tipo}» en «{nombre}». Usa medible o descriptivo.")
        cid = str(c.get("id") or "")
        if not cid:
            cid = f"c{i}"
            n = i
            while cid in usados:
                n += 1
                cid = f"c{n}"
            usados.add(cid)
        peso = _num(c.get("peso"))
        fila = {"id": cid, "tipo": tipo, "nombre": nombre, "descripcion": str(c.get("descripcion") or "").strip(), "peso": peso}
        if tipo == "medible":
            sentido = str(c.get("sentido") or "mayor_es_mejor").strip()
            if sentido not in SENTIDOS_INDICADOR:
                raise CriterioInvalido(f"Sentido inválido en «{nombre}». Usa mayor_es_mejor o menor_es_mejor.")
            fila.update({
                "unidad": str(c.get("unidad") or "").strip(),
                "meta": _num(c.get("meta")),
                "sentido": sentido,
                "formula": str(c.get("formula") or "").strip()
                or ("Real ÷ Meta × 100 (tope 100 %)" if sentido == "mayor_es_mejor" else "Meta ÷ Real × 100 (tope 100 %)"),
            })
        else:
            escala = []
            for n in c.get("escala") or []:
                v = _num(n.get("valor"))
                if v is not None and 1 <= v <= 5:
                    escala.append({"valor": int(v), "significado": str(n.get("significado") or "").strip()})
            fila.update({
                "esperado": str(c.get("esperado") or c.get("descripcion") or "").strip(),
                "escala": sorted(escala, key=lambda x: x["valor"]) if len(escala) == 5 else ESCALA_DESCRIPTIVA_DEFAULT,
            })
        salida.append(fila)
    if len({c["id"] for c in salida}) != len(salida):
        raise CriterioInvalido("Hay criterios con el mismo id.")
    return salida
