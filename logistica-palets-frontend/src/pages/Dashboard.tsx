import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import {
  getKpis,
  getMovementsReport,
  getStockReport,
  type KpisResponse,
  type ReportMovementRow,
  type ReportRange,
} from "../api/reports";
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

const BAR_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2", "#ea580c", "#16a34a"];

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Ahora mismo";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH} h`;
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

type DashboardState = {
  kpis: KpisResponse | null;
  moves: ReportMovementRow[];
  warehouses: Warehouse[];
};

const KPI_CONFIGS = [
  {
    key: "totalMaterials" as const,
    label: "Materiales con stock",
    color: "#2563eb",
    bg: "#eff6ff",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      </svg>
    ),
  },
  {
    key: "totalQuantity" as const,
    label: "Unidades en stock",
    color: "#7c3aed",
    bg: "#f5f3ff",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="6" height="6" /><rect x="9" y="3" width="6" height="6" />
        <rect x="16" y="3" width="6" height="6" /><rect x="2" y="12" width="6" height="6" />
        <rect x="9" y="12" width="6" height="6" /><rect x="16" y="12" width="6" height="6" />
      </svg>
    ),
  },
  {
    key: "movementsInRange" as const,
    label: "Movimientos del período",
    color: "#059669",
    bg: "#f0fdf4",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 16V4m0 0L3 8m4-4l4 4" /><path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
];

export default function DashboardPage() {
  const [range, setRange] = useState<ReportRange>("today");
  const [warehouseId, setWarehouseId] = useState("");
  const [state, setState] = useState<DashboardState>({ kpis: null, moves: [], warehouses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async (currentRange: ReportRange, currentWarehouseId: string) => {
    setLoading(true);
    setError("");

    try {
      const [warehouses, kpis, movements, stock] = await Promise.all([
        listWarehouses().catch(() => []),
        getKpis(currentRange),
        getMovementsReport({ limit: 10 }),
        getStockReport(currentWarehouseId || undefined),
      ]);

      setState({
        warehouses,
        moves: movements.data.slice(0, 10),
        kpis: { ...kpis, stockByWarehouse: stock.byWarehouse },
      });
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(range, warehouseId).catch(() => undefined);
  }, [loadDashboard, range, warehouseId]);

  const chartData = useMemo(
    () => (state.kpis?.stockByWarehouse ?? []).map((item) => ({
      name: item.warehouseName || "Sin depósito",
      quantity: Number(item.quantity) || 0,
    })),
    [state.kpis],
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Dashboard</h1>
          <p style={{ color: "var(--muted)", marginBottom: 0, fontSize: 14 }}>
            Resumen operativo en tiempo real
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select className="input" value={range} onChange={(e) => setRange(e.target.value as ReportRange)}>
            <option value="today">Hoy</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mes</option>
          </select>
          <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Todos los depósitos</option>
            {state.warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card" style={{ height: 110, background: "var(--panel)", opacity: 0.6 }} />
          ))}
        </div>
      )}

      {error && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 12, padding: "14px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 600 }}>No se pudo cargar el dashboard.</span>
          <button className="btn btn--primary" onClick={() => loadDashboard(range, warehouseId)}>Reintentar</button>
        </div>
      )}

      {!loading && !error && state.kpis && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}>
            {KPI_CONFIGS.map((cfg) => (
              <div key={cfg.key} className="card">
                <div className="kpi-icon" style={{ background: cfg.bg, color: cfg.color }}>
                  {cfg.icon}
                </div>
                <div className="kpi-label">{cfg.label}</div>
                <div className="kpi-value" style={{ color: cfg.color }}>
                  {(state.kpis![cfg.key] ?? 0).toLocaleString("es-AR")}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
            <section className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 800 }}>Stock por depósito</h3>
              {chartData.length === 0 ? (
                <p style={{ color: "var(--muted)", marginBottom: 0 }}>Sin datos para mostrar</p>
              ) : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} barSize={32}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }}
                        formatter={(value: number | undefined) => [(value ?? 0).toLocaleString("es-AR"), "Cantidad"]}
                      />
                      <Bar dataKey="quantity" radius={[6, 6, 0, 0]}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 800 }}>Últimos movimientos</h3>
              {state.moves.length === 0 ? (
                <p style={{ color: "var(--muted)", marginBottom: 0 }}>No hay registros</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {state.moves.map((m) => (
                    <div key={`${m.id}-${m.date}`} style={{ borderRadius: 10, padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span className={MOVE_BADGE[m.type] ?? "badge"}>
                          {MOVE_LABEL[m.type] ?? m.type}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 600 }}>
                          {formatRelativeDate(m.date)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        <strong style={{ color: "var(--text)" }}>{m.material.code}</strong>
                        {" · "}{m.material.description}
                        {" · "}<strong>{m.quantity.toLocaleString("es-AR")}</strong>
                        {m.documentNumber ? ` · Doc: ${m.documentNumber}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
