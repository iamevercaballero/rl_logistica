import { ValueTransformer } from 'typeorm';

/**
 * Las columnas `numeric`/`decimal` de Postgres se leen como string en node-pg.
 * Este transformer las expone como `number | null` en las entidades, alineado
 * con los DTOs (que validan números).
 */
export const numericTransformer: ValueTransformer = {
  // `undefined` se preserva como `undefined` (no como `null`): TypeORM omite del
  // INSERT las columnas cuyo valor transformado es `undefined`, dejando que actúe
  // el DEFAULT de la base. `createDocument` depende de esto — inserta el documento
  // con `totalQuantity` sin definir (se calcula recién después de procesar las
  // líneas) y confía en el DEFAULT 0; devolver `null` acá lo pisa con NULL
  // explícito y rompe el NOT NULL de la columna.
  to: (value?: number | null): number | null | undefined =>
    value === undefined ? undefined : (value ?? null),
  from: (value?: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
