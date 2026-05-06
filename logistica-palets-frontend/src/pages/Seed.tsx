import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { SeedStats } from "../api/seed";
import { resetData, seedFromExcel } from "../api/seed";
import { getFriendlyApiError } from "../utils/apiError";

export default function SeedPage() {
  const { user } = useAuth();
  const [maxMov, setMaxMov] = useState(300);
  const [soloProductos, setSoloProductos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ mensaje: string; stats: SeedStats } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  if (user?.role !== "ADMIN") {
    return (
      <div className="empty-state">
        <p>Esta sección es exclusiva para administradores.</p>
      </div>
    );
  }

  async function handleSeed(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setLog(["Iniciando carga masiva desde Excel..."]);

    try {
      setLog((l) => [...l, `Cargando hasta ${maxMov} movimientos por tipo...`]);
      const res = await seedFromExcel({ maxMovimientos: maxMov, soloProductos });
      setResult(res);
      setLog((l) => [...l, "✓ Proceso completado."]);
    } catch (e) {
      setError(getFriendlyApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!confirm("⚠ ¿Eliminar TODOS los datos del sistema? Esta acción no se puede deshacer.")) return;
    if (!confirm("Confirmación final: se eliminarán productos, lotes, movimientos, stock. ¿Continuar?")) return;
    setResetting(true);
    setError(null);
    try {
      const res = await resetData();
      setLog(["✓ Datos eliminados: " + res.mensaje]);
      setResult(null);
    } catch (e) {
      setError(getFriendlyApiError(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <h1 className="page-title" style={{ marginBottom: 8 }}>Carga Masiva de Datos</h1>
      <p style={{ color: "var(--muted)", marginBottom: 28, fontSize: 14 }}>
        Importa productos, lotes, stock y movimientos históricos desde el Excel de RL Logística.
        El archivo debe estar en la raíz del proyecto o configurado en <code>SEED_EXCEL</code>.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>

        {/* Panel izquierdo: configuración */}
        <form className="card" onSubmit={handleSeed}>
          <h3 style={{ fontWeight: 700, marginBottom: 20 }}>Opciones de importación</h3>

          <div className="form-group">
            <label className="label">Máximo de movimientos por tipo</label>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              Limita entradas + salidas históricas. El Excel tiene ~3.000 entradas y ~7.000 salidas.
              Para prueba inicial recomendamos 50-300.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[50, 100, 300, 999].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn btn--sm${maxMov === n ? " btn--primary" : ""}`}
                  onClick={() => setMaxMov(n)}
                >
                  {n === 999 ? "Todos (lento)" : n}
                </button>
              ))}
            </div>
            <input
              className="input"
              type="number"
              min={1}
              max={9999}
              value={maxMov}
              onChange={(e) => setMaxMov(Number(e.target.value))}
              style={{ marginTop: 8, width: 120 }}
            />
          </div>

          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              id="solo-prod"
              checked={soloProductos}
              onChange={(e) => setSoloProductos(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <label htmlFor="solo-prod" style={{ cursor: "pointer", userSelect: "none" }}>
              <strong>Solo productos</strong>
              <span style={{ color: "var(--muted)", fontSize: 13, display: "block" }}>
                Crea los 429 productos sin movimientos (muy rápido)
              </span>
            </label>
          </div>

          <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: "12px 16px", marginBottom: 16, fontSize: 13 }}>
            <strong>¿Qué se va a cargar?</strong>
            <ul style={{ margin: "8px 0 0 16px", color: "var(--muted)", lineHeight: 1.8 }}>
              <li>429 productos únicos (materiales AMBEV)</li>
              <li>Depósito + Ubicación por defecto</li>
              <li>8 lotes activos (Hoja2 — stock actual)</li>
              <li>Stock inicial vía Ajuste de entrada</li>
              {!soloProductos && <li>{maxMov} entradas + {maxMov} salidas históricas recientes</li>}
            </ul>
          </div>

          <button
            className="btn btn--primary"
            type="submit"
            disabled={loading || resetting}
            style={{ width: "100%" }}
          >
            {loading ? "⏳ Cargando datos... (puede tardar)" : "▶ Iniciar carga masiva"}
          </button>
        </form>

        {/* Panel derecho: resultado y reset */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Log en vivo */}
          {log.length > 0 && (
            <div className="card" style={{ padding: "14px 16px" }}>
              <h4 style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Log</h4>
              <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.9 }}>
                {log.map((l, i) => <div key={i}>{l}</div>)}
                {loading && <div style={{ color: "var(--primary)" }}>⏳ procesando...</div>}
              </div>
            </div>
          )}

          {/* Error */}
          {error && <div className="form-error">{error}</div>}

          {/* Resultado */}
          {result && (
            <div className="card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <h4 style={{ fontWeight: 700, color: "#15803d", marginBottom: 14 }}>✓ {result.mensaje}</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Productos creados",  value: result.stats.productosCreados },
                  { label: "Ya existían",         value: result.stats.productosOmitidos },
                  { label: "Lotes",               value: result.stats.lotesCreados },
                  { label: "Stock inicial",        value: result.stats.stockCargado },
                  { label: "Entradas históricas", value: result.stats.entradasCreadas },
                  { label: "Salidas históricas",  value: result.stats.salidasCreadas },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: "center", padding: "10px 8px", background: "white", borderRadius: "var(--radius)" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primary)" }}>{value}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reset */}
          <div className="card" style={{ border: "1px solid #fecaca", background: "#fef2f2" }}>
            <h4 style={{ fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>Zona peligrosa</h4>
            <p style={{ fontSize: 13, color: "#7f1d1d", marginBottom: 14 }}>
              Elimina <strong>todos</strong> los productos, lotes, movimientos y stock de la base de datos.
              Solo usar en entorno de desarrollo para empezar desde cero.
            </p>
            <button
              className="btn"
              style={{ color: "#dc2626", borderColor: "#fca5a5", width: "100%" }}
              onClick={handleReset}
              disabled={loading || resetting}
            >
              {resetting ? "Eliminando..." : "🗑 Eliminar todos los datos"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
