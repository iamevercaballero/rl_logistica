/**
 * Excel export utilities using ExcelJS.
 *
 * Supports:
 *  - exportStockExcel()   — plain formatted stock report
 *  - exportSapDiffExcel() — SAP diff with conditional row colors
 *  - exportMovementsExcel() — movement history
 *
 * All functions write to browser download (no server round-trip).
 */
import ExcelJS from "exceljs";
import type { StockItemRow, ReportMovementRow, DailyStockRow, ReportTraceEvent } from "../api/reports";
import type { Movement } from "../api/movements";
import type { Lot } from "../api/lots";

/* ── Brand colors (hex without #) ────────────────────────────────────────── */

const PRIMARY_HEX = "2563EB";
const WHITE_HEX = "FFFFFF";
const GRAY_LIGHT = "F3F4F6";
const RED_LIGHT = "FEE2E2";   // diferencia positiva → sobrante
const GREEN_LIGHT = "DCFCE7"; // diferencia cero o negativa → OK

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function buildBaseWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RL Logística";
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

function applyHeaderRow(row: ExcelJS.Row, columns: string[]) {
  row.values = ["", ...columns]; // ExcelJS rows are 1-indexed, col 0 unused
  row.eachCell((cell, colNum) => {
    if (colNum === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${PRIMARY_HEX}` } };
    cell.font = { color: { argb: `FF${WHITE_HEX}` }, bold: true, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
  });
  row.height = 22;
}

function addBrandFooter(sheet: ExcelJS.Worksheet, rowNum: number) {
  const footerRow = sheet.getRow(rowNum + 2);
  footerRow.getCell(2).value = `Generado por RL Logística — ${new Date().toLocaleString("es-AR")}`;
  footerRow.getCell(2).font = { color: { argb: "FF9CA3AF" }, italic: true, size: 8 };
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Stock report ─────────────────────────────────────────────────────────── */

export async function exportStockExcel(
  data: StockItemRow[],
  filename = "stock-report",
) {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Stock Actual");

  // Column widths
  ws.columns = [
    { key: "code",     width: 18 },
    { key: "desc",     width: 40 },
    { key: "depot",    width: 25 },
    { key: "location", width: 18 },
    { key: "qty",      width: 14 },
    { key: "unit",     width: 10 },
    { key: "updated",  width: 20 },
  ];

  applyHeaderRow(ws.getRow(1), [
    "Código", "Material", "Depósito", "Ubicación", "Cantidad", "UM", "Actualizado",
  ]);

  data.forEach((r, i) => {
    const row = ws.addRow([
      r.material.code,
      r.material.description,
      r.warehouse?.name ?? "-",
      r.location?.code ?? "-",
      r.currentQuantity,
      r.material.unitOfMeasure ?? "",
      new Date(r.updatedAt).toLocaleDateString("es-AR"),
    ]);

    // Alternate row shading
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }

    // Right-align quantity
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(6).alignment = { horizontal: "center" };
  });

  // Freeze header
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "G1" };

  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── SAP diff report (with conditional row colors) ────────────────────────── */

type SapDiffRow = {
  productCode: string;
  productDescription: string;
  warehouseName?: string;
  locationCode?: string;
  stockSistema: number;
  stockSAP: number;
  diferencia: number;
};

export async function exportSapDiffExcel(
  data: SapDiffRow[],
  filename = "diferencias-sap",
) {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Diferencias SAP");

  ws.columns = [
    { key: "code",    width: 18 },
    { key: "desc",    width: 40 },
    { key: "depot",   width: 25 },
    { key: "loc",     width: 18 },
    { key: "sistema", width: 18 },
    { key: "sap",     width: 18 },
    { key: "diff",    width: 18 },
  ];

  applyHeaderRow(ws.getRow(1), [
    "Código", "Material", "Depósito", "Ubicación",
    "Stock Sistema", "Stock SAP", "Diferencia",
  ]);

  data.forEach((r) => {
    const row = ws.addRow([
      r.productCode,
      r.productDescription,
      r.warehouseName ?? "-",
      r.locationCode ?? "-",
      r.stockSistema,
      r.stockSAP,
      r.diferencia,
    ]);

    // Conditional row color
    const bgArgb = r.diferencia === 0
      ? `FF${GREEN_LIGHT}`
      : `FF${RED_LIGHT}`;

    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
    });

    // Right-align numbers
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(6).alignment = { horizontal: "right" };
    row.getCell(7).alignment = { horizontal: "right" };

    // Bold the difference cell
    row.getCell(7).font = {
      bold: true,
      color: { argb: r.diferencia === 0 ? "FF166534" : "FF991B1B" },
    };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "G1" };

  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── Movement history ─────────────────────────────────────────────────────── */

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste +",
  ADJUSTMENT_OUT: "Ajuste -",
};

export async function exportMovementsExcel(
  data: ReportMovementRow[],
  filename = "movimientos",
) {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Movimientos");

  ws.columns = [
    { key: "date",     width: 20 },
    { key: "type",     width: 18 },
    { key: "material", width: 35 },
    { key: "qty",      width: 14 },
    { key: "depot",    width: 25 },
    { key: "doc",      width: 22 },
    { key: "supplier", width: 30 },
    { key: "carrier",  width: 25 },
    { key: "driver",   width: 20 },
    { key: "notes",    width: 35 },
  ];

  applyHeaderRow(ws.getRow(1), [
    "Fecha", "Tipo", "Material", "Cantidad", "Depósito",
    "Documento", "Proveedor", "Transportista", "Chofer", "Notas",
  ]);

  data.forEach((r, i) => {
    const row = ws.addRow([
      new Date(r.date).toLocaleDateString("es-AR"),
      MOVE_LABEL[r.type] ?? r.type,
      r.material?.code ? `${r.material.code} - ${r.material.description}` : "-",
      r.quantity,
      r.warehouse?.name ?? "-",
      r.documentNumber ?? "-",
      r.supplier ?? "-",
      r.carrier ?? "-",
      r.driver ?? "-",
      r.notes ?? "-",
    ]);

    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }

    row.getCell(4).alignment = { horizontal: "right" };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "J1" };

  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── Daily stock (control diario) ────────────────────────────────────────── */

const GREEN_ROW = "DCFCE7";
const RED_ROW   = "FEE2E2";

export async function exportDailyStockExcel(
  data: DailyStockRow[],
  dateLabel: string,
  filename = "control-diario",
) {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Control diario");

  ws.columns = [
    { key: "code",     width: 18 },
    { key: "desc",     width: 42 },
    { key: "um",       width: 10 },
    { key: "inicial",  width: 16 },
    { key: "entradas", width: 16 },
    { key: "salidas",  width: 16 },
    { key: "final",    width: 16 },
  ];

  applyHeaderRow(ws.getRow(1), ["Código", "Material", "UM", "Stock inicial", "Entradas", "Salidas", "Stock final"]);

  data.forEach((r, i) => {
    const row = ws.addRow([
      r.material.code,
      r.material.description,
      r.material.unitOfMeasure ?? "",
      r.stockInicial,
      r.entradas,
      r.salidas,
      r.stockFinal,
    ]);
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }
    row.getCell(4).alignment = { horizontal: "right" };
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(5).font = { color: { argb: r.entradas > 0 ? "FF166534" : "FF374151" }, bold: r.entradas > 0 };
    row.getCell(6).alignment = { horizontal: "right" };
    row.getCell(6).font = { color: { argb: r.salidas > 0 ? "FF991B1B" : "FF374151" }, bold: r.salidas > 0 };
    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(7).font = { bold: true };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "G1" };
  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── Entradas report ─────────────────────────────────────────────────────── */

export async function exportEntradasExcel(data: Movement[], filename = "entradas") {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Entradas");

  ws.columns = [
    { key: "fecha",    width: 20 },
    { key: "material", width: 38 },
    { key: "lote",     width: 18 },
    { key: "sapLot",   width: 18 },
    { key: "doc",      width: 20 },
    { key: "qty",      width: 14 },
    { key: "pallets",  width: 10 },
    { key: "ubic",     width: 28 },
    { key: "prov",     width: 25 },
    { key: "carrier",  width: 22 },
    { key: "driver",   width: 20 },
    { key: "notes",    width: 35 },
    { key: "estado",   width: 14 },
  ];

  applyHeaderRow(ws.getRow(1), [
    "Fecha", "Material", "Lote", "Lote SAP", "N° Documento", "Cantidad", "Pallets",
    "Depósito / Ubic.", "Proveedor", "Transportista", "Chofer", "Notas", "Estado",
  ]);

  data.forEach((r, i) => {
    const row = ws.addRow([
      new Date(r.date).toLocaleDateString("es-AR"),
      `${r.material.code} - ${r.material.description}`,
      r.lotCode ?? "-",
      r.sapLot ?? "-",
      r.documentNumber ?? "-",
      r.quantity,
      r.pallets ?? "-",
      `${r.warehouse?.name ?? "-"}${r.location?.code ? ` / ${r.location.code}` : ""}`,
      r.supplier ?? "-",
      r.carrier ?? "-",
      r.driver ?? "-",
      r.notes ?? "-",
      r.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
    ]);
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }
    if (r.status === "PENDING_REGULARIZATION") {
      row.getCell(13).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${RED_ROW}` } };
    }
    row.getCell(6).alignment = { horizontal: "right" };
    row.getCell(7).alignment = { horizontal: "center" };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "M1" };
  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── Salidas report ──────────────────────────────────────────────────────── */

export async function exportSalidasExcel(data: Movement[], filename = "salidas") {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Salidas");

  ws.columns = [
    { key: "fecha",    width: 20 },
    { key: "material", width: 38 },
    { key: "lote",     width: 18 },
    { key: "sapLot",   width: 18 },
    { key: "qty",      width: 14 },
    { key: "pallets",  width: 10 },
    { key: "desde",    width: 28 },
    { key: "destino",  width: 28 },
    { key: "carrier",  width: 22 },
    { key: "driver",   width: 20 },
    { key: "notes",    width: 35 },
  ];

  applyHeaderRow(ws.getRow(1), [
    "Fecha", "Material", "Lote", "Lote SAP", "Cantidad", "Pallets",
    "Desde", "Destino", "Transportista", "Chofer", "Notas",
  ]);

  data.forEach((r, i) => {
    const row = ws.addRow([
      new Date(r.date).toLocaleDateString("es-AR"),
      `${r.material.code} - ${r.material.description}`,
      r.lotCode ?? "-",
      r.sapLot ?? "-",
      r.quantity,
      r.pallets ?? "-",
      `${r.warehouse?.name ?? r.from?.warehouseName ?? "-"}${(r.location?.code ?? r.from?.locationCode) ? ` / ${r.location?.code ?? r.from?.locationCode}` : ""}`,
      r.destination ?? "-",
      r.carrier ?? "-",
      r.driver ?? "-",
      r.notes ?? "-",
    ]);
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(6).alignment = { horizontal: "center" };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "K1" };
  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── Lotes & SAP report ──────────────────────────────────────────────────── */

export async function exportLotesExcel(data: Lot[], filename = "lotes") {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Lotes");

  ws.columns = [
    { key: "lote",   width: 22 },
    { key: "sap",    width: 18 },
    { key: "mat",    width: 40 },
    { key: "venc",   width: 16 },
    { key: "fabr",   width: 16 },
    { key: "prov",   width: 25 },
    { key: "stock",  width: 14 },
    { key: "estado", width: 14 },
  ];

  applyHeaderRow(ws.getRow(1), ["Código lote", "Lote SAP", "Material", "Vencimiento", "Fabricación", "Proveedor", "Stock", "Estado"]);

  data.forEach((r, i) => {
    const row = ws.addRow([
      r.lotCode,
      r.sapLot ?? "-",
      r.product ? `${r.product.code} - ${r.product.description}` : r.productId,
      r.fechaVencimiento ? new Date(r.fechaVencimiento).toLocaleDateString("es-AR") : "-",
      r.fechaFabricacion ? new Date(r.fechaFabricacion).toLocaleDateString("es-AR") : "-",
      r.proveedor ?? "-",
      r.stockActual,
      r.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
    ]);
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }
    if (r.status === "PENDING_REGULARIZATION") {
      row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${RED_ROW}` } };
    }
    row.getCell(7).alignment = { horizontal: "right" };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "H1" };
  addBrandFooter(ws, data.length + 1);
  await downloadWorkbook(wb, filename);
}

/* ── Trazabilidad report ─────────────────────────────────────────────────── */

export async function exportTrazabilidadExcel(
  materialCode: string,
  history: ReportTraceEvent[],
  filename = "trazabilidad",
) {
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Trazabilidad");

  ws.columns = [
    { key: "fecha",  width: 20 },
    { key: "tipo",   width: 18 },
    { key: "qty",    width: 14 },
    { key: "desde",  width: 30 },
    { key: "hacia",  width: 30 },
    { key: "doc",    width: 20 },
    { key: "notas",  width: 35 },
  ];

  applyHeaderRow(ws.getRow(1), ["Fecha", "Tipo", "Cantidad", "Desde", "Hacia", "Documento", "Notas"]);

  const MOVE_LABEL: Record<string, string> = {
    ENTRY: "Entrada", EXIT: "Salida", TRANSFER: "Transferencia",
    ADJUSTMENT_IN: "Ajuste +", ADJUSTMENT_OUT: "Ajuste -",
  };

  history.forEach((e, i) => {
    const row = ws.addRow([
      new Date(e.at).toLocaleDateString("es-AR"),
      MOVE_LABEL[e.type] ?? e.type,
      e.quantity,
      `${e.fromWarehouseName ?? e.warehouseName ?? "-"}${e.fromLocationCode ? ` / ${e.fromLocationCode}` : ""}`,
      `${e.toWarehouseName ?? "-"}${e.toLocationCode ? ` / ${e.toLocationCode}` : ""}`,
      e.documentNumber ?? "-",
      e.notes ?? "-",
    ]);
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
      });
    }
    row.getCell(3).alignment = { horizontal: "right" };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "G1" };
  addBrandFooter(ws, history.length + 1);
  await downloadWorkbook(wb, filename);
}
