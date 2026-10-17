import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Tope duro por página, para que `limit` no sirva para pedir todo igual.
 *
 * Va antes de `PageQueryDto`: los decoradores se evalúan al definir la clase,
 * así que una constante declarada después queda en la zona muerta temporal y
 * revienta al cargar el módulo.
 */
export const MAX_PAGE_SIZE = 200;

/** Página por defecto cuando se pide paginado sin decir de cuánto. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Paginación de los listados largos (materiales, lotes, palets).
 *
 * **Es opcional a propósito.** Sin `page` ni `limit`, el endpoint devuelve el
 * arreglo completo como siempre: hay pantallas que necesitan todo el catálogo
 * de una para armar un mapa por id o un desplegable (Lotes, Reportes, el
 * selector de materiales), y paginarlas las obligaría a recorrer todas las
 * páginas para lo mismo. Con `page` o `limit`, el endpoint devuelve el sobre
 * `Paginated<T>` y la pantalla que muestra una tabla pide de a una página.
 *
 * El motivo del cambio: con 2.100 materiales, la pantalla de Materiales metía
 * las 2.100 filas en el DOM —31.728 nodos, 4.210 botones, 250.000 px de
 * alto— y el backend mandaba 900 KB en cada carga. Anduvo en una máquina de
 * escritorio; en una tablet del depósito, y con los lotes y palets creciendo
 * mucho más rápido que el catálogo, deja de andar.
 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Tope por página. El máximo acota el payload y el trabajo de render; 50 es
   * lo que entra cómodo en una pantalla sin que el operador pagine de más.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

/** Un listado paginado, con lo que la pantalla necesita para dibujar el pie. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  /** Páginas totales — derivado, pero lo necesita cada pie de tabla. */
  totalPages: number;
}

/** `true` si el cliente pidió paginar. */
export function wantsPagination(query: PageQueryDto): boolean {
  return query.page !== undefined || query.limit !== undefined;
}

/** `skip`/`take` ya normalizados, para pasárselos a TypeORM o al SQL. */
export function pageBounds(query: PageQueryDto): { page: number; limit: number; skip: number } {
  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = Math.min(query.limit && query.limit > 0 ? query.limit : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit };
}

/** Arma el sobre a partir de las filas de la página y el total sin paginar. */
export function paginated<T>(data: T[], total: number, query: PageQueryDto): Paginated<T> {
  const { page, limit } = pageBounds(query);
  return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
