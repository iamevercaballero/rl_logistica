import { useCallback, useEffect, useState } from "react";
import { createLot, deleteLot, listLots, generateSapLot, type Lot } from "../api/lots";
import { listProducts, type Product } from "../api/products";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

function daysLabel(fecha?: string | null) {
  if (!fecha) return null;
  const d = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (d < 0) return <span className="badge badge--estado-rechazado">Vencido</span>;
  if (d <= 7) return <span className="badge badge--estado-rechazado">{d}d</span>;
  if (d <= 30) return <span className="badge badge--estado-pendiente">{d}d</span>;
  return <span className="badge badge--estado-aprobado">{d}d</span>;
}

export default function LotsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("lots", role) : false;
  const allowDelete = role ? canDelete("lots", role) : false;

  const [items, setItems] = useState<Lot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filterProductId, setFilterProductId] = useState("");
  const [filterSapLot, setFilterSapLot] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  // Formulario
  const [productId, setProductId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaFabricacion, setFechaFabricacion] = useState("");
  const [sapLot, setSapLot] = useState(() => generateSapLot());

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [lots, productData] = await Promise.all([listLots(), listProducts()]);
      setItems(lots);
      setProducts(productData);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const filtered = items.filter(i => {
    if (filterProductId && i.productId !== filterProductId) return false;
    if (filterSapLot && i.sapLot !== filterSapLot) return false;
    return true;
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!allowCreate || !lotCode.trim() || !productId) return;
    setSaving(true); setFormError("");
    try {
      await createLot({
        lotCode: lotCode.trim(),
        productId,
        fechaVencimiento: fechaVencimiento || undefined,
        fechaFabricacion: fechaFabricacion || undefined,
        sapLot: sapLot.trim() || undefined,
      });
      setLotCode(""); setFechaVencimiento(""); setFechaFabricacion("");
      setSapLot(generateSapLot());
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Lot) {
    if (!allowDelete || !window.confirm(`Eliminar lote ${item.lotCode}?`)) return;
    setSaving(true); setFormError("");
    try { await deleteLot(item.id); await refresh(); }
    catch (err) { setFormError(getFriendlyApiError(err)); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Lotes</h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Administrá lotes con fecha de vencimiento para FEFO automático en salidas.</p>
      </div>

      {allowCreate && (
        <section className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800 }}>Nuevo lote</h3>
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <select className="input" value={productId} onChange={e => setProductId(e.target.value)} required>
                <option value="">Seleccionar material *</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
              </select>
              <input className="input" placeholder="Código de lote *" value={lotCode} onChange={e => setLotCode(e.target.value)} required />
              <input className="input" value={sapLot} onChange={e => setSapLot(e.target.value)}
                placeholder="Lote SAP" title="Lote SAP del día (auto-generado)" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: .3 }}>F. Vencimiento</label>
                <input className="input" type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: .3 }}>F. Fabricación</label>
                <input className="input" type="date" value={fechaFabricacion} onChange={e => setFechaFabricacion(e.target.value)} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn btn--primary" type="submit" disabled={saving || !lotCode.trim() || !productId} style={{ width: "100%" }}>
                  {saving ? "Guardando..." : "Guardar lote"}
                </button>
              </div>
            </div>
          </form>
          {formError && <p style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>{formError}</p>}
        </section>
      )}

      {/* Filtros */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="input" value={filterProductId} onChange={e => setFilterProductId(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Todos los materiales</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
          </select>
          <input className="input" placeholder="Filtrar por lote SAP" value={filterSapLot}
            onChange={e => setFilterSapLot(e.target.value)} style={{ width: 180 }} />
          {(filterProductId || filterSapLot) && (
            <button className="btn" onClick={() => { setFilterProductId(""); setFilterSapLot(""); }}>Limpiar filtros</button>
          )}
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{filtered.length} lotes</span>
        </div>
      </section>

      {loading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>}
      {error && <p style={{ color: "#b91c1c" }}>{error} <button className="btn" onClick={refresh}>Reintentar</button></p>}

      {!loading && !error && (
        filtered.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Sin lotes</p>
            <p className="empty__desc">Creá el primer lote o registrá entradas — los lotes se crean automáticamente.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Lote proveedor</th>
                  <th>Lote SAP</th>
                  <th>Material</th>
                  <th>F. Fabricación</th>
                  <th>F. Vencimiento</th>
                  <th>En stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 700 }}>{item.lotCode}</td>
                    <td>
                      {item.sapLot
                        ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)" }}>{item.sapLot}</span>
                        : <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <strong>{item.product?.code ?? "—"}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: 6 }}>{item.product?.description ?? ""}</span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>
                      {item.fechaFabricacion || <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {item.fechaVencimiento
                        ? <>{item.fechaVencimiento} <span style={{ marginLeft: 4 }}>{daysLabel(item.fechaVencimiento)}</span></>
                        : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      <span style={{ color: item.stockActual <= 0 ? "#dc2626" : "inherit" }}>
                        {item.stockActual.toLocaleString("es-PY")}
                      </span>
                    </td>
                    <td>{allowDelete && <button className="btn" onClick={() => handleDelete(item)}>Eliminar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
