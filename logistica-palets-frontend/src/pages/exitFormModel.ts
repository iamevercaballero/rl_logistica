import { fmtQty, parseQtyInput, quantityDelta, roundQty, sumQuantities } from "../utils/quantity";

/**
 * Modelo puro de la **salida por pallet**.
 *
 * La selección de pallets y la cantidad a retirar de cada uno son la única
 * fuente de verdad de la salida de un lote. El "total a despachar" es un valor
 * **derivado** (`exitRowTotal`) — nunca se guarda como estado ni se usa para
 * re-seleccionar pallets o reescribir cantidades. La única vía que arma la
 * selección a partir de un número es `fefoSuggest`, y solo se dispara con un
 * clic explícito del operador.
 *
 * Vive fuera del componente porque las specs del front corren en
 * `environment: 'node'` (sin RTL): la lógica testeable no puede estar en el TSX.
 */

/** Lo mínimo que el modelo necesita de un pallet. */
export type ExitPallet = { id: string; code: string; quantity: number };

/** Qué pallets salen de un lote y cuánto de cada uno (string crudo, lo tipeado). */
export type ExitSelection = {
  selectedIds: Set<string>;
  qtyByPallet: Record<string, string>;
};

/** Cuánto se retira de un pallet según lo cargado. Sin dato o <= 0 → 0. */
export function palletExitTake(qtyByPallet: Record<string, string>, palletId: string): number {
  const parsed = parseQtyInput(qtyByPallet[palletId] ?? "");
  return parsed !== null && parsed > 0 ? parsed : 0;
}

/**
 * Total de la salida del lote: suma exacta (enteros escalados) de lo cargado en
 * los pallets seleccionados. Derivado — se recalcula solo al editar un pallet.
 */
export function exitRowTotal(sel: ExitSelection): number {
  return sumQuantities([...sel.selectedIds].map((id) => palletExitTake(sel.qtyByPallet, id)));
}

/** `true` si algún pallet seleccionado sale parcial (retira menos de su stock). */
export function exitRowIsPartial(sel: ExitSelection, pallets: ExitPallet[]): boolean {
  const byId = new Map(pallets.map((p) => [p.id, p]));
  for (const id of sel.selectedIds) {
    const pallet = byId.get(id);
    if (!pallet) continue;
    const take = palletExitTake(sel.qtyByPallet, id);
    if (take > 0 && quantityDelta(pallet.quantity, take) > 0) return true;
  }
  return false;
}

/**
 * Tilda un pallet: entra con su cantidad completa, editable a menos. **No toca
 * ningún otro pallet ni ningún total** — el total se deriva de la selección.
 */
export function selectPalletForExit(
  sel: ExitSelection,
  palletId: string,
  palletQty: number,
): ExitSelection {
  const selectedIds = new Set(sel.selectedIds);
  selectedIds.add(palletId);
  return { selectedIds, qtyByPallet: { ...sel.qtyByPallet, [palletId]: fmtQty(palletQty) } };
}

/** Destilda un pallet: se quita de la selección y se borra su cantidad. Nada más. */
export function deselectPalletForExit(sel: ExitSelection, palletId: string): ExitSelection {
  const selectedIds = new Set(sel.selectedIds);
  selectedIds.delete(palletId);
  const qtyByPallet = { ...sel.qtyByPallet };
  delete qtyByPallet[palletId];
  return { selectedIds, qtyByPallet };
}

/**
 * Atajo FEFO: dada una cantidad objetivo, selecciona pallets en orden hasta
 * cubrirla y reparte la cantidad entre ellos (el último puede quedar parcial).
 * Reemplaza la selección actual — es una acción **explícita** (un botón), nunca
 * corre sola. `targetQty <= 0` limpia la selección.
 */
export function fefoSuggest(pallets: ExitPallet[], targetQty: number): ExitSelection {
  const target = roundQty(targetQty);
  const selectedIds = new Set<string>();
  const qtyByPallet: Record<string, string> = {};
  if (target <= 0) return { selectedIds, qtyByPallet };

  let remaining = target;
  for (const p of pallets) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(p.quantity, remaining));
    if (take <= 0) continue;
    remaining = roundQty(remaining - take);
    selectedIds.add(p.id);
    qtyByPallet[p.id] = fmtQty(take);
  }
  return { selectedIds, qtyByPallet };
}

/**
 * Valida la salida de un lote (requisito 8): cada pallet seleccionado retira
 * una cantidad > 0 y <= su stock. Devuelve el texto del error o `null`.
 */
export function exitRowError(sel: ExitSelection, pallets: ExitPallet[]): string | null {
  const byId = new Map(pallets.map((p) => [p.id, p]));
  const sinCantidad: string[] = [];
  const excede: string[] = [];
  for (const id of sel.selectedIds) {
    const pallet = byId.get(id);
    if (!pallet) continue;
    const take = palletExitTake(sel.qtyByPallet, id);
    if (take <= 0) {
      sinCantidad.push(pallet.code);
      continue;
    }
    if (quantityDelta(take, pallet.quantity) > 0) {
      excede.push(`${pallet.code} (tiene ${fmtQty(pallet.quantity)})`);
    }
  }
  if (excede.length > 0) return `Cantidad mayor al stock disponible del pallet: ${excede.join(", ")}.`;
  if (sinCantidad.length > 0) {
    return `Pallet seleccionado sin cantidad: ${sinCantidad.join(", ")}. Ingresá cuánto retirar o destildalo.`;
  }
  return null;
}
