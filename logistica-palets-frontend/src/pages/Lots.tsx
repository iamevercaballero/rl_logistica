import { useEffect, useState } from "react";
import { createLot, listLots } from "../api/lots";
import type { Lot } from "../api/lots";
import { listProducts } from "../api/products";
import type { Product } from "../api/products";
import { getUserRole, canWrite } from "../auth/rbac";

export default function LotsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("lots", role) : false;

  const [items, setItems] = useState<Lot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [lotCode, setLotCode] = useState("LOT-002");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const [lots, prods] = await Promise.all([listLots(), listProducts()]);
    setItems(lots);
    setProducts(prods);
    if (!productId && prods.length > 0) setProductId(prods[0].id);
  }

  useEffect(() => {
    refresh().catch((e: any) => setError(e?.response?.data?.message || "Error cargando lots"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    if (!productId) return setError("Seleccioná un producto");

    setError("");
    setLoading(true);
    try {
      await createLot({ lotCode, productId });
      setLotCode("");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error creando lot");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Lots</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar lots.
        </p>
      )}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select disabled={!canCreate} value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} - {p.description}
            </option>
          ))}
        </select>

        <input
          disabled={!canCreate}
          value={lotCode}
          onChange={(e) => setLotCode(e.target.value)}
          placeholder="lotCode (ej: LOT-001)"
        />

        <button type="submit" disabled={!canCreate || loading}>
          {loading ? "Creando..." : "Crear"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <table border={1} cellPadding={8}>
        <thead>
          <tr>
            <th>lotCode</th>
            <th>product</th>
            <th>id</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id}>
              <td>{l.lotCode}</td>
              <td>{l.product?.code ? l.product.code : "(sin eager product)"}</td>
              <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
