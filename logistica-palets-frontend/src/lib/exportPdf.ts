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
import type { StockItemRow, ReportMovementRow } from "../api/reports";
import type { PalletHistoryEvent } from "../api/pallets";

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
      r.product?.code ?? "-",
      r.quantity.toLocaleString("es-AR"),
      r.warehouseName ?? "-",
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
