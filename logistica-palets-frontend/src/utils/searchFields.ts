/*
 * Los textos de los buscadores, al lado de lo que cada uno busca de verdad.
 *
 * El placeholder era el único lugar donde el operador podía enterarse de por
 * qué campos se busca, y prometía de menos: en Reportes decía "código,
 * producto, lote" cuando el backend también encuentra por N° de remito,
 * Documento Material, proveedor, destino, notas y lote SAP. Nadie va a tipear
 * un número de remito en un campo que dice que busca códigos.
 *
 * El `placeholder` es corto para que entre en el input; el `title` es la lista
 * completa, que el navegador muestra al pasar el mouse. Cada constante nombra
 * dónde está implementada su cobertura: si allá se agrega o se saca un campo,
 * el texto se corrige acá.
 */

export type SearchHint = {
  placeholder: string;
  /** Tooltip con todos los campos. */
  title: string;
};

/** `matchesInventorySearch` — Lotes, Reportes · Lotes y Reportes · Frescura. */
export const INVENTORY_SEARCH: SearchHint = {
  placeholder: "Material, lote o lote SAP…",
  title: "Busca por código y descripción del material, lote interno y lote SAP.",
};

/** `matchesPalletSearch`, y `pallets.service.ts` del lado del servidor. */
export const PALLET_SEARCH: SearchHint = {
  placeholder: "Palet, material, lote o ubicación…",
  title: "Busca por código del palet, material (código o descripción), lote interno, lote SAP y ubicación donde está.",
};

/**
 * Movimientos: un solo predicado del lado del servidor —`movements.service.ts`
 * y `reports.service.ts`, con los lotes en `common/movement-lot-search.ts`—,
 * así que Historial, Entradas, Salidas y Corregir movimiento encuentran
 * exactamente lo mismo.
 */
export const MOVEMENT_SEARCH: SearchHint = {
  placeholder: "Material, lote, remito, Documento Material…",
  title: "Busca por material (código o descripción), lote interno, lote SAP, N° de MIC/factura/remito, Documento Material (del movimiento o de cualquiera de sus lotes), proveedor, destino y notas.",
};

/** Bitácora — la búsqueda de documentos de `movements.service.ts`. */
export const DOCUMENT_SEARCH: SearchHint = {
  placeholder: "N° de remito, proveedor o destino…",
  title: "Busca por código del documento, N° de MIC/factura/remito, proveedor, destino y Documento Material (del remito o de cualquiera de sus lotes).",
};

/** Transportes — el filtro local de la pantalla. */
export const TRANSPORT_SEARCH: SearchHint = {
  placeholder: "Patente, tipo o transportadora…",
  title: "Busca por patente, tipo de vehículo, transportadora, descripción y nombre de los conductores.",
};
