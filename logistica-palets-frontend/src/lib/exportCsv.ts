import type { Movement } from "../api/movements";
import { buildSalidasExportRows } from "./salidasExportRows";

const SALIDAS_HEADERS = [
  "Fecha y hora", "Material", "Lote", "Lote SAP", "Documento Material",
  "Cantidad", "Unidad", "Pallets", "Desde", "Destino", "Transportista",
  "Chofer", "Notas", "Estado",
];

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function buildSalidasCsv(data: Movement[]) {
  const rows = buildSalidasExportRows(data).map((row) => [
    row.fecha, row.material, row.lote, row.sapLot, row.documentoMaterial,
    row.quantity, row.unit, row.pallets, row.desde, row.destino, row.carrier,
    row.driver, row.notes, row.estado,
  ]);
  return [SALIDAS_HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
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
