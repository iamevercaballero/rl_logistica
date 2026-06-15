import { fmtDate, fmtGeneratedAt } from "../utils/dateFormat";

import ExcelJS from "exceljs";
import type { StockItemRow, ReportMovementRow, DailyStockRow, ReportTraceEvent, FreshnessRow } from "../api/reports";
import type { Movement } from "../api/movements";
import type { Lot } from "../api/lots";

/* ── Brand colors ─────────────────────────────────────────────────────────── */

const PRIMARY_HEX   = "2563EB";
const PRIMARY_DARK  = "1D4ED8";
const PRIMARY_LIGHT = "EEF2FF";
const WHITE_HEX     = "FFFFFF";
const GRAY_LIGHT    = "F3F4F6";
const BORDER_COLOR  = "BFDBFE";
const RED_LIGHT     = "FEE2E2";
const GREEN_LIGHT   = "DCFCE7";
const ORANGE_LIGHT  = "FEF3C7";
const YELLOW_LIGHT  = "FEF9C3";

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste +",
  ADJUSTMENT_OUT: "Ajuste -",
};

/* ── Base workbook ────────────────────────────────────────────────────────── */

function buildBaseWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RL Logística";
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

/* ── Header row (FIX: uses getCell to avoid 1-col offset bug) ─────────────── */

function applyHeaderRow(row: ExcelJS.Row, columns: string[]): void {
  columns.forEach((col, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = col;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${PRIMARY_HEX}` } };
    cell.font = { color: { argb: `FF${WHITE_HEX}` }, bold: true, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    cell.border = {
      bottom: { style: "medium", color: { argb: `FF${PRIMARY_DARK}` } },
      right: { style: "thin", color: { argb: `FF${BORDER_COLOR}` } },
    };
  });
  row.height = 24;
}

/* ── Report title + timestamp rows ────────────────────────────────────────── */

function addReportHeader(ws: ExcelJS.Worksheet, title: string, colCount: number): void {
  const titleRow = ws.addRow([`RL Logística — ${title}`]);
  const titleCell = titleRow.getCell(1);
  titleCell.value = `RL Logística — ${title}`;
  titleCell.font = { bold: true, size: 13, color: { argb: `FF${PRIMARY_HEX}` } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${PRIMARY_LIGHT}` } };
  titleRow.height = 30;
  if (colCount > 1) ws.mergeCells(1, 1, 1, colCount);

  const tsRow = ws.addRow([fmtGeneratedAt()]);
  const tsCell = tsRow.getCell(1);
  tsCell.font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  tsCell.alignment = { vertical: "middle" };
  tsRow.height = 14;
  if (colCount > 1) ws.mergeCells(2, 1, 2, colCount);
}

/* ── Alt-row shading (uses includeEmpty so all cells get background) ─────── */

function styleDataRow(row: ExcelJS.Row, index: number, colCount: number): void {
  if (index % 2 === 1) {
    for (let c = 1; c <= colCount; c++) {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRAY_LIGHT}` } };
    }
  }
}

/* ── Footer ───────────────────────────────────────────────────────────────── */

function addBrandFooter(sheet: ExcelJS.Worksheet, lastDataRow: number): void {
  const footerRow = sheet.getRow(lastDataRow + 2);
  const cell = footerRow.getCell(2);
  cell.value = `Generado por RL Logística — ${fmtGeneratedAt()}`;
  cell.font = { color: { argb: "FF9CA3AF" }, italic: true, size: 8 };
}

/* ── Download helper ──────────────────────────────────────────────────────── */

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
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
): Promise<void> {
  const COL_COUNT = 7;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Stock Actual");

  ws.columns = [
    { key: "code",     width: 18 },
    { key: "desc",     width: 42 },
    { key: "depot",    width: 26 },
    { key: "location", width: 18 },
    { key: "qty",      width: 16 },
    { key: "unit",     width: 10 },
    { key: "updated",  width: 22 },
  ];

  addReportHeader(ws, "Reporte de Stock Actual", COL_COUNT);
  applyHeaderRow(ws.addRow([]), ["Código", "Material", "Depósito", "Ubicación", "Cantidad", "UM", "Actualizado"]);

  let rowCount = 0;
  data.forEach((r, i) => {
    const row = ws.addRow([
      r.material.code,
      r.material.description,
      r.warehouse?.name ?? "-",
      r.location?.code ?? "-",
      r.currentQuantity,
      r.material.unitOfMeasure ?? "",
      fmtDate(r.updatedAt),
    ]);
    styleDataRow(row, i, COL_COUNT);
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).alignment = { horizontal: "center" };
    rowCount++;
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── SAP diff report ──────────────────────────────────────────────────────── */

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
): Promise<void> {
  const COL_COUNT = 7;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Diferencias SAP");

  ws.columns = [
    { key: "code",    width: 18 },
    { key: "desc",    width: 42 },
    { key: "depot",   width: 26 },
    { key: "loc",     width: 18 },
    { key: "sistema", width: 18 },
    { key: "sap",     width: 18 },
    { key: "diff",    width: 18 },
  ];

  addReportHeader(ws, "Diferencias SAP", COL_COUNT);
  applyHeaderRow(ws.addRow([]), ["Código", "Material", "Depósito", "Ubicación", "Stock Sistema", "Stock SAP", "Diferencia"]);

  let rowCount = 0;
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

    const bgArgb = r.diferencia === 0 ? `FF${GREEN_LIGHT}` : `FF${RED_LIGHT}`;
    for (let c = 1; c <= COL_COUNT; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };

    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).alignment = { horizontal: "right" };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(7).numFmt = '#,##0';
    row.getCell(7).font = {
      bold: true,
      color: { argb: r.diferencia === 0 ? "FF166534" : "FF991B1B" },
    };
    rowCount++;
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── Movement history ─────────────────────────────────────────────────────── */

export async function exportMovementsExcel(
  data: ReportMovementRow[],
  filename = "movimientos",
): Promise<void> {
  const COL_COUNT = 10;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Movimientos");

  ws.columns = [
    { key: "date",     width: 20 },
    { key: "type",     width: 18 },
    { key: "material", width: 38 },
    { key: "qty",      width: 16 },
    { key: "depot",    width: 26 },
    { key: "doc",      width: 22 },
    { key: "supplier", width: 28 },
    { key: "carrier",  width: 25 },
    { key: "driver",   width: 20 },
    { key: "notes",    width: 35 },
  ];

  addReportHeader(ws, "Historial de Movimientos", COL_COUNT);
  applyHeaderRow(ws.addRow([]), [
    "Fecha", "Tipo", "Material", "Cantidad", "Depósito",
    "MIC/Factura/Remito", "Proveedor", "Transportista", "Chofer", "Notas",
  ]);

  let rowCount = 0;
  data.forEach((r, i) => {
    const row = ws.addRow([
      fmtDate(r.date),
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
    styleDataRow(row, i, COL_COUNT);
    row.getCell(4).alignment = { horizontal: "right" };
    row.getCell(4).numFmt = '#,##0';
    rowCount++;
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── Daily stock (control diario) ────────────────────────────────────────── */

export async function exportDailyStockExcel(
  data: DailyStockRow[],
  dateLabel: string,
  filename = "control-diario",
): Promise<void> {
  const COL_COUNT = 7;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet(`Control ${dateLabel}`.slice(0, 31));

  ws.columns = [
    { key: "code",     width: 18 },
    { key: "desc",     width: 44 },
    { key: "um",       width: 10 },
    { key: "inicial",  width: 18 },
    { key: "entradas", width: 18 },
    { key: "salidas",  width: 18 },
    { key: "final",    width: 18 },
  ];

  addReportHeader(ws, `Control de Stock — ${dateLabel}`, COL_COUNT);
  applyHeaderRow(ws.addRow([]), ["Código", "Material", "UM", "Stock inicial", "Entradas", "Salidas", "Stock final"]);

  let rowCount = 0;
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
    styleDataRow(row, i, COL_COUNT);
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).alignment = { horizontal: "right" };
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(5).font = { color: { argb: r.entradas > 0 ? "FF166534" : "FF374151" }, bold: r.entradas > 0 };
    row.getCell(6).alignment = { horizontal: "right" };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(6).font = { color: { argb: r.salidas > 0 ? "FF991B1B" : "FF374151" }, bold: r.salidas > 0 };
    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(7).numFmt = '#,##0';
    row.getCell(7).font = { bold: true };
    rowCount++;
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── Entradas report (expands lotsDetail like the UI table) ──────────────── */

export async function exportEntradasExcel(data: Movement[], filename = "entradas"): Promise<void> {
  const COL_COUNT = 13;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Entradas");

  ws.columns = [
    { key: "fecha",    width: 20 },
    { key: "material", width: 40 },
    { key: "lote",     width: 20 },
    { key: "sapLot",   width: 20 },
    { key: "doc",      width: 20 },
    { key: "qty",      width: 16 },
    { key: "pallets",  width: 10 },
    { key: "ubic",     width: 28 },
    { key: "prov",     width: 26 },
    { key: "carrier",  width: 24 },
    { key: "driver",   width: 20 },
    { key: "notes",    width: 34 },
    { key: "estado",   width: 14 },
  ];

  addReportHeader(ws, "Reporte de Entradas", COL_COUNT);
  applyHeaderRow(ws.addRow([]), [
    "Fecha", "Material", "Lote", "Lote SAP", "MIC/Factura/Remito", "Cantidad", "Pallets",
    "Depósito / Ubic.", "Proveedor", "Transportista", "Chofer", "Notas", "Estado",
  ]);

  let rowCount = 0;
  for (const m of data) {
    const lots = (m.lotsDetail && m.lotsDetail.length > 0)
      ? m.lotsDetail
      : [{ lotCode: m.lotCode ?? null, sapLot: m.sapLot ?? null, pallets: m.pallets ?? null, quantity: m.quantity }];

    lots.forEach((ld) => {
      const row = ws.addRow([
        fmtDate(m.date),
        `${m.material.code} - ${m.material.description}`,
        ld.lotCode ?? "-",
        ld.sapLot ?? "-",
        m.documentNumber ?? "-",
        ld.quantity,
        ld.pallets ?? "-",
        `${m.warehouse?.name ?? "-"}${m.location?.code ? ` / ${m.location.code}` : ""}`,
        m.supplier ?? "-",
        m.carrier ?? "-",
        m.driver ?? "-",
        m.notes ?? "-",
        m.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
      ]);
      styleDataRow(row, rowCount, COL_COUNT);
      if (m.status === "PENDING_REGULARIZATION") {
        row.getCell(13).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${RED_LIGHT}` } };
        row.getCell(13).font = { bold: true, color: { argb: "FF991B1B" } };
      }
      row.getCell(6).alignment = { horizontal: "right" };
      row.getCell(6).numFmt = '#,##0';
      row.getCell(7).alignment = { horizontal: "center" };
      rowCount++;
    });
  }

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── Salidas report (expands lotsDetail like the UI table) ───────────────── */

export async function exportSalidasExcel(data: Movement[], filename = "salidas"): Promise<void> {
  const COL_COUNT = 11;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Salidas");

  ws.columns = [
    { key: "fecha",    width: 20 },
    { key: "material", width: 40 },
    { key: "lote",     width: 20 },
    { key: "sapLot",   width: 20 },
    { key: "qty",      width: 16 },
    { key: "pallets",  width: 10 },
    { key: "desde",    width: 28 },
    { key: "destino",  width: 28 },
    { key: "carrier",  width: 24 },
    { key: "driver",   width: 20 },
    { key: "notes",    width: 34 },
  ];

  addReportHeader(ws, "Reporte de Salidas", COL_COUNT);
  applyHeaderRow(ws.addRow([]), [
    "Fecha", "Material", "Lote", "Lote SAP", "Cantidad", "Pallets",
    "Desde", "Destino", "Transportista", "Chofer", "Notas",
  ]);

  let rowCount = 0;
  for (const m of data) {
    const lots = (m.lotsDetail && m.lotsDetail.length > 0)
      ? m.lotsDetail
      : [{ lotCode: m.lotCode ?? null, sapLot: m.sapLot ?? null, pallets: m.pallets ?? null, quantity: m.quantity }];

    lots.forEach((ld) => {
      const row = ws.addRow([
        fmtDate(m.date),
        `${m.material.code} - ${m.material.description}`,
        ld.lotCode ?? "-",
        ld.sapLot ?? "-",
        ld.quantity,
        ld.pallets ?? "-",
        `${m.warehouse?.name ?? m.from?.warehouseName ?? "-"}${(m.location?.code ?? m.from?.locationCode) ? ` / ${m.location?.code ?? m.from?.locationCode}` : ""}`,
        m.destination ?? "-",
        m.carrier ?? "-",
        m.driver ?? "-",
        m.notes ?? "-",
      ]);
      styleDataRow(row, rowCount, COL_COUNT);
      row.getCell(5).alignment = { horizontal: "right" };
      row.getCell(5).numFmt = '#,##0';
      row.getCell(6).alignment = { horizontal: "center" };
      rowCount++;
    });
  }

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── Lotes & SAP report ──────────────────────────────────────────────────── */

export async function exportLotesExcel(data: Lot[], filename = "lotes"): Promise<void> {
  const COL_COUNT = 8;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Lotes");

  ws.columns = [
    { key: "lote",   width: 24 },
    { key: "sap",    width: 20 },
    { key: "mat",    width: 42 },
    { key: "venc",   width: 18 },
    { key: "fabr",   width: 18 },
    { key: "prov",   width: 26 },
    { key: "stock",  width: 16 },
    { key: "estado", width: 14 },
  ];

  addReportHeader(ws, "Reporte de Lotes & SAP", COL_COUNT);
  applyHeaderRow(ws.addRow([]), ["Código lote", "Lote SAP", "Material", "Vencimiento", "Fabricación", "Proveedor", "Stock", "Estado"]);

  let rowCount = 0;
  data.forEach((r, i) => {
    const row = ws.addRow([
      r.lotCode,
      r.sapLot ?? "-",
      r.product ? `${r.product.code} - ${r.product.description}` : r.productId,
      fmtDate(r.fechaVencimiento),
      fmtDate(r.fechaFabricacion),
      r.proveedor ?? "-",
      r.stockActual,
      r.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
    ]);
    styleDataRow(row, i, COL_COUNT);
    if (r.status === "PENDING_REGULARIZATION") {
      row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${RED_LIGHT}` } };
      row.getCell(8).font = { bold: true, color: { argb: "FF991B1B" } };
    }
    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(7).numFmt = '#,##0';
    rowCount++;
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}

/* ── Control de Frescura ─────────────────────────────────────────────────── */

export async function exportFreshnessExcel(data: FreshnessRow[], filename = "control-frescura"): Promise<void> {
  const COL_COUNT = 10;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet("Control de Frescura");

  ws.columns = [
    { key: "codigo",   width: 18 },
    { key: "materia",  width: 44 },
    { key: "um",       width: 8  },
    { key: "lote",     width: 22 },
    { key: "sapLot",   width: 20 },
    { key: "prov",     width: 26 },
    { key: "cantidad", width: 16 },
    { key: "fabr",     width: 18 },
    { key: "venc",     width: 18 },
    { key: "dias",     width: 24 },
  ];

  addReportHeader(ws, "Control de Frescura", COL_COUNT);
  applyHeaderRow(ws.addRow([]), [
    "Código", "Material", "UM", "Lote", "Lote SAP", "Proveedor",
    "Cantidad", "F. Fabricación", "F. Vencimiento", "Días hasta vencimiento",
  ]);

  data.forEach((r) => {
    const row = ws.addRow([
      r.product.code,
      r.product.description,
      r.product.unitOfMeasure ?? "",
      r.lotCode,
      r.sapLot ?? "-",
      r.proveedor ?? "-",
      r.stockActual,
      fmtDate(r.fechaFabricacion),
      fmtDate(r.fechaVencimiento),
      r.diasRestantes,
    ]);

    let bgArgb = `FF${GREEN_LIGHT}`;
    if (r.diasRestantes < 0) bgArgb = `FFFEE2E2`;
    else if (r.diasRestantes <= 30) bgArgb = `FF${ORANGE_LIGHT}`;
    else if (r.diasRestantes <= 60) bgArgb = `FF${YELLOW_LIGHT}`;

    for (let c = 1; c <= COL_COUNT; c++) {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
    }

    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(7).numFmt = '#,##0';
    row.getCell(10).alignment = { horizontal: "right" };
    row.getCell(10).numFmt = '#,##0';
    row.getCell(10).font = {
      bold: true,
      color: { argb: r.diasRestantes < 0 ? "FF991B1B" : r.diasRestantes <= 30 ? "FFB45309" : "FF166534" },
    };
  });

  // Leyenda de colores
  const legendStart = data.length + 5;
  const legendData: [number, string, string][] = [
    [legendStart,     `FFFEE2E2`,         "Vencido (< 0 días)"],
    [legendStart + 1, `FF${ORANGE_LIGHT}`, "Crítico (≤ 30 días)"],
    [legendStart + 2, `FF${YELLOW_LIGHT}`, "Próximo (≤ 60 días)"],
    [legendStart + 3, `FF${GREEN_LIGHT}`,  "OK (> 60 días)"],
  ];
  legendData.forEach(([rowNum, argb, label]) => {
    const cell = ws.getRow(rowNum).getCell(2);
    cell.value = label;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.font = { size: 9, italic: true };
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  await downloadWorkbook(wb, filename);
}

/* ── Trazabilidad report ─────────────────────────────────────────────────── */

export async function exportTrazabilidadExcel(
  materialCode: string,
  history: ReportTraceEvent[],
  filename = "trazabilidad",
): Promise<void> {
  const COL_COUNT = 7;
  const wb = buildBaseWorkbook();
  const ws = wb.addWorksheet(`Traza ${materialCode}`.slice(0, 31));

  ws.columns = [
    { key: "fecha",  width: 20 },
    { key: "tipo",   width: 20 },
    { key: "qty",    width: 16 },
    { key: "desde",  width: 32 },
    { key: "hacia",  width: 32 },
    { key: "doc",    width: 22 },
    { key: "notas",  width: 36 },
  ];

  addReportHeader(ws, `Trazabilidad — ${materialCode}`, COL_COUNT);
  applyHeaderRow(ws.addRow([]), ["Fecha", "Tipo", "Cantidad", "Desde", "Hacia", "MIC/Factura/Remito", "Notas"]);

  const TRACE_LABEL: Record<string, string> = {
    ENTRY: "Entrada", EXIT: "Salida", TRANSFER: "Transferencia",
    ADJUSTMENT_IN: "Ajuste +", ADJUSTMENT_OUT: "Ajuste -",
  };

  let rowCount = 0;
  history.forEach((e, i) => {
    const row = ws.addRow([
      fmtDate(e.at),
      TRACE_LABEL[e.type] ?? e.type,
      e.quantity,
      `${e.fromWarehouseName ?? e.warehouseName ?? "-"}${e.fromLocationCode ? ` / ${e.fromLocationCode}` : ""}`,
      `${e.toWarehouseName ?? "-"}${e.toLocationCode ? ` / ${e.toLocationCode}` : ""}`,
      e.documentNumber ?? "-",
      e.notes ?? "-",
    ]);
    styleDataRow(row, i, COL_COUNT);
    row.getCell(3).alignment = { horizontal: "right" };
    row.getCell(3).numFmt = '#,##0';
    rowCount++;
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COL_COUNT } };
  addBrandFooter(ws, 3 + rowCount);
  await downloadWorkbook(wb, filename);
}
