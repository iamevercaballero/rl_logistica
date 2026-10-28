import { describe, expect, it } from "vitest";
import { matchesInventorySearch } from "./inventorySearch";

const lots = [
  { lotCode: "PROV-AAA", sapLot: "Z051308201", product: { code: "50010080", description: "AZUCAR CRISTAL SACO 50 KG" } },
  { lotCode: "PROV-BBB", sapLot: "Z060108201", product: { code: "50142298", description: "ÁCIDO FOSFÓRICO" } },
  { lotCode: "LOTE-SIN-SAP", sapLot: null },
];

describe("búsqueda libre de Lotes, Lotes & SAP y Frescura", () => {
  it.each(["010080", "  azucar cristal  ", "prov-aaa", "z0513"])("encuentra por código, descripción o parte de un lote: %s", (search) => {
    expect(lots.filter((row) => matchesInventorySearch(row, search))).toEqual([lots[0]]);
  });

  it("vacío o espacios muestran todos; una búsqueda sin coincidencias no muestra ninguno", () => {
    expect(lots.filter((row) => matchesInventorySearch(row, "  "))).toEqual(lots);
    expect(lots.filter((row) => matchesInventorySearch(row, "inexistente"))).toEqual([]);
  });

  it("permite buscar lotes sin SAP o sin producto embebido", () => {
    expect(lots.filter((row) => matchesInventorySearch(row, "sin-sap"))).toEqual([lots[2]]);
  });
});
