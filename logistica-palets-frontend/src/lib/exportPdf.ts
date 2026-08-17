import { fmtDate, fmtDateTime, fmtGeneratedAt } from "../utils/dateFormat";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StockItemRow, ReportMovementRow, DailyStockRow, ReportTraceEvent } from "../api/reports";
import type { PalletHistoryEvent } from "../api/pallets";
import type { Movement } from "../api/movements";
import type { Lot } from "../api/lots";
import { buildSalidasExportRows, DOCUMENTO_MATERIAL_PENDING } from "./salidasExportRows";

/* ── Constants ────────────────────────────────────────────────────────────── */

const PRIMARY_RGB: [number, number, number] = [37, 99, 235];
const HEADER_TEXT: [number, number, number] = [255, 255, 255];
const ALT_ROW: [number, number, number]     = [243, 244, 246];
const TABLE_BORDER: [number, number, number] = [203, 213, 225];
const BRAND_NAME = "RL Logística";

const MOVE_LABEL_MAP: Record<string, string> = {
  ENTRY: "Entrada", EXIT: "Salida", TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste +", ADJUSTMENT_OUT: "Ajuste -",
};

/* ── Header / footer helpers ──────────────────────────────────────────────── */

function addDocHeader(doc: jsPDF, title: string): number {
  const pageW = doc.internal.pageSize.width;

  doc.setFontSize(18);
  doc.setTextColor(...PRIMARY_RGB);
  doc.setFont("helvetica", "bold");
  doc.text(BRAND_NAME, 14, 14);

  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.setFont("helvetica", "normal");
  doc.text(title, 14, 22);

  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text(fmtGeneratedAt(), pageW - 14, 14, { align: "right" });

  // Divider line
  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.3);
  doc.line(14, 26, pageW - 14, 26);

  return 30; // startY for table
}

function addPageNumbers(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.width;
  const h = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.text(`Página ${i} / ${pages}`, w / 2, h - 6, { align: "center" });
  }
}

/* ── Shared table styles ──────────────────────────────────────────────────── */

const baseStyles = {
  headStyles: {
    fillColor: PRIMARY_RGB,
    textColor: HEADER_TEXT,
    fontStyle: "bold" as const,
    fontSize: 9,
    cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
  },
  alternateRowStyles: { fillColor: ALT_ROW },
  bodyStyles: {
    fontSize: 8,
    overflow: "linebreak" as const,
    cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
  },
  tableLineColor: TABLE_BORDER,
  tableLineWidth: 0.15,
  margin: { left: 14, right: 14 },
};

/* ── Stock report ─────────────────────────────────────────────────────────── */

export function exportStockPDF(data: StockItemRow[], filename = "stock-report"): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Stock Actual");

  autoTable(doc, {
    ...baseStyles,
    startY,
    head: [["Código", "Material", "Depósito", "Ubicación", "Cantidad", "Actualizado"]],
    body: data.map((r) => [
      r.material.code,
      r.material.description,
      r.warehouse?.name ?? "-",
      r.location?.code ?? "-",
      `${r.currentQuantity.toLocaleString("es-PY")} ${r.material.unitOfMeasure ?? ""}`.trim(),
      fmtDateTime(r.updatedAt),
    ]),
    columnStyles: {
      0: { cellWidth: 28 },
      2: { cellWidth: 36 },
      3: { cellWidth: 22 },
      4: { halign: "right", cellWidth: 26 },
      5: { halign: "center", cellWidth: 28 },
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Movement history report ─────────────────────────────────────────────── */

export function exportMovementsPDF(data: ReportMovementRow[], filename = "movimientos"): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Historial de Movimientos");

  autoTable(doc, {
    ...baseStyles,
    startY,
    head: [["Fecha y hora", "Tipo", "Material", "Cantidad", "Depósito", "MIC/Fac/Rem.", "Prov. / Transportista", "Estado"]],
    body: data.map((r) => [
      fmtDateTime(r.createdAt ?? r.date),
      MOVE_LABEL_MAP[r.type] ?? r.type,
      r.material?.code ? `${r.material.code} - ${r.material.description}` : "-",
      r.quantity.toLocaleString("es-PY"),
      r.warehouse?.name ?? "-",
      r.documentNumber ?? "-",
      r.supplier ?? r.carrier ?? "-",
      r.voidStatus === "VOIDED" ? "Anulado" : "Normal",
    ]),
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 30 },
      3: { halign: "right", cellWidth: 24 },
      4: { cellWidth: 36 },
      5: { cellWidth: 30 },
      7: { cellWidth: 20 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && (data.row.raw as (string | number)[])[7] === "Anulado") {
        data.cell.styles.textColor = [156, 148, 136];
      }
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Daily stock (control diario) ────────────────────────────────────────── */

export function exportDailyStockPDF(
  data: DailyStockRow[],
  dateLabel: string,
  filename = "control-diario",
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, `Control diario de stock — ${dateLabel}`);

  autoTable(doc, {
    ...baseStyles,
    startY,
    head: [["Material", "UM", "Stock inicial", "Entradas", "Salidas", "Stock final"]],
    body: data.map((r) => [
      `${r.material.code} · ${r.material.description}`,
      r.material.unitOfMeasure ?? "",
      r.stockInicial.toLocaleString("es-PY"),
      r.entradas > 0 ? `+${r.entradas.toLocaleString("es-PY")}` : "0",
      r.salidas > 0 ? `-${r.salidas.toLocaleString("es-PY")}` : "0",
      r.stockFinal.toLocaleString("es-PY"),
    ]),
    columnStyles: {
      1: { halign: "center", cellWidth: 16 },
      2: { halign: "right", cellWidth: 28 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 28 },
      5: { halign: "right", cellWidth: 28, fontStyle: "bold" },
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Entradas report (expands lotsDetail) ────────────────────────────────── */

export function exportEntradasPDF(data: Movement[], filename = "entradas"): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Entradas");

  // Expand lotsDetail so each lot is its own row (mirrors UI table)
  const body: (string | number)[][] = [];
  for (const m of data) {
    const lots = (m.lotsDetail && m.lotsDetail.length > 0)
      ? m.lotsDetail
      : [{ lotCode: m.lotCode ?? null, sapLot: m.sapLot ?? null, pallets: m.pallets ?? null, quantity: m.quantity }];

    for (const ld of lots) {
      body.push([
        fmtDateTime(m.createdAt ?? m.date),
        `${m.material.code} · ${m.material.description}`,
        ld.lotCode ?? "-",
        ld.sapLot ?? "-",
        m.documentNumber ?? "-",
        `${ld.quantity.toLocaleString("es-PY")} ${m.material.unitOfMeasure ?? ""}`.trim(),
        ld.pallets != null ? String(ld.pallets) : "-",
        `${m.warehouse?.name ?? "-"}${m.location?.code ? ` / ${m.location.code}` : ""}`,
        m.supplier ?? "-",
        m.carrier ?? "-",
        m.driver ?? "-",
        m.notes ?? "-",
        m.voidStatus === "VOIDED" ? "Anulado" : m.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
      ]);
    }
  }

  autoTable(doc, {
    ...baseStyles,
    startY,
    margin: { left: 8, right: 8 },
    bodyStyles: { ...baseStyles.bodyStyles, fontSize: 7.5 },
    headStyles: { ...baseStyles.headStyles, fontSize: 8 },
    head: [["Fecha y hora", "Material", "Lote", "Lote SAP", "MIC/Fac/Rem.", "Cantidad", "Pal.", "Depósito / Ubic.", "Proveedor", "Transportista", "Chofer", "Notas", "Estado"]],
    body,
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 44 },
      2: { cellWidth: 18 },
      3: { cellWidth: 18 },
      4: { cellWidth: 18 },
      5: { halign: "right", cellWidth: 18 },
      6: { halign: "center", cellWidth: 10 },
      7: { cellWidth: 27 },
      8: { cellWidth: 20 },
      9: { cellWidth: 20 },
      10: { cellWidth: 18 },
      11: { cellWidth: 24 },
      12: { cellWidth: 14 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && (data.row.raw as (string | number)[])[12] === "Anulado") {
        data.cell.styles.textColor = [156, 148, 136];
      }
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Salidas report (expands lotsDetail) ─────────────────────────────────── */

export function exportSalidasPDF(data: Movement[], filename = "salidas"): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Salidas");

  const body: (string | number)[][] = buildSalidasExportRows(data).map((item) => [
    item.fecha,
    item.material,
    item.lote,
    item.sapLot,
    item.documentoMaterial,
    `${item.quantity.toLocaleString("es-PY")} ${item.unit}`.trim(),
    String(item.pallets),
    item.desde,
    item.destino,
    item.carrier,
    item.driver,
    item.notes,
    item.estado,
  ]);

  autoTable(doc, {
    ...baseStyles,
    startY,
    margin: { left: 10, right: 10 },
    head: [["Fecha y hora", "Material", "Lote", "Lote SAP", "Documento Material", "Cantidad", "Pal.", "Desde", "Destino", "Transportista", "Chofer", "Notas", "Estado"]],
    body,
    columnStyles: {
      0: { cellWidth: 19 },
      1: { cellWidth: 38 },
      2: { cellWidth: 15 },
      3: { cellWidth: 15 },
      4: { cellWidth: 19 },
      5: { halign: "right", cellWidth: 16 },
      6: { halign: "center", cellWidth: 8 },
      7: { cellWidth: 25 },
      8: { cellWidth: 23 },
      9: { cellWidth: 20 },
      10: { cellWidth: 17 },
      11: { cellWidth: 20 },
      12: { cellWidth: 12 },
    },
    didParseCell: (data) => {
      const row = data.row.raw as (string | number)[];
      if (data.section === "body" && data.column.index === 4 && row[4] === DOCUMENTO_MATERIAL_PENDING) {
        data.cell.styles.fillColor = [254, 249, 195];
        data.cell.styles.textColor = [146, 64, 14];
        data.cell.styles.fontStyle = "bold";
      }
      if (data.section === "body" && row[12] === "Anulado") {
        data.cell.styles.textColor = [156, 148, 136];
      }
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Lotes & SAP report ──────────────────────────────────────────────────── */

export function exportLotesPDF(data: Lot[], filename = "lotes"): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Lotes & SAP");

  autoTable(doc, {
    ...baseStyles,
    startY,
    head: [["Código lote", "Lote SAP", "Material", "Vencimiento", "Fabricación", "Proveedor", "Stock", "Estado"]],
    body: data.map((r) => [
      r.lotCode,
      r.sapLot ?? "-",
      r.product ? `${r.product.code} · ${r.product.description}` : r.productId,
      r.fechaVencimiento ? fmtDate(r.fechaVencimiento) : "-",
      fmtDate(r.fechaFabricacion),
      r.proveedor ?? "-",
      r.stockActual.toLocaleString("es-PY"),
      r.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
    ]),
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 24 },
      3: { halign: "center", cellWidth: 24 },
      4: { halign: "center", cellWidth: 24 },
      6: { halign: "right", cellWidth: 20 },
      7: { cellWidth: 20 },
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Trazabilidad report ─────────────────────────────────────────────────── */

export function exportTrazabilidadPDF(
  materialCode: string,
  history: ReportTraceEvent[],
  filename = "trazabilidad",
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, `Trazabilidad — ${materialCode}`);

  autoTable(doc, {
    ...baseStyles,
    startY,
    head: [["Fecha y hora", "Tipo", "Cantidad", "Desde", "Destino", "MIC/Fac/Rem.", "Notas", "Estado"]],
    body: history.map((e) => [
      fmtDateTime(e.at),
      MOVE_LABEL_MAP[e.type] ?? e.type,
      e.quantity.toLocaleString("es-PY"),
      `${e.fromWarehouseName ?? e.warehouseName ?? "-"}${e.fromLocationCode ? ` / ${e.fromLocationCode}` : ""}`,
      `${e.toWarehouseName ?? "-"}${e.toLocationCode ? ` / ${e.toLocationCode}` : ""}`,
      e.documentNumber ?? "-",
      e.notes ?? "-",
      e.voidStatus === "VOIDED" ? "Anulado" : "Normal",
    ]),
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 30 },
      2: { halign: "right", cellWidth: 22 },
      3: { cellWidth: 55 },
      4: { cellWidth: 55 },
      5: { cellWidth: 30 },
      7: { cellWidth: 20 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && (data.row.raw as (string | number)[])[7] === "Anulado") {
        data.cell.styles.textColor = [156, 148, 136];
      }
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Pallet history (trazabilidad de palet) ──────────────────────────────── */

export function exportPalletHistoryPDF(
  palletCode: string,
  productCode: string,
  events: PalletHistoryEvent[],
  filename?: string,
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(
    doc,
    `Trazabilidad — Palet ${palletCode} · Material ${productCode}`,
  );

  const PALLET_LABEL: Record<string, string> = {
    ENTRY: "Entrada", EXIT: "Salida", TRANSFER: "Transferencia",
    ADJUSTMENT_IN: "Ajuste +", ADJUSTMENT_OUT: "Ajuste -",
  };

  autoTable(doc, {
    ...baseStyles,
    startY,
    head: [["Fecha y hora", "Tipo", "Cantidad", "Desde", "Hacia", "MIC/Fac/Rem.", "Notas"]],
    body: events.map((e) => [
      fmtDateTime(e.createdAt ?? e.date),
      PALLET_LABEL[e.type] ?? e.type,
      e.quantity.toLocaleString("es-PY"),
      e.from ? `${e.from.locationCode} (${e.from.warehouseName ?? ""})` : "-",
      e.to ? `${e.to.locationCode} (${e.to.warehouseName ?? ""})` : "-",
      e.documentNumber ?? "-",
      e.notes ?? "-",
    ]),
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 30 },
      2: { halign: "right", cellWidth: 22 },
      3: { cellWidth: 55 },
      4: { cellWidth: 55 },
      5: { cellWidth: 30 },
    },
  });

  addPageNumbers(doc);
  doc.save(filename ?? `trazabilidad-${palletCode}.pdf`);
}
