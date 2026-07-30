type Props = {
  systemQty: number;
  physicalQtyInput: string;
  onPhysicalQtyChange: (v: string) => void;
  unitLabel?: string;
  disabled?: boolean;
};

/** Sistema → Físico → Diferencia (en vivo). El tipo de ajuste (RLAI/RLAO) es el resultado, no una decisión previa. */
export default function CountEntryPanel({ systemQty, physicalQtyInput, onPhysicalQtyChange, unitLabel = "unid.", disabled }: Props) {
  const trimmed = physicalQtyInput.trim();
  const physicalQty = trimmed === "" ? null : Number(trimmed);
  const diff = physicalQty === null || Number.isNaN(physicalQty) ? null : physicalQty - systemQty;

  return (
    <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: 14, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Stock sistema</div>
        <div style={{ fontSize: 22, fontWeight: 900 }}>{systemQty.toLocaleString("es-PY")}</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{unitLabel}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 3 }}>Conteo físico *</div>
        <input
          className="input"
          type="number"
          min={0}
          disabled={disabled}
          value={physicalQtyInput}
          onChange={(e) => onPhysicalQtyChange(e.target.value)}
          placeholder="0"
          style={{ fontSize: 20, fontWeight: 800 }}
          aria-label="Conteo físico"
        />
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Diferencia</div>
        {diff === null ? (
          <div style={{ fontSize: 13, color: "var(--muted)", paddingTop: 4 }}>Ingresá el conteo físico</div>
        ) : diff === 0 ? (
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--muted)", paddingTop: 2 }}>Sin diferencia</div>
        ) : (
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: diff > 0 ? "var(--success)" : "var(--danger)" }}>
              {diff > 0 ? "+" : "−"}{Math.abs(diff).toLocaleString("es-PY")}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: diff > 0 ? "var(--success)" : "var(--danger)" }}>
              Generará: {diff > 0 ? "Entrada (RLAI)" : "Salida (RLAO)"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
