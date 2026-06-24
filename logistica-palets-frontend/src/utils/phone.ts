/**
 * Formato de teléfono de Paraguay: +595 981 123456.
 * Acepta entradas con 0 inicial (0981...), con 595, o solo el número, y
 * normaliza a "+595 XXX XXXXXX" mientras el usuario escribe.
 */
export function formatParaguayPhone(raw: string): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("595")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 9); // 9 dígitos nacionales (ej: 981123456)

  if (!digits) return "";
  const part1 = digits.slice(0, 3);
  const part2 = digits.slice(3, 9);
  let out = "+595";
  if (part1) out += ` ${part1}`;
  if (part2) out += ` ${part2}`;
  return out;
}

/** Valida que el teléfono tenga +595 y 8-9 dígitos nacionales. */
export function isValidParaguayPhone(value: string): boolean {
  const digits = (value ?? "").replace(/\D/g, "");
  return /^595\d{8,9}$/.test(digits);
}
