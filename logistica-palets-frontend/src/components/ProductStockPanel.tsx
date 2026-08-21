import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPallets } from "../api/pallets";
import { useActiveWarehouseId } from "../contexts/WarehouseContext";

/**
 * Panel de contexto: al seleccionar un producto muestra stock total, lotes
 * activos, pallets disponibles y ubicaciones donde está (con cantidad por
 * ubicación). Usado en Diferencia de inventario para no cargar la ubicación a mano.
 *
 * Sin acotar por depósito, "Stock total" sumaba pallets de todos los
 * depósitos que ve el usuario — un ajuste de inventario del depósito activo
 * terminaba comparado contra un número que incluía stock de otro lado.
 */
export default function ProductStockPanel({ productId }: { productId: string }) {
  const activeWarehouseId = useActiveWarehouseId();
  const { data: allPallets = [], isLoading } = useQuery({
    queryKey: ["pallets", "with-stock", productId, activeWarehouseId],
    queryFn: () => listPallets({ productId, warehouseId: activeWarehouseId }),
    enabled: !!productId && !!activeWarehouseId,
  });

  // AVAILABLE y PARTIAL: los parciales son pallets abiertos con saldo y también
  // son stock (el auto-FEFO los consume igual). Contar solo AVAILABLE mostraba
  // menos stock del que usa el cálculo de diferencia y simulaba un sobrante.
  const pallets = useMemo(
    () => allPallets.filter((p) => (p.status === "AVAILABLE" || p.status === "PARTIAL") && p.quantity > 0),
    [allPallets],
  );

  const summary = useMemo(() => {
    const stockTotal = pallets.reduce((s, p) => s + p.quantity, 0);
    const lots = new Set(pallets.map((p) => p.lotCode).filter(Boolean));
    const byLocation = new Map<string, number>();
    for (const p of pallets) {
      const key = p.locationCode ?? "Sin ubicación";
      byLocation.set(key, (byLocation.get(key) ?? 0) + p.quantity);
    }
    return {
      stockTotal,
      lotsActive: lots.size,
      palletsAvailable: pallets.length,
      locations: Array.from(byLocation.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [pallets]);

  if (!productId) return null;
  if (isLoading) return <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0" }}>Cargando stock del producto…</p>;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "var(--bg)", display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
        {[
          { label: "Stock total", value: summary.stockTotal.toLocaleString("es-PY") },
          { label: "Lotes activos", value: summary.lotsActive },
          { label: "Pallets disp.", value: summary.palletsAvailable },
          { label: "Ubicaciones", value: summary.locations.length },
        ].map((k) => (
          <div key={k.label} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{k.value}</div>
          </div>
        ))}
      </div>
      {summary.locations.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Cantidad por ubicación</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {summary.locations.map(([loc, qty]) => (
              <span key={loc} style={{ fontSize: 12, fontWeight: 600, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "3px 10px" }}>
                {loc} · <strong>{qty.toLocaleString("es-PY")}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
      {summary.palletsAvailable === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Este producto no tiene pallets disponibles.</p>
      )}
    </div>
  );
}
