export type SummaryLine = {
  key: number;
  productLabel: string;
  scopeLabel: string;
  direction: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  systemQty: number;
  physicalQty: number;
  totalQty: number;
  depositoLabel: string;
};

type Props = {
  lines: SummaryLine[];
  submit: boolean;
  reasonLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
};

const tinyLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" };

/** Resumen previo al envío: qué se va a crear, antes → después, y el aviso de que el stock no cambia hasta aprobar. */
export default function AdjustmentSummary({ lines, submit, reasonLabel, onConfirm, onCancel, isPending }: Props) {
  const inCount = lines.filter((l) => l.direction === "ADJUSTMENT_IN").length;
  const outCount = lines.filter((l) => l.direction === "ADJUSTMENT_OUT").length;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !isPending && onCancel()}>
      <div className="modal" style={{ width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto" }}>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>Resumen del ajuste</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -4 }}>Revisá antes de confirmar — el stock todavía no cambia.</p>

        <div style={{ display: "grid", gap: 10, margin: "14px 0" }}>
          {lines.map((l) => (
            <div key={l.key} style={{ border: `1.5px solid ${l.direction === "ADJUSTMENT_IN" ? "var(--success)" : "var(--danger)"}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{l.productLabel}</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12, background: l.direction === "ADJUSTMENT_IN" ? "var(--success)" : "var(--danger)", color: "#fff" }}>
                  {l.direction === "ADJUSTMENT_IN" ? "Entrada (RLAI)" : "Salida (RLAO)"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{l.scopeLabel} · {l.depositoLabel} · Motivo: {reasonLabel}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 8 }}>
                <div>
                  <div style={tinyLabel}>Stock registrado</div>
                  <div style={{ fontWeight: 700 }}>{l.systemQty.toLocaleString("es-PY")}</div>
                </div>
                <div>
                  <div style={tinyLabel}>Conteo físico</div>
                  <div style={{ fontWeight: 700 }}>{l.physicalQty.toLocaleString("es-PY")}</div>
                </div>
                <div>
                  <div style={tinyLabel}>Diferencia</div>
                  <div style={{ fontWeight: 700, color: l.direction === "ADJUSTMENT_IN" ? "var(--success)" : "var(--danger)" }}>
                    {l.direction === "ADJUSTMENT_IN" ? "+" : "−"}{l.totalQty.toLocaleString("es-PY")}
                  </div>
                </div>
                <div>
                  <div style={tinyLabel}>Resultado al aprobar</div>
                  <div style={{ fontWeight: 700 }}>{l.systemQty.toLocaleString("es-PY")} → {l.physicalQty.toLocaleString("es-PY")}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 13 }}>
          <strong>{lines.length}</strong> material{lines.length !== 1 ? "es" : ""}
          {inCount > 0 && <> · <strong>{inCount}</strong> ajuste{inCount !== 1 ? "s" : ""} de entrada</>}
          {outCount > 0 && <> · <strong>{outCount}</strong> ajuste{outCount !== 1 ? "s" : ""} de salida</>}
        </div>

        <div style={{ background: "var(--panel-hi)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 12, color: "var(--muted)" }}>
          {submit
            ? "El stock todavía no será modificado. El ajuste quedará pendiente hasta que un Manager lo apruebe."
            : "Se va a guardar como borrador — todavía no se envía a aprobación ni cambia el stock."}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Enviando..." : submit ? "Confirmar y enviar" : "Confirmar borrador"}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={isPending}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
