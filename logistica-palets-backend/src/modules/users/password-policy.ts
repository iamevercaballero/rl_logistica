/**
 * Política mínima de contraseña: 8+ caracteres, al menos una letra y un
 * número. No es una política "fuerte" (no exige mayúscula/símbolo) a
 * propósito — es la contraseña temporal que un ADMIN/MANAGER teclea para
 * otro usuario, que después la cambia; exigir de más ahí solo mueve la
 * fricción al que da de alta, no mejora la seguridad real.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_POLICY_MESSAGE =
  'La contraseña debe tener al menos 8 caracteres, con letras y números.';
