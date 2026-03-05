import { useEffect, useState } from "react";
import { getMovements, type MovementType } from "../api/movements";
import { listWarehouses } from "../api/warehouses";
import type { Warehouse } from "../api/warehouses";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

type Filters = {
  type: "" | MovementType;
  warehouseId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

export default function MovementsPage() {
  const { pushToast } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>({ type: "", warehouseId: "", dateFrom: "", dateTo: "", search: "" });
  const [applied, setApplied] = useState<Filters>({ type: "", warehouseId: "", dateFrom: "", dateTo: "", search: "" });

  async function refresh(page = meta.page, limit = meta.limit, current = applied) {
    setLoading(true); setError("");
    try {
      const response = await getMovements({ page, limit, ...current, type: current.type || undefined, warehouseId: current.warehouseId || undefined, dateFrom: current.dateFrom || undefined, dateTo: current.dateTo || undefined, search: current.search.trim() || undefined });
      setData(response.data);
      setMeta(response.meta);
    } catch (e) {
      const message = getFriendlyApiError(e);
      setError(message);
      pushToast(message, "error");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch((e) => pushToast(getFriendlyApiError(e), "error"));
    refresh(1, 20, applied);
  }, []);

  const applyFilters = () => { setApplied(filters); refresh(1, meta.limit, filters); };
  const clearFilters = () => { const initial = { type: "", warehouseId: "", dateFrom: "", dateTo: "", search: "" } as Filters; setFilters(initial); setApplied(initial); refresh(1, meta.limit, initial); };

  return (
    <div>
      <h2>Movements</h2>
      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" value={filters.type} onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value as Filters["type"] }))}><option value="">Todos</option><option value="ENTRY">ENTRY</option><option value="EXIT">EXIT</option><option value="TRANSFER">TRANSFER</option></select>
          <select className="input" value={filters.warehouseId} onChange={(e) => setFilters((prev) => ({ ...prev, warehouseId: e.target.value }))}><option value="">Todos depósitos</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))} />
          <input className="input" placeholder="Buscar (pallet, referencia...)" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} style={{ minWidth: 250 }} />
          <button className="btn btn--primary" onClick={applyFilters}>Aplicar</button>
          <button className="btn" onClick={clearFilters}>Limpiar</button>
        </div>
      </section>

      {loading ? <p>Cargando...</p> : error ? <p style={{ color: "#b91c1c" }}>{error}</p> : data.length === 0 ? <EmptyState title="Sin movimientos" description="No hay resultados para los filtros seleccionados." /> : <table className="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th>Notas</th><th>ID</th></tr></thead><tbody>{data.map((m) => <tr key={m.id}><td>{new Date(m.date).toLocaleString()}</td><td>{m.type}</td><td>{m.reference || "-"}</td><td>{m.notes || "-"}</td><td>{m.id}</td></tr>)}</tbody></table>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button className="btn" disabled={loading || meta.page <= 1} onClick={() => refresh(meta.page - 1, meta.limit)}>Anterior</button>
        <span>Página {meta.page} de {meta.totalPages}</span>
        <button className="btn" disabled={loading || meta.page >= meta.totalPages} onClick={() => refresh(meta.page + 1, meta.limit)}>Siguiente</button>
        <select className="input" value={meta.limit} onChange={(e) => refresh(1, Number(e.target.value))}>
          <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
        </select>
      </div>
    </div>
  );
}
