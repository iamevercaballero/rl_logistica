import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { listWarehouses } from "../api/warehouses";
import { fefoLots } from "../api/lots";
import {
  getKpis,
  getMovementsReport,
  getStockReport,
  type ReportRange,
} from "../api/reports";

/* ── Constants ────────────────────────────────────────────────────────────── */
const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste +",
  ADJUSTMENT_OUT: "Ajuste -",
};

const MOVE_BADGE: Record<string, string> = {
  ENTRY: "badge badge--entry",
  EXIT: "badge badge--exit",
  TRANSFER: "badge badge--transfer",
  ADJUSTMENT_IN: "badge badge--adjin",
  ADJUSTMENT_OUT: "badge badge--adjout",
};

const BAR_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Ahora mismo";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH} h`;
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function expiryColor(days: number): string {
  if (days <= 15) return "var(--danger)";
  if (days <= 45) return "var(--warning)";
  return "var(--success)";
}

function expiryBg(days: number): string {
  if (days <= 15) return "rgba(239,68,68,0.08)";
  if (days <= 45) return "rgba(245,158,11,0.08)";
  return "rgba(16,185,129,0.08)";
}

function expiryBorder(days: number): string {
  if (days <= 15) return "rgba(239,68,68,0.25)";
  if (days <= 45) return "rgba(245,158,11,0.25)";
  return "rgba(16,185,129,0.25)";
}

/* ── TrendBadge ───────────────────────────────────────────────────────────── */
function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const positive = delta >= 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 700,
        color: positive ? "var(--success)" : "var(--danger)",
        background: positive ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
        border: `1px solid ${positive ? "rgba(16,185,129,0.28)" : "rgba(239,68,68,0.28)"}`,
        borderRadius: 999,
        padding: "2px 7px",
      }}
      aria-label={`${positive ? "+" : ""}${delta}% respecto al período anterior`}
    >
      {positive ? "▲" : "▼"} {Math.abs(delta)}%
    </span>
  );
}

/* ── KPI card ─────────────────────────────────────────────────────────────── */
interface KpiCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  delta?: number | null;
  accentColor?: string;
  subtitle?: string;
  alert?: boolean;
}

function KpiCard({ label, value, icon, delta, accentColor = "var(--primary)", subtitle, alert }: KpiCardProps) {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        overflow: "hidden",
        marginBottom: 0,
        borderColor: alert ? "rgba(239,68,68,0.4)" : undefined,
      }}
    >
      {/* Accent strip */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 3,
          height: "100%",
          background: accentColor,
          borderRadius: "8px 0 0 8px",
        }}
      />
      <div style={{ paddingLeft: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}30`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: accentColor,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          {delta !== undefined && <TrendBadge delta={delta} />}
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -1, color: "var(--text)", lineHeight: 1 }}>
          {typeof value === "number" ? value.toLocaleString("es-AR") : value}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}

/* ── Skeleton KPI card ────────────────────────────────────────────────────── */
function KpiCardSkeleton() {
  return (
    <div className="card" style={{ height: 128, marginBottom: 0 }}>
      <div style={{ background: "var(--panel-hi)", height: 14, width: "60%", borderRadius: 4, marginBottom: 12, animation: "dt-shimmer 1.4s ease infinite" }} />
      <div style={{ background: "var(--panel-hi)", height: 32, width: "40%", borderRadius: 4, animation: "dt-shimmer 1.4s ease infinite" }} />
    </div>
  );
}

/* ── Entries vs exits line chart data builder ─────────────────────────────── */
function buildTimeSeriesData(movements: ReturnType<typeof Array.prototype.slice>) {
  const map = new Map<string, { date: string; entradas: number; salidas: number }>();

  for (const m of movements) {
    const dateKey = new Date(m.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
    const existing = map.get(dateKey) ?? { date: dateKey, entradas: 0, salidas: 0 };
    if (m.type === "ENTRY" || m.type === "ADJUSTMENT_IN") existing.entradas += m.quantity;
    if (m.type === "EXIT" || m.type === "ADJUSTMENT_OUT") existing.salidas += m.quantity;
    map.set(dateKey, existing);
  }

  return Array.from(map.values()).slice(-14); // last 14 data points
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const [range, setRange] = useState<ReportRange>("today");
  const [warehouseId, setWarehouseId] = useState("");

  const [warehousesQ, kpisQ, movementsQ, stockQ] = useQueries({
    queries: [
      { queryKey: ["warehouses"], queryFn: listWarehouses, staleTime: 5 * 60_000 },
      {
        queryKey: ["kpis", range],
        queryFn: () => getKpis(range),
        refetchInterval: 60_000,
      },
      {
        queryKey: ["movements", "report", { limit: 50 }],
        queryFn: () => getMovementsReport({ limit: 50 }),
        refetchInterval: 60_000,
      },
      {
        queryKey: ["stock", "report", warehouseId || "all"],
        queryFn: () => getStockReport(warehouseId || undefined),
        refetchInterval: 60_000,
      },
    ],
  });

  // Expiring lots (FEFO, no productId filter = all)
  const expiringQ = useQuery({
    queryKey: ["lots", "fefo", "expiring"],
    queryFn: () => fefoLots(),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const warehouses = warehousesQ.data ?? [];
  const kpis = kpisQ.data ?? null;
  const allMoves = movementsQ.data?.data ?? [];
  const recentMoves = allMoves.slice(0, 8);
  const stockByWarehouse = stockQ.data?.byWarehouse ?? [];

  // Expiring lots: filter to those with fechaVencimiento <= 60 days, with stock > 0
  const expiringLots = useMemo(() => {
    const lots = expiringQ.data ?? [];
    return lots
      .filter((l) => l.fechaVencimiento && l.stockActual > 0)
      .map((l) => ({ ...l, daysUntilExpiry: daysUntil(l.fechaVencimiento!) }))
      .filter((l) => l.daysUntilExpiry <= 60)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
      .slice(0, 12);
  }, [expiringQ.data]);

  const isLoading = kpisQ.isLoading;
  const isError = kpisQ.isError;

  const chartData = useMemo(
    () =>
      stockByWarehouse
        .filter((item) => item.warehouseName)
        .map((item) => ({
          name: item.warehouseName,
          quantity: Number(item.quantity) || 0,
        })),
    [stockByWarehouse],
  );

  const timeSeriesData = useMemo(() => buildTimeSeriesData(allMoves), [allMoves]);

  const rangeLabel: Record<ReportRange, string> = {
    today: "hoy",
    week: "últimos 7 días",
    month: "últimos 30 días",
  };

  function refetchAll() {
    void kpisQ.refetch();
    void movementsQ.refetch();
    void stockQ.refetch();
    void expiringQ.refetch();
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>
            Dashboard
          </h1>
          <p style={{ color: "var(--muted)", marginBottom: 0, fontSize: 14 }}>
            Resumen operativo · {rangeLabel[range]}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="input"
            value={range}
            onChange={(e) => setRange(e.target.value as ReportRange)}
            aria-label="Rango de fechas"
          >
            <option value="today">Hoy</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mes</option>
          </select>
          <select
            className="input"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            aria-label="Depósito"
          >
            <option value="">Todos los depósitos</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button
            className="btn"
            onClick={refetchAll}
            aria-label="Actualizar datos"
            title="Actualizar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error */}
      {isError && (
        <div
          className="form-error"
          role="alert"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}
        >
          <span style={{ fontWeight: 600 }}>No se pudo cargar el dashboard.</span>
          <button className="btn btn--primary" onClick={refetchAll}>Reintentar</button>
        </div>
      )}

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
        aria-busy={isLoading}
      >
        {isLoading ? (
          [0, 1, 2, 3, 4].map((i) => <KpiCardSkeleton key={i} />)
        ) : kpis ? (
          <>
            <KpiCard
              label="Materiales con stock"
              value={kpis.totalMaterials}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                </svg>
              }
              accentColor="var(--primary)"
            />

            <KpiCard
              label="Unidades en stock"
              value={kpis.totalQuantity}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="2" y="3" width="6" height="6" /><rect x="9" y="3" width="6" height="6" />
                  <rect x="16" y="3" width="6" height="6" /><rect x="2" y="12" width="6" height="6" />
                  <rect x="9" y="12" width="6" height="6" /><rect x="16" y="12" width="6" height="6" />
                </svg>
              }
              accentColor="var(--info)"
            />

            <KpiCard
              label="Movimientos"
              value={kpis.movementsInRange}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4" /><path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              }
              delta={kpis.movementsDelta}
              subtitle={`Período anterior: ${kpis.movementsPrev}`}
              accentColor="var(--success)"
            />

            <KpiCard
              label="Pend. regularización"
              value={kpis.pendingRegularizations}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              }
              accentColor={kpis.pendingRegularizations > 0 ? "var(--warning)" : "var(--success)"}
              alert={kpis.pendingRegularizations > 5}
            />

            <KpiCard
              label="Lotes a vencer (60d)"
              value={kpis.expiringLots}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
              accentColor={kpis.expiringCritical > 0 ? "var(--danger)" : kpis.expiringLots > 0 ? "var(--warning)" : "var(--success)"}
              subtitle={kpis.expiringCritical > 0 ? `${kpis.expiringCritical} críticos (≤15 días)` : undefined}
              alert={kpis.expiringCritical > 0}
            />
          </>
        ) : null}
      </div>

      {/* ── Charts + feed row ────────────────────────────────────────────── */}
      {!isLoading && kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 12, marginBottom: 12 }}>
          {/* Stock by warehouse */}
          <section className="card" aria-label="Stock por depósito" style={{ marginBottom: 0 }}>
            <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 700 }}>Stock por depósito</h3>
            {chartData.length === 0 ? (
              <p style={{ color: "var(--muted)", marginBottom: 0 }}>Sin datos</p>
            ) : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--text)",
                      }}
                      formatter={(value: number) => [value.toLocaleString("es-AR"), "Cantidad"]}
                    />
                    <Bar dataKey="quantity" radius={[5, 5, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Latest movements feed */}
          <section className="card" aria-label="Últimos movimientos" style={{ marginBottom: 0 }}>
            <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 700 }}>Últimos movimientos</h3>
            {recentMoves.length === 0 ? (
              <p style={{ color: "var(--muted)", marginBottom: 0 }}>No hay registros</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 240 }}>
                {recentMoves.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      borderRadius: 8,
                      background: "var(--bg)",
                      border: "1px solid var(--border-dim)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span className={MOVE_BADGE[m.type] ?? "badge"} style={{ flexShrink: 0 }}>
                        {MOVE_LABEL[m.type] ?? m.type}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <strong style={{ color: "var(--text)" }}>{m.material.code}</strong>
                        {" · "}{m.quantity.toLocaleString("es-AR")} u.
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                      {formatRelativeDate(m.date)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Entries vs Exits time series ─────────────────────────────────── */}
      {!isLoading && timeSeriesData.length > 1 && (
        <section className="card" aria-label="Entradas y salidas por día" style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 700 }}>Entradas vs. Salidas</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
                <Line
                  type="monotone"
                  dataKey="entradas"
                  name="Entradas"
                  stroke="var(--success)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="salidas"
                  name="Salidas"
                  stroke="var(--danger)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── Expiring lots panel ───────────────────────────────────────────── */}
      {!isLoading && expiringLots.length > 0 && (
        <section className="card" aria-label="Lotes próximos a vencer" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
              Lotes próximos a vencer
              {expiringLots.filter((l) => l.daysUntilExpiry <= 15).length > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    background: "rgba(239,68,68,0.12)",
                    color: "var(--danger)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    borderRadius: 999,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                  role="status"
                  aria-label={`${expiringLots.filter((l) => l.daysUntilExpiry <= 15).length} críticos`}
                >
                  {expiringLots.filter((l) => l.daysUntilExpiry <= 15).length} críticos
                </span>
              )}
            </h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Próximos 60 días con stock &gt; 0
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {expiringLots.map((lot) => (
              <div
                key={lot.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: expiryBg(lot.daysUntilExpiry),
                  border: `1px solid ${expiryBorder(lot.daysUntilExpiry)}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
                role="listitem"
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                    {lot.product?.code ?? "—"}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: expiryColor(lot.daysUntilExpiry),
                      background: "transparent",
                    }}
                    aria-label={`${lot.daysUntilExpiry} días hasta vencimiento`}
                  >
                    {lot.daysUntilExpiry === 0
                      ? "¡Vence hoy!"
                      : `${lot.daysUntilExpiry}d`}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {lot.product?.description}
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                  <span>Lote: <strong style={{ color: "var(--text-variant)" }}>{lot.lotCode}</strong></span>
                  <span>Stock: <strong style={{ color: "var(--text-variant)" }}>{lot.stockActual.toLocaleString("es-AR")}</strong></span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Vence: {new Date(lot.fechaVencimiento!).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
