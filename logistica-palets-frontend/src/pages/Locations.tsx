import { useEffect, useMemo, useState } from "react";
import { createLocation, deleteLocation, listLocations } from "../api/locations";
import type { Location } from "../api/locations";
import { listWarehouses } from "../api/warehouses";
import type { Warehouse } from "../api/warehouses";
import { getUserRole, canWrite } from "../auth/rbac";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

export default function LocationsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("locations", role) : false;
  const { pushToast } = useToast();
  const [items, setItems] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [code, setCode] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmItem, setConfirmItem] = useState<Location | null>(null);
  const codeError = useMemo(() => { const v = code.trim(); if (!v) return "Código requerido"; if (v.length < 2 || v.length > 80) return "Debe tener entre 2 y 80 caracteres"; return ""; }, [code]);

  async function refresh() { const [locs, whs] = await Promise.all([listLocations(), listWarehouses()]); setItems(locs); setWarehouses(whs); if (!warehouseId && whs.length) setWarehouseId(whs[0].id); }
  useEffect(() => { refresh().catch((e) => pushToast(getFriendlyApiError(e), "error")); }, []);
  async function handleCreate(e: React.FormEvent) { e.preventDefault(); if (!canCreate || codeError || !warehouseId) return; setLoading(true); try { await createLocation({ code: code.trim(), warehouseId }); pushToast("Ubicación creada", "success"); setCode(""); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }
  async function handleDelete() { if (!confirmItem) return; setLoading(true); try { await deleteLocation(confirmItem.id); pushToast("Eliminado correctamente", "success"); setConfirmItem(null); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }

  return <div><h2>Locations</h2><form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}><div><input className="input" disabled={!canCreate} value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" />{codeError && <small style={{ color: "#b91c1c" }}>{codeError}</small>}</div><select className="input" disabled={!canCreate} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button className="btn btn--primary" type="submit" disabled={!canCreate || loading || !!codeError || !warehouseId}>{loading ? "Guardando..." : "Guardar"}</button></form><table className="table"><thead><tr><th>code</th><th>warehouse</th><th>id</th><th /></tr></thead><tbody>{items.map((loc) => <tr key={loc.id}><td>{loc.code}</td><td>{loc.warehouse?.name ?? loc.warehouseId}</td><td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc.id}</td><td><button className="btn" disabled={!canCreate} onClick={() => setConfirmItem(loc)}>Eliminar</button></td></tr>)}</tbody></table><ConfirmDialog open={!!confirmItem} title="Confirmar eliminación" description={`¿Eliminar ubicación ${confirmItem?.code}?`} confirmText="Eliminar" cancelText="Cancelar" onConfirm={handleDelete} onCancel={() => setConfirmItem(null)} loading={loading} /></div>;
}
