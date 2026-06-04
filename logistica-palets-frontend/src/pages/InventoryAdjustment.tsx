import { useEffect, useState } from "react";
import DispatchLogDrawer from "../components/DispatchLogDrawer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ProductSearch from "../components/ProductSearch";
import type { Product } from "../api/products";
import { listWarehouses } from "../api/warehouses";
import { listLocations } from "../api/locations";
import { generateSapLot, fefoLots, type Lot } from "../api/lots";
import type { LotPallet } from "../api/pallets";
import {
  createAdjustmentDraft,
  submitAdjustmentForApproval,
  approveAdjustment,
  rejectAdjustment,
  cancelAdjustment,
  getAdjustments,
  ADJUSTMENT_REASON_OPTIONS,
  type AdjustmentRequest,
  type AdjustmentType,
  type CreateAdjustmentLinePayload,
} from "../api/adjustments";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useAuth } from "../auth/AuthContext";

// ── Tipos locales ────────────────────────────────────────────────────────────
type PalletLine = { qty: string };
type LotGroup = {
  id: number; lotCode: string; quantity: string; palletCount: string;
  palletLines: PalletLine[]; fechaVencimiento: string; fechaFabricacion: string;
};
let _gid = 0;
const newLotGroup = (): LotGroup => ({
  id: ++_gid, lotCode: "", quantity: "", palletCount: "",
  palletLines: [], fechaVencimiento: "", fechaFabricacion: "",
});

type FefoRow = { lot: Lot & { pallets: LotPallet[] }; selectedIds: Set<string>; expanded: boolean; exitQtyInput: string };

function autoSelectForQty(pallets: LotPallet[], targetQty: number): Set<string> {
  const sel = new Set<string>(); let covered = 0;
  for (const p of pallets) { if (covered >= targetQty) break; sel.add(p.id); covered += p.quantity; }
  return sel;
}

type CartLine = {
  key: number; productId: string; productLabel: string;
  palletItems: CreateAdjustmentLinePayload["palletItems"];
  totalQty: number; summary: string;
};
let _ck = 0;

const STATUS_LABEL: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE_APROBACION: "Pendiente aprobación",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
};
const STATUS_COLOR: Record<string, string> = {
  BORRADOR: "var(--muted)",
  PENDIENTE_APROBACION: "var(--warning)",
  APROBADO: "var(--success)",
  RECHAZADO: "var(--danger)",
};

// ── Componente principal ─────────────────────────────────────────────────────
export default function InventoryAdjustmentPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [adjType, setAdjType] = useState<AdjustmentType>("ADJUSTMENT_IN");
  const isIn = adjType === "ADJUSTMENT_IN";

  // Cabecera
  const [reason, setReason] = useState("DIFERENCIA_INVENTARIO");
  const [adjustmentCategory, setAdjustmentCategory] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");

  // Sección producto
  const [product, setProduct] = useState<Product | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  // ENTRADA: lotes
  const [entrySapLot, setEntrySapLot] = useState(() => generateSapLot());
  const [lotGroups, setLotGroups] = useState<LotGroup[]>([newLotGroup()]);
  // SALIDA: FEFO
  const [fefoRows, setFefoRows] = useState<FefoRow[]>([]);

  // Carrito y errores
  const [cart, setCart] = useState<CartLine[]>([]);
  const [formError, setFormError] = useState("");

  // Rechazo inline
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Bitácora
  const [logAdjId, setLogAdjId] = useState<string | null>(null);

  // Filtro del listado
  const [filterStatus, setFilterStatus] = useState<string>("");

  const warehousesQ = useQuery({ queryKey: ["warehouses"], queryFn: listWarehouses });
  const locationsQ  = useQuery({ queryKey: ["locations"],  queryFn: listLocations });
  const listQ = useQuery({
    queryKey: ["adjustments", adjType, filterStatus],
    queryFn: () => getAdjustments({ type: adjType, status: (filterStatus || undefined) as import("../api/adjustments").AdjustmentStatus | undefined, limit: 60 }),
  });
  const adjustments = listQ.data?.data ?? [];
  const logAdj = adjustments.find((a) => a.id === logAdjId);

  // FEFO query (solo SALIDA)
  const fefoQ = useQuery({
    queryKey: ["lots", "fefo", { productId: product?.id }],
    queryFn: () => fefoLots(product?.id),
    enabled: !isIn && !!product,
  });

  useEffect(() => {
    if (isIn || !product) { setFefoRows([]); return; }
    if (!fefoQ.data) return;
    setFefoRows((fefoQ.data as (Lot & { pallets: LotPallet[] })[]).map((l) => ({
      lot: l, selectedIds: new Set<string>(), expanded: false, exitQtyInput: "",
    })));
  }, [fefoQ.data, product, isIn]);

  // Resetear todo al cambiar tipo
  function switchType(t: AdjustmentType) {
    setAdjType(t);
    setProduct(null); setWizardStep(1);
    setLotGroups([newLotGroup()]); setEntrySapLot(generateSapLot());
    setFefoRows([]); setCart([]); setFormError("");
  }

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["adjustments"] });
  const filteredLocs = (locationsQ.data ?? []).filter((l) => !warehouseId || l.warehouseId === warehouseId);
  const locationMap = Object.fromEntries((locationsQ.data ?? []).map((l) => [l.id, l.code]));

  // ── LotGroup helpers ─────────────────────────────────────────────────────
  function addLotGroup() { setLotGroups((g) => [...g, newLotGroup()]); }
  function removeLotGroup(id: number) { setLotGroups((g) => g.filter((x) => x.id !== id)); }
  function updateGroup(id: number, field: keyof Omit<LotGroup, "id" | "palletLines">, val: string) {
    setLotGroups((g) => g.map((x) => {
      if (x.id !== id) return x;
      const updated = { ...x, [field]: val };
      if (field === "quantity" || field === "palletCount") {
        const qty = Number(field === "quantity" ? val : x.quantity);
        const cnt = Number(field === "palletCount" ? val : x.palletCount);
        if (cnt > 0 && qty > 0) {
          const base = Math.floor(qty / cnt);
          const rem = qty % cnt;
          updated.palletLines = Array.from({ length: cnt }, (_, i) => ({ qty: String(i === cnt - 1 ? base + rem : base) }));
        }
      }
      return updated;
    }));
  }
  function updatePalletLine(gid: number, idx: number, val: string) {
    setLotGroups((g) => g.map((x) => {
      if (x.id !== gid) return x;
      const lines = [...x.palletLines]; lines[idx] = { qty: val };
      return { ...x, palletLines: lines };
    }));
  }

  // ── FEFO helpers ──────────────────────────────────────────────────────────
  function togglePallet(lotIdx: number, palletId: string) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const ids = new Set(r.selectedIds);
      ids.has(palletId) ? ids.delete(palletId) : ids.add(palletId);
      return { ...r, selectedIds: ids };
    }));
  }
  function handleExitQty(lotIdx: number, val: string) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const qty = Number(val);
      const ids = qty > 0 ? autoSelectForQty(r.lot.pallets, qty) : new Set(r.selectedIds);
      return { ...r, exitQtyInput: val, selectedIds: ids };
    }));
  }

  // ── Construir línea actual ────────────────────────────────────────────────
  function buildCurrentLine(): { palletItems: CreateAdjustmentLinePayload["palletItems"]; totalQty: number; summary: string } | { error: string } | null {
    if (!product) return null;

    if (isIn) {
      const validGroups = lotGroups.filter((g) => g.lotCode.trim() && Number(g.quantity) > 0);
      if (validGroups.length === 0) return { error: "Agregá al menos un lote con código y cantidad." };
      const palletItems = validGroups.flatMap((g) => {
        const base = { lotCode: g.lotCode.trim(), fechaVencimiento: g.fechaVencimiento || undefined, fechaFabricacion: g.fechaFabricacion || undefined, sapLot: entrySapLot.trim() || undefined };
        if (g.palletLines.length > 0) return g.palletLines.map((l) => ({ ...base, quantity: Number(l.qty) }));
        return [{ ...base, quantity: Number(g.quantity) }];
      });
      return { palletItems, totalQty: palletItems.reduce((s, i) => s + i.quantity, 0), summary: `Lotes: ${validGroups.map((g) => g.lotCode.trim()).join(", ")}` };
    }

    // SALIDA: FEFO
    const palletItems: CreateAdjustmentLinePayload["palletItems"] = [];
    for (const row of fefoRows) {
      const targetQty = Number(row.exitQtyInput);
      const selectedPallets = row.lot.pallets.filter((p) => row.selectedIds.has(p.id));
      if (selectedPallets.length === 0) continue;
      if (targetQty > 0) {
        let remaining = targetQty;
        for (const p of selectedPallets) {
          if (remaining <= 0) break;
          const take = Math.min(p.quantity, remaining);
          palletItems.push({ palletId: p.id, quantity: take });
          remaining -= take;
        }
      } else {
        for (const p of selectedPallets) palletItems.push({ palletId: p.id, quantity: p.quantity });
      }
    }
    if (palletItems.length === 0) return { error: "Seleccioná al menos un pallet para ajustar." };
    const lotsUsed = fefoRows.filter((r) => r.selectedIds.size > 0).map((r) => r.lot.lotCode);
    return { palletItems, totalQty: palletItems.reduce((s, i) => s + i.quantity, 0), summary: `Lotes: ${lotsUsed.join(", ")}` };
  }

  function resetProductSection() {
    setProduct(null); setLotGroups([newLotGroup()]); setEntrySapLot(generateSapLot()); setFefoRows([]); setWizardStep(1);
  }

  function addToCart() {
    if (!product) { setFormError("Seleccioná un material."); return; }
    const res = buildCurrentLine();
    if (!res) { setFormError("Seleccioná un material."); return; }
    if ("error" in res) { setFormError(res.error); return; }
    setFormError("");
    setCart((c) => [...c, { key: ++_ck, productId: product.id, productLabel: `${product.code} · ${product.description}`, ...res }]);
    resetProductSection();
  }

  // ── Mutaciones ────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: async (submit: boolean) => {
      let lines = [...cart];
      if (product) {
        const res = buildCurrentLine();
        if (res && !("error" in res)) lines = [...lines, { key: ++_ck, productId: product.id, productLabel: "", ...res }];
        else if (res && "error" in res && lines.length === 0) throw new Error(res.error);
      }
      if (lines.length === 0) throw new Error("Agregá al menos un material al ajuste.");
      const { requestId } = await createAdjustmentDraft({
        type: adjType,
        reason,
        adjustmentCategory: adjustmentCategory.trim() || undefined,
        warehouseId: warehouseId || undefined,
        locationId: locationId || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({ productId: l.productId, palletItems: l.palletItems })),
      });
      if (submit) await submitAdjustmentForApproval(requestId);
      return { submit };
    },
    onSuccess: ({ submit }) => {
      toast.success(submit ? `Ajuste enviado para aprobación` : "Borrador guardado");
      setCart([]); setReason("DIFERENCIA_INVENTARIO"); setAdjustmentCategory("");
      setWarehouseId(""); setLocationId(""); setNotes("");
      resetProductSection(); setFormError("");
      invalidate();
    },
    onError: (err) => { const m = getFriendlyApiError(err); setFormError(m); toast.error(m); },
  });

  const approveMut = useMutation({
    mutationFn: approveAdjustment,
    onSuccess: () => {
      toast.success("Ajuste aprobado — stock actualizado");
      void queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["kpis"] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectAdjustment(id, reason),
    onSuccess: () => { toast.success("Rechazado — vuelve a borrador"); setRejectingId(null); setRejectReason(""); invalidate(); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });
  const cancelMut = useMutation({
    mutationFn: cancelAdjustment,
    onSuccess: () => { toast.success("Ajuste anulado"); invalidate(); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const pendingCount = adjustments.filter((a) => a.status === "PENDIENTE_APROBACION").length;

  return (
    <div>
      {/* Bitácora drawer */}
      {logAdjId && logAdj && (
        <DispatchLogDrawer
          entityType="ADJUSTMENT"
          entityId={logAdjId}
          title={`${logAdj.code} · ${logAdj.type === "ADJUSTMENT_IN" ? "Ajuste Entrada" : "Ajuste Salida"}`}
          onClose={() => setLogAdjId(null)}
        />
      )}

      {/* Encabezado */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Ajuste de Inventario</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Gestioná diferencias de inventario, mermas, roturas y conteos físicos.
          </p>
        </div>
        {canApprove && pendingCount > 0 && (
          <div style={{ background: "var(--warning)", color: "#000", fontWeight: 700, fontSize: 13, padding: "6px 14px", borderRadius: 8 }}>
            ⚠ {pendingCount} solicitud{pendingCount !== 1 ? "es" : ""} pendiente{pendingCount !== 1 ? "s" : ""} de aprobación
          </div>
        )}
      </div>

      {/* ══ FORMULARIO ══════════════════════════════════════════ */}
      <section className="card">
        {/* Selector tipo + título */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
              {isIn ? "Nuevo ajuste de entrada (RLAI)" : "Nuevo ajuste de salida (RLAO)"}
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              {isIn ? "Suma stock por diferencia, conteo físico, sobrante, etc." : "Resta stock por merma, rotura, pérdida, obsoleto, etc."}
            </p>
          </div>
          <div role="tablist" style={{ display: "inline-flex", gap: 4, background: "var(--panel)", padding: 4, borderRadius: 8, border: "1px solid var(--border)" }}>
            {(["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] as AdjustmentType[]).map((t) => (
              <button key={t} role="tab" aria-selected={adjType === t} onClick={() => switchType(t)}
                className="btn" style={{ fontSize: 13, fontWeight: 700, border: "none", background: adjType === t ? "var(--primary)" : "transparent", color: adjType === t ? "#fff" : "var(--muted)" }}>
                {t === "ADJUSTMENT_IN" ? "Entrada (RLAI)" : "Salida (RLAO)"}
              </button>
            ))}
          </div>
        </div>

        {/* Cabecera del ajuste */}
        <div className="form-section-title">Datos del ajuste</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 2 }}>Motivo *</div>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {ADJUSTMENT_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Categoría (libre)</div>
            <input className="input" placeholder="Ej: Conteo julio 2026" value={adjustmentCategory} onChange={(e) => setAdjustmentCategory(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Depósito</div>
            <select className="input" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setLocationId(""); }}>
              <option value="">— Depósito —</option>
              {(warehousesQ.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 8 }}>
          <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">— Ubicación (opcional) —</option>
            {filteredLocs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
          <textarea className="input" placeholder="Observaciones" value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
        </div>

        {/* Sección de producto */}
        <div className="form-section-title" style={{ marginTop: 14 }}>
          {isIn
            ? wizardStep === 1 ? "Material — Paso 1: Seleccionar" : "Material — Paso 2: Lotes y cantidades"
            : "Material — Selección FEFO"
          }
        </div>

        {/* ENTRADA: igual que Movements.tsx */}
        {isIn && wizardStep === 1 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}><ProductSearch value={product} onChange={setProduct} /></div>
            <input className="input" value={entrySapLot} onChange={(e) => setEntrySapLot(e.target.value)} placeholder="Lote SAP" style={{ width: 140, fontSize: 13 }} />
          </div>
        )}

        {isIn && wizardStep === 2 && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>{product?.code} · {product?.description}</div>
            {lotGroups.map((group) => (
              <div key={group.id} style={{ border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ background: "var(--bg)", padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 120px 120px 32px", gap: 6, alignItems: "end", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Código de lote *</div>
                    <input className="input" placeholder="Ej: L2026-001" value={group.lotCode} onChange={(e) => updateGroup(group.id, "lotCode", e.target.value)} style={{ fontSize: 13, fontWeight: 700 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>F. Vencimiento</div>
                    <input className="input" type="date" value={group.fechaVencimiento} onChange={(e) => updateGroup(group.id, "fechaVencimiento", e.target.value)} style={{ fontSize: 12, padding: "5px 6px" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>F. Fabricación</div>
                    <input className="input" type="date" value={group.fechaFabricacion} onChange={(e) => updateGroup(group.id, "fechaFabricacion", e.target.value)} style={{ fontSize: 12, padding: "5px 6px" }} />
                  </div>
                  <button type="button" onClick={() => removeLotGroup(group.id)} disabled={lotGroups.length === 1} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: 18, padding: 0, alignSelf: "center" }}>×</button>
                </div>
                <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 2 }}>Cantidad *</div>
                    <input className="input" type="number" min={1} value={group.quantity} onChange={(e) => updateGroup(group.id, "quantity", e.target.value)} style={{ fontSize: 14, fontWeight: 700 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Cant. pallets</div>
                    <input className="input" type="number" min={0} placeholder="Distribuye automático" value={group.palletCount} onChange={(e) => updateGroup(group.id, "palletCount", e.target.value)} />
                  </div>
                </div>
                {group.palletLines.length > 0 && (
                  <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", background: "var(--bg-base)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>Desglose — {group.palletLines.length} pallets</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 5 }}>
                      {group.palletLines.map((line, idx) => (
                        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 28 }}>P{idx + 1}</span>
                          <input className="input" type="number" min={0} value={line.qty} onChange={(e) => updatePalletLine(group.id, idx, e.target.value)} style={{ fontSize: 12, padding: "3px 6px", width: "100%" }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="btn" onClick={addLotGroup} style={{ alignSelf: "start", fontSize: 13 }}>+ Agregar otro lote</button>
          </div>
        )}

        {/* SALIDA: FEFO igual que EXIT */}
        {!isIn && (
          <>
            <div style={{ marginBottom: 8 }}>
              <ProductSearch value={product} onChange={(p) => { setProduct(p); setFefoRows([]); }} />
            </div>
            {product && fefoRows.length === 0 && !fefoQ.isFetching && (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>Sin stock disponible para este material.</p>
            )}
            {product && fefoQ.isFetching && <p style={{ fontSize: 13, color: "var(--muted)" }}>Cargando lotes...</p>}
            {fefoRows.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {fefoRows.map((row, lotIdx) => {
                  const availQty = row.lot.pallets.reduce((s, p) => s + p.quantity, 0);
                  const enteredQty = Number(row.exitQtyInput);
                  const isExpired = row.lot.fechaVencimiento && new Date(row.lot.fechaVencimiento) < new Date();
                  return (
                    <div key={row.lot.id} style={{ border: `1.5px solid ${row.selectedIds.size > 0 ? "var(--primary)" : "var(--border)"}`, borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--bg)", cursor: "pointer" }}
                        onClick={() => setFefoRows((rows) => rows.map((r, i) => i === lotIdx ? { ...r, expanded: !r.expanded } : r))}>
                        <div onClick={(e) => e.stopPropagation()}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 3 }}>Cantidad a ajustar</div>
                          <input className="input" type="number" min={0} max={availQty} value={row.exitQtyInput}
                            onChange={(e) => handleExitQty(lotIdx, e.target.value)}
                            style={{ fontSize: 15, fontWeight: 700, width: "100%" }} placeholder="0" />
                          {enteredQty > availQty && <p style={{ color: "var(--danger)", fontSize: 11, margin: "3px 0 0" }}>Supera el stock ({availQty})</p>}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{row.lot.lotCode}</span>
                            {row.lot.fechaVencimiento && <span style={{ fontSize: 11, color: isExpired ? "var(--danger)" : "var(--muted)" }}>{isExpired ? "⚠ Vencido" : `Vence: ${new Date(row.lot.fechaVencimiento).toLocaleDateString("es-PY")}`}</span>}
                            <span style={{ fontSize: 12, color: "var(--muted)" }}>{availQty.toLocaleString("es-PY")} disp.</span>
                          </div>
                          {row.selectedIds.size > 0 && <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 700 }}>✓ {row.selectedIds.size} sel. · {row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).reduce((s, p) => s + p.quantity, 0).toLocaleString("es-PY")} unid.</span>}
                        </div>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{row.expanded ? "▲" : "▼"}</span>
                      </div>
                      {row.expanded && (
                        <div style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                          {row.lot.pallets.map((p, pIdx) => (
                            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", cursor: "pointer", background: row.selectedIds.has(p.id) ? "var(--primary-light)" : undefined, borderBottom: pIdx < row.lot.pallets.length - 1 ? "1px solid var(--border)" : undefined }}>
                              <input type="checkbox" checked={row.selectedIds.has(p.id)} onChange={() => togglePallet(lotIdx, p.id)} style={{ width: 15, height: 15 }} />
                              <span style={{ fontWeight: 600, fontSize: 13, minWidth: 100 }}>{p.code}</span>
                              <span style={{ fontSize: 13 }}>{p.quantity.toLocaleString("es-PY")} unid.</span>
                              {p.currentLocationId && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto", fontFamily: "monospace" }}>{locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8)}</span>}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Carrito */}
        {cart.length > 0 && (
          <div style={{ border: "1.5px solid var(--primary)", borderRadius: 10, overflow: "hidden", marginTop: 14 }}>
            <div style={{ background: "var(--bg)", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 800 }}>Materiales en este ajuste ({cart.length})</div>
            <table className="table" style={{ margin: 0 }}>
              <thead><tr><th>Material</th><th>Detalle</th><th style={{ textAlign: "right" }}>Cantidad</th><th /></tr></thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.key}>
                    <td style={{ fontWeight: 600 }}>{l.productLabel}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{l.summary}</td>
                    <td style={{ textAlign: "right" }}>{l.totalQty.toLocaleString("es-PY")}</td>
                    <td><button type="button" className="btn" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} style={{ padding: "2px 8px", color: "var(--danger)" }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {formError && <div className="form-error" role="alert" style={{ marginTop: 10 }}>{formError}</div>}

        {/* Botones */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          {isIn && wizardStep === 1 && (
            <button type="button" className="btn btn--primary" onClick={() => { if (!product) { setFormError("Seleccioná un material."); return; } setFormError(""); setWizardStep(2); }}>Siguiente →</button>
          )}
          {isIn && wizardStep === 2 && (
            <>
              <button type="button" className="btn" onClick={() => setWizardStep(1)}>← Anterior</button>
              <button type="button" className="btn" onClick={addToCart} disabled={!product}>+ Agregar otro material</button>
            </>
          )}
          {!isIn && product && (
            <button type="button" className="btn" onClick={addToCart}>+ Agregar otro material</button>
          )}
          {((!isIn && product) || (isIn && wizardStep === 2) || cart.length > 0) && (
            <>
              <button type="button" className="btn" onClick={() => createMut.mutate(false)} disabled={createMut.isPending}>
                {createMut.isPending ? "Guardando..." : "Guardar borrador"}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => createMut.mutate(true)} disabled={createMut.isPending}>
                {createMut.isPending ? "Enviando..." : `Enviar para aprobación${cart.length > 0 ? ` (${cart.length + (product ? 1 : 0)} mat.)` : ""}`}
              </button>
            </>
          )}
        </div>
      </section>

      {/* ══ LISTA DE SOLICITUDES ════════════════════════════════ */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
            Solicitudes — {isIn ? "Ajuste Entrada (RLAI)" : "Ajuste Salida (RLAO)"}
          </h3>
          <select className="input" style={{ width: 200 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="BORRADOR">Borrador</option>
            <option value="PENDIENTE_APROBACION">Pendiente aprobación</option>
            <option value="APROBADO">Aprobado</option>
            <option value="RECHAZADO">Rechazado</option>
          </select>
        </div>

        {listQ.isLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando...</p>
        ) : adjustments.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No hay solicitudes{filterStatus ? " con ese estado" : ""}.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {adjustments.map((adj) => (
              <RequestCard key={adj.id} adj={adj} canApprove={canApprove}
                rejectingId={rejectingId} rejectReason={rejectReason}
                onApprove={() => approveMut.mutate(adj.id)}
                onStartReject={() => { setRejectingId(adj.id); setRejectReason(""); }}
                onConfirmReject={() => rejectMut.mutate({ id: adj.id, reason: rejectReason })}
                onCancelReject={() => setRejectingId(null)}
                onRejectReasonChange={setRejectReason}
                onCancel={() => cancelMut.mutate(adj.id)}
                onLog={() => setLogAdjId(adj.id)}
                approving={approveMut.isPending && approveMut.variables === adj.id}
                rejecting={rejectMut.isPending}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Tarjeta de solicitud ─────────────────────────────────────────────────────
function RequestCard({ adj, canApprove, rejectingId, rejectReason, onApprove, onStartReject, onConfirmReject, onCancelReject, onRejectReasonChange, onCancel, onLog, approving, rejecting }: {
  adj: AdjustmentRequest; canApprove: boolean;
  rejectingId: string | null; rejectReason: string;
  onApprove: () => void; onStartReject: () => void; onConfirmReject: () => void; onCancelReject: () => void;
  onRejectReasonChange: (v: string) => void; onCancel: () => void; onLog: () => void; approving: boolean; rejecting: boolean;
}) {
  const isPending = adj.status === "PENDIENTE_APROBACION";
  const isEditable = adj.status === "BORRADOR" || adj.status === "RECHAZADO";
  const isRejecting = rejectingId === adj.id;

  return (
    <div style={{ border: `1.5px solid ${isPending ? "var(--warning)" : "var(--border)"}`, borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>{adj.code}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[adj.status] ?? "var(--muted)" }}>{STATUS_LABEL[adj.status] ?? adj.status}</span>
            <span className="badge" style={{ fontSize: 11 }}>{adj.reason.replace(/_/g, " ")}</span>
            {adj.adjustmentCategory && <span style={{ fontSize: 12, color: "var(--muted)" }}>{adj.adjustmentCategory}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{new Date(adj.createdAt).toLocaleDateString("es-PY")}</span>
            <span>{adj.totalLines} material{adj.totalLines !== 1 ? "es" : ""}</span>
            <span style={{ fontWeight: 700 }}>{adj.totalQuantity.toLocaleString("es-PY")} unid.</span>
            {adj.notes && <span style={{ fontStyle: "italic" }}>"{adj.notes}"</span>}
          </div>
          {adj.rejectReason && (
            <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>⚠ Rechazado: {adj.rejectReason}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <button className="btn" style={{ fontSize: 12, padding: "5px 10px" }} onClick={onLog} title="Ver bitácora y adjuntos">📎</button>
          {isPending && canApprove && !isRejecting && (
            <>
              <button className="btn btn--primary" style={{ fontSize: 12 }} onClick={onApprove} disabled={approving}>{approving ? "Aprobando..." : "✓ Aprobar"}</button>
              <button className="btn" style={{ fontSize: 12, color: "var(--danger)" }} onClick={onStartReject}>✕ Rechazar</button>
            </>
          )}
          {isEditable && (
            <button className="btn" style={{ fontSize: 12, color: "var(--danger)" }} onClick={onCancel}>Anular</button>
          )}
        </div>
      </div>
      {isRejecting && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Motivo del rechazo *"
            value={rejectReason} onChange={(e) => onRejectReasonChange(e.target.value)} autoFocus />
          <button className="btn btn--primary" style={{ fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={onConfirmReject} disabled={!rejectReason.trim() || rejecting}>{rejecting ? "Rechazando..." : "Confirmar rechazo"}</button>
          <button className="btn" style={{ fontSize: 12 }} onClick={onCancelReject}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
