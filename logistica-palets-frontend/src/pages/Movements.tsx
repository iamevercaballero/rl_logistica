import { useEffect, useState } from "react";
import { movementEntry, movementExit, movementTransfer } from "../api/movements";
import { listLots } from "../api/lots";
import type { Lot } from "../api/lots";
import { listLocations } from "../api/locations";
import type { Location } from "../api/locations";
import { listPallets } from "../api/pallets";
import type { Pallet } from "../api/pallets";
import { getUserRole, canWrite } from "../auth/rbac";

export default function MovementsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("movements", role) : false;

  const [lots, setLots] = useState<Lot[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // ENTRY
  const [entryRef, setEntryRef] = useState("Ingreso UI");
  const [entryLotId, setEntryLotId] = useState("");
  const [entryLocId, setEntryLocId] = useState("");
  const [entryPalletCode, setEntryPalletCode] = useState("PAL-UI-001");
  const [entryQty, setEntryQty] = useState(10);

  // EXIT
  const [exitRef, setExitRef] = useState("Salida UI");
  const [exitPalletId, setExitPalletId] = useState("");
  const [exitQty, setExitQty] = useState(1);

  // TRANSFER
  const [trRef, setTrRef] = useState("Transfer UI");
  const [trPalletId, setTrPalletId] = useState("");
  const [trDestLocId, setTrDestLocId] = useState("");
  const [trQty, setTrQty] = useState(1);

  async function refresh() {
    const [lotsData, locsData, palletsData] = await Promise.all([
      listLots(),
      listLocations(),
      listPallets(),
    ]);

    setLots(lotsData);
    setLocations(locsData);
    setPallets(palletsData);

    if (!entryLotId && lotsData.length > 0) setEntryLotId(lotsData[0].id);
    if (!entryLocId && locsData.length > 0) setEntryLocId(locsData[0].id);

    if (!exitPalletId && palletsData.length > 0) setExitPalletId(palletsData[0].id);
    if (!trPalletId && palletsData.length > 0) setTrPalletId(palletsData[0].id);
    if (!trDestLocId && locsData.length > 0) setTrDestLocId(locsData[0].id);
  }

  useEffect(() => {
    refresh().catch((e: any) => setError(e?.response?.data?.message || "Error cargando datos"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearAlerts() {
    setError("");
    setMsg("");
  }

  async function handleEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    clearAlerts();
    try {
      const res = await movementEntry({
        reference: entryRef,
        notes: "Entry desde UI",
        items: [
          {
            palletCode: entryPalletCode,
            lotId: entryLotId,
            locationId: entryLocId,
            quantity: entryQty,
          },
        ],
      });
      setMsg(`✅ Entrada OK. movementId=${res.movementId}`);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error en entrada");
    }
  }

  async function handleExit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    clearAlerts();
    try {
      const res = await movementExit({
        reference: exitRef,
        notes: "Exit desde UI",
        items: [{ palletId: exitPalletId, quantity: exitQty }],
      });
      setMsg(`✅ Salida OK. movementId=${res.movementId}`);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error en salida");
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    clearAlerts();
    try {
      const res = await movementTransfer({
        palletId: trPalletId,
        destinationLocationId: trDestLocId,
        quantity: trQty,
        reference: trRef,
        notes: "Transfer desde UI",
      });
      setMsg(
        `✅ Transfer OK. movementId=${res.movementId}${
          res.newPalletId ? ` newPalletId=${res.newPalletId}` : ""
        }`,
      );
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Error en transferencia");
    }
  }

  return (
    <div>
      <h2>Movements</h2>

      {!canCreate && (
        <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>
          Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede registrar movimientos.
        </p>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
      {msg && <p style={{ color: "green" }}>{msg}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {/* ENTRY */}
        <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
          <h3>Entrada</h3>
          <form onSubmit={handleEntry} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input disabled={!canCreate} value={entryRef} onChange={(e) => setEntryRef(e.target.value)} placeholder="reference" />
            <input disabled={!canCreate} value={entryPalletCode} onChange={(e) => setEntryPalletCode(e.target.value)} placeholder="palletCode" />
            <input disabled={!canCreate} type="number" value={entryQty} onChange={(e) => setEntryQty(Number(e.target.value))} style={{ width: 120 }} />

            <select disabled={!canCreate} value={entryLotId} onChange={(e) => setEntryLotId(e.target.value)}>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lotCode} {l.product?.code ? `(${l.product.code})` : ""}
                </option>
              ))}
            </select>

            <select disabled={!canCreate} value={entryLocId} onChange={(e) => setEntryLocId(e.target.value)}>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                </option>
              ))}
            </select>

            <button type="submit" disabled={!canCreate}>Registrar entrada</button>
          </form>
        </section>

        {/* EXIT */}
        <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
          <h3>Salida</h3>
          <form onSubmit={handleExit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input disabled={!canCreate} value={exitRef} onChange={(e) => setExitRef(e.target.value)} placeholder="reference" />
            <input disabled={!canCreate} type="number" value={exitQty} onChange={(e) => setExitQty(Number(e.target.value))} style={{ width: 120 }} />

            <select disabled={!canCreate} value={exitPalletId} onChange={(e) => setExitPalletId(e.target.value)}>
              {pallets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} (qty={p.quantity})
                </option>
              ))}
            </select>

            <button type="submit" disabled={!canCreate}>Registrar salida</button>
          </form>
        </section>

        {/* TRANSFER */}
        <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
          <h3>Transferencia</h3>
          <form onSubmit={handleTransfer} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input disabled={!canCreate} value={trRef} onChange={(e) => setTrRef(e.target.value)} placeholder="reference" />
            <input disabled={!canCreate} type="number" value={trQty} onChange={(e) => setTrQty(Number(e.target.value))} style={{ width: 120 }} />

            <select disabled={!canCreate} value={trPalletId} onChange={(e) => setTrPalletId(e.target.value)}>
              {pallets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} (qty={p.quantity})
                </option>
              ))}
            </select>

            <select disabled={!canCreate} value={trDestLocId} onChange={(e) => setTrDestLocId(e.target.value)}>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                </option>
              ))}
            </select>

            <button type="submit" disabled={!canCreate}>Registrar transferencia</button>
          </form>
        </section>
      </div>
    </div>
  );
}
