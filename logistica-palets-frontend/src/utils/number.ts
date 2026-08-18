const nf = new Intl.NumberFormat("es-PY");

/** Cantidades del depósito: formato es-PY y 3 decimales, la escala de `numeric(14,3)`. */
export const fmtQty = (value: number) => nf.format(Math.round(value * 1000) / 1000);

const nfFixed = new Intl.NumberFormat("es-PY", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/**
 * Misma cantidad que `fmtQty` pero con los 3 decimales siempre visibles
 * ("2.117,200 KG" en vez de "2.117,2 KG").
 *
 * Es para documentos impresos que se firman, donde la escala tiene que quedar
 * explícita en el papel: sin los ceros de relleno, "2.117,2" se puede leer como
 * una cantidad truncada. No usarla para conteos (pallets, ubicaciones): ahí los
 * decimales no significan nada y `fmtQty` es lo correcto.
 */
export const fmtQtyFixed = (value: number) => nfFixed.format(value);
