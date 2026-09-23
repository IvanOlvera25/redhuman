"""Alta (o actualización) de los administradores de plataforma de los directivos — 2026-09-23.

Crea los usuarios con rol «Administrador» y los vincula a TODAS las Cuentas activas, que es lo que da
acceso total: `deps.cuenta_actual` resuelve la Cuenta desde `usuario_cuentas`, así que un administrador
sin vinculaciones no vería ninguna empresa. Si el usuario ya existe, NO se duplica: se le restituye el
rol, se reactiva, se le pone la contraseña indicada y se completan las Cuentas que le falten.

Idempotente: se puede correr las veces que haga falta (por ejemplo, después de crear una Cuenta nueva,
para que los directivos la vean).

Uso (desde red-human-api/, con el .env de producción cargado):
    .venv/Scripts/python.exe scripts/crear_admins_directivos.py                 # dry-run: muestra qué haría
    .venv/Scripts/python.exe scripts/crear_admins_directivos.py --forzar        # aplica los cambios
    .venv/Scripts/python.exe scripts/crear_admins_directivos.py --forzar --exigir-cambio
        # …y además obliga a cambiar la contraseña en el primer ingreso (recomendado)

La contraseña sale de la variable de entorno RH_ADMIN_PASSWORD si está definida; si no, se usa la que
acordamos con los directivos. Nunca se guarda en claro: se cifra con `services.auth.hashear` (scrypt con
sal por usuario), el mismo hashing que usa el login.
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.orm import Session  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Cuenta, Usuario, UsuarioCuenta, registrar  # noqa: E402
from app.services import auth  # noqa: E402

PASSWORD = os.environ.get("RH_ADMIN_PASSWORD") or "Growtia2026"

DIRECTIVOS = [
    {"correo": "raul.carbajal@carbe.mx", "nombre": "Raul Federico Carbajal Bermúdez", "puesto": "Dirección"},
    {"correo": "eduardo.rodriguez@carbe.mx", "nombre": "Eduardo Enrique Rodriguez Ruíz", "puesto": "Dirección"},
]


def cuentas_activas(db: Session):
    return db.query(Cuenta).filter(Cuenta.estado == "Activa").order_by(Cuenta.id).all()


def aplicar(db: Session, datos: dict, cuentas, exigir_cambio: bool) -> dict:
    """Crea o actualiza UN directivo. Regresa el resumen de lo que se hizo (para el log y el dry-run)."""
    correo = datos["correo"].strip().lower()
    u = db.query(Usuario).filter(Usuario.correo == correo).first()
    accion = "actualizado" if u else "creado"

    if u is None:
        u = Usuario(
            correo=correo,
            nombre=datos["nombre"],
            puesto=datos["puesto"],
            rol="Administrador",
            hash_pass=auth.hashear(PASSWORD),
            activo=True,
            debe_cambiar_pass=exigir_cambio,
            ve_equipo=True,  # ve el trabajo de todo el equipo, no solo el propio
        )
        db.add(u)
        db.flush()
    else:
        u.nombre = datos["nombre"]
        u.puesto = u.puesto or datos["puesto"]
        u.rol = "Administrador"
        u.activo = True
        u.ve_equipo = True
        u.hash_pass = auth.hashear(PASSWORD)
        u.debe_cambiar_pass = exigir_cambio
        # si estaba bloqueado por intentos fallidos, se libera
        u.intentos_fallidos = 0
        u.bloqueado_hasta = None

    # Acceso a TODAS las empresas: una fila en usuario_cuentas por Cuenta activa.
    ya = {uc.cuenta_id for uc in db.query(UsuarioCuenta).filter(UsuarioCuenta.usuario_id == u.id).all()}
    nuevas = [c for c in cuentas if c.id not in ya]
    for c in nuevas:
        db.add(UsuarioCuenta(usuario_id=u.id, cuenta_id=c.id))
    if u.cuenta_predeterminada_id is None and cuentas:
        u.cuenta_predeterminada_id = cuentas[0].id

    registrar(
        db, "sistema", "usuario_creado" if accion == "creado" else "usuario_actualizado", "usuario", correo,
        {"rol": "Administrador", "via": "scripts/crear_admins_directivos.py", "cuentas_vinculadas": len(ya) + len(nuevas)},
    )
    return {"correo": correo, "accion": accion, "cuentas_nuevas": [c.nombre_visible for c in nuevas], "cuentas_totales": len(ya) + len(nuevas)}


def main() -> int:
    ap = argparse.ArgumentParser(description="Alta/actualización de los administradores de plataforma (directivos).")
    ap.add_argument("--forzar", action="store_true", help="Aplica los cambios (sin esto solo muestra qué haría).")
    ap.add_argument("--exigir-cambio", action="store_true", help="Obliga a cambiar la contraseña en el primer ingreso.")
    args = ap.parse_args()

    motivo = auth.validar_fortaleza(PASSWORD)
    if motivo:
        print(f"❌ La contraseña indicada no cumple la política de la plataforma: {motivo}")
        return 1

    db = SessionLocal()
    try:
        cuentas = cuentas_activas(db)
        if not cuentas:
            print("⚠️  No hay Cuentas activas en esta base: los usuarios quedarían sin ninguna empresa visible.")
            print("    Crea la Cuenta primero y vuelve a correr este script.")
            if not args.forzar:
                return 1

        print(f"\nBase de datos: {db.bind.url if db.bind else 'desconocida'}")
        print(f"Cuentas activas ({len(cuentas)}): {', '.join(c.nombre_visible for c in cuentas) or '—'}")
        print(f"Contraseña: {'RH_ADMIN_PASSWORD (variable de entorno)' if os.environ.get('RH_ADMIN_PASSWORD') else 'la acordada con los directivos'} · se guarda cifrada (scrypt)")
        print(f"Cambio obligatorio al primer ingreso: {'SÍ' if args.exigir_cambio else 'no'}\n")

        if not args.forzar:
            for d in DIRECTIVOS:
                existe = db.query(Usuario).filter(Usuario.correo == d["correo"].strip().lower()).first()
                print(f"  · {d['correo']:<32} → {'se ACTUALIZARÍA (ya existe)' if existe else 'se CREARÍA'} como Administrador con acceso a {len(cuentas)} Cuenta(s)")
            print("\nDry-run: no se cambió nada. Vuelve a correrlo con --forzar para aplicar.")
            return 0

        resultados = [aplicar(db, d, cuentas, args.exigir_cambio) for d in DIRECTIVOS]
        db.commit()

        print("Listo:")
        for r in resultados:
            detalle = f" · se le agregaron {len(r['cuentas_nuevas'])} Cuenta(s): {', '.join(r['cuentas_nuevas'])}" if r["cuentas_nuevas"] else ""
            print(f"  ✅ {r['correo']:<32} {r['accion']} como Administrador · {r['cuentas_totales']} Cuenta(s) visibles{detalle}")
        print("\nYa pueden entrar en la pantalla de acceso con su correo y la contraseña acordada.")
        if not args.exigir_cambio:
            print("Recomendación: pídeles cambiarla desde su perfil (o corre el script con --exigir-cambio).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
