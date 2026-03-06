import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getUserRole, canRead } from "../auth/rbac";
import { getToken } from "../auth/authStorage";
import { getKpis, getMovementsReport, getStockReport, type KpisResponse, type ReportMovementRow, type ReportRange } from "../api/reports";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import CommandPalette from "../components/CommandPalette";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

const modules = [
  { key: "products", label: "Products", path: "/products" },
  { key: "warehouses", label: "Warehouses", path: "/warehouses" },
  { key: "locations", label: "Locations", path: "/locations" },
  { key: "lots", label: "Lots", path: "/lots" },
  { key: "pallets", label: "Pallets", path: "/pallets" },
  { key: "movements", label: "Movements", path: "/movements" },
  { key: "transports", label: "Transports", path: "/transports" },
  { key: "reports", label: "Reportes", path: "/reports" },
] as const;

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function DashboardPage() {
  const token = getToken();
  const role = getUserRole();
  const nav = useNavigate();

  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [moves, setMoves] = useState<ReportMovementRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [kpiRange, setKpiRange] = useState<ReportRange>("today");
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);

  const visibleModules = useMemo(() => role ? modules.filter((m) => canRead(m.key as any, role)) : [], [role]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isCmdK) { e.preventDefault(); setCmdOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    (async () => {
      try {
        const [k, m] = await Promise.all([
          getKpis(kpiRange),
          getMovementsReport({ limit: 10 }),
        ]);
        setKpis(k);
        setMoves(m.data.slice(0, 10));
      } catch (e: any) {
        setErr(e?.response?.data?.message || "Error cargando dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, kpiRange]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const stock = await getStockReport(warehouseId || undefined);
        setKpis((prev) => prev ? { ...prev, stockByWarehouse: stock.byWarehouse } : prev);
      } catch {
        // keep old stock graph
      }
    })();
  }, [token, warehouseId]);

  if (!token) return <Navigate to="/login" replace />;

  const cmdItems = visibleModules.map((m) => ({ label: m.label, path: m.path }));
  const chartData = useMemo(() => (kpis?.stockByWarehouse ?? []).map((w) => ({ name: w.warehouseName, units: Number(w.units) || 0 })), [kpis]);

  return (
    <div style={{ background: "#fafafa", minHeight: "100vh" }}>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={cmdItems} onSelect={(path) => nav(path)} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.4, margin: 0 }}>Dashboard</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>Cmd+K para buscar módulos · Rol: <strong>{role ?? "SIN_ROLE"}</strong></p>
          </div>
          <button onClick={() => setCmdOpen(true)} style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 12, padding: "10px 12px", fontWeight: 800, cursor: "pointer" }}>Buscar (Ctrl/Cmd + K)</button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <label>Rango KPI:</label>
          <select className="input" value={kpiRange} onChange={(e) => setKpiRange(e.target.value as ReportRange)}>
            <option value="today">Hoy</option><option value="week">Semana</option><option value="month">Mes</option>
          </select>
        </div>

        {err && <div style={{ marginTop: 12, color: "#b91c1c" }}>{err}</div>}
        {loading && <div style={{ marginTop: 12, color: "#6b7280" }}>Cargando…</div>}

        {!loading && kpis && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
              {[{ label: "Palets en stock", value: kpis.totalPallets }, { label: "Unidades en stock", value: kpis.totalUnits }, { label: "Movimientos (rango)", value: kpis.movementsInRange }].map((c) => (
                <div key={c.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, boxShadow: "0 1px 0 rgba(0,0,0,0.02)" }}>
                  <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 700 }}>{c.label}</div>
                  <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -0.5, marginTop: 6 }}>{c.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, marginTop: 12 }}>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Stock por depósito</div>
                  <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    <option value="">Todos</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="units" /></BarChart></ResponsiveContainer>
                </div>
              </div>

              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Últimos movimientos</div>
                  <button onClick={() => nav("/reports")} style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 10, padding: "6px 10px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>Ver reportes</button>
                </div>
                <div style={{ marginTop: 10 }}>{moves.length === 0 ? <div style={{ color: "#6b7280", fontSize: 13 }}>Sin movimientos</div> : <div style={{ display: "grid", gap: 8 }}>{moves.map((m) => <div key={m.id + m.createdAt} style={{ border: "1px solid #f1f5f9", borderRadius: 12, padding: 10, background: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div style={{ fontWeight: 900 }}>{m.type}</div><div style={{ color: "#6b7280", fontSize: 12 }}>{fmtDate(m.createdAt)}</div></div><div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>Ref: {m.reference || "—"} · Qty: {m.quantity ?? "—"}</div></div>)}</div>}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
