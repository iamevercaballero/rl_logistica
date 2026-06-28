import { ValueTransformer } from 'typeorm';

/**
 * Las columnas `numeric`/`decimal` de Postgres se leen como string en node-pg.
 * Este transformer las expone como `number | null` en las entidades, alineado
 * con los DTOs (que validan números).
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null): number | null => value ?? null,
  from: (value?: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
