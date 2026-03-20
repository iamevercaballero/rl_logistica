import { useCallback, useEffect, useMemo, useState } from "react";
import { createWarehouse, deleteWarehouse, listWarehouses, type Warehouse } from "../api/warehouses";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

export default function WarehousesPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("warehouses", role) : false;
  const allowDelete = role ? canDelete("warehouses", role) : false;

  const [items, setItems] = useState<Warehouse[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const nameError = useMemo(() => {
    const value = name.trim();
    if (!value) return "Ingresá un nombre.";
    if (value.length < 2 || value.length > 80) return "El nombre debe tener entre 2 y 80 caracteres.";
    return "";
  }, [name]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listWarehouses());
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

    if (!allowCreate || nameError) {
      return;
    }

    setSaving(true);
    try {
      await createWarehouse({ name: name.trim(), address: address.trim(), active: true });
      setName("");
      setAddress("");
      setSubmitted(false);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Warehouse) {
    if (!allowDelete || !window.confirm(`Eliminar depósito ${item.name}?`)) {
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await deleteWarehouse(item.id);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Depósitos</h2>
      {!allowCreate ? <p style={{ color: "#6b7280" }}>Modo lectura.</p> : null}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" disabled={!allowCreate || saving} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre" />
        <input
          className="input"
          disabled={!allowCreate || saving}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Dirección"
          style={{ minWidth: 320 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && nameError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{nameError}</p> : null}
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
                <th>Nombre</th>
                <th>Dirección</th>
                <th>Activo</th>
                <th>ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.address || "-"}</td>
                  <td>{String(item.active)}</td>
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
