import { useEffect, useMemo, useState } from "react";
import { createTransport, deleteTransport, listTransports } from "../api/transports";
import type { Transport } from "../api/transports";
import { getUserRole, canWrite } from "../auth/rbac";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

export default function TransportsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("transports", role) : false;
  const { pushToast } = useToast();
  const [items, setItems] = useState<Transport[]>([]);
  const [plate, setPlate] = useState("");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmItem, setConfirmItem] = useState<Transport | null>(null);
  const plateError = useMemo(() => { const v = plate.trim(); if (!v) return "Patente requerida"; if (v.length < 2 || v.length > 80) return "Debe tener entre 2 y 80 caracteres"; return ""; }, [plate]);
  const typeError = useMemo(() => { const v = type.trim(); if (!v) return "Tipo requerido"; if (v.length < 2 || v.length > 80) return "Debe tener entre 2 y 80 caracteres"; return ""; }, [type]);

  async function refresh() { setItems(await listTransports()); }
  useEffect(() => { refresh().catch((e) => pushToast(getFriendlyApiError(e), "error")); }, []);
  async function handleCreate(e: React.FormEvent) { e.preventDefault(); if (!canCreate || plateError || typeError) return; setLoading(true); try { await createTransport({ plate: plate.trim(), type: type.trim(), description: description.trim() }); pushToast("Transporte creado", "success"); setPlate(""); setType(""); setDescription(""); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }
  async function handleDelete() { if (!confirmItem) return; setLoading(true); try { await deleteTransport(confirmItem.id); pushToast("Eliminado correctamente", "success"); setConfirmItem(null); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }

  return <div><h2>Transports</h2><form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}><div><input className="input" disabled={!canCreate} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="plate" />{plateError && <small style={{ color: "#b91c1c" }}>{plateError}</small>}</div><div><input className="input" disabled={!canCreate} value={type} onChange={(e) => setType(e.target.value)} placeholder="type" />{typeError && <small style={{ color: "#b91c1c" }}>{typeError}</small>}</div><input className="input" disabled={!canCreate} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="description" style={{ minWidth: 260 }} /><button className="btn btn--primary" type="submit" disabled={!canCreate || loading || !!plateError || !!typeError}>{loading ? "Guardando..." : "Guardar"}</button></form><table className="table"><thead><tr><th>plate</th><th>type</th><th>description</th><th>active</th><th>id</th><th /></tr></thead><tbody>{items.map((t) => <tr key={t.id}><td>{t.plate}</td><td>{t.type}</td><td>{t.description}</td><td>{String(t.active)}</td><td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.id}</td><td><button className="btn" disabled={!canCreate} onClick={() => setConfirmItem(t)}>Eliminar</button></td></tr>)}</tbody></table><ConfirmDialog open={!!confirmItem} title="Confirmar eliminación" description={`¿Eliminar transporte ${confirmItem?.plate}?`} confirmText="Eliminar" cancelText="Cancelar" onConfirm={handleDelete} onCancel={() => setConfirmItem(null)} loading={loading} /></div>;
}
