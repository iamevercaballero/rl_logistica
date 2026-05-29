import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMovements, type Movement, type MovementType } from "../api/movements";
import MovementEditorModal from "./MovementEditorModal";

interface Props {
  onTypeChange: (t: MovementType) => void;
}

const PAGE_SIZE = 20;

export default function AdjustmentOutForm({ onTypeChange }: Props) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Movement | null>(null);

  const movementsQ = useQuery({
    queryKey: ["movements", "exit-list", { search, page }],
    queryFn: () =>
      getMovements({ type: "EXIT", search: search || undefined, page, limit: PAGE_SIZE }),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const movements = movementsQ.data?.data ?? [];
  const meta = movementsQ.data?.meta;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  return (
    <>
      {editing && (
        <MovementEditorModal
          movement={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            movementsQ.refetch();
          }}
        />
      )}

      <section className="card">
        {/* Header + type switcher */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Ajuste de Salida</h3>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Buscá una salida existente y editá sus datos. Cada cambio queda auditado.
            </p>
          </div>
          <select
            className="input"
            value="ADJUSTMENT_OUT"
            onChange={(e) => onTypeChange(e.target.value as MovementType)}
            style={{ width: 190 }}
            aria-label="Tipo de movimiento"
          >
            <option value="ENTRY">Entrada</option>
            <option value="EXIT">Salida</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="ADJUSTMENT_IN">Ajuste entrada</option>
            <option value="ADJUSTMENT_OUT">Ajuste salida</option>
          </select>
        </div>

        {/* Buscador */}
        <form
          onSubmit={handleSearch}
          style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}
        >
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Buscar por producto, código, lote, destino o N° remito..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Buscar salidas"
          />
          <button className="btn btn--primary" type="submit" style={{ whiteSpace: "nowrap" }}>
            Buscar
          </button>
          {search && (
            <button type="button" className="btn" onClick={clearSearch}>
              Limpiar
            </button>
          )}
        </form>

        {search && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "-8px 0 10px" }}>
            Resultados para <strong>"{search}"</strong>
            {meta && ` — ${meta.total} encontrado${meta.total !== 1 ? "s" : ""}`}
          </p>
        )}

        {/* Lista */}
        {movementsQ.isFetching && movements.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando salidas...</p>
        ) : movements.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "32px 0",
              color: "var(--muted)",
              fontSize: 14,
            }}
          >
            {search ? "Sin resultados para esa búsqueda." : "No hay salidas registradas."}
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gap: 6,
                opacity: movementsQ.isFetching ? 0.6 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {movements.map((m) => (
                <MovementRow key={m.id} movement={m} onEdit={() => setEditing(m)} />
              ))}
            </div>

            {/* Paginación */}
            {meta && meta.totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                  justifyContent: "center",
                }}
              >
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 12px" }}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Anterior
                </button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  Pág. {meta.page} / {meta.totalPages}
                </span>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 12px" }}
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

// ── Fila de movimiento ──────────────────────────────────────────────────────

interface RowProps {
  movement: Movement;
  onEdit: () => void;
}

function MovementRow({ movement: m, onEdit }: RowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 8,
        border: "1.5px solid var(--border)",
        background: "var(--bg)",
        cursor: "pointer",
        transition: "border-color 0.1s, background 0.1s",
      }}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onEdit()}
      aria-label={`Editar salida de ${m.material.code}`}
    >
      <div>
        {/* Línea 1: material + lote */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{m.material.code}</span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{m.material.description}</span>
          {m.lotCode && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "var(--primary)",
                background: "var(--primary-light)",
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              {m.lotCode}
            </span>
          )}
        </div>

        {/* Línea 2: fecha + destino + documento + transportadora */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 4,
            flexWrap: "wrap",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <span>{new Date(m.date).toLocaleDateString("es-PY")}</span>
          {m.destination && <span>→ {m.destination}</span>}
          {m.documentNumber && <span>Rem. {m.documentNumber}</span>}
          {m.carrier && <span>{m.carrier}</span>}
        </div>
      </div>

      {/* Cantidad + botón */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--danger)" }}>
            -{m.quantity.toLocaleString("es-PY")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {m.material.unitOfMeasure ?? "unid."}
          </div>
        </div>
        <button
          className="btn"
          style={{ fontSize: 12, padding: "5px 12px", whiteSpace: "nowrap" }}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          aria-label="Editar"
        >
          ✏ Editar
        </button>
      </div>
    </div>
  );
}
