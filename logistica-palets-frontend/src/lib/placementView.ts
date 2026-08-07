import type { PlacementPile, PlacementPlan } from "../api/movements";

export type LocationPlanView = {
  /** key del item ("0","1",...) → pila donde terminó. */
  keyToPile: Map<string, PlacementPile>;
  /** Bases libres después de procesar cada fila, en orden — no el total final repetido. */
  runningBasesFree: (number | null)[];
  /** pila.sequence → P-números de todos los pallets de esta carga que caen ahí. */
  pileRowNumbers: Map<number, number[]>;
};

/**
 * Lectura por-fila de un `PlacementPlan` (respuesta de `previewPlacement`, que
 * ya trae el resultado final de ubicar TODO el lote junto). Traduce ese
 * resultado agregado a lo que cada fila de la tabla necesita: a qué pila cae,
 * cuántas bases van quedando libres a medida que se procesan los pallets (no
 * el total final repetido en cada fila) y qué otras filas de esta misma carga
 * comparten esa pila — para poder confirmar un apilado a simple vista.
 *
 * Solo el pallet que llega en nivel 1 de una pila nueva consume una base; los
 * que se apilan arriba (nivel 2, 3…) reutilizan esa misma base, así que no
 * restan otra — por eso el descuento se hace por `sequence` de pila, no por
 * pallet. `pilaId` no sirve para distinguir pilas nuevas entre sí: en una
 * vista previa (`commit:false`) el backend nunca las persiste, así que todas
 * las nuevas comparten `pilaId: ""`; `sequence` sí es único dentro del plan.
 */
export function buildLocationPlanView(
  plan: PlacementPlan,
  count: number,
  rowNumbers: number[],
): LocationPlanView {
  const keyToPile = new Map<string, PlacementPile>();
  for (const p of plan.piles) for (const it of p.items) keyToPile.set(it.key, p);

  const pileRowNumbers = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const pile = keyToPile.get(String(i));
    if (!pile) continue;
    pileRowNumbers.set(pile.sequence, [...(pileRowNumbers.get(pile.sequence) ?? []), rowNumbers[i]]);
  }

  // Bases libres ANTES de este lote: al total final se le suman las bases
  // nuevas que el propio lote abrió, para arrancar el descuento desde ahí.
  const runningBasesFree: (number | null)[] = [];
  if (plan.basesTotal != null) {
    const newPilesInBatch = new Set(plan.piles.filter((p) => p.isNew).map((p) => p.sequence)).size;
    let free = plan.basesTotal - (plan.basesUsed - newPilesInBatch);
    const opened = new Set<number>();
    for (let i = 0; i < count; i++) {
      const pile = keyToPile.get(String(i));
      const item = pile?.items.find((it) => it.key === String(i));
      if (pile?.isNew && item?.stackPosition === 1 && !opened.has(pile.sequence)) {
        opened.add(pile.sequence);
        free -= 1;
      }
      runningBasesFree.push(Math.max(0, free));
    }
  } else {
    for (let i = 0; i < count; i++) runningBasesFree.push(null);
  }

  return { keyToPile, runningBasesFree, pileRowNumbers };
}
