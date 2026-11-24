import { describe, expect, it } from "vitest";
import { quantityNumFmt } from "./exportExcel";

describe("quantityNumFmt — formato de cantidad en Excel", () => {
  it("enteras sin decimales, decimales con los que traen", () => {
    expect(quantityNumFmt(114)).toBe("#,##0");
    expect(quantityNumFmt(2721.6)).toBe("#,##0.0");
    expect(quantityNumFmt(1264.15)).toBe("#,##0.00");
    expect(quantityNumFmt(2050.035)).toBe("#,##0.000");
  });

  it("una diferencia negativa conserva sus decimales", () => {
    expect(quantityNumFmt(-4.8)).toBe("#,##0.0");
    expect(quantityNumFmt(-12)).toBe("#,##0");
  });
});
