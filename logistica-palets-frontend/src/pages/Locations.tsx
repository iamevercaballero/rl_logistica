import { useEffect, useState } from "react";
import { createLocation, listLocations } from "../api/locations";
import type { Location } from "../api/locations";
import { listWarehouses } from "../api/warehouses";
import type { Warehouse } from "../api/warehouses";
import { getUserRole, canWrite } from "../auth/rbac";

export default function LocationsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("locations", role) : false;

  const [items, setItems] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [code, setCode] = useState("LOC-001");
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const [locs, whs] = await Promise.all([
      listLocations(),
      listWarehouses(),
    ]);

    setItems(locs);
    setWarehouses(whs);

    if (!warehouseId && whs.length > 0) {
      setWarehouseId(whs[0].id);
    }
  }

  useEffect(() => {
    refresh().catch((e: any) =>
      setError(e?.response?.data?.message || "Error cargando locations"),
    );
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setError("");
    setLoading(true);
    try {
      await createLocation({
        code,
        warehouseId,
      });

      setCode("");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error creando location");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Locations</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar locations.
        </p>
      )}

      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
      >
        <input
          disabled={!canCreate}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="code"
        />

        <select
          disabled={!canCreate}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>

        <button type="submit" disabled={!canCreate || loading}>
          {loading ? "Creando..." : "Crear"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <table border={1} cellPadding={8}>
        <thead>
          <tr>
            <th>code</th>
            <th>warehouseId</th>
            <th>id</th>
          </tr>
        </thead>
        <tbody>
          {items.map((loc) => (
            <tr key={loc.id}>
              <td>{loc.code}</td>
              <td
                style={{
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {loc.warehouseId}
              </td>
              <td
                style={{
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {loc.id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
