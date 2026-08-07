const nf = new Intl.NumberFormat("es-PY");

/** Cantidades del depósito: formato es-PY y 3 decimales, la escala de `numeric(14,3)`. */
export const fmtQty = (value: number) => nf.format(Math.round(value * 1000) / 1000);
