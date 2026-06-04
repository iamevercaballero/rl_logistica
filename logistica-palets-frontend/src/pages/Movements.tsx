import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import ProductSearch from "../components/ProductSearch";
import AdjustmentInForm from "./AdjustmentInForm";
import AdjustmentOutForm from "./AdjustmentOutForm";
import InventoryAdjustmentPage from "./InventoryAdjustment";
import {
  createMovement,
  createDocument,
  getMovements,
  getDocuments,
  regularizeMovement,
  type Movement,
  type MovementType,
  type PalletItem,
  type CreateDocumentPayload,
  type LogisticsDocument,
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

// ── Línea del carrito de remito: un producto ya cargado (con sus lotes/pallets)
//    listo para agregarse al documento multi-producto.
type CartLine = {
  key: number;
  productId: string;
  productLabel: string;
  palletItems: PalletItem[];
  totalQty: number;
  palletsCount: number;
  summary: string;
  locationId?: string;
};
let _cartKey = 0;

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

/**
 * Para cada pallet seleccionado calcula exactamente cuánto se despachará.
 * - Si targetQty > 0: distribuye la cantidad justa (el último pallet puede ser parcial).
 * - Si targetQty = 0: despacha el pallet completo (selección manual).
 */
function calcDispatchAmounts(
  pallets: LotPallet[],
  selectedIds: Set<string>,
  targetQty: number,
): Map<string, { dispatch: number; remaining: number; isPartial: boolean }> {
  const result = new Map<string, { dispatch: number; remaining: number; isPartial: boolean }>();
  const selected = pallets.filter((p) => selectedIds.has(p.id));

  if (targetQty > 0) {
    let remaining = targetQty;
    for (const p of selected) {
      const dispatch = Math.min(p.quantity, remaining);
      remaining -= dispatch;
      result.set(p.id, {
        dispatch,
        remaining: p.quantity - dispatch,
        isPartial: dispatch < p.quantity,
      });
    }
  } else {
    for (const p of selected) {
      result.set(p.id, { dispatch: p.quantity, remaining: 0, isPartial: false });
    }
  }
  return result;
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
  // UI-only: cuando es true muestra el módulo de Ajuste de Inventario (RLAI/RLAO)
  const [showInventoryAdj, setShowInventoryAdj] = useState(false);
  // UI-only: historial de remitos (RLNE/RLNS) con botones de impresión
  const [showDocHistory, setShowDocHistory] = useState(false);

  const isDocType = movType === "ENTRY" || movType === "EXIT";
  const docsQ = useQuery({
    queryKey: ["documents", movType, showDocHistory],
    queryFn: () => getDocuments({ type: movType as "ENTRY" | "EXIT" }),
    enabled: isDocType && showDocHistory,
    staleTime: 30_000,
  });
  const documents: LogisticsDocument[] = docsQ.data ?? [];
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

  // CARRITO de remito (entrada/salida multi-producto): productos ya cargados.
  const [cart, setCart] = useState<CartLine[]>([]);

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
    setCart([]);
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
      const selQty = r.lot.pallets
        .filter((p) => ids.has(p.id))
        .reduce((s, p) => s + p.quantity, 0);
      return { ...r, selectedIds: ids, exitQtyInput: selQty > 0 ? String(selQty) : "" };
    }));
  }
  function toggleAllPallets(lotIdx: number, checked: boolean) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const avail = r.lot.status !== "PENDING_REGULARIZATION" ? r.lot.pallets : [];
      const ids = checked ? new Set(avail.map((p) => p.id)) : new Set<string>();
      const selQty = checked ? avail.reduce((s, p) => s + p.quantity, 0) : 0;
      return { ...r, selectedIds: ids, exitQtyInput: selQty > 0 ? String(selQty) : "" };
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

  const createDocumentMut = useMutation({
    mutationFn: (payload: CreateDocumentPayload) => createDocument(payload),
    onSuccess: (res) => {
      invalidateAfterMovement();
      toast.success(`Remito ${res.code} registrado (${res.movementIds.length} producto(s))`);
      setCart([]);
      resetForm();
    },
    onError: (err) => {
      const msg = getFriendlyApiError(err);
      setFormError(msg);
      toast.error(msg);
    },
  });
  const savingDoc = createDocumentMut.isPending;

  /**
   * Construye la línea (producto + items) del producto actualmente cargado.
   * Devuelve { error } si falta data, o null si no hay producto seleccionado.
   */
  function buildCurrentLine(): { line: CartLine } | { error: string } | null {
    if (!product) return null;

    if (isEntry) {
      const validGroups = lotGroups.filter((g) => g.lotCode.trim() && Number(g.quantity) > 0);
      if (validGroups.length === 0) return { error: "Agregá al menos un lote con código y cantidad." };
      const palletItems: PalletItem[] = validGroups.flatMap((g) => {
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
      const totalQty = palletItems.reduce((s, i) => s + (i.quantity || 0), 0);
      return {
        line: {
          key: ++_cartKey,
          productId: product.id,
          productLabel: `${product.code} · ${product.description}`,
          palletItems,
          totalQty,
          palletsCount: palletItems.length,
          summary: `Lotes: ${validGroups.map((g) => g.lotCode.trim()).join(", ")}`,
          locationId: locationId || undefined,
        },
      };
    }

    // SALIDA: arma palletItems desde la selección FEFO (mismo cálculo que antes).
    const palletItems: PalletItem[] = [];
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
        for (const p of selectedPallets) {
          palletItems.push({ palletId: p.id, quantity: p.quantity });
        }
      }
    }
    if (palletItems.length === 0) return { error: "Ingresá una cantidad en al menos un lote para despachar." };
    const totalQty = palletItems.reduce((s, i) => s + (i.quantity || 0), 0);
    const lotsUsed = fefoRows.filter((r) => r.selectedIds.size > 0).map((r) => r.lot.lotCode);
    return {
      line: {
        key: ++_cartKey,
        productId: product.id,
        productLabel: `${product.code} · ${product.description}`,
        palletItems,
        totalQty,
        palletsCount: palletItems.length,
        summary: lotsUsed.length ? `Lotes: ${lotsUsed.join(", ")}` : `${palletItems.length} pallet(s)`,
      },
    };
  }

  /** Limpia solo la sección de producto; mantiene la cabecera del remito. */
  function resetProductSection() {
    setProduct(null);
    setLotGroups([newLotGroup()]);
    setEntrySapLot(generateSapLot());
    setFefoRows([]);
    setWizardStep(1);
  }

  /** Agrega el producto actual al carrito y limpia la sección de producto. */
  function addToCart(): boolean {
    const res = buildCurrentLine();
    if (!res) { setFormError("Seleccioná un material."); return false; }
    if ("error" in res) { setFormError(res.error); return false; }
    setFormError("");
    setCart((c) => [...c, res.line]);
    resetProductSection();
    return true;
  }

  function removeFromCart(key: number) {
    setCart((c) => c.filter((l) => l.key !== key));
  }

  /** Envía el remito completo: carrito + producto actual (si está cargado y válido). */
  function submitDocument() {
    let lines = cart;
    if (product) {
      const res = buildCurrentLine();
      if (res && "error" in res) {
        if (cart.length === 0) { setFormError(res.error); return; }
      } else if (res && "line" in res) {
        lines = [...cart, res.line];
      }
    }
    if (lines.length === 0) { setFormError("Agregá al menos un producto al remito."); return; }
    setFormError("");

    const payload: CreateDocumentPayload = {
      type: isEntry ? "ENTRY" : "EXIT",
      date: date || undefined,
      documentNumber: documentNumber || undefined,
      supplier: isEntry ? supplier || undefined : undefined,
      destination: !isEntry ? destination || undefined : undefined,
      warehouseId: warehouseId || undefined,
      carrier: carrier || undefined,
      driver: driver || undefined,
      notes: notes || undefined,
      encargadoId: encargadoId || undefined,
      lines: lines.map((l) => ({
        productId: l.productId,
        locationId: l.locationId,
        palletItems: l.palletItems,
      })),
    };
    createDocumentMut.mutate(payload);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (isTransfer) {
      if (!product) { setFormError("Seleccioná un material."); return; }
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
      return;
    }

    // ENTRY / EXIT → documento multi-producto (remito)
    submitDocument();
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
                    <td style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--muted)" }}>{new Date(m.date).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
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
              <span style={{ marginLeft: 12, color: "var(--muted)" }}>{new Date(regMovement.date).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" })}</span>
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

      {/* ── Ajuste de Inventario (RLAI/RLAO) — componente dedicado ── */}
      {showInventoryAdj && <InventoryAdjustmentPage />}

      {/* ── Ajuste de Entrada — componente dedicado ── */}
      {!showInventoryAdj && movType === "ADJUSTMENT_IN" && (
        <AdjustmentInForm
          onTypeChange={(t) => {
            if (t === "INVENTORY_ADJUSTMENT") { setShowInventoryAdj(true); resetForm(); }
            else { setShowInventoryAdj(false); setMovType(t); resetForm(); }
          }}
        />
      )}

      {/* ── Ajuste de Salida — componente dedicado ── */}
      {!showInventoryAdj && movType === "ADJUSTMENT_OUT" && (
        <AdjustmentOutForm
          onTypeChange={(t) => {
            if (t === "INVENTORY_ADJUSTMENT") { setShowInventoryAdj(true); resetForm(); }
            else { setShowInventoryAdj(false); setMovType(t); resetForm(); }
          }}
        />
      )}

      {/* ── Toggle historial / nuevo remito (solo para ENTRY y EXIT) ── */}
      {!showInventoryAdj && isDocType && (
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => setShowDocHistory(false)}
            style={{
              padding: "6px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: !showDocHistory ? "var(--primary)" : "var(--panel-hi)",
              color: !showDocHistory ? "#fff" : "var(--muted)",
              border: !showDocHistory ? "none" : "1px solid var(--border)",
            }}
          >
            Nuevo remito
          </button>
          <button
            type="button"
            onClick={() => setShowDocHistory(true)}
            style={{
              padding: "6px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: showDocHistory ? "var(--primary)" : "var(--panel-hi)",
              color: showDocHistory ? "#fff" : "var(--muted)",
              border: showDocHistory ? "none" : "1px solid var(--border)",
            }}
          >
            Historial de remitos
          </button>
        </div>
      )}

      {/* ── Historial de remitos (RLNE / RLNS) con botones de impresión ── */}
      {!showInventoryAdj && isDocType && showDocHistory && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
              {movType === "ENTRY" ? "Remitos de Entrada (RLNE)" : "Remitos de Salida (RLNS)"}
            </h3>
            <button
              type="button"
              onClick={() => docsQ.refetch()}
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", color: "var(--muted)" }}
            >
              Actualizar
            </button>
          </div>

          {docsQ.isLoading ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando...</p>
          ) : documents.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>No hay remitos registrados.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Fecha</th>
                    <th>{movType === "ENTRY" ? "Proveedor" : "Destino"}</th>
                    <th>N° externo</th>
                    <th style={{ textAlign: "right" }}>Productos</th>
                    <th style={{ textAlign: "right" }}>Unidades</th>
                    <th style={{ textAlign: "center" }}>Estado</th>
                    <th style={{ textAlign: "center" }}>Imprimir</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "var(--primary)", whiteSpace: "nowrap" }}>
                        {doc.code}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--muted)" }}>
                        {new Date(doc.date).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                      <td style={{ fontSize: 13 }}>{(movType === "ENTRY" ? doc.supplier : doc.destination) ?? "—"}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{doc.documentNumber ?? "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{doc.totalLines}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{doc.totalQuantity.toLocaleString("es-PY")}</td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: doc.status === "APROBADO" ? "var(--badge-in-bg, #dcfce7)" : "var(--badge-adj-bg, #fef9c3)",
                          color: doc.status === "APROBADO" ? "var(--badge-in-text, #166534)" : "var(--badge-adj-text, #854d0e)",
                        }}>
                          {doc.status.replace("_", " ")}
                        </span>
                      </td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          title="Imprimir nota"
                          onClick={() => window.open(`/print/document/${doc.id}`, "_blank")}
                          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 14, marginRight: 4 }}
                        >
                          🖨️
                        </button>
                        <button
                          type="button"
                          title="Imprimir etiquetas de pallet"
                          onClick={() => window.open(`/print/labels/${doc.id}`, "_blank")}
                          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 14 }}
                        >
                          🏷️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Formulario (ENTRY, EXIT, TRANSFER) ── */}
      {!showInventoryAdj && movType !== "ADJUSTMENT_IN" && movType !== "ADJUSTMENT_OUT" && !showDocHistory && <section className="card">
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
            <select className="input"
              value={showInventoryAdj ? "INVENTORY_ADJUSTMENT" : movType}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "INVENTORY_ADJUSTMENT") {
                  setShowInventoryAdj(true);
                  resetForm();
                } else {
                  setShowInventoryAdj(false);
                  setMovType(val as MovementType);
                  setProduct(null); setFefoRows([]); setLotGroups([newLotGroup()]);
                  setWizardStep(1);
                }
              }}
            >
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Salida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="ADJUSTMENT_IN">Ajuste entrada</option>
              <option value="ADJUSTMENT_OUT">Ajuste salida</option>
              <option value="INVENTORY_ADJUSTMENT">Ajuste de inventario</option>
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
                                Vence: {new Date(row.lot.fechaVencimiento).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" })}
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
                                    : <>{selQty.toLocaleString("es-PY")} unid. (palets completos)</>
                                  }
                                </span>
                                {/* Advertencia: selección manual sin cantidad → despacha pallet completo */}
                                {!row.exitQtyInput && selPallets.length > 0 && (
                                  <span style={{ color: "var(--warning)", marginLeft: 8, fontWeight: 600 }}>
                                    ⚠ Sin cantidad → se despachan palets completos
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
                              {qtyMismatch && (
                                <span style={{ color: "var(--warning)", fontWeight: 600, marginLeft: 4 }}>
                                  · parcial
                                </span>
                              )}
                            </button>
                            {row.expanded && (() => {
                              // Calcula exactamente cuánto se despacha por pallet
                              const dispatchMap = calcDispatchAmounts(
                                availPallets,
                                row.selectedIds,
                                enteredQty,
                              );
                              return (
                                <div style={{ borderTop: "1px solid var(--border-dim)" }}>
                                  {availPallets.map((p, pIdx) => {
                                    const isSelected = row.selectedIds.has(p.id);
                                    const info = dispatchMap.get(p.id);
                                    return (
                                      <label
                                        key={p.id}
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "auto auto 1fr auto",
                                          alignItems: "center",
                                          gap: 10,
                                          padding: "7px 16px",
                                          cursor: blocked ? "not-allowed" : "pointer",
                                          background: isSelected
                                            ? info?.isPartial
                                              ? "rgba(var(--warning-rgb, 255,170,0), 0.08)"
                                              : "var(--primary-light)"
                                            : undefined,
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
                                        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "monospace", minWidth: 120 }}>
                                          {p.code}
                                        </span>
                                        {/* Cantidad stock actual */}
                                        <span style={{ fontSize: 13, color: "var(--muted)" }}>
                                          {p.quantity.toLocaleString("es-PY")} unid. stock
                                        </span>
                                        {/* Badge de qué pasará con este pallet */}
                                        {isSelected && info && (
                                          <span style={{ fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                            {info.isPartial ? (
                                              <>
                                                <span style={{
                                                  background: "var(--badge-adjout-bg)",
                                                  color: "var(--badge-adjout-text)",
                                                  border: "1px solid var(--badge-adjout-border)",
                                                  borderRadius: 4, padding: "1px 6px",
                                                }}>
                                                  −{info.dispatch.toLocaleString("es-PY")}
                                                </span>
                                                <span style={{ color: "var(--success)" }}>
                                                  quedan {info.remaining.toLocaleString("es-PY")}
                                                </span>
                                              </>
                                            ) : (
                                              <span style={{
                                                background: "var(--badge-exit-bg, rgba(239,68,68,0.1))",
                                                color: "var(--danger)",
                                                border: "1px solid var(--badge-exit-border, rgba(239,68,68,0.3))",
                                                borderRadius: 4, padding: "1px 6px",
                                              }}>
                                                −{info.dispatch.toLocaleString("es-PY")} total
                                              </span>
                                            )}
                                          </span>
                                        )}
                                        {!isSelected && p.currentLocationId && (
                                          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace", justifySelf: "end" }}>
                                            {locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8)}
                                          </span>
                                        )}
                                      </label>
                                    );
                                  })}
                                </div>
                              );
                            })()}
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


          {/* Carrito de productos del remito (entrada/salida multi-producto) */}
          {!isTransfer && cart.length > 0 && (
            <div style={{ border: "1.5px solid var(--primary)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ background: "var(--bg)", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 800 }}>
                Productos en este remito ({cart.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Detalle</th>
                      <th style={{ textAlign: "right" }}>Cantidad</th>
                      <th style={{ textAlign: "right" }}>Pallets</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((l) => (
                      <tr key={l.key}>
                        <td style={{ fontWeight: 600 }}>{l.productLabel}</td>
                        <td style={{ color: "var(--muted)", fontSize: 12 }}>{l.summary}</td>
                        <td style={{ textAlign: "right" }}>{l.totalQty.toLocaleString("es-PY")}</td>
                        <td style={{ textAlign: "right" }}>{l.palletsCount}</td>
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="btn" onClick={() => removeFromCart(l.key)} style={{ padding: "2px 8px", color: "var(--danger)" }} aria-label="Quitar producto">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {formError && (
            <div className="form-error" role="alert">{formError}</div>
          )}

          {/* Navigation / acciones */}
          {isTransfer ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn btn--primary" type="submit" disabled={saving || !product}>
                {saving ? "Guardando..." : "Registrar movimiento"}
              </button>
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          ) : movType === "ENTRY" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
                <button type="button" className="btn" onClick={addToCart} disabled={!product}>
                  + Agregar otro producto
                </button>
              )}
              {(wizardStep === 2 || cart.length > 0) && (
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={savingDoc}
                  aria-label="Registrar remito de entrada"
                >
                  {savingDoc ? "Guardando..." : `✓ Registrar remito${cart.length ? ` (${cart.length + (product ? 1 : 0)} prod.)` : ""}`}
                </button>
              )}
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={addToCart} disabled={!product}>
                + Agregar otro producto
              </button>
              <button className="btn btn--primary" type="submit" disabled={savingDoc}>
                {savingDoc ? "Guardando..." : `Registrar remito${cart.length ? ` (${cart.length + (product ? 1 : 0)} prod.)` : ""}`}
              </button>
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          )}
        </form>
      </section>}

    </div>
  );
}
