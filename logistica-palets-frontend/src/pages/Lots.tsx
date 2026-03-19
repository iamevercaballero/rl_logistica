import { useCallback, useEffect, useMemo, useState } from "react";
import { createLot, deleteLot, listLots, type Lot } from "../api/lots";
import { listProducts, type Product } from "../api/products";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

export default function LotsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("lots", role) : false;
  const allowDelete = role ? canDelete("lots", role) : false;

  const [items, setItems] = useState<Lot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const codeError = useMemo(() => {
    const value = lotCode.trim();
    if (!value) return "Ingresá un código de lote.";
    if (value.length < 2 || value.length > 80) return "El código debe tener entre 2 y 80 caracteres.";
    return "";
  }, [lotCode]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [lots, productData] = await Promise.all([listLots(), listProducts()]);
      setItems(lots);
      setProducts(productData);
      setProductId((current) => current || productData[0]?.id || "");
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setFormError("");

    if (!allowCreate || codeError || !productId) {
      return;
    }

    setSaving(true);
    try {
      await createLot({ lotCode: lotCode.trim(), productId });
      setLotCode("");
      setSubmitted(false);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Lot) {
    if (!allowDelete || !window.confirm(`Eliminar lote ${item.lotCode}?`)) {
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await deleteLot(item.id);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Lotes</h2>
      {!allowCreate ? <p style={{ color: "#6b7280" }}>Modo lectura.</p> : null}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select className="input" disabled={!allowCreate || saving || products.length === 0} value={productId} onChange={(event) => setProductId(event.target.value)}>
          <option value="">Seleccionar producto</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.code} - {product.description}
            </option>
          ))}
        </select>
        <input className="input" disabled={!allowCreate || saving} value={lotCode} onChange={(event) => setLotCode(event.target.value)} placeholder="Código de lote" />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving || products.length === 0}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && !productId ? <p style={{ color: "#b91c1c", marginTop: -4 }}>Seleccioná un producto.</p> : null}
      {submitted && codeError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{codeError}</p> : null}
      {formError ? <p style={{ color: "#b91c1c" }}>{formError}</p> : null}

      {loading ? <p>Cargando...</p> : null}
      {error ? (
        <div>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={refresh}>
            Reintentar
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        items.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Producto</th>
                <th>ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.lotCode}</td>
                  <td>{item.product?.code ?? "-"}</td>
                  <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.id}</td>
                  <td>{allowDelete ? <button className="btn" onClick={() => handleDelete(item)}>Eliminar</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}
