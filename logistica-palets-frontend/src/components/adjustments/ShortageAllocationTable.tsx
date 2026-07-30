import type { LotPallet } from "../../api/pallets";

export type CandidatePallet = LotPallet & { lotCode: string };

/**
 * Misma lógica que usará el envío: por cada pallet con un físico válido y menor al
 * sistema, la diferencia (positiva) es lo que se descuenta de ese pallet. Pallets no
 * tocados o con físico ≥ sistema no aportan a esta línea de salida.
 */
export function computeShortageAllocation(
  pallets: CandidatePallet[],
  physicalByPallet: Record<string, string>,
): { palletItems: { palletId: string; quantity: number }[]; total: number } {
  const palletItems: { palletId: string; quantity: number }[] = [];
  for (const p of pallets) {
    const raw = physicalByPallet[p.id] ?? String(p.quantity);
    const phys = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(phys) || phys < 0) continue;
    const take = p.quantity - phys;
    if (take > 0) palletItems.push({ palletId: p.id, quantity: take });
  }
  return { palletItems, total: palletItems.reduce((s, i) => s + i.quantity, 0) };
}

type Props = {
  pallets: CandidatePallet[];
  physicalByPallet: Record<string, string>;
  onPhysicalChange: (palletId: string, value: string) => void;
  locationMap: Record<string, string>;
};

/**
 * Faltante — distribución explícita por pallet: en vez de pedir "cuánto tomar",
 * se recontea cada pallet (Sistema → Físico) y la diferencia se calcula sola,
 * igual que el resto del flujo.
 */
export default function ShortageAllocationTable({ pallets, physicalByPallet, onPhysicalChange, locationMap }: Props) {
  if (pallets.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Sin pallets disponibles para cubrir el faltante.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Distribución del faltante — recontá los pallets donde encontraste menos</div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px 90px 110px", gap: 8, padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
          <span>Lote</span>
          <span>Pallet</span>
          <span>Ubicación</span>
          <span style={{ textAlign: "right" }}>Sistema</span>
          <span>Físico</span>
          <span style={{ textAlign: "right" }}>Diferencia</span>
        </div>
        {pallets.map((p, idx) => {
          const raw = physicalByPallet[p.id] ?? String(p.quantity);
          const phys = Number(raw);
          const valid = raw.trim() !== "" && Number.isFinite(phys) && phys >= 0;
          const take = valid ? p.quantity - phys : 0;
          const isSurplusHere = valid && take < 0;
          return (
            <div key={p.id} style={{ borderBottom: idx < pallets.length - 1 ? "1px solid var(--border)" : undefined }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px 90px 110px", gap: 8, alignItems: "center", padding: "6px 10px" }}>
                <span style={{ fontSize: 12, fontFamily: "monospace" }}>{p.lotCode}</span>
                <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}>{p.code}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.currentLocationId ? locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8) : "—"}</span>
                <span style={{ textAlign: "right", fontSize: 13 }}>{p.quantity.toLocaleString("es-PY")}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={raw}
                  onChange={(e) => onPhysicalChange(p.id, e.target.value)}
                  style={{ fontSize: 13, padding: "3px 6px", borderColor: !valid ? "var(--danger)" : undefined }}
                  aria-label={`Conteo físico del pallet ${p.code}`}
                />
                <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: !valid ? "var(--muted)" : take > 0 ? "var(--danger)" : take < 0 ? "var(--warning)" : "var(--muted)" }}>
                  {!valid ? "—" : take === 0 ? "0" : take > 0 ? `−${take.toLocaleString("es-PY")}` : `+${Math.abs(take).toLocaleString("es-PY")}`}
                </span>
              </div>
              {isSurplusHere && (
                <div style={{ padding: "0 10px 6px", fontSize: 11, color: "var(--warning)" }}>
                  Este pallet tiene sobrante — cargalo aparte con un conteo a nivel Pallet.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
