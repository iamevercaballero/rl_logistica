import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProducts, type Product } from "../api/products";
import { getStockReport } from "../api/reports";
import { useActiveWarehouseId } from "../contexts/WarehouseContext";
import { fmtQty, roundQty } from "../utils/quantity";

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
  // El catálogo (código, descripción, atributos) es el mismo en cualquier
  // depósito y no se re-pide al cambiar — pero el STOCK sí es por depósito.
  // Sin esto, la columna Stock seguía mostrando el número del depósito
  // anterior después de cambiar el activo.
  const activeWarehouseId = useActiveWarehouseId();

  const productsQ = useQuery({ queryKey: ["products", "catalog"], queryFn: () => listProducts() });
  const stockQ = useQuery({
    queryKey: ["stock", "report", "catalog", activeWarehouseId],
    queryFn: () => getStockReport(activeWarehouseId),
    enabled: !!activeWarehouseId,
  });

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQ.data?.byMaterial ?? []) map.set(row.productId, row.quantity);
    return map;
  }, [stockQ.data]);

  /** Stock registrado sin sector físico: existe, pero una Salida no lo ofrece. */
  const unlocatedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQ.data?.items ?? []) {
      if (row.location || row.currentQuantity <= 0) continue;
      const productId = row.material.id;
      map.set(productId, roundQty((map.get(productId) ?? 0) + row.currentQuantity));
    }
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
                {items.map((p) => {
                  const stock = stockByProduct.get(p.id) ?? 0;
                  const unlocated = unlocatedByProduct.get(p.id) ?? 0;
                  return <tr key={p.id}>
                    <td><strong>{p.code}</strong></td>
                    <td>{p.description}</td>
                    <td><span className="badge">{p.unitOfMeasure ?? "-"}</span></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {stockQ.isLoading ? "…" : (
                        <>
                          <div>{fmtQty(stock)}</div>
                          {unlocated > 0 && (
                            <div style={{ color: "var(--warning, #b45309)", fontSize: 10, whiteSpace: "nowrap" }}
                              title="Este stock no tiene sector asignado y no puede seleccionarse en una Salida">
                              {fmtQty(unlocated)} sin ubicación
                            </div>
                          )}
                        </>
                      )}
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
                  </tr>;
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
