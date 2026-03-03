import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { logout } from "../api/auth";
import { getUserRole, canRead } from "../auth/rbac";
import type React from "react";

const linkStyle = ({ isActive }: { isActive: boolean }) => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 10px",
  borderRadius: 10,
  textDecoration: "none",
  color: isActive ? "#111827" : "#374151",
  background: isActive ? "#f3f4f6" : "transparent",
  fontWeight: isActive ? 800 : 600,
  fontSize: 13,
});

const shell: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: "#fafafa",
    display: "grid",
    gridTemplateColumns: "280px 1fr",
  },
  sidebar: {
    background: "#ffffff",
    borderRight: "1px solid #e5e7eb",
    padding: 16,
    position: "sticky",
    top: 0,
    height: "100vh",
    overflow: "auto",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  brand: { fontSize: 14, fontWeight: 900, letterSpacing: "-0.2px", margin: 0 },
  pill: {
    border: "1px solid #e5e7eb",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    color: "#111827",
    background: "#fff",
    whiteSpace: "nowrap",
  },
  nav: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "14px 8px 8px" },
  footer: { marginTop: 14, paddingTop: 14, borderTop: "1px solid #e5e7eb" },
  btn: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  main: { padding: "22px 22px 40px" },
  topbar: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  topbarTitle: { fontSize: 12, fontWeight: 800, color: "#6b7280" },
  topbarRight: { display: "flex", alignItems: "center", gap: 10 },
};


const modules = [
  { key: "dashboard", label: "Dashboard", path: "/" },
  { key: "products", label: "Productos", path: "/products" },
  { key: "warehouses", label: "Depósitos", path: "/warehouses" },
  { key: "locations", label: "Ubicaciones", path: "/locations" },
  { key: "lots", label: "Lotes", path: "/lots" },
  { key: "pallets", label: "Palets", path: "/pallets" },
  { key: "movements", label: "Movimientos", path: "/movements" },
  { key: "transports", label: "Transportes", path: "/transports" },
] as const;

export default function AppLayout() {
  const token = localStorage.getItem("token");
  const nav = useNavigate();
  const role = getUserRole();

  if (!token) return <Navigate to="/login" replace />;

  function handleLogout() {
    logout();
    nav("/login", { replace: true });
  }

  const visible = role
    ? modules.filter((m) => m.key === "dashboard" || canRead(m.key as any, role))
    : [modules[0]];

  return (
    <div style={shell.app}>
      {/* Sidebar */}
      <aside style={shell.sidebar}>
        <div style={shell.brandRow}>
          <h3 style={shell.brand}>Logística Palets</h3>
          <span style={shell.pill}>{role ?? "SIN_ROLE"}</span>
        </div>

        <div style={{ color: "#6b7280", fontSize: 12, marginLeft: 2 }}>
          {/*Accesos por permisos · UI estilo Linear*/}
        </div>

        <div style={shell.sectionTitle}>Navegación</div>

        <nav style={shell.nav}>
          {visible.map((m) => (
            <NavLink key={m.key} to={m.path} style={linkStyle}>
              <span style={{ width: 10, height: 10, borderRadius: 4, background: "#e5e7eb" }} />
              {m.label}
            </NavLink>
          ))}
        </nav>

        <div style={shell.footer}>
          <button onClick={handleLogout} style={shell.btn}>
            Cerrar Sesion
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={shell.main}>
        <div style={shell.topbar}>
          <div style={shell.topbarTitle}>Workspace</div>
          <div style={shell.topbarRight}>
            <span style={{ ...shell.pill, background: "#f9fafb" }}>
              {role ?? "SIN_ROLE"}
            </span>
          </div>
        </div>

        <Outlet />
      </main>
    </div>
  );
}
