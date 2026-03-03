import { useEffect, useState } from "react";
import { createPallet, listPallets } from "../api/pallets";
import type { Pallet } from "../api/pallets";

import { listLots } from "../api/lots";
import type { Lot } from "../api/lots";

import { listLocations } from "../api/locations";
import type { Location } from "../api/locations";

import { getUserRole, canWrite } from "../auth/rbac";

export default function PalletsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("pallets", role) : false;

  const [items, setItems] = useState<Pallet[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lotId, setLotId] = useState("");
  const [locationId, setLocationId] = useState("");

  const [code, setCode] = useState("PALLET-0002");
  const [quantity, setQuantity] = useState(100);
  const [status, setStatus] = useState("AVAILABLE");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const [pallets, lotsData, locsData] = await Promise.all([
      listPallets(),
      listLots(),
      listLocations(),
    ]);

    setItems(pallets);
    setLots(lotsData);
    setLocations(locsData);

    if (!lotId && lotsData.length > 0) setLotId(lotsData[0].id);
    if (!locationId && locsData.length > 0) setLocationId(locsData[0].id);
  }

  useEffect(() => {
    refresh().catch((e: any) => setError(e?.response?.data?.message || "Error cargando pallets"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    if (!lotId) return setError("Seleccioná un lote");
    if (!locationId) return setError("Seleccioná una ubicación");

    setError("");
    setLoading(true);
    try {
      await createPallet({
        code,
        lotId,
        quantity: Number(quantity),
        currentLocationId: locationId,
        status,
      });
      setCode("");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error creando pallet");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Pallets</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar pallets.
        </p>
      )}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input disabled={!canCreate} value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" />

        <input
          disabled={!canCreate}
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          placeholder="quantity"
          style={{ width: 120 }}
        />

        <select disabled={!canCreate} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="AVAILABLE">AVAILABLE</option>
          <option value="BLOCKED">BLOCKED</option>
          <option value="DAMAGED">DAMAGED</option>
          <option value="IN_TRANSIT">IN_TRANSIT</option>
        </select>

        <select disabled={!canCreate} value={lotId} onChange={(e) => setLotId(e.target.value)}>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>
              {l.lotCode} {l.product?.code ? `(${l.product.code})` : ""}
            </option>
          ))}
        </select>

        <select disabled={!canCreate} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.code}
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
            <th>quantity</th>
            <th>status</th>
            <th>lotId</th>
            <th>locationId</th>
            <th>id</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>{p.code}</td>
              <td>{p.quantity}</td>
              <td>{p.status}</td>
              <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.lotId}
              </td>
              <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.currentLocationId}
              </td>
              <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
