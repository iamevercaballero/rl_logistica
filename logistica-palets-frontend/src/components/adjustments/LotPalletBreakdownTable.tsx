import { useEffect, useState } from "react";
import type { Lot } from "../../api/lots";
import type { LotPallet } from "../../api/pallets";

export type ScopedLot = Lot & { pallets: LotPallet[] };

type Mode = "context" | "select-lot" | "select-pallet";

type Props = {
  lots: ScopedLot[];
  isLoading?: boolean;
  locationMap: Record<string, string>;
  mode?: Mode;
  selectedLotId?: string | null;
  selectedPalletId?: string | null;
  onSelectLot?: (lot: ScopedLot) => void;
  onSelectPallet?: (lot: ScopedLot, pallet: LotPallet) => void;
};

const PALLET_STATUS_LABEL: Record<string, string> = {
  PARTIAL: "PARCIAL",
  EXITED: "DESPACHADO",
  BLOCKED: "BLOQUEADO",
  DAMAGED: "DAÑADO",
  IN_TRANSIT: "EN TRÁNSITO",
};

/**
 * Muestra los lotes de un producto (vencimiento, ubicación, pallets, stock),
 * expandibles a su detalle de pallets. Sirve tanto de panel de contexto
 * (mode="context") como de selector al elegir nivel de conteo "Un lote"
 * (mode="select-lot") o "Pallets" (mode="select-pallet").
 */
export default function LotPalletBreakdownTable({
  lots, isLoading, locationMap, mode = "context",
  selectedLotId, selectedPalletId, onSelectLot, onSelectPallet,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // En modo "elegir pallet" conviene ver todos los pallets de entrada — se navega por pallet, no por lote.
  useEffect(() => {
    if (mode === "select-pallet") setExpanded(new Set(lots.map((l) => l.id)));
  }, [mode, lots]);

  function toggle(lotId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(lotId) ? next.delete(lotId) : next.add(lotId);
      return next;
    });
  }

  function locationsOf(lot: ScopedLot): string {
    const codes = new Set(
      lot.pallets.map((p) => (p.currentLocationId ? locationMap[p.currentLocationId] ?? "—" : "Sin ubicación")),
    );
    if (codes.size === 0) return "—";
    if (codes.size === 1) return [...codes][0];
    return `${codes.size} ubicaciones`;
  }

  if (isLoading) {
    return <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0" }}>Cargando lotes...</p>;
  }
  if (lots.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0" }}>Este producto no tiene lotes con stock.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 130px 70px 90px", gap: 8, padding: "0 12px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
        <span>Lote</span>
        <span>Vencimiento</span>
        <span>Ubicación</span>
        <span style={{ textAlign: "right" }}>Pallets</span>
        <span style={{ textAlign: "right" }}>Stock</span>
      </div>

      {lots.map((lot) => {
        const stock = lot.stockActual;
        const isExpired = lot.fechaVencimiento && new Date(lot.fechaVencimiento) < new Date();
        const isSelectedLot = selectedLotId === lot.id;
        const rowClickable = true; // siempre se puede expandir para previsualizar

        return (
          <div key={lot.id} style={{
            border: `1.5px solid ${isSelectedLot ? "var(--primary)" : "var(--border)"}`,
            borderRadius: 8, overflow: "hidden",
            background: isSelectedLot ? "var(--primary-light)" : undefined,
          }}>
            <div
              role={mode === "select-lot" ? "button" : undefined}
              tabIndex={mode === "select-lot" ? 0 : undefined}
              onClick={() => { if (mode === "select-lot") onSelectLot?.(lot); toggle(lot.id); }}
              onKeyDown={(e) => { if (mode === "select-lot" && e.key === "Enter") onSelectLot?.(lot); }}
              style={{
                display: "grid", gridTemplateColumns: "1fr 110px 130px 70px 90px", gap: 8, alignItems: "center",
                padding: "8px 12px", cursor: rowClickable ? "pointer" : "default", background: "var(--bg)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontFamily: "monospace", fontSize: 13 }}>
                {isSelectedLot && <span style={{ color: "var(--primary)" }}>✓</span>}
                {lot.lotCode}
              </span>
              <span style={{ fontSize: 12, color: isExpired ? "var(--danger)" : "var(--muted)" }}>
                {lot.fechaVencimiento ? new Date(lot.fechaVencimiento).toLocaleDateString("es-PY") : "—"}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{locationsOf(lot)}</span>
              <span style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{lot.pallets.length}</span>
              <span style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>{stock.toLocaleString("es-PY")}</span>
            </div>

            {expanded.has(lot.id) && (
              <div style={{ borderTop: "1px solid var(--border)" }}>
                {lot.pallets.filter((p) => p.quantity > 0).map((p, idx, arr) => {
                  const isSelectedPallet = selectedPalletId === p.id;
                  return (
                    <div
                      key={p.id}
                      role={mode === "select-pallet" ? "button" : undefined}
                      tabIndex={mode === "select-pallet" ? 0 : undefined}
                      onClick={() => { if (mode === "select-pallet") onSelectPallet?.(lot, p); }}
                      onKeyDown={(e) => { if (mode === "select-pallet" && e.key === "Enter") onSelectPallet?.(lot, p); }}
                      style={{
                        display: "grid", gridTemplateColumns: "1fr 130px 70px 90px", gap: 8, alignItems: "center",
                        padding: "6px 12px 6px 28px", cursor: mode === "select-pallet" ? "pointer" : "default",
                        background: isSelectedPallet ? "var(--primary-light)" : undefined,
                        borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : undefined,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 12, fontFamily: "monospace" }}>
                        {isSelectedPallet && <span style={{ color: "var(--primary)" }}>✓</span>}
                        {p.code}
                        {p.status !== "AVAILABLE" && PALLET_STATUS_LABEL[p.status] && (
                          <span className="badge" style={{ fontSize: 9 }}>{PALLET_STATUS_LABEL[p.status]}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        {p.currentLocationId ? locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8) : "Sin ubicación"}
                      </span>
                      <span />
                      <span style={{ textAlign: "right", fontSize: 13, fontWeight: 600 }}>{p.quantity.toLocaleString("es-PY")}</span>
                    </div>
                  );
                })}
                {lot.pallets.filter((p) => p.quantity > 0).length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, padding: "6px 12px 6px 28px" }}>Sin pallets con stock en este lote.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
