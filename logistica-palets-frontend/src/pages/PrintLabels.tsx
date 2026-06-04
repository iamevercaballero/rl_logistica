import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { getDocumentForPrint, type PrintProduct, type PrintLot, type PrintPallet, type RawMovement } from "../api/movements";

function fmt(date?: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" });
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
  qrValue: string;
};

function PalletLabel({ label }: { label: LabelData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isWeight = isWeightUnit(label.unitOfMeasure);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, label.qrValue, {
        width: 88,
        margin: 1,
        color: { dark: "#1a1a2e", light: "#ffffff" },
      }).catch(() => {});
    }
  }, [label.qrValue]);

  return (
    <div className="label">
      {/* Cabecera: empresa + código remito */}
      <div className="label-header">
        <span className="label-company">RL LOGÍSTICA</span>
        <span className="label-doccode">{label.docCode}</span>
      </div>

      {/* Fecha + N° remito externo */}
      <div className="label-meta-row">
        <span className="label-date">{label.docDate}</span>
        {label.docNumber && (
          <span className="label-meta-chip">Rem: {label.docNumber}</span>
        )}
      </div>

      {/* Proveedor */}
      {label.supplier && (
        <div className="label-supplier">Prov: {label.supplier}</div>
      )}

      <div className="label-divider" />

      {/* Producto */}
      <div className="label-product-code">{label.productCode}</div>
      <div className="label-product-desc">{label.productDesc}</div>

      <div className="label-divider" />

      {/* Lote + SAP */}
      <div className="label-lot-row">
        <div className="label-row">
          <span className="label-field-name">Lote:</span>
          <span className="label-field-val">{label.lotCode}</span>
        </div>
        {label.sapLot && (
          <div className="label-row">
            <span className="label-field-name">SAP:</span>
            <span className="label-field-val label-sap">{label.sapLot}</span>
          </div>
        )}
      </div>

      {/* Fechas de fabricación y vencimiento */}
      {(label.lotFabricacion || label.lotExpiry) && (
        <div className="label-dates-row">
          {label.lotFabricacion && (
            <div className="label-row">
              <span className="label-field-name">Fab:</span>
              <span className="label-field-val">{fmt(label.lotFabricacion)}</span>
            </div>
          )}
          {label.lotExpiry && (
            <div className="label-row">
              <span className="label-field-name">Vence:</span>
              <span className="label-field-val label-expiry">{fmt(label.lotExpiry)}</span>
            </div>
          )}
        </div>
      )}

      {/* Cantidad + unidad */}
      <div className="label-qty-row">
        <span className="label-qty">{label.quantity.toLocaleString("es-PY")}</span>
        {isWeight ? (
          <span className="label-qty-unit label-qty-unit--weight">{(label.unitOfMeasure ?? "kg").toUpperCase()}</span>
        ) : (
          <span className="label-qty-unit">{label.unitOfMeasure ?? "unid."}</span>
        )}
      </div>

      <div className="label-divider" />

      {/* Pallet + QR */}
      <div className="label-pallet-row">
        <div>
          <div className="label-field-name">Pallet:</div>
          <div className="label-pallet-code">{label.palletCode}</div>
        </div>
        <canvas ref={canvasRef} style={{ imageRendering: "pixelated" }} />
      </div>
    </div>
  );
}

export default function PrintLabelsPage() {
  const { documentId } = useParams<{ documentId: string }>();
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
      .filter((d) => d.palletId)
      .map((detail) => {
        const pallet = palletMap[detail.palletId!] ?? { code: detail.palletId!.slice(0, 8), quantity: detail.quantity, lotId: "" };
        const movement = movMap[detail.movementId];
        const productId = movement?.productId ?? "";
        const product = productMap[productId] ?? { code: "—", description: "—", unitOfMeasure: null };
        const lotId = detail.lotId ?? pallet.lotId;
        const lot = lotId ? (lotMap[lotId] ?? null) : null;

        // URL interna: al escanear abre el documento en la app (misma red WiFi)
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
        <div style={{ color: "#666" }}>Este documento no tiene pallets con etiquetas para imprimir.</div>
        <button onClick={() => window.close()} style={{ padding: "8px 20px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>Cerrar</button>
      </div>
    );
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; background: #f0f0f0; }

        .print-controls {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 24px; background: #1a1a2e; color: #fff;
          position: sticky; top: 0; z-index: 10;
        }
        .print-controls button {
          padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer;
          font-size: 14px; font-weight: 700;
        }
        .btn-print { background: #4f46e5; color: #fff; }
        .btn-close { background: transparent; color: #ccc; border: 1px solid #555 !important; }
        .ctrl-info { font-size: 13px; color: #aaa; }

        .labels-page {
          width: 210mm; margin: 20px auto;
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 5mm; padding: 8mm;
          background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        }

        .label {
          border: 1.5px solid #1a1a2e; border-radius: 6px;
          padding: 7px 9px; display: flex; flex-direction: column; gap: 3px;
          break-inside: avoid;
        }

        /* Cabecera */
        .label-header { display: flex; justify-content: space-between; align-items: center; }
        .label-company { font-size: 11px; font-weight: 900; color: #1a1a2e; letter-spacing: -0.3px; }
        .label-doccode { font-size: 9px; font-family: monospace; font-weight: 700; color: #4f46e5; background: #ede9fe; padding: 1px 5px; border-radius: 3px; }

        /* Meta row (fecha + N° remito) */
        .label-meta-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .label-date { font-size: 9px; color: #6b7280; }
        .label-meta-chip { font-size: 9px; font-family: monospace; color: #374151; background: #f3f4f6; padding: 0px 5px; border-radius: 3px; font-weight: 600; }

        /* Proveedor */
        .label-supplier { font-size: 9px; color: #374151; font-weight: 600; }

        .label-divider { border-top: 1px solid #e5e7eb; margin: 2px 0; }

        /* Producto */
        .label-product-code { font-size: 13px; font-weight: 900; color: #1a1a2e; font-family: monospace; }
        .label-product-desc { font-size: 10px; color: #374151; font-weight: 600; line-height: 1.3; }

        /* Lote */
        .label-lot-row { display: flex; flex-direction: column; gap: 1px; }
        .label-row { display: flex; gap: 5px; align-items: baseline; font-size: 10px; }
        .label-field-name { font-weight: 700; color: #6b7280; min-width: 36px; }
        .label-field-val { font-family: monospace; font-weight: 700; color: #111; }
        .label-sap { color: #4f46e5; }
        .label-expiry { color: #b45309; }

        /* Fechas fab/vto */
        .label-dates-row { display: flex; flex-direction: column; gap: 1px; }

        /* Cantidad */
        .label-qty-row { display: flex; align-items: baseline; gap: 5px; margin-top: 2px; }
        .label-qty { font-size: 20px; font-weight: 900; color: #1a1a2e; }
        .label-qty-unit { font-size: 11px; color: #6b7280; }
        .label-qty-unit--weight {
          font-size: 14px; font-weight: 900; color: #fff;
          background: #1a1a2e; padding: 0px 6px; border-radius: 4px;
          letter-spacing: 0.5px;
        }

        /* Pallet + QR */
        .label-pallet-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 1px; }
        .label-pallet-code { font-size: 11px; font-family: monospace; font-weight: 700; color: #1a1a2e; margin-top: 2px; }

        @media print {
          body { background: #fff; }
          .print-controls { display: none !important; }
          .labels-page { margin: 0; padding: 8mm; box-shadow: none; width: 100%; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="print-controls">
        <button className="btn-print" onClick={() => window.print()}>Imprimir etiquetas</button>
        <button className="btn-close" onClick={() => window.close()}>Cerrar</button>
        <span className="ctrl-info">{data.document.code} — {labels.length} etiqueta(s)</span>
      </div>

      <div className="labels-page">
        {labels.map((label, idx) => (
          <PalletLabel key={`${label.palletId}-${idx}`} label={label} />
        ))}
      </div>
    </>
  );
}
