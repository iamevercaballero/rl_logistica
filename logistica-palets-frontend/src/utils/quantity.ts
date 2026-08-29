import { fmtQty, fmtQtyFixed } from "./number";

/** Decimales de las columnas `numeric(14,3)` del inventario. */
export const QUANTITY_DECIMALS = 3;

const FACTOR = 10 ** QUANTITY_DECIMALS;

/** Mínimo positivo representable con 3 decimales. */
export const MIN_QUANTITY = 1 / FACTOR;

export { fmtQty, fmtQtyFixed };

/**
 * Cantidad como entero en la escala de la base (milésimas). Toda comparación y
 * suma se hace sobre estos enteros — la aritmética entera es exacta y no
 * arrastra el residuo binario de `number` (`0,1 + 0,2 === 0,30000000000000004`).
 * Espejo de `toScaledInt` del backend (misma lógica en ambos lados).
 */
export const toScaledInt = (value: number): number => Math.round(value * FACTOR);

/**
 * Redondea a la escala de la base. Igual que `roundQuantity` del backend:
 * evita que `0,1 + 0,2` se guarde como `0,30000000000000004` y que esos
 * residuos se acumulen movimiento a movimiento.
 */
export const roundQty = (value: number): number => toScaledInt(value) / FACTOR;

/**
 * `true` si las dos cantidades son iguales dentro de la precisión del negocio.
 * Compara los enteros escalados — NO `roundQty(a - b) === 0`, que restaría en
 * float primero. `4537.000000000001` y `4537` → iguales; `4537` y `4536,9` →
 * distintos (una diferencia real de 0,1 se sigue rechazando).
 */
export const quantitiesEqual = (a: number, b: number): boolean => toScaledInt(a) === toScaledInt(b);

/** `a - b` a la escala de la base, sin residuo de coma flotante. */
export const quantityDelta = (a: number, b: number): number => (toScaledInt(a) - toScaledInt(b)) / FACTOR;

/**
 * Suma exacta de cantidades: suma los enteros escalados y vuelve a decimal una
 * sola vez. `sumQuantities([275.65, 285.35, 200.55, 238.45])` da `1000` exacto.
 */
export const sumQuantities = (values: number[]): number =>
  values.reduce((acc, v) => acc + toScaledInt(v), 0) / FACTOR;

/**
 * Describe la diferencia entre lo recibido/declarado y lo distribuido en pallets
 * para el mensaje de error: cantidad recibida, total distribuido y diferencia
 * pendiente o excedente.
 */
export function quantityMismatch(received: number, distributed: number): {
  equal: boolean;
  over: boolean;
  diff: number;
  message: string;
} {
  const delta = quantityDelta(distributed, received);
  const over = delta > 0;
  return {
    equal: delta === 0,
    over,
    diff: Math.abs(delta),
    message:
      `distribuiste ${fmtQty(distributed)} de ${fmtQty(received)} recibidos` +
      (delta === 0
        ? ""
        : over
          ? ` — sobran ${fmtQty(Math.abs(delta))}`
          : ` — faltan ${fmtQty(Math.abs(delta))}`),
  };
}

// Un número plano ("1234", "1234,56", ",5"), o con separadores de miles al
// estilo es-PY ("1.234.567,89") o en ("1,234,567.89"). Cualquier otra cosa
// (separadores sueltos, grupos que no son de 3 dígitos) no es un número.
const PLAIN = /^-?(\d+([.,]\d+)?|[.,]\d+)$/;
const GROUPED_ES = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
// La agrupación con coma sólo se acepta si trae además el decimal con punto
// ("3,537.37"). Sin él, "333,333" es ambiguo y en es-PY la coma es decimal
// (→ 333,333), no separador de miles.
const GROUPED_EN = /^-?\d{1,3}(,\d{3})+\.\d+$/;

/**
 * Lleva el string a un número decimal plano con `.` como separador, o `null` si
 * no tiene forma de número.
 *
 * Con coma y punto a la vez, el que agrupa de a 3 dígitos es el de miles y el
 * otro el decimal (`3.537,37` → `3537.37`; `3,537.37` → `3537.37`). Una coma
 * sola es decimal (convención es-PY: `3537,37` → `3537.37`).
 */
function normalizeNumeric(input: string): string | null {
  const str = input.replace(/\s/g, "");
  if (str === "") return null;
  if (GROUPED_ES.test(str)) return str.replace(/\./g, "").replace(",", ".");
  if (GROUPED_EN.test(str)) return str.replace(/,/g, "");
  if (PLAIN.test(str)) return str.replace(",", ".");
  return null;
}

/**
 * Interpreta una cantidad tal como la tipeó el operador — admite coma o punto.
 *
 * - `3537,37` y `3537.37` → `3537.37`.
 * - Con separadores de miles, el decimal se deduce: `3.537,37` y `3,537.37` → `3537.37`.
 * - Un `number` finito se devuelve tal cual; lo que no parsea → `null`.
 *
 * NO redondea: preserva lo escrito para no pelear con el usuario mientras
 * completa el decimal. El redondeo a la escala de la base es de `toQtyPayload`
 * (al enviar) y de la aritmética de stock (`roundQty`).
 */
export function parseQtyInput(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;

  const normalized = normalizeNumeric(raw);
  if (normalized === null) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * `true` mientras el operador todavía está escribiendo un número y todavía no
 * hay nada que validar: vacío, sólo signo, o un decimal a medio tipear
 * (`"3537,"`, `"3537."`, `"-"`). Se usa para NO marcar el campo en rojo
 * prematuramente.
 */
export function isIncompleteQtyInput(raw: string): boolean {
  const str = raw.trim();
  if (str === "" || str === "-") return true;
  // Termina en separador decimal sin dígitos después: "3537," / "3537."
  return /[.,]$/.test(str) && parseQtyInput(str.slice(0, -1)) !== null;
}

type QtyRule = {
  /** Mínimo permitido (por defecto `MIN_QUANTITY`; usar `0` con `allowZero`). */
  min?: number;
  /** Máximo permitido, si aplica. */
  max?: number;
  /** Acepta 0 como valor válido (conteos físicos, correcciones). */
  allowZero?: boolean;
  /** El campo es obligatorio: vacío es error (una vez que dejó de escribir). */
  required?: boolean;
};

/**
 * Mensaje de error para mostrar bajo el campo, o `null` si está bien.
 * Tolerante: mientras `isIncompleteQtyInput` no exige nada.
 */
export function qtyInputError(raw: string, rule: QtyRule = {}): string | null {
  const { min = rule.allowZero ? 0 : MIN_QUANTITY, max, allowZero, required } = rule;

  if (isIncompleteQtyInput(raw)) return required && raw.trim() === "" ? "Ingresá una cantidad." : null;

  const value = parseQtyInput(raw);
  if (value === null) return "Cantidad inválida.";

  if (countQtyDecimals(raw) > QUANTITY_DECIMALS) return `Máximo ${QUANTITY_DECIMALS} decimales.`;

  if (!allowZero && value === 0) return "La cantidad debe ser mayor a cero.";
  if (value < min) return `La cantidad mínima es ${fmtQty(min)}.`;
  if (max !== undefined && roundQty(value - max) > 0) return `La cantidad máxima es ${fmtQty(max)}.`;

  return null;
}

/** Cantidad lista para enviar al backend: parseada y redondeada a la escala de la base. */
export function toQtyPayload(raw: string | number | null | undefined): number | null {
  const value = parseQtyInput(raw);
  return value === null ? null : roundQty(value);
}

/**
 * Reparte `total` en `count` porciones cuya suma es exactamente `roundQty(total)`.
 * Espejo de `distributeQuantity` del backend: totales enteros se reparten en
 * enteros (el resto de a uno en las primeras), totales con decimales reparten
 * `floor(total/count)` y ponen el residuo en la primera porción.
 */
export function distributeQty(total: number, count: number): number[] {
  if (!count || count <= 0) return [];
  const rounded = roundQty(total);
  if (rounded <= 0) return [];

  if (Number.isInteger(rounded)) {
    const base = Math.floor(rounded / count);
    const remainder = rounded - base * count;
    return Array.from({ length: count }, (_, i) => (i < remainder ? base + 1 : base));
  }

  const per = Math.floor((rounded / count) * FACTOR) / FACTOR;
  const parts = new Array<number>(count).fill(per);
  parts[0] = roundQty(rounded - per * (count - 1));
  return parts;
}

/** Cuenta los decimales efectivamente escritos (después de normalizar coma/punto). */
export function countQtyDecimals(raw: string): number {
  const normalized = normalizeNumeric(raw);
  if (normalized === null) return 0;
  const dot = normalized.indexOf(".");
  return dot === -1 ? 0 : normalized.length - dot - 1;
}
