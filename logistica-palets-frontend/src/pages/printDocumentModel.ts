import type { DocumentPrintData, PrintDetail, PrintUserSnapshot } from "../api/movements";

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

/**
 * SALIDA — paletas físicas con las que se despachó una línea.
 *
 * `dispatchedPallets` se informa por palet de origen y es opcional: describe
 * cómo quedó armada la carga, sin tocar el descuento de stock ni de palets. Un
 * palet sin el dato cuenta como una paleta, que es lo que pasa si nadie tocó
 * nada.
 *
 * `informed` es `false` cuando ningún palet de la línea trae el dato: ahí la
 * nota no muestra nada extra y sale exactamente igual que siempre.
 */
export function dispatchedPalletsOf(details: PrintDetail[]): { informed: boolean; total: number } {
  const informed = details.some((detail) => detail.dispatchedPallets != null);
  if (!informed) return { informed: false, total: 0 };
  return {
    informed: true,
    total: details.reduce((sum, detail) => sum + (detail.dispatchedPallets ?? 1), 0),
  };
}
