export type ShortageMode = "AUTO" | "MANUAL";

type Props = {
  mode: ShortageMode;
  onChange: (mode: ShortageMode) => void;
};

const OPTIONS: { value: ShortageMode; label: string; desc: string }[] = [
  { value: "AUTO", label: "Automático", desc: "El sistema reparte el faltante por FEFO y te muestra el detalle." },
  { value: "MANUAL", label: "Recuento por pallet", desc: "Cargá vos cuánto encontraste en cada pallet." },
];

/** ¿Cómo se descuenta el faltante? — automático (FEFO) o pallet por pallet. */
export default function ShortageModePicker({ mode, onChange }: Props) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>¿Cómo descontamos el faltante?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {OPTIONS.map((o) => {
          const active = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="btn"
              style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, textAlign: "left",
                padding: "10px 12px", height: "auto",
                border: `1.5px solid ${active ? "var(--primary)" : "var(--border)"}`,
                background: active ? "var(--primary-light)" : "var(--bg)",
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 13, color: active ? "var(--primary)" : "var(--text)" }}>{o.label}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{o.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
