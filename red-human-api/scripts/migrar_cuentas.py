"""Migra los datos existentes al modelo de Cuenta/Cliente (Fase A · reestructuración
multi-cuenta).

Crea una Cuenta default ("Grupo Carbe") y, dentro de ella, un Cliente por cada valor de
`Vacante.empresa`/`Colaborador.empresa` distinto de "" y del nombre de la Cuenta. El
agrupamiento es por nombre NORMALIZADO (mayúsculas/minúsculas y espacios extra no cuentan
— "GROWTIA" y "Growtia" producen un solo Cliente, no dos; el nombre visible es la variante
de capitalización más frecuente en los datos reales). Las filas cuyo `empresa` normalizado
coincide con el de la Cuenta se quedan con `cliente_id = NULL` — la Cuenta recluta para sí
misma, no es su propio Cliente (decisión confirmada 2026-09-10, ver CONTEXTO_SESION.md).

Asigna `cuenta_id`/`cliente_id` a todas las filas existentes de Vacante, Candidato,
Empleado, Colaborador, Requisicion y Bitacora (Empleado y Requisicion no tienen ningún
campo tipo `empresa` hoy, así que quedan con `cliente_id = NULL`); asigna todos los
Usuario existentes a la Cuenta vía `usuario_cuentas`; migra `Usuario.rol`:
`admin -> "Administrador"`, `rh`/`lectura -> "Usuario"`.

Es idempotente: si ya existe alguna Cuenta, no hace nada (se asume que ya se corrió).

Uso (desde red-human-api/):
    .venv/Scripts/python.exe scripts/migrar_cuentas.py           # pide confirmación
    .venv/Scripts/python.exe scripts/migrar_cuentas.py --forzar  # sin preguntar
"""

import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # para poder importar `app.*`

from app.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Bitacora,
    Candidato,
    Cliente,
    Colaborador,
    Cuenta,
    Curso,
    Empleado,
    Requisicion,
    Usuario,
    UsuarioCuenta,
    Vacante,
)

NOMBRE_CUENTA_DEFAULT = "Grupo Carbe"
ROLES_VIEJOS_A_NUEVOS = {"admin": "Administrador", "rh": "Usuario", "lectura": "Usuario"}


def _normalizar(s: str) -> str:
    """Clave de agrupación: colapsa espacios repetidos y quita mayúsculas/minúsculas, para que
    'GROWTIA' y 'Growtia' (o 'Growtia  ' con espacio de más) agrupen como el mismo Cliente."""
    return re.sub(r"\s+", " ", (s or "").strip()).casefold()


def _agrupar_empresas(db) -> dict[str, Counter]:
    """Todas las variantes de `empresa` (Vacante + Colaborador) agrupadas por nombre
    normalizado — regresa {clave_normalizada: Counter({variante_tal_cual: veces_que_aparece})},
    sin "" ni el nombre de la Cuenta default."""
    grupos: dict[str, Counter] = {}
    for modelo in (Vacante, Colaborador):
        for (empresa,) in db.query(modelo.empresa).all():
            variante = re.sub(r"\s+", " ", (empresa or "").strip())
            if not variante:
                continue
            grupos.setdefault(_normalizar(variante), Counter())[variante] += 1
    grupos.pop(_normalizar(NOMBRE_CUENTA_DEFAULT), None)
    return grupos


def _nombres_cliente(db) -> dict[str, str]:
    """{clave_normalizada: nombre_canónico} — un Cliente por clave. El nombre canónico es la
    variante de mayúsculas/minúsculas más frecuente en los datos reales; en caso de empate, la
    primera en orden alfabético, para que el resultado sea determinista si se corre dos veces
    sobre los mismos datos (aunque el script ya es idempotente por otra vía, ver `migrar()`)."""
    grupos = _agrupar_empresas(db)
    canonicos = {}
    for clave, variantes in grupos.items():
        maximo = max(variantes.values())
        empatados = sorted(v for v, n in variantes.items() if n == maximo)
        canonicos[clave] = empatados[0]
    return canonicos


def migrar(db, forzar: bool) -> int:
    if db.query(Cuenta).count() > 0:
        print("Ya existe al menos una Cuenta — este script ya se corrió. No se hace nada.")
        return 0

    grupos_empresa = _agrupar_empresas(db)
    nombres_clientes = _nombres_cliente(db)  # {clave: nombre_canonico}

    n_vacantes = db.query(Vacante).count()
    n_candidatos = db.query(Candidato).count()
    n_empleados = db.query(Empleado).count()
    n_colaboradores = db.query(Colaborador).count()
    n_requisiciones = db.query(Requisicion).count()
    n_cursos = db.query(Curso).count()
    n_bitacora = db.query(Bitacora).count()
    usuarios = db.query(Usuario).order_by(Usuario.id).all()

    print(f'Se va a crear la Cuenta default: "{NOMBRE_CUENTA_DEFAULT}"')
    if nombres_clientes:
        print(f"Se van a crear {len(nombres_clientes)} Cliente(s) dentro de esa Cuenta:")
        for clave, nombre in sorted(nombres_clientes.items(), key=lambda x: x[1]):
            variantes = grupos_empresa[clave]
            if len(variantes) > 1:
                detalle = ", ".join(f'"{v}"×{n}' for v, n in sorted(variantes.items()))
                print(f"  - {nombre}  (agrupa: {detalle})")
            else:
                print(f"  - {nombre}")
    else:
        print("No hay valores de empresa distintos a migrar como Cliente.")

    print("\nFilas que van a quedar con cuenta_id asignado:")
    print(f"  Vacante:      {n_vacantes}")
    print(f"  Candidato:    {n_candidatos}")
    print(f"  Empleado:     {n_empleados}")
    print(f"  Colaborador:  {n_colaboradores}")
    print(f"  Requisicion:  {n_requisiciones}")
    print(f"  Curso:        {n_cursos}")
    print(f"  Bitacora:     {n_bitacora}")

    print(f"\n{len(usuarios)} Usuario(s) se van a asignar a la Cuenta y a migrar de rol:")
    for u in usuarios:
        nuevo_rol = ROLES_VIEJOS_A_NUEVOS.get(u.rol, u.rol)
        cambio = "" if nuevo_rol == u.rol else f" -> {nuevo_rol}"
        print(f"  {u.correo} — rol actual: {u.rol}{cambio}")

    if not forzar:
        resp = input("\n¿Confirmas? Esto no se puede deshacer (escribe 'si'): ").strip().lower()
        if resp != "si":
            print("Cancelado — no se escribió nada.")
            return 1

    cuenta = Cuenta(nombre_comercial=NOMBRE_CUENTA_DEFAULT, estado="Activa")
    db.add(cuenta)
    db.flush()

    clientes_por_clave: dict[str, int] = {}
    for clave, nombre in nombres_clientes.items():
        cliente = Cliente(cuenta_id=cuenta.id, nombre=nombre, estado="Activo")
        db.add(cliente)
        db.flush()
        clientes_por_clave[clave] = cliente.id

    def _cliente_id(empresa: str):
        return clientes_por_clave.get(_normalizar(empresa))  # None si "" o == Cuenta

    for v in db.query(Vacante).all():
        v.cuenta_id = cuenta.id
        v.cliente_id = _cliente_id(v.empresa)

    for c in db.query(Candidato).all():
        c.cuenta_id = cuenta.id

    for e in db.query(Empleado).all():
        e.cuenta_id = cuenta.id  # sin campo `empresa`: cliente_id queda NULL

    for col in db.query(Colaborador).all():
        col.cuenta_id = cuenta.id
        col.cliente_id = _cliente_id(col.empresa)

    for r in db.query(Requisicion).all():
        r.cuenta_id = cuenta.id  # sin campo `empresa`: cliente_id queda NULL

    db.query(Curso).update({Curso.cuenta_id: cuenta.id}, synchronize_session=False)
    db.query(Bitacora).update({Bitacora.cuenta_id: cuenta.id}, synchronize_session=False)

    for u in usuarios:
        db.add(UsuarioCuenta(usuario_id=u.id, cuenta_id=cuenta.id))
        u.rol = ROLES_VIEJOS_A_NUEVOS.get(u.rol, u.rol)

    db.commit()
    print("\nListo: Cuenta y Clientes creados, filas migradas, usuarios asignados a la Cuenta y roles actualizados.")
    return 0


def main() -> int:
    forzar = "--forzar" in sys.argv[1:]
    db = SessionLocal()
    try:
        return migrar(db, forzar)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
