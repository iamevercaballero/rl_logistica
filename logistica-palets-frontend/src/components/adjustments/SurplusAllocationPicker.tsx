import LotPalletBreakdownTable, { type ScopedLot } from "./LotPalletBreakdownTable";
import type { LotPallet } from "../../api/pallets";

export type SurplusDestination = "EXISTING_PALLET" | "NEW_PALLET" | "NO_PALLET";

type Props = {
  destination: SurplusDestination;
  onDestinationChange: (d: SurplusDestination) => void;
  /** Lotes candidatos ya scopeados (todos los del producto, o solo el lote elegido a nivel Lote). */
  lots: ScopedLot[];
  isLoading?: boolean;
  locationMap: Record<string, string>;
  selectedPalletId?: string | null;
  onSelectPallet: (lot: ScopedLot, pallet: LotPallet) => void;
};

const OPTIONS: { value: SurplusDestination; label: string; desc: string }[] = [
  { value: "EXISTING_PALLET", label: "En un pallet existente", desc: "Encontré más unidades dentro de un pallet que ya está registrado." },
  { value: "NEW_PALLET", label: "Es un pallet no registrado", desc: "Encontré un pallet que todavía no está en el sistema." },
  { value: "NO_PALLET", label: "Son unidades sin pallet", desc: "No están agrupadas en un pallet identificable." },
];

/**
 * Sobrante a nivel Producto/Lote: ¿dónde están físicamente las unidades encontradas?
 * "Pallet existente" reutiliza LotPalletBreakdownTable en modo selección (mismo mecanismo
 * que el sobrante a nivel Pallet — Caso A). Las otras dos opciones las resuelve el padre
 * con el formulario de lote/pallet nuevo ya existente (difieren solo en si el código de
 * lote lo tipea el operador o se genera automático).
 */
export default function SurplusAllocationPicker({
  destination, onDestinationChange, lots, isLoading, locationMap, selectedPalletId, onSelectPallet,
}: Props) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>¿Dónde están estas unidades?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {OPTIONS.map((o) => {
            const active = destination === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onDestinationChange(o.value)}
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

      {destination === "EXISTING_PALLET" && (
        <LotPalletBreakdownTable
          lots={lots}
          isLoading={isLoading}
          locationMap={locationMap}
          mode="select-pallet"
          selectedPalletId={selectedPalletId}
          onSelectPallet={onSelectPallet}
        />
      )}
    </div>
  );
}
