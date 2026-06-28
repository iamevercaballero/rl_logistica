import { Logger } from '@nestjs/common';

/**
 * Validación fail-fast de variables de entorno.
 *
 * En NODE_ENV=production la app NO debe arrancar con secretos ausentes, débiles
 * o iguales entre sí. En desarrollo/test se permiten fallbacks (los módulos de
 * auth usan 'dev_secret_fallback' sólo si esta validación no corta antes).
 *
 * Se ejecuta en main.ts ANTES de crear la app, de modo que cuando los módulos
 * (jwt.strategy, auth.module, auth.service) leen process.env, en producción ya
 * está garantizado que los secretos reales existen.
 */

const MIN_SECRET_LENGTH = 32;

/** Valores por defecto inseguros que jamás deben usarse en producción. */
const INSECURE_VALUES = new Set([
  'dev_secret',
  'dev_secret_fallback',
  'dev_secret_refresh',
  'changeme',
  'secret',
  'password',
]);

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  // En dev/test se permiten los fallbacks de los módulos de auth.
  if (!isProd) return;

  const logger = new Logger('EnvValidation');
  const errors: string[] = [];

  const requireSecret = (name: string): void => {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      errors.push(`${name} es requerido en producción.`);
      return;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      errors.push(
        `${name} es demasiado corto (mínimo ${MIN_SECRET_LENGTH} caracteres). Generá uno con: openssl rand -base64 64`,
      );
    }
    if (INSECURE_VALUES.has(value)) {
      errors.push(`${name} no puede ser un valor por defecto inseguro.`);
    }
  };

  requireSecret('JWT_SECRET');
  requireSecret('JWT_REFRESH_SECRET');

  if (
    process.env.JWT_SECRET &&
    process.env.JWT_REFRESH_SECRET &&
    process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET
  ) {
    errors.push('JWT_REFRESH_SECRET debe ser distinto de JWT_SECRET.');
  }

  if (errors.length > 0) {
    logger.error('Configuración de entorno inválida para producción:');
    for (const e of errors) logger.error(`  • ${e}`);
    throw new Error(
      `Arranque abortado: ${errors.length} problema(s) de configuración en producción. ` +
        'Revisá las variables de entorno (.env.prod).',
    );
  }
}
