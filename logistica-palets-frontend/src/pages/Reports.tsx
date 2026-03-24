import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getDailyStockReport,
  getDifferencesSapReport,
  getMovementsReport,
  getStockReport,
  getTraceReport,
  upsertSapStock,
  type DailyStockRow,
  type ReportMovementRow,
  type StockReportResponse,
  type TraceReportResponse,
} from "../api/reports";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { listProducts, type Product } from "../api/products";
import { getFriendlyApiError } from "../utils/apiError";

type MovementFilters = {
  warehouseId: string;
  productId: string;
  type: "" | "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "REPROCESS";
  dateFrom: string;
  dateTo: string;
  search: string;
};

const initialFilters: MovementFilters = {
  warehouseId: "",
  productId: "",
  type: "",
  dateFrom: "",
  dateTo: "",
  search: "",
};

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockReportResponse | null>(null);
  const [stockWarehouseId, setStockWarehouseId] = useState("");
  const [movements, setMovements] = useState<ReportMovementRow[]>([]);
  const [movementsMeta, setMovementsMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState<MovementFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<MovementFilters>(initialFilters);
  const [traceMaterialId, setTraceMaterialId] = useState("");
  const [traceResult, setTraceResult] = useState<TraceReportResponse | null>(null);
  const [dailyDate, setDailyDate] = useState(today);
  const [dailyStock, setDailyStock] = useState<DailyStockRow[]>([]);
  const [differencesSap, setDifferencesSap] = useState<DailyStockRow[]>([]);
  const [sapForm, setSapForm] = useState({ date: today, productId: "", warehouseId: "", sapQuantity: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [traceError, setTraceError] = useState("");
  const [sapError, setSapError] = useState("");

  const loadStock = useCallback(async (warehouseId?: string) => {
    const data = await getStockReport(warehouseId);
    setStock(data);
  }, []);

  const loadMovements = useCallback(async (page = 1, limit = 20, current = initialFilters) => {
    const response = await getMovementsReport({
      page,
      limit,
      warehouseId: current.warehouseId || undefined,
      productId: current.productId || undefined,
      type: current.type || undefined,
      dateFrom: current.dateFrom || undefined,
      dateTo: current.dateTo || undefined,
      search: current.search.trim() || undefined,
    });

    setMovements(response.data);
    setMovementsMeta(response.meta);
  }, []);

  const loadDaily = useCallback(async (date: string) => {
    const [daily, diff] = await Promise.all([
      getDailyStockReport({ date }),
      getDifferencesSapReport({ date }),
    ]);
    setDailyStock(daily);
    setDifferencesSap(diff);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [warehouseData, productData] = await Promise.all([listWarehouses().catch(() => []), listProducts().catch(() => [])]);
      setWarehouses(warehouseData);
      setProducts(productData);
      await Promise.all([loadStock(stockWarehouseId || undefined), loadMovements(1, 20, appliedFilters), loadDaily(dailyDate)]);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, dailyDate, loadDaily, loadMovements, loadStock, stockWarehouseId]);

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
    if (!traceMaterialId.trim()) {
      setTraceResult(null);
      setTraceError("");
      return;
    }

    setLoading(true);
    setTraceError("");
    try {
      const result = await getTraceReport(traceMaterialId.trim());
      setTraceResult(result);
    } catch (err) {
      setTraceResult(null);
      setTraceError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSapStock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSapError("");
    setLoading(true);
    try {
      await upsertSapStock({
        date: sapForm.date,
        productId: sapForm.productId,
        warehouseId: sapForm.warehouseId || undefined,
        sapQuantity: Number(sapForm.sapQuantity),
      });
      await loadDaily(dailyDate);
    } catch (err) {
      setSapError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const stockChartData = useMemo(
    () => (stock?.byWarehouse ?? []).map((row) => ({ name: row.warehouseName || "Sin depósito", quantity: row.quantity })),
    [stock],
  );

  return (
    <div>
      <h2>Reportes</h2>
      <p style={{ color: "#6b7280" }}>Consultas listas para stock real, trazabilidad por material, control diario y diferencias con SAP.</p>

      {loading ? <p>Cargando...</p> : null}
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={loadInitial}>Reintentar</button>
        </div>
      ) : null}

      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Stock actual</h3>
          <select className="input" value={stockWarehouseId} onChange={async (event) => {
            const nextWarehouseId = event.target.value;
            setStockWarehouseId(nextWarehouseId);
            setLoading(true);
            try {
              await loadStock(nextWarehouseId || undefined);
            } catch (err) {
              setError(getFriendlyApiError(err));
            } finally {
              setLoading(false);
            }
          }}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </div>

        {stock ? (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <span className="badge">Materiales: {stock.totalMaterials}</span>
              <span className="badge">Posiciones: {stock.stockRows}</span>
              <span className="badge">Cantidad total: {stock.totalQuantity}</span>
            </div>
            <div style={{ height: 220, margin: "12px 0" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockChartData}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="quantity" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Depósito</th>
                  <th>Ubicación</th>
                  <th>Cantidad</th>
                  <th>Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {stock.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.material.code} · {item.material.description}</td>
                    <td>{item.warehouse?.name ?? "-"}</td>
                    <td>{item.location?.code ?? "-"}</td>
                    <td>{item.currentQuantity} {item.material.unitOfMeasure ?? ""}</td>
                    <td>{new Date(item.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Historial de movimientos</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <select className="input" value={filters.warehouseId} onChange={(event) => setFilters((prev) => ({ ...prev, warehouseId: event.target.value }))}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <select className="input" value={filters.productId} onChange={(event) => setFilters((prev) => ({ ...prev, productId: event.target.value }))}>
            <option value="">Todos los materiales</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.code}</option>)}
          </select>
          <select className="input" value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value as MovementFilters["type"] }))}>
            <option value="">Todos</option>
            <option value="ENTRY">ENTRY</option>
            <option value="EXIT">EXIT</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="ADJUSTMENT_IN">ADJUSTMENT_IN</option>
            <option value="ADJUSTMENT_OUT">ADJUSTMENT_OUT</option>
            <option value="REPROCESS">REPROCESS</option>
          </select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
          <input className="input" placeholder="Buscar" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          <button className="btn btn--primary" onClick={handleApplyMovements}>Aplicar</button>
        </div>

        {movements.length === 0 ? <p style={{ marginBottom: 0 }}>No hay registros</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Material</th>
                <th>Cantidad</th>
                <th>Ubicación</th>
                <th>Documento</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={`${movement.id}-${movement.date}`}>
                  <td>{new Date(movement.date).toLocaleString()}</td>
                  <td>{movement.type}</td>
                  <td>{movement.material.code} · {movement.material.description}</td>
                  <td>{movement.quantity}</td>
                  <td>{movement.type === "TRANSFER" ? `${movement.from?.locationCode ?? "-"} → ${movement.to?.locationCode ?? "-"}` : `${movement.warehouse?.name ?? "-"} / ${movement.location?.code ?? "-"}`}</td>
                  <td>{movement.documentNumber || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ marginTop: 0 }}>Control diario</h3>
          <input className="input" type="date" value={dailyDate} onChange={async (event) => {
            const nextDate = event.target.value;
            setDailyDate(nextDate);
            setLoading(true);
            try {
              await loadDaily(nextDate);
            } catch (err) {
              setError(getFriendlyApiError(err));
            } finally {
              setLoading(false);
            }
          }} />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Stock inicial</th>
              <th>Entradas</th>
              <th>Salidas</th>
              <th>Stock final</th>
              <th>Stock SAP</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {dailyStock.map((row) => (
              <tr key={`${row.date}-${row.material.id}`}>
                <td>{row.material.code} · {row.material.description}</td>
                <td>{row.stockInicial}</td>
                <td>{row.entradas}</td>
                <td>{row.salidas}</td>
                <td>{row.stockFinal}</td>
                <td>{row.stockSAP}</td>
                <td style={{ color: row.diferencia === 0 ? "inherit" : "#b91c1c", fontWeight: row.diferencia === 0 ? 400 : 700 }}>{row.diferencia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Carga de stock SAP</h3>
        <form onSubmit={handleSaveSapStock} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <input className="input" type="date" value={sapForm.date} onChange={(event) => setSapForm((prev) => ({ ...prev, date: event.target.value }))} />
            <select className="input" value={sapForm.productId} onChange={(event) => setSapForm((prev) => ({ ...prev, productId: event.target.value }))}>
              <option value="">Material</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.description}</option>)}
            </select>
            <select className="input" value={sapForm.warehouseId} onChange={(event) => setSapForm((prev) => ({ ...prev, warehouseId: event.target.value }))}>
              <option value="">Depósito (opcional)</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
            <input className="input" type="number" min={0} placeholder="Stock SAP" value={sapForm.sapQuantity} onChange={(event) => setSapForm((prev) => ({ ...prev, sapQuantity: event.target.value }))} />
          </div>
          {sapError ? <p style={{ color: "#b91c1c", margin: 0 }}>{sapError}</p> : null}
          <div><button className="btn btn--primary" type="submit">Guardar stock SAP</button></div>
        </form>

        <h4 style={{ marginBottom: 8 }}>Diferencias contra SAP</h4>
        {differencesSap.length === 0 ? <p>No hay diferencias para la fecha seleccionada.</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Sistema</th>
                <th>SAP</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {differencesSap.map((row) => (
                <tr key={`diff-${row.date}-${row.material.id}`}>
                  <td>{row.material.code} · {row.material.description}</td>
                  <td>{row.stockFinal}</td>
                  <td>{row.stockSAP}</td>
                  <td style={{ color: "#b91c1c", fontWeight: 700 }}>{row.diferencia}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Trazabilidad por material</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <select className="input" value={traceMaterialId} onChange={(event) => setTraceMaterialId(event.target.value)} style={{ minWidth: 320 }}>
            <option value="">Seleccionar material</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.description}</option>)}
          </select>
          <button className="btn btn--primary" onClick={handleTraceSearch}>Buscar</button>
        </div>

        {traceError ? <p style={{ color: "#b91c1c" }}>{traceError}</p> : null}
        {!traceResult ? <p style={{ marginBottom: 0 }}>Elegí un material para consultar su historia completa.</p> : traceResult.history.length === 0 ? <p style={{ marginBottom: 0 }}>No hay registros</p> : (
          <div style={{ display: "grid", gap: 10 }}>
            {traceResult.history.map((event) => (
              <div key={event.movementId} style={{ borderLeft: "3px solid #e5e7eb", paddingLeft: 10 }}>
                <div style={{ fontWeight: 700 }}>{event.type} · {event.quantity}</div>
                <div style={{ color: "#6b7280", fontSize: 13 }}>{new Date(event.at).toLocaleString()}</div>
                <div style={{ fontSize: 13 }}>Documento: {event.documentNumber || "-"}</div>
                <div style={{ fontSize: 13 }}>Origen: {event.fromWarehouseName || event.warehouseName || "-"} / {event.fromLocationCode || "-"}</div>
                <div style={{ fontSize: 13 }}>Destino: {event.toWarehouseName || event.destination || event.warehouseName || "-"} / {event.toLocationCode || event.locationCode || "-"}</div>
                <div style={{ fontSize: 13 }}>Notas: {event.notes || "-"}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
