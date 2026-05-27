/**
 * PDF export utilities using jsPDF + jspdf-autotable.
 *
 * All exported functions are fire-and-forget:
 *   exportStockPDF(stockData, "stock-2026-05-20")
 *
 * Branding:
 *   - Primary color #2563eb used for table headers
 *   - Footer with generation timestamp
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StockItemRow, ReportMovementRow, DailyStockRow, ReportTraceEvent } from "../api/reports";
import type { PalletHistoryEvent } from "../api/pallets";
import type { Movement } from "../api/movements";
import type { Lot } from "../api/lots";

/* ── Constants ────────────────────────────────────────────────────────────── */

const PRIMARY_RGB: [number, number, number] = [37, 99, 235]; // #2563eb
const HEADER_TEXT: [number, number, number] = [255, 255, 255];
const ALT_ROW: [number, number, number] = [243, 244, 246]; // gray-100
const BRAND_NAME = "RL Logística";

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function addDocHeader(doc: jsPDF, title: string) {
  doc.setFontSize(18);
  doc.setTextColor(...PRIMARY_RGB);
  doc.setFont("helvetica", "bold");
  doc.text(BRAND_NAME, 14, 14);

  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.setFont("helvetica", "normal");
  doc.text(title, 14, 21);

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generado: ${new Date().toLocaleString("es-AR")}`,
    doc.internal.pageSize.width - 14,
    14,
    { align: "right" },
  );

  return 28; // startY for table
}

function addPageNumbers(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.width;
  const h = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.text(`Página ${i} / ${pages}`, w / 2, h - 6, { align: "center" });
  }
}

const tableStyles = {
  headStyles: {
    fillColor: PRIMARY_RGB,
    textColor: HEADER_TEXT,
    fontStyle: "bold" as const,
    fontSize: 9,
  },
  alternateRowStyles: { fillColor: ALT_ROW },
  bodyStyles: { fontSize: 8 },
  margin: { left: 14, right: 14 },
};

/* ── Stock report ─────────────────────────────────────────────────────────── */

export function exportStockPDF(
  data: StockItemRow[],
  filename = "stock-report",
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Stock Actual");

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Código", "Material", "Depósito", "Ubicación", "Cantidad", "Actualizado"]],
    body: data.map((r) => [
      r.material.code,
      r.material.description,
      r.warehouse?.name ?? "-",
      r.location?.code ?? "-",
      `${r.currentQuantity.toLocaleString("es-AR")} ${r.material.unitOfMeasure ?? ""}`.trim(),
      new Date(r.updatedAt).toLocaleDateString("es-AR"),
    ]),
    columnStyles: {
      0: { cellWidth: 28 },
      4: { halign: "right" },
      5: { halign: "center", cellWidth: 28 },
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Movement history report ─────────────────────────────────────────────── */

export function exportMovementsPDF(
  data: ReportMovementRow[],
  filename = "movimientos",
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Historial de Movimientos");

  const MOVE_LABEL: Record<string, string> = {
    ENTRY: "Entrada",
    EXIT: "Salida",
    TRANSFER: "Transferencia",
    ADJUSTMENT_IN: "Ajuste +",
    ADJUSTMENT_OUT: "Ajuste -",
  };

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Fecha", "Tipo", "Material", "Cantidad", "Depósito", "Documento", "Proveedor/Transportista"]],
    body: data.map((r) => [
      new Date(r.date).toLocaleDateString("es-AR"),
      MOVE_LABEL[r.type] ?? r.type,
      r.material?.code ?? "-",
      r.quantity.toLocaleString("es-AR"),
      r.warehouse?.name ?? "-",
      r.documentNumber ?? "-",
      r.supplier ?? r.carrier ?? "-",
    ]),
    columnStyles: {
      3: { halign: "right" },
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
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, `Control diario de stock — ${dateLabel}`);

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Material", "UM", "Stock inicial", "Entradas", "Salidas", "Stock final"]],
    body: data.map((r) => [
      `${r.material.code} · ${r.material.description}`,
      r.material.unitOfMeasure ?? "",
      r.stockInicial.toLocaleString("es-AR"),
      r.entradas > 0 ? `+${r.entradas.toLocaleString("es-AR")}` : "0",
      r.salidas > 0 ? `-${r.salidas.toLocaleString("es-AR")}` : "0",
      r.stockFinal.toLocaleString("es-AR"),
    ]),
    columnStyles: {
      1: { halign: "center", cellWidth: 14 },
      2: { halign: "right", cellWidth: 24 },
      3: { halign: "right", cellWidth: 24 },
      4: { halign: "right", cellWidth: 24 },
      5: { halign: "right", cellWidth: 24 },
    },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Entradas report ─────────────────────────────────────────────────────── */

const MOVE_LABEL_MAP: Record<string, string> = {
  ENTRY: "Entrada", EXIT: "Salida", TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste +", ADJUSTMENT_OUT: "Ajuste -",
};

export function exportEntradasPDF(data: Movement[], filename = "entradas") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Entradas");

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Fecha", "Material", "Lote", "Lote SAP", "N° Doc.", "Cantidad", "Pallets", "Depósito/Ubic.", "Proveedor", "Transportista", "Chofer", "Notas", "Estado"]],
    body: data.map((r) => [
      new Date(r.date).toLocaleDateString("es-AR"),
      `${r.material.code} · ${r.material.description}`,
      r.lotCode ?? "-",
      r.sapLot ?? "-",
      r.documentNumber ?? "-",
      `${r.quantity.toLocaleString("es-AR")} ${r.material.unitOfMeasure ?? ""}`.trim(),
      r.pallets != null ? String(r.pallets) : "-",
      `${r.warehouse?.name ?? "-"}${r.location?.code ? ` / ${r.location.code}` : ""}`,
      r.supplier ?? "-",
      r.carrier ?? "-",
      r.driver ?? "-",
      r.notes ?? "-",
      r.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
    ]),
    columnStyles: { 5: { halign: "right" }, 6: { halign: "center" } },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Salidas report ──────────────────────────────────────────────────────── */

export function exportSalidasPDF(data: Movement[], filename = "salidas") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Salidas");

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Fecha", "Material", "Lote", "Lote SAP", "Cantidad", "Pallets", "Desde", "Destino", "Transportista", "Chofer", "Notas"]],
    body: data.map((r) => [
      new Date(r.date).toLocaleDateString("es-AR"),
      `${r.material.code} · ${r.material.description}`,
      r.lotCode ?? "-",
      r.sapLot ?? "-",
      `${r.quantity.toLocaleString("es-AR")} ${r.material.unitOfMeasure ?? ""}`.trim(),
      r.pallets != null ? String(r.pallets) : "-",
      `${r.warehouse?.name ?? r.from?.warehouseName ?? "-"}${(r.location?.code ?? r.from?.locationCode) ? ` / ${r.location?.code ?? r.from?.locationCode}` : ""}`,
      r.destination ?? "-",
      r.carrier ?? "-",
      r.driver ?? "-",
      r.notes ?? "-",
    ]),
    columnStyles: { 4: { halign: "right" }, 5: { halign: "center" } },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Lotes & SAP report ──────────────────────────────────────────────────── */

export function exportLotesPDF(data: Lot[], filename = "lotes") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, "Reporte de Lotes & SAP");

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Código lote", "Lote SAP", "Material", "Vencimiento", "Fabricación", "Proveedor", "Stock", "Estado"]],
    body: data.map((r) => [
      r.lotCode,
      r.sapLot ?? "-",
      r.product ? `${r.product.code} · ${r.product.description}` : r.productId,
      r.fechaVencimiento ? new Date(r.fechaVencimiento).toLocaleDateString("es-AR") : "-",
      r.fechaFabricacion ? new Date(r.fechaFabricacion).toLocaleDateString("es-AR") : "-",
      r.proveedor ?? "-",
      r.stockActual.toLocaleString("es-AR"),
      r.status === "PENDING_REGULARIZATION" ? "Pendiente" : "Normal",
    ]),
    columnStyles: { 6: { halign: "right" } },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Trazabilidad report ─────────────────────────────────────────────────── */

export function exportTrazabilidadPDF(
  materialCode: string,
  history: ReportTraceEvent[],
  filename = "trazabilidad",
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(doc, `Trazabilidad — ${materialCode}`);

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Fecha", "Tipo", "Cantidad", "Desde", "Destino", "Documento", "Notas"]],
    body: history.map((e) => [
      new Date(e.at).toLocaleDateString("es-AR"),
      MOVE_LABEL_MAP[e.type] ?? e.type,
      e.quantity.toLocaleString("es-AR"),
      `${e.fromWarehouseName ?? e.warehouseName ?? "-"}${e.fromLocationCode ? ` / ${e.fromLocationCode}` : ""}`,
      `${e.toWarehouseName ?? "-"}${e.toLocationCode ? ` / ${e.toLocationCode}` : ""}`,
      e.documentNumber ?? "-",
      e.notes ?? "-",
    ]),
    columnStyles: { 2: { halign: "right" } },
  });

  addPageNumbers(doc);
  doc.save(`${filename}.pdf`);
}

/* ── Pallet history (trazabilidad) ───────────────────────────────────────── */

export function exportPalletHistoryPDF(
  palletCode: string,
  productCode: string,
  events: PalletHistoryEvent[],
  filename?: string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const startY = addDocHeader(
    doc,
    `Trazabilidad — Palet ${palletCode} · Material ${productCode}`,
  );

  const MOVE_LABEL: Record<string, string> = {
    ENTRY: "Entrada",
    EXIT: "Salida",
    TRANSFER: "Transferencia",
    ADJUSTMENT_IN: "Ajuste +",
    ADJUSTMENT_OUT: "Ajuste -",
  };

  autoTable(doc, {
    ...tableStyles,
    startY,
    head: [["Fecha", "Tipo", "Cantidad", "Desde", "Hacia", "Documento", "Notas"]],
    body: events.map((e) => [
      new Date(e.date).toLocaleDateString("es-AR"),
      MOVE_LABEL[e.type] ?? e.type,
      e.quantity.toLocaleString("es-AR"),
      e.from ? `${e.from.locationCode} (${e.from.warehouseName ?? ""})` : "-",
      e.to ? `${e.to.locationCode} (${e.to.warehouseName ?? ""})` : "-",
      e.documentNumber ?? "-",
      e.notes ?? "-",
    ]),
    columnStyles: {
      2: { halign: "right" },
    },
  });

  addPageNumbers(doc);
  doc.save(filename ?? `trazabilidad-${palletCode}.pdf`);
}
