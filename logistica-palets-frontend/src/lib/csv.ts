import { parseQtyInput } from "../utils/quantity";

/**
 * Serialización de celdas CSV con protección contra inyección de fórmulas.
 *
 * Excel, LibreOffice y Sheets interpretan como fórmula cualquier celda que
 * empiece con `=`, `+`, `-` o `@`, y encadenan celdas con tabulación o retorno
 * de carro. Entrecomillar no alcanza: `"=WEBSERVICE(...)"` se evalúa igual al
 * abrir el archivo. Como los reportes exportan texto libre que carga cualquier
 * operador —notas, destino, transportista, chofer—, alcanza con escribir la
 * fórmula en una nota para que se ejecute en la máquina de quien abre el
 * reporte, con sus permisos.
 *
 * La defensa es anteponer un apóstrofo, que fuerza a interpretar la celda como
 * texto. Se aplica sólo cuando hace falta: escapar todo convertiría en texto
 * columnas numéricas legítimas y rompería las planillas de quien las use.
 */

/** Caracteres con los que una celda empieza a comportarse como fórmula. */
const INICIO_FORMULA = /^[=+@-]/;

/** Tabulación o salto al inicio: Excel los usa para encadenar celdas. */
const INICIO_CONTROL = /^[\t\r\n]/;

/** Marcador de "sin dato" que usan los reportes. No es una fórmula. */
const SIN_DATO = "-";

/**
 * Neutraliza una celda sólo si Excel la tomaría como fórmula.
 *
 * Se dejan pasar dos casos que aparecen en cada exportación y no son peligrosos:
 * el guion suelto con el que los reportes marcan un campo vacío, y los números
 * negativos (`-1.234,56`), que escapados aparecerían como texto y romperían los
 * totales de la planilla.
 */
export function sanitizeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str === "") return str;

  if (INICIO_CONTROL.test(str)) return `'${str}`;

  // Excel ignora los espacios de la izquierda al decidir si algo es fórmula,
  // así que la detección mira el contenido ya sin ellos; el prefijo va sobre
  // el valor original, para no alterar lo que el operador escribió.
  const contenido = str.replace(/^ +/, "");
  if (!INICIO_FORMULA.test(contenido)) return str;

  if (contenido === SIN_DATO) return str;
  if (parseQtyInput(contenido) !== null) return str;

  return `'${str}`;
}

/**
 * Celda lista para el archivo: primero se neutraliza la fórmula, después se
 * entrecomilla. El orden importa — entrecomillar no protege de nada por sí solo.
 *
 * Se entrecomilla siempre, no sólo cuando hay comas: es válido en RFC 4180, y
 * evita tener que razonar sobre qué caracteres obligan a comillas en cada campo.
 */
export function csvCell(value: string | number | null | undefined): string {
  return `"${sanitizeCsvCell(value).replace(/"/g, '""')}"`;
}

/** Arma el archivo completo a partir de la matriz de filas, con CRLF (RFC 4180). */
export function buildCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
