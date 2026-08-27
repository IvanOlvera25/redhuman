"""Comprueba que toda librería externa que importa el código esté en requirements.txt.

Existe por un incidente real: la rama v2.0 importaba `pypdf` sin declararlo, así
que la lectura de CVs en PDF reventaba en producción con ImportError — y no se
notaba hasta que alguien subía un PDF.

Detecta también los imports dentro de funciones, que es justo donde se escondía.
"""

import ast
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent / "red-human-api"
# módulos propios y de la biblioteca estándar que no van en requirements.txt
PROPIOS = {"app"}


def modulos_importados(archivo: pathlib.Path) -> set:
    try:
        arbol = ast.parse(archivo.read_text(encoding="utf-8"))
    except SyntaxError as e:
        print(f"  ✗ {archivo}: no compila ({e})")
        sys.exit(1)

    encontrados = set()
    for nodo in ast.walk(arbol):  # ast.walk entra a funciones: ahí se escondía pypdf
        if isinstance(nodo, ast.Import):
            encontrados.update(a.name.split(".")[0] for a in nodo.names)
        elif isinstance(nodo, ast.ImportFrom):
            if nodo.level == 0 and nodo.module:  # los relativos (.foo) son propios
                encontrados.add(nodo.module.split(".")[0])
    return encontrados


def main() -> int:
    usados = set()
    for archivo in sorted((RAIZ / "app").rglob("*.py")):
        usados |= modulos_importados(archivo)

    externos = {m for m in usados if m not in PROPIOS and m not in sys.stdlib_module_names}

    faltantes = []
    for modulo in sorted(externos):
        try:
            __import__(modulo)
        except ImportError:
            faltantes.append(modulo)

    print(f"  módulos externos usados: {len(externos)}")
    if faltantes:
        print("\n  ✗ Estos módulos se importan pero no están instalados.")
        print("    Agrégalos a red-human-api/requirements.txt:")
        for m in faltantes:
            print(f"      - {m}")
        return 1

    print("  ✓ todas las dependencias externas están declaradas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
