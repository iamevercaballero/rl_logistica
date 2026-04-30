import { useCallback, useEffect, useMemo, useState } from "react";
import { createMovement, getMovements, type Movement, type MovementType } from "../api/movements";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { listLocations, type Location } from "../api/locations";
import { listProducts, type Product } from "../api/products";
import { getFriendlyApiError } from "../utils/apiError";

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste entrada",
  ADJUSTMENT_OUT: "Ajuste salida",
  REPROCESS: "Reproceso",
};

const MOVE_BADGE: Record<string, string> = {
  ENTRY: "badge badge--entry",
  EXIT: "badge badge--exit",
  TRANSFER: "badge badge--transfer",
  ADJUSTMENT_IN: "badge badge--adj-in",
  ADJUSTMENT_OUT: "badge badge--adj-out",
  REPROCESS: "badge badge--reprocess",
};

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
  type: "", warehouseId: "", productId: "", dateFrom: "", dateTo: "", search: "",
};

const initialForm: FormState = {
  type: "ENTRY", productId: "", quantity: "", pallets: "",
  warehouseId: "", locationId: "", fromLocationId: "", toLocationId: "",
  documentNumber: "", supplier: "", carrier: "", driver: "", destination: "", notes: "",
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
    return locations.filter((l) => l.warehouse?.id === form.warehouseId || l.warehouseId === form.warehouseId);
  }, [form.type, form.warehouseId, locations]);

  const refresh = useCallback(async (page = 1, limit = 20, current = initialFilters) => {
    setLoading(true);
    setError("");
    try {
      const response = await getMovements({
        page, limit,
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
      .then(([w, l, p]) => { setWarehouses(w); setLocations(l); setProducts(p); })
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

  const isTransfer = form.type === "TRANSFER";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Movimientos</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Registrá entradas, salidas, transferencias y ajustes de materiales.
        </p>
      </div>

      {/* ── Formulario ── */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800 }}>Registrar movimiento</h3>
        <form onSubmit={handleCreate} style={{ display: "grid", gap: 14 }}>

          <div className="form-section-title">Tipo y material</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <select className="input" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as MovementType, locationId: "", fromLocationId: "", toLocationId: "" }))}>
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Salida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="ADJUSTMENT_IN">Ajuste entrada</option>
              <option value="ADJUSTMENT_OUT">Ajuste salida</option>
              <option value="REPROCESS">Reproceso</option>
            </select>
            <select className="input" value={form.productId} onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}>
              <option value="">Seleccionar material</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.description}</option>
              ))}
            </select>
            <input className="input" type="number" min={1} placeholder="Cantidad *" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} />
            <input className="input" type="number" min={1} placeholder="Paletas (opcional)" value={form.pallets} onChange={(e) => setForm((p) => ({ ...p, pallets: e.target.value }))} />
          </div>

          <div className="form-section-title">
            {isTransfer ? "Origen y destino" : "Depósito y ubicación"}
          </div>
          {isTransfer ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select className="input" value={form.fromLocationId} onChange={(e) => setForm((p) => ({ ...p, fromLocationId: e.target.value }))}>
                <option value="">Ubicación origen</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name}</option>)}
              </select>
              <select className="input" value={form.toLocationId} onChange={(e) => setForm((p) => ({ ...p, toLocationId: e.target.value }))}>
                <option value="">Ubicación destino</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select className="input" value={form.warehouseId} onChange={(e) => setForm((p) => ({ ...p, warehouseId: e.target.value, locationId: "" }))}>
                <option value="">Depósito</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select className="input" value={form.locationId} onChange={(e) => setForm((p) => ({ ...p, locationId: e.target.value }))}>
                <option value="">Ubicación (opcional)</option>
                {filteredLocations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name}</option>)}
              </select>
            </div>
          )}

          <div className="form-section-title">Datos logísticos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            <input className="input" placeholder="N° remito / documento" value={form.documentNumber} onChange={(e) => setForm((p) => ({ ...p, documentNumber: e.target.value }))} />
            <input className="input" placeholder="Proveedor" value={form.supplier} onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))} />
            <input className="input" placeholder="Transportadora" value={form.carrier} onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))} />
            <input className="input" placeholder="Conductor" value={form.driver} onChange={(e) => setForm((p) => ({ ...p, driver: e.target.value }))} />
            <input className="input" placeholder="Destino" value={form.destination} onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value }))} />
          </div>

          <textarea
            className="input"
            placeholder="Observaciones (opcional)"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            rows={2}
          />

          {formError && (
            <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ color: "#dc2626", fontSize: 13, fontWeight: 600 }}>{formError}</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn btn--primary" type="submit" disabled={saving || !form.productId || !form.quantity}>
              {saving ? "Guardando..." : "Registrar movimiento"}
            </button>
            <button type="button" className="btn" onClick={() => { setForm(initialForm); setFormError(""); }}>
              Limpiar
            </button>
          </div>
        </form>
      </section>

      {/* ── Filtros ── */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select className="input" value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value as Filters["type"] }))}>
            <option value="">Todos los tipos</option>
            <option value="ENTRY">Entrada</option>
            <option value="EXIT">Salida</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="ADJUSTMENT_IN">Ajuste entrada</option>
            <option value="ADJUSTMENT_OUT">Ajuste salida</option>
            <option value="REPROCESS">Reproceso</option>
          </select>
          <select className="input" value={filters.warehouseId} onChange={(e) => setFilters((p) => ({ ...p, warehouseId: e.target.value }))}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select className="input" value={filters.productId} onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}>
            <option value="">Todos los materiales</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
          <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
          <input
            className="input"
            placeholder="Buscar por material, documento, proveedor..."
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            style={{ minWidth: 240 }}
          />
          <button className="btn btn--primary" onClick={applyFilters}>Buscar</button>
          <button className="btn" onClick={clearFilters}>Limpiar</button>
        </div>
      </section>

      {/* ── Tabla ── */}
      {loading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>}
      {error && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 600 }}>{error}</span>
          <button className="btn btn--primary" onClick={() => refresh(meta.page, meta.limit, appliedFilters)}>Reintentar</button>
        </div>
      )}

      {!loading && !error && (
        data.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Sin movimientos registrados</p>
            <p className="empty__desc">Registrá el primer movimiento con el formulario de arriba.</p>
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Material</th>
                  <th>Cantidad</th>
                  <th>Ubicación</th>
                  <th>Documento</th>
                  <th>Info extra</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                      {new Date(m.date).toLocaleString("es-AR")}
                    </td>
                    <td>
                      <span className={MOVE_BADGE[m.type] ?? "badge"}>
                        {MOVE_LABEL[m.type] ?? m.type}
                      </span>
                    </td>
                    <td>
                      <strong>{m.material.code}</strong>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}> · {m.material.description}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {m.quantity.toLocaleString("es-AR")} {m.material.unitOfMeasure ?? ""}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {m.type === "TRANSFER"
                        ? <span>{m.from?.locationCode ?? "-"} <span style={{ color: "var(--primary)" }}>→</span> {m.to?.locationCode ?? "-"}</span>
                        : `${m.warehouse?.name ?? "-"} / ${m.location?.code ?? "-"}`}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{m.documentNumber || "-"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>
                      {m.destination || m.supplier || m.notes || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <button className="btn" disabled={loading || meta.page <= 1} onClick={() => refresh(meta.page - 1, meta.limit, appliedFilters)}>
                Anterior
              </button>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                Página {meta.page} de {meta.totalPages} · {meta.total} registros
              </span>
              <button className="btn" disabled={loading || meta.page >= meta.totalPages} onClick={() => refresh(meta.page + 1, meta.limit, appliedFilters)}>
                Siguiente
              </button>
              <select className="input" value={meta.limit} onChange={(e) => refresh(1, Number(e.target.value), appliedFilters)}>
                <option value={10}>10 / pág.</option>
                <option value={20}>20 / pág.</option>
                <option value={50}>50 / pág.</option>
              </select>
            </div>
          </>
        )
      )}
    </div>
  );
}
