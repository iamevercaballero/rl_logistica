/**
 * El export tiene que traer el reporte entero, no la página que se está viendo.
 *
 * El bug: los botones de PDF/Excel/CSV de Reportes recibían `…Q.data.data` —la
 * página actual— así que con un listado de varias páginas había que bajar un
 * archivo por página.
 */
import { describe, expect, it, vi } from "vitest";
import { EXPORT_PAGE_SIZE, fetchAllPages } from "./fetchAllPages";

/** Backend de mentira con `n` filas, que respeta page/limit como el real. */
function servidorCon(n: number) {
  const todas = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const fetchPage = vi.fn(async (page: number, limit: number) => ({
    data: todas.slice((page - 1) * limit, page * limit),
    meta: { total: n, totalPages: Math.ceil(n / limit) },
  }));
  return { fetchPage, todas };
}

describe("fetchAllPages", () => {
  it("trae las filas de todas las páginas, en orden", async () => {
    const { fetchPage, todas } = servidorCon(250);
    const res = await fetchAllPages(fetchPage);

    expect(res.rows).toEqual(todas);
    expect(res.total).toBe(250);
    expect(res.truncado).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3); // 100 + 100 + 50
  });

  it("pide con el tope que acepta el backend, no con el de la pantalla", async () => {
    const { fetchPage } = servidorCon(150);
    await fetchAllPages(fetchPage);

    for (const [, limit] of fetchPage.mock.calls) expect(limit).toBe(EXPORT_PAGE_SIZE);
  });

  it("una sola página: una sola petición", async () => {
    const { fetchPage, todas } = servidorCon(40);
    const res = await fetchAllPages(fetchPage);

    expect(res.rows).toEqual(todas);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("exacto en el borde de página no pide una página de más", async () => {
    const { fetchPage } = servidorCon(200);
    const res = await fetchAllPages(fetchPage);

    expect(res.rows).toHaveLength(200);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("sin resultados devuelve vacío sin romperse", async () => {
    const { fetchPage } = servidorCon(0);
    const res = await fetchAllPages(fetchPage);

    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("corta en maxRows y lo informa, en vez de recortar en silencio", async () => {
    const { fetchPage } = servidorCon(1000);
    const res = await fetchAllPages(fetchPage, { maxRows: 250 });

    expect(res.rows).toHaveLength(250);
    expect(res.total).toBe(1000);
    expect(res.truncado).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(3); // no recorre las 10 páginas
  });

  it("informa el avance para poder mostrarlo mientras carga", async () => {
    const { fetchPage } = servidorCon(250);
    const avances: Array<[number, number]> = [];
    await fetchAllPages(fetchPage, { onProgress: (c, t) => avances.push([c, t]) });

    expect(avances).toEqual([[100, 250], [200, 250], [250, 250]]);
  });

  it("si el listado se achica mientras se recorre, corta sin colgarse", async () => {
    // El servidor dice que hay 500 pero a partir de la página 3 no devuelve nada.
    const fetchPage = vi.fn(async (page: number, limit: number) => ({
      data: page <= 2 ? Array.from({ length: limit }, (_, i) => ({ id: (page - 1) * limit + i })) : [],
      meta: { total: 500 },
    }));

    const res = await fetchAllPages(fetchPage);
    expect(res.rows).toHaveLength(200);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("respeta un pageSize propio", async () => {
    const { fetchPage, todas } = servidorCon(30);
    const res = await fetchAllPages(fetchPage, { pageSize: 10 });

    expect(res.rows).toEqual(todas);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
