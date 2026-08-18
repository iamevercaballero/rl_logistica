import { describe, expect, it } from "vitest";
import { fmtQty, fmtQtyFixed } from "./number";

describe("formato de cantidades", () => {
  it("fmtQty muestra solo los decimales que existen", () => {
    expect(fmtQty(2117.2)).toBe("2.117,2");
    expect(fmtQty(24)).toBe("24");
    expect(fmtQty(1058.605)).toBe("1.058,605");
  });

  it("fmtQtyFixed deja siempre los 3 decimales de numeric(14,3)", () => {
    expect(fmtQtyFixed(2117.2)).toBe("2.117,200");
    expect(fmtQtyFixed(1058.605)).toBe("1.058,605");
    expect(fmtQtyFixed(500)).toBe("500,000");
    expect(fmtQtyFixed(0.5)).toBe("0,500");
  });

  it("fmtQtyFixed no pierde ni inventa precisión al redondear", () => {
    // Residuo de coma flotante: 0,1 + 0,2 no debe imprimirse como 0,300000004.
    expect(fmtQtyFixed(0.1 + 0.2)).toBe("0,300");
    expect(fmtQtyFixed(1234567.89)).toBe("1.234.567,890");
  });
});
