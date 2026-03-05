import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const nav = useNavigate();
  const { login: authLogin } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      const payload = await login(username, password);
      authLogin(payload);
      nav("/", { replace: true });
    } catch (e: any) {
      setError(e?.response?.data?.message || "Usuario o contraseña incorrectos");
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "80px auto" }}>
      <h2>Iniciar sesión</h2>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
        <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
        <button className="btn btn--primary" type="submit">Entrar</button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
