import { useCallback, useEffect, useState } from "react";
import { createLot, deleteLot, listLots, generateSapLot, type Lot } from "../api/lots";
import { listProducts, type Product } from "../api/products";
import { getAllPalletsByLot, type LotPallet } from "../api/pallets";
import { listLocations } from "../api/locations";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 0.15s ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "block" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PalletStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    AVAILABLE:  "badge badge--entry",
    BLOCKED:    "badge badge--adj-out",
    DAMAGED:    "badge badge--exit",
    IN_TRANSIT: "badge badge--transfer",
    EXITED:     "badge",
  };
  const label: Record<string, string> = {
    AVAILABLE:  "Disponible",
    BLOCKED:    "Bloqueado",
    DAMAGED:    "Dañado",
    IN_TRANSIT: "En tránsito",
    EXITED:     "Despachado",
  };
  return <span className={cls[status] ?? "badge"}>{label[status] ?? status}</span>;
}

function daysLabel(fecha?: string | null) {
  if (!fecha) return null;
  const d = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (d < 0)  return <span className="badge badge--estado-rechazado">Vencido</span>;
  if (d <= 7) return <span className="badge badge--estado-rechazado">{d}d</span>;
  if (d <= 30) return <span className="badge badge--estado-pendiente">{d}d</span>;
  return <span className="badge badge--estado-aprobado">{d}d</span>;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
}

export default function LotsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("lots", role) : false;
  const allowDelete  = role ? canDelete("lots", role)  : false;

  const [items, setItems]         = useState<Lot[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [filterProductId, setFilterProductId] = useState("");
  const [filterSapLot, setFilterSapLot]       = useState("");
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [formError, setFormError] = useState("");

  // Form
  const [productId, setProductId]           = useState("");
  const [lotCode, setLotCode]               = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaFabricacion, setFechaFabricacion] = useState("");
  const [sapLot, setSapLot]                 = useState(() => generateSapLot());

  // Expansion
  const [expandedLotId, setExpandedLotId]   = useState<string | null>(null);
  const [palletCache, setPalletCache]       = useState<Record<string, LotPallet[]>>({});
  const [palletLoadingIds, setPalletLoadingIds] = useState<Set<string>>(new Set());
  const [locationMap, setLocationMap]       = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [lots, productData] = await Promise.all([listLots(), listProducts()]);
      setItems(lots);
      setProducts(productData);
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  // Load location names once
  useEffect(() => {
    listLocations()
      .then(locs => {
        const m: Record<string, string> = {};
        locs.forEach(l => { m[l.id] = l.code; });
        setLocationMap(m);
      })
      .catch(() => undefined);
  }, []);

  const filtered = items.filter(i => {
    if (filterProductId && i.productId !== filterProductId) return false;
    if (filterSapLot && i.sapLot !== filterSapLot) return false;
    return true;
  });

  async function handleToggle(lotId: string) {
    if (expandedLotId === lotId) { setExpandedLotId(null); return; }
    setExpandedLotId(lotId);
    if (palletCache[lotId] !== undefined) return; // cache hit

    setPalletLoadingIds(prev => new Set([...prev, lotId]));
    try {
      const pallets = await getAllPalletsByLot(lotId);
      setPalletCache(prev => ({ ...prev, [lotId]: pallets }));
    } catch {
      setPalletCache(prev => ({ ...prev, [lotId]: [] }));
    } finally {
      setPalletLoadingIds(prev => { const s = new Set(prev); s.delete(lotId); return s; });
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!allowCreate || !lotCode.trim() || !productId) return;
    setSaving(true); setFormError("");
    try {
      await createLot({
        lotCode: lotCode.trim(),
        productId,
        fechaVencimiento: fechaVencimiento || undefined,
        fechaFabricacion: fechaFabricacion || undefined,
        sapLot: sapLot.trim() || undefined,
      });
      setLotCode(""); setFechaVencimiento(""); setFechaFabricacion("");
      setSapLot(generateSapLot());
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Lot) {
    if (!allowDelete || !window.confirm(`Eliminar lote ${item.lotCode}?`)) return;
    setSaving(true); setFormError("");
    try { await deleteLot(item.id); await refresh(); }
    catch (err) { setFormError(getFriendlyApiError(err)); }
    finally { setSaving(false); }
  }

  const COL_COUNT = 8; // chevron + 6 data cols + actions

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Lotes</h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Administrá lotes con fecha de vencimiento para FEFO automático en salidas.
        </p>
      </div>

      {allowCreate && (
        <section className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuevo lote</h3>
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <select className="input" value={productId} onChange={e => setProductId(e.target.value)} required>
                <option value="">Seleccionar material *</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
              </select>
              <input className="input" placeholder="Código de lote *" value={lotCode} onChange={e => setLotCode(e.target.value)} required />
              <input className="input" value={sapLot} onChange={e => setSapLot(e.target.value)} placeholder="Lote SAP" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".3px" }}>F. Vencimiento</label>
                <input className="input" type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".3px" }}>F. Fabricación</label>
                <input className="input" type="date" value={fechaFabricacion} onChange={e => setFechaFabricacion(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn btn--primary" type="submit" disabled={saving || !lotCode.trim() || !productId} style={{ width: "100%" }}>
                  {saving ? "Guardando..." : "Guardar lote"}
                </button>
              </div>
            </div>
          </form>
          {formError && <p style={{ color: "var(--danger)", marginTop: 8, fontSize: 13 }}>{formError}</p>}
        </section>
      )}

      {/* Filtros */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="input" value={filterProductId} onChange={e => setFilterProductId(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Todos los materiales</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
          </select>
          <input className="input" placeholder="Filtrar por lote SAP" value={filterSapLot}
            onChange={e => setFilterSapLot(e.target.value)} style={{ width: 180 }} />
          {(filterProductId || filterSapLot) && (
            <button className="btn" onClick={() => { setFilterProductId(""); setFilterSapLot(""); }}>Limpiar</button>
          )}
          <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: "auto" }}>
            {filtered.length} lote{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </section>

      {loading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>}
      {error && (
        <p style={{ color: "var(--danger)" }}>
          {error} <button className="btn" onClick={refresh} style={{ marginLeft: 8 }}>Reintentar</button>
        </p>
      )}

      {!loading && !error && (
        filtered.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Sin lotes</p>
            <p className="empty__desc">Creá el primer lote o registrá entradas — los lotes se crean automáticamente.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Lote proveedor</th>
                  <th>Lote SAP</th>
                  <th>Material</th>
                  <th>F. Fabricación</th>
                  <th>F. Vencimiento</th>
                  <th>En stock</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isOpen    = expandedLotId === item.id;
                  const isLoadingPallets = palletLoadingIds.has(item.id);
                  const pallets   = palletCache[item.id] ?? [];
                  const active    = pallets.filter(p => p.status !== "EXITED");
                  const exited    = pallets.filter(p => p.status === "EXITED");

                  return (
                    <>
                      {/* ── Main lot row ── */}
                      <tr
                        key={item.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => handleToggle(item.id)}
                      >
                        <td style={{ paddingLeft: 14, paddingRight: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--radius-sm)", background: isOpen ? "var(--primary-light)" : undefined, color: isOpen ? "var(--primary-text)" : "var(--muted)" }}>
                            <ChevronIcon open={isOpen} />
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{item.lotCode}</td>
                        <td>
                          {item.sapLot
                            ? <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: "var(--primary-text)" }}>{item.sapLot}</span>
                            : <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <strong>{item.product?.code ?? "—"}</strong>
                          <span style={{ color: "var(--muted)", marginLeft: 6 }}>{item.product?.description ?? ""}</span>
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>
                          {item.fechaFabricacion || <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {item.fechaVencimiento
                            ? <>{item.fechaVencimiento} <span style={{ marginLeft: 4 }}>{daysLabel(item.fechaVencimiento)}</span></>
                            : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <span style={{ color: item.stockActual <= 0 ? "var(--danger)" : "inherit" }}>
                            {item.stockActual.toLocaleString("es-PY")}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {allowDelete && (
                            <button className="btn" style={{ fontSize: 12, padding: "2px 10px", height: 28 }} onClick={() => handleDelete(item)}>
                              Eliminar
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* ── Expanded pallet detail ── */}
                      {isOpen && (
                        <tr key={`${item.id}-detail`}>
                          <td
                            colSpan={COL_COUNT}
                            style={{ padding: 0, background: "var(--bg-base)", borderBottom: "1px solid var(--border)" }}
                          >
                            {isLoadingPallets ? (
                              <div style={{ padding: "14px 48px", color: "var(--muted)", fontSize: 13 }}>
                                Cargando pallets…
                              </div>
                            ) : (
                              <div style={{ padding: "14px 24px 18px 52px" }}>

                                {/* Active pallets */}
                                {active.length > 0 && (
                                  <div style={{ marginBottom: exited.length > 0 ? 20 : 0 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
                                      Pallets activos
                                      <span className="badge" style={{ fontWeight: 700 }}>{active.length}</span>
                                    </div>
                                    <table className="table" style={{ fontSize: 12 }}>
                                      <thead>
                                        <tr>
                                          <th>Pallet</th>
                                          <th style={{ textAlign: "right" }}>Cantidad</th>
                                          <th>Estado</th>
                                          <th>Ubicación</th>
                                          <th>Ingreso</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {active.map(p => (
                                          <tr key={p.id}>
                                            <td style={{ fontFamily: "monospace", fontWeight: 600, letterSpacing: 0 }}>{p.code}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                              {p.quantity.toLocaleString("es-PY")}
                                            </td>
                                            <td><PalletStatusBadge status={p.status} /></td>
                                            <td style={{ color: "var(--text-variant)" }}>
                                              {p.currentLocationId
                                                ? (locationMap[p.currentLocationId] ?? <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--muted)" }}>{p.currentLocationId.slice(0, 8)}…</span>)
                                                : <span style={{ color: "var(--muted)" }}>—</span>}
                                            </td>
                                            <td style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                                              {fmtDate(p.createdAt)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* Exited pallets */}
                                {exited.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
                                      Despachados
                                      <span className="badge" style={{ fontWeight: 700 }}>{exited.length}</span>
                                    </div>
                                    <table className="table" style={{ fontSize: 12, opacity: 0.55 }}>
                                      <thead>
                                        <tr>
                                          <th>Pallet</th>
                                          <th style={{ textAlign: "right" }}>Cantidad</th>
                                          <th>Estado</th>
                                          <th>Ingreso</th>
                                          <th>Salida</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {exited.map(p => (
                                          <tr key={p.id}>
                                            <td style={{ fontFamily: "monospace", textDecoration: "line-through", color: "var(--muted)", letterSpacing: 0 }}>{p.code}</td>
                                            <td style={{ textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums", textDecoration: "line-through" }}>
                                              {p.quantity.toLocaleString("es-PY")}
                                            </td>
                                            <td><span className="badge">Despachado</span></td>
                                            <td style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                                              {fmtDate(p.createdAt)}
                                            </td>
                                            <td style={{ fontVariantNumeric: "tabular-nums" }}>
                                              {p.exitedAt
                                                ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>{fmtDate(p.exitedAt)}</span>
                                                : <span style={{ color: "var(--muted)" }}>—</span>}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {pallets.length === 0 && (
                                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                                    Sin pallets registrados para este lote.
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
