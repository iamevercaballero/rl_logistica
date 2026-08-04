import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { getDocumentForPrint, type PrintProduct, type PrintLot, type PrintPallet, type RawMovement } from "../api/movements";

function fmt(date?: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDash(date?: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

const WEIGHT_UNITS = new Set(["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos", "gr", "gramos", "ton", "tn"]);
function isWeightUnit(u?: string | null): boolean {
  return !!u && WEIGHT_UNITS.has(u.toLowerCase().trim());
}

type LabelData = {
  docCode: string;
  docDate: string;
  docNumber: string | null;
  supplier: string | null;
  palletCode: string;
  palletId: string;
  productCode: string;
  productDesc: string;
  unitOfMeasure: string | null | undefined;
  lotCode: string;
  sapLot: string | null;
  lotFabricacion: string | null | undefined;
  lotExpiry: string | null | undefined;
  quantity: number;
  weightKg: number | null | undefined;
  qrValue: string;
};

function PalletLabel({ label }: { label: LabelData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const unit = (label.unitOfMeasure ?? "UN").toUpperCase();
  const isWeight = isWeightUnit(label.unitOfMeasure);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, label.qrValue, {
        width: 160,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      }).catch(() => {});
    }
  }, [label.qrValue]);

  return (
    <div className="label">

      {/* ── TÍTULO PRINCIPAL ── */}
      <div className="lbl-main-title">CARTEL DE FRESCURA DE INSUMOS</div>

      {/* ── SECCIÓN 1 ── */}
      <div className="lbl-section-bar">DESCRIPCION SAP DEL INSUMO</div>

      {/* Nombre del producto */}
      <div className="lbl-product-name">{label.productDesc}</div>

      {/* Código SAP + Fecha de Recepción */}
      <div className="lbl-code-reception-row">
        <div className="lbl-sap-block">
          <div className="lbl-small-label">Codigo SAP del Insumo</div>
          <div className="lbl-sap-code-box">{label.productCode}</div>
        </div>
        <div className="lbl-reception-block">
          <div className="lbl-small-label" style={{ textAlign: "right" }}>Fecha de Recepción</div>
          <div className="lbl-reception-date">{label.docDate}</div>
        </div>
      </div>

      {/* ── SECCIÓN 2 ── */}
      <div className="lbl-section-bar">GESTION DE FRESCURA DE INSUMOS</div>

      {/* Lote SAP grande */}
      <div className="lbl-big-lot-box">
        {label.sapLot ?? label.lotCode}
      </div>

      {/* Tabla de datos */}
      <table className="lbl-table">
        <tbody>
          <tr>
            <td className="lbl-td-key">Lote</td>
            <td className="lbl-td-val">{label.lotCode}</td>
            <td className="lbl-td-key" style={{ borderLeft: "2px solid #000" }}>Fecha de Recepción</td>
            <td className="lbl-td-val">{label.docDate}</td>
          </tr>
          <tr>
            <td className="lbl-td-key">Fecha de Fabricación:</td>
            <td className="lbl-td-val" colSpan={3}>{fmtDash(label.lotFabricacion)}</td>
          </tr>
          <tr>
            <td className="lbl-td-key">Vence:</td>
            <td className="lbl-td-val lbl-expiry" colSpan={3}>{fmtDash(label.lotExpiry)}</td>
          </tr>
          <tr className="lbl-qty-row">
            <td colSpan={3} className="lbl-td-qty-cell">
              <span className="lbl-qty-num">{label.quantity.toLocaleString("es-PY")}</span>
              <span className={isWeight ? "lbl-unit-badge-weight" : "lbl-unit-badge"}>{unit}</span>
            </td>
            <td className="lbl-td-qty-cell" style={{ textAlign: "right", verticalAlign: "bottom", paddingBottom: 6 }}>
              <span className="lbl-small-label">Pallet</span><br />
              <span className="lbl-pallet-code">{label.palletCode}</span>
            </td>
          </tr>
          <tr>
            <td className="lbl-td-key">Lote prov:</td>
            <td className="lbl-td-val">{label.sapLot ?? "—"}</td>
            <td className="lbl-td-key" style={{ borderLeft: "2px solid #000" }}>Peso Paleta (kg):</td>
            <td className="lbl-td-val">{label.weightKg != null ? label.weightKg.toLocaleString("es-PY") : "—"}</td>
          </tr>
          <tr>
            <td className="lbl-td-key">Cantidad:</td>
            <td className="lbl-td-val" colSpan={3}>
              {label.quantity.toLocaleString("es-PY")} {unit}
            </td>
          </tr>
          {label.supplier && (
            <tr>
              <td className="lbl-td-key">Proveedor:</td>
              <td className="lbl-td-val" colSpan={3}>{label.supplier}</td>
            </tr>
          )}
          {label.docNumber && (
            <tr>
              <td className="lbl-td-key">MIC/Fac/Rem.:</td>
              <td className="lbl-td-val" colSpan={3}>{label.docNumber}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── FOOTER: empresa + QR ── */}
      <div className="lbl-footer">
        <div className="lbl-footer-left">
          <div className="lbl-footer-company">RL LOGÍSTICA</div>
          <div className="lbl-footer-doc">{label.docCode}</div>
        </div>
        <canvas ref={canvasRef} style={{ imageRendering: "pixelated", display: "block" }} />
      </div>

    </div>
  );
}

export default function PrintLabelsPage() {
  const { documentId } = useParams<{ documentId: string }>();
  // ?pallet=<id> imprime una sola etiqueta: es lo que necesita el localizador
  // cuando se reimprime la etiqueta de un pallet puntual, no del remito entero.
  const [searchParams] = useSearchParams();
  const onlyPalletId = searchParams.get("pallet");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["print-labels", documentId],
    queryFn: () => getDocumentForPrint(documentId!),
    enabled: !!documentId,
    staleTime: 60_000,
  });

  const labels: LabelData[] = (() => {
    if (!data) return [];

    const productMap: Record<string, PrintProduct> = Object.fromEntries(data.products.map((p) => [p.id, p]));
    const lotMap: Record<string, PrintLot> = Object.fromEntries(data.lots.map((l) => [l.id, l]));
    const palletMap: Record<string, PrintPallet> = Object.fromEntries(data.pallets.map((p) => [p.id, p]));
    const movMap = Object.fromEntries((data.movements as RawMovement[]).map((m) => [m.id, m]));

    return data.details
      .filter((d) => d.palletId && (!onlyPalletId || d.palletId === onlyPalletId))
      .map((detail) => {
        const pallet = palletMap[detail.palletId!] ?? { code: detail.palletId!.slice(0, 8), quantity: detail.quantity, lotId: "" };
        const movement = movMap[detail.movementId];
        const productId = movement?.productId ?? "";
        const product = productMap[productId] ?? { code: "—", description: "—", unitOfMeasure: null };
        const lotId = detail.lotId ?? pallet.lotId;
        const lot = lotId ? (lotMap[lotId] ?? null) : null;

        const qrValue = `${window.location.origin}/print/document/${data.document.id}`;

        return {
          docCode: data.document.code,
          docDate: fmt(data.document.date),
          docNumber: data.document.documentNumber ?? null,
          supplier: data.document.supplier ?? null,
          palletCode: pallet.code,
          palletId: detail.palletId!,
          productCode: product.code,
          productDesc: product.description,
          unitOfMeasure: product.unitOfMeasure,
          lotCode: lot?.lotCode ?? "SIN LOTE",
          sapLot: lot?.sapLot ?? null,
          lotFabricacion: lot?.fechaFabricacion ?? null,
          lotExpiry: lot?.fechaVencimiento ?? null,
          quantity: detail.quantity,
          weightKg: pallet.weightKg,
          qrValue,
        };
      });
  })();

  useEffect(() => {
    if (!data || labels.length === 0) return;
    const t = setTimeout(() => window.print(), 1400);
    return () => clearTimeout(t);
  }, [data, labels.length]);

  if (isLoading) {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "sans-serif" }}>Generando etiquetas...</div>;
  }
  if (isError || !data) {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "sans-serif", color: "red" }}>Error cargando el documento.</div>;
  }
  if (labels.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "sans-serif", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Sin pallets registrados</div>
        <div style={{ color: "#666" }}>
          {onlyPalletId
            ? "El pallet solicitado no pertenece a este documento."
            : "Este documento no tiene pallets con etiquetas para imprimir."}
        </div>
        <button onClick={() => window.close()} style={{ padding: "8px 20px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>Cerrar</button>
      </div>
    );
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; background: #d0d0d0; }

        /* ── Barra de controles (solo en pantalla) ── */
        .print-controls {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 24px; background: #1a1a2e; color: #fff;
          position: sticky; top: 0; z-index: 10;
          font-family: Arial, Helvetica, sans-serif;
        }
        .print-controls button {
          padding: 7px 18px; border: none; border-radius: 6px;
          cursor: pointer; font-size: 14px; font-weight: 700;
        }
        .btn-print { background: #4f46e5; color: #fff; }
        .btn-close { background: transparent; color: #ccc; border: 1px solid #555 !important; }
        .ctrl-info { font-size: 13px; color: #aaa; }

        /* ── Una etiqueta = una hoja A4 ── */
        .label {
          width: 210mm;
          min-height: 297mm;
          margin: 16px auto;
          background: #fff;
          box-shadow: 0 4px 24px rgba(0,0,0,0.25);
          display: flex;
          flex-direction: column;
          border: 2.5px solid #000;
          overflow: hidden;
        }

        /* Título principal */
        .lbl-main-title {
          background: #2563eb;
          color: #fff;
          text-align: center;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: 2px;
          padding: 14px 16px;
          text-transform: uppercase;
        }

        /* Barra de sección */
        .lbl-section-bar {
          background: #2563eb;
          color: #fff;
          text-align: center;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 1.5px;
          padding: 6px 16px;
          margin-top: 0;
          text-transform: uppercase;
        }

        /* Nombre del producto */
        .lbl-product-name {
          text-align: center;
          font-size: 32px;
          font-weight: 900;
          color: #000;
          padding: 16px 20px 10px;
          letter-spacing: 0.5px;
          border-bottom: 2px solid #000;
          line-height: 1.2;
        }

        /* Fila código SAP + fecha recepción */
        .lbl-code-reception-row {
          display: flex;
          align-items: stretch;
          border-bottom: 2px solid #000;
        }
        .lbl-sap-block {
          flex: 1;
          padding: 10px 16px;
          border-right: 2px solid #000;
        }
        .lbl-reception-block {
          padding: 10px 16px;
          min-width: 180px;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: center;
        }
        .lbl-small-label {
          font-size: 11px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        .lbl-sap-code-box {
          background: #2563eb;
          color: #fff;
          font-size: 36px;
          font-weight: 900;
          font-family: monospace;
          padding: 6px 14px;
          display: inline-block;
          letter-spacing: 1px;
        }
        .lbl-reception-date {
          font-size: 22px;
          font-weight: 900;
          color: #000;
        }

        /* Lote SAP grande */
        .lbl-big-lot-box {
          background: #2563eb;
          color: #fff;
          text-align: center;
          font-size: 42px;
          font-weight: 900;
          font-family: monospace;
          letter-spacing: 3px;
          padding: 14px 16px;
          margin: 0;
        }

        /* Tabla de datos */
        .lbl-table {
          width: 100%;
          border-collapse: collapse;
          flex: 1;
        }
        .lbl-table td {
          border: 1.5px solid #000;
          padding: 10px 14px;
          vertical-align: middle;
        }
        .lbl-td-key {
          font-size: 13px;
          font-weight: 800;
          color: #000;
          background: #f5f5f5;
          white-space: nowrap;
          width: 1%;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .lbl-td-val {
          font-size: 18px;
          font-weight: 700;
          font-family: monospace;
          color: #000;
        }
        .lbl-expiry {
          color: #b45309;
          font-size: 20px;
        }

        /* Fila cantidad */
        .lbl-qty-row td { border: 1.5px solid #000; }
        .lbl-td-qty-cell { padding: 8px 14px; vertical-align: middle; }
        .lbl-qty-num {
          font-size: 56px;
          font-weight: 900;
          color: #000;
          line-height: 1;
          margin-right: 10px;
        }
        .lbl-unit-badge {
          font-size: 22px;
          font-weight: 900;
          color: #000;
          vertical-align: middle;
        }
        .lbl-unit-badge-weight {
          font-size: 26px;
          font-weight: 900;
          color: #fff;
          background: #000;
          padding: 2px 12px;
          border-radius: 4px;
          vertical-align: middle;
          letter-spacing: 1px;
        }
        .lbl-pallet-code {
          font-size: 16px;
          font-weight: 900;
          font-family: monospace;
          color: #000;
        }

        /* Footer */
        .lbl-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding: 12px 16px;
          border-top: 2.5px solid #000;
          margin-top: auto;
        }
        .lbl-footer-company {
          font-size: 20px;
          font-weight: 900;
          color: #000;
          letter-spacing: 1px;
        }
        .lbl-footer-doc {
          font-size: 13px;
          font-family: monospace;
          color: #555;
          margin-top: 4px;
        }

        /* ── Impresión ── */
        @media print {
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
          }
          body { background: #fff; }
          .print-controls { display: none !important; }
          .label {
            width: 210mm;
            min-height: 0;
            height: 297mm;
            max-height: 297mm;
            margin: 0;
            box-shadow: none;
            border: none;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
          }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="print-controls">
        <button className="btn-print" onClick={() => window.print()}>🖨 Imprimir etiquetas</button>
        <button className="btn-close" onClick={() => window.close()}>Cerrar</button>
        <span className="ctrl-info">{data.document.code} — {labels.length} etiqueta(s)</span>
      </div>

      {labels.map((label, idx) => (
        <PalletLabel key={`${label.palletId}-${idx}`} label={label} />
      ))}
    </>
  );
}
