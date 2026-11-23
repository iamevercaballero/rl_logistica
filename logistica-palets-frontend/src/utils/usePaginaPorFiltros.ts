import { useState } from "react";

/**
 * Página de un listado paginado en el servidor que vuelve a 1 cuando cambian
 * los filtros. La página queda atada a la `clave` con la que se eligió: al
 * cambiar la clave se descarta en el mismo render (patrón de estado derivado de
 * React), sin un efecto que dispare antes una consulta con la página vieja.
 * Descartarla, y no solo ignorarla, importa: si no, volver al filtro anterior
 * reaparecía en la página donde se había dejado.
 */
export function usePaginaPorFiltros(clave: unknown): [number, (pagina: number) => void] {
  const key = JSON.stringify(clave);
  const [estado, setEstado] = useState({ key, page: 1 });
  if (estado.key !== key) setEstado({ key, page: 1 });
  const page = estado.key === key ? estado.page : 1;
  return [page, (pagina: number) => setEstado({ key, page: pagina })];
}
