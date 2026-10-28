/** Predicado compartido por Historial, Entradas y Salidas. Los alias son internos. */
export function movementLotSearchPredicate(movementAlias: 'm' | 'movement'): string {
  return `(LOWER(COALESCE(lot."lotCode", '')) LIKE :search
    OR LOWER(COALESCE(lot."sapLot", '')) LIKE :search
    OR EXISTS (
      SELECT 1 FROM movement_details md INNER JOIN lots dl ON dl.id = md."lotId"
      WHERE md."movementId" = ${movementAlias}.id
        AND (LOWER(COALESCE(dl."lotCode", '')) LIKE :search OR LOWER(COALESCE(dl."sapLot", '')) LIKE :search)
    ))`;
}
