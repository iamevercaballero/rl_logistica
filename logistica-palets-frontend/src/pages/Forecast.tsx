import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getForecast, type ForecastRow, type MlModelType } from "../api/forecast";
import { fmtDateShort } from "../utils/dateFormat";

/* ── Constants ────────────────────────────────────────────────────────────── */
const STATUS_COLOR: Record<string, string> = {
  CRITICAL: "var(--danger)",
  LOW: "var(--warning)",
  WARNING: "rgba(245,158,11,0.85)",
  OK: "var(--success)",
  NO_DATA: "var(--muted)",
};

const STATUS_BG: Record<string, string> = {
  CRITICAL: "rgba(239,68,68,0.08)",
  LOW: "rgba(245,158,11,0.08)",
  WARNING: "rgba(245,158,11,0.04)",
  OK: "rgba(16,185,129,0.06)",
  NO_DATA: "transparent",
};

const STATUS_LABEL: Record<string, string> = {
  CRITICAL: "Crítico",
  LOW: "Stock bajo",
  WARNING: "Alerta",
  OK: "Normal",
  NO_DATA: "Sin datos",
};

const MODEL_LABEL: Record<MlModelType, string> = {
  "holt-winters": "Holt-Winters (estacional)",
  "holt-trend":   "Holt-Winters (tendencia)",
  "ses":          "Suavizado exponencial simple",
  "mean_fallback":"Promedio (fallback)",
  "fallback":     "Estadístico",
  "no_data":      "Sin datos suficientes",
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function statusOrder(s: string) {
  return { CRITICAL: 0, LOW: 1, WARNING: 2, OK: 3, NO_DATA: 4 }[s] ?? 5;
}

/* ── Status badge ─────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
      color: STATUS_COLOR[status] ?? "var(--muted)",
      background: STATUS_BG[status] ?? "transparent",
      border: `1px solid ${STATUS_COLOR[status] ?? "var(--border)"}30`,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/* ── Model info ───────────────────────────────────────────────────────────── */
function ModelInfo({ row }: { row: ForecastRow }) {
  const isML = row.forecastType === "ML";
  return (
    <span
      title={`Tipo: ${row.forecastType}${row.mlModel ? ` · Modelo: ${MODEL_LABEL[row.mlModel]}` : ""}${row.mlMae !== null ? ` · MAE: ${row.mlMae}` : ""}${row.mlDataPoints !== null ? ` · ${row.mlDataPoints} días de datos` : ""}`}
      style={{
        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
        color: isML ? "var(--primary)" : "var(--muted)",
        background: isML ? "rgba(99,102,241,0.10)" : "rgba(107,114,128,0.08)",
        border: `1px solid ${isML ? "rgba(99,102,241,0.3)" : "rgba(107,114,128,0.2)"}`,
        cursor: "help",
      }}
    >
      {isML ? `ML · ${row.mlModel?.toUpperCase().replace("-", " ")}` : "ESTADÍSTICO"}
    </span>
  );
}

/* ── Chart tooltip ────────────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--muted)" }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          <span style={{ color: "var(--text)" }}>{p.name}: <strong>{typeof p.value === "number" ? p.value.toLocaleString("es-PY") : p.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

/* ── Product detail panel ─────────────────────────────────────────────────── */
function ProductDetail({ row }: { row: ForecastRow }) {
  const hasCi = row.forecast.some((d) => d.lower !== null);

  // Build chart data: combine historical "today" stock + forecast days
  const chartData = row.forecast.map((d) => ({
    date: fmtDateShort(d.date),
    stock: d.projectedStock,
    demand: d.demand,
    lower: d.lower ?? undefined,
    upper: d.upper ?? undefined,
  }));

  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-dim)" }}>
      {/* Meta row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>STOCK ACTUAL</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{row.currentStock.toLocaleString("es-PY")}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>CONSUMO/DÍA</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{row.avgDailyConsumption.toFixed(1)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>DÍAS DE STOCK</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: STATUS_COLOR[row.status] }}>
            {row.daysOfStock !== null ? row.daysOfStock : "∞"}
          </div>
        </div>
        {row.projectedStockout && (
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>STOCKOUT PROYECTADO</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: STATUS_COLOR[row.status] }}>
              {new Date(row.projectedStockout + "T00:00:00").toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
        )}
        {row.mlMae !== null && (
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>MAE MODELO</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{row.mlMae.toFixed(1)}</div>
          </div>
        )}
        {row.mlDataPoints !== null && (
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>DÍAS ENTRENAMIENTO</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{row.mlDataPoints}</div>
          </div>
        )}
      </div>

      {/* Forecast chart */}
      {chartData.length > 0 && (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
                {hasCi && (
                  <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--info)" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="var(--info)" stopOpacity={0.04} />
                  </linearGradient>
                )}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} />

              {/* Confidence band (ML only) */}
              {hasCi && (
                <>
                  <Area
                    type="monotone"
                    dataKey="upper"
                    name="Límite sup. (80%)"
                    stroke="var(--info)"
                    strokeWidth={0}
                    fill="url(#ciGrad)"
                    legendType="none"
                    dot={false}
                    activeDot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="lower"
                    name="Límite inf. (80%)"
                    stroke="var(--info)"
                    strokeWidth={0}
                    fill="var(--bg)"
                    legendType="none"
                    dot={false}
                    activeDot={false}
                  />
                </>
              )}

              {/* Projected stock */}
              <Area
                type="monotone"
                dataKey="stock"
                name="Stock proyectado"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#stockGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Model label */}
      {row.mlModel && (
        <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "right", marginTop: 4 }}>
          Modelo: {MODEL_LABEL[row.mlModel] ?? row.mlModel}
          {hasCi && " · Banda de confianza 80%"}
        </div>
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function ForecastPage() {
  const [lookbackDays, setLookbackDays] = useState(60);
  const [horizonDays, setHorizonDays] = useState(14);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const forecastQ = useQuery({
    queryKey: ["forecast", "full", lookbackDays, horizonDays],
    queryFn: () => getForecast({ lookbackDays, horizonDays }),
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const rows = forecastQ.data ?? [];

  const mlCount = rows.filter((r) => r.forecastType === "ML").length;
  const statCount = rows.length - mlCount;

  const filtered = rows
    .filter((r) => !statusFilter || r.status === statusFilter)
    .filter((r) =>
      !search.trim() ||
      r.product.code.toLowerCase().includes(search.toLowerCase()) ||
      r.product.description.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => statusOrder(a.status) - statusOrder(b.status));

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, margin: 0, marginBottom: 4 }}>
            Forecast de Demanda
          </h1>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
            Proyección de stock por producto · Holt-Winters Exponential Smoothing
          </p>
        </div>

        {/* Model summary chips */}
        {!forecastQ.isLoading && rows.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: "var(--primary)", background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.3)" }}>
              ML activo: {mlCount}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: "var(--muted)", background: "rgba(107,114,128,0.08)", border: "1px solid rgba(107,114,128,0.2)" }}>
              Estadístico: {statCount}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="form-field" style={{ margin: 0, minWidth: 220 }}>
            <label className="form-label">Buscar material</label>
            <input className="input" placeholder="Código o descripción..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 150 }}>
            <label className="form-label">Estado</label>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="CRITICAL">Crítico</option>
              <option value="LOW">Stock bajo</option>
              <option value="WARNING">Alerta</option>
              <option value="OK">Normal</option>
              <option value="NO_DATA">Sin datos</option>
            </select>
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 150 }}>
            <label className="form-label">Historial (días)</label>
            <select className="input" value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))}>
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 150 }}>
            <label className="form-label">Horizonte (días)</label>
            <select className="input" value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value))}>
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={30}>30 días</option>
            </select>
          </div>
          <button className="btn" onClick={() => forecastQ.refetch()} disabled={forecastQ.isFetching}>
            {forecastQ.isFetching ? "Calculando..." : "↻ Recalcular"}
          </button>
        </div>
      </div>

      {/* Status summary */}
      {!forecastQ.isLoading && rows.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {(["CRITICAL", "LOW", "WARNING", "OK", "NO_DATA"] as const).map((s) => {
            const count = rows.filter((r) => r.status === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
                style={{
                  fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                  color: STATUS_COLOR[s],
                  background: statusFilter === s ? STATUS_BG[s] : "transparent",
                  border: `1px solid ${STATUS_COLOR[s]}40`,
                  outline: "none",
                }}
              >
                {STATUS_LABEL[s]}: {count}
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      {forecastQ.isLoading ? (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
          Calculando forecast con modelo ML…
        </div>
      ) : forecastQ.isError ? (
        <div className="form-error" style={{ margin: 0 }}>Error al cargar el forecast.</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
          Sin materiales para los filtros seleccionados.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((row) => {
            const isExpanded = expanded === row.product.id;
            return (
              <div
                key={row.product.id}
                className="card"
                style={{
                  marginBottom: 0,
                  padding: 0,
                  overflow: "hidden",
                  borderColor: row.status === "CRITICAL" ? "rgba(239,68,68,0.4)" : undefined,
                }}
              >
                {/* Row header — click to expand */}
                <button
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                    background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
                  }}
                  onClick={() => setExpanded(isExpanded ? null : row.product.id)}
                  aria-expanded={isExpanded}
                >
                  {/* Status strip */}
                  <div style={{ width: 3, height: 40, background: STATUS_COLOR[row.status], borderRadius: 2, flexShrink: 0 }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{row.product.code}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{row.product.description}</span>
                      <StatusBadge status={row.status} />
                      <ModelInfo row={row} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      Stock actual: <strong style={{ color: "var(--text-variant)" }}>{row.currentStock.toLocaleString("es-PY")}</strong>
                      {" · "}
                      Consumo: <strong style={{ color: "var(--text-variant)" }}>{row.avgDailyConsumption.toFixed(1)}/d</strong>
                      {row.projectedStockout && (
                        <> · Stockout: <strong style={{ color: STATUS_COLOR[row.status] }}>
                          {new Date(row.projectedStockout + "T00:00:00").toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                        </strong></>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 22, fontWeight: 900, color: STATUS_COLOR[row.status], lineHeight: 1 }}>
                        {row.daysOfStock !== null ? `${row.daysOfStock}d` : "∞"}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>cobertura</div>
                    </div>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="var(--muted)" strokeWidth="2"
                      style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && <ProductDetail row={row} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
