import { useEffect, useState } from "react";
import { createTransport, listTransports } from "../api/transports";
import type { Transport } from "../api/transports";
import { getUserRole, canWrite } from "../auth/rbac";

export default function TransportsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("transports", role) : false;

  const [items, setItems] = useState<Transport[]>([]);
  const [plate, setPlate] = useState("ABC-123");
  const [type, setType] = useState("SCANIA");
  const [description, setDescription] = useState("Camión de prueba");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const data = await listTransports();
    setItems(data);
  }

  useEffect(() => {
    refresh().catch((e: any) => setError(e?.response?.data?.message || "Error cargando transports"));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setError("");
    setLoading(true);
    try {
      await createTransport({ plate, type, description });
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error creando transport");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Transports</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar transports.
        </p>
      )}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input disabled={!canCreate} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="plate" />
        <input disabled={!canCreate} value={type} onChange={(e) => setType(e.target.value)} placeholder="type" />
        <input
          disabled={!canCreate}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description"
          style={{ minWidth: 260 }}
        />
        <button type="submit" disabled={!canCreate || loading}>
          {loading ? "Creando..." : "Crear"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <table border={1} cellPadding={8}>
        <thead>
          <tr>
            <th>plate</th>
            <th>type</th>
            <th>description</th>
            <th>active</th>
            <th>id</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.plate}</td>
              <td>{t.type}</td>
              <td>{t.description}</td>
              <td>{String(t.active)}</td>
              <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
