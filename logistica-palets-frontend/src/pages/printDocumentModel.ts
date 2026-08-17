import type { DocumentPrintData, PrintUserSnapshot } from "../api/movements";

export const PRINT_PLATE_LABEL = "CHAPA";

export type PrintSignatureBlock = {
  label: "TRANSPORTADO POR" | "RECIBIDO POR" | "ENVIADO POR";
  prefill: string;
};

export function printUserName(user: PrintUserSnapshot): string {
  return user.fullName?.trim() || user.username;
}

/** Etiquetas y firmas dependen del tipo, pero siempre leen snapshots del API. */
export function buildPrintPresentation(data: DocumentPrintData): {
  warehouseLabel: "Depósito" | "Origen";
  warehouseName: string;
  signatures: PrintSignatureBlock[];
} {
  const isEntry = data.document.type === "ENTRY";
  const creatorName = printUserName(data.createdBy);
  const carrier = data.logistics.carrier ?? "";

  return {
    warehouseLabel: isEntry ? "Depósito" : "Origen",
    warehouseName: data.warehouse?.name ?? "—",
    signatures: isEntry
      ? [
          { label: "TRANSPORTADO POR", prefill: carrier },
          { label: "RECIBIDO POR", prefill: creatorName },
        ]
      : [
          { label: "ENVIADO POR", prefill: creatorName },
          { label: "TRANSPORTADO POR", prefill: carrier },
          { label: "RECIBIDO POR", prefill: "" },
        ],
  };
}
