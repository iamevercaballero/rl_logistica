import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { getFriendlyApiError } from "../utils/apiError";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login: authLogin, isReady, user } = useAuth();
  const [username, setUsername] = useState("admin");
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
    <div className="card" style={{ maxWidth: 420, margin: "80px auto" }}>
      <h2>Iniciar sesión</h2>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>Ingresá con un usuario válido para operar el sistema.</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Usuario"
          autoComplete="username"
        />
        <input
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Contraseña"
          type="password"
          autoComplete="current-password"
        />
        <button className="btn btn--primary" type="submit" disabled={submitting || !username.trim() || !password}>
          {submitting ? "Ingresando..." : "Entrar"}
        </button>
      </form>

      {error ? <p style={{ color: "#b91c1c", marginBottom: 0, marginTop: 12 }}>{error}</p> : null}
    </div>
  );
}
