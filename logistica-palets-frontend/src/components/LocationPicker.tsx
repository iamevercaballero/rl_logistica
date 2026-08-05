import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getLocationAvailability,
  getLocationRecommendations,
  type LocationAvailability,
  type LocationAvailabilityStatus,
} from "../api/locations";
import SearchableSelect from "../design-system/SearchableSelect";

type Props = {
  value: string;
  onChange: (locationId: string) => void;
  /** Limita a un depósito (oculta el paso "Depósito"). */
  warehouseId?: string;
  placeholder?: string;
  /** Si true, excluye ubicaciones bloqueadas/llenas (para destinos). */
  excludeUnavailable?: boolean;
  /** Si se pasa, muestra ubicaciones recomendadas (slotting) para ese producto. */
  productId?: string;
};

const STATUS_META: Record<LocationAvailabilityStatus, { label: string; color: string }> = {
  FREE: { label: "Libre", color: "var(--success)" },
  PARTIAL: { label: "Parcial", color: "var(--warning, #b8860b)" },
  FULL: { label: "Llena", color: "var(--danger)" },
  BLOCKED: { label: "Bloqueada", color: "var(--muted)" },
};

function statusText(l: LocationAvailability) {
  const meta = STATUS_META[l.status];
  if (l.status === "PARTIAL" || l.status === "FULL") {
    return `${meta.label}${l.capacity != null ? ` ${l.occupied}/${l.capacity} bases` : ` · ${l.occupied} base(s)`}`;
  }
  return meta.label;
}

/**
 * Selector de ubicación guiado: Depósito → Zona → Sector → Subsector, con
 * disponibilidad en bases (Libre / Parcial / Llena / Bloqueada). Incluye modo
 * "Buscar" para elegir escribiendo el código directamente.
 */
export default function LocationPicker({ value, onChange, warehouseId, placeholder = "Ubicación", excludeUnavailable, productId }: Props) {
  const [mode, setMode] = useState<"guided" | "search">("guided");
  const [zone, setZone] = useState("");
  const [sector, setSector] = useState("");

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["location-availability"],
    queryFn: getLocationAvailability,
    staleTime: 30_000,
  });

  // Slotting: sectores recomendados para el producto (si se pasó productId).
  const { data: slotting } = useQuery({
    queryKey: ["location-recommendations", productId, warehouseId],
    queryFn: () => getLocationRecommendations(productId!),
    enabled: !!productId,
    staleTime: 30_000,
  });
  const recommendations = useMemo(() => {
    let recs = slotting?.recommendations ?? [];
    if (warehouseId) {
      const inWh = new Set(all.filter((l) => l.warehouseId === warehouseId).map((l) => l.id));
      recs = recs.filter((r) => inWh.has(r.id));
    }
    return recs;
  }, [slotting, all, warehouseId]);

  const base = useMemo(() => {
    let list = all;
    if (warehouseId) list = list.filter((l) => l.warehouseId === warehouseId);
    if (excludeUnavailable) list = list.filter((l) => l.status !== "BLOCKED" && l.status !== "FULL");
    return list;
  }, [all, warehouseId, excludeUnavailable]);

  const selected = useMemo(() => base.find((l) => l.id === value) ?? null, [base, value]);

  const uniq = (arr: (string | null)[]) =>
    Array.from(new Set(arr.filter((x): x is string => !!x))).sort();

  const zones = useMemo(() => uniq(base.map((l) => l.zone)), [base]);
  const afterZone = useMemo(() => base.filter((l) => !zone || l.zone === zone), [base, zone]);
  const sectors = useMemo(() => uniq(afterZone.map((l) => l.aisle)), [afterZone]);
  // Subsectores del sector elegido — son las filas finales, se listan directo (no hay un nivel más abajo).
  const subsectors = useMemo(() => afterZone.filter((l) => !sector || l.aisle === sector), [afterZone, sector]);

  const selectStyle: React.CSSProperties = { minWidth: 120, flex: 1 };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, fontSize: 12 }}>
        <button type="button" onClick={() => setMode("guided")}
          className="btn" style={{ padding: "4px 12px", background: mode === "guided" ? "var(--primary)" : undefined, color: mode === "guided" ? "#fff" : undefined }}>
          Guiado
        </button>
        <button type="button" onClick={() => setMode("search")}
          className="btn" style={{ padding: "4px 12px", background: mode === "search" ? "var(--primary)" : undefined, color: mode === "search" ? "#fff" : undefined }}>
          Buscar
        </button>
        {selected && (
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: STATUS_META[selected.status].color }}>
            {selected.code} · {statusText(selected)}
          </span>
        )}
      </div>

      {productId && recommendations.length > 0 && (
        <div style={{ display: "grid", gap: 6, padding: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--primary-light, rgba(0,0,0,0.03))" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: 0.3 }}>
            ✨ SECTORES RECOMENDADOS
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {recommendations.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onChange(r.id)}
                title={r.reasons.join(" · ")}
                style={{
                  display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start",
                  padding: "6px 10px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                  border: r.id === value ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: r.id === value ? "var(--primary-light)" : "var(--bg, #fff)",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {r.code}
                  {r.capacity != null && (
                    <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {r.occupied}/{r.capacity} bases</span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{r.reasons[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Cargando ubicaciones…</p>
      ) : mode === "search" ? (
        <SearchableSelect
          options={base}
          value={selected}
          onChange={(l) => onChange(l?.id ?? "")}
          getKey={(l) => l.id}
          getLabel={(l) => l.code}
          getDescription={(l) => [l.warehouseName, l.zone].filter(Boolean).join(" · ")}
          getBadge={(l) => statusText(l)}
          placeholder={placeholder}
        />
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select className="input" style={selectStyle} value={zone}
              onChange={(e) => { setZone(e.target.value); setSector(""); }}>
              <option value="">Zona</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            <select className="input" style={selectStyle} value={sector} disabled={sectors.length === 0}
              onChange={(e) => setSector(e.target.value)}>
              <option value="">Sector</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            {subsectors.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, padding: 10, margin: 0 }}>Sin subsectores con ese filtro</p>
            ) : (
              subsectors.map((l) => {
                const meta = STATUS_META[l.status];
                const disabled = l.status === "BLOCKED" || (excludeUnavailable && l.status === "FULL");
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(l.id)}
                    style={{
                      display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)",
                      background: l.id === value ? "var(--primary-light)" : "none",
                      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, textAlign: "left",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{l.rack ?? l.code}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>● {statusText(l)}</span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
