import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { getFriendlyApiError } from "../utils/apiError";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login: authLogin, isReady, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (isReady && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = await login(username.trim(), password);
      authLogin(payload);
      navigate("/", { replace: true });
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src="/logo.jpg"
            alt="RL Logística"
            style={{ width: 64, height: 64, borderRadius: 16, objectFit: "contain", background: "#f1f5f9", padding: 6, marginBottom: 16 }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.4, margin: "0 0 4px" }}>
            RL Logística
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
            Sistema de control de stock y operaciones
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Usuario
            </label>
            <input
              className="input"
              style={{ width: "100%" }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ingresá tu usuario"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Contraseña
            </label>
            <input
              className="input"
              style={{ width: "100%" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ color: "#dc2626", fontSize: 13, fontWeight: 600 }}>{error}</span>
            </div>
          )}

          <button
            className="btn btn--primary"
            type="submit"
            disabled={submitting || !username.trim() || !password}
            style={{ width: "100%", height: 42, fontSize: 15, marginTop: 4, justifyContent: "center" }}
          >
            {submitting ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>

        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, marginTop: 24, marginBottom: 0 }}>
          RL Servicio Logístico · Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
