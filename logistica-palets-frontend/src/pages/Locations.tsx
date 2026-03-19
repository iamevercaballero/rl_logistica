import { useCallback, useEffect, useMemo, useState } from "react";
import { createLocation, deleteLocation, listLocations, type Location } from "../api/locations";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

export default function LocationsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("locations", role) : false;
  const allowDelete = role ? canDelete("locations", role) : false;

  const [items, setItems] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [code, setCode] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [locations, warehouseData] = await Promise.all([listLocations(), listWarehouses()]);
      setItems(locations);
      setWarehouses(warehouseData);
      setWarehouseId((current) => current || warehouseData[0]?.id || "");
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

    if (!allowCreate || codeError || !warehouseId) {
      return;
    }

    setSaving(true);
    try {
      await createLocation({ code: code.trim(), warehouseId });
      setCode("");
      setSubmitted(false);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Location) {
    if (!allowDelete || !window.confirm(`Eliminar ubicación ${item.code}?`)) {
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await deleteLocation(item.id);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Ubicaciones</h2>
      {!allowCreate ? <p style={{ color: "#6b7280" }}>Modo lectura.</p> : null}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" disabled={!allowCreate || saving} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código" />
        <select className="input" disabled={!allowCreate || saving || warehouses.length === 0} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
          <option value="">Seleccionar depósito</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving || warehouses.length === 0}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && codeError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{codeError}</p> : null}
      {submitted && !warehouseId ? <p style={{ color: "#b91c1c", marginTop: -4 }}>Seleccioná un depósito.</p> : null}
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
                <th>Depósito</th>
                <th>ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.code}</td>
                  <td>{item.warehouse?.name ?? item.warehouseId ?? "-"}</td>
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
