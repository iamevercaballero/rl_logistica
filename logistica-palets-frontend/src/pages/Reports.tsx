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
import { getMovements, regularizeMovement, type Movement } from "../api/movements";
import { listLots, type Lot } from "../api/lots";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { listProducts, type Product } from "../api/products";
import { getFriendlyApiError } from "../utils/apiError";

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste entrada",
  ADJUSTMENT_OUT: "Ajuste salida",
};

const MOVE_BADGE: Record<string, string> = {
  ENTRY: "badge badge--entry",
  EXIT: "badge badge--exit",
  TRANSFER: "badge badge--transfer",
  ADJUSTMENT_IN: "badge badge--adj-in",
  ADJUSTMENT_OUT: "badge badge--adj-out",
};

const BAR_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];

type Tab = "stock" | "movimientos" | "lotes" | "pendientes" | "diario" | "sap" | "trazabilidad";

type MovementFilters = {
  warehouseId: string;
  productId: string;
  type: "" | "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  dateFrom: string;
  dateTo: string;
  search: string;
};

const initialFilters: MovementFilters = {
  warehouseId: "", productId: "", type: "", dateFrom: "", dateTo: "", search: "",
};

type RegPayload = {
  reason: string;
  documentNumber: string;
  supplier: string;
  carrier: string;
  driver: string;
  destination: string;
  notes: string;
  sapLot: string;
  fechaVencimiento: string;
  fechaFabricacion: string;
  proveedor: string;
};

const emptyReg: RegPayload = {
  reason: "", documentNumber: "", supplier: "", carrier: "",
  driver: "", destination: "", notes: "", sapLot: "",
  fechaVencimiento: "", fechaFabricacion: "", proveedor: "",
};

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<Tab>("stock");

  // Shared catalog data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Stock tab
  const [stock, setStock] = useState<StockReportResponse | null>(null);
  const [stockWarehouseId, setStockWarehouseId] = useState("");

  // Historial tab
  const [movements, setMovements] = useState<ReportMovementRow[]>([]);
  const [movementsMeta, setMovementsMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState<MovementFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<MovementFilters>(initialFilters);

  // Lotes & SAP tab
  const [lotSapSearch, setLotSapSearch] = useState("");
  const [lotProductSearch, setLotProductSearch] = useState("");
  const [lotResults, setLotResults] = useState<Lot[]>([]);
  const [lotLoaded, setLotLoaded] = useState(false);
  const [lotError, setLotError] = useState("");

  // Pendientes tab
  const [pendingMovements, setPendingMovements] = useState<Movement[]>([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [pendingError, setPendingError] = useState("");
  const [regModal, setRegModal] = useState<{ id: string; label: string } | null>(null);
  const [regForm, setRegForm] = useState<RegPayload>(emptyReg);
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Trace tab
  const [traceMaterialId, setTraceMaterialId] = useState("");
  const [traceResult, setTraceResult] = useState<TraceReportResponse | null>(null);
  const [traceError, setTraceError] = useState("");

  // Daily / SAP tabs
  const [dailyDate, setDailyDate] = useState(today);
  const [dailyStock, setDailyStock] = useState<DailyStockRow[]>([]);
  const [differencesSap, setDifferencesSap] = useState<DailyStockRow[]>([]);
  const [sapForm, setSapForm] = useState({ date: today, productId: "", warehouseId: "", sapQuantity: "" });
  const [sapError, setSapError] = useState("");

  // Global loading / error
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Data loaders ──────────────────────────────────────────────────────────

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

  const loadPending = useCallback(async () => {
    setPendingError("");
    try {
      const res = await getMovements({ status: "PENDING_REGULARIZATION", limit: 100 });
      setPendingMovements(res.data);
    } catch (err) {
      setPendingError(getFriendlyApiError(err));
    } finally {
      setPendingLoaded(true);
    }
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

  // Lazy-load pending regularizations on first visit to that tab
  useEffect(() => {
    if (activeTab === "pendientes" && !pendingLoaded) {
      loadPending().catch(() => undefined);
    }
  }, [activeTab, loadPending, pendingLoaded]);

  // ── Event handlers ────────────────────────────────────────────────────────

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

  async function handleLotSearch() {
    setLotError("");
    setLotLoaded(false);
    try {
      const results = await listLots(
        lotProductSearch || undefined,
        lotSapSearch.trim() || undefined,
      );
      setLotResults(results);
    } catch (err) {
      setLotError(getFriendlyApiError(err));
      setLotResults([]);
    } finally {
      setLotLoaded(true);
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

  async function handleRegularize() {
    if (!regModal) return;
    if (!regForm.reason.trim()) { setRegError("El motivo es obligatorio."); return; }
    setRegLoading(true);
    setRegError("");
    try {
      await regularizeMovement(regModal.id, {
        reason: regForm.reason,
        documentNumber: regForm.documentNumber || undefined,
        supplier: regForm.supplier || undefined,
        carrier: regForm.carrier || undefined,
        driver: regForm.driver || undefined,
        destination: regForm.destination || undefined,
        notes: regForm.notes || undefined,
        sapLot: regForm.sapLot || undefined,
        fechaVencimiento: regForm.fechaVencimiento || undefined,
        fechaFabricacion: regForm.fechaFabricacion || undefined,
        proveedor: regForm.proveedor || undefined,
      });
      setRegModal(null);
      setRegForm(emptyReg);
      setPendingLoaded(false);
      await loadPending();
    } catch (err) {
      setRegError(getFriendlyApiError(err));
    } finally {
      setRegLoading(false);
    }
  }

  // ── Computed values ───────────────────────────────────────────────────────

  const stockChartData = useMemo(
    () => (stock?.byWarehouse ?? []).map((row) => ({ name: row.warehouseName || "Sin depósito", quantity: row.quantity })),
    [stock],
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "stock",       label: "Stock actual" },
    { key: "movimientos", label: "Historial" },
    { key: "lotes",       label: "Lotes & SAP" },
    { key: "pendientes",  label: "Pendientes" },
    { key: "diario",      label: "Control diario" },
    { key: "sap",         label: "SAP" },
    { key: "trazabilidad",label: "Trazabilidad" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Reportes</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Stock real, trazabilidad, lotes SAP, pendientes de regularización y control diario.
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
            {t.key === "pendientes" && pendingMovements.length > 0 && (
              <span style={{ marginLeft: 6, background: "#d97706", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>
                {pendingMovements.length}
              </span>
            )}
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
            </select>
            <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
            <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
            <input className="input" placeholder="Buscar" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} style={{ minWidth: 200 }} />
            <button className="btn btn--primary" onClick={handleApplyMovements}>Buscar</button>
            <button className="btn" onClick={() => {
              setFilters(initialFilters);
              setAppliedFilters(initialFilters);
              loadMovements(1, movementsMeta.limit, initialFilters).catch(() => undefined);
            }}>Limpiar</button>
          </div>

          {movements.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No hay registros</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th><th>Tipo</th><th>Material</th><th>Cantidad</th>
                    <th>Ubicación</th><th>Documento</th><th>Proveedor</th>
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
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{m.documentNumber ?? "-"}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{m.supplier ?? "-"}</td>
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

      {/* ── Tab: Lotes & SAP ── */}
      {activeTab === "lotes" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Consulta de lotes por código SAP</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
            Buscá lotes por su código SAP (ej. <code>Z051308201</code>) o filtrá por material.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input
              className="input"
              placeholder="Lote SAP (ej. Z051308201)"
              value={lotSapSearch}
              onChange={(e) => setLotSapSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLotSearch()}
              style={{ minWidth: 220, fontFamily: "monospace" }}
            />
            <select
              className="input"
              value={lotProductSearch}
              onChange={(e) => setLotProductSearch(e.target.value)}
            >
              <option value="">Todos los materiales</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
            </select>
            <button className="btn btn--primary" onClick={handleLotSearch}>Buscar</button>
            <button className="btn" onClick={() => {
              setLotSapSearch("");
              setLotProductSearch("");
              setLotResults([]);
              setLotLoaded(false);
              setLotError("");
            }}>Limpiar</button>
          </div>

          {lotError && <p style={{ color: "#dc2626", fontSize: 13 }}>{lotError}</p>}
          {!lotLoaded && !lotError && (
            <p style={{ color: "var(--muted)" }}>Ingresá un lote SAP o seleccioná un material y presioná Buscar.</p>
          )}
          {lotLoaded && lotResults.length === 0 && !lotError && (
            <p style={{ color: "var(--muted)" }}>No se encontraron lotes con esos criterios.</p>
          )}
          {lotResults.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Código lote</th>
                  <th>Lote SAP</th>
                  <th>Material</th>
                  <th>Vencimiento</th>
                  <th>Fabricación</th>
                  <th>Proveedor lote</th>
                  <th>Stock</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lotResults.map((lot) => (
                  <tr key={lot.id} style={lot.status === "PENDING_REGULARIZATION" ? { background: "rgba(217,119,6,0.06)" } : {}}>
                    <td><strong>{lot.lotCode}</strong></td>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{lot.sapLot ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>
                      {lot.product
                        ? <><strong>{lot.product.code}</strong> · {lot.product.description}</>
                        : <span style={{ color: "var(--muted)", fontSize: 12 }}>{lot.productId}</span>}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {lot.fechaVencimiento ? new Date(lot.fechaVencimiento).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {lot.fechaFabricacion ? new Date(lot.fechaFabricacion).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>{lot.proveedor ?? "—"}</td>
                    <td><strong>{lot.stockActual.toLocaleString("es-AR")}</strong></td>
                    <td>
                      {lot.status === "PENDING_REGULARIZATION"
                        ? <span className="badge badge--adj-out">Pendiente</span>
                        : <span className="badge">Normal</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Tab: Pendientes de regularización ── */}
      {activeTab === "pendientes" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Pendientes de regularización</h3>
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2, marginBottom: 0 }}>
                Movimientos provisionales que requieren datos definitivos antes de cerrar.
              </p>
            </div>
            <button className="btn" onClick={() => { setPendingLoaded(false); loadPending().catch(() => undefined); }}>
              Actualizar
            </button>
          </div>

          {pendingError && <p style={{ color: "#dc2626", fontSize: 13 }}>{pendingError}</p>}

          {!pendingLoaded && !pendingError && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando...</p>
          )}

          {pendingLoaded && pendingMovements.length === 0 && !pendingError && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <p style={{ margin: 0, fontSize: 14 }}>No hay movimientos pendientes de regularización.</p>
            </div>
          )}

          {pendingMovements.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Tipo</th><th>Material</th><th>Cantidad</th>
                  <th>Documento</th><th>Proveedor</th><th>Notas</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pendingMovements.map((m) => (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                      {new Date(m.date).toLocaleString("es-AR")}
                    </td>
                    <td><span className={MOVE_BADGE[m.type] ?? "badge"}>{MOVE_LABEL[m.type] ?? m.type}</span></td>
                    <td><strong>{m.material.code}</strong> · {m.material.description}</td>
                    <td>{m.quantity.toLocaleString("es-AR")}</td>
                    <td style={{ fontSize: 12, color: m.documentNumber ? "inherit" : "var(--muted)" }}>
                      {m.documentNumber ?? "—"}
                    </td>
                    <td style={{ fontSize: 12, color: m.supplier ? "inherit" : "var(--muted)" }}>
                      {m.supplier ?? "—"}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.notes ?? "—"}
                    </td>
                    <td>
                      <button
                        className="btn btn--primary"
                        style={{ fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" }}
                        onClick={() => {
                          setRegModal({
                            id: m.id,
                            label: `${m.material.code} · ${new Date(m.date).toLocaleDateString("es-AR")}`,
                          });
                          setRegForm(emptyReg);
                          setRegError("");
                        }}
                      >
                        Regularizar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* ── Regularization modal ── */}
      {regModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget && !regLoading) { setRegModal(null); setRegForm(emptyReg); setRegError(""); } }}
        >
          <div style={{ background: "var(--panel)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
            <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Regularizar movimiento</h3>
            <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 20 }}>{regModal.label}</p>

            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#92400e" }}>
              Solo se registran los campos que se modifiquen. Cada cambio queda en el log de auditoría.
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
                  Motivo de regularización <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Describir el motivo del cambio..."
                  value={regForm.reason}
                  onChange={(e) => setRegForm((p) => ({ ...p, reason: e.target.value }))}
                  style={{ resize: "vertical" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Nro. documento</label>
                  <input className="input" placeholder="Nro. documento" value={regForm.documentNumber} onChange={(e) => setRegForm((p) => ({ ...p, documentNumber: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Proveedor</label>
                  <input className="input" placeholder="Proveedor" value={regForm.supplier} onChange={(e) => setRegForm((p) => ({ ...p, supplier: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Transportista</label>
                  <input className="input" placeholder="Transportista" value={regForm.carrier} onChange={(e) => setRegForm((p) => ({ ...p, carrier: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Conductor</label>
                  <input className="input" placeholder="Conductor" value={regForm.driver} onChange={(e) => setRegForm((p) => ({ ...p, driver: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Destino</label>
                  <input className="input" placeholder="Destino" value={regForm.destination} onChange={(e) => setRegForm((p) => ({ ...p, destination: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Lote SAP</label>
                  <input className="input" placeholder="ej. Z051308201" value={regForm.sapLot} onChange={(e) => setRegForm((p) => ({ ...p, sapLot: e.target.value }))} style={{ fontFamily: "monospace" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Fecha vencimiento</label>
                  <input className="input" type="date" value={regForm.fechaVencimiento} onChange={(e) => setRegForm((p) => ({ ...p, fechaVencimiento: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Fecha fabricación</label>
                  <input className="input" type="date" value={regForm.fechaFabricacion} onChange={(e) => setRegForm((p) => ({ ...p, fechaFabricacion: e.target.value }))} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Proveedor del lote</label>
                <input className="input" placeholder="Proveedor del lote" value={regForm.proveedor} onChange={(e) => setRegForm((p) => ({ ...p, proveedor: e.target.value }))} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Notas adicionales</label>
                <textarea className="input" rows={2} placeholder="Observaciones..." value={regForm.notes} onChange={(e) => setRegForm((p) => ({ ...p, notes: e.target.value }))} style={{ resize: "vertical" }} />
              </div>
            </div>

            {regError && (
              <p style={{ color: "#dc2626", fontSize: 13, marginTop: 10, marginBottom: 0 }}>{regError}</p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button className="btn btn--primary" onClick={handleRegularize} disabled={regLoading}>
                {regLoading ? "Guardando..." : "Confirmar regularización"}
              </button>
              <button
                className="btn"
                onClick={() => { setRegModal(null); setRegForm(emptyReg); setRegError(""); }}
                disabled={regLoading}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
