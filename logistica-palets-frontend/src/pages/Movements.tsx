import { useCallback, useEffect, useMemo, useState } from "react";
import { createMovement, getMovements, type Movement, type MovementType } from "../api/movements";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { listLocations, type Location } from "../api/locations";
import { listProducts, type Product } from "../api/products";
import { getFriendlyApiError } from "../utils/apiError";

type Filters = {
  type: "" | MovementType;
  warehouseId: string;
  productId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

type FormState = {
  type: MovementType;
  productId: string;
  quantity: string;
  pallets: string;
  warehouseId: string;
  locationId: string;
  fromLocationId: string;
  toLocationId: string;
  documentNumber: string;
  supplier: string;
  carrier: string;
  driver: string;
  destination: string;
  notes: string;
};

const initialFilters: Filters = {
  type: "",
  warehouseId: "",
  productId: "",
  dateFrom: "",
  dateTo: "",
  search: "",
};

const initialForm: FormState = {
  type: "ENTRY",
  productId: "",
  quantity: "",
  pallets: "",
  warehouseId: "",
  locationId: "",
  fromLocationId: "",
  toLocationId: "",
  documentNumber: "",
  supplier: "",
  carrier: "",
  driver: "",
  destination: "",
  notes: "",
};

export default function MovementsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [data, setData] = useState<Movement[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);
  const [form, setForm] = useState<FormState>(initialForm);

  const filteredLocations = useMemo(() => {
    if (form.type === "TRANSFER") return locations;
    if (!form.warehouseId) return locations;
    return locations.filter((location) => location.warehouse?.id === form.warehouseId || location.warehouseId === form.warehouseId);
  }, [form.type, form.warehouseId, locations]);

  const refresh = useCallback(async (page = 1, limit = 20, current = initialFilters) => {
    setLoading(true);
    setError("");

    try {
      const response = await getMovements({
        page,
        limit,
        type: current.type || undefined,
        warehouseId: current.warehouseId || undefined,
        productId: current.productId || undefined,
        dateFrom: current.dateFrom || undefined,
        dateTo: current.dateTo || undefined,
        search: current.search.trim() || undefined,
      });

      setData(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([listWarehouses(), listLocations(), listProducts()])
      .then(([warehouseData, locationData, productData]) => {
        setWarehouses(warehouseData);
        setLocations(locationData);
        setProducts(productData);
      })
      .catch(() => undefined);

    refresh(1, 20, initialFilters).catch(() => undefined);
  }, [refresh]);

  function applyFilters() {
    setAppliedFilters(filters);
    refresh(1, meta.limit, filters).catch(() => undefined);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    refresh(1, meta.limit, initialFilters).catch(() => undefined);
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await createMovement({
        type: form.type,
        productId: form.productId,
        quantity: Number(form.quantity),
        pallets: form.pallets ? Number(form.pallets) : undefined,
        warehouseId: form.type !== "TRANSFER" ? form.warehouseId || undefined : undefined,
        locationId: form.type !== "TRANSFER" ? form.locationId || undefined : undefined,
        fromLocationId: form.type === "TRANSFER" ? form.fromLocationId || undefined : undefined,
        toLocationId: form.type === "TRANSFER" ? form.toLocationId || undefined : undefined,
        documentNumber: form.documentNumber || undefined,
        supplier: form.supplier || undefined,
        carrier: form.carrier || undefined,
        driver: form.driver || undefined,
        destination: form.destination || undefined,
        notes: form.notes || undefined,
      });
      setForm(initialForm);
      await refresh(1, meta.limit, appliedFilters);
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Movimientos operativos</h2>
      <p style={{ color: "#6b7280" }}>El flujo ahora se registra por material, cantidad y ubicación, no por pallet como eje principal.</p>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Registrar movimiento</h3>
        <form onSubmit={handleCreate} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <select className="input" value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as MovementType }))}>
              <option value="ENTRY">ENTRY</option>
              <option value="EXIT">EXIT</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="ADJUSTMENT_IN">ADJUSTMENT_IN</option>
              <option value="ADJUSTMENT_OUT">ADJUSTMENT_OUT</option>
              <option value="REPROCESS">REPROCESS</option>
            </select>
            <select className="input" value={form.productId} onChange={(event) => setForm((prev) => ({ ...prev, productId: event.target.value }))}>
              <option value="">Material</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.code} · {product.description}</option>
              ))}
            </select>
            <input className="input" type="number" min={1} placeholder="Cantidad" value={form.quantity} onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))} />
            <input className="input" type="number" min={1} placeholder="Paletas (opcional)" value={form.pallets} onChange={(event) => setForm((prev) => ({ ...prev, pallets: event.target.value }))} />
          </div>

          {form.type === "TRANSFER" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              <select className="input" value={form.fromLocationId} onChange={(event) => setForm((prev) => ({ ...prev, fromLocationId: event.target.value }))}>
                <option value="">Ubicación origen</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.warehouse?.name}</option>)}
              </select>
              <select className="input" value={form.toLocationId} onChange={(event) => setForm((prev) => ({ ...prev, toLocationId: event.target.value }))}>
                <option value="">Ubicación destino</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.warehouse?.name}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              <select className="input" value={form.warehouseId} onChange={(event) => setForm((prev) => ({ ...prev, warehouseId: event.target.value, locationId: "" }))}>
                <option value="">Depósito</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
              <select className="input" value={form.locationId} onChange={(event) => setForm((prev) => ({ ...prev, locationId: event.target.value }))}>
                <option value="">Ubicación</option>
                {filteredLocations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.warehouse?.name}</option>)}
              </select>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <input className="input" placeholder="Documento / remito" value={form.documentNumber} onChange={(event) => setForm((prev) => ({ ...prev, documentNumber: event.target.value }))} />
            <input className="input" placeholder="Proveedor" value={form.supplier} onChange={(event) => setForm((prev) => ({ ...prev, supplier: event.target.value }))} />
            <input className="input" placeholder="Transportadora" value={form.carrier} onChange={(event) => setForm((prev) => ({ ...prev, carrier: event.target.value }))} />
            <input className="input" placeholder="Conductor" value={form.driver} onChange={(event) => setForm((prev) => ({ ...prev, driver: event.target.value }))} />
            <input className="input" placeholder="Destino" value={form.destination} onChange={(event) => setForm((prev) => ({ ...prev, destination: event.target.value }))} />
          </div>

          <textarea className="input" placeholder="Notas / observación" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} rows={3} />

          {formError ? <p style={{ color: "#b91c1c", margin: 0 }}>{formError}</p> : null}
          <div>
            <button className="btn btn--primary" type="submit" disabled={saving}>{saving ? "Guardando..." : "Registrar movimiento"}</button>
          </div>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value as Filters["type"] }))}>
            <option value="">Todos los tipos</option>
            <option value="ENTRY">ENTRY</option>
            <option value="EXIT">EXIT</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="ADJUSTMENT_IN">ADJUSTMENT_IN</option>
            <option value="ADJUSTMENT_OUT">ADJUSTMENT_OUT</option>
            <option value="REPROCESS">REPROCESS</option>
          </select>
          <select className="input" value={filters.warehouseId} onChange={(event) => setFilters((prev) => ({ ...prev, warehouseId: event.target.value }))}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <select className="input" value={filters.productId} onChange={(event) => setFilters((prev) => ({ ...prev, productId: event.target.value }))}>
            <option value="">Todos los materiales</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.code}</option>)}
          </select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
          <input className="input" placeholder="Buscar por material, documento, proveedor..." value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} style={{ minWidth: 260 }} />
          <button className="btn btn--primary" onClick={applyFilters}>Aplicar</button>
          <button className="btn" onClick={clearFilters}>Limpiar</button>
        </div>
      </section>

      {loading ? <p>Cargando...</p> : null}
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={() => refresh(meta.page, meta.limit, appliedFilters)}>Reintentar</button>
        </div>
      ) : null}

      {!loading && !error ? (
        data.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Material</th>
                <th>Cantidad</th>
                <th>Ubicación</th>
                <th>Documento</th>
                <th>Extra</th>
              </tr>
            </thead>
            <tbody>
              {data.map((movement) => (
                <tr key={movement.id}>
                  <td>{new Date(movement.date).toLocaleString()}</td>
                  <td>{movement.type}</td>
                  <td>{movement.material.code} · {movement.material.description}</td>
                  <td>{movement.quantity} {movement.material.unitOfMeasure ?? ""}</td>
                  <td>
                    {movement.type === "TRANSFER"
                      ? `${movement.from?.locationCode ?? "-"} → ${movement.to?.locationCode ?? "-"}`
                      : `${movement.warehouse?.name ?? "-"} / ${movement.location?.code ?? "-"}`}
                  </td>
                  <td>{movement.documentNumber || "-"}</td>
                  <td>{movement.destination || movement.supplier || movement.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button className="btn" disabled={loading || meta.page <= 1} onClick={() => refresh(meta.page - 1, meta.limit, appliedFilters)}>Anterior</button>
        <span>Página {meta.page} de {meta.totalPages}</span>
        <button className="btn" disabled={loading || meta.page >= meta.totalPages} onClick={() => refresh(meta.page + 1, meta.limit, appliedFilters)}>Siguiente</button>
        <select className="input" value={meta.limit} onChange={(event) => refresh(1, Number(event.target.value), appliedFilters)}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>
    </div>
  );
}
