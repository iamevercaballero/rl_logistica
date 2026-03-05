import { useEffect, useMemo, useState } from "react";
import { createPallet, deletePallet, listPallets } from "../api/pallets";
import type { Pallet } from "../api/pallets";
import { listLots } from "../api/lots";
import type { Lot } from "../api/lots";
import { listLocations } from "../api/locations";
import type { Location } from "../api/locations";
import { getUserRole, canWrite } from "../auth/rbac";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

export default function PalletsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("pallets", role) : false;
  const { pushToast } = useToast();
  const [items, setItems] = useState<Pallet[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lotId, setLotId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState("AVAILABLE");
  const [loading, setLoading] = useState(false);
  const [confirmItem, setConfirmItem] = useState<Pallet | null>(null);
  const codeError = useMemo(() => { const v = code.trim(); if (!v) return "Código requerido"; if (v.length < 2 || v.length > 80) return "Debe tener entre 2 y 80 caracteres"; return ""; }, [code]);
  const qtyError = quantity < 0 ? "La cantidad debe ser >= 0" : "";

  async function refresh() { const [pallets, lotsData, locsData] = await Promise.all([listPallets(), listLots(), listLocations()]); setItems(pallets); setLots(lotsData); setLocations(locsData); if (!lotId && lotsData.length) setLotId(lotsData[0].id); if (!locationId && locsData.length) setLocationId(locsData[0].id); }
  useEffect(() => { refresh().catch((e) => pushToast(getFriendlyApiError(e), "error")); }, []);
  async function handleCreate(e: React.FormEvent) { e.preventDefault(); if (!canCreate || codeError || qtyError || !lotId || !locationId) return; setLoading(true); try { await createPallet({ code: code.trim(), lotId, quantity: Number(quantity), currentLocationId: locationId, status }); pushToast("Pallet creado", "success"); setCode(""); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }
  async function handleDelete() { if (!confirmItem) return; setLoading(true); try { await deletePallet(confirmItem.id); pushToast("Eliminado correctamente", "success"); setConfirmItem(null); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }

  return <div><h2>Pallets</h2><form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}><div><input className="input" disabled={!canCreate} value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" />{codeError && <small style={{ color: "#b91c1c" }}>{codeError}</small>}</div><div><input className="input" disabled={!canCreate} type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} style={{ width: 120 }} />{qtyError && <small style={{ color: "#b91c1c" }}>{qtyError}</small>}</div><select className="input" disabled={!canCreate} value={status} onChange={(e) => setStatus(e.target.value)}><option value="AVAILABLE">AVAILABLE</option><option value="BLOCKED">BLOCKED</option><option value="DAMAGED">DAMAGED</option><option value="IN_TRANSIT">IN_TRANSIT</option></select><select className="input" disabled={!canCreate} value={lotId} onChange={(e) => setLotId(e.target.value)}>{lots.map((l) => <option key={l.id} value={l.id}>{l.lotCode}</option>)}</select><select className="input" disabled={!canCreate} value={locationId} onChange={(e) => setLocationId(e.target.value)}>{locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.code}</option>)}</select><button className="btn btn--primary" type="submit" disabled={!canCreate || loading || !!codeError || !!qtyError || !lotId || !locationId}>{loading ? "Guardando..." : "Guardar"}</button></form><table className="table"><thead><tr><th>code</th><th>quantity</th><th>status</th><th>id</th><th /></tr></thead><tbody>{items.map((p) => <tr key={p.id}><td>{p.code}</td><td>{p.quantity}</td><td>{p.status}</td><td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.id}</td><td><button className="btn" disabled={!canCreate} onClick={() => setConfirmItem(p)}>Eliminar</button></td></tr>)}</tbody></table><ConfirmDialog open={!!confirmItem} title="Confirmar eliminación" description={`¿Eliminar pallet ${confirmItem?.code}?`} confirmText="Eliminar" cancelText="Cancelar" onConfirm={handleDelete} onCancel={() => setConfirmItem(null)} loading={loading} /></div>;
}
