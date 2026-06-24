import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLocationAvailability, type LocationAvailability, type LocationAvailabilityStatus } from "../api/locations";
import SearchableSelect from "../design-system/SearchableSelect";

type Props = {
  value: string;
  onChange: (locationId: string) => void;
  /** Limita a un depósito (oculta el paso "Depósito"). */
  warehouseId?: string;
  placeholder?: string;
  /** Si true, excluye ubicaciones bloqueadas/llenas (para destinos). */
  excludeUnavailable?: boolean;
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
    return `${meta.label}${l.capacity != null ? ` ${l.occupied}/${l.capacity}` : ` · ${l.occupied} pallet(s)`}`;
  }
  return meta.label;
}

/**
 * Selector de ubicación guiado: Depósito → Zona → Pasillo → Rack → Nivel → Posición,
 * con disponibilidad (Libre / Parcial / Llena / Bloqueada). Incluye modo "Buscar"
 * para elegir escribiendo el código.
 */
export default function LocationPicker({ value, onChange, warehouseId, placeholder = "Ubicación", excludeUnavailable }: Props) {
  const [mode, setMode] = useState<"guided" | "search">("guided");
  const [zone, setZone] = useState("");
  const [aisle, setAisle] = useState("");
  const [rack, setRack] = useState("");
  const [level, setLevel] = useState("");

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["location-availability"],
    queryFn: getLocationAvailability,
    staleTime: 30_000,
  });

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
  const aisles = useMemo(() => uniq(afterZone.map((l) => l.aisle)), [afterZone]);
  const afterAisle = useMemo(() => afterZone.filter((l) => !aisle || l.aisle === aisle), [afterZone, aisle]);
  const racks = useMemo(() => uniq(afterAisle.map((l) => l.rack)), [afterAisle]);
  const afterRack = useMemo(() => afterAisle.filter((l) => !rack || l.rack === rack), [afterAisle, rack]);
  const levels = useMemo(() => uniq(afterRack.map((l) => (l.level != null ? String(l.level) : null))), [afterRack]);
  const finalList = useMemo(
    () => afterRack.filter((l) => !level || String(l.level) === level),
    [afterRack, level],
  );

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
              onChange={(e) => { setZone(e.target.value); setAisle(""); setRack(""); setLevel(""); }}>
              <option value="">Zona</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            <select className="input" style={selectStyle} value={aisle} disabled={aisles.length === 0}
              onChange={(e) => { setAisle(e.target.value); setRack(""); setLevel(""); }}>
              <option value="">Pasillo</option>
              {aisles.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="input" style={selectStyle} value={rack} disabled={racks.length === 0}
              onChange={(e) => { setRack(e.target.value); setLevel(""); }}>
              <option value="">Rack</option>
              {racks.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="input" style={selectStyle} value={level} disabled={levels.length === 0}
              onChange={(e) => setLevel(e.target.value)}>
              <option value="">Nivel</option>
              {levels.map((n) => <option key={n} value={n}>N{n}</option>)}
            </select>
          </div>

          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            {finalList.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, padding: 10, margin: 0 }}>Sin ubicaciones con ese filtro</p>
            ) : (
              finalList.map((l) => {
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
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{l.code}</span>
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
