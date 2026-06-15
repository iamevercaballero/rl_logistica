import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDocumentForPrint, type DocumentPrintData, type PrintProduct, type PrintLot, type PrintWarehouse, type PrintPallet, type RawMovement } from "../api/movements";

function fmt(date?: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function buildMaps(data: DocumentPrintData) {
  const productMap: Record<string, PrintProduct> = Object.fromEntries(data.products.map((p) => [p.id, p]));
  const lotMap: Record<string, PrintLot> = Object.fromEntries(data.lots.map((l) => [l.id, l]));
  const warehouseMap: Record<string, PrintWarehouse> = Object.fromEntries(data.warehouses.map((w) => [w.id, w]));
  const palletMap: Record<string, PrintPallet> = Object.fromEntries(data.pallets.map((p) => [p.id, p]));
  return { productMap, lotMap, warehouseMap, palletMap };
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
    const { productMap, lotMap, palletMap } = buildMaps(data);
    return (data.movements as RawMovement[]).map((m) => {
      const product = productMap[m.productId] ?? { code: "—", description: "—", unitOfMeasure: null };
      const movDetails = data.details.filter((d) => d.movementId === m.id);
      /* Lotes del movimiento: el directo o los de sus detalles/pallets (multi-lote) */
      const lotIds = [...new Set([
        m.lotId,
        ...movDetails.map((d) => d.lotId ?? (d.palletId ? palletMap[d.palletId]?.lotId : null)),
      ].filter((v): v is string => !!v))];
      const lots = lotIds.map((lid) => lotMap[lid]).filter((l): l is PrintLot => !!l);
      const palletCount = movDetails.filter((d) => d.palletId).length || m.pallets || 0;
      return { movement: m, product, lots, palletCount };
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
  const totalQty  = lines.reduce((s, l) => s + l.movement.quantity, 0);
  const totalPallets = lines.reduce((s, l) => s + l.palletCount, 0);

  /* Filas vacías para completar mínimo de 12 líneas en la tabla */
  const MIN_ROWS = 12;
  const emptyRows = Math.max(0, MIN_ROWS - lines.length);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; color: inherit; }
        html, body { color: #000 !important; }
        body { font-family: Arial, Helvetica, sans-serif; background: #e0e0e0; font-size: 11px; color: #000 !important; }

        .print-controls {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 24px; background: #1a1a2e; color: #fff;
          position: sticky; top: 0; z-index: 10;
        }
        .print-controls button {
          padding: 7px 18px; border: none; border-radius: 6px;
          cursor: pointer; font-size: 14px; font-weight: 700;
        }
        .btn-print { background: #4f46e5; color: #fff; }
        .btn-close { background: transparent; color: #ccc; border: 1px solid #555 !important; }

        /* ── Hoja A4 ── */
        .doc-page {
          width: 210mm; min-height: 297mm;
          margin: 16px auto; background: #fff;
          padding: 10mm 12mm;
          box-shadow: 0 2px 12px rgba(0,0,0,0.2);
          display: flex; flex-direction: column;
          color: #000;
        }

        /* ── Encabezado ── */
        .doc-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 8px;
        }
        .doc-logo { height: 56px; width: auto; object-fit: contain; }
        .doc-title-block { text-align: right; }
        .doc-type-label {
          font-size: 13px; font-weight: 900; color: #1a56db;
          text-decoration: underline; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .doc-code-big { font-size: 20px; font-weight: 900; color: #000; margin-top: 4px; }

        /* ── Bloque emisor ── */
        .doc-issuer { margin-bottom: 10px; }
        .doc-issuer-row { display: flex; gap: 8px; margin-bottom: 3px; font-size: 11px; }
        .dil { font-weight: 700; color: #222; min-width: 140px; }
        .div { color: #000; }

        /* ── Sección vehículo ── */
        .section-title {
          font-size: 11px; font-weight: 900; color: #000 !important;
          border-top: 1.5px solid #000; border-bottom: 1px solid #999;
          padding: 3px 4px; margin: 8px 0 5px; text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .vehicle-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px;
          margin-bottom: 8px;
        }
        .vehicle-row { display: flex; gap: 6px; font-size: 11px; align-items: baseline; }

        /* ── Tabla de mercadería ── */
        .merch-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        .merch-table th {
          border: 1.5px solid #000; padding: 5px 7px;
          font-size: 11px; font-weight: 900; text-transform: uppercase;
          background: #fff; text-align: center; color: #000;
        }
        .merch-table td {
          border: 1px solid #777; padding: 4px 7px;
          font-size: 11px; vertical-align: top; min-height: 18px; color: #000;
        }
        .merch-table tr:nth-child(even) td { background: #f5f5f5; }
        .col-qty  { width: 60px; text-align: right; font-weight: 700; }
        .col-um   { width: 50px; text-align: center; }
        .col-lot  { width: 90px; font-family: monospace; font-size: 10px; color: #444; }
        .lot-sap  { font-size: 8.5px; color: #777; letter-spacing: -0.2px; }
        .col-exp  { width: 70px; font-size: 10px; color: #555; }
        .col-pal  { width: 45px; text-align: center; font-size: 10px; }

        /* ── Totales ── */
        .totals-bar {
          border: 1.5px solid #000; padding: 5px 10px; margin-top: 6px;
          display: flex; gap: 32px; font-size: 11px; background: #f9f9f9; color: #000;
        }
        .tot-lbl { font-weight: 700; color: #000; }
        .tot-val { font-weight: 900; margin-left: 4px; color: #000; }

        /* ── Observaciones ── */
        .obs-box {
          border: 1px solid #aaa; padding: 5px 8px; margin-top: 8px;
          font-size: 11px; min-height: 28px; background: #fffde7; color: #000;
        }

        /* ── Firmas ── */
        .signatures {
          display: grid; grid-template-columns: 1fr 1fr 1fr;
          gap: 0; border: 1.5px solid #000; margin-top: 16px;
        }
        .sig-cell {
          padding: 6px 8px;
          border-right: 1.5px solid #000;
        }
        .sig-cell:last-child { border-right: none; }
        .sig-header { font-size: 11px; font-weight: 900; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 28px; color: #000; }
        .sig-line-label { font-size: 10px; color: #333; border-top: 1px solid #555; padding-top: 3px; }
        .sig-ruc { font-size: 10px; color: #333; margin-top: 6px; }

        /* ── Pie de página ── */
        .doc-footer {
          margin-top: auto; padding-top: 8px; border-top: 1px solid #ccc;
          font-size: 9px; color: #999; text-align: center;
        }

        @media print {
          body { background: #fff; }
          .print-controls { display: none !important; }
          .doc-page { margin: 0; padding: 8mm 10mm; box-shadow: none; width: 100%; min-height: auto; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="print-controls">
        <button className="btn-print" onClick={() => window.print()}>🖨 Imprimir</button>
        <button className="btn-close" onClick={() => window.close()}>Cerrar</button>
        <span style={{ fontSize: 13, color: "#aaa" }}>{document.code} — {docTypeLabel}</span>
      </div>

      <div className="doc-page">

        {/* ── ENCABEZADO ── */}
        <div className="doc-header">
          <img src="/logo.jpg" alt="RL Logística" className="doc-logo" />
          <div className="doc-title-block">
            <div className="doc-type-label">{docTypeLabel}</div>
            <div className="doc-code-big">{document.code}</div>
          </div>
        </div>

        {/* ── DATOS DEL EMISOR / RECEPTOR ── */}
        <div className="doc-issuer">
          <div className="doc-issuer-row">
            <span className="dil">Fecha de Emisión:</span>
            <span className="div">{fmt(document.date)}</span>
          </div>
          <div className="doc-issuer-row">
            <span className="dil">{isEntry ? "Proveedor:" : "Destino:"}</span>
            <span className="div">{(isEntry ? document.supplier : document.destination) ?? "—"}</span>
          </div>
          <div className="doc-issuer-row">
            <span className="dil">Depósito:</span>
            <span className="div">{warehouseName}</span>
          </div>
          {document.documentNumber && (
            <div className="doc-issuer-row">
              <span className="dil">MIC/Factura/Remito:</span>
              <span className="div">{document.documentNumber}</span>
            </div>
          )}
        </div>

        {/* ── DATOS DEL VEHÍCULO ── */}
        {(document.carrier || document.vehiclePlate || document.driver) && (
          <>
            <div className="section-title">Datos del Vehículo de Transporte</div>
            <div className="vehicle-grid">
              {document.carrier && (
                <div className="vehicle-row">
                  <span className="dil">Transportadora / Marca:</span>
                  <span className="div">{document.carrier}</span>
                </div>
              )}
              {document.vehiclePlate && (
                <div className="vehicle-row">
                  <span className="dil">Patente / RUA:</span>
                  <span className="div" style={{ fontFamily: "monospace", fontWeight: 700 }}>{document.vehiclePlate}</span>
                </div>
              )}
              {document.driver && (
                <div className="vehicle-row">
                  <span className="dil">Nombre del Conductor:</span>
                  <span className="div">{document.driver}</span>
                </div>
              )}
              <div className="vehicle-row">
                <span className="dil">N° Cédula del Conductor:</span>
                <span className="div" style={{ borderBottom: "1px solid #999", minWidth: 120, display: "inline-block" }}>&nbsp;</span>
              </div>
            </div>
          </>
        )}

        {/* ── MERCADERÍA ── */}
        <div className="section-title">Descripción Detallada de la Mercadería</div>
        <table className="merch-table">
          <thead>
            <tr>
              <th className="col-qty">Cantidad</th>
              <th className="col-um">UM</th>
              <th>Descripción de la mercadería</th>
              <th className="col-lot">Lote</th>
              <th className="col-exp">Vencimiento</th>
              <th className="col-pal">Pallets</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ movement, product, lots, palletCount }) => (
              <tr key={movement.id}>
                <td className="col-qty">{movement.quantity.toLocaleString("es-PY")}</td>
                <td className="col-um">{product.unitOfMeasure ?? "—"}</td>
                <td>
                  <strong>{product.code}</strong>
                  {product.description !== "—" && <span style={{ marginLeft: 4 }}>· {product.description}</span>}
                </td>
                <td className="col-lot">
                  {lots.length === 0 ? "—" : (
                    <>
                      {lots.map((l) => <div key={l.id}>{l.lotCode}</div>)}
                      {[...new Set(lots.map((l) => l.sapLot).filter((v): v is string => !!v))].map((s) => (
                        <div key={s} className="lot-sap">SAP {s}</div>
                      ))}
                    </>
                  )}
                </td>
                <td className="col-exp">
                  {lots.length === 0 ? "—" : lots.map((l) => (
                    <div key={l.id}>{fmt(l.fechaVencimiento)}</div>
                  ))}
                </td>
                <td className="col-pal">{palletCount > 0 ? palletCount : "—"}</td>
              </tr>
            ))}
            {/* Filas vacías */}
            {Array.from({ length: emptyRows }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td className="col-qty">&nbsp;</td>
                <td className="col-um"></td>
                <td></td>
                <td className="col-lot"></td>
                <td className="col-exp"></td>
                <td className="col-pal"></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── TOTALES ── */}
        <div className="totals-bar">
          <span><span className="tot-lbl">Total ítems:</span><span className="tot-val">{lines.length}</span></span>
          <span><span className="tot-lbl">Total unidades:</span><span className="tot-val">{totalQty.toLocaleString("es-PY")}</span></span>
          {totalPallets > 0 && (
            <span><span className="tot-lbl">Total pallets:</span><span className="tot-val">{totalPallets}</span></span>
          )}
        </div>

        {/* ── OBSERVACIONES ── */}
        <div className="obs-box">
          <strong>Observaciones:</strong> {document.notes ?? ""}
        </div>

        {/* ── FIRMAS ── */}
        <div className="signatures">
          <div className="sig-cell">
            <div className="sig-header">Autorizado por</div>
            <div className="sig-line-label">Firma y Aclaración</div>
            <div className="sig-ruc">RUC / CI: ___________________</div>
          </div>
          <div className="sig-cell">
            <div className="sig-header">Transportado por</div>
            <div className="sig-line-label">Firma y Aclaración</div>
            <div className="sig-ruc">RUC / CI: ___________________</div>
          </div>
          <div className="sig-cell">
            <div className="sig-header">Recibido por</div>
            <div className="sig-line-label">Firma y Aclaración</div>
            <div className="sig-ruc">RUC / CI: ___________________</div>
          </div>
        </div>

        {/* ── PIE ── */}
        <div className="doc-footer">
          Impreso el {fmt(new Date().toISOString())} · RL Logística WMS · {document.code}
          {document.status && <> · Estado: {document.status.replace("_", " ")}</>}
        </div>

      </div>
    </>
  );
}
