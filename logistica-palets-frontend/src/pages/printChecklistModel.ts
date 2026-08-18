import type { ChecklistLotRow, ChecklistMaterialRow } from "../api/movements";

/**
 * Reglas de armado del CHECKLIST DE RECEPCIÓN DE INSUMOS que conviene tener
 * fuera del componente para poder probarlas: cuántas filas entran por hoja y
 * cómo se reparten cuando una Entrada tiene más lotes de los que caben.
 *
 * El resumen de la Página 1 (cuándo un campo dice "VER DETALLES") lo resuelve
 * el backend: acá no se vuelve a decidir, solo se muestra lo que llega.
 */

/**
 * Filas del punto 22 que entran en la Página 2 junto al bloque 23 y las firmas.
 * Los cupos están medidos con el peor caso: todas las filas con descripción
 * larga, que ocupa dos renglones. Quedarse corto solo agrega una hoja más;
 * pasarse rompería la grilla del formulario.
 */
export const CHECKLIST_LOT_ROWS_FIRST_PAGE = 30;

/** Filas por hoja de continuación: sin el bloque 23, entran más. */
export const CHECKLIST_LOT_ROWS_CONTINUATION = 32;

/** Filas vacías mínimas del punto 22, para que la tabla no quede raquítica. */
const MIN_LOT_ROWS = 8;

/** Filas del punto 20 (Materiales) — el formulario original trae 3 en blanco. */
const MIN_MATERIAL_ROWS = 3;

/** Filas siempre vacías del punto 23 (DETALLES DE PALETAS IR), para carga manual. */
export const CHECKLIST_IR_ROWS = 12;

export type ChecklistLotPage = {
  /** 1 para la Página 2 del formulario; 2, 3… para las continuaciones. */
  index: number;
  continuation: boolean;
  rows: ChecklistLotRow[];
  /** Filas en blanco que completan la tabla hasta el mínimo visual. */
  fillerRows: number;
};

/**
 * Reparte las filas de LOTES POR PALETAS en hojas. Nunca recorta ni oculta:
 * si no entran, se abre una hoja de continuación repitiendo los encabezados.
 */
export function paginateChecklistLots(lots: ChecklistLotRow[]): ChecklistLotPage[] {
  const first = lots.slice(0, CHECKLIST_LOT_ROWS_FIRST_PAGE);
  const pages: ChecklistLotPage[] = [
    {
      index: 1,
      continuation: false,
      rows: first,
      fillerRows: Math.max(0, MIN_LOT_ROWS - first.length),
    },
  ];

  let remaining = lots.slice(CHECKLIST_LOT_ROWS_FIRST_PAGE);
  while (remaining.length > 0) {
    const rows = remaining.slice(0, CHECKLIST_LOT_ROWS_CONTINUATION);
    pages.push({ index: pages.length + 1, continuation: true, rows, fillerRows: 0 });
    remaining = remaining.slice(CHECKLIST_LOT_ROWS_CONTINUATION);
  }

  return pages;
}

/** Alto del bloque 23 + firmas, medido en filas de la tabla 22. */
const IR_BLOCK_ROW_EQUIVALENT = 18;

/**
 * El bloque 23 (DETALLES DE PALETAS IR) va en la última hoja de lotes, salvo
 * que esa hoja haya quedado llena — ahí se manda a una hoja propia en vez de
 * apretarlo contra el pie.
 */
export function irBlockGoesOnOwnPage(pages: ChecklistLotPage[]): boolean {
  const last = pages[pages.length - 1];
  // La Página 2 ya se dimensionó contando con el bloque 23 abajo.
  if (!last.continuation) return false;
  return last.rows.length > CHECKLIST_LOT_ROWS_CONTINUATION - IR_BLOCK_ROW_EQUIVALENT;
}

/** Filas en blanco del punto 20 para que la tabla conserve su aspecto. */
export function materialFillerRows(materials: ChecklistMaterialRow[]): number {
  return Math.max(0, MIN_MATERIAL_ROWS - materials.length);
}
