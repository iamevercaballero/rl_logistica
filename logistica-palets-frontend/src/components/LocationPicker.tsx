import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveWarehouseId } from "../contexts/WarehouseContext";
import {
  getLocationAvailability,
  getLocationMap,
  getLocationRecommendations,
  type LocationAvailability,
  type LocationAvailabilityStatus,
  type LocationCell,
} from "../api/locations";
import SearchableSelect from "../design-system/SearchableSelect";
import WarehouseMap, { MapLegend } from "./WarehouseMap";

/**
 * Ocupación que un formulario ya comprometió y todavía no está en la base (los
 * pallets de una entrada en curso, por ejemplo). Sin esto las recomendaciones
 * repiten siempre el mismo sector aunque uno ya lo haya llenado en pantalla.
 */
export type LocationSessionUsage = {
  /** Pallets de este formulario que ya van a esta ubicación. */
  pallets: number;
  /** Bases que quedarían libres después de esos pallets (null = sin capacidad declarada). */
  basesFree: number | null;
  /** Motivo por el que esos pallets no entran (viene del preview de colocación). */
  error?: string;
};

type Props = {
  value: string;
  onChange: (locationId: string) => void;
  /** Limita a un depósito. */
  warehouseId?: string;
  placeholder?: string;
  /** Si true, excluye ubicaciones bloqueadas/llenas (para destinos). */
  excludeUnavailable?: boolean;
  /** Si se pasa, muestra ubicaciones recomendadas (slotting) para ese producto. */
  productId?: string;
  /** locationId → ocupación ya comprometida en este formulario. */
  sessionUsage?: Map<string, LocationSessionUsage>;
  /** Ubicación que no debe aparecer (por ejemplo, el origen de una transferencia). */
  excludeLocationId?: string;
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

/** "quedan 38 bases · 2 pallets de esta carga" — el estado real, ya contando lo asignado en pantalla. */
function usageNote(basesFree: number | null, assigned: number): string {
  const parts: string[] = [];
  if (basesFree != null) parts.push(basesFree > 0 ? `quedan ${basesFree} bases` : "sin bases libres");
  if (assigned > 0) parts.push(`${assigned} pallet${assigned !== 1 ? "s" : ""} de esta carga`);
  return parts.join(" · ");
}

/**
 * Selector de ubicación compacto: se elige escribiendo el código, o abriendo el
 * mapa del depósito (mismo mapa del localizador) con las ubicaciones pintadas por
 * estado. Si se pasa `productId` sugiere sectores por slotting, y con
 * `sessionUsage` esas sugerencias se van adaptando a lo que ya se asignó.
 */
export default function LocationPicker({
  value, onChange, warehouseId, placeholder = "Ubicación", excludeUnavailable, productId, sessionUsage,
  excludeLocationId,
}: Props) {
  const [mapOpen, setMapOpen] = useState(false);
  const [zone, setZone] = useState("");
  const [sector, setSector] = useState("");

  // El depósito del picker es el que le pasa el formulario (la entrada trabaja
  // en el depósito activo); si no viene, se cae al activo de la sesión. En
  // ningún caso se ofrecen ubicaciones de otro depósito.
  const activeWarehouseId = useActiveWarehouseId();
  const scopeWarehouseId = warehouseId || activeWarehouseId;

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["locations", "availability", scopeWarehouseId],
    queryFn: () => getLocationAvailability(scopeWarehouseId),
    enabled: !!scopeWarehouseId,
    staleTime: 30_000,
  });

  // Slotting: sectores recomendados para el producto (si se pasó productId).
  const { data: slotting } = useQuery({
    queryKey: ["locations", "recommendations", productId, scopeWarehouseId],
    queryFn: () => getLocationRecommendations(productId!, 1, scopeWarehouseId),
    enabled: !!productId && !!scopeWarehouseId,
    staleTime: 30_000,
  });

  const base = useMemo(() => {
    let list = all;
    if (warehouseId) list = list.filter((l) => l.warehouseId === warehouseId);
    if (excludeLocationId) list = list.filter((l) => l.id !== excludeLocationId);
    if (excludeUnavailable) {
      const productFeasible = new Set(slotting?.feasibleLocationIds ?? []);
      list = list.filter((l) =>
        l.status !== "BLOCKED" &&
        (l.status !== "FULL" || (!!productId && productFeasible.has(l.id))),
      );
    }
    return list;
  }, [all, warehouseId, excludeLocationId, excludeUnavailable, productId, slotting]);

  const selected = useMemo(() => base.find((l) => l.id === value) ?? null, [base, value]);

  /**
   * Recomendaciones ajustadas a lo que ya se asignó en este formulario: se
   * descartan las que el backend ya rechazó para esa carga y se reemplaza el
   * desempate por bases libres del servidor (estático) por el real de la sesión,
   * así un sector que se está llenando baja solo en la lista.
   */
  const recommendations = useMemo(() => {
    let recs = slotting?.recommendations ?? [];
    if (warehouseId) {
      const inWh = new Set(all.filter((l) => l.warehouseId === warehouseId).map((l) => l.id));
      recs = recs.filter((r) => inWh.has(r.id));
    }
    return recs
      .map((r) => {
        const use = sessionUsage?.get(r.id);
        const serverFree = r.capacity != null ? Math.max(0, r.capacity - r.occupied) : null;
        const basesFree = use?.basesFree ?? serverFree;
        return {
          ...r,
          basesFree,
          assigned: use?.pallets ?? 0,
          blockedReason: use?.error,
          adjScore: r.score - (serverFree ?? 0) + (basesFree ?? 0),
        };
      })
      .filter((r) => !r.blockedReason)
      .sort((a, b) => b.adjScore - a.adjScore);
  }, [slotting, all, warehouseId, sessionUsage]);

  const topRec = recommendations[0];

  // Mapa del depósito — solo se pide cuando se abre el modal.
  const { data: map, isLoading: mapLoading } = useQuery({
    queryKey: ["location-map", warehouseId ?? "all"],
    queryFn: () => getLocationMap(warehouseId),
    enabled: mapOpen,
    staleTime: 30_000,
  });

  const allowedIds = useMemo(() => new Set(base.map((l) => l.id)), [base]);
  const mapCells = useMemo(() => {
    let cells = map?.locations ?? [];
    if (zone) cells = cells.filter((c) => c.zone === zone);
    if (sector) cells = cells.filter((c) => c.aisle === sector);
    return cells;
  }, [map, zone, sector]);

  const zones = useMemo(
    () => Array.from(new Set((map?.locations ?? []).map((c) => c.zone).filter((z): z is string => !!z))).sort(),
    [map],
  );
  const sectors = useMemo(
    () => Array.from(new Set((map?.locations ?? [])
      .filter((c) => !zone || c.zone === zone)
      .map((c) => c.aisle)
      .filter((a): a is string => !!a))).sort(),
    [map, zone],
  );

  /** Celdas que no se pueden elegir: inactivas, fuera del filtro base, o sin lugar para esta carga. */
  const disabledIds = useMemo(() => {
    const ids = new Set<string>();
    // `allowedIds` sale de la lista de disponibilidad: si todavía no cargó, no se
    // usa como filtro (si no, el mapa quedaría entero deshabilitado).
    const filterByAllowed = base.length > 0;
    for (const c of map?.locations ?? []) {
      if (!c.active || (filterByAllowed && !allowedIds.has(c.id)) || sessionUsage?.get(c.id)?.error) ids.add(c.id);
    }
    return ids;
  }, [map, base, allowedIds, sessionUsage]);

  const noteById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of map?.locations ?? []) {
      const use = sessionUsage?.get(c.id);
      const basesFree = use?.basesFree ?? (c.capacityBases != null ? Math.max(0, c.capacityBases - c.basesUsed) : null);
      const note = use?.error ?? usageNote(basesFree, use?.pallets ?? 0);
      if (note) m.set(c.id, note);
    }
    return m;
  }, [map, sessionUsage]);

  /** Dentro de la celda se muestran las bases libres — es el dato que decide dónde entra un pallet. */
  function cellLabel(c: LocationCell) {
    const use = sessionUsage?.get(c.id);
    const basesFree = use?.basesFree ?? (c.capacityBases != null ? Math.max(0, c.capacityBases - c.basesUsed) : null);
    return basesFree != null ? String(basesFree) : c.pallets > 0 ? String(c.pallets) : "";
  }

  function pick(locationId: string) {
    onChange(locationId);
    setMapOpen(false);
  }

  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isLoading ? (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Cargando ubicaciones…</span>
          ) : (
            <SearchableSelect
              options={base}
              value={selected}
              onChange={(l) => onChange(l?.id ?? "")}
              getKey={(l) => l.id}
              getLabel={(l) => l.code}
              getDescription={(l) => [l.warehouseName, l.zone].filter(Boolean).join(" · ")}
              getBadge={(l) => {
                const use = sessionUsage?.get(l.id);
                const extra = use ? usageNote(use.basesFree, use.pallets) : "";
                return extra ? `${statusText(l)} · ${extra}` : statusText(l);
              }}
              placeholder={placeholder}
            />
          )}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setMapOpen(true)}
          title="Elegir en el mapa del depósito"
          style={{ padding: "5px 10px", fontSize: 12, whiteSpace: "nowrap" }}
        >
          Mapa
        </button>
      </div>

      {/* Sugerencia de slotting — una sola línea, ya ajustada a lo asignado en
          pantalla. Solo mientras no haya ubicación elegida: después estorba. */}
      {productId && topRec && !value && (
        <button
          type="button"
          onClick={() => onChange(topRec.id)}
          title={[...topRec.reasons, usageNote(topRec.basesFree, topRec.assigned)].filter(Boolean).join(" · ")}
          style={{
            background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
            fontSize: 11, color: "var(--primary)", fontWeight: 600,
          }}
        >
          Sugerido: {topRec.code}
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            {topRec.basesFree != null ? ` · ${topRec.basesFree} bases libres` : ""}
            {topRec.assigned > 0 ? ` · ya asignaste ${topRec.assigned}` : ""}
          </span>
        </button>
      )}

      {selected && (
        <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_META[selected.status].color }}>
          {selected.code} · {statusText(selected)}
          {(() => {
            const use = sessionUsage?.get(selected.id);
            const note = use ? usageNote(use.basesFree, use.pallets) : "";
            return note ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {note}</span> : null;
          })()}
        </span>
      )}

      {/* ── Modal: mapa del depósito ── */}
      {mapOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setMapOpen(false)}
        >
          <div
            className="modal"
            style={{ width: "min(980px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 12 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Elegir ubicación en el mapa"
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Elegir ubicación</h3>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  El número de cada celda son las bases libres. Tocá una para asignarla.
                </p>
              </div>
              <button type="button" onClick={() => setMapOpen(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
            </div>

            {productId && recommendations.length > 0 && (
              <div style={{ display: "grid", gap: 6, padding: 10, border: "1px solid var(--border)", borderRadius: 8, background: "var(--primary-light)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: 0.3 }}>SECTORES RECOMENDADOS</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {recommendations.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pick(r.id)}
                      title={r.reasons.join(" · ")}
                      style={{
                        display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start",
                        padding: "6px 10px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                        border: r.id === value ? "2px solid var(--primary)" : "1px solid var(--border)",
                        background: r.id === value ? "var(--primary-light)" : "var(--bg)",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{r.code}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {usageNote(r.basesFree, r.assigned) || r.reasons[0]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select className="input" style={{ minWidth: 140, flex: 1 }} value={zone}
                onChange={(e) => { setZone(e.target.value); setSector(""); }}>
                <option value="">Todas las zonas</option>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="input" style={{ minWidth: 140, flex: 1 }} value={sector} disabled={sectors.length === 0}
                onChange={(e) => setSector(e.target.value)}>
                <option value="">Todos los sectores</option>
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {mapLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Cargando mapa…</p>
            ) : (
              <>
                <MapLegend states={["FREE", "OCCUPIED", "FULL", "EXPIRING", "INCIDENT", "INACTIVE"]} />
                <WarehouseMap
                  cells={mapCells}
                  highlight={null}
                  selectedId={value || null}
                  onSelect={(c) => pick(c.id)}
                  disabledIds={disabledIds}
                  noteById={noteById}
                  labelFor={cellLabel}
                  emptyMessage="No hay ubicaciones con ese filtro."
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
