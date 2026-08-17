import { describe, expect, it } from "vitest";
import type { DocumentPrintData } from "../api/movements";
import { buildPrintPresentation, PRINT_PLATE_LABEL } from "./printDocumentModel";

function fixture(type: "ENTRY" | "EXIT"): DocumentPrintData {
  return {
    document: {
      id: "doc-1",
      code: type === "ENTRY" ? "RLNE-01-000001" : "RLNS-01-000001",
      type,
      status: "APROBADO",
      date: "2026-08-17",
      warehouseId: "warehouse-1",
      totalLines: 1,
      totalQuantity: 10,
      createdAt: "2026-08-17T12:00:00-03:00",
    },
    warehouse: { id: "warehouse-1", name: "Depósito Snapshot", documentCode: "01" },
    createdBy: { id: "user-1", username: "operador", fullName: "María Operadora" },
    encargado: { id: "user-1", username: "operador", fullName: "María Operadora" },
    logistics: {
      carrier: "TRANSPORTADORA EXACTA S.A.",
      driver: "Juan Chofer",
      driverDocument: "1234567",
      vehiclePlate: "ABC 123",
    },
    movements: [],
    details: [],
    products: [],
    lots: [],
    warehouses: [],
    pallets: [],
    locations: [],
  };
}

describe("modelo de impresión documental", () => {
  it("entrada muestra Depósito, CHAPA y solo Transportado/Recibido autocompletados", () => {
    const presentation = buildPrintPresentation(fixture("ENTRY"));

    expect(PRINT_PLATE_LABEL).toBe("CHAPA");
    expect(presentation.warehouseLabel).toBe("Depósito");
    expect(presentation.warehouseName).toBe("Depósito Snapshot");
    expect(presentation.signatures).toEqual([
      { label: "TRANSPORTADO POR", prefill: "TRANSPORTADORA EXACTA S.A." },
      { label: "RECIBIDO POR", prefill: "María Operadora" },
    ]);
    expect(presentation.signatures.some((item) => item.label === ("AUTORIZADO POR" as never))).toBe(false);
  });

  it("salida muestra Origen y autocompleta Enviado/Transportado desde snapshots", () => {
    const data = fixture("EXIT");
    data.createdBy.fullName = null;
    const presentation = buildPrintPresentation(data);

    expect(presentation.warehouseLabel).toBe("Origen");
    expect(presentation.signatures).toEqual([
      { label: "ENVIADO POR", prefill: "operador" },
      { label: "TRANSPORTADO POR", prefill: "TRANSPORTADORA EXACTA S.A." },
      { label: "RECIBIDO POR", prefill: "" },
    ]);
  });
});
