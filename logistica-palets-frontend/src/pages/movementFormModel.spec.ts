import { describe, expect, it } from "vitest";
import { sapLotForProduct, responsibleFieldLabel, showsExternalDocumentNumber } from "./movementFormModel";

describe("modelo del formulario de remitos", () => {
  it("muestra N° MIC/Factura/Remito únicamente en Entrada", () => {
    expect(showsExternalDocumentNumber("ENTRY")).toBe(true);
    expect(showsExternalDocumentNumber("EXIT")).toBe(false);
  });

  it("nombra el responsable según la operación", () => {
    expect(responsibleFieldLabel("ENTRY")).toBe("Encargado de recepción");
    expect(responsibleFieldLabel("EXIT")).toBe("Encargado de envío");
  });
});

describe("lote SAP según la configuración del material", () => {
  const SAP = "Z051308201";

  it("material que usa lote SAP: manda el de cabecera", () => {
    expect(sapLotForProduct({ usesSapLot: true }, SAP)).toBe(SAP);
    expect(sapLotForProduct({ usesSapLot: true }, `  ${SAP}  `)).toBe(SAP);
  });

  it("material que no usa lote SAP: no manda nada aunque la cabecera lo tenga", () => {
    expect(sapLotForProduct({ usesSapLot: false }, SAP)).toBeUndefined();
  });

  it("cabecera vacía nunca manda un string vacío", () => {
    expect(sapLotForProduct({ usesSapLot: true }, "")).toBeUndefined();
    expect(sapLotForProduct({ usesSapLot: true }, "   ")).toBeUndefined();
  });

  it("sin el dato del material se asume que sí lo usa, como el default de la columna", () => {
    expect(sapLotForProduct({}, SAP)).toBe(SAP);
    expect(sapLotForProduct(null, SAP)).toBe(SAP);
    expect(sapLotForProduct(undefined, SAP)).toBe(SAP);
  });

  it("entrada multi-producto: cada material resuelve el suyo", () => {
    const conSap = { usesSapLot: true };
    const sinSap = { usesSapLot: false };
    expect([conSap, sinSap, conSap].map((p) => sapLotForProduct(p, SAP)))
      .toEqual([SAP, undefined, SAP]);
  });
});
