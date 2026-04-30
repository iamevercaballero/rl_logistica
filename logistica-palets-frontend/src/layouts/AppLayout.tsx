import React from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { canRead } from "../auth/rbac";
import { useAuth } from "../auth/AuthContext";

const ROLE_BADGE: Record<string, string> = {
  ADMIN: "badge badge--role-admin",
  MANAGER: "badge badge--role-manager",
  OPERATOR: "badge badge--role-operator",
  AUDITOR: "badge badge--role-auditor",
};

const Icons: Record<string, React.ReactElement> = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  products: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  warehouses: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  locations: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  lots: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  pallets: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="6" height="6" /><rect x="9" y="3" width="6" height="6" />
      <rect x="16" y="3" width="6" height="6" /><rect x="2" y="12" width="6" height="6" />
      <rect x="9" y="12" width="6" height="6" /><rect x="16" y="12" width="6" height="6" />
      <line x1="2" y1="21" x2="22" y2="21" />
    </svg>
  ),
  movements: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 16V4m0 0L3 8m4-4l4 4" />
      <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  ),
  transports: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
  reports: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
};

const modules = [
  { key: "dashboard" as const, label: "Dashboard", path: "/" },
  { key: "products" as const, label: "Materiales", path: "/products" },
  { key: "warehouses" as const, label: "Depósitos", path: "/warehouses" },
  { key: "locations" as const, label: "Ubicaciones", path: "/locations" },
  { key: "lots" as const, label: "Lotes", path: "/lots" },
  { key: "pallets" as const, label: "Palets", path: "/pallets" },
  { key: "movements" as const, label: "Movimientos", path: "/movements" },
  { key: "transports" as const, label: "Transportes", path: "/transports" },
  { key: "reports" as const, label: "Reportes", path: "/reports" },
];

export default function AppLayout() {
  const { user, isReady, logout } = useAuth();
  const navigate = useNavigate();

  if (!isReady) return null;
  if (!user) return <Navigate to="/login" replace />;

  const visible = modules.filter((m) => m.key === "dashboard" || canRead(m.key, user.role));
  const initials = user.username.slice(0, 2).toUpperCase();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "260px 1fr" }}>
      <aside className="sidebar-wrap">
        <div className="sidebar-brand">
          <img src="/logo.jpg" alt="RL Logística" className="sidebar-brand-logo" />
          <div>
            <p className="sidebar-brand-name">RL Logística</p>
            <span className="sidebar-brand-sub">Control de stock</span>
          </div>
        </div>

        <div className="sidebar-section">Navegación</div>

        <nav className="sidebar-nav">
          {visible.map((m) => (
            <NavLink
              key={m.key}
              to={m.path}
              end={m.path === "/"}
              className={({ isActive }) =>
                `sidebar-link${isActive ? " sidebar-link--active" : ""}`
              }
            >
              {Icons[m.key]}
              {m.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div>
              <p className="sidebar-user-name">{user.username}</p>
              <span className="sidebar-user-role">{user.role}</span>
            </div>
          </div>
          <button className="sidebar-logout" onClick={handleLogout}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main style={{ padding: "20px 24px 48px", minWidth: 0 }}>
        <div className="topbar">
          <div className="topbar-title">
            <span style={{ color: "var(--primary)", marginRight: 6 }}>●</span>
            Sistema operativo — RL Logística
          </div>
          <div className="topbar-right">
            <span className={ROLE_BADGE[user.role] ?? "badge"}>{user.role}</span>
            <span className="badge">{user.username}</span>
          </div>
        </div>

        <Outlet />
      </main>
    </div>
  );
}
