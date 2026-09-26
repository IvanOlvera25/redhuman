"""Da acceso a la Cuenta demo «Agencia de talento» ÚNICAMENTE a it.licenses@carbe.mx — 2026-09-26.

Crea el vínculo en `usuario_cuentas` (lo que usa `deps.cuenta_actual` para decidir qué Cuentas ve un
usuario) y se asegura de que el usuario tenga rol «Administrador». El rol vive en `Usuario.rol` (es por
usuario, no por vínculo): si ya lo es, no se toca. No crea usuarios, no cambia contraseñas y no toca los
accesos de nadie más (Raúl y los demás siguen aislados en su Cuenta).

La Cuenta se busca por su slug de ambiente demo (`demo-agencia-de-talento`), no por id fijo, para no
vincular por error otra Cuenta si los ids difieren entre bases; el id encontrado se imprime.

Idempotente. Dry-run por defecto; `--aplicar` escribe.

Uso (desde red-human-api/):
    .venv/Scripts/python.exe scripts/dar_acceso_agencia_it.py             # muestra qué haría
    .venv/Scripts/python.exe scripts/dar_acceso_agencia_it.py --aplicar   # aplica
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.models import Cuenta, Usuario, UsuarioCuenta, registrar  # noqa: E402

CORREO = "it.licenses@carbe.mx"
SLUG_CUENTA = "demo-agencia-de-talento"
NOMBRE_CUENTA = "Agencia de talento"


def main() -> int:
    ap = argparse.ArgumentParser(description=f"Vincula a {CORREO} con la Cuenta «{NOMBRE_CUENTA}».")
    ap.add_argument("--aplicar", action="store_true", help="escribe los cambios (sin esto solo muestra qué haría)")
    args = ap.parse_args()

    print(f"Base: {engine.url.render_as_string(hide_password=True)}")
    db = SessionLocal()
    try:
        u = db.query(Usuario).filter(func.lower(Usuario.correo) == CORREO).first()
        if u is None:
            print(f"✗ No existe el usuario {CORREO}. No se crea nada.")
            return 1
        cuenta = db.query(Cuenta).filter(Cuenta.slug == SLUG_CUENTA).first()
        if cuenta is None or cuenta.nombre != NOMBRE_CUENTA:
            print(f"✗ No encontré la Cuenta demo «{NOMBRE_CUENTA}» (slug {SLUG_CUENTA}). ¿Ya corrió cargar_ambiente_demo.py?")
            return 1
        if cuenta.estado != "Activa":
            print(f"✗ La Cuenta «{cuenta.nombre}» (id {cuenta.id}) está «{cuenta.estado}»: el usuario no la vería.")
            return 1
        print(f"Usuario: {u.nombre} <{u.correo}> (id {u.id}, rol {u.rol})")
        print(f"Cuenta:  {cuenta.nombre} (id {cuenta.id})")

        otros_antes = db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id != u.id).count()
        ya = db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id == u.id, UsuarioCuenta.cuenta_id == cuenta.id).first()
        cambios = []
        if ya is None:
            db.add(UsuarioCuenta(usuario_id=u.id, cuenta_id=cuenta.id))
            cambios.append(f"vínculo nuevo con la Cuenta id {cuenta.id}")
        if u.rol != "Administrador":
            cambios.append(f"rol {u.rol} → Administrador")
            u.rol = "Administrador"
        db.flush()

        otros_despues = db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id != u.id).count()
        if otros_antes != otros_despues:  # garantía: nadie más cambia
            print("✗ Cambiaron vínculos de otros usuarios; se cancela.")
            db.rollback()
            return 1

        if not cambios:
            print("✓ Ya tenía el acceso y el rol. Nada que hacer.")
            db.rollback()
            return 0
        print("Cambios: " + "; ".join(cambios))
        if not args.aplicar:
            db.rollback()
            print("(dry-run) No se escribió nada. Vuelve a correr con --aplicar.")
            return 0

        registrar(db, "script:dar_acceso_agencia_it", "acceso_cuenta_otorgado", "usuario", str(u.id), {
            "correo": u.correo, "cuenta_id": cuenta.id, "cuenta": cuenta.nombre, "cambios": cambios,
        })
        db.commit()
        cuentas = [c for (c,) in db.query(Cuenta.nombre).join(UsuarioCuenta, UsuarioCuenta.cuenta_id == Cuenta.id)
                   .filter(UsuarioCuenta.usuario_id == u.id).order_by(Cuenta.id).all()]
        print(f"✓ Listo. {u.correo} ahora ve: {', '.join(cuentas)}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
