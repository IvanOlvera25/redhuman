"""Consulta automática de resultados de pruebas conectadas a un proveedor (2026-10-04, cambios de pruebas psicométricas §5).

El webhook de Psicométricas.mx se registra UNA vez por cuenta del proveedor (hoy apunta al servidor de producción), así
que cada ambiente también pregunta por su cuenta: cada 10 minutos revisa las evaluaciones con clave del proveedor que
siguen en curso y, si el proveedor confirma que terminaron, guarda el resultado y el informe (`sincronizar_psicometricas`,
idempotente). Un error del proveedor nunca tumba el job.
"""

from ..database import SessionLocal


async def revisar_resultados_psicometria() -> int:
    from ..models import EvaluacionCandidato, registrar
    from . import evaluaciones as sev
    from . import psicometricas as psi

    if not psi.configurado():
        return 0
    db = SessionLocal()
    n = 0
    try:
        pendientes = (
            db.query(EvaluacionCandidato)
            .filter(EvaluacionCandidato.clave_proveedor != "", EvaluacionCandidato.estado.in_(("pendiente", "en_proceso")))
            .order_by(EvaluacionCandidato.id)
            .limit(50)
            .all()
        )
        for ev in pendientes:
            try:
                r = sev.sincronizar_psicometricas(db, ev, por="Psicométricas.mx (consulta automática)")
            except psi.PsicometricasError as ex:
                print(f"[psicometria] {ev.codigo}: {ex}", flush=True)
                continue
            if r == "resultado_recibido":
                registrar(db, "sistema", "evaluacion_resultado_automatico", "evaluaciones", ev.codigo, {"proveedor": ev.proveedor})
                db.commit()
                n += 1
        return n
    except Exception as ex:  # noqa: BLE001
        print(f"[psicometria] consulta automática falló: {ex}", flush=True)
        db.rollback()
        return n
    finally:
        db.close()
