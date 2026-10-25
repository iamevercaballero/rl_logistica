/**
 * El peso del palet es `numeric(10,2)`, no `numeric(14,3)`.
 *
 * El campo de peso reusa `QuantityInput`, que por defecto valida con la escala
 * del inventario. Con tres decimales la pantalla lo daba por bueno y el backend
 * lo rechazaba con "weightKg must be a number conforming to the specified
 * constraints" — un mensaje en inglés que no dice qué corregir.
 *
 * Se notaba tipeando el peso con la coma como separador de miles: en es-PY la
 * coma es decimal, así que "12,345" vale 12,345 kg (tres decimales) y reventaba,
 * mientras que "12.345" se lee como 12.345 kg y pasaba. De ahí la impresión de
 * que "no deja cargar el peso con coma".
 */
import { describe, expect, it } from "vitest";
import { PESO_LABEL, qtyInputError, toQtyPayload, toWeightPayload, WEIGHT_DECIMALS } from "./quantity";

const PESO = { decimals: WEIGHT_DECIMALS, allowZero: true, label: PESO_LABEL };

describe("toWeightPayload", () => {
  it("redondea a la escala de la columna de peso, no a la del inventario", () => {
    expect(toWeightPayload("25,125")).toBe(25.13);
    expect(toQtyPayload("25,125")).toBe(25.125); // lo que se enviaba antes
  });

  it.each([
    ["25,5", 25.5],
    ["25.5", 25.5],
    ["906,05", 906.05],
    ["1.250,75", 1250.75],
    ["850", 850],
    ["0", 0],
  ])("acepta %s como %s", (raw, esperado) => {
    expect(toWeightPayload(raw)).toBe(esperado);
  });

  it("nunca devuelve más de dos decimales", () => {
    for (const raw of ["1,005", "0,999", "12,345", "99,999", "1.234,5678"]) {
      const valor = toWeightPayload(raw)!;
      const decimales = (String(valor).split(".")[1] ?? "").length;
      expect(decimales).toBeLessThanOrEqual(WEIGHT_DECIMALS);
    }
  });

  it("lo que no es un número sigue siendo null", () => {
    expect(toWeightPayload("")).toBeNull();
    expect(toWeightPayload("abc")).toBeNull();
    expect(toWeightPayload(null)).toBeNull();
  });
});

describe("qtyInputError con la escala del peso", () => {
  it("avisa en castellano antes de que el backend lo rechace", () => {
    expect(qtyInputError("12,345", PESO)).toBe("El peso admite hasta 2 decimales.");
  });

  it("el mismo valor es válido como cantidad de inventario", () => {
    expect(qtyInputError("12,345", { allowZero: true })).toBeNull();
  });

  it.each(["25,5", "906,05", "1.250,75", "850", "0"])("no se queja de %s", (raw) => {
    expect(qtyInputError(raw, PESO)).toBeNull();
  });

  it("mientras se escribe el decimal no marca error", () => {
    expect(qtyInputError("25,", PESO)).toBeNull();
  });

  it("usa el nombre del campo en el mensaje", () => {
    expect(qtyInputError("abc", PESO)).toBe("Peso inválido.");
    expect(qtyInputError("abc", {})).toBe("Cantidad inválida.");
  });
});
