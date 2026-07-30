export type CountLevel = "PRODUCT" | "LOT" | "PALLET";

type Props = {
  level: CountLevel;
  onChange: (level: CountLevel) => void;
  disabled?: boolean;
};

const OPTIONS: { value: CountLevel; label: string; desc: string }[] = [
  { value: "PRODUCT", label: "Producto completo", desc: "Tengo el total físico del material." },
  { value: "LOT", label: "Un lote", desc: "Estoy verificando un lote específico." },
  { value: "PALLET", label: "Pallets", desc: "Hice conteo pallet por pallet." },
];

/** ¿Qué estás contando? — producto completo, un lote puntual, o pallet por pallet. */
export default function CountLevelPicker({ level, onChange, disabled }: Props) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>¿Qué estás contando?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {OPTIONS.map((o) => {
          const active = level === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              disabled={disabled}
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
