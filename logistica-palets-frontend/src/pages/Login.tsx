import { useId, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login: authLogin, isReady, user } = useAuth();
  const { toast } = useToast();
  const userId = useId();
  const passId = useId();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMut = useMutation({
    mutationFn: (vars: { username: string; password: string }) => login(vars.username, vars.password),
    onSuccess: (payload) => {
      authLogin(payload);
      navigate("/", { replace: true });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  if (isReady && user) {
    return <Navigate to="/" replace />;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMut.mutate({ username: username.trim(), password });
  }

  const submitting = loginMut.isPending;
  const errorText = loginMut.error ? getFriendlyApiError(loginMut.error) : "";

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src="/logo.jpg"
            alt="RL Logística"
            style={{ width: 64, height: 64, borderRadius: 16, objectFit: "contain", background: "var(--panel-mid)", padding: 6, marginBottom: 16 }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.4, margin: "0 0 4px" }}>
            RL Logística
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
            Sistema de control de stock y operaciones
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Inicio de sesión">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor={userId} style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Usuario
            </label>
            <input
              id={userId}
              className="input"
              style={{ width: "100%" }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ingresá tu usuario"
              autoComplete="username"
              autoFocus
              required
              aria-required="true"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor={passId} style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Contraseña
            </label>
            <input
              id={passId}
              className="input"
              style={{ width: "100%" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
              required
              aria-required="true"
            />
          </div>

          {errorText && (
            <div className="form-error" role="alert" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{errorText}</span>
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
