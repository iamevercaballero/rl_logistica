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
          return typeof value === 'string' && DATE_ONLY.test(value);
        },
        defaultMessage(): string {
          return `$property debe ser una fecha calendario con formato YYYY-MM-DD`;
        },
      },
    });
  };
}
