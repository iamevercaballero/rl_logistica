import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import ProductSearch from "../components/ProductSearch";
import AdjustmentInForm from "./AdjustmentInForm";
import AdjustmentOutForm from "./AdjustmentOutForm";
import {
  createMovement,
  getMovements,
  regularizeMovement,
  type Movement,
  type MovementType,
} from "../api/movements";
import { fefoLots, generateSapLot, type Lot } from "../api/lots";
import type { LotPallet } from "../api/pallets";
import { listWarehouses } from "../api/warehouses";
import { listLocations } from "../api/locations";
import { listActiveUsers } from "../api/users";
import type { Product } from "../api/products";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";

type PalletLine = { qty: string };

// ── Tipo formulario entrada simplificado (una cantidad total por lote)
type LotGroup = {
  id: number; lotCode: string; quantity: string; palletCount: string;
  palletLines: PalletLine[];
  fechaVencimiento: string; fechaFabricacion: string;
};

// ── Tipo fila FEFO (salida y transferencia)
type FefoRow = {
  lot: Lot & { pallets: LotPallet[] };
  selectedIds: Set<string>;
  expanded: boolean;
  exitQtyInput: string;   // EXIT only — cantidad a despachar del lote (auto-selecciona pallets)
};

/** Selecciona pallets en orden hasta cubrir targetQty. */
function autoSelectForQty(pallets: LotPallet[], targetQty: number): Set<string> {
  const selected = new Set<string>();
  let covered = 0;
  for (const p of pallets) {
    if (covered >= targetQty) break;
    selected.add(p.id);
    covered += p.quantity;
  }
  return selected;
}

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

let _gid = 0;

function distributeQty(totalQty: number, count: number): PalletLine[] {
  if (!count || count <= 0 || !totalQty || totalQty <= 0) return [];
  const base = Math.floor(totalQty / count);
  const rem = totalQty % count;
  return Array.from({ length: count }, (_, i) => ({ qty: String(i < rem ? base + 1 : base) }));
}

const newLotGroup = (): LotGroup => ({
  id: ++_gid, lotCode: "", quantity: "", palletCount: "",
  palletLines: [],
  fechaVencimiento: "", fechaFabricacion: "",
});

export default function MovementsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [warehousesQ, locationsQ, usersQ, pendingQ] = useQueries({
    queries: [
      { queryKey: ["warehouses"], queryFn: listWarehouses },
      { queryKey: ["locations"], queryFn: listLocations },
      { queryKey: ["users", "active"], queryFn: listActiveUsers },
      {
        queryKey: ["movements", "pending"],
        queryFn: () => getMovements({ page: 1, limit: 100, status: "PENDING_REGULARIZATION" }),
        select: (resp: { data: Movement[] }) => resp.data,
      },
    ],
  });
  const warehouses = warehousesQ.data ?? [];
  const locations = locationsQ.data ?? [];
  const users = usersQ.data ?? [];
  const pending = pendingQ.data ?? [];

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

  // TRANSFERENCIA (sigue usando selección de palets por FEFO)
  const [fefoRows, setFefoRows] = useState<FefoRow[]>([]);

  // WIZARD — sólo para ENTRY (2 pasos)
  const [wizardStep, setWizardStep] = useState(1);
  const WIZARD_STEPS = [
    { n: 1, label: "Contexto", sublabel: "Material, depósito, documento" },
    { n: 2, label: "Lotes y cantidades", sublabel: "Ingresar cantidades por lote" },
  ];

  // REGULARIZACIÓN
  const [regMovement, setRegMovement] = useState<Movement | null>(null);
  const [regForm, setRegForm] = useState<RegPayload>(emptyReg());
  const [regError, setRegError] = useState("");

  const isEntry = movType === "ENTRY";
  const isTransfer = movType === "TRANSFER";

  // ── Barcode scanner (TRANSFERENCIA only — EXIT ahora usa cantidad directa) ──
  const scanVideoRef = useRef<HTMLVideoElement>(null);

  const scanPalletByCode = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim().toLowerCase();
      let found = false;
      setFefoRows((rows) =>
        rows.map((row) => {
          const pallet = row.lot.pallets.find((p) => p.code.trim().toLowerCase() === code);
          if (!pallet || row.lot.status === "PENDING_REGULARIZATION") return row;
          found = true;
          const ids = new Set(row.selectedIds);
          ids.add(pallet.id);
          return { ...row, selectedIds: ids, expanded: true };
        }),
      );
      setTimeout(() => {
        if (found) toast.success(`Palet ${rawCode.trim()} seleccionado`);
        else toast.error(`Palet "${rawCode.trim()}" no encontrado en los lotes cargados`);
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );

  const { cameraActive, cameraSupported, startCamera, stopCamera } = useBarcodeScanner({
    enabled: isTransfer && fefoRows.length > 0,
    onScan: scanPalletByCode,
  });

  const filteredLocations = useMemo(() => {
    if (isTransfer) return locations;
    if (!warehouseId) return locations;
    return locations.filter((l) => l.warehouse?.id === warehouseId || l.warehouseId === warehouseId);
  }, [isTransfer, warehouseId, locations]);

  const toLocations = useMemo(() => locations.filter((l) => l.id !== fromLocationId), [locations, fromLocationId]);

  const locationMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of locations) m[l.id] = l.code;
    return m;
  }, [locations]);


  // FEFO via useQuery — TRANSFERENCIA (con filtro de ubicación) y SALIDA (sin filtro)
  const fefoLocId = isTransfer ? fromLocationId || undefined : undefined;
  const fefoEnabled = (isTransfer && !!product && !!fromLocationId) || (movType === "EXIT" && !!product);

  const fefoQ = useQuery({
    queryKey: ["lots", "fefo", { productId: product?.id, locationId: fefoLocId }],
    queryFn: () => fefoLots(product?.id, undefined, fefoLocId),
    enabled: fefoEnabled,
    staleTime: 15_000,
  });
  const fefoLoading = fefoQ.isFetching;

  useEffect(() => {
    if (!fefoEnabled) { setFefoRows([]); return; }
    if (!fefoQ.data) return;
    setFefoRows(fefoQ.data.map((l) => ({
      lot: l as Lot & { pallets: LotPallet[] },
      selectedIds: new Set<string>(),
      expanded: true,
      exitQtyInput: "",
    })));
  }, [fefoQ.data, fefoEnabled]);

  function resetForm() {
    setProduct(null); setWarehouseId(""); setLocationId(""); setFromLocationId(""); setToLocationId("");
    setDocumentNumber(""); setSupplier(""); setCarrier(""); setDriver(""); setDestination(""); setNotes("");
    setEncargadoId(""); setDate("");
    setEntrySapLot(generateSapLot()); setLotGroups([newLotGroup()]);
    setFefoRows([]);
    setFormError("");
    setWizardStep(1);
  }

  // ── Helpers ENTRADA
  function addLotGroup() { setLotGroups((g) => [...g, newLotGroup()]); }
  function removeLotGroup(id: number) { setLotGroups((g) => g.filter((x) => x.id !== id)); }
  function updateGroup(id: number, field: keyof Omit<LotGroup, "id" | "palletLines">, val: string) {
    setLotGroups((g) => g.map((x) => {
      if (x.id !== id) return x;
      const updated = { ...x, [field]: val };
      if (field === "quantity" || field === "palletCount") {
        const qty = Number(field === "quantity" ? val : x.quantity);
        const cnt = Number(field === "palletCount" ? val : x.palletCount);
        updated.palletLines = distributeQty(qty, cnt);
      }
      return updated;
    }));
  }

  function updatePalletLine(groupId: number, lineIdx: number, qty: string) {
    setLotGroups((g) => g.map((x) => {
      if (x.id !== groupId) return x;
      const palletLines = x.palletLines.map((l, i) => i === lineIdx ? { qty } : l);
      return { ...x, palletLines };
    }));
  }

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

  /** EXIT: al ingresar una cantidad por lote, auto-selecciona pallets en orden FEFO. */
  function handleExitQtyChange(lotIdx: number, qtyStr: string) {
    setFefoRows((rows) => rows.map((row, i) => {
      if (i !== lotIdx) return row;
      const qty = Number(qtyStr);
      const selectedIds = (!qtyStr || qty <= 0)
        ? new Set<string>()
        : autoSelectForQty(row.lot.pallets, qty);
      return { ...row, exitQtyInput: qtyStr, selectedIds };
    }));
  }

  // TRANSFER: suma de pallets completos seleccionados
  const totalTransferQty = fefoRows.reduce((sum, row) =>
    sum + row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).reduce((s, p) => s + p.quantity, 0), 0);
  const totalTransferPallets = fefoRows.reduce((sum, row) => sum + row.selectedIds.size, 0);

  // EXIT: suma de cantidades exactas ingresadas (respeta parciales)
  const totalExitQty = fefoRows.reduce((sum, row) => {
    const entered = Number(row.exitQtyInput);
    if (entered > 0) return sum + entered;
    return sum + row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).reduce((s, p) => s + p.quantity, 0);
  }, 0);
  const totalExitPallets = fefoRows.reduce((sum, row) => sum + row.selectedIds.size, 0);

  const daysUntil = (fecha?: string | null) =>
    fecha ? Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000) : null;

  const expiryBadge = (days: number | null) => {
    if (days === null) return null;
    const cls = days < 0 ? "badge--estado-rechazado" : days <= 7 ? "badge--estado-rechazado" : days <= 30 ? "badge--estado-pendiente" : "badge--estado-aprobado";
    return <span className={`badge ${cls}`} style={{ fontSize: 10, marginLeft: 4 }}>{days < 0 ? "Vencido" : `${days}d`}</span>;
  };

  function invalidateAfterMovement() {
    queryClient.invalidateQueries({ queryKey: ["movements"] });
    queryClient.invalidateQueries({ queryKey: ["kpis"] });
    queryClient.invalidateQueries({ queryKey: ["stock"] });
    queryClient.invalidateQueries({ queryKey: ["lots"] });
    queryClient.invalidateQueries({ queryKey: ["pallets"] });
  }

  const createMovementMut = useMutation({
    mutationFn: createMovement,
    onSuccess: () => {
      invalidateAfterMovement();
      toast.success("Movimiento registrado");
      resetForm();
    },
    onError: (err) => {
      const msg = getFriendlyApiError(err);
      setFormError(msg);
      toast.error(msg);
    },
  });
  const saving = createMovementMut.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) { setFormError("Seleccioná un material."); return; }
    setFormError("");

    if (isEntry) {
      const validGroups = lotGroups.filter((g) => g.lotCode.trim() && Number(g.quantity) > 0);
      if (validGroups.length === 0) { setFormError("Agregá al menos un lote con código y cantidad."); return; }

      const allItems = validGroups.flatMap((g) => {
        const base = {
          lotCode: g.lotCode.trim(),
          fechaVencimiento: g.fechaVencimiento || undefined,
          fechaFabricacion: g.fechaFabricacion || undefined,
          sapLot: entrySapLot.trim() || undefined,
        };
        if (g.palletLines.length > 0) {
          return g.palletLines.map((l) => ({ ...base, quantity: Number(l.qty) }));
        }
        return [{ ...base, quantity: Number(g.quantity) }];
      });
      const totalPallets = allItems.length > 0 ? allItems.length : validGroups.reduce((s, g) => s + (Number(g.palletCount) || 0), 0);

      createMovementMut.mutate({
        type: movType, date: date || undefined, productId: product.id,
        warehouseId: warehouseId || undefined, locationId: locationId || undefined,
        documentNumber: documentNumber || undefined, supplier: supplier || undefined,
        carrier: carrier || undefined, driver: driver || undefined,
        notes: notes || undefined, encargadoRecepcionId: encargadoId || undefined,
        pallets: totalPallets > 0 ? totalPallets : undefined,
        palletItems: allItems,
      });
    } else if (movType === "EXIT") {
      const palletItems: { palletId: string; quantity: number }[] = [];
      for (const row of fefoRows) {
        const targetQty = Number(row.exitQtyInput);
        const selectedPallets = row.lot.pallets.filter((p) => row.selectedIds.has(p.id));
        if (selectedPallets.length === 0) continue;
        if (targetQty > 0) {
          // Distribuye la cantidad exacta: el último pallet recibe solo el resto
          let remaining = targetQty;
          for (const p of selectedPallets) {
            if (remaining <= 0) break;
            const take = Math.min(p.quantity, remaining);
            palletItems.push({ palletId: p.id, quantity: take });
            remaining -= take;
          }
        } else {
          // Selección manual: usa cantidad completa de cada pallet
          for (const p of selectedPallets) {
            palletItems.push({ palletId: p.id, quantity: p.quantity });
          }
        }
      }
      if (palletItems.length === 0) { setFormError("Ingresá una cantidad en al menos un lote para despachar."); return; }
      createMovementMut.mutate({
        type: "EXIT", date: date || undefined, productId: product.id,
        documentNumber: documentNumber || undefined, carrier: carrier || undefined,
        driver: driver || undefined, destination: destination || undefined,
        notes: notes || undefined, encargadoRecepcionId: encargadoId || undefined,
        palletItems,
      });
    } else if (isTransfer) {
      const palletItems = fefoRows.flatMap((row) =>
        row.lot.pallets.filter((p) => row.selectedIds.has(p.id)).map((p) => ({ palletId: p.id, quantity: p.quantity }))
      );
      if (palletItems.length === 0) { setFormError("Seleccioná al menos un palet para transferir."); return; }
      if (!toLocationId) { setFormError("Seleccioná la ubicación destino."); return; }
      createMovementMut.mutate({
        type: "TRANSFER", date: date || undefined, productId: product.id,
        fromLocationId: fromLocationId || undefined, toLocationId,
        notes: notes || undefined, palletItems,
      });
    }
  }

  // ── Regularización
  function openReg(m: Movement) {
    setRegMovement(m);
    setRegForm({ ...emptyReg(), documentNumber: m.documentNumber ?? "", supplier: m.supplier ?? "", carrier: m.carrier ?? "", driver: m.driver ?? "", destination: m.destination ?? "", notes: m.notes ?? "" });
    setRegError("");
  }
  function closeReg() { setRegMovement(null); setRegForm(emptyReg()); setRegError(""); }

  const regularizeMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof regularizeMovement>[1] }) =>
      regularizeMovement(id, payload),
    onSuccess: () => {
      invalidateAfterMovement();
      toast.success("Entrada regularizada");
      closeReg();
    },
    onError: (err) => {
      const msg = getFriendlyApiError(err);
      setRegError(msg);
      toast.error(msg);
    },
  });
  const regSaving = regularizeMut.isPending;

  function handleRegularize(e: React.FormEvent) {
    e.preventDefault();
    if (!regMovement) return;
    if (!regForm.reason.trim()) { setRegError("El motivo es obligatorio."); return; }
    setRegError("");
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
    regularizeMut.mutate({ id: regMovement.id, payload: payload as Parameters<typeof regularizeMovement>[1] });
  }

  // renderFefoRows — solo para TRANSFER (EXIT tiene su propia UI basada en cantidades)
  function renderFefoRows() {
    if (fefoLoading) return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Cargando lotes...</p>;
    const noStock = fefoRows.length === 0 && !!product && !!fromLocationId;
    if (noStock) {
      return <div style={{ background: "var(--badge-adjout-bg)", border: "1px solid var(--badge-adjout-border)", color: "var(--badge-adjout-text)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>Sin stock disponible{isTransfer ? " en esta ubicación" : ""}.</div>;
    }
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {fefoRows.map((row, lotIdx) => {
          const blocked = row.lot.status === "PENDING_REGULARIZATION";
          const days = daysUntil(row.lot.fechaVencimiento);
          const hasPallets = row.lot.pallets.length > 0;
          const allSelected = hasPallets && !blocked && row.selectedIds.size === row.lot.pallets.length;
          return (
            <div key={row.lot.id} style={{ border: `1.5px solid ${blocked ? "var(--warning)" : row.selectedIds.size > 0 ? "var(--primary)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden", opacity: blocked ? 0.75 : 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, padding: "9px 12px", alignItems: "center", background: blocked ? "var(--badge-adjout-bg)" : row.selectedIds.size > 0 ? "var(--primary-light)" : "var(--bg)", cursor: blocked ? "not-allowed" : "pointer" }}
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
                    {blocked && <span className="badge badge--adj-out" style={{ fontSize: 10, marginLeft: 8 }}>PROVISORIO</span>}
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
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", cursor: blocked ? "not-allowed" : "pointer", background: row.selectedIds.has(p.id) ? "var(--primary-light)" : undefined, borderBottom: pIdx < row.lot.pallets.length - 1 ? "1px solid var(--border)" : undefined }}>
                      <input type="checkbox" checked={row.selectedIds.has(p.id)} disabled={blocked}
                        onChange={() => !blocked && togglePallet(lotIdx, p.id)}
                        style={{ width: 15, height: 15 }} />
                      <span style={{ fontWeight: 600, fontSize: 13, minWidth: 100 }}>{p.code}</span>
                      <span style={{ fontSize: 13 }}>{p.quantity.toLocaleString("es-PY")} unid.</span>
                      {p.currentLocationId && (
                        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto", fontFamily: "monospace" }}>
                          {locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8)}
                        </span>
                      )}
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
        <section className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--warning)" }}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, color: "var(--badge-adjout-text)" }}>
            Pendientes de regularización ({pending.length})
          </h3>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -4, marginBottom: 10 }}>
            Entradas provisorias que requieren completar datos. Los palets quedan bloqueados para salidas.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th scope="col">Fecha</th><th scope="col">Material</th><th scope="col">Cantidad</th><th scope="col">Observación</th><th scope="col"></th></tr>
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
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeReg()}>
          <div className="modal" style={{ width: "100%", maxWidth: 560, overflowY: "auto", maxHeight: "90vh" }}>
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
                <label htmlFor="reg-reason" style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 3 }}>Motivo de regularización *</label>
                <textarea id="reg-reason" className="input" rows={2} value={regForm.reason} onChange={(e) => setRegForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Describí por qué se regulariza..." required aria-required="true" />
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
              {regError && <p className="form-error" role="alert">{regError}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn--primary" type="submit" disabled={regSaving}>{regSaving ? "Guardando..." : "Regularizar y cerrar"}</button>
                <button type="button" className="btn" onClick={closeReg}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Ajuste de Entrada — componente dedicado ── */}
      {movType === "ADJUSTMENT_IN" && (
        <AdjustmentInForm
          onTypeChange={(t) => {
            setMovType(t);
            resetForm();
          }}
        />
      )}

      {/* ── Ajuste de Salida — componente dedicado ── */}
      {movType === "ADJUSTMENT_OUT" && (
        <AdjustmentOutForm
          onTypeChange={(t) => {
            setMovType(t);
            resetForm();
          }}
        />
      )}

      {/* ── Formulario (ENTRY, EXIT, TRANSFER) ── */}
      {movType !== "ADJUSTMENT_IN" && movType !== "ADJUSTMENT_OUT" && <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Registrar movimiento</h3>
          {/* Wizard step indicator — only for ENTRY */}
          {movType === "ENTRY" && (
            <nav aria-label="Pasos del asistente de entrada" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {WIZARD_STEPS.map((step, idx) => (
                <div key={step.n} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {idx > 0 && (
                    <div style={{ width: 24, height: 1, background: wizardStep > step.n - 1 ? "var(--primary)" : "var(--border)" }} aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => wizardStep > step.n - 1 && setWizardStep(step.n)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      cursor: wizardStep > step.n - 1 ? "pointer" : "default",
                      padding: "2px 4px",
                    }}
                    aria-current={wizardStep === step.n ? "step" : undefined}
                    aria-label={`Paso ${step.n}: ${step.label}`}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        background: wizardStep === step.n
                          ? "var(--primary)"
                          : wizardStep > step.n
                          ? "var(--success)"
                          : "var(--panel-hi)",
                        color: wizardStep >= step.n ? "#fff" : "var(--muted)",
                        border: wizardStep === step.n ? "none" : `1px solid ${wizardStep > step.n ? "var(--success)" : "var(--border)"}`,
                        flexShrink: 0,
                      }}
                    >
                      {wizardStep > step.n ? "✓" : step.n}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: wizardStep === step.n ? 700 : 400, color: wizardStep === step.n ? "var(--text)" : "var(--muted)" }}>
                      {step.label}
                    </span>
                  </button>
                </div>
              ))}
            </nav>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>

          {/* Tipo y material — always visible (step 1 for ENTRY, always for others) */}
          {(movType !== "ENTRY" || wizardStep === 1) && (
            <div className="form-section-title">Tipo y material</div>
          )}
          {(movType !== "ENTRY" || wizardStep === 1) && (
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 8, alignItems: "center" }}>
            <select className="input" value={movType}
              onChange={(e) => {
                setMovType(e.target.value as MovementType);
                setProduct(null); setFefoRows([]); setLotGroups([newLotGroup()]);
                setWizardStep(1);
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
          )}

          {/* Depósito/Ubicación — no se muestra en EXIT (ubicación viene del pallet) */}
          {(movType !== "ENTRY" || wizardStep === 1) && !isTransfer && movType !== "EXIT" && (
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
          {(movType !== "ENTRY" || wizardStep === 1) && isTransfer && (
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
                    Palets a transferir{totalTransferPallets > 0 && <span style={{ color: "var(--primary)", marginLeft: 10, fontWeight: 700 }}>{totalTransferPallets} sel. · {totalTransferQty.toLocaleString("es-PY")} unid.</span>}
                  </div>
                  {/* Scan bar — shown once FEFO rows are loaded */}
                  {fefoRows.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }}>
                          <rect x="3" y="3" width="2" height="18"/><rect x="7" y="3" width="1" height="18"/><rect x="10" y="3" width="3" height="18"/><rect x="15" y="3" width="1" height="18"/><rect x="18" y="3" width="2" height="18"/>
                        </svg>
                        Escáner USB activo · o
                      </span>
                      {cameraSupported && (
                        <button
                          type="button"
                          className={`btn${cameraActive ? " btn--primary" : ""}`}
                          onClick={() => {
                            if (cameraActive) stopCamera();
                            else if (scanVideoRef.current) void startCamera(scanVideoRef.current);
                          }}
                          style={{ fontSize: 12, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}
                          aria-label={cameraActive ? "Detener cámara" : "Escanear palet con cámara"}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                          </svg>
                          {cameraActive ? "Detener cámara" : "Escanear con cámara"}
                        </button>
                      )}
                      {cameraActive && (
                        <video
                          ref={scanVideoRef}
                          muted
                          playsInline
                          aria-hidden="true"
                          style={{
                            width: 220, height: 165, borderRadius: 8,
                            border: "2px solid var(--primary)", objectFit: "cover",
                          }}
                        />
                      )}
                    </div>
                  )}
                  {renderFefoRows()}
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Seleccioná material y ubicación de origen para ver los palets disponibles.</p>
              )}
            </>
          )}


          {/* Entrada: lotes y cantidades (Step 2 only for ENTRY wizard) */}
          {isEntry && (movType !== "ENTRY" || wizardStep === 2) && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div className="form-section-title" style={{ marginBottom: 0 }}>Lotes y cantidades</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>Lote SAP:</label>
                  <input className="input" value={entrySapLot} onChange={(e) => setEntrySapLot(e.target.value)}
                    placeholder={generateSapLot()} style={{ width: 140, fontSize: 13 }} title="Lote SAP del día — compartido para toda la entrada" />
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {lotGroups.map((group) => (
                  <div key={group.id} style={{ border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                    {/* Encabezado del lote */}
                    <div style={{ background: "var(--bg)", padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 120px 120px 32px", gap: 6, alignItems: "end", borderBottom: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Código de lote *</div>
                        <input className="input" placeholder="Ej: L2026-001" value={group.lotCode}
                          onChange={(e) => updateGroup(group.id, "lotCode", e.target.value)} style={{ fontSize: 13, fontWeight: 700 }} />
                      </div>
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
                      <button type="button" onClick={() => removeLotGroup(group.id)} disabled={lotGroups.length === 1}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: 18, padding: 0, alignSelf: "center" }}>×</button>
                    </div>
                    {/* Cantidad y pallets */}
                    <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "end" }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 2 }}>Cantidad *</div>
                        <input className="input" type="number" min={1} placeholder="Unidades recibidas"
                          value={group.quantity} onChange={(e) => updateGroup(group.id, "quantity", e.target.value)}
                          style={{ fontSize: 14, fontWeight: 700 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Cant. pallets</div>
                        <input className="input" type="number" min={0} placeholder="Distribuye automático"
                          value={group.palletCount} onChange={(e) => updateGroup(group.id, "palletCount", e.target.value)}
                          style={{ fontSize: 13 }} />
                      </div>
                    </div>
                    {/* Desglose de pallets (auto-distribuido y editable) */}
                    {group.palletLines.length > 0 && (
                      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", background: "var(--bg-base)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                            Desglose — {group.palletLines.length} pallets
                          </span>
                          {(() => {
                            const sum = group.palletLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
                            const total = Number(group.quantity);
                            return sum === total
                              ? <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 700 }}>✓ {sum.toLocaleString("es-PY")} unid.</span>
                              : <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 700 }}>Suma: {sum.toLocaleString("es-PY")} ≠ {total.toLocaleString("es-PY")}</span>;
                          })()}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 5 }}>
                          {group.palletLines.map((line, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", minWidth: 28, flexShrink: 0 }}>P{idx + 1}</span>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                value={line.qty}
                                onChange={(e) => updatePalletLine(group.id, idx, e.target.value)}
                                style={{ fontSize: 12, padding: "3px 6px", width: "100%" }}
                                aria-label={`Pallet ${idx + 1} cantidad`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" className="btn" onClick={addLotGroup} style={{ alignSelf: "start", fontSize: 13 }}>+ Agregar otro lote</button>
              </div>

              {/* Resumen inline */}
              {lotGroups.some((g) => g.lotCode.trim() && Number(g.quantity) > 0) && (
                <div style={{ background: "var(--bg)", border: "1px solid var(--border-dim)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>Total entrada: </span>
                  <strong style={{ color: "var(--success)" }}>
                    {lotGroups.reduce((s, g) => s + (Number(g.quantity) || 0), 0).toLocaleString("es-PY")} unidades
                  </strong>
                  {(lotGroups.some((g) => g.palletLines.length > 0) || lotGroups.some((g) => Number(g.palletCount) > 0)) && (
                    <span style={{ color: "var(--muted)", marginLeft: 10 }}>
                      en {lotGroups.reduce((s, g) => s + (g.palletLines.length > 0 ? g.palletLines.length : (Number(g.palletCount) || 0)), 0)} pallets
                    </span>
                  )}
                  <span style={{ color: "var(--muted)", marginLeft: 10 }}>
                    · {lotGroups.filter((g) => g.lotCode.trim() && Number(g.quantity) > 0).length} lote(s)
                  </span>
                </div>
              )}

            </>
          )}

          {/* ── Salida: por lote FEFO con cantidad ── */}
          {movType === "EXIT" && (
            <>
              <div className="form-section-title">
                Lotes a despachar
                {totalExitQty > 0 && (
                  <span style={{ color: "var(--primary)", marginLeft: 10, fontWeight: 700 }}>
                    {totalExitPallets} palet{totalExitPallets !== 1 ? "s" : ""} · {totalExitQty.toLocaleString("es-PY")} unid.
                  </span>
                )}
              </div>

              {!product ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  Seleccioná un material para ver los lotes disponibles (orden FEFO).
                </p>
              ) : fefoLoading ? (
                <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Cargando lotes...</p>
              ) : fefoRows.length === 0 ? (
                <div style={{ background: "var(--badge-adjout-bg)", border: "1px solid var(--badge-adjout-border)", color: "var(--badge-adjout-text)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                  Sin stock disponible para este material.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {fefoRows.map((row, lotIdx) => {
                    const blocked = row.lot.status === "PENDING_REGULARIZATION";
                    const availPallets = row.lot.pallets;
                    const availQty = availPallets.reduce((s, p) => s + p.quantity, 0);
                    const selPallets = availPallets.filter((p) => row.selectedIds.has(p.id));
                    const selQty = selPallets.reduce((s, p) => s + p.quantity, 0);
                    const enteredQty = Number(row.exitQtyInput);
                    const qtyMismatch = !!row.exitQtyInput && enteredQty > 0 && selQty !== enteredQty;
                    const days = daysUntil(row.lot.fechaVencimiento);

                    const borderColor = blocked
                      ? "var(--warning)"
                      : row.selectedIds.size > 0
                      ? "var(--primary)"
                      : "var(--border)";

                    return (
                      <div key={row.lot.id} style={{ border: `1.5px solid ${borderColor}`, borderRadius: 10, overflow: "hidden", opacity: blocked ? 0.75 : 1 }}>

                        {/* ── Encabezado del lote ── */}
                        <div style={{ padding: "9px 12px", background: blocked ? "var(--badge-adjout-bg)" : row.selectedIds.size > 0 ? "var(--primary-light)" : "var(--bg)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 800, fontSize: 14 }}>{row.lot.lotCode}</span>
                            {row.lot.sapLot && (
                              <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, fontFamily: "monospace" }}>{row.lot.sapLot}</span>
                            )}
                            {blocked && (
                              <span className="badge badge--adj-out" style={{ fontSize: 10 }}>PROVISORIO — bloqueado</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12 }}>
                            {row.lot.fechaVencimiento && (
                              <span style={{ color: "var(--muted)" }}>
                                Vence: {new Date(row.lot.fechaVencimiento).toLocaleDateString("es-PY")}
                                {expiryBadge(days)}
                              </span>
                            )}
                            <span style={{ fontWeight: 700 }}>{availQty.toLocaleString("es-PY")} unid.</span>
                            <span style={{ color: "var(--muted)" }}>{availPallets.length} palet{availPallets.length !== 1 ? "s" : ""}</span>
                          </div>
                        </div>

                        {/* ── Cantidad a despachar ── */}
                        <div style={{ padding: "10px 12px", background: "var(--panel)", display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: blocked ? "var(--muted)" : "var(--danger)", textTransform: "uppercase", marginBottom: 3 }}>
                              Cantidad a despachar
                            </div>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={availQty}
                              placeholder="0"
                              value={row.exitQtyInput}
                              onChange={(e) => handleExitQtyChange(lotIdx, e.target.value)}
                              disabled={blocked}
                              style={{ fontSize: 15, fontWeight: 700, width: "100%", borderColor: !blocked && row.exitQtyInput && enteredQty > availQty ? "var(--danger)" : undefined }}
                              aria-label={`Cantidad a despachar del lote ${row.lot.lotCode}`}
                            />
                            {row.exitQtyInput && enteredQty > availQty && (
                              <p style={{ color: "var(--danger)", fontSize: 11, margin: "3px 0 0" }}>
                                Supera el stock disponible ({availQty.toLocaleString("es-PY")} unid.)
                              </p>
                            )}
                          </div>

                          {/* Resumen de selección */}
                          <div>
                            {selPallets.length > 0 ? (
                              <div style={{ fontSize: 12 }}>
                                <span style={{ color: "var(--success)", fontWeight: 700 }}>
                                  ✓ {selPallets.length} palet{selPallets.length !== 1 ? "s" : ""}
                                  {" · "}
                                  {enteredQty > 0
                                    ? <>{enteredQty.toLocaleString("es-PY")} unid. a despachar</>
                                    : <>{selQty.toLocaleString("es-PY")} unid.</>
                                  }
                                </span>
                                {qtyMismatch && selQty > enteredQty && (
                                  <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                                    (último pallet parcial)
                                  </span>
                                )}
                              </div>
                            ) : blocked ? (
                              <span style={{ fontSize: 12, color: "var(--muted)" }}>Pendiente de regularización — no se puede despachar</span>
                            ) : (
                              <span style={{ fontSize: 12, color: "var(--muted)" }}>Ingresá una cantidad para auto-seleccionar palets</span>
                            )}
                          </div>
                        </div>

                        {/* ── Desglose de palets (expandible) ── */}
                        {availPallets.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleExpanded(lotIdx)}
                              style={{ width: "100%", background: "none", border: "none", borderTop: "1px solid var(--border-dim)", padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)", textAlign: "left" }}
                            >
                              <span style={{ fontSize: 10 }}>{row.expanded ? "▲" : "▼"}</span>
                              Desglose de palets
                              {selPallets.length > 0 && (
                                <span style={{ color: "var(--primary)", fontWeight: 700, marginLeft: 4 }}>
                                  {selPallets.length} de {availPallets.length} seleccionados
                                </span>
                              )}
                            </button>
                            {row.expanded && (
                              <div style={{ borderTop: "1px solid var(--border-dim)" }}>
                                {availPallets.map((p, pIdx) => {
                                  const isSelected = row.selectedIds.has(p.id);
                                  return (
                                    <label
                                      key={p.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "6px 16px",
                                        cursor: blocked ? "not-allowed" : "pointer",
                                        background: isSelected ? "var(--primary-light)" : undefined,
                                        borderBottom: pIdx < availPallets.length - 1 ? "1px solid var(--border-dim)" : undefined,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={blocked}
                                        onChange={() => !blocked && togglePallet(lotIdx, p.id)}
                                        style={{ width: 15, height: 15 }}
                                      />
                                      <span style={{ fontWeight: 600, fontSize: 13, minWidth: 120, fontFamily: "monospace" }}>{p.code}</span>
                                      <span style={{ fontSize: 13 }}>{p.quantity.toLocaleString("es-PY")} unid.</span>
                                      {p.currentLocationId && (
                                        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto", fontFamily: "monospace" }}>
                                          {locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8)}
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Datos logísticos — step 1 for ENTRY, always for others */}
          {(movType !== "ENTRY" || wizardStep === 1) && (
            <>
              <div className="form-section-title">Datos logísticos</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                {!isTransfer && <input className="input" placeholder="N° remito / documento" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
                {isEntry && <input className="input" placeholder="Proveedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
                {!isTransfer && <input className="input" placeholder="Transportadora" value={carrier} onChange={(e) => setCarrier(e.target.value)} />}
                {!isTransfer && <input className="input" placeholder="Conductor" value={driver} onChange={(e) => setDriver(e.target.value)} />}
                {movType === "EXIT" && <input className="input" placeholder="Destino" value={destination} onChange={(e) => setDestination(e.target.value)} />}
                {!isTransfer && (
                  <select className="input" value={encargadoId} onChange={(e) => setEncargadoId(e.target.value)}>
                    <option value="">Encargado recepción</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.username} ({u.role})</option>)}
                  </select>
                )}
              </div>
              <textarea className="input"
                placeholder="Observaciones (opcional)"
                value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                aria-label="Observaciones" />
            </>
          )}


          {formError && (
            <div className="form-error" role="alert">{formError}</div>
          )}

          {/* Navigation buttons */}
          {movType === "ENTRY" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {wizardStep > 1 && (
                <button type="button" className="btn" onClick={() => setWizardStep((s) => s - 1)} aria-label="Paso anterior">
                  ← Anterior
                </button>
              )}
              {wizardStep < 2 && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    if (!product) { setFormError("Seleccioná un material antes de continuar."); return; }
                    setFormError("");
                    setWizardStep(2);
                  }}
                >
                  Siguiente →
                </button>
              )}
              {wizardStep === 2 && (
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={saving}
                  aria-label="Confirmar y registrar entrada"
                >
                  {saving ? "Guardando..." : "✓ Confirmar entrada"}
                </button>
              )}
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn btn--primary" type="submit" disabled={saving || !product}>
                {saving ? "Guardando..." : "Registrar movimiento"}
              </button>
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          )}
        </form>
      </section>}

    </div>
  );
}
