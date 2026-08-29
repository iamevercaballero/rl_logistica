/**
 * CHECKLIST DE RECEPCIÓN DE INSUMOS — armado del documento imprimible.
 *
 * Reproduce el formulario "Condiciones de Recepciones de Insumos" del cliente
 * (planilla Excel de 2 páginas) con los datos que RL Logística ya registró en
 * la Entrada. El checklist NO es un movimiento nuevo: es otra representación
 * imprimible de un RLNE existente, así que acá no se toca stock, lotes,
 * pallets ni pilas — solo se leen y se resuelven.
 *
 * Este módulo es una función pura sobre lo que devuelve `buildDocumentForPrint`
 * para que las reglas de resumen (cuándo un campo de la Página 1 se completa y
 * cuándo dice "VER DETALLES") sean testeables sin base de datos.
 *
 * Fechas: `fechaFabricacion` y `fechaVencimiento` son fechas calendario
 * ("YYYY-MM-DD") y viajan como string tal cual llegan de la base. Convertirlas
 * a `Date` acá las anclaría a medianoche UTC y al imprimirlas en Asunción
 * (UTC-3) retrocederían un día. El formateo DD/MM/AAAA es responsabilidad del
 * frontend (`formatDateOnly`), que ya distingue fecha calendario de instante.
 */

import { quantitiesEqual, quantityMismatch, roundQuantity, sumQuantities } from '../../common/quantity';

export const CHECKLIST_SEE_DETAILS = 'VER DETALLES';

/**
 * País de procedencia del punto 4. Hoy es una constante porque la Entrada no
 * registra procedencia; el día que exista un catálogo (proveedor → país, o un
 * campo propio del RLNE) se reemplaza únicamente esta resolución.
 */
export const CHECKLIST_DEFAULT_COUNTRY = 'PARAGUAY';

type DocumentLike = {
  id: string;
  code: string;
  type: string;
  status: string;
  date: Date | string;
  documentNumber?: string | null;
  supplier?: string | null;
  carrier?: string | null;
  driver?: string | null;
  driverDocument?: string | null;
  vehiclePlate?: string | null;
  notes?: string | null;
  totalLines: number;
  totalQuantity: number;
};

type MovementLike = {
  id: string;
  productId: string;
  quantity: number;
  pallets?: number | null;
  lotId?: string | null;
};

type DetailLike = {
  movementId: string;
  lotId?: string | null;
  palletId?: string | null;
  quantity: number;
};

type ProductLike = {
  id: string;
  code: string;
  description: string;
  unitOfMeasure?: string | null;
  /** Ver `products/uses-sap-lot.ts`. En `false` el material nunca recibe Lote SAP. */
  usesSapLot: boolean;
};
type LotLike = {
  id: string;
  lotCode: string;
  sapLot?: string | null;
  fechaFabricacion?: string | null;
  fechaVencimiento?: string | null;
};
type PalletLike = { id: string; lotId: string };
type UserSnapshot = { id: string; username: string; fullName: string | null };
type WarehouseSnapshot = { id: string | null; name: string; documentCode: string | null } | null;

export type ChecklistInput = {
  document: DocumentLike;
  warehouse: WarehouseSnapshot;
  createdBy: UserSnapshot;
  encargado: UserSnapshot | null;
  movements: MovementLike[];
  details: DetailLike[];
  products: ProductLike[];
  lots: LotLike[];
  pallets: PalletLike[];
};

/** Una fila del punto 22 (LOTES POR PALETAS): un material dentro de un lote. */
export type ChecklistLotRow = {
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  lotId: string | null;
  lotCode: string | null;
  sapLot: string | null;
  fechaFabricacion: string | null;
  fechaVencimiento: string | null;
  quantity: number;
  pallets: number;
};

/** Una fila del punto 20 (Materiales): un material con todos sus lotes sumados. */
export type ChecklistMaterialRow = {
  productId: string;
  code: string;
  description: string;
  unitOfMeasure: string | null;
  totalQuantity: number;
  totalPallets: number;
};

/** Campos de cabecera de la Página 1 que se resuelven o dicen "VER DETALLES". */
export type ChecklistSummary = {
  productDisplay: string | null;
  lotDisplay: string | null;
  fabricationDisplay: string | null;
  expirationDisplay: string | null;
  sapLotDisplay: string | null;
  totalPallets: number;
  totalQuantity: number;
};

/**
 * Reconciliación con el inventario ya registrado. No corrige nada: solo informa
 * si lo que se va a imprimir cuadra con la cabecera del RLNE, para que la hoja
 * salga marcada en vez de mostrar totales falsos como si fueran ciertos.
 */
export type ChecklistConsistency = {
  ok: boolean;
  documentTotalQuantity: number;
  computedTotalQuantity: number;
  documentTotalPallets: number;
  computedTotalPallets: number;
  warnings: string[];
};

export type ReceptionChecklist = {
  document: {
    id: string;
    code: string;
    type: string;
    status: string;
    /** Instante de la recepción — se formatea en America/Asuncion. */
    date: string;
    /** Punto 11 y punto 12: hoy Arribo = Descarga = fecha de la Entrada. */
    arrivalDate: string;
    unloadDate: string;
    warehouse: WarehouseSnapshot;
    supplier: string | null;
    /** Punto 2: en el formulario es "N° de Factura"; en RL Logística, MIC/Factura/Remito. */
    documentNumber: string | null;
    /** Punto 3: el N° de MIC propio no se registra en la Entrada — se completa a mano. */
    micNumber: null;
    /** Punto 4. */
    originCountry: string;
    carrier: string | null;
    vehiclePlate: string | null;
    driver: string | null;
    driverDocument: string | null;
    notes: string | null;
  };
  createdBy: UserSnapshot;
  encargado: UserSnapshot | null;
  /**
   * Punto 26: el encargado de recepción elegido en la Entrada — no quien la
   * registró ni quien reimprime. Sale del snapshot del RLNE, así que no cambia
   * si el usuario después se renombra o se desactiva. "No especificado" solo
   * para RLNE anteriores a que el campo fuera obligatorio.
   */
  receptionResponsible: string;
  summary: ChecklistSummary;
  materials: ChecklistMaterialRow[];
  lots: ChecklistLotRow[];
  consistency: ChecklistConsistency;
};

/** Texto vacío → null, para que "" y null se traten igual al comparar. */
function normalize(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Regla única de la Página 1 (punto 37): un campo se autocompleta solo si todas
 * las filas de la Página 2 coinciden en un único valor inequívoco. Si difieren
 * —o si algunas lo tienen cargado y otras no— dice "VER DETALLES". Nunca se
 * elige arbitrariamente el primer lote/producto.
 */
function singleValueOrDetails(values: (string | null)[]): string | null {
  if (values.length === 0) return null;
  const normalized = values.map(normalize);
  const [first] = normalized;
  return normalized.every((value) => value === first) ? first : CHECKLIST_SEE_DETAILS;
}

type LotGroup = {
  productId: string;
  lotId: string | null;
  quantity: number;
  palletIds: Set<string>;
  /** Pallets contados por el movimiento cuando los detalles no los identifican. */
  unidentifiedPallets: number;
};

export function buildReceptionChecklist(input: ChecklistInput): ReceptionChecklist {
  const { document, movements, details, products, lots, pallets } = input;

  const productMap = new Map(products.map((product) => [product.id, product]));
  const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
  const palletMap = new Map(pallets.map((pallet) => [pallet.id, pallet]));

  const groups = new Map<string, LotGroup>();
  /** Orden de aparición de los materiales: el mismo en que se cargó la Entrada. */
  const productOrder: string[] = [];
  const warnings: string[] = [];
  let documentTotalPallets = 0;

  const groupKey = (productId: string, lotId: string | null) => `${productId}|${lotId ?? 'SIN_LOTE'}`;

  for (const movement of movements) {
    if (!productOrder.includes(movement.productId)) productOrder.push(movement.productId);

    const movementDetails = details.filter((detail) => detail.movementId === movement.id);

    /* Entrada bulk (sin `palletItems`): no genera MovementDetail, así que la
       única fuente es el propio movimiento. */
    const rows = movementDetails.length
      ? movementDetails.map((detail) => ({
          lotId: detail.lotId ?? (detail.palletId ? palletMap.get(detail.palletId)?.lotId ?? null : null),
          quantity: detail.quantity,
          palletId: detail.palletId ?? null,
        }))
      : [{ lotId: movement.lotId ?? null, quantity: movement.quantity, palletId: null }];

    const touched = new Set<string>();
    for (const row of rows) {
      const key = groupKey(movement.productId, row.lotId);
      touched.add(key);
      const group = groups.get(key) ?? {
        productId: movement.productId,
        lotId: row.lotId,
        quantity: 0,
        palletIds: new Set<string>(),
        unidentifiedPallets: 0,
      };
      group.quantity = roundQuantity(group.quantity + row.quantity);
      if (row.palletId) group.palletIds.add(row.palletId);
      groups.set(key, group);
    }

    /* Total de pallets del movimiento con el mismo criterio que la Nota de
       Entrada (punto 17: los dos totales tienen que coincidir): los pallets
       identificados en los detalles y, si no hay ninguno, el contador del
       movimiento. */
    const identified = new Set(rows.map((row) => row.palletId).filter((id): id is string => !!id));
    const fallback = movement.pallets ?? 0;
    const movementPallets = identified.size || fallback;
    documentTotalPallets += movementPallets;

    if (identified.size === 0 && fallback > 0) {
      if (touched.size === 1) {
        // Un solo lote en el movimiento: los pallets del contador le pertenecen entero.
        const group = groups.get([...touched][0])!;
        group.unidentifiedPallets += fallback;
      } else {
        // Sin pallets identificados no hay forma de repartirlos entre lotes:
        // se deja en 0 por lote y se avisa, antes que inventar la distribución.
        warnings.push(
          `El movimiento ${movement.id} declara ${fallback} paleta(s) sin identificarlas por lote: ` +
            'la columna PALETAS de la Página 2 queda en 0 para esos lotes.',
        );
      }
    }
  }

  const orderIndex = new Map(productOrder.map((productId, index) => [productId, index]));
  const lotRows: ChecklistLotRow[] = [...groups.values()]
    .map((group) => {
      const product = productMap.get(group.productId);
      const lot = group.lotId ? lotMap.get(group.lotId) : undefined;
      return {
        productId: group.productId,
        productCode: product?.code ?? '—',
        productDescription: product?.description ?? '—',
        unitOfMeasure: normalize(product?.unitOfMeasure),
        lotId: group.lotId,
        lotCode: normalize(lot?.lotCode),
        sapLot: normalize(lot?.sapLot),
        fechaFabricacion: normalize(lot?.fechaFabricacion),
        fechaVencimiento: normalize(lot?.fechaVencimiento),
        quantity: group.quantity,
        pallets: group.palletIds.size || group.unidentifiedPallets,
      };
    })
    .sort((a, b) => {
      const byProduct = (orderIndex.get(a.productId) ?? 0) - (orderIndex.get(b.productId) ?? 0);
      if (byProduct !== 0) return byProduct;
      return (a.lotCode ?? '').localeCompare(b.lotCode ?? '', 'es');
    });

  /* Punto 20: una fila por material con todos sus lotes agrupados. */
  const materials: ChecklistMaterialRow[] = productOrder.map((productId) => {
    const rows = lotRows.filter((row) => row.productId === productId);
    const product = productMap.get(productId);
    return {
      productId,
      code: product?.code ?? '—',
      description: product?.description ?? '—',
      unitOfMeasure: normalize(product?.unitOfMeasure),
      totalQuantity: sumQuantities(rows.map((row) => row.quantity)),
      totalPallets: rows.reduce((sum, row) => sum + row.pallets, 0),
    };
  });

  const computedTotalQuantity = sumQuantities(lotRows.map((row) => row.quantity));
  const computedTotalPallets = lotRows.reduce((sum, row) => sum + row.pallets, 0);

  const summary: ChecklistSummary = {
    productDisplay: singleValueOrDetails(
      lotRows.map((row) => `${row.productCode} - ${row.productDescription}`),
    ),
    lotDisplay: singleValueOrDetails(lotRows.map((row) => row.lotCode)),
    fabricationDisplay: singleValueOrDetails(lotRows.map((row) => row.fechaFabricacion)),
    expirationDisplay: singleValueOrDetails(lotRows.map((row) => row.fechaVencimiento)),
    // Un material configurado como "no usa Lote SAP" nunca tiene `sapLot`
    // (uses-sap-lot.ts lo descarta al guardar) — incluir esa fila en la
    // comparación mandaría el campo a VER DETALLES aunque los materiales que sí
    // usan Lote SAP coincidan en un único valor. Se excluyen del todo, no se
    // tratan como "de acuerdo": ese material no participa de la pregunta.
    sapLotDisplay: singleValueOrDetails(
      lotRows
        .filter((row) => productMap.get(row.productId)?.usesSapLot !== false)
        .map((row) => row.sapLot),
    ),
    totalPallets: computedTotalPallets,
    totalQuantity: computedTotalQuantity,
  };

  const documentTotalQuantity = roundQuantity(document.totalQuantity);
  if (!quantitiesEqual(computedTotalQuantity, documentTotalQuantity)) {
    // Diferencia real de stock (no un residuo de coma flotante — `quantitiesEqual`
    // compara enteros escalados). El desglose recibida/distribuido/diferencia
    // ayuda a ubicar el lote mal cargado.
    const { message } = quantityMismatch(documentTotalQuantity, computedTotalQuantity);
    warnings.push(`La suma por lote no coincide con el total del remito — ${message}.`);
  }
  if (computedTotalPallets !== documentTotalPallets) {
    warnings.push(
      `Las paletas por lote (${computedTotalPallets}) no coinciden con el total del remito (${documentTotalPallets}).`,
    );
  }

  const date = document.date instanceof Date ? document.date.toISOString() : document.date;

  return {
    document: {
      id: document.id,
      code: document.code,
      type: document.type,
      status: document.status,
      date,
      arrivalDate: date,
      unloadDate: date,
      warehouse: input.warehouse,
      supplier: normalize(document.supplier),
      documentNumber: normalize(document.documentNumber),
      micNumber: null,
      originCountry: CHECKLIST_DEFAULT_COUNTRY,
      carrier: normalize(document.carrier),
      vehiclePlate: normalize(document.vehiclePlate),
      driver: normalize(document.driver),
      driverDocument: normalize(document.driverDocument),
      notes: normalize(document.notes),
    },
    createdBy: input.createdBy,
    encargado: input.encargado,
    receptionResponsible: input.encargado
      ? (normalize(input.encargado.fullName) ?? input.encargado.username)
      : 'No especificado',
    summary,
    materials,
    lots: lotRows,
    consistency: {
      ok: warnings.length === 0,
      documentTotalQuantity,
      computedTotalQuantity,
      documentTotalPallets,
      computedTotalPallets,
      warnings,
    },
  };
}
