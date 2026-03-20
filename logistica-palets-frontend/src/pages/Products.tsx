import { useCallback, useEffect, useMemo, useState } from "react";
import { createProduct, deleteProduct, listProducts, type Product } from "../api/products";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

export default function ProductsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("products", role) : false;
  const allowDelete = role ? canDelete("products", role) : false;

  const [items, setItems] = useState<Product[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("UN");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const codeError = useMemo(() => {
    const value = code.trim();
    if (!value) return "Ingresá un código.";
    if (value.length < 2 || value.length > 80) return "El código debe tener entre 2 y 80 caracteres.";
    return "";
  }, [code]);

  const descriptionError = useMemo(() => {
    const value = description.trim();
    if (!value) return "Ingresá una descripción.";
    if (value.length < 2 || value.length > 80) return "La descripción debe tener entre 2 y 80 caracteres.";
    return "";
  }, [description]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listProducts());
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

    if (!allowCreate || codeError || descriptionError) {
      return;
    }

    setSaving(true);
    try {
      await createProduct({
        code: code.trim(),
        description: description.trim(),
        unitOfMeasure: unitOfMeasure.trim(),
        active: true,
      });
      setCode("");
      setDescription("");
      setUnitOfMeasure("UN");
      setSubmitted(false);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Product) {
    if (!allowDelete || !window.confirm(`Eliminar producto ${item.code}?`)) {
      return;
    }

    setFormError("");
    setSaving(true);
    try {
      await deleteProduct(item.id);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Productos</h2>
      {!allowCreate ? <p style={{ color: "#6b7280" }}>Modo lectura.</p> : null}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" disabled={!allowCreate || saving} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código" />
        <input
          className="input"
          disabled={!allowCreate || saving}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descripción"
          style={{ minWidth: 280 }}
        />
        <input
          className="input"
          disabled={!allowCreate || saving}
          value={unitOfMeasure}
          onChange={(event) => setUnitOfMeasure(event.target.value)}
          placeholder="Unidad"
          style={{ width: 140 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && codeError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{codeError}</p> : null}
      {submitted && descriptionError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{descriptionError}</p> : null}
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
                <th>Código</th>
                <th>Descripción</th>
                <th>Unidad</th>
                <th>Activo</th>
                <th>ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.code}</td>
                  <td>{item.description}</td>
                  <td>{item.unitOfMeasure}</td>
                  <td>{String(item.active)}</td>
                  <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.id}</td>
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
