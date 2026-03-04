import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getUserRole, canRead } from "../auth/rbac";
import { getToken } from "../auth/authStorage";
import { getKpis, type KpisResponse } from "../api/kpis";
import { getMovements, type MovementRow } from "../api/reports";
import CommandPalette from "../components/CommandPalette";

// Recharts
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

const modules = [
  { key: "products", label: "Products", path: "/products" },
  { key: "warehouses", label: "Warehouses", path: "/warehouses" },
  { key: "locations", label: "Locations", path: "/locations" },
  { key: "lots", label: "Lots", path: "/lots" },
  { key: "pallets", label: "Pallets", path: "/pallets" },
  { key: "movements", label: "Movements", path: "/movements" },
  { key: "transports", label: "Transports", path: "/transports" },
] as const;

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function DashboardPage() {
  const token = getToken();
  const role = getUserRole();
  const nav = useNavigate();

  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [moves, setMoves] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);

  const visibleModules = useMemo(() => {
    return role ? modules.filter((m) => canRead(m.key as any, role)) : [];
  }, [role]);

  // Cmd+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!token) return;

    (async () => {
      try {
        const [k, m] = await Promise.all([getKpis(), getMovements()]);
        setKpis(k);

        // últimos 10 por fecha (si tu view ya viene ordenada, igual sirve)
        const sorted = [...m].sort((a, b) => {
          const da = new Date(a.date).getTime();
          const db = new Date(b.date).getTime();
          return db - da;
        });
        setMoves(sorted.slice(0, 10));
      } catch (e: any) {
        setErr(e?.response?.data?.message || "Error cargando dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (!token) return <Navigate to="/login" replace />;

  const cmdItems = visibleModules.map((m) => ({ label: m.label, path: m.path }));

  // data para recharts (stock por warehouse)
  const chartData = useMemo(() => {
    if (!kpis) return [];
    return kpis.stockByWarehouse.map((w) => ({
      name: w.name,
      units: Number(w.total_units) || 0,
    }));
  }, [kpis]);

  return (
    <div style={{ background: "#fafafa", minHeight: "100vh" }}>
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        items={cmdItems}
        onSelect={(path) => nav(path)}
      />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.4, margin: 0 }}>Dashboard</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>
              Cmd+K para buscar módulos · Rol: <strong>{role ?? "SIN_ROLE"}</strong>
            </p>
          </div>

          <button
            onClick={() => setCmdOpen(true)}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Buscar (Ctrl/Cmd + K)
          </button>
        </div>

        {err && <div style={{ marginTop: 12, color: "#b91c1c" }}>{err}</div>}
        {loading && <div style={{ marginTop: 12, color: "#6b7280" }}>Cargando…</div>}

        {!loading && kpis && (
          <>
            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
              {[
                { label: "Total pallets", value: kpis.totalPallets },
                { label: "Unidades en stock", value: kpis.totalUnits },
                { label: "Movimientos hoy", value: kpis.movementsToday },
              ].map((c) => (
                <div
                  key={c.label}
                  style={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 14,
                    boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
                  }}
                >
                  <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 700 }}>{c.label}</div>
                  <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -0.5, marginTop: 6 }}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Chart + Movements */}
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, marginTop: 12 }}>
              {/* Chart */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Stock por warehouse</div>

                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="units" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
                  Tip: si querés ver nombres, saco el <code>hide</code> del XAxis.
                </div>
              </div>

              {/* Last movements */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Últimos movimientos</div>
                  <button
                    onClick={() => nav("/movements")}
                    style={{
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      borderRadius: 10,
                      padding: "6px 10px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Ver todos
                  </button>
                </div>

                <div style={{ marginTop: 10 }}>
                  {moves.length === 0 ? (
                    <div style={{ color: "#6b7280", fontSize: 13 }}>Sin movimientos</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {moves.map((m, idx) => (
                        <div
                          key={(m.movementId || m.movement_id || "") + idx}
                          style={{
                            border: "1px solid #f1f5f9",
                            borderRadius: 12,
                            padding: 10,
                            background: "#fff",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900 }}>{m.type}</div>
                            <div style={{ color: "#6b7280", fontSize: 12 }}>{fmtDate(m.date)}</div>
                          </div>
                          <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                            Ref: {m.reference || "—"} · Qty: {m.quantity ?? "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Cards módulos */}
            <div style={{ fontSize: 14, fontWeight: 900, marginTop: 18, marginBottom: 10 }}>Módulos</div>

            {visibleModules.length === 0 ? (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#7f1d1d", padding: 10, borderRadius: 12 }}>
                No tenés módulos habilitados con tu rol.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {visibleModules.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => nav(m.path)}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 900 }}>{m.label}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Abrir {m.path}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}