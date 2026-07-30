import { useEffect, useState } from "react";
import DispatchLogDrawer from "../components/DispatchLogDrawer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ProductStockPanel from "../components/ProductStockPanel";
import MaterialSearchBar from "../components/adjustments/MaterialSearchBar";
import LotPalletBreakdownTable, { type ScopedLot } from "../components/adjustments/LotPalletBreakdownTable";
import CountLevelPicker, { type CountLevel } from "../components/adjustments/CountLevelPicker";
import CountEntryPanel from "../components/adjustments/CountEntryPanel";
import SurplusAllocationPicker, { type SurplusDestination } from "../components/adjustments/SurplusAllocationPicker";
import ShortageAllocationTable, { computeShortageAllocation, type CandidatePallet } from "../components/adjustments/ShortageAllocationTable";
import AdjustmentSummary from "../components/adjustments/AdjustmentSummary";
import type { Product } from "../api/products";
import { listWarehouses } from "../api/warehouses";
import { listLocations } from "../api/locations";
import { generateSapLot, fefoLots } from "../api/lots";
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
  type AdjustmentStatus,
  type CreateAdjustmentLinePayload,
} from "../api/adjustments";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useAuth } from "../auth/AuthContext";
import { canApprove } from "../auth/rbac";

// ── Tipos locales ────────────────────────────────────────────────────────────

// Sobrante a nivel Producto/Lote (pallet no registrado / sin pallet): registra pallet(s) nuevo(s).
type PalletLine = { qty: string };
type LotGroup = {
  id: number; lotCode: string; quantity: string; palletCount: string;
  palletLines: PalletLine[]; fechaVencimiento: string; fechaFabricacion: string;
};
let _gid = 0;
const newLotGroup = (lotCode = ""): LotGroup => ({
  id: ++_gid, lotCode, quantity: "", palletCount: "",
  palletLines: [], fechaVencimiento: "", fechaFabricacion: "",
});

function generateAutoLotCode(): string {
  return `SINLOTE-${Date.now().toString(36).toUpperCase()}`;
}

/** GET /locations devuelve el depósito como objeto anidado (`warehouse.id`), no como `warehouseId` plano. */
function locationWarehouseId(loc: { warehouseId?: string; warehouse?: { id: string } }): string | undefined {
  return loc.warehouse?.id ?? loc.warehouseId;
}

type CartLine = {
  key: number; productId: string; productLabel: string;
  direction: AdjustmentType;
  palletItems: CreateAdjustmentLinePayload["palletItems"];
  totalQty: number; summary: string;
  /** Presente solo en líneas "pallet existente" — ubicación real del pallet, derivada, no pedida. */
  locationId?: string;
  level: CountLevel;
  scopeLabel: string;
  systemQty: number;
  physicalQty: number;
};
let _ck = 0;

type Bucket = { direction: AdjustmentType; warehouseId?: string; lines: CartLine[] };

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
type MovementNav = "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "INVENTORY_ADJUSTMENT";

export default function InventoryAdjustmentPage({ onTypeChange }: { onTypeChange?: (t: MovementNav) => void } = {}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userCanApprove = user ? canApprove(user.role) : false;

  // Cabecera de la sesión de carga (una vez por tanda de conteo)
  const [reason, setReason] = useState("DIFERENCIA_INVENTARIO");
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");

  // Material + nivel de conteo
  const [product, setProduct] = useState<Product | null>(null);
  const [level, setLevel] = useState<CountLevel>("PRODUCT");
  const [scopeLot, setScopeLot] = useState<ScopedLot | null>(null);
  const [scopePallet, setScopePallet] = useState<LotPallet | null>(null);
  const [physicalQtyInput, setPhysicalQtyInput] = useState("");

  // Sobrante (Producto/Lote): dónde están las unidades
  const [surplusDestination, setSurplusDestination] = useState<SurplusDestination>("NEW_PALLET");
  const [surplusPallet, setSurplusPallet] = useState<LotPallet | null>(null);
  const [entrySapLot, setEntrySapLot] = useState(() => generateSapLot());
  const [lotGroups, setLotGroups] = useState<LotGroup[]>([newLotGroup()]);

  // Faltante (Producto/Lote): recuento por pallet
  const [shortagePhysicalByPallet, setShortagePhysicalByPallet] = useState<Record<string, string>>({});

  // Carrito, errores y resumen previo al envío
  const [cart, setCart] = useState<CartLine[]>([]);
  const [formError, setFormError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState<{ submit: boolean; lines: CartLine[] } | null>(null);

  // Rechazo inline / bitácora / filtros del listado
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [logAdjId, setLogAdjId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"" | AdjustmentType>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const warehousesQ = useQuery({ queryKey: ["warehouses"], queryFn: listWarehouses });
  const locationsQ  = useQuery({ queryKey: ["locations"],  queryFn: listLocations });
  const listQ = useQuery({
    queryKey: ["adjustments", filterType, filterStatus],
    queryFn: () => getAdjustments({
      type: (filterType || undefined) as AdjustmentType | undefined,
      status: (filterStatus || undefined) as AdjustmentStatus | undefined,
      limit: 60,
    }),
  });
  const adjustments = listQ.data?.data ?? [];
  const logAdj = adjustments.find((a) => a.id === logAdjId);

  // Contador de pendientes — independiente del filtro que esté mirando el operador.
  const pendingQ = useQuery({
    queryKey: ["adjustments", "pending-count"],
    queryFn: () => getAdjustments({ status: "PENDIENTE_APROBACION", limit: 1 }),
    enabled: userCanApprove,
  });
  const pendingCount = pendingQ.data?.meta.total ?? 0;

  // Lotes + pallets del producto — fuente única para contexto, nivel Lote/Pallet, sobrante y faltante.
  const lotsQ = useQuery({
    queryKey: ["lots", "fefo", { productId: product?.id }],
    queryFn: () => fefoLots(product?.id),
    enabled: !!product,
  });
  const lots = (lotsQ.data ?? []) as ScopedLot[];

  const locationMap = Object.fromEntries((locationsQ.data ?? []).map((l) => [l.id, l.code]));
  const filteredLocs = (locationsQ.data ?? []).filter((l) => !warehouseId || locationWarehouseId(l) === warehouseId);

  // ── Stock "sistema" según el nivel de conteo elegido ──────────────────────
  const systemQty = !product ? 0
    : level === "PRODUCT" ? lots.reduce((s, l) => s + l.stockActual, 0)
    : level === "LOT" ? (scopeLot?.stockActual ?? 0)
    : (scopePallet?.quantity ?? 0);

  const physicalQty = physicalQtyInput.trim() === "" ? null : Number(physicalQtyInput);
  const diff = physicalQty === null || Number.isNaN(physicalQty) ? null : physicalQty - systemQty;

  // Candidatos para "pallet existente" (sobrante) y para la distribución del faltante.
  const surplusCandidateLots: ScopedLot[] = level === "LOT" ? (scopeLot ? [scopeLot] : []) : lots;
  const shortageCandidates: CandidatePallet[] = level === "LOT"
    ? (scopeLot ? scopeLot.pallets.map((p) => ({ ...p, lotCode: scopeLot.lotCode })) : [])
    : lots.flatMap((l) => l.pallets.map((p) => ({ ...p, lotCode: l.lotCode })));

  const cartInCount = cart.filter((l) => l.direction === "ADJUSTMENT_IN").length;
  const cartOutCount = cart.filter((l) => l.direction === "ADJUSTMENT_OUT").length;
  const cartHasNewPalletLine = cart.some((l) => l.direction === "ADJUSTMENT_IN" && !l.locationId);
  const pendingIsNewPalletLine = diff !== null && diff > 0 && level !== "PALLET" && surplusDestination !== "EXISTING_PALLET";
  const warehouseRequired = cartHasNewPalletLine || pendingIsNewPalletLine;

  // ── Reset helpers ──────────────────────────────────────────────────────────
  function resetCountEntry(lotCodeSeed = "") {
    setPhysicalQtyInput("");
    setSurplusDestination("NEW_PALLET");
    setSurplusPallet(null);
    setLotGroups([newLotGroup(lotCodeSeed)]);
    setEntrySapLot(generateSapLot());
    setShortagePhysicalByPallet({});
  }
  function selectProduct(p: Product | null) {
    setProduct(p);
    setLevel("PRODUCT");
    setScopeLot(null);
    setScopePallet(null);
    resetCountEntry();
  }
  function changeLevel(next: CountLevel) {
    setLevel(next);
    setScopeLot(null);
    setScopePallet(null);
    resetCountEntry();
  }
  function selectScopeLot(lot: ScopedLot) {
    setScopeLot(lot);
    setScopePallet(null);
    resetCountEntry(lot.lotCode);
  }
  function selectScopePallet(lot: ScopedLot, pallet: LotPallet) {
    setScopeLot(lot);
    setScopePallet(pallet);
    setPhysicalQtyInput("");
  }
  function changeSurplusDestination(d: SurplusDestination) {
    setSurplusDestination(d);
    setSurplusPallet(null);
    if (level === "LOT") {
      // El lote ya es conocido (se eligió al entrar a este nivel): "no registrado" y "sin
      // pallet" terminan siendo el mismo lote, solo cambia si el operador lo confirma o no.
      setLotGroups((g) => [{ ...g[0], lotCode: scopeLot?.lotCode ?? "" }]);
    } else if (d === "NO_PALLET") {
      setLotGroups((g) => [{ ...g[0], lotCode: generateAutoLotCode() }]);
    } else if (d === "NEW_PALLET") {
      setLotGroups((g) => [{ ...g[0], lotCode: "" }]);
    }
  }
  function selectSurplusPallet(_lot: ScopedLot, pallet: LotPallet) {
    setSurplusPallet(pallet);
  }

  function currentScopeLabel(): string {
    if (level === "PRODUCT") return "Producto completo";
    if (level === "LOT") return scopeLot ? `Lote ${scopeLot.lotCode}` : "Lote";
    return scopePallet ? `Pallet ${scopePallet.code}` : "Pallet";
  }
  function depositoLabelFor(direction: AdjustmentType, lineLocationId?: string): string {
    if (direction === "ADJUSTMENT_OUT") return "(según cada pallet)";
    if (lineLocationId) return locationMap[lineLocationId] ?? "—";
    const w = (warehousesQ.data ?? []).find((wh) => wh.id === warehouseId);
    return w?.name ?? "(sin elegir)";
  }

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["adjustments"] });

  // Sugiere el total en el primer (único) lote apenas se conoce la diferencia — el operador lo puede editar.
  useEffect(() => {
    if (level === "PALLET" || surplusDestination === "EXISTING_PALLET") return;
    if (diff !== null && diff > 0 && lotGroups.length === 1 && !lotGroups[0].quantity) {
      setLotGroups((g) => [{ ...g[0], quantity: String(diff) }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, surplusDestination]);

  // ── LotGroup helpers (sobrante — pallet no registrado / sin pallet) ──────
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

  // ── Construir línea actual a partir de la diferencia ─────────────────────
  function buildCurrentLine():
    | { direction: AdjustmentType; palletItems: CreateAdjustmentLinePayload["palletItems"]; totalQty: number; summary: string; locationId?: string }
    | { error: string }
    | null {
    if (!product || diff === null || diff === 0) return null;

    // Nivel Pallet: casos triviales, una sola línea, sin sub-formulario.
    if (level === "PALLET") {
      if (!scopePallet) return { error: "Elegí el pallet que estás recontando." };
      if (diff > 0) {
        return {
          direction: "ADJUSTMENT_IN",
          palletItems: [{ palletId: scopePallet.id, quantity: diff }],
          totalQty: diff,
          summary: `Pallet ${scopePallet.code} (existente)`,
          locationId: scopePallet.currentLocationId ?? undefined,
        };
      }
      return {
        direction: "ADJUSTMENT_OUT",
        palletItems: [{ palletId: scopePallet.id, quantity: -diff }],
        totalQty: -diff,
        summary: `Pallet ${scopePallet.code}`,
      };
    }

    // Nivel Lote/Producto, sobrante.
    if (diff > 0) {
      if (surplusDestination === "EXISTING_PALLET") {
        if (!surplusPallet) return { error: "Elegí el pallet existente donde va el sobrante." };
        return {
          direction: "ADJUSTMENT_IN",
          palletItems: [{ palletId: surplusPallet.id, quantity: diff }],
          totalQty: diff,
          summary: `Pallet ${surplusPallet.code} (existente)`,
          locationId: surplusPallet.currentLocationId ?? undefined,
        };
      }
      // NEW_PALLET / NO_PALLET: mismo formulario de lote(s) nuevo(s).
      const validGroups = lotGroups.filter((g) => g.lotCode.trim() && Number(g.quantity) > 0);
      if (validGroups.length === 0) return { error: "Indicá el lote donde vas a registrar el sobrante." };
      const sumGroups = validGroups.reduce((s, g) => s + Number(g.quantity), 0);
      if (sumGroups !== diff) {
        return { error: `La suma asignada (${sumGroups}) no coincide con la diferencia (+${diff}). Ajustá las cantidades.` };
      }
      for (const g of validGroups) {
        if (g.palletLines.length > 0) {
          const sum = g.palletLines.reduce((s, l) => s + Number(l.qty || 0), 0);
          if (sum !== Number(g.quantity)) {
            return { error: `Lote ${g.lotCode.trim()}: la suma de los pallets (${sum}) no coincide con la cantidad del lote (${g.quantity}).` };
          }
        }
      }
      const palletItems = validGroups.flatMap((g) => {
        const base = { lotCode: g.lotCode.trim(), fechaVencimiento: g.fechaVencimiento || undefined, fechaFabricacion: g.fechaFabricacion || undefined, sapLot: entrySapLot.trim() || undefined };
        if (g.palletLines.length > 0) return g.palletLines.map((l) => ({ ...base, quantity: Number(l.qty) }));
        return [{ ...base, quantity: Number(g.quantity) }];
      });
      return { direction: "ADJUSTMENT_IN", palletItems, totalQty: diff, summary: `Lotes: ${validGroups.map((g) => g.lotCode.trim()).join(", ")}` };
    }

    // Nivel Lote/Producto, faltante: distribución por pallet (Sistema → Físico → diferencia).
    const target = -diff;
    const { palletItems, total } = computeShortageAllocation(shortageCandidates, shortagePhysicalByPallet);
    if (palletItems.length === 0) return { error: "Recontá al menos un pallet donde encontraste menos, para cubrir el faltante." };
    if (total !== target) {
      return { error: `Asignaste ${total} unidades pero el faltante es de ${target}. Ajustá el conteo por pallet.` };
    }
    const lotsUsed = [...new Set(palletItems.map((i) => shortageCandidates.find((p) => p.id === i.palletId)?.lotCode).filter((v): v is string => !!v))];
    return { direction: "ADJUSTMENT_OUT", palletItems, totalQty: target, summary: `Lotes: ${lotsUsed.join(", ")}` };
  }

  function addToCart() {
    if (!product) { setFormError("Seleccioná un material."); return; }
    if (diff === null || diff === 0) { setFormError("Ingresá el conteo físico — sin diferencia no hay nada para agregar."); return; }
    const res = buildCurrentLine();
    if (!res) { setFormError("Completá los datos del conteo."); return; }
    if ("error" in res) { setFormError(res.error); return; }
    setFormError("");
    setCart((c) => [...c, {
      key: ++_ck, productId: product.id, productLabel: `${product.code} · ${product.description}`,
      direction: res.direction, palletItems: res.palletItems, totalQty: res.totalQty, summary: res.summary,
      locationId: res.locationId, level, scopeLabel: currentScopeLabel(), systemQty, physicalQty: physicalQty ?? 0,
    }]);
    selectProduct(null);
  }

  // ── Envío: agrupa el carrito en buckets por dirección (y depósito, para entradas) ──
  function buildBuckets(lines: CartLine[]): Bucket[] | { error: string } {
    const outLines = lines.filter((l) => l.direction === "ADJUSTMENT_OUT");
    const inLines = lines.filter((l) => l.direction === "ADJUSTMENT_IN");
    const buckets: Bucket[] = [];
    if (outLines.length > 0) buckets.push({ direction: "ADJUSTMENT_OUT", lines: outLines });
    if (inLines.length > 0) {
      const byWarehouse = new Map<string, CartLine[]>();
      for (const l of inLines) {
        let wid: string | undefined;
        if (l.locationId) {
          const loc = (locationsQ.data ?? []).find((lo) => lo.id === l.locationId);
          wid = loc ? locationWarehouseId(loc) : undefined;
          if (!wid) return { error: `No se pudo determinar el depósito del pallet usado en "${l.productLabel}".` };
        } else {
          if (!warehouseId) return { error: "Para un sobrante que registra pallet nuevo elegí un Depósito." };
          wid = warehouseId;
        }
        byWarehouse.set(wid, [...(byWarehouse.get(wid) ?? []), l]);
      }
      for (const [wid, ls] of byWarehouse) buckets.push({ direction: "ADJUSTMENT_IN", warehouseId: wid, lines: ls });
    }
    return buckets;
  }

  function openSummary(submit: boolean) {
    if (product && diff !== null && diff !== 0) {
      const res = buildCurrentLine();
      if (res && "error" in res) { setFormError(res.error); return; }
      if (res) {
        const newLine: CartLine = {
          key: ++_ck, productId: product.id, productLabel: `${product.code} · ${product.description}`,
          direction: res.direction, palletItems: res.palletItems, totalQty: res.totalQty, summary: res.summary,
          locationId: res.locationId, level, scopeLabel: currentScopeLabel(), systemQty, physicalQty: physicalQty ?? 0,
        };
        const nextCart = [...cart, newLine];
        setCart(nextCart);
        selectProduct(null);
        setFormError("");
        setPendingSubmit({ submit, lines: nextCart });
        return;
      }
    }
    if (cart.length === 0) { setFormError("Agregá al menos un material al ajuste."); return; }
    setFormError("");
    setPendingSubmit({ submit, lines: cart });
  }

  // ── Mutaciones ────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: async ({ submit, lines }: { submit: boolean; lines: CartLine[] }) => {
      const bucketsOrError = buildBuckets(lines);
      if ("error" in bucketsOrError) throw new Error(bucketsOrError.error);

      const settled = await Promise.allSettled(bucketsOrError.map(async (b) => {
        const { requestId, code } = await createAdjustmentDraft({
          type: b.direction,
          reason,
          warehouseId: b.direction === "ADJUSTMENT_IN" ? b.warehouseId : undefined,
          locationId: locationId || undefined,
          notes: notes.trim() || undefined,
          lines: b.lines.map((l) => ({ productId: l.productId, palletItems: l.palletItems, locationId: l.locationId })),
        });
        if (submit) await submitAdjustmentForApproval(requestId);
        return { code, direction: b.direction, keys: b.lines.map((l) => l.key), qty: b.lines.reduce((s, l) => s + l.totalQty, 0) };
      }));

      const succeeded = settled
        .filter((r): r is PromiseFulfilledResult<{ code: string; direction: AdjustmentType; keys: number[]; qty: number }> => r.status === "fulfilled")
        .map((r) => r.value);
      const failed = settled
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => getFriendlyApiError(r.reason));

      return { submit, succeeded, failed };
    },
    onSuccess: ({ submit, succeeded, failed }) => {
      const succeededKeys = new Set(succeeded.flatMap((s) => s.keys));
      if (succeeded.length > 0) {
        const parts = succeeded.map((s) => `${s.code} (${s.direction === "ADJUSTMENT_IN" ? "+" : "−"}${s.qty.toLocaleString("es-PY")})`);
        toast.success(`${succeeded.length === 1 ? "Ajuste" : `${succeeded.length} ajustes`} ${submit ? "enviado(s) para aprobación" : "guardado(s) como borrador"}: ${parts.join(" · ")}`);
      }
      for (const f of failed) toast.error(f);
      setCart((c) => c.filter((l) => !succeededKeys.has(l.key)));
      setPendingSubmit(null);
      if (failed.length === 0) {
        setReason("DIFERENCIA_INVENTARIO"); setWarehouseId(""); setLocationId(""); setNotes("");
        setFormError("");
      }
      invalidate();
    },
    onError: (err) => {
      const m = getFriendlyApiError(err);
      setFormError(m); toast.error(m);
      setPendingSubmit(null);
    },
  });

  const approveMut = useMutation({
    mutationFn: approveAdjustment,
    onSuccess: () => {
      toast.success("Ajuste aprobado — stock actualizado");
      void queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["kpis"] });
      void queryClient.invalidateQueries({ queryKey: ["pallets"] });
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
  const submitDraftMut = useMutation({
    mutationFn: submitAdjustmentForApproval,
    onSuccess: (res) => { toast.success(`Solicitud ${res.code} enviada para aprobación`); invalidate(); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const showCountEntry = level === "PRODUCT" || (level === "LOT" && scopeLot) || (level === "PALLET" && scopePallet);
  const surplusFormHeading = level === "LOT"
    ? `Sobrante del lote ${scopeLot?.lotCode ?? ""}`
    : surplusDestination === "NO_PALLET"
      ? "Código de lote (generado automático, editable)"
      : "¿En qué lote vas a registrar el sobrante?";

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

      {/* Resumen previo al envío */}
      {pendingSubmit && (
        <AdjustmentSummary
          lines={pendingSubmit.lines.map((l) => ({
            key: l.key,
            productLabel: l.productLabel,
            scopeLabel: l.scopeLabel,
            direction: l.direction,
            systemQty: l.systemQty,
            physicalQty: l.physicalQty,
            totalQty: l.totalQty,
            depositoLabel: depositoLabelFor(l.direction, l.locationId),
          }))}
          submit={pendingSubmit.submit}
          reasonLabel={ADJUSTMENT_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason}
          onConfirm={() => createMut.mutate(pendingSubmit)}
          onCancel={() => setPendingSubmit(null)}
          isPending={createMut.isPending}
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
        {userCanApprove && pendingCount > 0 && (
          <div style={{ background: "var(--warning)", color: "#000", fontWeight: 700, fontSize: 13, padding: "6px 14px", borderRadius: 8 }}>
            ⚠ {pendingCount} solicitud{pendingCount !== 1 ? "es" : ""} pendiente{pendingCount !== 1 ? "s" : ""} de aprobación
          </div>
        )}
      </div>

      {/* ══ Navegación entre tipos de movimiento ══════════════════ */}
      {onTypeChange && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button type="button" className="btn" onClick={() => onTypeChange("ENTRY")} style={{ fontWeight: 700 }}>
            ← Volver a Movimientos
          </button>
          <div role="tablist" style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
            {([
              ["ENTRY", "Entrada"], ["EXIT", "Salida"], ["TRANSFER", "Transferencia"],
              ["ADJUSTMENT_IN", "Corregir Movimiento"], ["INVENTORY_ADJUSTMENT", "Diferencia Inventario"],
            ] as [MovementNav, string][]).map(([t, label]) => {
              const activeTab = t === "INVENTORY_ADJUSTMENT";
              return (
                <button key={t} type="button" role="tab" aria-selected={activeTab}
                  onClick={() => !activeTab && onTypeChange(t)}
                  className="btn"
                  style={{ fontSize: 12, fontWeight: 700, border: "none",
                    background: activeTab ? "var(--primary)" : "var(--panel-hi)",
                    color: activeTab ? "#fff" : "var(--muted)" }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Definición — diferencia vs ajuste de movimiento */}
      <div style={{ background: "var(--panel-hi)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>Diferencia de inventario</strong> corrige el stock físico por producto, lote, pallet o ubicación, sin depender de una entrada o salida específica.
        Para corregir una entrada o salida ya registrada, usá <strong style={{ color: "var(--text)" }}>Corregir Movimiento</strong>.
      </div>

      {/* ══ FORMULARIO ══════════════════════════════════════════ */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Nueva diferencia de inventario</h3>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Registrá el conteo físico y el sistema calcula automáticamente la diferencia con el stock registrado.
            </p>
          </div>
          {cart.length > 0 && (
            <span style={{
              fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, color: "#fff",
              background: cartInCount > 0 && cartOutCount > 0 ? "var(--primary)" : cartInCount > 0 ? "var(--success)" : "var(--danger)",
            }}>
              {cartInCount > 0 && cartOutCount > 0
                ? `Carrito: ${cartInCount} entrada${cartInCount !== 1 ? "s" : ""} · ${cartOutCount} salida${cartOutCount !== 1 ? "s" : ""}`
                : cartInCount > 0 ? "Este ajuste generará: Entrada (RLAI)" : "Este ajuste generará: Salida (RLAO)"}
            </span>
          )}
        </div>

        {/* Cabecera del ajuste */}
        <div className="form-section-title">Datos del ajuste</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 2 }}>Motivo *</div>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {ADJUSTMENT_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: warehouseRequired ? "var(--danger)" : "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>
              Depósito{warehouseRequired ? " *" : ""}
            </div>
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

        {/* Material */}
        <div className="form-section-title" style={{ marginTop: 14 }}>Material</div>
        <div style={{ display: "grid", gap: 10 }}>
          <MaterialSearchBar value={product} onChange={selectProduct} />

          {product && (
            <>
              <ProductStockPanel productId={product.id} />

              <CountLevelPicker level={level} onChange={changeLevel} />

              {level === "PRODUCT" && (
                <LotPalletBreakdownTable lots={lots} isLoading={lotsQ.isFetching} locationMap={locationMap} mode="context" />
              )}
              {level === "LOT" && (
                <LotPalletBreakdownTable lots={lots} isLoading={lotsQ.isFetching} locationMap={locationMap}
                  mode="select-lot" selectedLotId={scopeLot?.id ?? null} onSelectLot={selectScopeLot} />
              )}
              {level === "PALLET" && (
                <LotPalletBreakdownTable lots={lots} isLoading={lotsQ.isFetching} locationMap={locationMap}
                  mode="select-pallet" selectedPalletId={scopePallet?.id ?? null} onSelectPallet={selectScopePallet} />
              )}

              {showCountEntry && (
                <CountEntryPanel systemQty={systemQty} physicalQtyInput={physicalQtyInput} onPhysicalQtyChange={setPhysicalQtyInput} unitLabel={product.unitOfMeasure ?? "unid."} />
              )}

              {/* Sobrante — Producto/Lote: ¿dónde están las unidades? */}
              {diff !== null && diff > 0 && level !== "PALLET" && (
                <div style={{ display: "grid", gap: 8 }}>
                  <SurplusAllocationPicker
                    destination={surplusDestination}
                    onDestinationChange={changeSurplusDestination}
                    lots={surplusCandidateLots}
                    isLoading={lotsQ.isFetching}
                    locationMap={locationMap}
                    selectedPalletId={surplusPallet?.id ?? null}
                    onSelectPallet={selectSurplusPallet}
                  />

                  {surplusDestination === "EXISTING_PALLET" && surplusPallet && (
                    <div style={{ background: "var(--panel-hi)", border: "1px solid var(--success)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                      Se sumarán <strong style={{ color: "var(--success)" }}>+{diff.toLocaleString("es-PY")}</strong> unidades directo al pallet <strong>{surplusPallet.code}</strong> — no se crea pallet nuevo, y el depósito/ubicación se toman del pallet.
                    </div>
                  )}

                  {surplusDestination !== "EXISTING_PALLET" && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{surplusFormHeading}</div>
                        <input className="input" value={entrySapLot} onChange={(e) => setEntrySapLot(e.target.value)} placeholder="Lote SAP" style={{ width: 140, fontSize: 12 }} />
                      </div>
                      {lotGroups.map((group) => (
                        <div key={group.id} style={{ border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                          <div style={{ background: "var(--bg)", padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 120px 120px 32px", gap: 6, alignItems: "end", borderBottom: "1px solid var(--border)" }}>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Código de lote *</div>
                              <input className="input" placeholder="Ej: L2026-001" value={group.lotCode} disabled={level === "LOT"}
                                onChange={(e) => updateGroup(group.id, "lotCode", e.target.value)} style={{ fontSize: 13, fontWeight: 700 }} />
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
                              {(() => {
                                const sum = group.palletLines.reduce((s, l) => s + Number(l.qty || 0), 0);
                                const total = Number(group.quantity || 0);
                                const ok = sum === total;
                                return (
                                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: ok ? "var(--success)" : "var(--danger)" }}>
                                    {ok ? "✓" : "✗"} Suma pallets: {sum} / Total: {total}
                                    {!ok && <span style={{ fontWeight: 400 }}> — deben coincidir</span>}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      ))}
                      {level === "PRODUCT" && surplusDestination === "NEW_PALLET" && (
                        <button type="button" className="btn" onClick={addLotGroup} style={{ alignSelf: "start", fontSize: 13 }}>+ Agregar otro lote</button>
                      )}
                      {(() => {
                        const sum = lotGroups.reduce((s, g) => s + Number(g.quantity || 0), 0);
                        const ok = sum === diff;
                        return (
                          <div style={{ fontSize: 13, fontWeight: 700, color: ok ? "var(--success)" : "var(--muted)" }}>
                            {ok ? "✓" : "—"} Asignado: {sum.toLocaleString("es-PY")} / Diferencia: +{diff.toLocaleString("es-PY")}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              {/* Sobrante — Pallet: caso trivial, se suma directo al pallet elegido */}
              {diff !== null && diff > 0 && level === "PALLET" && scopePallet && (
                <div style={{ background: "var(--panel-hi)", border: "1px solid var(--success)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                  Se sumarán <strong style={{ color: "var(--success)" }}>+{diff.toLocaleString("es-PY")}</strong> unidades directo al pallet <strong>{scopePallet.code}</strong> — no se crea pallet nuevo, y el depósito/ubicación se toman del pallet.
                </div>
              )}

              {/* Faltante — Producto/Lote: distribución por pallet */}
              {diff !== null && diff < 0 && level !== "PALLET" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <ShortageAllocationTable
                    pallets={shortageCandidates}
                    physicalByPallet={shortagePhysicalByPallet}
                    onPhysicalChange={(id, val) => setShortagePhysicalByPallet((m) => ({ ...m, [id]: val }))}
                    locationMap={locationMap}
                  />
                  {shortageCandidates.length > 0 && (() => {
                    const { total } = computeShortageAllocation(shortageCandidates, shortagePhysicalByPallet);
                    const target = -diff;
                    const ok = total === target;
                    return (
                      <div style={{ fontSize: 13, fontWeight: 700, color: ok ? "var(--success)" : "var(--muted)" }}>
                        {ok ? "✓" : "—"} Asignado: {total.toLocaleString("es-PY")} / Faltante: {target.toLocaleString("es-PY")}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Faltante — Pallet: caso trivial */}
              {diff !== null && diff < 0 && level === "PALLET" && scopePallet && (
                <div style={{ background: "var(--panel-hi)", border: "1px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                  Se descontarán <strong style={{ color: "var(--danger)" }}>{Math.abs(diff).toLocaleString("es-PY")}</strong> unidades del pallet <strong>{scopePallet.code}</strong>.
                </div>
              )}

              {diff !== null && diff !== 0 && (
                <button type="button" className="btn btn--primary" onClick={addToCart} style={{ alignSelf: "start" }}>+ Agregar al carrito</button>
              )}
            </>
          )}
        </div>

        {/* Carrito */}
        {cart.length > 0 && (
          <div style={{ border: "1.5px solid var(--primary)", borderRadius: 10, overflow: "hidden", marginTop: 14 }}>
            <div style={{ background: "var(--bg)", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 800 }}>Materiales en este ajuste ({cart.length})</div>
            <table className="table" style={{ margin: 0 }}>
              <thead><tr><th>Material</th><th>Detalle</th><th style={{ textAlign: "right" }}>Diferencia</th><th /></tr></thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.key}>
                    <td style={{ fontWeight: 600 }}>{l.productLabel}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{l.summary}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: l.direction === "ADJUSTMENT_IN" ? "var(--success)" : "var(--danger)" }}>
                      {l.direction === "ADJUSTMENT_IN" ? "+" : "−"}{l.totalQty.toLocaleString("es-PY")}
                    </td>
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
          {(cart.length > 0 || (product && diff !== null && diff !== 0)) && (
            <>
              <button type="button" className="btn" onClick={() => openSummary(false)} disabled={createMut.isPending}>
                Guardar borrador
              </button>
              <button type="button" className="btn btn--primary" onClick={() => openSummary(true)} disabled={createMut.isPending}>
                {`Enviar para aprobación${cart.length > 0 ? ` (${cart.length + (product && diff ? 1 : 0)} mat.)` : ""}`}
              </button>
            </>
          )}
        </div>
      </section>

      {/* ══ LISTA DE SOLICITUDES ════════════════════════════════ */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Solicitudes de ajuste</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="input" style={{ width: 150 }} value={filterType} onChange={(e) => setFilterType(e.target.value as "" | AdjustmentType)}>
              <option value="">Todas</option>
              <option value="ADJUSTMENT_IN">Entrada (RLAI)</option>
              <option value="ADJUSTMENT_OUT">Salida (RLAO)</option>
            </select>
            <select className="input" style={{ width: 190 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="BORRADOR">Borrador</option>
              <option value="PENDIENTE_APROBACION">Pendiente aprobación</option>
              <option value="APROBADO">Aprobado</option>
              <option value="RECHAZADO">Rechazado</option>
            </select>
          </div>
        </div>

        {listQ.isLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando...</p>
        ) : adjustments.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No hay solicitudes{filterStatus || filterType ? " con esos filtros" : ""}.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {adjustments.map((adj) => (
              <RequestCard key={adj.id} adj={adj} canApprove={userCanApprove}
                rejectingId={rejectingId} rejectReason={rejectReason}
                onApprove={() => approveMut.mutate(adj.id)}
                onStartReject={() => { setRejectingId(adj.id); setRejectReason(""); }}
                onConfirmReject={() => rejectMut.mutate({ id: adj.id, reason: rejectReason })}
                onCancelReject={() => setRejectingId(null)}
                onRejectReasonChange={setRejectReason}
                onCancel={() => cancelMut.mutate(adj.id)}
                onLog={() => setLogAdjId(adj.id)}
                onSubmitDraft={() => submitDraftMut.mutate(adj.id)}
                approving={approveMut.isPending && approveMut.variables === adj.id}
                rejecting={rejectMut.isPending}
                submittingDraft={submitDraftMut.isPending && submitDraftMut.variables === adj.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Tarjeta de solicitud ─────────────────────────────────────────────────────
function RequestCard({ adj, canApprove, rejectingId, rejectReason, onApprove, onStartReject, onConfirmReject, onCancelReject, onRejectReasonChange, onCancel, onLog, onSubmitDraft, approving, rejecting, submittingDraft }: {
  adj: AdjustmentRequest; canApprove: boolean;
  rejectingId: string | null; rejectReason: string;
  onApprove: () => void; onStartReject: () => void; onConfirmReject: () => void; onCancelReject: () => void;
  onRejectReasonChange: (v: string) => void; onCancel: () => void; onLog: () => void; onSubmitDraft: () => void;
  approving: boolean; rejecting: boolean; submittingDraft: boolean;
}) {
  const isPending = adj.status === "PENDIENTE_APROBACION";
  const isDraft = adj.status === "BORRADOR";
  const isEditable = adj.status === "BORRADOR" || adj.status === "RECHAZADO";
  const isRejecting = rejectingId === adj.id;

  return (
    <div style={{ border: `1.5px solid ${isPending ? "var(--warning)" : "var(--border)"}`, borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>{adj.code}</span>
            <span className="badge" style={{ fontSize: 10, background: adj.type === "ADJUSTMENT_IN" ? "var(--success)" : "var(--danger)", color: "#fff" }}>
              {adj.type === "ADJUSTMENT_IN" ? "ENTRADA" : "SALIDA"}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[adj.status] ?? "var(--muted)" }}>{STATUS_LABEL[adj.status] ?? adj.status}</span>
            <span className="badge" style={{ fontSize: 11 }}>{adj.reason.replace(/_/g, " ")}</span>
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
          {isDraft && (
            <button className="btn btn--primary" style={{ fontSize: 12 }} onClick={onSubmitDraft} disabled={submittingDraft}>
              {submittingDraft ? "Enviando..." : "Enviar a aprobación"}
            </button>
          )}
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
