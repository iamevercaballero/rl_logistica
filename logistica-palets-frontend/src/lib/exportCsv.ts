import type { Movement } from "../api/movements";
import { buildSalidasExportRows } from "./salidasExportRows";
import { buildCsv } from "./csv";

const SALIDAS_HEADERS = [
  "Fecha y hora", "Material", "Lote", "Lote SAP", "Documento Material",
  "Cantidad", "Unidad", "Pallets", "Desde", "Destino", "Transportista",
  "Chofer", "Notas", "Estado",
];

export function buildSalidasCsv(data: Movement[]) {
  const rows = buildSalidasExportRows(data).map((row) => [
    row.fecha, row.material, row.lote, row.sapLot, row.documentoMaterial,
    row.quantity, row.unit, row.pallets, row.desde, row.destino, row.carrier,
    row.driver, row.notes, row.estado,
  ]);
  // `buildCsv` neutraliza las celdas que Excel tomaría como fórmula. Notas,
  // destino, transportista y chofer son texto libre que carga el operador.
  return buildCsv([SALIDAS_HEADERS, ...rows]);
}

export function exportSalidasCsv(data: Movement[], filename = "salidas") {
  const blob = new Blob(["\uFEFF", buildSalidasCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
