/** Decimales admitidos por las columnas `numeric(14,3)` del inventario. */
export const QUANTITY_SCALE = 3;

/** Precisión total de esas columnas — `numeric(QUANTITY_PRECISION, QUANTITY_SCALE)`. */
export const QUANTITY_PRECISION = 14;

const FACTOR = 10 ** QUANTITY_SCALE;

/** Mínimo positivo representable con `QUANTITY_SCALE` decimales — descarta 0 y negativos. */
export const MIN_QUANTITY = 1 / FACTOR;

/** Opciones de `@IsNumber` para cantidades del inventario (hasta 3 decimales). */
export const QUANTITY_NUMBER_OPTIONS = { maxDecimalPlaces: QUANTITY_SCALE } as const;

/** Escala de `pallets.weightKg` / `locations.*` — `numeric(10,2)`. */
export const WEIGHT_SCALE = 2;

/** Opciones de `@IsNumber` para pesos (hasta 2 decimales). */
export const WEIGHT_NUMBER_OPTIONS = { maxDecimalPlaces: WEIGHT_SCALE } as const;

/**
 * Cantidad expresada como entero en la escala de la base (milésimas para
 * `numeric(_,3)`). Toda comparación y suma de cantidades se hace sobre estos
 * enteros: la aritmética entera es exacta y no arrastra el residuo binario de
 * `number` (`0.1 + 0.2 === 0.30000000000000004`).
 *
 * `numeric(14,3)` tope ~1e11, `* 1000` = ~1e14 < `Number.MAX_SAFE_INTEGER` (9e15).
 */
export function toScaledInt(value: number): number {
  return Math.round(value * FACTOR);
}

/**
 * Redondea una cantidad a la precisión que soporta la base.
 *
 * Sin redondear, los residuos de coma flotante se acumulan movimiento a
 * movimiento y terminan apareciendo como diferencias de inventario fantasma o
 * como un "stock insuficiente" al despachar exactamente lo que hay disponible.
 */
export function roundQuantity(value: number): number {
  return toScaledInt(value) / FACTOR;
}

/**
 * `true` si las dos cantidades son iguales dentro de la precisión del negocio.
 *
 * Compara los enteros escalados — NO `roundQuantity(a - b) === 0`, que restaría
 * en float primero. `4537.000000000001` y `4537` dan ambos `4537000` → iguales;
 * `4537` y `4536.9` dan `4537000` ≠ `4536900` → distintos (una diferencia real
 * de 0,1 kg se sigue rechazando).
 */
export function quantitiesEqual(a: number, b: number): boolean {
  return toScaledInt(a) === toScaledInt(b);
}

/** `a - b` a la escala de la base, sin residuo de coma flotante. */
export function quantityDelta(a: number, b: number): number {
  return (toScaledInt(a) - toScaledInt(b)) / FACTOR;
}

/**
 * Suma exacta de cantidades: suma los enteros escalados y vuelve a decimal una
 * sola vez. `sumQuantities([275.65, 285.35, 200.55, 238.45])` da `1000` exacto,
 * no `1000.0000000001`.
 */
export function sumQuantities(values: number[]): number {
  return values.reduce((acc, v) => acc + toScaledInt(v), 0) / FACTOR;
}

const quantityFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: QUANTITY_SCALE,
});

/** Cantidad en formato regional para mensajes de error del servicio ("4.536,9"). */
export function formatQuantity(value: number): string {
  return quantityFormatter.format(roundQuantity(value));
}

/**
 * Describe una diferencia entre lo recibido/declarado y lo distribuido en
 * pallets, para el mensaje de error (requisito: recibida / distribuido /
 * pendiente o excedente).
 */
export function quantityMismatch(
  received: number,
  distributed: number,
): { equal: boolean; over: boolean; diff: number; message: string } {
  const delta = quantityDelta(distributed, received);
  const over = delta > 0;
  return {
    equal: delta === 0,
    over,
    diff: Math.abs(delta),
    message:
      `distribuido ${formatQuantity(distributed)} de ${formatQuantity(received)} recibidos` +
      (delta === 0
        ? ''
        : over
          ? ` — sobran ${formatQuantity(Math.abs(delta))}`
          : ` — faltan ${formatQuantity(Math.abs(delta))}`),
  };
}

/**
 * Reparte `total` en `count` porciones cuya suma es exactamente
 * `roundQuantity(total)` — sin perder decimales por el reparto.
 *
 * - Si `total` es entero, reparte en enteros (el resto se suma de a uno en las
 *   primeras porciones), como venía haciéndose para conteos de unidades.
 * - Si `total` tiene decimales, cada porción es `floor(total / count)` a la
 *   escala de la base y el residuo va en la primera.
 */
export function distributeQuantity(total: number, count: number): number[] {
  if (count <= 0) return [];
  const rounded = roundQuantity(total);

  if (Number.isInteger(rounded)) {
    const base = Math.floor(rounded / count);
    const remainder = rounded - base * count;
    return Array.from({ length: count }, (_, i) => (i < remainder ? base + 1 : base));
  }

  const per = Math.floor((rounded / count) * FACTOR) / FACTOR;
  const parts = new Array<number>(count).fill(per);
  parts[0] = roundQuantity(rounded - per * (count - 1));
  return parts;
}

// Un número plano ("1234", "1234,56", ",5"), o con separadores de miles al
// estilo es-PY ("1.234.567,89") o en ("1,234,567.89"). Un separador suelto o
// grupos que no son de 3 dígitos no son un número.
const PLAIN = /^-?(\d+([.,]\d+)?|[.,]\d+)$/;
const GROUPED_ES = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
// La agrupación con coma sólo se acepta con el decimal en punto ("3,537.37").
// Sin él, "333,333" es ambiguo y en es-PY la coma es decimal, no de miles.
const GROUPED_EN = /^-?\d{1,3}(,\d{3})+\.\d+$/;

/**
 * Interpreta una cantidad tipeada por un humano — admite coma o punto decimal.
 *
 * - `3537,37` y `3537.37` → `3537.37`.
 * - Con separadores de miles el decimal se deduce: `3.537,37` y `3,537.37` → `3537.37`.
 * - Un `number` finito se devuelve tal cual; cualquier cosa que no parsea → `null`.
 *
 * NO redondea a la escala de la base: preserva lo que el usuario escribió para
 * que la validación (`@IsNumber({ maxDecimalPlaces })`) pueda rechazar un exceso
 * de decimales en vez de recortarlo en silencio. El redondeo a `QUANTITY_SCALE`
 * es responsabilidad de la aritmética de stock (`roundQuantity`).
 */
export function parseQuantity(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const str = value.replace(/\s/g, '');
  if (!str) return null;

  let normalized: string;
  if (GROUPED_ES.test(str)) normalized = str.replace(/\./g, '').replace(',', '.');
  else if (GROUPED_EN.test(str)) normalized = str.replace(/,/g, '');
  else if (PLAIN.test(str)) normalized = str.replace(',', '.');
  else return null;

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
