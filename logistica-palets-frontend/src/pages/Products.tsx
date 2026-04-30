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
    if (!value) return "Ingresá un código de material.";
    if (value.length < 2 || value.length > 80) return "El código debe tener entre 2 y 80 caracteres.";
    return "";
  }, [code]);

  const descriptionError = useMemo(() => {
    const value = description.trim();
    if (!value) return "Ingresá una descripción.";
    if (value.length < 2 || value.length > 160) return "La descripción debe tener entre 2 y 160 caracteres.";
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

    if (!allowCreate || codeError || descriptionError) return;

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
    if (!allowDelete || !window.confirm(`Eliminar material ${item.code}?`)) return;

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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Materiales</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Catálogo de materiales operativos. {!allowCreate ? "Modo lectura." : ""}
        </p>
      </div>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" disabled={!allowCreate || saving} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código material" />
        <input
          className="input"
          disabled={!allowCreate || saving}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descripción"
          style={{ minWidth: 320 }}
        />
        <input
          className="input"
          disabled={!allowCreate || saving}
          value={unitOfMeasure}
          onChange={(event) => setUnitOfMeasure(event.target.value)}
          placeholder="UM"
          style={{ width: 120 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {saving ? "Guardando..." : "Guardar material"}
        </button>
      </form>

      {submitted && codeError ? <p style={{ color: "#dc2626", marginTop: -4, fontSize: 13 }}>{codeError}</p> : null}
      {submitted && descriptionError ? <p style={{ color: "#dc2626", marginTop: -4, fontSize: 13 }}>{descriptionError}</p> : null}
      {formError ? <p style={{ color: "#dc2626", fontSize: 13 }}>{formError}</p> : null}
      {loading ? <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p> : null}
      {error ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <p style={{ color: "#dc2626", marginBottom: 0, fontSize: 13 }}>No se pudo cargar.</p>
          <button className="btn btn--primary" onClick={refresh}>Reintentar</button>
        </div>
      ) : null}

      {!loading && !error ? (
        items.length === 0 ? (
          <p>No hay materiales registrados</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>UM</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.code}</strong></td>
                  <td>{item.description}</td>
                  <td><span className="badge">{item.unitOfMeasure ?? "-"}</span></td>
                  <td>
                    <span className={item.active ? "badge badge--entry" : "badge"}>
                      {item.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {allowDelete ? <button className="btn btn--danger" onClick={() => handleDelete(item)}>Eliminar</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}
