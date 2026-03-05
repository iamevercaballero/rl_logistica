import { useEffect, useMemo, useState } from "react";
import { createProduct, deleteProduct, listProducts } from "../api/products";
import type { Product } from "../api/products";
import { getUserRole, canWrite } from "../auth/rbac";
import { EmptyState } from "../components/EmptyState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { getFriendlyApiError } from "../utils/apiError";

export default function ProductsPage() {
  const role = getUserRole();
  const canCreate = role ? canWrite("products", role) : false;
  const { pushToast } = useToast();

  const [items, setItems] = useState<Product[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("UN");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [confirmItem, setConfirmItem] = useState<Product | null>(null);

  const codeError = useMemo(() => {
    const value = code.trim();
    if (!value) return "Código requerido";
    if (value.length < 2 || value.length > 80) return "Debe tener entre 2 y 80 caracteres";
    return "";
  }, [code]);

  const descError = useMemo(() => {
    const value = description.trim();
    if (!value) return "Nombre/Descripción requerida";
    if (value.length < 2 || value.length > 80) return "Debe tener entre 2 y 80 caracteres";
    return "";
  }, [description]);

  async function refresh() {
    setItems(await listProducts());
  }

  useEffect(() => {
    refresh().catch((e) => pushToast(getFriendlyApiError(e), "error"));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || codeError || descError) return;

    setLoading(true);
    try {
      await createProduct({ code: code.trim(), description: description.trim(), unitOfMeasure: unitOfMeasure.trim(), active: true });
      pushToast("Producto creado", "success");
      setCode("");
      setDescription("");
      await refresh();
    } catch (e) {
      pushToast(getFriendlyApiError(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirmItem) return;
    setDeletingId(confirmItem.id);
    try {
      await deleteProduct(confirmItem.id);
      pushToast("Eliminado correctamente", "success");
      setConfirmItem(null);
      await refresh();
    } catch (e) {
      pushToast(getFriendlyApiError(e), "error");
    } finally {
      setDeletingId("");
    }
  }

  return <div><h2>Products</h2>{!canCreate && <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8 }}>Solo lectura: tu rol <strong>{role ?? "SIN_ROLE"}</strong> no puede crear/editar products.</p>}<form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}><div><input className="input" disabled={!canCreate} value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" />{codeError && <small style={{ color: "#b91c1c" }}>{codeError}</small>}</div><div><input className="input" disabled={!canCreate} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="description" style={{ minWidth: 280 }} />{descError && <small style={{ color: "#b91c1c" }}>{descError}</small>}</div><input className="input" disabled={!canCreate} value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} placeholder="unitOfMeasure" style={{ width: 140 }} /><button className="btn btn--primary" type="submit" disabled={!canCreate || loading || !!codeError || !!descError}>{loading ? "Guardando..." : "Guardar"}</button></form>{items.length === 0 ? <EmptyState title="Sin productos" description="Todavía no hay productos cargados. Crea el primero para comenzar." /> : <table className="table"><thead><tr><th>code</th><th>description</th><th>uom</th><th>active</th><th>id</th><th /></tr></thead><tbody>{items.map((p) => <tr key={p.id}><td>{p.code}</td><td>{p.description}</td><td>{p.unitOfMeasure}</td><td>{String(p.active)}</td><td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.id}</td><td><button className="btn" disabled={!canCreate} onClick={() => setConfirmItem(p)}>Eliminar</button></td></tr>)}</tbody></table>}<ConfirmDialog open={!!confirmItem} title="Confirmar eliminación" description={`¿Eliminar producto ${confirmItem?.code}?`} confirmText="Eliminar" cancelText="Cancelar" onConfirm={handleDelete} onCancel={() => setConfirmItem(null)} loading={deletingId === confirmItem?.id} /></div>;
}
