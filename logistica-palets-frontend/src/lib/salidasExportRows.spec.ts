import { describe, expect, it } from "vitest";
import type { Movement } from "../api/movements";
import { buildSalidasCsv } from "./exportCsv";
import { buildSalidasExportRows, DOCUMENTO_MATERIAL_PENDING } from "./salidasExportRows";

function movement(documentoMaterial?: string | null): Movement {
  return {
    id: "movement-1",
    type: "EXIT",
    status: "NORMAL",
    date: "2026-08-17",
    createdAt: "2026-08-17T12:00:00-03:00",
    quantity: 10,
    pallets: 1,
    documentoMaterial,
    material: { id: "product-1", code: "MAT-01", description: "Material", unitOfMeasure: "UN" },
    lotsDetail: [{ lotCode: "LOTE-1", sapLot: "SAP-1", pallets: 1, quantity: 10 }],
  };
}

describe("lote SAP en el export de salidas", () => {
  it("material o depósito sin Lote SAP: el export no lo muestra aunque el lote lo tenga guardado", () => {
    const sinMaterial = movement(null);
    sinMaterial.material = { ...sinMaterial.material, usesSapLot: false };
    expect(buildSalidasExportRows([sinMaterial])[0].sapLot).toBe("-");

    const sinDeposito = movement(null);
    sinDeposito.warehouse = { id: "wh-1", name: "Depósito", usesSapLot: false };
    expect(buildSalidasExportRows([sinDeposito])[0].sapLot).toBe("-");
  });

  it("depósito y material con Lote SAP: el export lo muestra como siempre", () => {
    const m = movement(null);
    m.warehouse = { id: "wh-1", name: "Depósito", usesSapLot: true };
    m.material = { ...m.material, usesSapLot: true };
    expect(buildSalidasExportRows([m])[0].sapLot).toBe("SAP-1");
  });
});

describe("exportación de salidas", () => {
  it("marca Documento Material vacío como Pendiente", () => {
    expect(buildSalidasExportRows([movement(null)])[0].documentoMaterial)
      .toBe(DOCUMENTO_MATERIAL_PENDING);
  });

  it("incluye Documento Material tanto en las filas como en CSV", () => {
    const rows = buildSalidasExportRows([movement("4900123456")]);
    expect(rows[0].documentoMaterial).toBe("4900123456");
    expect(buildSalidasCsv([movement("4900123456")])).toContain('"Documento Material"');
    expect(buildSalidasCsv([movement("4900123456")])).toContain('"4900123456"');
  });
});
