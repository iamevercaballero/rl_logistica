import { useMemo } from "react";
import { ISSUE_META, MAP_STATE_META, type LocationCell, type LocationMapState } from "../api/locations";
import { fmtQty } from "../utils/number";

/* ── Celda del mapa ─────────────────────────────────────────────────────── */

type CellProps = {
  cell: LocationCell;
  /** Texto a mostrar dentro de la celda (cantidad resaltada o nº de pallets). */
  label: string;
  highlighted: boolean;
  /** Hay una búsqueda activa y esta celda no coincide: se atenúa. */
  dimmed: boolean;
  selected: boolean;
  onSelect: (cell: LocationCell) => void;
  size?: number;
  /** No se puede elegir (sin lugar, temperatura incompatible, etc.). */
  disabled?: boolean;
  /** Motivo del bloqueo o nota extra, se agrega al tooltip. */
  note?: string;
};

export function MapCell({ cell, label, highlighted, dimmed, selected, onSelect, size = 40, disabled, note }: CellProps) {
  const meta = MAP_STATE_META[cell.state];
  const title = [
    cell.code,
    `${meta.label}`,
    `${cell.basesUsed} base(s)${cell.capacityBases ? ` de ${cell.capacityBases}` : ""}`,
    `${cell.pallets} pallet(s) · ${fmtQty(cell.units)} unid.`,
    ...cell.issues.map((i) => ISSUE_META[i].label),
    ...(note ? [note] : []),
  ].join(" · ");

  return (
    <button
      type="button"
      onClick={() => onSelect(cell)}
      disabled={disabled}
      title={title}
      aria-label={`Ubicación ${cell.code}, ${meta.label}, ${cell.pallets} pallets`}
      aria-pressed={selected}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: label.length > 4 ? 9 : 10,
        fontFamily: "monospace",
        fontWeight: cell.pallets > 0 ? 800 : 400,
        padding: 0,
        background: meta.bg,
        border: meta.border,
        color: meta.text,
        opacity: dimmed ? 0.22 : disabled ? 0.3 : cell.state === "INACTIVE" ? 0.55 : 1,
        textDecoration: cell.state === "INACTIVE" ? "line-through" : undefined,
        outline: highlighted ? "2px solid var(--primary)" : selected ? "2px solid var(--text)" : undefined,
        outlineOffset: 2,
        boxShadow: highlighted ? "0 0 0 4px var(--primary-light)" : undefined,
        transition: "opacity .12s ease",
      }}
    >
      {label}
    </button>
  );
}

/* ── Mapa del depósito ──────────────────────────────────────────────────── */

type MapProps = {
  cells: LocationCell[];
  /** null = sin búsqueda activa (no se atenúa nada). */
  highlight: Set<string> | null;
  highlightQty?: Map<string, number>;
  selectedId: string | null;
  onSelect: (cell: LocationCell) => void;
  emptyMessage: string;
  /** Celdas que no se pueden elegir (se atenúan y quedan inertes). */
  disabledIds?: Set<string>;
  /** Nota por celda para el tooltip (ej: "quedan 2 bases"). */
  noteById?: Map<string, string>;
  /** Texto dentro de la celda. Por defecto, la cantidad resaltada o los pallets. */
  labelFor?: (cell: LocationCell) => string;
  cellSize?: number;
};

/**
 * Mapa del depósito: agrupa las celdas por Sector y las dibuja como una grilla de
 * Subsectores, coloreadas por estado (libre / ocupada / llena / incidencia…).
 * Compartido por el localizador (Ubicaciones) y por el selector de ubicación.
 */
export default function WarehouseMap({
  cells, highlight, highlightQty, selectedId, onSelect, emptyMessage,
  disabledIds, noteById, labelFor, cellSize,
}: MapProps) {
  /** Sector → Subsectores (cada Subsector es ya una celda única — sin niveles/posiciones). */
  const aisleGroups = useMemo(() => {
    const byAisle = new Map<string, LocationCell[]>();
    for (const c of cells.filter((c) => c.aisle)) {
      byAisle.set(c.aisle!, [...(byAisle.get(c.aisle!) ?? []), c]);
    }
    return [...byAisle.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([aisle, list]) => ({
        aisle,
        cells: [...list].sort((a, b) => (a.rack ?? "").localeCompare(b.rack ?? "", undefined, { numeric: true })),
      }));
  }, [cells]);

  const flatCells = useMemo(() => cells.filter((c) => !c.aisle), [cells]);

  function cellLabel(c: LocationCell) {
    if (labelFor) return labelFor(c);
    const qty = highlightQty?.get(c.id);
    if (qty != null) return fmtQty(qty);
    return c.pallets > 0 ? String(c.pallets) : "";
  }

  if (cells.length === 0) {
    return (
      <div style={{ background: "var(--bg)", border: "1px dashed var(--border)", borderRadius: 10, padding: "28px 20px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {aisleGroups.map((g) => (
        <div key={g.aisle} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: "var(--bg)", padding: "7px 12px", fontSize: 13, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>
            Sector {g.aisle}
            <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              {g.cells.length} subsector{g.cells.length !== 1 ? "es" : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap" }}>
            {g.cells.map((c) => (
              <div key={c.id} style={{ textAlign: "center" }}>
                <MapCell
                  cell={c}
                  label={cellLabel(c)}
                  highlighted={!!highlight?.has(c.id)}
                  dimmed={!!highlight && !highlight.has(c.id)}
                  selected={selectedId === c.id}
                  onSelect={onSelect}
                  disabled={disabledIds?.has(c.id)}
                  note={noteById?.get(c.id)}
                  size={cellSize}
                />
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2, fontFamily: "monospace" }}>{c.rack ?? c.code}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {flatCells.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: "var(--bg)", padding: "7px 12px", fontSize: 13, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>
            {aisleGroups.length > 0 ? "Otras ubicaciones" : "Ubicaciones"}
          </div>
          <div style={{ display: "flex", gap: 6, padding: 12, flexWrap: "wrap" }}>
            {flatCells.map((c) => {
              const meta = MAP_STATE_META[c.state];
              const dimmed = !!highlight && !highlight.has(c.id);
              const disabled = disabledIds?.has(c.id);
              const qty = highlightQty?.get(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c)}
                  disabled={disabled}
                  title={[`${meta.label} · ${c.pallets} pallet(s) · ${fmtQty(c.units)} unid.`, noteById?.get(c.id)].filter(Boolean).join(" · ")}
                  style={{
                    borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", padding: "6px 10px",
                    fontSize: 12, fontFamily: "monospace", fontWeight: 600,
                    background: meta.bg, border: meta.border, color: meta.text,
                    opacity: dimmed ? 0.22 : disabled ? 0.3 : c.state === "INACTIVE" ? 0.55 : 1,
                    outline: highlight?.has(c.id) ? "2px solid var(--primary)" : selectedId === c.id ? "2px solid var(--text)" : undefined,
                    outlineOffset: 2,
                  }}
                >
                  {c.code}
                  {qty != null ? ` · ${fmtQty(qty)}` : c.pallets > 0 ? ` · ${c.pallets}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Leyenda de colores ─────────────────────────────────────────────────── */

export function MapLegend({ states }: { states: LocationMapState[] }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
      {states.map((s) => {
        const meta = MAP_STATE_META[s];
        return (
          <span key={s}>
            <span
              style={{
                display: "inline-block", width: 12, height: 12, borderRadius: 3,
                background: meta.bg, border: meta.border,
                verticalAlign: "middle", marginRight: 4,
              }}
            />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
