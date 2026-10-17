import { useEffect, useMemo, useState } from "react";
import type { PaginaInfo } from "../components/Paginador";

/**
 * Paginación del lado del cliente para listados que ya llegaron enteros.
 *
 * Lotes y Palets filtran y arman sus desplegables a partir de la lista
 * completa: el buscador recorre todas las filas y las opciones de "estado",
 * "material" y "ubicación" salen de los valores presentes. Paginar en el
 * servidor dejaría el buscador filtrando sólo la página actual y los
 * desplegables con los valores de esas 50 filas, que es peor que el problema
 * que se quiere resolver.
 *
 * Esto corta sólo el **render**: resuelve el DOM —que era lo medido: 2.100
 * filas, 31.728 nodos, 250.000 px de alto— pero no el tamaño de la respuesta.
 * Cuando el volumen haga pesar el payload, hay que mover los filtros al
 * servidor y recién ahí usar la paginación que el backend ya expone.
 */
export function usePaginacionLocal<T>(filas: T[], porPagina = 50) {
  const [pagina, setPagina] = useState(1);

  const totalPages = Math.max(1, Math.ceil(filas.length / porPagina));

  // Si el filtro achicó la lista y la página actual quedó fuera de rango, se
  // vuelve a la última válida: si no, el operador ve una tabla vacía con el
  // pie diciendo "Página 7 de 2".
  useEffect(() => {
    setPagina((actual) => Math.min(actual, totalPages));
  }, [totalPages]);

  const visibles = useMemo(
    () => filas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filas, pagina, porPagina],
  );

  const info: PaginaInfo = {
    total: filas.length,
    page: Math.min(pagina, totalPages),
    limit: porPagina,
    totalPages,
  };

  return { visibles, info, setPagina };
}
