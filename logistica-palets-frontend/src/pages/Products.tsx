import { useEffect, useState } from "react";
import { createProduct, listProducts } from "../api/products";
import type { Product } from "../api/products";
import { getUserRole, canWrite } from "../auth/rbac";
import { EmptyState } from "../components/EmptyState";

export default function ProductsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("products", role) : false;

  const [items, setItems] = useState<Product[]>([]);
  const [code, setCode] = useState("PROD-002");
  const [description, setDescription] = useState("Producto desde UI");
  const [unitOfMeasure, setUnitOfMeasure] = useState("UN");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const data = await listProducts();
    setItems(data);
  }

  useEffect(() => {
    refresh().catch((e: any) =>
      setError(e?.response?.data?.message || "Error cargando productos"),
    );
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setError("");
    setLoading(true);
    try {
      await createProduct({
        code,
        description,
        unitOfMeasure,
        active: true,
      });
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error creando product");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Products</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar products.
        </p>
      )}

      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
      >
        <input
          className="input"
          disabled={!canCreate}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="code"
        />
        <input
          className="input"
          disabled={!canCreate}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description"
          style={{ minWidth: 280 }}
        />
        <input
          className="input"
          disabled={!canCreate}
          value={unitOfMeasure}
          onChange={(e) => setUnitOfMeasure(e.target.value)}
          placeholder="unitOfMeasure"
          style={{ width: 140 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!canCreate || loading}>
          {loading ? "Creando..." : "Crear"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {items.length === 0 ? (
        <EmptyState
          title="Sin productos"
          description="Todavía no hay productos cargados. Crea el primero para comenzar."
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>code</th>
              <th>description</th>
              <th>uom</th>
              <th>active</th>
              <th>id</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.description}</td>
                <td>{p.unitOfMeasure}</td>
                <td>{String(p.active)}</td>
                <td
                  style={{
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
