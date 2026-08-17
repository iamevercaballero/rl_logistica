import { describe, expect, it } from "vitest";
import { responsibleFieldLabel, showsExternalDocumentNumber } from "./movementFormModel";

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
