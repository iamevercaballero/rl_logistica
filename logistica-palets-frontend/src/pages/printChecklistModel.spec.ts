import { describe, expect, it } from "vitest";
import type { ChecklistLotRow, ChecklistMaterialRow } from "../api/movements";
import {
  CHECKLIST_LOT_ROWS_CONTINUATION,
  CHECKLIST_LOT_ROWS_FIRST_PAGE,
  irBlockGoesOnOwnPage,
  materialFillerRows,
  paginateChecklistLots,
} from "./printChecklistModel";

function lotRows(count: number): ChecklistLotRow[] {
  return Array.from({ length: count }, (_, index) => ({
    productId: "product-1",
    productCode: "50144376",
    productDescription: "INTERLAYER CARTON 116 X 97M.",
    unitOfMeasure: "UN",
    lotId: `lot-${index}`,
    lotCode: `L${String(index + 1).padStart(3, "0")}`,
    sapLot: null,
    fechaFabricacion: "2026-08-10",
    fechaVencimiento: "2027-08-15",
    quantity: 100 + index,
    pallets: 1,
  }));
}

function material(code: string): ChecklistMaterialRow {
  return {
    productId: `p-${code}`,
    code,
    description: `Material ${code}`,
    unitOfMeasure: "UN",
    totalQuantity: 100,
    totalPallets: 1,
  };
}

describe("paginación del checklist de recepción", () => {
  it("una entrada chica entra en una sola hoja y se completa con filas en blanco", () => {
    const pages = paginateChecklistLots(lotRows(3));

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ index: 1, continuation: false, fillerRows: 5 });
    expect(pages[0].rows).toHaveLength(3);
    expect(irBlockGoesOnOwnPage(pages)).toBe(false);
  });

  it("una entrada sin lotes deja la tabla en blanco pero imprime la hoja", () => {
    const pages = paginateChecklistLots([]);

    expect(pages).toHaveLength(1);
    expect(pages[0].rows).toHaveLength(0);
    expect(pages[0].fillerRows).toBeGreaterThan(0);
  });

  it("la hoja llena no agrega continuación vacía", () => {
    const pages = paginateChecklistLots(lotRows(CHECKLIST_LOT_ROWS_FIRST_PAGE));

    expect(pages).toHaveLength(1);
    expect(pages[0].rows).toHaveLength(CHECKLIST_LOT_ROWS_FIRST_PAGE);
    expect(pages[0].fillerRows).toBe(0);
  });

  it("Caso 12: muchos lotes abren hojas de continuación sin perder ninguna fila", () => {
    const rows = lotRows(120);
    const pages = paginateChecklistLots(rows);

    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0].continuation).toBe(false);
    expect(pages.slice(1).every((page) => page.continuation)).toBe(true);

    const printed = pages.flatMap((page) => page.rows);
    expect(printed).toHaveLength(rows.length);
    expect(printed.map((row) => row.lotCode)).toEqual(rows.map((row) => row.lotCode));
    // Ninguna hoja excede su capacidad: nada se aprieta ni se oculta.
    expect(pages.every((page) => page.rows.length <= CHECKLIST_LOT_ROWS_CONTINUATION)).toBe(true);
  });

  it("el bloque 23 se muda a su propia hoja cuando la última quedó llena", () => {
    const full = paginateChecklistLots(
      lotRows(CHECKLIST_LOT_ROWS_FIRST_PAGE + CHECKLIST_LOT_ROWS_CONTINUATION),
    );
    expect(irBlockGoesOnOwnPage(full)).toBe(true);

    const roomy = paginateChecklistLots(lotRows(CHECKLIST_LOT_ROWS_FIRST_PAGE + 2));
    expect(roomy).toHaveLength(2);
    expect(irBlockGoesOnOwnPage(roomy)).toBe(false);
  });
});

describe("tabla de materiales del punto 20", () => {
  it("mantiene el mínimo de filas del formulario original", () => {
    expect(materialFillerRows([])).toBe(3);
    expect(materialFillerRows([material("A")])).toBe(2);
    expect(materialFillerRows([material("A"), material("B"), material("C")])).toBe(0);
    // Con más materiales que el mínimo no se recorta ni se agrega relleno.
    expect(materialFillerRows([material("A"), material("B"), material("C"), material("D")])).toBe(0);
  });
});
