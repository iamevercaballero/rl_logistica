import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { getMovementsReport, getStockReport, getTraceReport, type ReportMovementRow, type StockReportResponse, type TraceReportResponse } from "../api/reports";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { EmptyState } from "../components/EmptyState";

type MovementFilters = {
  warehouseId: string;
  type: "" | "ENTRY" | "EXIT" | "TRANSFER";
  dateFrom: string;
  dateTo: string;
  search: string;
};

export default function ReportsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockReportResponse | null>(null);
  const [stockWarehouseId, setStockWarehouseId] = useState("");
  const [movements, setMovements] = useState<ReportMovementRow[]>([]);
  const [movementsMeta, setMovementsMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState<MovementFilters>({ warehouseId: "", type: "", dateFrom: "", dateTo: "", search: "" });
  const [tracePalletId, setTracePalletId] = useState("");
  const [traceResult, setTraceResult] = useState<TraceReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  async function loadStock(warehouseId?: string) {
    const data = await getStockReport(warehouseId);
    setStock(data);
  }

  async function loadMovements(page = 1, limit = movementsMeta.limit, current = filters) {
    const response = await getMovementsReport({
      page,
      limit,
      warehouseId: current.warehouseId || undefined,
      type: current.type || undefined,
      dateFrom: current.dateFrom || undefined,
      dateTo: current.dateTo || undefined,
      search: current.search.trim() || undefined,
    });
    setMovements(response.data);
    setMovementsMeta(response.meta);
  }

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([loadStock(), loadMovements()]).catch(() => setError("No se pudieron cargar los reportes")).finally(() => setLoading(false));
  }, []);

  async function onApplyMovements() {
    setLoading(true);
    setError("");
    try {
      await loadMovements(1, movementsMeta.limit, filters);
    } catch {
      setError("Error cargando movimientos");
    } finally {
      setLoading(false);
    }
  }

  async function onSearchTrace() {
    if (!tracePalletId.trim()) return;
    setLoading(true);
    setError("");
    try {
      const trace = await getTraceReport(tracePalletId.trim());
      setTraceResult(trace);
    } catch {
      setTraceResult(null);
      setError("No se pudo obtener la trazabilidad. Verificá el palletId.");
    } finally {
      setLoading(false);
    }
  }

  const stockChartData = useMemo(() => (stock?.byWarehouse ?? []).map((row) => ({ name: row.warehouseName, units: row.units })), [stock]);

  return (
    <div>
      <h2>Reportes</h2>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {loading && <p>Cargando...</p>}

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Stock</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <select className="input" value={stockWarehouseId} onChange={async (e) => {
            const selected = e.target.value;
            setStockWarehouseId(selected);
            try { await loadStock(selected || undefined); } catch { setError("Error cargando stock"); }
          }}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>

        {stock && stock.items.length === 0 ? <EmptyState title="Sin stock" description="No hay palets para el filtro seleccionado." /> : (
          <>
            <div style={{ height: 220, marginBottom: 10 }}>
              <ResponsiveContainer width="100%" height="100%"><BarChart data={stockChartData}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="units" /></BarChart></ResponsiveContainer>
            </div>
            <table className="table">
              <thead><tr><th>Palet</th><th>Depósito</th><th>Ubicación</th><th>Unidades</th><th>Estado</th></tr></thead>
              <tbody>{stock?.items.map((item) => <tr key={item.palletId}><td>{item.palletCode}</td><td>{item.warehouseName}</td><td>{item.locationCode}</td><td>{item.quantity}</td><td>{item.status}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Movimientos</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select className="input" value={filters.warehouseId} onChange={(e) => setFilters((p) => ({ ...p, warehouseId: e.target.value }))}><option value="">Todos depósitos</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <select className="input" value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value as MovementFilters["type"] }))}><option value="">Todos</option><option value="ENTRY">ENTRY</option><option value="EXIT">EXIT</option><option value="TRANSFER">TRANSFER</option></select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
          <input className="input" placeholder="Buscar" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
          <button className="btn btn--primary" onClick={onApplyMovements}>Aplicar</button>
        </div>

        {movements.length === 0 ? <EmptyState title="Sin movimientos" description="No hay movimientos con esos filtros." /> : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Depósito</th><th>Palet</th><th>Cantidad</th><th>Referencia</th></tr></thead>
            <tbody>{movements.map((m) => <tr key={`${m.id}-${m.createdAt}-${m.palletId ?? ""}`}><td>{new Date(m.createdAt).toLocaleString()}</td><td>{m.type}</td><td>{m.warehouseName ?? "-"}</td><td>{m.palletCode ?? "-"}</td><td>{m.quantity ?? "-"}</td><td>{m.reference || "-"}</td></tr>)}</tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <button className="btn" disabled={movementsMeta.page <= 1} onClick={() => loadMovements(movementsMeta.page - 1, movementsMeta.limit, filters)}>Anterior</button>
          <span>Página {movementsMeta.page} de {movementsMeta.totalPages}</span>
          <button className="btn" disabled={movementsMeta.page >= movementsMeta.totalPages} onClick={() => loadMovements(movementsMeta.page + 1, movementsMeta.limit, filters)}>Siguiente</button>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Trazabilidad</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="PalletId" value={tracePalletId} onChange={(e) => setTracePalletId(e.target.value)} style={{ minWidth: 360 }} />
          <button className="btn btn--primary" onClick={onSearchTrace}>Buscar</button>
        </div>

        {!traceResult ? <EmptyState title="Sin trazabilidad" description="Ingresá un palletId para ver la línea de tiempo." /> : traceResult.history.length === 0 ? <EmptyState title="Sin eventos" description="El pallet no tiene movimientos registrados." /> : (
          <div style={{ display: "grid", gap: 10 }}>
            {traceResult.history.map((event, idx) => {
              const icon = event.type === "ENTRY" ? "🟢" : event.type === "EXIT" ? "🔴" : "🔁";
              return <div key={`${event.at}-${idx}`} style={{ borderLeft: "3px solid #e5e7eb", paddingLeft: 10 }}><div style={{ fontWeight: 700 }}>{icon} {event.type}</div><div style={{ color: "#6b7280", fontSize: 13 }}>{new Date(event.at).toLocaleString()}</div><div style={{ fontSize: 13 }}>Origen: {event.fromWarehouse || "-"} · Destino: {event.toWarehouse || "-"}</div><div style={{ fontSize: 13 }}>Ref: {event.ref || "-"}</div></div>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
