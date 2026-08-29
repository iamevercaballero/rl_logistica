import { describe, expect, it } from "vitest";
import {
  countQtyDecimals,
  distributeQty,
  isIncompleteQtyInput,
  parseQtyInput,
  quantitiesEqual,
  quantityDelta,
  quantityMismatch,
  qtyInputError,
  roundQty,
  sumQuantities,
  toQtyPayload,
} from "./quantity";

describe("parseQtyInput — coma o punto", () => {
  it("acepta coma decimal", () => {
    expect(parseQtyInput("3537,37")).toBe(3537.37);
    expect(parseQtyInput("0,25")).toBe(0.25);
    expect(parseQtyInput("1,50")).toBe(1.5);
    expect(parseQtyInput("999999,999")).toBe(999999.999);
  });

  it("acepta punto decimal, igual que la coma", () => {
    expect(parseQtyInput("3537.37")).toBe(3537.37);
    expect(parseQtyInput("0.25")).toBe(0.25);
  });

  it("con los dos separadores, la coma es de miles", () => {
    expect(parseQtyInput("3.537,37")).toBe(3537.37);
    expect(parseQtyInput("3,537.37")).toBe(3537.37);
    expect(parseQtyInput("1.234.567,89")).toBe(1234567.89);
  });

  it("una coma sola con 3 decimales es decimal, no separador de miles (es-PY)", () => {
    expect(parseQtyInput("333,333")).toBe(333.333);
    expect(parseQtyInput("1,500")).toBe(1.5);
  });

  it("preserva la precisión — no redondea lo tipeado", () => {
    expect(parseQtyInput("3537,3714")).toBe(3537.3714);
  });

  it("vacío o basura → null", () => {
    expect(parseQtyInput("")).toBeNull();
    expect(parseQtyInput("   ")).toBeNull();
    expect(parseQtyInput("abc")).toBeNull();
    expect(parseQtyInput("-")).toBeNull();
    expect(parseQtyInput("1,2,3")).toBeNull();
    expect(parseQtyInput(null)).toBeNull();
    expect(parseQtyInput(undefined)).toBeNull();
  });

  it("un number finito pasa tal cual", () => {
    expect(parseQtyInput(42.84)).toBe(42.84);
    expect(parseQtyInput(0)).toBe(0);
    expect(parseQtyInput(NaN)).toBeNull();
  });
});

describe("isIncompleteQtyInput — mientras se tipea el decimal", () => {
  it("es incompleto si está vacío o a medio tipear", () => {
    expect(isIncompleteQtyInput("")).toBe(true);
    expect(isIncompleteQtyInput("  ")).toBe(true);
    expect(isIncompleteQtyInput("-")).toBe(true);
    expect(isIncompleteQtyInput("3537,")).toBe(true);
    expect(isIncompleteQtyInput("3537.")).toBe(true);
  });

  it("ya no es incompleto con un número terminado", () => {
    expect(isIncompleteQtyInput("3537")).toBe(false);
    expect(isIncompleteQtyInput("3537,3")).toBe(false);
    expect(isIncompleteQtyInput("0,25")).toBe(false);
  });
});

describe("qtyInputError — tolerante mientras se completa", () => {
  it("no marca error mientras el decimal está a medio tipear", () => {
    expect(qtyInputError("3537,")).toBeNull();
    expect(qtyInputError("")).toBeNull();
  });

  it("exige cantidad sólo si es obligatoria y ya se dejó vacía", () => {
    expect(qtyInputError("", { required: true })).toBe("Ingresá una cantidad.");
  });

  it("rechaza más de 3 decimales", () => {
    expect(qtyInputError("3537,3714")).toBe("Máximo 3 decimales.");
  });

  it("rechaza 0 salvo que se permita explícitamente", () => {
    expect(qtyInputError("0")).toBe("La cantidad debe ser mayor a cero.");
    expect(qtyInputError("0", { allowZero: true })).toBeNull();
  });

  it("respeta el máximo con tolerancia de coma flotante", () => {
    expect(qtyInputError("100,001", { max: 100 })).toContain("máxima");
    expect(qtyInputError("100", { max: 100 })).toBeNull();
  });

  it("acepta los valores del pedido", () => {
    for (const raw of ["0,25", "1,50", "3537,37", "999999,999"]) {
      expect(qtyInputError(raw)).toBeNull();
    }
  });
});

describe("roundQty / quantitiesEqual — sin residuo de coma flotante", () => {
  it("0,1 + 0,2 se comporta como 0,3", () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(quantitiesEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it("acumulación de muchas líneas no deriva", () => {
    let total = 0;
    for (let i = 0; i < 10; i++) total = roundQty(total + 0.1);
    expect(total).toBe(1);
  });

  it("suma de los valores del pedido", () => {
    const total = [0.25, 1.5, 3537.37, 999999.999].reduce((s, n) => roundQty(s + n), 0);
    expect(total).toBe(1003539.119);
  });

  it("un residuo de coma flotante NO cuenta como diferencia (4537,000000000001 = 4537)", () => {
    expect(quantitiesEqual(4537.000000000001, 4537)).toBe(true);
    expect(quantitiesEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it("una diferencia real de 0,1 SÍ se detecta (4537 ≠ 4536,9)", () => {
    expect(quantitiesEqual(4537, 4536.9)).toBe(false);
    expect(quantityDelta(4536.9, 4537)).toBe(-0.1);
  });
});

describe("sumQuantities — suma exacta por enteros escalados", () => {
  it("8 pallets con decimales distintos que suman 4537 kg dan 4537 exacto", () => {
    const pallets = [600.5, 550.25, 700.125, 480.375, 650.75, 505.625, 549.5, 499.875];
    // La suma float cruda derrapa (…0000001); sumQuantities es exacta.
    expect(sumQuantities(pallets)).toBe(4537);
    expect(quantitiesEqual(sumQuantities(pallets), 4537)).toBe(true);
  });

  it("el reparto de la foto (275,65 + 285,35 + 200,55 + 238,45) da 1000 exacto", () => {
    expect(sumQuantities([275.65, 285.35, 200.55, 238.45])).toBe(1000);
  });

  it("1000 kg repartido en decimales", () => {
    expect(sumQuantities([333.333, 333.333, 333.334])).toBe(1000);
  });

  it("0,1 + 0,2 = 0,3", () => {
    expect(sumQuantities([0.1, 0.2])).toBe(0.3);
  });

  it("array vacío → 0", () => {
    expect(sumQuantities([])).toBe(0);
  });
});

describe("quantityMismatch — mensaje recibida / distribuido / diferencia", () => {
  it("faltan: 4536,9 distribuidos de 4537 recibidos", () => {
    const m = quantityMismatch(4537, 4536.9);
    expect(m.equal).toBe(false);
    expect(m.over).toBe(false);
    expect(m.diff).toBe(0.1);
    expect(m.message).toBe("distribuiste 4.536,9 de 4.537 recibidos — faltan 0,1");
  });

  it("sobran: 4537,5 distribuidos de 4537 recibidos", () => {
    const m = quantityMismatch(4537, 4537.5);
    expect(m.over).toBe(true);
    expect(m.message).toBe("distribuiste 4.537,5 de 4.537 recibidos — sobran 0,5");
  });

  it("coinciden dentro de la precisión: sin sufijo de diferencia", () => {
    const m = quantityMismatch(4537, 4537.000000000001);
    expect(m.equal).toBe(true);
    expect(m.message).toBe("distribuiste 4.537 de 4.537 recibidos");
  });
});

describe("toQtyPayload — lo que se envía al backend", () => {
  it("normaliza coma a número y redondea a la escala de la base", () => {
    expect(toQtyPayload("3537,37")).toBe(3537.37);
    expect(toQtyPayload("3.537,37")).toBe(3537.37);
    expect(toQtyPayload("0,1")).toBe(0.1);
    expect(toQtyPayload("")).toBeNull();
  });
});

describe("distributeQty — reparte sin perder decimales", () => {
  it("total entero se reparte en enteros", () => {
    expect(distributeQty(100, 3)).toEqual([34, 33, 33]);
    expect(distributeQty(10, 2)).toEqual([5, 5]);
  });

  it("total decimal: el residuo va en la primera porción y la suma es exacta", () => {
    const parts = distributeQty(100.5, 2);
    expect(parts.reduce((s, n) => roundQty(s + n), 0)).toBe(100.5);
    const parts3 = distributeQty(3537.37, 3);
    expect(parts3.reduce((s, n) => roundQty(s + n), 0)).toBe(3537.37);
  });

  it("count inválido → vacío", () => {
    expect(distributeQty(100, 0)).toEqual([]);
    expect(distributeQty(0, 3)).toEqual([]);
  });
});

describe("countQtyDecimals", () => {
  it("cuenta los decimales normalizando el separador", () => {
    expect(countQtyDecimals("3537")).toBe(0);
    expect(countQtyDecimals("3537,37")).toBe(2);
    expect(countQtyDecimals("3.537,371")).toBe(3);
    expect(countQtyDecimals("3537,3714")).toBe(4);
  });
});
