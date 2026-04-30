import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste entrada",
  ADJUSTMENT_OUT: "Ajuste salida",
  REPROCESS: "Reproceso",
};

const MOVE_BADGE: Record<string, string> = {
  ENTRY: "badge badge--entry",
  EXIT: "badge badge--exit",
  TRANSFER: "badge badge--transfer",
  ADJUSTMENT_IN: "badge badge--adj-in",
  ADJUSTMENT_OUT: "badge badge--adj-out",
  REPROCESS: "badge badge--reprocess",
};

const BAR_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];

type Tab = "stock" | "movimientos" | "diario" | "sap" | "trazabilidad";

type MovementFilters = {
  warehouseId: string;
  productId: string;
  type: "" | "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "REPROCESS";
  dateFrom: string;
  dateTo: string;
  search: string;
};

const initialFilters: MovementFilters = {
  warehouseId: "", productId: "", type: "", dateFrom: "", dateTo: "", search: "",
};

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<Tab>("stock");
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
      page, limit,
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
      const [warehouseData, productData] = await Promise.all([
        listWarehouses().catch(() => []),
        listProducts().catch(() => []),
      ]);
      setWarehouses(warehouseData);
      setProducts(productData);
      await Promise.all([
        loadStock(stockWarehouseId || undefined),
        loadMovements(1, 20, appliedFilters),
        loadDaily(dailyDate),
      ]);
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
    if (!traceMaterialId.trim()) { setTraceResult(null); setTraceError(""); return; }
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

  const tabs: { key: Tab; label: string }[] = [
    { key: "stock", label: "Stock actual" },
    { key: "movimientos", label: "Historial" },
    { key: "diario", label: "Control diario" },
    { key: "sap", label: "Diferencias SAP" },
    { key: "trazabilidad", label: "Trazabilidad" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Reportes</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Stock real, trazabilidad por material, control diario y diferencias con SAP.
        </p>
      </div>

      {loading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>}

      {error && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 600 }}>No se pudo cargar.</span>
          <button className="btn btn--primary" onClick={loadInitial}>Reintentar</button>
        </div>
      )}

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab${activeTab === t.key ? " tab--active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Stock actual ── */}
      {activeTab === "stock" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Stock actual por depósito</h3>
            <select
              className="input"
              value={stockWarehouseId}
              onChange={async (e) => {
                const v = e.target.value;
                setStockWarehouseId(v);
                setLoading(true);
                try { await loadStock(v || undefined); }
                catch (err) { setError(getFriendlyApiError(err)); }
                finally { setLoading(false); }
              }}
            >
              <option value="">Todos los depósitos</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {stock && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <span className="badge">Materiales: <strong>{stock.totalMaterials}</strong></span>
                <span className="badge">Posiciones: <strong>{stock.stockRows}</strong></span>
                <span className="badge">Cantidad total: <strong>{stock.totalQuantity.toLocaleString("es-AR")}</strong></span>
              </div>
              {stockChartData.length > 0 && (
                <div style={{ height: 220, marginBottom: 16 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stockChartData} barSize={36}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }}
                        formatter={(v: number | undefined) => [(v ?? 0).toLocaleString("es-AR"), "Cantidad"]}
                      />
                      <Bar dataKey="quantity" radius={[6, 6, 0, 0]}>
                        {stockChartData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <table className="table">
                <thead>
                  <tr>
                    <th>Material</th><th>Depósito</th><th>Ubicación</th><th>Cantidad</th><th>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.items.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.material.code}</strong> · {item.material.description}</td>
                      <td>{item.warehouse?.name ?? "-"}</td>
                      <td>{item.location?.code ?? "-"}</td>
                      <td>{item.currentQuantity.toLocaleString("es-AR")} {item.material.unitOfMeasure ?? ""}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{new Date(item.updatedAt).toLocaleString("es-AR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {/* ── Tab: Historial de movimientos ── */}
      {activeTab === "movimientos" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Historial de movimientos</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select className="input" value={filters.warehouseId} onChange={(e) => setFilters((p) => ({ ...p, warehouseId: e.target.value }))}>
              <option value="">Todos los depósitos</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select className="input" value={filters.productId} onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}>
              <option value="">Todos los materiales</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
            <select className="input" value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value as MovementFilters["type"] }))}>
              <option value="">Todos los tipos</option>
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Salida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="ADJUSTMENT_IN">Ajuste entrada</option>
              <option value="ADJUSTMENT_OUT">Ajuste salida</option>
              <option value="REPROCESS">Reproceso</option>
            </select>
            <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
            <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
            <input className="input" placeholder="Buscar" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} style={{ minWidth: 200 }} />
            <button className="btn btn--primary" onClick={handleApplyMovements}>Buscar</button>
            <button className="btn" onClick={() => { setFilters(initialFilters); setAppliedFilters(initialFilters); loadMovements(1, movementsMeta.limit, initialFilters).catch(() => undefined); }}>Limpiar</button>
          </div>

          {movements.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No hay registros</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th><th>Tipo</th><th>Material</th><th>Cantidad</th><th>Ubicación</th><th>Documento</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={`${m.id}-${m.date}`}>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{new Date(m.date).toLocaleString("es-AR")}</td>
                      <td><span className={MOVE_BADGE[m.type] ?? "badge"}>{MOVE_LABEL[m.type] ?? m.type}</span></td>
                      <td><strong>{m.material.code}</strong> · {m.material.description}</td>
                      <td>{m.quantity.toLocaleString("es-AR")}</td>
                      <td style={{ fontSize: 12 }}>
                        {m.type === "TRANSFER"
                          ? `${m.from?.locationCode ?? "-"} → ${m.to?.locationCode ?? "-"}`
                          : `${m.warehouse?.name ?? "-"} / ${m.location?.code ?? "-"}`}
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{m.documentNumber || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                <button className="btn" disabled={loading || movementsMeta.page <= 1} onClick={() => loadMovements(movementsMeta.page - 1, movementsMeta.limit, appliedFilters)}>
                  Anterior
                </button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  Página {movementsMeta.page} de {movementsMeta.totalPages}
                  {" · "}{movementsMeta.total} registros
                </span>
                <button className="btn" disabled={loading || movementsMeta.page >= movementsMeta.totalPages} onClick={() => loadMovements(movementsMeta.page + 1, movementsMeta.limit, appliedFilters)}>
                  Siguiente
                </button>
                <select className="input" value={movementsMeta.limit} onChange={(e) => loadMovements(1, Number(e.target.value), appliedFilters)}>
                  <option value={10}>10 / pág.</option>
                  <option value={20}>20 / pág.</option>
                  <option value={50}>50 / pág.</option>
                </select>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Tab: Control diario ── */}
      {activeTab === "diario" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Control diario de stock</h3>
            <input
              className="input"
              type="date"
              value={dailyDate}
              onChange={async (e) => {
                const v = e.target.value;
                setDailyDate(v);
                setLoading(true);
                try { await loadDaily(v); }
                catch (err) { setError(getFriendlyApiError(err)); }
                finally { setLoading(false); }
              }}
            />
          </div>
          {dailyStock.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Sin registros para la fecha seleccionada.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Material</th><th>Stock inicial</th><th>Entradas</th>
                  <th>Salidas</th><th>Stock final</th><th>SAP</th><th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {dailyStock.map((row) => (
                  <tr key={`${row.date}-${row.material.id}`}>
                    <td><strong>{row.material.code}</strong> · {row.material.description}</td>
                    <td>{row.stockInicial.toLocaleString("es-AR")}</td>
                    <td style={{ color: "#16a34a", fontWeight: 600 }}>{row.entradas > 0 ? `+${row.entradas.toLocaleString("es-AR")}` : row.entradas}</td>
                    <td style={{ color: "#dc2626", fontWeight: 600 }}>{row.salidas > 0 ? `-${row.salidas.toLocaleString("es-AR")}` : row.salidas}</td>
                    <td style={{ fontWeight: 700 }}>{row.stockFinal.toLocaleString("es-AR")}</td>
                    <td>{row.stockSAP}</td>
                    <td>
                      <span className={row.diferencia === 0 ? "badge" : row.diferencia > 0 ? "badge badge--entry" : "badge badge--exit"}>
                        {row.diferencia === 0 ? "✓" : row.diferencia > 0 ? `+${row.diferencia}` : row.diferencia}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Tab: SAP ── */}
      {activeTab === "sap" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <section className="card">
            <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Cargar stock SAP</h3>
            <form onSubmit={handleSaveSapStock} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                <input className="input" type="date" value={sapForm.date} onChange={(e) => setSapForm((p) => ({ ...p, date: e.target.value }))} />
                <select className="input" value={sapForm.productId} onChange={(e) => setSapForm((p) => ({ ...p, productId: e.target.value }))}>
                  <option value="">Seleccionar material</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
                </select>
                <select className="input" value={sapForm.warehouseId} onChange={(e) => setSapForm((p) => ({ ...p, warehouseId: e.target.value }))}>
                  <option value="">Depósito (opcional)</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <input className="input" type="number" min={0} placeholder="Cantidad SAP" value={sapForm.sapQuantity} onChange={(e) => setSapForm((p) => ({ ...p, sapQuantity: e.target.value }))} />
              </div>
              {sapError && <p style={{ color: "#dc2626", margin: 0, fontSize: 13 }}>{sapError}</p>}
              <div><button className="btn btn--primary" type="submit">Guardar stock SAP</button></div>
            </form>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Diferencias contra SAP</h3>
            {differencesSap.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>Sin diferencias para la fecha seleccionada.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Material</th><th>Sistema</th><th>SAP</th><th>Diferencia</th></tr>
                </thead>
                <tbody>
                  {differencesSap.map((row) => (
                    <tr key={`diff-${row.date}-${row.material.id}`}>
                      <td><strong>{row.material.code}</strong> · {row.material.description}</td>
                      <td>{row.stockFinal.toLocaleString("es-AR")}</td>
                      <td>{row.stockSAP}</td>
                      <td>
                        <span className={row.diferencia > 0 ? "badge badge--adj-out" : "badge badge--exit"}>
                          {row.diferencia > 0 ? `+${row.diferencia}` : row.diferencia}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* ── Tab: Trazabilidad ── */}
      {activeTab === "trazabilidad" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Trazabilidad por material</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <select
              className="input"
              value={traceMaterialId}
              onChange={(e) => setTraceMaterialId(e.target.value)}
              style={{ minWidth: 320 }}
            >
              <option value="">Seleccionar material...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
            </select>
            <button className="btn btn--primary" onClick={handleTraceSearch}>Buscar trazabilidad</button>
          </div>

          {traceError && <p style={{ color: "#dc2626", fontSize: 13 }}>{traceError}</p>}
          {!traceResult && !traceError && (
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>Seleccioná un material para ver su historial completo de movimientos.</p>
          )}
          {traceResult && traceResult.history.length === 0 && (
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>Sin registros para este material.</p>
          )}
          {traceResult && traceResult.history.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {traceResult.history.map((event) => (
                <div
                  key={event.movementId}
                  style={{
                    borderLeft: `3px solid ${event.type === "ENTRY" ? "#16a34a" : event.type === "EXIT" ? "#dc2626" : event.type === "TRANSFER" ? "#2563eb" : "#94a3b8"}`,
                    paddingLeft: 14,
                    paddingTop: 4,
                    paddingBottom: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className={MOVE_BADGE[event.type] ?? "badge"}>
                      {MOVE_LABEL[event.type] ?? event.type}
                    </span>
                    <strong>{event.quantity.toLocaleString("es-AR")}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {new Date(event.at).toLocaleString("es-AR")}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                    {event.documentNumber && <span>Doc: <strong style={{ color: "var(--text)" }}>{event.documentNumber}</strong></span>}
                    <span>Origen: {event.fromWarehouseName || event.warehouseName || "-"} / {event.fromLocationCode || "-"}</span>
                    <span>Destino: {event.toWarehouseName || event.destination || event.warehouseName || "-"} / {event.toLocationCode || event.locationCode || "-"}</span>
                    {event.notes && <span>Notas: {event.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
