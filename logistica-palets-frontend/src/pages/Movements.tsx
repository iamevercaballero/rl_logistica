import { useCallback, useEffect, useState } from "react";
import { getMovements, type Movement, type MovementType } from "../api/movements";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { getFriendlyApiError } from "../utils/apiError";

type Filters = {
  type: "" | MovementType;
  warehouseId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

const initialFilters: Filters = {
  type: "",
  warehouseId: "",
  dateFrom: "",
  dateTo: "",
  search: "",
};

export default function MovementsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [data, setData] = useState<Movement[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);

  const refresh = useCallback(async (page = 1, limit = 20, current = initialFilters) => {
    setLoading(true);
    setError("");

    try {
      const response = await getMovements({
        page,
        limit,
        type: current.type || undefined,
        warehouseId: current.warehouseId || undefined,
        dateFrom: current.dateFrom || undefined,
        dateTo: current.dateTo || undefined,
        search: current.search.trim() || undefined,
      });

      setData(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch(() => setWarehouses([]));
    refresh(1, 20, initialFilters).catch(() => undefined);
  }, [refresh]);

  function applyFilters() {
    setAppliedFilters(filters);
    refresh(1, meta.limit, filters).catch(() => undefined);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    refresh(1, meta.limit, initialFilters).catch(() => undefined);
  }

  return (
    <div>
      <h2>Movimientos</h2>
      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value as Filters["type"] }))}>
            <option value="">Todos</option>
            <option value="ENTRY">ENTRY</option>
            <option value="EXIT">EXIT</option>
            <option value="TRANSFER">TRANSFER</option>
          </select>
          <select className="input" value={filters.warehouseId} onChange={(event) => setFilters((prev) => ({ ...prev, warehouseId: event.target.value }))}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
          <input
            className="input"
            placeholder="Buscar (pallet, referencia...)"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            style={{ minWidth: 250 }}
          />
          <button className="btn btn--primary" onClick={applyFilters}>
            Aplicar
          </button>
          <button className="btn" onClick={clearFilters}>
            Limpiar
          </button>
        </div>
      </section>

      {loading ? <p>Cargando...</p> : null}
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={() => refresh(meta.page, meta.limit, appliedFilters)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        data.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Referencia</th>
                <th>Notas</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {data.map((movement) => (
                <tr key={movement.id}>
                  <td>{new Date(movement.date).toLocaleString()}</td>
                  <td>{movement.type}</td>
                  <td>{movement.reference || "-"}</td>
                  <td>{movement.notes || "-"}</td>
                  <td>{movement.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button className="btn" disabled={loading || meta.page <= 1} onClick={() => refresh(meta.page - 1, meta.limit, appliedFilters)}>
          Anterior
        </button>
        <span>
          Página {meta.page} de {meta.totalPages}
        </span>
        <button className="btn" disabled={loading || meta.page >= meta.totalPages} onClick={() => refresh(meta.page + 1, meta.limit, appliedFilters)}>
          Siguiente
        </button>
        <select className="input" value={meta.limit} onChange={(event) => refresh(1, Number(event.target.value), appliedFilters)}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>
    </div>
  );
}
