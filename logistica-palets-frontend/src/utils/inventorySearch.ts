/*
 * Qué campos recorre cada buscador local del inventario.
 *
 * Había dos criterios distintos para lo mismo: Lotes y los reportes de Lotes y
 * Frescura buscaban por material, lote y lote SAP, mientras Palets tenía su
 * propio filtro escrito a mano por palet, material, lote y ubicación. Buscar
 * un lote SAP encontraba o no según la pantalla, sin ninguna razón que el
 * operador pudiera ver.
 *
 * Los textos de los buscadores están en `searchFields.ts`, al lado de la lista
 * de campos de cada uno, para que no vuelvan a prometer otra cosa.
 */

type Campo = string | null | undefined;

/** Coincidencia parcial contra cualquiera de los campos, sin distinguir mayúsculas. */
function coincideAlguno(campos: Campo[], search: string): boolean {
  const query = search.trim().toLocaleLowerCase("es");
  return !query || campos.some((valor) => valor?.toLocaleLowerCase("es").includes(query));
}

type SearchableLot = {
  lotCode: string;
  sapLot?: string | null;
  product?: { code: string; description: string };
};

/** Lotes, Reportes · Lotes y Reportes · Frescura. */
export function matchesInventorySearch(row: SearchableLot, search: string): boolean {
  return coincideAlguno([row.product?.code, row.product?.description, row.lotCode, row.sapLot], search);
}

type SearchablePallet = {
  code: string;
  productCode?: string | null;
  productDescription?: string | null;
  lotCode?: string | null;
  sapLot?: string | null;
  locationCode?: string | null;
};

/**
 * Palets. Mantiene el código del palet y la ubicación —lo que esa pantalla ya
 * filtraba— y suma el lote SAP, que encontraba el Localizador y acá no.
 */
export function matchesPalletSearch(row: SearchablePallet, search: string): boolean {
  return coincideAlguno(
    [row.code, row.productCode, row.productDescription, row.lotCode, row.sapLot, row.locationCode],
    search,
  );
}
