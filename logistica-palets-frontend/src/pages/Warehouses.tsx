import { useEffect, useMemo, useState } from "react";
import { createWarehouse, deleteWarehouse, listWarehouses } from "../api/warehouses";
import type { Warehouse } from "../api/warehouses";
import { getUserRole, canWrite } from "../auth/rbac";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

export default function WarehousesPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("warehouses", role) : false;
  const { pushToast } = useToast();
  const [items, setItems] = useState<Warehouse[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmItem, setConfirmItem] = useState<Warehouse | null>(null);

  const nameError = useMemo(() => {
    const value = name.trim();
    if (!value) return "Nombre requerido";
    if (value.length < 2 || value.length > 80) return "Debe tener entre 2 y 80 caracteres";
    return "";
  }, [name]);

  async function refresh() { setItems(await listWarehouses()); }
  useEffect(() => { refresh().catch((e) => pushToast(getFriendlyApiError(e), "error")); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || nameError) return;
    setLoading(true);
    try { await createWarehouse({ name: name.trim(), address: address.trim(), active: true }); pushToast("Depósito creado", "success"); setName(""); setAddress(""); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); }
  }

  async function handleDelete() {
    if (!confirmItem) return;
    setLoading(true);
    try { await deleteWarehouse(confirmItem.id); pushToast("Eliminado correctamente", "success"); setConfirmItem(null); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); }
  }

  return <div><h2>Warehouses</h2>{!canCreate && <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar warehouses.</p>}<form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}><div><input className="input" disabled={!canCreate} value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />{nameError && <small style={{ color: "#b91c1c" }}>{nameError}</small>}</div><input className="input" disabled={!canCreate} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="address" style={{ minWidth: 320 }} /><button className="btn btn--primary" type="submit" disabled={!canCreate || loading || !!nameError}>{loading ? "Guardando..." : "Guardar"}</button></form><table className="table"><thead><tr><th>name</th><th>address</th><th>active</th><th>id</th><th /></tr></thead><tbody>{items.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.address}</td><td>{String(w.active)}</td><td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.id}</td><td><button className="btn" disabled={!canCreate} onClick={() => setConfirmItem(w)}>Eliminar</button></td></tr>)}</tbody></table><ConfirmDialog open={!!confirmItem} title="Confirmar eliminación" description={`¿Eliminar depósito ${confirmItem?.name}?`} confirmText="Eliminar" cancelText="Cancelar" onConfirm={handleDelete} onCancel={() => setConfirmItem(null)} loading={loading} /></div>;
}
