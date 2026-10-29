import { describe, expect, it } from "vitest";
import { matchesInventorySearch, matchesPalletSearch } from "./inventorySearch";

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

const pallets = [
  { code: "PAL-0001", productCode: "50010080", productDescription: "AZUCAR CRISTAL SACO 50 KG", lotCode: "PROV-AAA", sapLot: "Z051308201", locationCode: "A-01-02" },
  { code: "PAL-0002", productCode: "50142298", productDescription: "ACIDO FOSFORICO", lotCode: "PROV-BBB", sapLot: null, locationCode: null },
];

describe("búsqueda libre de Palets", () => {
  it.each(["pal-0001", "010080", "azucar", "prov-aaa", "z0513", "a-01"])("encuentra por palet, material, lote, lote SAP o ubicación: %s", (search) => {
    expect(pallets.filter((row) => matchesPalletSearch(row, search))).toEqual([pallets[0]]);
  });

  it("tolera el palet sin ubicación y sin lote SAP", () => {
    expect(pallets.filter((row) => matchesPalletSearch(row, "fosforico"))).toEqual([pallets[1]]);
    expect(pallets.filter((row) => matchesPalletSearch(row, "  "))).toEqual(pallets);
  });
});
