import { formatDateOnly } from "../utils/dateFormat";
import {
  previewMissingFields,
  previewTitle,
  previewTotals,
  type DocumentPreview,
} from "../pages/documentPreviewModel";

/**
 * Confirmación de Entrada/Salida — muestra cómo va a quedar la nota **antes**
 * de aplicar nada al stock.
 *
 * El orden de los bloques es el mismo de la nota impresa (`PrintDocument`):
 * cabecera, emisor/receptor, vehículo, mercadería, totales, observaciones y
 * firmas. Así la previa se lee como el papel que va a salir y no como otro
 * formulario más.
 *
 * Todo lo que se ve sale de las líneas que ya están armadas para enviarse: si
 * acá aparece un lote, ese lote se manda; si no aparece, no se manda.
 */
export type DocumentPreviewModalProps = {
  preview: DocumentPreview;
  /** Se está registrando: el botón queda ocupado y no se puede volver atrás. */
  saving: boolean;
  onConfirm: () => void;
  onBack: () => void;
};

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
      <span style={{ color: "var(--muted)", fontWeight: 700, minWidth: 150 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default function DocumentPreviewModal({
  preview,
  saving,
  onConfirm,
  onBack,
}: DocumentPreviewModalProps) {
  const isEntry = preview.type === "ENTRY";
  const totals = previewTotals(preview);
  const missing = previewMissingFields(preview);
  // Quien firma "Transportado por" es el conductor; la transportadora acompaña.
  const transportedBy = preview.driver?.trim() || preview.carrier?.trim() || "";

  return (
    <div
      className="modal-overlay"
      onClick={() => { if (!saving) onBack(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Confirmar ${isEntry ? "entrada" : "salida"}`}
    >
      <div
        className="card"
        style={{ width: "min(880px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Cabecera ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
              Revisá antes de confirmar
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Así va a quedar la {isEntry ? "nota de entrada" : "nota de entrega"}. Todavía no se
              registró nada.
            </p>
          </div>
          <span className={`badge ${isEntry ? "badge--entry" : "badge--exit"}`} style={{ fontSize: 11 }}>
            {previewTitle(preview.type)}
          </span>
        </div>

        {/* ── Emisor / receptor ── */}
        <section style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", display: "grid", gap: 5 }}>
          <Row label="Fecha de emisión" value={formatDateOnly(preview.date)} />
          <Row label={isEntry ? "Proveedor" : "Destino"} value={isEntry ? preview.supplier : preview.destination} />
          <Row label={isEntry ? "Depósito" : "Origen"} value={preview.warehouseName} />
          <Row label="MIC/Factura/Remito" value={preview.documentNumber} />
          <Row label="Documento Material" value={preview.documentoMaterial} />
          <Row label={isEntry ? "Encargado de recepción" : "Encargado de envío"} value={preview.responsibleName} />
        </section>

        {/* ── Vehículo ── */}
        {(preview.carrier || preview.vehiclePlate || preview.driver || preview.driverDocument) && (
          <section style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", display: "grid", gap: 5 }}>
            <div className="form-section-title" style={{ margin: 0, paddingBottom: 4 }}>Datos del vehículo</div>
            <Row label="Transportadora" value={preview.carrier} />
            <Row label="Chapa" value={preview.vehiclePlate} />
            <Row label="Conductor" value={preview.driver} />
            <Row label="CI del conductor" value={preview.driverDocument} />
          </section>
        )}

        {/* ── Mercadería ── */}
        <section style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
          <div className="form-section-title" style={{ margin: 0, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            Mercadería
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Material</th>
                  <th scope="col">Lote(s)</th>
                  <th scope="col">Vencimiento</th>
                  <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                  <th scope="col" style={{ textAlign: "right" }}>Pallets</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line, idx) => (
                  <tr key={`${line.productLabel}-${idx}`}>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{line.productLabel}</td>
                    <td style={{ fontSize: 12, fontFamily: "monospace" }}>
                      {line.lots.length === 0 ? "—" : line.lots.map((lot) => (
                        <div key={lot.lotCode}>
                          {lot.lotCode}
                          {lot.sapLot && (
                            <span style={{ color: "var(--primary-text)", marginLeft: 6 }}>SAP {lot.sapLot}</span>
                          )}
                        </div>
                      ))}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {line.lots.length === 0 ? "—" : line.lots.map((lot) => (
                        <div key={lot.lotCode}>{formatDateOnly(lot.fechaVencimiento)}</div>
                      ))}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>
                      {line.quantity.toLocaleString("es-PY")}
                      {line.unitOfMeasure && (
                        <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 4 }}>{line.unitOfMeasure}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 13 }}>{line.pallets || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--bg)", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
            <span><span style={{ color: "var(--muted)" }}>Ítems: </span><strong>{totals.lines}</strong></span>
            <span><span style={{ color: "var(--muted)" }}>Lotes: </span><strong>{totals.lots}</strong></span>
            <span><span style={{ color: "var(--muted)" }}>Unidades: </span><strong>{totals.quantity.toLocaleString("es-PY")}</strong></span>
            <span><span style={{ color: "var(--muted)" }}>Pallets: </span><strong>{totals.pallets}</strong></span>
          </div>
        </section>

        {/* ── Observaciones y adjuntos ── */}
        {(preview.notes?.trim() || preview.attachments.length > 0) && (
          <section style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", display: "grid", gap: 6 }}>
            {preview.notes?.trim() && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--muted)", fontWeight: 700 }}>Observaciones: </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{preview.notes}</span>
              </div>
            )}
            {preview.attachments.length > 0 && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--muted)", fontWeight: 700 }}>
                  Adjuntos ({preview.attachments.length}):{" "}
                </span>
                {preview.attachments.join(", ")}
              </div>
            )}
          </section>
        )}

        {/* ── Firmas: quién va a firmar el papel ── */}
        <section style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", display: "grid", gap: 5 }}>
          <div className="form-section-title" style={{ margin: 0, paddingBottom: 4 }}>Firmas de la nota</div>
          <Row label="Transportado por" value={transportedBy || "—"} />
          <Row
            label={isEntry ? "Recibido por" : "Enviado por"}
            value={preview.responsibleName || "—"}
          />
        </section>

        {/* ── Campos que van a salir en blanco ── */}
        {missing.length > 0 && (
          <div
            style={{
              background: "var(--badge-adjout-bg)",
              border: "1px solid var(--badge-adjout-border)",
              color: "var(--badge-adjout-text)",
              borderRadius: 8, padding: "9px 12px", fontSize: 12,
            }}
          >
            <strong>La nota va a salir sin: </strong>{missing.join(", ")}.{" "}
            Se puede confirmar igual, o volver y completarlo.
          </div>
        )}

        {/* ── Acciones ── */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onConfirm}
            disabled={saving}
            aria-label={`Confirmar y registrar la ${isEntry ? "entrada" : "salida"}`}
          >
            {saving ? "Registrando..." : `✓ Confirmar y registrar ${isEntry ? "entrada" : "salida"}`}
          </button>
          <button type="button" className="btn" onClick={onBack} disabled={saving}>
            ← Volver a editar
          </button>
        </div>
      </div>
    </div>
  );
}
