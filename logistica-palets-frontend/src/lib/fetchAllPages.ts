/**
 * Trae un listado paginado entero, para exportarlo completo.
 *
 * Las pantallas de reportes muestran de a una página y los botones de PDF /
 * Excel / CSV exportaban exactamente eso: lo que había en pantalla. Con un
 * reporte de varias páginas había que bajar un archivo por página y pegarlos a
 * mano — que es justamente lo que un export tiene que evitar.
 *
 * No se resuelve pidiendo "todo de una": el backend topa `limit` en 100 (ver
 * los DTO de `movements` y `reports/movements`), así que acá se recorren las
 * páginas y se concatenan. Se pide por `meta.total`, no "hasta que venga
 * vacío": así una página corta por un borrado concurrente no corta el recorrido.
 */

/** Tope por página que acepta el backend. Pedir más no trae más. */
export const EXPORT_PAGE_SIZE = 100;

/**
 * Cota de filas de un export. No es un límite del negocio: es para que un
 * filtro demasiado ancho no dispare cientos de peticiones ni arme un archivo
 * que el navegador no puede sostener en memoria. Si se llega a este tope, el
 * resultado lo informa en vez de entregar un archivo recortado en silencio.
 */
export const EXPORT_MAX_ROWS = 20_000;

export type PaginaRespuesta<T> = {
  data: T[];
  meta: { total: number; totalPages?: number };
};

export type ExportCompleto<T> = {
  rows: T[];
  /** Cuántas filas dice el servidor que hay con esos filtros. */
  total: number;
  /** `true` si se cortó en `maxRows` y el archivo no trae todo. */
  truncado: boolean;
};

export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<PaginaRespuesta<T>>,
  opts: {
    maxRows?: number;
    pageSize?: number;
    /** Para mostrar "cargando 300 de 1.200…" mientras se recorre. */
    onProgress?: (cargadas: number, total: number) => void;
  } = {},
): Promise<ExportCompleto<T>> {
  const { maxRows = EXPORT_MAX_ROWS, pageSize = EXPORT_PAGE_SIZE, onProgress } = opts;

  const primera = await fetchPage(1, pageSize);
  const total = primera.meta.total;
  const rows = [...primera.data];
  onProgress?.(rows.length, total);

  // Cuántas páginas hay que recorrer según el total, acotado por `maxRows`.
  // `meta.totalPages` no se usa como fuente: se calcula con el `pageSize` que
  // realmente pedimos, que puede no ser el que la pantalla tenía puesto.
  const objetivo = Math.min(total, maxRows);
  const ultimaPagina = Math.ceil(objetivo / pageSize);

  for (let page = 2; page <= ultimaPagina; page++) {
    const siguiente = await fetchPage(page, pageSize);
    // Una página vacía antes de tiempo significa que el listado se achicó
    // mientras lo recorríamos: con lo que haya alcanza, seguir no trae nada.
    if (siguiente.data.length === 0) break;
    rows.push(...siguiente.data);
    onProgress?.(rows.length, total);
  }

  return { rows: rows.slice(0, maxRows), total, truncado: total > maxRows };
}
