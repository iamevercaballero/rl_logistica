import { Transform } from 'class-transformer';
import { parseQuantity } from './quantity';

/**
 * Normaliza una cantidad tipeada con coma decimal ("3537,37") a `number`
 * (`3537.37`) antes de que corra class-validator.
 *
 * Reemplaza a `@Type(() => Number)` en los campos de cantidad de los DTOs: acepta
 * `"3537,37"`, `"3537.37"` o `3537.37` desde cualquier cliente. Los números pasan
 * sin tocar; un string que no parsea se deja como está para que `@IsNumber` lo
 * reporte como inválido (en vez de convertirlo en `NaN` o `0` en silencio).
 *
 * No redondea: la validación `@IsNumber({ maxDecimalPlaces })` sigue rechazando
 * un exceso de decimales, y la aritmética de stock aplica `roundQuantity`.
 */
export function NormalizeDecimal(): PropertyDecorator {
  return Transform(
    ({ value }) => {
      if (value === undefined || value === null || typeof value === 'number') return value;
      // Campo que el operador dejó vacío: es "no lo cargó", no "cargó algo
      // inválido". Sin esto llegaba como `''` y `@IsOptional` no lo saltaba, así
      // que un peso vacío respondía "must not be greater than 99999999.99" —un
      // mensaje que no tiene nada que ver con lo que pasó—.
      if (typeof value === 'string' && value.trim() === '') return undefined;
      const parsed = parseQuantity(value);
      return parsed ?? value;
    },
    { toClassOnly: true },
  );
}
