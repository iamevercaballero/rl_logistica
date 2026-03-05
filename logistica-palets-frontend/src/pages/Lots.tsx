import { useEffect, useMemo, useState } from "react";
import { createLot, deleteLot, listLots } from "../api/lots";
import type { Lot } from "../api/lots";
import { listProducts } from "../api/products";
import type { Product } from "../api/products";
import { getUserRole, canWrite } from "../auth/rbac";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

export default function LotsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("lots", role) : false;
  const { pushToast } = useToast();
  const [items, setItems] = useState<Lot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmItem, setConfirmItem] = useState<Lot | null>(null);
  const codeError = useMemo(() => { const v = lotCode.trim(); if (!v) return "Código requerido"; if (v.length < 2 || v.length > 80) return "Debe tener entre 2 y 80 caracteres"; return ""; }, [lotCode]);
  async function refresh() { const [lots, prods] = await Promise.all([listLots(), listProducts()]); setItems(lots); setProducts(prods); if (!productId && prods.length) setProductId(prods[0].id); }
  useEffect(() => { refresh().catch((e) => pushToast(getFriendlyApiError(e), "error")); }, []);
  async function handleCreate(e: React.FormEvent) { e.preventDefault(); if (!canCreate || codeError || !productId) return; setLoading(true); try { await createLot({ lotCode: lotCode.trim(), productId }); pushToast("Lote creado", "success"); setLotCode(""); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }
  async function handleDelete() { if (!confirmItem) return; setLoading(true); try { await deleteLot(confirmItem.id); pushToast("Eliminado correctamente", "success"); setConfirmItem(null); await refresh(); } catch (e) { pushToast(getFriendlyApiError(e), "error"); } finally { setLoading(false); } }

  return <div><h2>Lots</h2><form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}><select className="input" disabled={!canCreate} value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.description}</option>)}</select><div><input className="input" disabled={!canCreate} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="lotCode" />{codeError && <small style={{ color: "#b91c1c" }}>{codeError}</small>}</div><button className="btn btn--primary" type="submit" disabled={!canCreate || loading || !!codeError || !productId}>{loading ? "Guardando..." : "Guardar"}</button></form><table className="table"><thead><tr><th>lotCode</th><th>product</th><th>id</th><th /></tr></thead><tbody>{items.map((l) => <tr key={l.id}><td>{l.lotCode}</td><td>{l.product?.code}</td><td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.id}</td><td><button className="btn" disabled={!canCreate} onClick={() => setConfirmItem(l)}>Eliminar</button></td></tr>)}</tbody></table><ConfirmDialog open={!!confirmItem} title="Confirmar eliminación" description={`¿Eliminar lote ${confirmItem?.lotCode}?`} confirmText="Eliminar" cancelText="Cancelar" onConfirm={handleDelete} onCancel={() => setConfirmItem(null)} loading={loading} /></div>;
}
