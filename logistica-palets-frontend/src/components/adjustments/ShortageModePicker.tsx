export type ShortageMode = "AUTO" | "MANUAL";

type Props = {
  mode: ShortageMode;
  onChange: (mode: ShortageMode) => void;
  /**
   * Qué se está repartiendo. El criterio del automático no es el mismo: el
   * faltante vacía por FEFO —el pallet que saldría primero— y el sobrante
   * reparte en proporción, porque no hay forma de saber en cuál apareció.
   */
  direction?: "SHORTAGE" | "SURPLUS";
};

/** ¿Cómo se reparte la diferencia? — automático o pallet por pallet. */
export default function ShortageModePicker({ mode, onChange, direction = "SHORTAGE" }: Props) {
  const esSobrante = direction === "SURPLUS";
  const OPTIONS: { value: ShortageMode; label: string; desc: string }[] = [
    {
      value: "AUTO",
      label: "Automático",
      desc: esSobrante
        ? "El sistema reparte el sobrante en proporción al stock de cada pallet y te muestra el detalle."
        : "El sistema reparte el faltante por FEFO y te muestra el detalle.",
    },
    { value: "MANUAL", label: "Recuento por pallet", desc: "Cargá vos cuánto encontraste en cada pallet." },
  ];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        {esSobrante ? "¿Cómo repartimos el sobrante?" : "¿Cómo descontamos el faltante?"}
      </div>
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
