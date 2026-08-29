import { describe, expect, it } from "vitest";
import {
  entryLotQuantity,
  palletDistributionError,
  responsibleFieldLabel,
  sapLotApplies,
  sapLotForProduct,
  showsExternalDocumentNumber,
} from "./movementFormModel";

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

describe("palletDistributionError — suma de pallets vs cantidad recibida", () => {
  it("8 pallets decimales cuya suma matemática es 4537 → sin error (el dust no cuenta)", () => {
    const pallets = ["600,5", "550,25", "700,125", "480,375", "650,75", "505,625", "549,5", "499,875"];
    expect(palletDistributionError(pallets, "4537")).toBeNull();
  });

  it("acepta coma o punto indistintamente", () => {
    expect(palletDistributionError(["1000.5", "1500,25", "2036,25"], "4537")).toBeNull();
  });

  it("0,1 + 0,2 = 0,3 → sin error", () => {
    expect(palletDistributionError(["0,1", "0,2"], "0,3")).toBeNull();
  });

  it("1000 kg repartido en decimales → sin error", () => {
    expect(palletDistributionError(["333,333", "333,333", "333,334"], "1000")).toBeNull();
  });

  it("una diferencia real de 0,1 (4.536,9 distribuidos de 4.537) → error con el desglose", () => {
    const err = palletDistributionError(["4000", "536,9"], "4537", { label: "Lote L4537-6C" });
    expect(err).toBe(
      "Lote L4537-6C: la suma de los pallets no coincide con la cantidad recibida — " +
        "distribuiste 4.536,9 de 4.537 recibidos — faltan 0,1. Ajustá las cantidades.",
    );
  });

  it("un excedente real (4.537,5 de 4.537) → 'sobran 0,5'", () => {
    const err = palletDistributionError(["4000", "537,5"], "4537");
    expect(err).toContain("sobran 0,5");
  });
});

describe("entryLotQuantity — la cantidad del lote se deriva de los pallets", () => {
  it("sin desglose, es el valor tipeado", () => {
    expect(entryLotQuantity([], "1000")).toBe(1000);
    expect(entryLotQuantity([], "3537,37")).toBe(3537.37);
    expect(entryLotQuantity([], "")).toBe(0);
  });

  it("con desglose, es la suma exacta de los pallets — no lo que se tipeó", () => {
    // Se cargó 1.000 y se repartió en 4; después se editó un pallet a 300.
    expect(entryLotQuantity(["300", "250", "250", "250"], "1000")).toBe(1050);
  });

  it("suma decimal sin residuo de coma flotante (el caso 1.000,1)", () => {
    expect(entryLotQuantity(["250,1", "250", "250", "250"], "1000")).toBe(1000.1);
    expect(entryLotQuantity(["0,1", "0,2"], "0,3")).toBe(0.3);
  });

  it("pallets en blanco cuentan como 0", () => {
    expect(entryLotQuantity(["250", "", "250", ""], "1000")).toBe(500);
  });

  it("acepta coma o punto en cada pallet", () => {
    expect(entryLotQuantity(["275,65", "285.35", "200,55", "238,45"], "")).toBe(1000);
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

describe("lote SAP según la configuración del depósito", () => {
  const SAP = "Z051308201";
  const conSap = { usesSapLot: true };
  const sinSap = { usesSapLot: false };

  it("depósito que no maneja lote SAP: no aplica ni para un material que sí lo usa", () => {
    expect(sapLotApplies(sinSap, conSap)).toBe(false);
    expect(sapLotForProduct(conSap, SAP, sinSap)).toBeUndefined();
  });

  it("depósito que lo maneja: decide el material", () => {
    expect(sapLotApplies(conSap, conSap)).toBe(true);
    expect(sapLotApplies(conSap, sinSap)).toBe(false);
    expect(sapLotForProduct(conSap, SAP, conSap)).toBe(SAP);
    expect(sapLotForProduct(sinSap, SAP, conSap)).toBeUndefined();
  });

  it("sin el dato del depósito se asume que sí lo maneja, como el default de la columna", () => {
    expect(sapLotApplies({}, conSap)).toBe(true);
    expect(sapLotApplies(null, conSap)).toBe(true);
    expect(sapLotApplies(undefined, conSap)).toBe(true);
    // Los call sites que todavía no pasan depósito se comportan igual que antes.
    expect(sapLotForProduct(conSap, SAP)).toBe(SAP);
  });
});
