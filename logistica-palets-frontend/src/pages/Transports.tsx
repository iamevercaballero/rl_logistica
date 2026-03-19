import { useCallback, useEffect, useMemo, useState } from "react";
import { createTransport, deleteTransport, listTransports, type Transport } from "../api/transports";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

export default function TransportsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("transports", role) : false;
  const allowDelete = role ? canDelete("transports", role) : false;

  const [items, setItems] = useState<Transport[]>([]);
  const [plate, setPlate] = useState("");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const plateError = useMemo(() => {
    const value = plate.trim();
    if (!value) return "Ingresá una patente.";
    if (value.length < 2 || value.length > 80) return "La patente debe tener entre 2 y 80 caracteres.";
    return "";
  }, [plate]);

  const typeError = useMemo(() => {
    const value = type.trim();
    if (!value) return "Ingresá un tipo.";
    if (value.length < 2 || value.length > 80) return "El tipo debe tener entre 2 y 80 caracteres.";
    return "";
  }, [type]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listTransports());
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

    if (!allowCreate || plateError || typeError) {
      return;
    }

    setSaving(true);
    try {
      await createTransport({ plate: plate.trim(), type: type.trim(), description: description.trim() });
      setPlate("");
      setType("");
      setDescription("");
      setSubmitted(false);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Transport) {
    if (!allowDelete || !window.confirm(`Eliminar transporte ${item.plate}?`)) {
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await deleteTransport(item.id);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Transportes</h2>
      {!allowCreate ? <p style={{ color: "#6b7280" }}>Modo lectura.</p> : null}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" disabled={!allowCreate || saving} value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="Patente" />
        <input className="input" disabled={!allowCreate || saving} value={type} onChange={(event) => setType(event.target.value)} placeholder="Tipo" />
        <input
          className="input"
          disabled={!allowCreate || saving}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descripción"
          style={{ minWidth: 260 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && plateError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{plateError}</p> : null}
      {submitted && typeError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{typeError}</p> : null}
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
                <th>Patente</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Activo</th>
                <th>ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.plate}</td>
                  <td>{item.type}</td>
                  <td>{item.description || "-"}</td>
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
