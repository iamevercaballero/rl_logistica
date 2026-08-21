import type { DocumentPrintData, PrintDetail, PrintUserSnapshot } from "../api/movements";

export const PRINT_PLATE_LABEL = "CHAPA";

export type PrintSignatureBlock = {
  label: "TRANSPORTADO POR" | "RECIBIDO POR" | "ENVIADO POR";
  prefill: string;
  /**
   * Segunda línea, más chica. En "TRANSPORTADO POR" es la transportadora: quien
   * firma es el chofer, pero la empresa sigue siendo un dato de la nota.
   */
  subline?: string;
  /**
   * RUC/CI ya conocido — la línea sale completa en vez de en blanco. Solo se
   * llena cuando el dato está cargado; si no, queda el renglón para escribirlo.
   */
  document?: string;
};

export function printUserName(user: PrintUserSnapshot): string {
  return user.fullName?.trim() || user.username;
}

/**
 * Bloque "TRANSPORTADO POR": lo firma **el conductor**, no la transportadora.
 * Quien recibe o entrega la carga es una persona con nombre y cédula, y es esa
 * persona la que firma el remito; la transportadora es la empresa detrás y baja
 * a una segunda línea. Antes se prellenaba con la transportadora, y el renglón
 * de RUC/CI quedaba siempre vacío aunque la cédula estuviera cargada.
 *
 * Si el remito no trae conductor (remitos viejos, o carga sin chofer
 * identificado) se cae a la transportadora: es preferible a dejar el bloque en
 * blanco, y ahí no hay cédula que prellenar.
 */
function transportedBy(data: DocumentPrintData): PrintSignatureBlock {
  const { carrier, driver, driverDocument } = data.logistics;
  const driverName = driver?.trim() ?? "";
  const carrierName = carrier?.trim() ?? "";

  if (!driverName) {
    return { label: "TRANSPORTADO POR", prefill: carrierName };
  }
  return {
    label: "TRANSPORTADO POR",
    prefill: driverName,
    subline: carrierName || undefined,
    document: driverDocument?.trim() || undefined,
  };
}

/** Etiquetas y firmas dependen del tipo, pero siempre leen snapshots del API. */
export function buildPrintPresentation(data: DocumentPrintData): {
  warehouseLabel: "Depósito" | "Origen";
  warehouseName: string;
  signatures: PrintSignatureBlock[];
} {
  const isEntry = data.document.type === "ENTRY";
  const creatorName = printUserName(data.createdBy);

  return {
    warehouseLabel: isEntry ? "Depósito" : "Origen",
    warehouseName: data.warehouse?.name ?? "—",
    signatures: isEntry
      ? [
          transportedBy(data),
          { label: "RECIBIDO POR", prefill: creatorName },
        ]
      : [
          { label: "ENVIADO POR", prefill: creatorName },
          transportedBy(data),
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
 * `informed` es `false` cuando ningún palet de la línea trae el dato — ahí no
 * hay número físico que mostrar, y `effectivePalletCount` cae al conteo de
 * origen.
 */
export function dispatchedPalletsOf(details: PrintDetail[]): { informed: boolean; total: number } {
  const informed = details.some((detail) => detail.dispatchedPallets != null);
  if (!informed) return { informed: false, total: 0 };
  return {
    informed: true,
    total: details.reduce((sum, detail) => sum + (detail.dispatchedPallets ?? 1), 0),
  };
}

/**
 * Cuántos pallets mostrar en la nota — un solo número, no dos.
 *
 * Mostrar "2" (pallets de origen consumidos) junto con "→ 7 fís." (paletas
 * físicas informadas) obligaba a leer y sumar dos cifras para algo que la nota
 * solo necesita decir una vez: cuántos pallets salieron. Si se informó cómo
 * quedó armada la carga, esa es la cifra que importa — reemplaza a la de
 * origen, no la acompaña. Sin ese dato, se estira del origen del pallet, como
 * siempre se hizo.
 */
export function effectivePalletCount(
  palletCount: number,
  dispatched: { informed: boolean; total: number },
): number {
  return dispatched.informed ? dispatched.total : palletCount;
}
