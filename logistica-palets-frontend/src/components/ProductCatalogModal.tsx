import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProducts, type Product } from "../api/products";
import { getStockReport } from "../api/reports";

type Props = {
  onSelect: (product: Product) => void;
  onClose: () => void;
  /** Si true, solo muestra materiales activos. Default: false (muestra todos). */
  onlyActive?: boolean;
};

/**
 * Ficha "Ver productos": catálogo buscable con stock, atributos logísticos y
 * acción de selección. Usado desde Entrada/Salida para elegir un material sin
 * tener que recordar el código exacto.
 */
export default function ProductCatalogModal({ onSelect, onClose, onlyActive }: Props) {
  const [search, setSearch] = useState("");

  const productsQ = useQuery({ queryKey: ["products", "catalog"], queryFn: () => listProducts() });
  const stockQ = useQuery({ queryKey: ["stock-report", "catalog"], queryFn: () => getStockReport() });

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQ.data?.byMaterial ?? []) map.set(row.productId, row.quantity);
    return map;
  }, [stockQ.data]);

  const items = useMemo(() => {
    let list = productsQ.data ?? [];
    if (onlyActive) list = list.filter((p) => p.active);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => `${p.code} ${p.description}`.toLowerCase().includes(q));
    return list;
  }, [productsQ.data, search, onlyActive]);

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      role="dialog" aria-modal="true" aria-label="Ver productos"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 880, maxHeight: "88vh", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Productos disponibles</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <input
          className="input"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar código o descripción…"
          aria-label="Buscar productos"
        />

        <div style={{ overflowY: "auto", flex: 1 }}>
          {productsQ.isLoading ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando…</p>
          ) : items.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Sin resultados</p>
          ) : (
            <table className="table" aria-label="Catálogo de productos">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Unidad</th>
                  <th scope="col" style={{ textAlign: "right" }}>Stock</th>
                  <th scope="col" style={{ textAlign: "center" }}>Apilable</th>
                  <th scope="col" style={{ textAlign: "center" }}>Recibe peso</th>
                  <th scope="col">Estado</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.code}</strong></td>
                    <td>{p.description}</td>
                    <td><span className="badge">{p.unitOfMeasure ?? "-"}</span></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {stockQ.isLoading ? "…" : (stockByProduct.get(p.id) ?? 0)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`badge ${p.stackable === false ? "" : "badge--entry"}`}>
                        {p.stackable === false ? "No" : "Sí"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`badge ${p.canReceiveWeightOnTop === false ? "" : "badge--entry"}`}>
                        {p.canReceiveWeightOnTop === false ? "No" : "Sí"}
                      </span>
                    </td>
                    <td>
                      <span className={p.active ? "badge badge--entry" : "badge"}>
                        {p.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => { onSelect(p); onClose(); }}
                        disabled={!p.active}
                        title={p.active ? "Seleccionar producto" : "Material inactivo"}
                      >
                        Seleccionar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
