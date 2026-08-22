/**
 * ¿Este token (por su `iat`, en segundos) se emitió antes del último cambio
 * de contraseña / "cerrar sesiones" del usuario? Si es así, ya no es válido,
 * sin importar que no haya expirado.
 *
 * Redondea `passwordChangedAt` hacia abajo al segundo para comparar en la
 * misma unidad que `iat` (los JWT no llevan milisegundos).
 */
export function wasIssuedBeforePasswordChange(iatSeconds: number, passwordChangedAt: Date): boolean {
  const changedAtSeconds = Math.floor(passwordChangedAt.getTime() / 1000);
  return changedAtSeconds > iatSeconds;
}
