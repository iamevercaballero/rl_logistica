import { Fragment, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLot, deleteLot, generateSapLot, listLots, type Lot } from "../api/lots";
import { listProducts } from "../api/products";
import { getAllPalletsByLot, type LotPallet } from "../api/pallets";
import { listLocations } from "../api/locations";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 0.15s ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "block" }}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PalletStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    AVAILABLE: "badge badge--entry",
    BLOCKED: "badge badge--adj-out",
    DAMAGED: "badge badge--exit",
    IN_TRANSIT: "badge badge--transfer",
    EXITED: "badge",
  };
  const label: Record<string, string> = {
    AVAILABLE: "Disponible",
    BLOCKED: "Bloqueado",
    DAMAGED: "Dañado",
    IN_TRANSIT: "En tránsito",
    EXITED: "Despachado",
  };
  return <span className={cls[status] ?? "badge"}>{label[status] ?? status}</span>;
}

/** Returns days until expiry (negative = already expired). */
function daysUntilExpiry(fecha: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const target = new Date(fecha); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

/** Color-coded expiry badge. Thresholds: ≤0 expired, ≤15 critical, ≤60 warning, >60 ok. */
function ExpiryBadge({ fecha }: { fecha?: string | null }) {
  if (!fecha) return null;
  const d = daysUntilExpiry(fecha);

  let color: string;
  let bg: string;
  let border: string;
  let label: string;

  if (d < 0) {
    color = "var(--danger)";
    bg = "rgba(239,68,68,0.12)";
    border = "rgba(239,68,68,0.35)";
    label = `Vencido (${Math.abs(d)}d)`;
  } else if (d === 0) {
    color = "var(--danger)";
    bg = "rgba(239,68,68,0.12)";
    border = "rgba(239,68,68,0.35)";
    label = "¡Vence hoy!";
  } else if (d <= 15) {
    color = "var(--danger)";
    bg = "rgba(239,68,68,0.10)";
    border = "rgba(239,68,68,0.28)";
    label = `${d}d`;
  } else if (d <= 60) {
    color = "var(--warning)";
    bg = "rgba(245,158,11,0.10)";
    border = "rgba(245,158,11,0.28)";
    label = `${d}d`;
  } else {
    color = "var(--success)";
    bg = "rgba(16,185,129,0.10)";
    border = "rgba(16,185,129,0.25)";
    label = `${d}d`;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color,
        background: bg,
        border: `1px solid ${border}`,
        whiteSpace: "nowrap",
      }}
      aria-label={`${d < 0 ? "Vencido hace" : "Vence en"} ${Math.abs(d)} días`}
    >
      {d <= 15 && d >= 0 && (
        <span
          style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}

/** Row background for critical lots */
function expiryRowStyle(fecha?: string | null): React.CSSProperties {
  if (!fecha) return {};
  const d = daysUntilExpiry(fecha);
  if (d < 0) return { background: "rgba(239,68,68,0.05)" };
  if (d <= 15) return { background: "rgba(239,68,68,0.04)" };
  if (d <= 60) return { background: "rgba(245,158,11,0.03)" };
  return {};
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
}

function ExpandedPalletsRow({ lotId, locationMap, colCount }: { lotId: string; locationMap: Record<string, string>; colCount: number }) {
  const { data: pallets = [], isLoading } = useQuery({
    queryKey: ["pallets", "by-lot", lotId],
    queryFn: () => getAllPalletsByLot(lotId),
    staleTime: 60_000,
  });

  const active = pallets.filter((p: LotPallet) => p.status !== "EXITED");
  const exited = pallets.filter((p: LotPallet) => p.status === "EXITED");

  return (
    <tr>
      <td colSpan={colCount} style={{ padding: 0, background: "var(--bg-base)", borderBottom: "1px solid var(--border)" }}>
        {isLoading ? (
          <div style={{ padding: "14px 48px", color: "var(--muted)", fontSize: 13 }} aria-busy="true">
            Cargando pallets…
          </div>
        ) : (
          <div style={{ padding: "14px 24px 18px 52px" }}>
            {active.length > 0 && (
              <div style={{ marginBottom: exited.length > 0 ? 20 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} aria-hidden="true" />
                  Pallets activos
                  <span className="badge" style={{ fontWeight: 700 }}>{active.length}</span>
                </div>
                <table className="table" style={{ fontSize: 12 }} aria-label="Pallets activos">
                  <thead>
                    <tr>
                      <th scope="col">Pallet</th>
                      <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Ubicación</th>
                      <th scope="col">Ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((p) => (
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

            {exited.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} aria-hidden="true" />
                  Despachados
                  <span className="badge" style={{ fontWeight: 700 }}>{exited.length}</span>
                </div>
                <table className="table" style={{ fontSize: 12, opacity: 0.55 }} aria-label="Pallets despachados">
                  <thead>
                    <tr>
                      <th scope="col">Pallet</th>
                      <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Ingreso</th>
                      <th scope="col">Salida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exited.map((p) => (
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
  );
}

export default function LotsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("lots", role) : false;
  const allowDelete = role ? canDelete("lots", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterProductId, setFilterProductId] = useState("");
  const [filterSapLot, setFilterSapLot] = useState("");

  const [productId, setProductId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaFabricacion, setFechaFabricacion] = useState("");
  const [sapLot, setSapLot] = useState(() => generateSapLot());

  const [expandedLotId, setExpandedLotId] = useState<string | null>(null);

  const [lotsQ, productsQ, locationsQ] = useQueries({
    queries: [
      { queryKey: ["lots"], queryFn: () => listLots() },
      { queryKey: ["products"], queryFn: () => listProducts() },
      { queryKey: ["locations"], queryFn: listLocations },
    ],
  });

  const items = lotsQ.data ?? [];
  const products = productsQ.data ?? [];
  const locations = locationsQ.data ?? [];
  const isLoading = lotsQ.isLoading || productsQ.isLoading || locationsQ.isLoading;
  const isError = lotsQ.isError;

  const locationMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of locations) m[l.id] = l.code;
    return m;
  }, [locations]);

  const filtered = useMemo(() => items.filter((i) => {
    if (filterProductId && i.productId !== filterProductId) return false;
    if (filterSapLot && i.sapLot !== filterSapLot) return false;
    return true;
  }), [items, filterProductId, filterSapLot]);

  const createMut = useMutation({
    mutationFn: createLot,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      toast.success(`Lote ${created.lotCode} creado`);
      setLotCode("");
      setFechaVencimiento("");
      setFechaFabricacion("");
      setSapLot(generateSapLot());
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLot(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      toast.success("Lote eliminado");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowCreate || !lotCode.trim() || !productId) return;
    createMut.mutate({
      lotCode: lotCode.trim(),
      productId,
      fechaVencimiento: fechaVencimiento || undefined,
      fechaFabricacion: fechaFabricacion || undefined,
      sapLot: sapLot.trim() || undefined,
    });
  }

  function handleDelete(item: Lot) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar lote ${item.lotCode}?`)) return;
    deleteMut.mutate(item.id);
  }

  function handleToggle(id: string) {
    setExpandedLotId((current) => (current === id ? null : id));
  }

  const COL_COUNT = 8;

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
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 8 }} aria-label="Nuevo lote">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <select
                className="input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
                aria-label="Material"
              >
                <option value="">Seleccionar material *</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
              </select>
              <input
                className="input"
                placeholder="Código de lote *"
                value={lotCode}
                onChange={(e) => setLotCode(e.target.value)}
                required
                aria-label="Código de lote"
              />
              <input
                className="input"
                value={sapLot}
                onChange={(e) => setSapLot(e.target.value)}
                placeholder="Lote SAP"
                aria-label="Lote SAP"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <div>
                <label htmlFor="lot-fvenc" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".3px" }}>F. Vencimiento</label>
                <input id="lot-fvenc" className="input" type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="lot-ffab" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".3px" }}>F. Fabricación</label>
                <input id="lot-ffab" className="input" type="date" value={fechaFabricacion} onChange={(e) => setFechaFabricacion(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn btn--primary" type="submit" disabled={saving || !lotCode.trim() || !productId} style={{ width: "100%" }}>
                  {createMut.isPending ? "Guardando..." : "Guardar lote"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <section className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="input"
            value={filterProductId}
            onChange={(e) => setFilterProductId(e.target.value)}
            style={{ maxWidth: 320 }}
            aria-label="Filtrar por material"
          >
            <option value="">Todos los materiales</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
          </select>
          <input
            className="input"
            placeholder="Filtrar por lote SAP"
            value={filterSapLot}
            onChange={(e) => setFilterSapLot(e.target.value)}
            style={{ width: 180 }}
            aria-label="Filtrar por lote SAP"
          />
          {(filterProductId || filterSapLot) && (
            <button className="btn" onClick={() => { setFilterProductId(""); setFilterSapLot(""); }}>Limpiar</button>
          )}
          <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: "auto" }}>
            {filtered.length} lote{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </section>

      {isLoading && <p aria-busy="true" style={{ color: "var(--muted)", fontSize: 14 }}>Cargando…</p>}
      {isError && (
        <p className="form-error" role="alert">
          No se pudo cargar.
          <button className="btn btn--primary" onClick={() => lotsQ.refetch()} style={{ marginLeft: 8 }}>Reintentar</button>
        </p>
      )}

      {!isLoading && !isError && (
        filtered.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Sin lotes</p>
            <p className="empty__desc">Creá el primer lote o registrá entradas — los lotes se crean automáticamente.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table" aria-label="Lista de lotes">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 36 }} />
                  <th scope="col">Lote proveedor</th>
                  <th scope="col">Lote SAP</th>
                  <th scope="col">Material</th>
                  <th scope="col">F. Fabricación</th>
                  <th scope="col">F. Vencimiento</th>
                  <th scope="col">En stock</th>
                  <th scope="col" style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isOpen = expandedLotId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr
                        style={{ cursor: "pointer", ...expiryRowStyle(item.fechaVencimiento) }}
                        onClick={() => handleToggle(item.id)}
                        aria-expanded={isOpen}
                      >
                        <td style={{ paddingLeft: 14, paddingRight: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--radius-sm)", background: isOpen ? "var(--primary-light)" : undefined, color: isOpen ? "var(--primary-text)" : "var(--muted)" }}>
                            <ChevronIcon open={isOpen} />
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{item.lotCode}</span>
                            {item.status === "PENDING_REGULARIZATION" && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "1px 6px",
                                  borderRadius: 999,
                                  background: "rgba(245,158,11,0.10)",
                                  color: "var(--warning)",
                                  border: "1px solid rgba(245,158,11,0.28)",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Pend. regularizar
                              </span>
                            )}
                          </div>
                        </td>
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
                            ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-variant)" }}>
                                  {new Date(item.fechaVencimiento).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                                </span>
                                <ExpiryBadge fecha={item.fechaVencimiento} />
                              </div>
                            )
                            : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <span style={{ color: item.stockActual <= 0 ? "var(--danger)" : "inherit" }}>
                            {item.stockActual.toLocaleString("es-PY")}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {allowDelete && (
                            <button
                              className="btn"
                              style={{ fontSize: 12, padding: "2px 10px", height: 28 }}
                              onClick={() => handleDelete(item)}
                              disabled={saving}
                              aria-label={`Eliminar lote ${item.lotCode}`}
                            >
                              Eliminar
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && <ExpandedPalletsRow lotId={item.id} locationMap={locationMap} colCount={COL_COUNT} />}
                    </Fragment>
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
