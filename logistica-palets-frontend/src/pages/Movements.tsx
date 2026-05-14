import { useCallback, useEffect, useMemo, useState } from "react";
import ProductSearch from "../components/ProductSearch";
import {
  ADJUSTMENT_REASONS,
  createMovement,
  getMovements,
  regularizeMovement,
  type Movement,
  type MovementType,
} from "../api/movements";
import { fefoLots, generateSapLot, type Lot } from "../api/lots";
import type { LotPallet } from "../api/pallets";
import { listWarehouses, type Warehouse } from "../api/warehouses";
import { listLocations, type Location } from "../api/locations";
import { listActiveUsers, type AppUser } from "../api/users";
import type { Product } from "../api/products";
import { getFriendlyApiError } from "../utils/apiError";

// ── Tipos formulario entrada jerárquico
type PalletEntry = { id: number; quantity: string };
type LotGroup = {
  id: number; lotCode: string; fechaVencimiento: string;
  fechaFabricacion: string; expectedTotal: string; pallets: PalletEntry[];
};

// ── Tipo fila FEFO (salida y transferencia)
type FefoRow = {
  lot: Lot & { pallets: LotPallet[] };
  selectedIds: Set<string>;
  expanded: boolean;
};

// ── Payload regularización
type RegPayload = {
  reason: string; documentNumber: string; supplier: string; carrier: string;
  driver: string; destination: string; notes: string;
  sapLot: string; fechaVencimiento: string; fechaFabricacion: string; proveedor: string;
};
const emptyReg = (): RegPayload => ({
  reason: "", documentNumber: "", supplier: "", carrier: "", driver: "",
  destination: "", notes: "", sapLot: "", fechaVencimiento: "", fechaFabricacion: "", proveedor: "",
});

let _gid = 0, _pid = 0;
const newPalletEntry = (): PalletEntry => ({ id: ++_pid, quantity: "" });
const newLotGroup = (): LotGroup => ({
  id: ++_gid, lotCode: "", fechaVencimiento: "", fechaFabricacion: "", expectedTotal: "", pallets: [newPalletEntry()],
});

export default function MovementsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [pending, setPending] = useState<Movement[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Formulario común
  const [movType, setMovType] = useState<MovementType>("ENTRY");
  const [product, setProduct] = useState<Product | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [carrier, setCarrier] = useState("");
  const [driver, setDriver] = useState("");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [encargadoId, setEncargadoId] = useState("");
  const [date, setDate] = useState("");

  // ENTRADA
  const [entrySapLot, setEntrySapLot] = useState(() => generateSapLot());
  const [lotGroups, setLotGroups] = useState<LotGroup[]>([newLotGroup()]);
  const [isProvisional, setIsProvisional] = useState(false);

  // SALIDA / TRANSFERENCIA
  const [exitMode, setExitMode] = useState<"product" | "sapLot">("product");
  const [exitSapLotInput, setExitSapLotInput] = useState(() => generateSapLot());
  const [appliedExitSapLot, setAppliedExitSapLot] = useState("");
  const [fefoRows, setFefoRows] = useState<FefoRow[]>([]);
  const [fefoLoading, setFefoLoading] = useState(false);

  // AJUSTES
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentCategory, setAdjustmentCategory] = useState("");

  // REGULARIZACIÓN
  const [regMovement, setRegMovement] = useState<Movement | null>(null);
  const [regForm, setRegForm] = useState<RegPayload>(emptyReg());
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState("");

  const isEntry = movType === "ENTRY" || movType === "ADJUSTMENT_IN";
  const isExit = movType === "EXIT" || movType === "ADJUSTMENT_OUT";
  const isTransfer = movType === "TRANSFER";
  const isAdjustment = movType === "ADJUSTMENT_IN" || movType === "ADJUSTMENT_OUT";

  const filteredLocations = useMemo(() => {
    if (isTransfer) return locations;
    if (!warehouseId) return locations;
    return locations.filter((l) => l.warehouse?.id === warehouseId || l.warehouseId === warehouseId);
  }, [isTransfer, warehouseId, locations]);

  const toLocations = useMemo(() => locations.filter((l) => l.id !== fromLocationId), [locations, fromLocationId]);

  const refreshPending = useCallback(async () => {
    try {
      const resp = await getMovements({ page: 1, limit: 100, status: "PENDING_REGULARIZATION" });
      setPending(resp.data);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    Promise.all([listWarehouses(), listLocations(), listActiveUsers()])
      .then(([w, l, u]) => { setWarehouses(w); setLocations(l); setUsers(u); })
      .catch(() => undefined);
    refreshPending().catch(() => undefined);
  }, [refreshPending]);

  // Cargar FEFO al cambiar tipo/producto/modo/sapLot
  useEffect(() => {
    if (!isExit && !isTransfer) { setFefoRows([]); return; }
    const productId = (exitMode === "product" || isTransfer) ? product?.id : undefined;
    const sapLot = exitMode === "sapLot" && !isTransfer ? appliedExitSapLot : undefined;
    const locId = isTransfer ? fromLocationId || undefined : undefined;
    if (!productId && !sapLot) { setFefoRows([]); return; }
    setFefoLoading(true);
    fefoLots(productId, sapLot, locId)
      .then((lots) => setFefoRows(lots.map((l) => ({
        lot: l as Lot & { pallets: LotPallet[] },
        selectedIds: new Set<string>(),
        expanded: true,
      }))))
      .catch(() => setFefoRows([]))
      .finally(() => setFefoLoading(false));
  }, [product, movType, exitMode, appliedExitSapLot, isExit, isTransfer, fromLocationId]);

  function resetForm() {
    setProduct(null); setWarehouseId(""); setLocationId(""); setFromLocationId(""); setToLocationId("");
    setDocumentNumber(""); setSupplier(""); setCarrier(""); setDriver(""); setDestination(""); setNotes("");
    setEncargadoId(""); setDate(""); setIsProvisional(false);
    setEntrySapLot(generateSapLot()); setLotGroups([newLotGroup()]);
    setExitMode("product"); setExitSapLotInput(generateSapLot()); setAppliedExitSapLot(""); setFefoRows([]);
    setAdjustmentReason(""); setAdjustmentCategory(""); setFormError("");
  }

  // ── Helpers ENTRADA
  function addLotGroup() { setLotGroups((g) => [...g, newLotGroup()]); }
  function removeLotGroup(id: number) { setLotGroups((g) => g.filter((x) => x.id !== id)); }
  function updateGroup(id: number, field: keyof Omit<LotGroup, "id" | "pallets">, val: string) {
    setLotGroups((g) => g.map((x) => x.id === id ? { ...x, [field]: val } : x));
  }
  function addPallet(groupId: number) {
    setLotGroups((g) => g.map((x) => x.id === groupId ? { ...x, pallets: [...x.pallets, newPalletEntry()] } : x));
  }
  function removePallet(groupId: number, palletId: number) {
    setLotGroups((g) => g.map((x) => x.id === groupId ? { ...x, pallets: x.pallets.filter((p) => p.id !== palletId) } : x));
  }
  function updatePalletQty(groupId: number, palletId: number, val: string) {
    setLotGroups((g) => g.map((x) => x.id === groupId
      ? { ...x, pallets: x.pallets.map((p) => p.id === palletId ? { ...p, quantity: val } : p) } : x));
  }
  function groupTotal(g: LotGroup) { return g.pallets.reduce((s, p) => s + (Number(p.quantity) || 0), 0); }

  // ── Helpers FEFO
  function togglePallet(lotIdx: number, palletId: string) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const ids = new Set(r.selectedIds);
      if (ids.has(palletId)) ids.delete(palletId); else ids.add(palletId);
      return { ...r, selectedIds: ids };
    }));
  }
  function toggleAllPallets(lotIdx: number, checked: boolean) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const avail = r.lot.status !== "PENDING_REGULARIZATION" ? r.lot.pallets : [];
      const ids = checked ? new Set(avail.map((p) => p.id)) : new Set<string>();
      return { ...r, selectedIds: ids };
    }));
  }
  function toggleExpanded(lotIdx: number) {
    setFefoRows((rows) => rows.map((r, i) => i === lotIdx ? { ...r, expanded: !r.expanded } : r));
  }

  const totalExitQty = fefoRows.reduce((sum, row) =>
    sum + row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).reduce((s, p) => s + p.quantity, 0), 0);
  const totalExitPallets = fefoRows.reduce((sum, row) => sum + row.selectedIds.size, 0);

  const daysUntil = (fecha?: string | null) =>
    fecha ? Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000) : null;

  const expiryBadge = (days: number | null) => {
    if (days === null) return null;
    const cls = days < 0 ? "badge--estado-rechazado" : days <= 7 ? "badge--estado-rechazado" : days <= 30 ? "badge--estado-pendiente" : "badge--estado-aprobado";
    return <span className={`badge ${cls}`} style={{ fontSize: 10, marginLeft: 4 }}>{days < 0 ? "Vencido" : `${days}d`}</span>;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) { setFormError("Seleccioná un material."); return; }
    if (isAdjustment && !adjustmentReason) { setFormError("Seleccioná el motivo del ajuste."); return; }
    if (isProvisional && !notes.trim()) { setFormError("Las entradas provisorias requieren una observación."); return; }
    setSaving(true); setFormError("");

    try {
      if (isEntry) {
        const allItems = lotGroups.flatMap((g) =>
          g.pallets.filter((p) => Number(p.quantity) > 0 && g.lotCode.trim()).map((p) => ({
            lotCode: g.lotCode.trim(), quantity: Number(p.quantity),
            fechaVencimiento: g.fechaVencimiento || undefined,
            fechaFabricacion: g.fechaFabricacion || undefined,
            sapLot: entrySapLot.trim() || undefined,
          }))
        );
        if (allItems.length === 0) { setFormError("Agregá al menos un palet con lote y cantidad."); setSaving(false); return; }
        for (const g of lotGroups) {
          if (g.expectedTotal && Number(g.expectedTotal) > 0 && groupTotal(g) !== Number(g.expectedTotal)) {
            setFormError(`Lote "${g.lotCode}": total de palets (${groupTotal(g)}) ≠ esperado (${g.expectedTotal}).`);
            setSaving(false); return;
          }
        }
        await createMovement({
          type: movType, date: date || undefined, productId: product.id,
          warehouseId: warehouseId || undefined, locationId: locationId || undefined,
          documentNumber: documentNumber || undefined, supplier: supplier || undefined,
          carrier: carrier || undefined, driver: driver || undefined,
          notes: notes || undefined, encargadoRecepcionId: encargadoId || undefined,
          isProvisional: isProvisional || undefined,
          adjustmentReason: isAdjustment ? adjustmentReason : undefined,
          adjustmentCategory: isAdjustment ? adjustmentCategory || undefined : undefined,
          palletItems: allItems,
        });

      } else if (isExit) {
        const palletItems = fefoRows.flatMap((row) =>
          row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).map((p) => ({ palletId: p.id, quantity: p.quantity }))
        );
        if (palletItems.length === 0) { setFormError("Seleccioná al menos un palet."); setSaving(false); return; }
        await createMovement({
          type: movType, date: date || undefined, productId: product.id,
          warehouseId: warehouseId || undefined, locationId: locationId || undefined,
          documentNumber: documentNumber || undefined, carrier: carrier || undefined,
          driver: driver || undefined, destination: destination || undefined,
          notes: notes || undefined, encargadoRecepcionId: encargadoId || undefined,
          adjustmentReason: isAdjustment ? adjustmentReason : undefined,
          adjustmentCategory: isAdjustment ? adjustmentCategory || undefined : undefined,
          palletItems,
        });

      } else if (isTransfer) {
        const palletItems = fefoRows.flatMap((row) =>
          row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).map((p) => ({ palletId: p.id, quantity: p.quantity }))
        );
        if (palletItems.length === 0) { setFormError("Seleccioná al menos un palet para transferir."); setSaving(false); return; }
        if (!toLocationId) { setFormError("Seleccioná la ubicación destino."); setSaving(false); return; }
        await createMovement({
          type: "TRANSFER", date: date || undefined, productId: product.id,
          fromLocationId: fromLocationId || undefined, toLocationId,
          notes: notes || undefined, palletItems,
        });
      }

      resetForm();
      await refreshPending();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Regularización
  function openReg(m: Movement) {
    setRegMovement(m);
    setRegForm({ ...emptyReg(), documentNumber: m.documentNumber ?? "", supplier: m.supplier ?? "", carrier: m.carrier ?? "", driver: m.driver ?? "", destination: m.destination ?? "", notes: m.notes ?? "" });
    setRegError("");
  }
  function closeReg() { setRegMovement(null); setRegForm(emptyReg()); setRegError(""); }

  async function handleRegularize(e: React.FormEvent) {
    e.preventDefault();
    if (!regMovement) return;
    if (!regForm.reason.trim()) { setRegError("El motivo es obligatorio."); return; }
    setRegSaving(true); setRegError("");
    try {
      const payload: Record<string, string> = { reason: regForm.reason.trim() };
      if (regForm.documentNumber.trim()) payload.documentNumber = regForm.documentNumber.trim();
      if (regForm.supplier.trim()) payload.supplier = regForm.supplier.trim();
      if (regForm.carrier.trim()) payload.carrier = regForm.carrier.trim();
      if (regForm.driver.trim()) payload.driver = regForm.driver.trim();
      if (regForm.destination.trim()) payload.destination = regForm.destination.trim();
      if (regForm.notes.trim()) payload.notes = regForm.notes.trim();
      if (regForm.sapLot.trim()) payload.sapLot = regForm.sapLot.trim();
      if (regForm.fechaVencimiento) payload.fechaVencimiento = regForm.fechaVencimiento;
      if (regForm.fechaFabricacion) payload.fechaFabricacion = regForm.fechaFabricacion;
      if (regForm.proveedor.trim()) payload.proveedor = regForm.proveedor.trim();
      await regularizeMovement(regMovement.id, payload as Parameters<typeof regularizeMovement>[1]);
      closeReg();
      await refreshPending();
    } catch (err) { setRegError(getFriendlyApiError(err)); }
    finally { setRegSaving(false); }
  }

  function renderFefoRows() {
    if (fefoLoading) return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Cargando lotes...</p>;
    const hasQuery = isTransfer ? !!product && !!fromLocationId : exitMode === "product" ? !!product : !!appliedExitSapLot;
    if (fefoRows.length === 0 && hasQuery) {
      return <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>Sin stock disponible{isTransfer && fromLocationId ? " en esta ubicación." : "."}</div>;
    }
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {fefoRows.map((row, lotIdx) => {
          const blocked = row.lot.status === "PENDING_REGULARIZATION";
          const days = daysUntil(row.lot.fechaVencimiento);
          const hasPallets = row.lot.pallets.length > 0;
          const allSelected = hasPallets && !blocked && row.selectedIds.size === row.lot.pallets.length;
          return (
            <div key={row.lot.id} style={{ border: `1.5px solid ${blocked ? "#f97316" : row.selectedIds.size > 0 ? "var(--primary)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden", opacity: blocked ? 0.75 : 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, padding: "9px 12px", alignItems: "center", background: blocked ? "#fff7ed" : row.selectedIds.size > 0 ? "rgba(37,99,235,.06)" : "var(--bg)", cursor: blocked ? "not-allowed" : "pointer" }}
                onClick={() => !blocked && toggleExpanded(lotIdx)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {hasPallets && !blocked && (
                    <input type="checkbox" checked={allSelected}
                      onChange={(ev) => { ev.stopPropagation(); toggleAllPallets(lotIdx, ev.target.checked); }}
                      onClick={(ev) => ev.stopPropagation()}
                      style={{ width: 16, height: 16, cursor: "pointer" }} />
                  )}
                  <div>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{row.lot.lotCode}</span>
                    {row.lot.sapLot && <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, marginLeft: 8 }}>{row.lot.sapLot}</span>}
                    {exitMode === "sapLot" && !isTransfer && row.lot.product && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{row.lot.product.code}</span>}
                    {blocked && <span style={{ fontSize: 10, background: "#f97316", color: "#fff", borderRadius: 4, padding: "1px 6px", marginLeft: 8, fontWeight: 700 }}>PROVISORIO</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
                  {row.lot.fechaVencimiento && <span style={{ color: "var(--muted)" }}>{row.lot.fechaVencimiento}{expiryBadge(days)}</span>}
                  <span style={{ fontWeight: 700 }}>{row.lot.stockActual.toLocaleString("es-PY")} unid.</span>
                  <span style={{ color: "var(--muted)" }}>{row.lot.pallets.length} palet{row.lot.pallets.length !== 1 ? "s" : ""}</span>
                  {row.selectedIds.size > 0 && (
                    <span style={{ color: "var(--primary)", fontWeight: 700 }}>
                      ✓ {row.selectedIds.size} sel. · {row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).reduce((s, p) => s + p.quantity, 0).toLocaleString("es-PY")} unid.
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{row.expanded ? "▲" : "▼"}</span>
              </div>
              {row.expanded && (
                <div style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                  {hasPallets ? row.lot.pallets.map((p, pIdx) => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", cursor: blocked ? "not-allowed" : "pointer", background: row.selectedIds.has(p.id) ? "rgba(37,99,235,.05)" : undefined, borderBottom: pIdx < row.lot.pallets.length - 1 ? "1px solid var(--border)" : undefined }}>
                      <input type="checkbox" checked={row.selectedIds.has(p.id)} disabled={blocked}
                        onChange={() => !blocked && togglePallet(lotIdx, p.id)}
                        style={{ width: 15, height: 15 }} />
                      <span style={{ fontWeight: 600, fontSize: 13, minWidth: 100 }}>{p.code}</span>
                      <span style={{ fontSize: 13 }}>{p.quantity.toLocaleString("es-PY")} unid.</span>
                    </label>
                  )) : (
                    <p style={{ margin: "8px 16px", fontSize: 12, color: "var(--muted)" }}>Sin palets registrados.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Movimientos</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Registrá entradas, salidas, transferencias y ajustes de inventario.
          </p>
        </div>
        <a href="/reports" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--primary)", fontWeight: 600, textDecoration: "none", padding: "6px 14px", border: "1.5px solid var(--primary)", borderRadius: 8 }}>
          Ver historial y reportes →
        </a>
      </div>

      {/* ── Pendientes de regularización ── */}
      {pending.length > 0 && (
        <section className="card" style={{ marginBottom: 12, borderLeft: "4px solid #f97316" }}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, color: "#ea580c" }}>
            Pendientes de regularización ({pending.length})
          </h3>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -4, marginBottom: 10 }}>
            Entradas provisorias que requieren completar datos. Los palets quedan bloqueados para salidas.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Fecha</th><th>Material</th><th>Cantidad</th><th>Observación</th><th></th></tr>
              </thead>
              <tbody>
                {pending.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--muted)" }}>{new Date(m.date).toLocaleString("es-PY")}</td>
                    <td><strong>{m.material.code}</strong><span style={{ color: "var(--muted)", fontSize: 12 }}> · {m.material.description}</span></td>
                    <td style={{ fontWeight: 700 }}>{m.quantity.toLocaleString("es-PY")}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 220 }}>{m.notes || "—"}</td>
                    <td>
                      <button className="btn btn--primary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => openReg(m)}>
                        Regularizar datos
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Modal Regularización ── */}
      {regMovement && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => e.target === e.currentTarget && closeReg()}>
          <div style={{ background: "var(--card)", borderRadius: 14, padding: 28, width: "100%", maxWidth: 560, boxShadow: "0 8px 40px rgba(0,0,0,.25)", overflowY: "auto", maxHeight: "90vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Regularizar entrada provisoria</h3>
              <button onClick={closeReg} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
              <strong>{regMovement.material.code}</strong> · {regMovement.material.description}
              <span style={{ marginLeft: 12, color: "var(--muted)" }}>{regMovement.quantity.toLocaleString("es-PY")} unid.</span>
              <span style={{ marginLeft: 12, color: "var(--muted)" }}>{new Date(regMovement.date).toLocaleDateString("es-PY")}</span>
            </div>
            <form onSubmit={handleRegularize} style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", marginBottom: 3 }}>Motivo de regularización *</label>
                <textarea className="input" rows={2} value={regForm.reason} onChange={(e) => setRegForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Describí por qué se regulariza..." required />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, paddingBottom: 2, borderBottom: "1px solid var(--border)" }}>Datos del movimiento</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["N° remito", "documentNumber"], ["Proveedor", "supplier"], ["Transportadora", "carrier"], ["Conductor", "driver"]].map(([label, field]) => (
                  <div key={field}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{label}</label>
                    <input className="input" value={regForm[field as keyof RegPayload]} onChange={(e) => setRegForm((p) => ({ ...p, [field]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Observaciones</label>
                <textarea className="input" rows={2} value={regForm.notes} onChange={(e) => setRegForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, paddingBottom: 2, borderBottom: "1px solid var(--border)" }}>Datos de lotes</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Lote SAP</label>
                  <input className="input" value={regForm.sapLot} onChange={(e) => setRegForm((p) => ({ ...p, sapLot: e.target.value }))} /></div>
                <div><label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Proveedor del lote</label>
                  <input className="input" value={regForm.proveedor} onChange={(e) => setRegForm((p) => ({ ...p, proveedor: e.target.value }))} /></div>
                <div><label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>F. Vencimiento</label>
                  <input className="input" type="date" value={regForm.fechaVencimiento} onChange={(e) => setRegForm((p) => ({ ...p, fechaVencimiento: e.target.value }))} /></div>
                <div><label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>F. Fabricación</label>
                  <input className="input" type="date" value={regForm.fechaFabricacion} onChange={(e) => setRegForm((p) => ({ ...p, fechaFabricacion: e.target.value }))} /></div>
              </div>
              {regError && <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>{regError}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn--primary" type="submit" disabled={regSaving}>{regSaving ? "Guardando..." : "Regularizar y cerrar"}</button>
                <button type="button" className="btn" onClick={closeReg}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Formulario ── */}
      <section className="card">
        <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800 }}>Registrar movimiento</h3>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>

          {/* Tipo y material */}
          <div className="form-section-title">Tipo y material</div>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 8, alignItems: "center" }}>
            <select className="input" value={movType}
              onChange={(e) => {
                setMovType(e.target.value as MovementType);
                setProduct(null); setFefoRows([]); setLotGroups([newLotGroup()]);
                setExitMode("product"); setAppliedExitSapLot("");
                setAdjustmentReason(""); setAdjustmentCategory(""); setIsProvisional(false);
              }}>
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Salida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="ADJUSTMENT_IN">Ajuste entrada</option>
              <option value="ADJUSTMENT_OUT">Ajuste salida</option>
            </select>
            <ProductSearch value={product} onChange={setProduct} />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Fecha (vacío = hoy)" style={{ width: 150 }} />
          </div>

          {/* Depósito/Ubicación */}
          {!isTransfer && (
            <>
              <div className="form-section-title">Depósito y ubicación</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select className="input" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setLocationId(""); }}>
                  <option value="">Depósito</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Ubicación (opcional)</option>
                  {filteredLocations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Transferencia: origen → destino + selección palets */}
          {isTransfer && (
            <>
              <div className="form-section-title">Origen → Destino</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Ubicación origen</label>
                  <select className="input" value={fromLocationId} onChange={(e) => { setFromLocationId(e.target.value); setFefoRows([]); }}>
                    <option value="">Seleccionar origen</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Ubicación destino</label>
                  <select className="input" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                    <option value="">Seleccionar destino</option>
                    {toLocations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name}</option>)}
                  </select>
                </div>
              </div>
              {product && fromLocationId ? (
                <>
                  <div className="form-section-title">
                    Palets a transferir{totalExitPallets > 0 && <span style={{ color: "var(--primary)", marginLeft: 10, fontWeight: 700 }}>{totalExitPallets} sel. · {totalExitQty.toLocaleString("es-PY")} unid.</span>}
                  </div>
                  {renderFefoRows()}
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Seleccioná material y ubicación de origen para ver los palets disponibles.</p>
              )}
            </>
          )}

          {/* Ajustes: motivo obligatorio */}
          {isAdjustment && (
            <>
              <div className="form-section-title">Motivo del ajuste</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", marginBottom: 3 }}>Motivo *</label>
                  <select className="input" value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} required style={{ borderColor: !adjustmentReason ? "#fca5a5" : undefined }}>
                    <option value="">Seleccionar...</option>
                    {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Categoría</label>
                  <input className="input" placeholder="Ej: Zona fría, Zona seca..." value={adjustmentCategory} onChange={(e) => setAdjustmentCategory(e.target.value)} />
                </div>
              </div>
              <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400e" }}>
                Solo para diferencias de inventario, mermas, roturas o sobrantes físicos. El ajuste queda registrado en auditoría.
              </div>
            </>
          )}

          {/* Entrada: lotes y palets */}
          {isEntry && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div className="form-section-title" style={{ marginBottom: 0 }}>Lotes y palets</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>Lote SAP:</label>
                  <input className="input" value={entrySapLot} onChange={(e) => setEntrySapLot(e.target.value)}
                    placeholder={generateSapLot()} style={{ width: 140, fontSize: 13 }} title="Lote SAP del día — compartido para toda la entrada" />
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {lotGroups.map((group) => {
                  const gt = groupTotal(group);
                  const expected = Number(group.expectedTotal);
                  const mismatch = group.expectedTotal && expected > 0 && gt !== expected;
                  return (
                    <div key={group.id} style={{ border: `1.5px solid ${mismatch ? "#f97316" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ background: "var(--bg)", padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 120px 120px 110px 32px", gap: 6, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                        <input className="input" placeholder="Código de lote *" value={group.lotCode}
                          onChange={(e) => updateGroup(group.id, "lotCode", e.target.value)} style={{ fontSize: 13, fontWeight: 700 }} />
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>F. Vencimiento</div>
                          <input className="input" type="date" value={group.fechaVencimiento}
                            onChange={(e) => updateGroup(group.id, "fechaVencimiento", e.target.value)} style={{ fontSize: 12, padding: "5px 6px" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>F. Fabricación</div>
                          <input className="input" type="date" value={group.fechaFabricacion}
                            onChange={(e) => updateGroup(group.id, "fechaFabricacion", e.target.value)} style={{ fontSize: 12, padding: "5px 6px" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: mismatch ? "#f97316" : "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Total esp.</div>
                          <input className="input" type="number" min={1} placeholder="Opcional"
                            value={group.expectedTotal} onChange={(e) => updateGroup(group.id, "expectedTotal", e.target.value)}
                            style={{ fontSize: 12, padding: "5px 6px", borderColor: mismatch ? "#f97316" : undefined }} />
                        </div>
                        <button type="button" onClick={() => removeLotGroup(group.id)} disabled={lotGroups.length === 1}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 18, padding: 0 }}>×</button>
                      </div>
                      <div style={{ padding: "6px 10px 4px" }}>
                        {group.pallets.map((p, pIdx) => (
                          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "50px 1fr 28px", gap: 6, marginBottom: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>P{pIdx + 1}</span>
                            <input className="input" type="number" min={1} placeholder="Unidades *"
                              value={p.quantity} onChange={(e) => updatePalletQty(group.id, p.id, e.target.value)} style={{ fontSize: 13 }} />
                            <button type="button" onClick={() => removePallet(group.id, p.id)} disabled={group.pallets.length === 1}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 16, padding: 0 }}>×</button>
                          </div>
                        ))}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                          <button type="button" className="btn" onClick={() => addPallet(group.id)} style={{ fontSize: 12, padding: "3px 10px" }}>+ Palet</button>
                          <span style={{ fontSize: 12, color: mismatch ? "#f97316" : "var(--muted)", fontWeight: mismatch ? 700 : 400 }}>
                            {group.pallets.length} palet{group.pallets.length !== 1 ? "s" : ""} · <strong>{gt.toLocaleString("es-PY")}</strong> unid.
                            {mismatch && ` · esperado: ${expected.toLocaleString("es-PY")}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="btn" onClick={addLotGroup} style={{ alignSelf: "start", fontSize: 13 }}>+ Agregar otro lote</button>
              </div>

              {/* Checkbox provisoria (solo ENTRY, no ajuste) */}
              {movType === "ENTRY" && (
                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: isProvisional ? "#fff7ed" : "var(--bg)", border: `1.5px solid ${isProvisional ? "#f97316" : "var(--border)"}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={isProvisional} onChange={(e) => setIsProvisional(e.target.checked)} style={{ width: 16, height: 16 }} />
                  <span>
                    Marcar como <strong>entrada provisoria</strong>
                    {isProvisional && <span style={{ marginLeft: 8, fontSize: 11, background: "#f97316", color: "#fff", borderRadius: 4, padding: "1px 6px" }}>REQUIERE REGULARIZACIÓN</span>}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", fontWeight: 400, textAlign: "right" }}>Datos incompletos aceptados. Bloquea palets hasta regularizar.</span>
                </label>
              )}
            </>
          )}

          {/* Salida: FEFO con palets */}
          {isExit && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div className="form-section-title" style={{ marginBottom: 0 }}>{isAdjustment ? "Palets del ajuste" : "Selección FEFO"}</div>
                {!isAdjustment && (
                  <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", fontSize: 13 }}>
                    <button type="button" style={{ padding: "5px 14px", background: exitMode === "product" ? "var(--primary)" : "none", color: exitMode === "product" ? "#fff" : "inherit", border: "none", cursor: "pointer", fontWeight: 600 }}
                      onClick={() => { setExitMode("product"); setAppliedExitSapLot(""); }}>Por material</button>
                    <button type="button" style={{ padding: "5px 14px", background: exitMode === "sapLot" ? "var(--primary)" : "none", color: exitMode === "sapLot" ? "#fff" : "inherit", border: "none", cursor: "pointer", fontWeight: 600, borderLeft: "1.5px solid var(--border)" }}
                      onClick={() => { setExitMode("sapLot"); setAppliedExitSapLot(""); }}>Por lote SAP</button>
                  </div>
                )}
                {totalExitPallets > 0 && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>
                    {totalExitPallets} palet{totalExitPallets !== 1 ? "s" : ""} · {totalExitQty.toLocaleString("es-PY")} unid.
                  </span>
                )}
              </div>
              {exitMode === "product" && !isAdjustment && (
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                  {product ? <>Lotes de <strong>{product.code}</strong> con stock, orden FEFO.</> : "Seleccioná el material arriba."}
                </p>
              )}
              {exitMode === "sapLot" && !isAdjustment && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="input" value={exitSapLotInput} onChange={(e) => setExitSapLotInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setAppliedExitSapLot(exitSapLotInput.trim()); } }}
                    placeholder={`Lote SAP (ej: ${generateSapLot()})`} style={{ width: 210 }} />
                  <button type="button" className="btn btn--primary" onClick={() => setAppliedExitSapLot(exitSapLotInput.trim())}>Buscar lotes</button>
                  {appliedExitSapLot && <span style={{ fontSize: 12, color: "var(--muted)" }}>Lotes del <strong>{appliedExitSapLot}</strong></span>}
                </div>
              )}
              {renderFefoRows()}
            </>
          )}

          {/* Datos logísticos */}
          <div className="form-section-title">Datos logísticos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {!isTransfer && <input className="input" placeholder="N° remito / documento" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
            {isEntry && <input className="input" placeholder="Proveedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
            {!isTransfer && <input className="input" placeholder="Transportadora" value={carrier} onChange={(e) => setCarrier(e.target.value)} />}
            {!isTransfer && <input className="input" placeholder="Conductor" value={driver} onChange={(e) => setDriver(e.target.value)} />}
            {isExit && <input className="input" placeholder="Destino" value={destination} onChange={(e) => setDestination(e.target.value)} />}
            {!isTransfer && (
              <select className="input" value={encargadoId} onChange={(e) => setEncargadoId(e.target.value)}>
                <option value="">Encargado recepción</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.username} ({u.role})</option>)}
              </select>
            )}
          </div>

          <textarea className="input"
            placeholder={isProvisional ? "Observaciones (OBLIGATORIO para entrada provisoria)" : "Observaciones (opcional)"}
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            style={{ borderColor: isProvisional && !notes.trim() ? "#fca5a5" : undefined }} />
          {isProvisional && !notes.trim() && (
            <p style={{ margin: "-10px 0 0", fontSize: 12, color: "#dc2626" }}>Observación obligatoria para entradas provisorias.</p>
          )}

          {formError && (
            <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
              <span style={{ color: "#dc2626", fontSize: 13, fontWeight: 600 }}>{formError}</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn btn--primary" type="submit" disabled={saving || !product || (isAdjustment && !adjustmentReason)}>
              {saving ? "Guardando..." : isProvisional ? "Registrar entrada provisoria" : "Registrar movimiento"}
            </button>
            <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
          </div>
        </form>
      </section>
    </div>
  );
}
