"""
Cargas masivas (Fase 2, 2026-09-15): CSV o Excel → filas normalizadas para /auth/usuarios/masivo,
/clientes/masivo y /plantillas/masivo. La validación de negocio NO vive aquí: cada endpoint reutiliza
las mismas funciones que su alta individual; aquí solo se lee el archivo y se homologan encabezados
(minúsculas, sin acentos, espacios → guion bajo) para que «Razón social», «razon_social» y
«RAZON SOCIAL» sean la misma columna.
"""

import csv
import io
import re
import unicodedata
from typing import List, Tuple

from fastapi import HTTPException, UploadFile
from fastapi.responses import Response

MAX_FILAS = 2000
MAX_BYTES = 5 * 1024 * 1024


def _clave(encabezado) -> str:
    plano = unicodedata.normalize("NFKD", str(encabezado or "")).encode("ascii", "ignore").decode().lower().strip()
    plano = re.sub(r"[^a-z0-9]+", "_", plano).strip("_")
    return plano


def _celda(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


async def leer_tabla(archivo: UploadFile) -> List[Tuple[int, dict]]:
    """[(número de fila en el archivo, {columna: valor})]. CSV (UTF-8/Latin-1, coma o punto y coma)
    o Excel .xlsx (primera hoja). Lanza 415/422 con mensaje para RH."""
    nombre = (archivo.filename or "").lower()
    contenido = await archivo.read()
    if len(contenido) > MAX_BYTES:
        raise HTTPException(413, "El archivo pesa más de 5 MB.")
    if not contenido.strip():
        raise HTTPException(422, "El archivo está vacío.")

    if nombre.endswith(".xlsx") or nombre.endswith(".xlsm"):
        try:
            import openpyxl
        except ImportError:  # pragma: no cover
            raise HTTPException(415, "El servidor no tiene openpyxl; sube el archivo como CSV.")
        try:
            libro = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        except Exception as ex:  # noqa: BLE001
            raise HTTPException(422, f"No se pudo leer el Excel: {ex}")
        hoja = libro.worksheets[0]
        renglones = [[_celda(c) for c in fila] for fila in hoja.iter_rows(values_only=True)]
    elif nombre.endswith(".csv") or nombre.endswith(".txt") or not nombre:
        texto = None
        for codificacion in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                texto = contenido.decode(codificacion)
                break
            except UnicodeDecodeError:
                continue
        if texto is None:
            raise HTTPException(422, "No se pudo decodificar el CSV (usa UTF-8).")
        muestra = texto[:4096]
        try:
            dialecto = csv.Sniffer().sniff(muestra, delimiters=",;\t")
        except csv.Error:
            dialecto = csv.excel
        renglones = [[_celda(c) for c in fila] for fila in csv.reader(io.StringIO(texto), dialecto)]
    else:
        raise HTTPException(415, "Formato no admitido: sube un .csv o un .xlsx.")

    renglones = [r for r in renglones if any(c for c in r)]
    if not renglones:
        raise HTTPException(422, "El archivo no tiene filas.")
    if len(renglones) - 1 > MAX_FILAS:
        raise HTTPException(413, f"Máximo {MAX_FILAS} filas por archivo.")
    encabezados = [_clave(h) for h in renglones[0]]
    if not any(encabezados):
        raise HTTPException(422, "La primera fila debe traer los nombres de las columnas.")
    filas: List[Tuple[int, dict]] = []
    for i, r in enumerate(renglones[1:], start=2):
        fila = {}
        for h, v in zip(encabezados, r):
            if h:
                fila[h] = v
        filas.append((i, fila))
    return filas


def lista(valor: str) -> List[str]:
    """«a | b | c» o «a; b; c» → ["a", "b", "c"]."""
    return [x.strip() for x in re.split(r"\s*[|;]\s*", valor or "") if x.strip()]


def entero(valor: str, columna: str) -> int:
    limpio = re.sub(r"[^0-9]", "", str(valor or ""))
    if not limpio:
        raise HTTPException(400, f"«{columna}» debe ser un número.")
    return int(limpio)


class Resultado:
    """Acumula el resultado por fila: qué se creó y qué falló (y por qué)."""

    def __init__(self) -> None:
        self.creados: List[dict] = []
        self.errores: List[dict] = []

    def ok(self, fila: int, datos: dict) -> None:
        self.creados.append({"fila": fila, **datos})

    def error(self, fila: int, detalle: str, referencia: str = "") -> None:
        self.errores.append({"fila": fila, "referencia": referencia, "error": detalle})

    def resumen(self) -> dict:
        return {"creados": len(self.creados), "errores": len(self.errores)}

    def dict(self) -> dict:
        return {"total": len(self.creados) + len(self.errores), **self.resumen(), "filas": self.creados, "fallas": self.errores}


def csv_plantilla(nombre: str, columnas: List[str], ejemplos: List[List[str]]) -> Response:
    """CSV descargable con encabezados + fila(s) de ejemplo (UTF-8 con BOM: Excel lo abre bien)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(columnas)
    for e in ejemplos:
        w.writerow(e)
    return Response(
        content=("\ufeff" + buf.getvalue()).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="carga_{nombre}.csv"'},
    )
