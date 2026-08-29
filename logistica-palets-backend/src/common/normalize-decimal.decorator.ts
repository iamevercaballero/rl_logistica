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
      const parsed = parseQuantity(value);
      return parsed ?? value;
    },
    { toClassOnly: true },
  );
}
