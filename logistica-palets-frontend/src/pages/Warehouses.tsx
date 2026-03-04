import { useEffect, useState } from "react";
import { createWarehouse, listWarehouses } from "../api/warehouses";
import type { Warehouse } from "../api/warehouses";
import { getUserRole, canWrite } from "../auth/rbac";

export default function WarehousesPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("warehouses", role) : false;

  const [items, setItems] = useState<Warehouse[]>([]);
  const [name, setName] = useState("Depósito Central");
  const [address, setAddress] = useState("Ruta PY01 Km 15");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const data = await listWarehouses();
    setItems(data);
  }

  useEffect(() => {
    refresh().catch((e: any) =>
      setError(e?.response?.data?.message || "Error cargando warehouses"),
    );
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setError("");
    setLoading(true);
    try {
      await createWarehouse({ name, address, active: true });
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error creando warehouse");
    } finally {
      setLoading(false);
    }
  }
  
  return (
    <div>
      <h2>Warehouses</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar warehouses.
        </p>
      )}

      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
      >
        <input
          disabled={!canCreate}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
        />
        <input
          disabled={!canCreate}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="address"
          style={{ minWidth: 320 }}
        />
        <button type="submit" disabled={!canCreate || loading}>
          {loading ? "Creando..." : "Crear"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <table border={1} cellPadding={8}>
        <thead>
          <tr>
            <th>name</th>
            <th>address</th>
            <th>active</th>
            <th>id</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td>
              <td>{w.address}</td>
              <td>{String(w.active)}</td>
              <td
                style={{
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {w.id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
