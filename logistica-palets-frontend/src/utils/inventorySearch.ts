type SearchableLot = {
  lotCode: string;
  sapLot?: string | null;
  product?: { code: string; description: string };
};

/** Coincidencias parciales por material, lote proveedor o lote SAP. */
export function matchesInventorySearch(row: SearchableLot, search: string): boolean {
  const query = search.trim().toLocaleLowerCase("es");
  return !query || [row.product?.code, row.product?.description, row.lotCode, row.sapLot]
    .some((value) => value?.toLocaleLowerCase("es").includes(query));
}
