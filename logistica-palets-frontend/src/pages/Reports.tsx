import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getMovementsReport,
  getStockReport,
  getTraceReport,
  type ReportMovementRow,
  type StockReportResponse,
  type TraceReportResponse,
} from "../api/reports";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { getFriendlyApiError } from "../utils/apiError";

type MovementFilters = {
  warehouseId: string;
  type: "" | "ENTRY" | "EXIT" | "TRANSFER";
  dateFrom: string;
  dateTo: string;
  search: string;
};

const initialFilters: MovementFilters = {
  warehouseId: "",
  type: "",
  dateFrom: "",
  dateTo: "",
  search: "",
};

export default function ReportsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockReportResponse | null>(null);
  const [stockWarehouseId, setStockWarehouseId] = useState("");
  const [movements, setMovements] = useState<ReportMovementRow[]>([]);
  const [movementsMeta, setMovementsMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState<MovementFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<MovementFilters>(initialFilters);
  const [tracePalletId, setTracePalletId] = useState("");
  const [traceResult, setTraceResult] = useState<TraceReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [traceError, setTraceError] = useState("");

  const loadStock = useCallback(async (warehouseId?: string) => {
    const data = await getStockReport(warehouseId);
    setStock(data);
  }, []);

  const loadMovements = useCallback(async (page = 1, limit = 20, current = initialFilters) => {
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
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const warehouseData = await listWarehouses().catch(() => []);
      setWarehouses(warehouseData);
      await Promise.all([loadStock(stockWarehouseId || undefined), loadMovements(1, 20, appliedFilters)]);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, loadMovements, loadStock, stockWarehouseId]);

  useEffect(() => {
    loadInitial().catch(() => undefined);
  }, [loadInitial]);

  async function handleApplyMovements() {
    setLoading(true);
    setError("");
    try {
      setAppliedFilters(filters);
      await loadMovements(1, movementsMeta.limit, filters);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleTraceSearch() {
    if (!tracePalletId.trim()) {
      setTraceResult(null);
      setTraceError("");
      return;
    }

    setLoading(true);
    setTraceError("");
    try {
      const result = await getTraceReport(tracePalletId.trim());
      setTraceResult(result);
    } catch (err) {
      setTraceResult(null);
      setTraceError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const stockChartData = useMemo(
    () => (stock?.byWarehouse ?? []).map((row) => ({ name: row.warehouseName, units: row.units })),
    [stock],
  );

  return (
    <div>
      <h2>Reportes</h2>
      <p style={{ color: "#6b7280" }}>Consultas listas para validar stock, movimientos y trazabilidad.</p>

      {loading ? <p>Cargando...</p> : null}
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={loadInitial}>
            Reintentar
          </button>
        </div>
      ) : null}

      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Stock</h3>
          <select
            className="input"
            value={stockWarehouseId}
            onChange={async (event) => {
              const nextWarehouseId = event.target.value;
              setStockWarehouseId(nextWarehouseId);
              setLoading(true);
              setError("");
              try {
                await loadStock(nextWarehouseId || undefined);
              } catch (err) {
                setError(getFriendlyApiError(err));
              } finally {
                setLoading(false);
              }
            }}
          >
            <option value="">Todos los depósitos</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </div>

        {stock && stock.items.length > 0 ? (
          <>
            <div style={{ height: 220, margin: "12px 0" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockChartData}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="units" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Palet</th>
                  <th>Depósito</th>
                  <th>Ubicación</th>
                  <th>Unidades</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {stock.items.map((item) => (
                  <tr key={item.palletId}>
                    <td>{item.palletCode}</td>
                    <td>{item.warehouseName}</td>
                    <td>{item.locationCode}</td>
                    <td>{item.quantity}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ marginTop: 12, marginBottom: 0 }}>No hay registros</p>
        )}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Movimientos</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <select className="input" value={filters.warehouseId} onChange={(event) => setFilters((prev) => ({ ...prev, warehouseId: event.target.value }))}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          <select className="input" value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value as MovementFilters["type"] }))}>
            <option value="">Todos</option>
            <option value="ENTRY">ENTRY</option>
            <option value="EXIT">EXIT</option>
            <option value="TRANSFER">TRANSFER</option>
          </select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
          <input className="input" placeholder="Buscar" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          <button className="btn btn--primary" onClick={handleApplyMovements}>
            Aplicar
          </button>
        </div>

        {movements.length === 0 ? (
          <p style={{ marginBottom: 0 }}>No hay registros</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Depósito</th>
                <th>Palet</th>
                <th>Cantidad</th>
                <th>Referencia</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={`${movement.id}-${movement.createdAt}-${movement.palletId ?? ""}`}>
                  <td>{new Date(movement.createdAt).toLocaleString()}</td>
                  <td>{movement.type}</td>
                  <td>{movement.warehouseName ?? "-"}</td>
                  <td>{movement.palletCode ?? "-"}</td>
                  <td>{movement.quantity ?? "-"}</td>
                  <td>{movement.reference || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <button
            className="btn"
            disabled={loading || movementsMeta.page <= 1}
            onClick={() => loadMovements(movementsMeta.page - 1, movementsMeta.limit, appliedFilters)}
          >
            Anterior
          </button>
          <span>
            Página {movementsMeta.page} de {movementsMeta.totalPages}
          </span>
          <button
            className="btn"
            disabled={loading || movementsMeta.page >= movementsMeta.totalPages}
            onClick={() => loadMovements(movementsMeta.page + 1, movementsMeta.limit, appliedFilters)}
          >
            Siguiente
          </button>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Trazabilidad</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="PalletId"
            value={tracePalletId}
            onChange={(event) => setTracePalletId(event.target.value)}
            style={{ minWidth: 320 }}
          />
          <button className="btn btn--primary" onClick={handleTraceSearch}>
            Buscar
          </button>
        </div>

        {traceError ? <p style={{ color: "#b91c1c" }}>{traceError}</p> : null}
        {!traceResult ? (
          <p style={{ marginBottom: 0 }}>Ingresá un palletId para consultar.</p>
        ) : traceResult.history.length === 0 ? (
          <p style={{ marginBottom: 0 }}>No hay registros</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {traceResult.history.map((event, index) => (
              <div key={`${event.at}-${index}`} style={{ borderLeft: "3px solid #e5e7eb", paddingLeft: 10 }}>
                <div style={{ fontWeight: 700 }}>{event.type}</div>
                <div style={{ color: "#6b7280", fontSize: 13 }}>{new Date(event.at).toLocaleString()}</div>
                <div style={{ fontSize: 13 }}>
                  Origen: {event.fromWarehouse || "-"} · Destino: {event.toWarehouse || "-"}
                </div>
                <div style={{ fontSize: 13 }}>Referencia: {event.ref || "-"}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
