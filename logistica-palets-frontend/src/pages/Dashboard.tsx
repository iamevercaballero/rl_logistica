import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

type DashboardState = {
  kpis: KpisResponse | null;
  moves: ReportMovementRow[];
  warehouses: Warehouse[];
};

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

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
        kpis: {
          ...kpis,
          stockByWarehouse: stock.byWarehouse,
        },
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
    () => (state.kpis?.stockByWarehouse ?? []).map((item) => ({ name: item.warehouseName, units: Number(item.units) || 0 })),
    [state.kpis],
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.4, marginBottom: 6 }}>Dashboard</h1>
          <p style={{ color: "#6b7280", marginBottom: 0 }}>Resumen operativo para pruebas y seguimiento diario.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" value={range} onChange={(event) => setRange(event.target.value as ReportRange)}>
            <option value="today">Hoy</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
          <select className="input" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Todos los depósitos</option>
            {state.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? <p style={{ marginTop: 16 }}>Cargando...</p> : null}
      {error ? (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={() => loadDashboard(range, warehouseId)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {!loading && !error && state.kpis ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 16 }}>
            {[
              { label: "Palets en stock", value: state.kpis.totalPallets },
              { label: "Unidades en stock", value: state.kpis.totalUnits },
              { label: "Movimientos del rango", value: state.kpis.movementsInRange },
            ].map((card) => (
              <div key={card.label} className="card">
                <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 700 }}>{card.label}</div>
                <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -0.5, marginTop: 6 }}>{card.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, marginTop: 12 }}>
            <section className="card">
              <h3 style={{ marginBottom: 12 }}>Stock por depósito</h3>
              {chartData.length === 0 ? (
                <p style={{ marginBottom: 0 }}>No hay registros</p>
              ) : (
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="units" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="card">
              <h3 style={{ marginBottom: 12 }}>Últimos movimientos</h3>
              {state.moves.length === 0 ? (
                <p style={{ marginBottom: 0 }}>No hay registros</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {state.moves.map((movement) => (
                    <div key={`${movement.id}-${movement.createdAt}-${movement.palletId ?? ""}`} style={{ border: "1px solid #f1f5f9", borderRadius: 12, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <strong>{movement.type}</strong>
                        <span style={{ color: "#6b7280", fontSize: 12 }}>{formatDate(movement.createdAt)}</span>
                      </div>
                      <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                        Palet: {movement.palletCode || "-"} · Ref: {movement.reference || "-"} · Cantidad: {movement.quantity ?? "-"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
