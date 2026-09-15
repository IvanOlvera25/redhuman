/* Fase 4 (2026-09-15) — Catálogo de los 32 Estados de México y sus Municipios / Alcaldías (INEGI, 2,478
   registros) para los selectores anidados del formulario de vacante. `ubicacion` (texto) se sigue
   derivando como «Municipio, Estado» — es lo que leen portal, WhatsApp y la IA. */

import catalogo from "./estados-municipios.json";

const CATALOGO = catalogo as Record<string, string[]>;

export const ESTADOS_MX: string[] = Object.keys(CATALOGO);

export function municipiosDe(estado: string): string[] {
  return CATALOGO[estado] ?? [];
}

function plano(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/* Abreviaturas y alias frecuentes en texto libre («Guadalajara, JAL», «CDMX», «Monterrey, NL»). */
const ALIAS_ESTADO: Record<string, string> = {
  cdmx: "Ciudad de México",
  "ciudad de mexico": "Ciudad de México",
  df: "Ciudad de México",
  "distrito federal": "Ciudad de México",
  jal: "Jalisco",
  nl: "Nuevo León",
  "nuevo leon": "Nuevo León",
  qro: "Querétaro",
  gto: "Guanajuato",
  edomex: "México",
  "estado de mexico": "México",
  mex: "México",
  pue: "Puebla",
  ver: "Veracruz",
  yuc: "Yucatán",
  bc: "Baja California",
  bcs: "Baja California Sur",
  chih: "Chihuahua",
  coah: "Coahuila",
  son: "Sonora",
  sin: "Sinaloa",
  tamps: "Tamaulipas",
  slp: "San Luis Potosí",
  ags: "Aguascalientes",
  mich: "Michoacán",
  oax: "Oaxaca",
  chis: "Chiapas",
  qroo: "Quintana Roo",
  "q. roo": "Quintana Roo",
  hgo: "Hidalgo",
  tlax: "Tlaxcala",
  mor: "Morelos",
  gro: "Guerrero",
  nay: "Nayarit",
  col: "Colima",
  dgo: "Durango",
  zac: "Zacatecas",
  camp: "Campeche",
  tab: "Tabasco",
};

/** Texto de ubicación derivado (misma regla que models.texto_ubicacion en el backend). */
export function textoUbicacion(estado: string, municipio: string, libre = ""): string {
  const e = estado.trim();
  const m = municipio.trim();
  if (m && e) return m === e ? m : `${m}, ${e}`;
  if (e) return e;
  return libre.trim();
}

/** Intenta reconocer Estado y Municipio en un texto libre de una vacante previa («Zapopan, Jalisco»,
 * «Guadalajara, JAL», «CDMX»). Regresa vacíos si no hay coincidencia clara. */
export function parsearUbicacion(texto: string): { estado: string; municipio: string } {
  const partes = (texto || "")
    .split(/[,·|/-]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return { estado: "", municipio: "" };
  const porPlano = new Map(ESTADOS_MX.map((e) => [plano(e), e]));
  let estado = "";
  for (const p of partes) {
    const k = plano(p);
    const encontrado = porPlano.get(k) ?? ALIAS_ESTADO[k];
    if (encontrado) {
      estado = encontrado;
      break;
    }
  }
  let municipio = "";
  const candidatos = estado ? [estado] : ESTADOS_MX;
  for (const p of partes) {
    const k = plano(p);
    for (const e of candidatos) {
      const m = municipiosDe(e).find((x) => plano(x) === k);
      if (m) {
        municipio = m;
        if (!estado) estado = e;
        break;
      }
    }
    if (municipio) break;
  }
  return { estado, municipio };
}
