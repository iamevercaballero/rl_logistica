import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDocumentForPrint, type DocumentPrintData, type PrintProduct, type PrintLot, type PrintWarehouse, type RawMovement } from "../api/movements";

function fmt(date?: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit", month: "2-digit", year: "numeric",
    ...opts,
  });
}

function buildMaps(data: DocumentPrintData) {
  const productMap: Record<string, PrintProduct> = Object.fromEntries(data.products.map((p) => [p.id, p]));
  const lotMap: Record<string, PrintLot> = Object.fromEntries(data.lots.map((l) => [l.id, l]));
  const warehouseMap: Record<string, PrintWarehouse> = Object.fromEntries(data.warehouses.map((w) => [w.id, w]));
  return { productMap, lotMap, warehouseMap };
}

export default function PrintDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["print-doc", id],
    queryFn: () => getDocumentForPrint(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [data]);

  const lines = useMemo(() => {
    if (!data) return [];
    const { productMap, lotMap } = buildMaps(data);
    return (data.movements as RawMovement[]).map((m) => {
      const product = productMap[m.productId] ?? { code: "—", description: "—", unitOfMeasure: null };
      const lot = m.lotId ? (lotMap[m.lotId] ?? null) : null;
      const palletCount = data.details.filter((d) => d.movementId === m.id && d.palletId).length || m.pallets || 0;
      return { movement: m, product, lot, palletCount };
    });
  }, [data]);

  if (isLoading) {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "sans-serif" }}>Cargando documento...</div>;
  }
  if (isError || !data) {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "sans-serif", color: "red" }}>Error cargando el documento.</div>;
  }

  const { document } = data;
  const { warehouseMap } = buildMaps(data);
  const isEntry = document.type === "ENTRY";
  const docTypeLabel = isEntry ? "NOTA DE ENTRADA" : "NOTA DE SALIDA";
  const warehouseName = document.warehouseId ? (warehouseMap[document.warehouseId]?.name ?? "—") : "—";

  const totalQty = lines.reduce((s, l) => s + l.movement.quantity, 0);
  const totalPallets = lines.reduce((s, l) => s + l.palletCount, 0);

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

        .doc-page {
          width: 210mm; min-height: 297mm;
          margin: 20px auto; background: #fff;
          padding: 16mm 18mm;
          box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        }

        .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .doc-company { font-size: 22px; font-weight: 900; color: #1a1a2e; letter-spacing: -0.5px; }
        .doc-company-sub { font-size: 11px; color: #666; margin-top: 2px; }
        .doc-type-block { text-align: right; }
        .doc-type { font-size: 15px; font-weight: 800; color: #4f46e5; text-transform: uppercase; }
        .doc-code { font-size: 22px; font-weight: 900; color: #1a1a2e; letter-spacing: 0.5px; font-family: monospace; }
        .doc-status { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
        .status-aprobado { background: #dcfce7; color: #166534; }
        .status-other { background: #fef9c3; color: #854d0e; }

        .divider { border: none; border-top: 2px solid #1a1a2e; margin: 10px 0; }
        .divider-light { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }

        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 10px; }
        .info-row { display: flex; gap: 6px; align-items: baseline; font-size: 12px; }
        .info-label { font-weight: 700; color: #374151; white-space: nowrap; min-width: 90px; }
        .info-value { color: #111; }

        .lines-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
        .lines-table th { background: #1a1a2e; color: #fff; padding: 7px 8px; text-align: left; font-size: 11px; font-weight: 700; }
        .lines-table th:not(:first-child) { border-left: 1px solid #374151; }
        .lines-table td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
        .lines-table td:not(:first-child) { border-left: 1px solid #e5e7eb; }
        .lines-table tr:nth-child(even) td { background: #f9fafb; }
        .lines-table .col-n { width: 28px; text-align: center; color: #6b7280; }
        .lines-table .col-code { width: 90px; font-family: monospace; font-weight: 700; }
        .lines-table .col-lot { width: 100px; font-family: monospace; }
        .lines-table .col-exp { width: 80px; }
        .lines-table .col-qty { width: 70px; text-align: right; font-weight: 700; }
        .lines-table .col-pal { width: 50px; text-align: right; }

        .totals-row { display: flex; gap: 32px; margin-top: 12px; padding: 10px 12px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #4f46e5; }
        .total-item { font-size: 13px; }
        .total-label { font-weight: 700; color: #374151; }
        .total-value { font-size: 16px; font-weight: 900; color: #1a1a2e; margin-left: 6px; }

        .signatures { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
        .sig-block { border-top: 1.5px solid #374151; padding-top: 8px; }
        .sig-label { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
        .sig-name { font-size: 11px; color: #374151; margin-top: 28px; padding-top: 4px; border-top: 1px solid #9ca3af; }

        .doc-footer { margin-top: 16px; font-size: 9px; color: #9ca3af; text-align: center; }

        @media print {
          body { background: #fff; }
          .print-controls { display: none !important; }
          .doc-page { margin: 0; padding: 12mm 14mm; box-shadow: none; width: 100%; min-height: auto; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="print-controls">
        <button className="btn-print" onClick={() => window.print()}>Imprimir</button>
        <button className="btn-close" onClick={() => window.close()}>Cerrar</button>
        <span style={{ fontSize: 13, color: "#aaa" }}>{document.code} — {docTypeLabel}</span>
      </div>

      <div className="doc-page">
        {/* Encabezado */}
        <div className="doc-header">
          <div>
            <div className="doc-company">RL LOGÍSTICA</div>
            <div className="doc-company-sub">Sistema de Gestión de Almacenes</div>
          </div>
          <div className="doc-type-block">
            <div className="doc-type">{docTypeLabel}</div>
            <div className="doc-code">{document.code}</div>
            <span className={`doc-status ${document.status === "APROBADO" ? "status-aprobado" : "status-other"}`}>
              {document.status.replace("_", " ")}
            </span>
          </div>
        </div>

        <hr className="divider" />

        {/* Info del documento */}
        <div className="info-grid">
          <div className="info-row">
            <span className="info-label">Fecha:</span>
            <span className="info-value">{fmt(document.date)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Depósito:</span>
            <span className="info-value">{warehouseName}</span>
          </div>
          {document.documentNumber && (
            <div className="info-row">
              <span className="info-label">{isEntry ? "Remito proveedor:" : "N° remito salida:"}</span>
              <span className="info-value">{document.documentNumber}</span>
            </div>
          )}
          {(isEntry ? document.supplier : document.destination) && (
            <div className="info-row">
              <span className="info-label">{isEntry ? "Proveedor:" : "Destino:"}</span>
              <span className="info-value">{isEntry ? document.supplier : document.destination}</span>
            </div>
          )}
          {document.carrier && (
            <div className="info-row">
              <span className="info-label">Transportadora:</span>
              <span className="info-value">{document.carrier}</span>
            </div>
          )}
          {document.driver && (
            <div className="info-row">
              <span className="info-label">Conductor:</span>
              <span className="info-value">{document.driver}</span>
            </div>
          )}
          {document.vehiclePlate && (
            <div className="info-row">
              <span className="info-label">Patente:</span>
              <span className="info-value" style={{ fontFamily: "monospace", fontWeight: 700 }}>{document.vehiclePlate}</span>
            </div>
          )}
        </div>

        {document.notes && (
          <div style={{ fontSize: 12, color: "#374151", background: "#fef9c3", padding: "6px 10px", borderRadius: 4, marginBottom: 8 }}>
            <strong>Observaciones:</strong> {document.notes}
          </div>
        )}

        {/* Tabla de líneas */}
        <table className="lines-table">
          <thead>
            <tr>
              <th className="col-n">#</th>
              <th className="col-code">Código</th>
              <th>Descripción</th>
              <th className="col-lot">Lote</th>
              <th className="col-exp">Vencimiento</th>
              <th className="col-qty">Cantidad</th>
              <th className="col-pal">Pallets</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ movement, product, lot, palletCount }, idx) => (
              <tr key={movement.id}>
                <td className="col-n">{idx + 1}</td>
                <td className="col-code">{product.code}</td>
                <td>
                  <div>{product.description}</div>
                  {product.unitOfMeasure && <div style={{ fontSize: 10, color: "#9ca3af" }}>{product.unitOfMeasure}</div>}
                </td>
                <td className="col-lot">{lot?.lotCode ?? "—"}</td>
                <td className="col-exp">{fmt(lot?.fechaVencimiento)}</td>
                <td className="col-qty">{movement.quantity.toLocaleString("es-PY")}</td>
                <td className="col-pal">{palletCount > 0 ? palletCount : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales */}
        <div className="totals-row">
          <div className="total-item">
            <span className="total-label">Total productos:</span>
            <span className="total-value">{lines.length}</span>
          </div>
          <div className="total-item">
            <span className="total-label">Total unidades:</span>
            <span className="total-value">{totalQty.toLocaleString("es-PY")}</span>
          </div>
          {totalPallets > 0 && (
            <div className="total-item">
              <span className="total-label">Total pallets:</span>
              <span className="total-value">{totalPallets}</span>
            </div>
          )}
        </div>

        <hr className="divider-light" style={{ marginTop: 20 }} />

        {/* Firmas */}
        <div className="signatures">
          <div className="sig-block">
            <div className="sig-label">{isEntry ? "Recibido por" : "Entregado por"}</div>
            <div className="sig-name">Nombre y aclaración</div>
          </div>
          <div className="sig-block">
            <div className="sig-label">{isEntry ? "Responsable depósito" : "Recibido por"}</div>
            <div className="sig-name">Nombre y aclaración</div>
          </div>
          <div className="sig-block">
            <div className="sig-label">Transportista</div>
            <div className="sig-name">Nombre y aclaración</div>
          </div>
        </div>

        <div className="doc-footer">
          Impreso el {fmt(new Date().toISOString(), { hour: "2-digit", minute: "2-digit" })} · RL Logística WMS · {document.code}
        </div>
      </div>
    </>
  );
}
