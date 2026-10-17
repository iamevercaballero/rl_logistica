import { registerDecorator, ValidationOptions } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fecha calendario estricta: exige "YYYY-MM-DD" y nada más.
 *
 * `@IsDateString()` (class-validator, vía `validator.js`) acepta también un
 * instante completo ("2026-08-05T14:30:00Z") — está bien para campos que
 * genuinamente son instantes (`Movement.date`, etc.), pero para
 * `fechaVencimiento`/`fechaFabricacion` (fechas calendario puras, sin hora)
 * deja pasar cualquier cosa que "parezca" una fecha ISO, sin garantizar la
 * forma que el resto de la app asume en todos lados.
 */
export function IsBusinessDateString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBusinessDateString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
          // El formato no alcanza: "2029-02-30" lo cumple y no existe. Antes
          // pasaba la validación y reventaba contra PostgreSQL
          // (`date/time field value out of range`), que sale como un 500 y un
          // "ocurrió un error inesperado" en vez de decir qué corregir.
          //
          // Se arma la fecha en UTC y se comprueba que los componentes vuelvan
          // iguales: si el día no existe, JavaScript lo desborda al mes
          // siguiente (30/02 → 02/03) y la comparación falla.
          const [year, month, day] = value.split('-').map(Number);
          const fecha = new Date(Date.UTC(year, month - 1, day));
          return (
            fecha.getUTCFullYear() === year &&
            fecha.getUTCMonth() === month - 1 &&
            fecha.getUTCDate() === day
          );
        },
        defaultMessage(): string {
          return `$property debe ser una fecha calendario con formato YYYY-MM-DD`;
        },
      },
    });
  };
}
