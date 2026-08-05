import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import ProductSearch from "../components/ProductSearch";
import ProductCatalogModal from "../components/ProductCatalogModal";
import LocationPicker from "../components/LocationPicker";
import CorregirMovimientoForm from "./CorregirMovimientoForm";
import InventoryAdjustmentPage from "./InventoryAdjustment";
import {
  createDocument,
  getMovements,
  getDocuments,
  regularizeMovement,
  transferBatch,
  previewPlacement,
  type Movement,
  type MovementType,
  type PalletItem,
  type CreateDocumentPayload,
  type LogisticsDocument,
  type PlacementPlan,
} from "../api/movements";
import { fefoLots, generateSapLot, type Lot } from "../api/lots";
import { uploadAttachment, ATTACHMENT_CATEGORIES, type AttachmentCategory } from "../api/attachments";
import AttachmentUploader from "../components/AttachmentUploader";
import { listPallets, type LotPallet } from "../api/pallets";
import { listTransports } from "../api/transports";
import { listWarehouses } from "../api/warehouses";
import { listLocations } from "../api/locations";
import { listActiveUsers } from "../api/users";
import type { Product } from "../api/products";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useAuth } from "../auth/AuthContext";
import { canCreate } from "../auth/rbac";
import SearchableSelect from "../design-system/SearchableSelect";

type PalletLine = { qty: string };

/** Fecha de hoy (YYYY-MM-DD) en zona horaria de Paraguay, para pre-cargar el campo fecha. */
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

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

// ── Adjunto pendiente: elegido en el formulario, se sube al confirmar el remito
type PendingFile = { id: number; file: File; name: string; category: AttachmentCategory };
let _pfId = 0;

// ── Tipo formulario entrada simplificado (una cantidad total por lote)
type LotGroup = {
  id: number; lotCode: string; quantity: string; palletCount: string;
  palletLines: PalletLine[];
  fechaVencimiento: string; fechaFabricacion: string;
  /** Peso por pallet (kg) — mismo valor para todos los pallets de este lote. */
  weightKg: string;
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
  weightKg: "",
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

  // Flota registrada — para elegir vehículo (patente) en el remito
  const transportsQ = useQuery({ queryKey: ["transports"], queryFn: listTransports, staleTime: 60_000 });
  const transports = transportsQ.data ?? [];

  const [formError, setFormError] = useState("");

  // Permisos: OPERATOR/MANAGER/ADMIN operan; AUDITOR es solo lectura (ve historial).
  const { user } = useAuth();
  const canOperate = user ? canCreate("movements", user.role) : false;

  // Formulario común
  const [movType, setMovType] = useState<MovementType>("ENTRY");
  // UI-only: cuando es true muestra el módulo de Ajuste de Inventario (RLAI/RLAO)
  const [showInventoryAdj, setShowInventoryAdj] = useState(false);
  // UI-only: historial de remitos (RLNE/RLNS) con botones de impresión.
  // AUDITOR (solo lectura) arranca directamente en el historial.
  const [showDocHistory, setShowDocHistory] = useState(!canOperate);
  // UI-only: ficha "Ver productos" (catálogo buscable con stock y atributos)
  const [showProductCatalog, setShowProductCatalog] = useState(false);

  // UI-only: último documento confirmado (panel post-confirmación)
  const [lastCreatedDoc, setLastCreatedDoc] = useState<{
    id: string; code: string; type: "ENTRY" | "EXIT"; totalProducts: number; attachments: number;
  } | null>(null);

  // Adjuntos del remito elegidos antes de confirmar (se suben al crear el documento)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showAttachModal, setShowAttachModal] = useState(false);

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
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [encargadoId, setEncargadoId] = useState("");
  const [date, setDate] = useState(todayISO);

  // ENTRADA
  const [entrySapLot, setEntrySapLot] = useState(() => generateSapLot());
  const [lotGroups, setLotGroups] = useState<LotGroup[]>([newLotGroup()]);

  // SALIDA: selección de palets por FEFO
  const [fefoRows, setFefoRows] = useState<FefoRow[]>([]);

  // TRANSFERENCIA — flujo origen-primero: selección multi-producto de pallets
  const [transferSel, setTransferSel] = useState<Set<string>>(new Set());
  const [transferFilter, setTransferFilter] = useState("");
  // TRANSFERENCIA — modo producto-primero: el operador busca el producto y el
  // sistema le muestra en qué ubicaciones está para elegir el origen.
  const [transferProduct, setTransferProduct] = useState<Product | null>(null);

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

  // ── TRANSFERENCIA: contenido de la ubicación origen (todos los productos) ──
  const originPalletsQ = useQuery({
    queryKey: ["pallets", "by-location", fromLocationId],
    queryFn: () => listPallets({ locationId: fromLocationId }),
    enabled: isTransfer && !!fromLocationId,
    staleTime: 10_000,
  });
  // Ocupación del destino (informativa)
  const destPalletsQ = useQuery({
    queryKey: ["pallets", "by-location", toLocationId],
    queryFn: () => listPallets({ locationId: toLocationId }),
    enabled: isTransfer && !!toLocationId,
    staleTime: 10_000,
  });
  // TRANSFERENCIA producto-primero: pallets disponibles del producto buscado
  const transferProductPalletsQ = useQuery({
    queryKey: ["pallets", "by-product", transferProduct?.id],
    queryFn: () => listPallets({ productId: transferProduct!.id, status: "AVAILABLE" }),
    enabled: isTransfer && !!transferProduct,
    staleTime: 10_000,
  });
  // Agrupa los pallets del producto por ubicación origen, para elegir desde dónde mover
  const transferProductLocations = useMemo(() => {
    const map = new Map<string, { locationId: string; code: string; warehouse: string; pallets: number; qty: number }>();
    for (const p of transferProductPalletsQ.data ?? []) {
      if (!p.currentLocationId) continue;
      const cur = map.get(p.currentLocationId) ?? {
        locationId: p.currentLocationId, code: p.locationCode ?? "—", warehouse: p.warehouseName ?? "", pallets: 0, qty: 0,
      };
      cur.pallets += 1; cur.qty += p.quantity;
      map.set(p.currentLocationId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [transferProductPalletsQ.data]);

  /** Pallets transferibles del origen (excluye despachados, vacíos y sin producto resoluble). */
  const originPallets = useMemo(
    () => (originPalletsQ.data ?? []).filter((p) => p.status !== "EXITED" && p.status !== "EMPTY" && !!p.productId),
    [originPalletsQ.data],
  );
  const originPalletsRef = useRef<LotPallet[]>([]);
  useEffect(() => { originPalletsRef.current = originPallets; }, [originPallets]);

  // ── Barcode scanner (TRANSFERENCIA only — EXIT ahora usa cantidad directa) ──
  const scanVideoRef = useRef<HTMLVideoElement>(null);

  const scanPalletByCode = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim().toLowerCase();
      const pallet = originPalletsRef.current.find((p) => p.code.trim().toLowerCase() === code);
      if (pallet) setTransferSel((s) => new Set(s).add(pallet.id));
      setTimeout(() => {
        if (pallet) toast.success(`Palet ${pallet.code} seleccionado`);
        else toast.error(`Palet "${rawCode.trim()}" no está en la ubicación origen`);
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );

  const { cameraActive, cameraSupported, startCamera, stopCamera } = useBarcodeScanner({
    enabled: isTransfer && originPallets.length > 0,
    onScan: scanPalletByCode,
  });



  const locationMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of locations) m[l.id] = l.code;
    return m;
  }, [locations]);


  // FEFO via useQuery — SALIDA (sin filtro de ubicación)
  const fefoEnabled = movType === "EXIT" && !!product;

  const fefoQ = useQuery({
    queryKey: ["lots", "fefo", { productId: product?.id }],
    queryFn: () => fefoLots(product?.id),
    enabled: fefoEnabled,
    staleTime: 15_000,
  });
  const fefoLoading = fefoQ.isFetching;

  // Vista previa de colocación (Entrada): cuántas pilas se van a formar en el
  // sector elegido, antes de confirmar. Se recalcula solo con la cantidad de
  // pallets físicos — no hace falta lote/vencimiento resuelto todavía.
  const previewPalletCount = lotGroups
    .filter((g) => g.lotCode.trim() && Number(g.quantity) > 0)
    .reduce((s, g) => s + (g.palletLines.length > 0 ? g.palletLines.length : 1), 0);
  const placementPreviewQ = useQuery({
    queryKey: ["placement-preview", locationId, product?.id, previewPalletCount],
    queryFn: () => previewPlacement({ locationId, productId: product!.id, palletCount: previewPalletCount }),
    enabled: isEntry && !!product && !!locationId && previewPalletCount > 0,
    staleTime: 5_000,
    retry: false,
  });

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
    setDocumentNumber(""); setSupplier(""); setCarrier(""); setDriver(""); setVehiclePlate(""); setDestination(""); setNotes("");
    setEncargadoId(""); setDate(todayISO());
    setEntrySapLot(generateSapLot()); setLotGroups([newLotGroup()]);
    setFefoRows([]);
    setTransferSel(new Set()); setTransferFilter(""); setTransferProduct(null);
    setCart([]);
    setPendingFiles([]);
    setShowAttachModal(false);
    setFormError("");
    setWizardStep(1);
  }

  // ── TRANSFERENCIA: agrupar contenido del origen por producto ──
  const transferGroups = useMemo(() => {
    const filter = transferFilter.trim().toLowerCase();
    const visible = filter
      ? originPallets.filter((p) =>
          p.code.toLowerCase().includes(filter) ||
          (p.productCode ?? "").toLowerCase().includes(filter) ||
          (p.productDescription ?? "").toLowerCase().includes(filter) ||
          (p.lotCode ?? "").toLowerCase().includes(filter))
      : originPallets;
    const byProduct = new Map<string, { productId: string; productCode: string; productDescription: string; pallets: LotPallet[] }>();
    for (const p of visible) {
      const key = p.productId ?? "—";
      const g = byProduct.get(key) ?? {
        productId: key,
        productCode: p.productCode ?? "—",
        productDescription: p.productDescription ?? "",
        pallets: [],
      };
      g.pallets.push(p);
      byProduct.set(key, g);
    }
    return [...byProduct.values()].sort((a, b) => a.productCode.localeCompare(b.productCode));
  }, [originPallets, transferFilter]);

  const selectedTransferPallets = useMemo(
    () => originPallets.filter((p) => transferSel.has(p.id)),
    [originPallets, transferSel],
  );
  const transferTotalQty = selectedTransferPallets.reduce((s, p) => s + p.quantity, 0);
  const transferProductCount = new Set(selectedTransferPallets.map((p) => p.productId)).size;

  function toggleTransferPallet(id: string) {
    setTransferSel((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  /** Selecciona/deselecciona todos los pallets de un grupo de producto. */
  function toggleTransferGroup(pallets: LotPallet[], checked: boolean) {
    setTransferSel((s) => {
      const next = new Set(s);
      for (const p of pallets) { if (checked) next.add(p.id); else next.delete(p.id); }
      return next;
    });
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

  const transferMut = useMutation({
    mutationFn: transferBatch,
    onSuccess: (res) => {
      invalidateAfterMovement();
      toast.success(
        `Transferencia registrada: ${res.totalPallets} palet${res.totalPallets !== 1 ? "s" : ""} · ${res.totalQty.toLocaleString("es-PY")} unid. → ${locationMap[toLocationId] ?? "destino"}`,
      );
      // Mantiene origen/destino para encadenar transferencias; limpia la selección
      setTransferSel(new Set());
      setTransferFilter("");
      setNotes("");
      setFormError("");
    },
    onError: (err) => {
      const msg = getFriendlyApiError(err);
      setFormError(msg);
      toast.error(msg);
    },
  });
  const saving = transferMut.isPending;

  /** Sube los adjuntos elegidos en el formulario a la bitácora del documento recién creado. */
  async function uploadPendingFiles(documentId: string, files: PendingFile[]) {
    if (files.length === 0) return;
    let failed = 0;
    for (const pf of files) {
      try {
        await uploadAttachment(pf.file, pf.name, pf.category, "DOCUMENT", documentId);
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      toast.error(`${failed} adjunto(s) no se pudieron subir — reintentá desde la bitácora del remito`);
    } else {
      toast.success(`${files.length} archivo(s) adjuntado(s) al remito`);
    }
    void queryClient.invalidateQueries({ queryKey: ["dispatch-log", "DOCUMENT", documentId] });
  }

  const createDocumentMut = useMutation({
    mutationFn: (payload: CreateDocumentPayload) => createDocument(payload),
    onSuccess: (res, variables) => {
      invalidateAfterMovement();
      void uploadPendingFiles(res.documentId, pendingFiles);
      setLastCreatedDoc({
        id: res.documentId,
        code: res.code,
        type: variables.type as "ENTRY" | "EXIT",
        totalProducts: res.movementIds.length,
        attachments: pendingFiles.length,
      });
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
      // Validación WMS: la suma por pallet debe coincidir con el total del lote.
      for (const g of validGroups) {
        if (g.palletLines.length > 0) {
          const sum = g.palletLines.reduce((s, l) => s + Number(l.qty || 0), 0);
          if (sum !== Number(g.quantity)) {
            return { error: `Lote ${g.lotCode.trim()}: la suma de los pallets (${sum}) no coincide con la cantidad total (${g.quantity}). Ajustá las cantidades.` };
          }
        }
      }
      const palletItems: PalletItem[] = validGroups.flatMap((g) => {
        const base = {
          lotCode: g.lotCode.trim(),
          fechaVencimiento: g.fechaVencimiento || undefined,
          fechaFabricacion: g.fechaFabricacion || undefined,
          sapLot: entrySapLot.trim() || undefined,
          weightKg: g.weightKg ? Number(g.weightKg) : undefined,
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

    // SALIDA: arma palletItems desde la selección FEFO.
    const palletItems: PalletItem[] = [];
    // Lotes donde lo pedido supera lo que suman los palets tildados. Despachar de
    // menos en silencio cambiaría la intención del operador sin que se entere.
    const faltantes: { lotCode: string; pedido: number; disponible: number }[] = [];

    for (const row of fefoRows) {
      const targetQty = Number(row.exitQtyInput);
      const selectedPallets = row.lot.pallets.filter((p) => row.selectedIds.has(p.id));
      if (selectedPallets.length === 0) continue;
      if (targetQty > 0) {
        const disponible = selectedPallets.reduce((s, p) => s + p.quantity, 0);
        if (targetQty > disponible) {
          faltantes.push({ lotCode: row.lot.lotCode, pedido: targetQty, disponible });
          continue;
        }
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

    if (faltantes.length > 0) {
      const n = (v: number) => v.toLocaleString("es-PY");
      const detalle = faltantes
        .map((f) =>
          `Lote ${f.lotCode}: solicitaste ${n(f.pedido)} unidades, pero los palets seleccionados contienen ${n(f.disponible)}. ` +
          `Faltan seleccionar ${n(f.pedido - f.disponible)} unidades.`,
        )
        .join(" ");
      return { error: `Cantidad seleccionada insuficiente. ${detalle}` };
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
      vehiclePlate: vehiclePlate || undefined,
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
      if (!fromLocationId) { setFormError("Seleccioná la ubicación origen."); return; }
      if (selectedTransferPallets.length === 0) { setFormError("Seleccioná al menos un palet para transferir."); return; }
      if (!toLocationId) { setFormError("Seleccioná la ubicación destino."); return; }
      if (fromLocationId === toLocationId) { setFormError("Origen y destino no pueden ser la misma ubicación."); return; }

      // Una línea por producto (el backend crea un movimiento TRANSFER por línea, en una transacción)
      const byProduct = new Map<string, { palletId: string; quantity: number }[]>();
      for (const p of selectedTransferPallets) {
        const key = p.productId ?? "";
        if (!key) continue;
        const items = byProduct.get(key) ?? [];
        items.push({ palletId: p.id, quantity: p.quantity });
        byProduct.set(key, items);
      }
      transferMut.mutate({
        date: date || undefined,
        fromLocationId,
        toLocationId,
        notes: notes || undefined,
        lines: [...byProduct.entries()].map(([productId, palletItems]) => ({ productId, palletItems })),
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
                {[["N° MIC/Factura/Remito", "documentNumber"], ["Proveedor", "supplier"], ["Transportadora", "carrier"], ["Conductor", "driver"]].map(([label, field]) => (
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
      {showInventoryAdj && (
        <InventoryAdjustmentPage
          onTypeChange={(t) => {
            setLastCreatedDoc(null);
            if (t === "INVENTORY_ADJUSTMENT") return;
            setShowInventoryAdj(false);
            setMovType(t as MovementType);
            setProduct(null); setFefoRows([]); setLotGroups([newLotGroup()]);
            setTransferSel(new Set()); setTransferFilter(""); setTransferProduct(null);
            setWizardStep(1);
          }}
        />
      )}

      {/* ── Corregir Movimiento (fusiona Ajuste Entrada + Ajuste Salida) ── */}
      {!showInventoryAdj && (movType === "ADJUSTMENT_IN" || movType === "ADJUSTMENT_OUT") && (
        <CorregirMovimientoForm
          onTypeChange={(t) => {
            setLastCreatedDoc(null);
            if (t === "INVENTORY_ADJUSTMENT") { setShowInventoryAdj(true); resetForm(); }
            else { setShowInventoryAdj(false); setMovType(t); resetForm(); }
          }}
        />
      )}

      {/* ── Panel post-confirmación ── */}
      {!showInventoryAdj && isDocType && lastCreatedDoc && (
        <section className="card" style={{ textAlign: "center", padding: "36px 24px" }}>
          <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 12 }}>✅</div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 900, color: "var(--text)" }}>
            {lastCreatedDoc.type === "ENTRY" ? "Entrada confirmada" : "Salida confirmada"}
          </h2>
          <p style={{ color: "var(--muted)", margin: "0 0 20px", fontSize: 14 }}>
            {lastCreatedDoc.totalProducts} producto(s) registrado(s)
            {lastCreatedDoc.attachments > 0 && (
              <> · 📎 {lastCreatedDoc.attachments} adjunto(s) guardado(s) en la bitácora</>
            )}
          </p>
          <div style={{
            display: "inline-block", background: "var(--panel-hi)", borderRadius: 8,
            padding: "10px 28px", fontFamily: "monospace", fontWeight: 900, fontSize: 24,
            color: "var(--primary)", marginBottom: 32, letterSpacing: 1,
          }}>
            {lastCreatedDoc.code}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ fontSize: 15, padding: "10px 22px", gap: 8, display: "flex", alignItems: "center" }}
              onClick={() => window.open(`/print/document/${lastCreatedDoc.id}`, "_blank")}
            >
              🖨 Nota de {lastCreatedDoc.type === "ENTRY" ? "entrada" : "salida"}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              style={{ fontSize: 15, padding: "10px 22px", gap: 8, display: "flex", alignItems: "center" }}
              onClick={() => window.open(`/print/labels/${lastCreatedDoc.id}`, "_blank")}
            >
              🏷 Etiquetas de pallet
            </button>
          </div>
          <div>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 13, padding: "8px 20px" }}
              onClick={() => setLastCreatedDoc(null)}
            >
              + Nueva {lastCreatedDoc.type === "ENTRY" ? "entrada" : "salida"}
            </button>
          </div>
        </section>
      )}

      {/* ── Toggle historial reciente / nueva operación (solo para ENTRY y EXIT) ── */}
      {!showInventoryAdj && isDocType && !lastCreatedDoc && (
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          {canOperate && (
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
              {movType === "EXIT" ? "Nueva salida" : "Nueva entrada"}
            </button>
          )}
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
            Historial reciente
          </button>
        </div>
      )}

      {/* ── Historial de remitos (RLNE / RLNS) con botones de impresión ── */}
      {!showInventoryAdj && isDocType && showDocHistory && !lastCreatedDoc && (
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
      {canOperate && !showInventoryAdj && movType !== "ADJUSTMENT_IN" && movType !== "ADJUSTMENT_OUT" && !showDocHistory && !lastCreatedDoc && <section className="card">
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
            <div className="form-section-title">{isTransfer ? "Tipo y fecha" : "Tipo y material"}</div>
          )}
          {(movType !== "ENTRY" || wizardStep === 1) && (
          <div style={{ display: "grid", gridTemplateColumns: isTransfer ? "200px 150px" : "200px 1fr auto", gap: 8, alignItems: "center" }}>
            <select className="input"
              value={showInventoryAdj ? "INVENTORY_ADJUSTMENT" : movType}
              onChange={(e) => {
                const val = e.target.value;
                setLastCreatedDoc(null);
                if (val === "INVENTORY_ADJUSTMENT") {
                  setShowInventoryAdj(true);
                  resetForm();
                } else {
                  setShowInventoryAdj(false);
                  setMovType(val as MovementType);
                  setProduct(null); setFefoRows([]); setLotGroups([newLotGroup()]);
                  setTransferSel(new Set()); setTransferFilter(""); setTransferProduct(null);
                  setWizardStep(1);
                }
              }}
            >
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Salida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="ADJUSTMENT_IN">Corregir movimiento</option>
              <option value="INVENTORY_ADJUSTMENT">Diferencia de inventario</option>
            </select>
            {!isTransfer && (
              <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                <div style={{ flex: 1 }}><ProductSearch value={product} onChange={setProduct} /></div>
                <button type="button" className="btn" onClick={() => setShowProductCatalog(true)}
                  title="Ver catálogo de productos con stock y atributos" style={{ whiteSpace: "nowrap" }}>
                  Ver productos
                </button>
              </div>
            )}
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Fecha de la operación (por defecto hoy)" style={{ width: 150 }} />
          </div>
          )}

          {/* Depósito/Ubicación — no se muestra en EXIT (ubicación viene del pallet) */}
          {(movType !== "ENTRY" || wizardStep === 1) && !isTransfer && movType !== "EXIT" && (
            <>
              <div className="form-section-title">Depósito y ubicación</div>
              <div style={{ display: "grid", gap: 8 }}>
                <SearchableSelect
                  options={warehouses}
                  value={warehouses.find((w) => w.id === warehouseId) ?? null}
                  onChange={(w) => { setWarehouseId(w?.id ?? ""); setLocationId(""); }}
                  getKey={(w) => w.id}
                  getLabel={(w) => w.name}
                  placeholder="Depósito"
                />
                <LocationPicker
                  value={locationId}
                  onChange={setLocationId}
                  warehouseId={warehouseId || undefined}
                  placeholder="Ubicación (opcional)"
                  productId={product?.id}
                />
              </div>
            </>
          )}

          {/* Transferencia: producto-primero + origen → destino */}
          {(movType !== "ENTRY" || wizardStep === 1) && isTransfer && (
            <>
              {/* Paso 1 — buscar producto y elegir desde qué ubicación moverlo */}
              <div className="form-section-title">¿Qué producto querés mover?</div>
              <div style={{ display: "grid", gap: 8, marginBottom: 6 }}>
                <ProductSearch value={transferProduct} onChange={(p) => { setTransferProduct(p); setFromLocationId(""); setTransferSel(new Set()); }} placeholder="Buscar producto a transferir (opcional)…" />
                {transferProduct && (
                  transferProductLocations.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                      {transferProductPalletsQ.isLoading ? "Buscando ubicaciones…" : "Este producto no tiene pallets disponibles para transferir."}
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>Está en estas ubicaciones — elegí el origen:</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {transferProductLocations.map((loc) => (
                          <button key={loc.locationId} type="button"
                            onClick={() => { setFromLocationId(loc.locationId); setTransferSel(new Set()); setTransferFilter(""); }}
                            className="btn"
                            style={{ fontSize: 12, fontWeight: 700,
                              background: fromLocationId === loc.locationId ? "var(--primary)" : undefined,
                              color: fromLocationId === loc.locationId ? "#fff" : undefined }}>
                            {loc.code} · {loc.pallets} pal. · {loc.qty.toLocaleString("es-PY")} unid.
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="form-section-title">Origen → Destino</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Ubicación origen</label>
                  <LocationPicker value={fromLocationId} onChange={(id) => { setFromLocationId(id); setTransferSel(new Set()); setTransferFilter(""); }} placeholder="Seleccionar origen" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Ubicación destino</label>
                  <LocationPicker value={toLocationId} onChange={setToLocationId} placeholder="Seleccionar destino" excludeUnavailable productId={transferProduct?.id} />
                  {toLocationId && destPalletsQ.data && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
                      El destino ya tiene {destPalletsQ.data.filter((p) => p.status !== "EXITED" && p.status !== "EMPTY").length} palet(s)
                    </p>
                  )}
                </div>
              </div>

              {!fromLocationId ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  Seleccioná la ubicación origen para ver todo lo que contiene — sin necesidad de elegir producto.
                </p>
              ) : originPalletsQ.isLoading ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Cargando contenido de la ubicación...</p>
              ) : originPallets.length === 0 ? (
                <div style={{ background: "var(--badge-adjout-bg)", border: "1px solid var(--badge-adjout-border)", color: "var(--badge-adjout-text)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                  Esta ubicación no tiene palets transferibles.
                </div>
              ) : (
                <>
                  <div className="form-section-title">
                    Contenido de {locationMap[fromLocationId] ?? "la ubicación"}
                    <span style={{ color: "var(--muted)", marginLeft: 10, fontWeight: 400, fontSize: 12 }}>
                      {originPallets.length} palet{originPallets.length !== 1 ? "s" : ""} · {transferGroups.length} producto{transferGroups.length !== 1 ? "s" : ""} · {originPallets.reduce((s, p) => s + p.quantity, 0).toLocaleString("es-PY")} unid.
                    </span>
                  </div>

                  {/* Filtro + escáner */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <input
                      className="input"
                      placeholder="Filtrar por producto, lote o palet..."
                      value={transferFilter}
                      onChange={(e) => setTransferFilter(e.target.value)}
                      style={{ flex: 1, minWidth: 180 }}
                      aria-label="Filtrar contenido del origen"
                    />
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

                  {/* Grupos por producto */}
                  <div style={{ display: "grid", gap: 8 }}>
                    {transferGroups.length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Sin resultados para ese filtro.</p>
                    )}
                    {transferGroups.map((g) => {
                      const selCount = g.pallets.filter((p) => transferSel.has(p.id)).length;
                      const allSelected = selCount === g.pallets.length && g.pallets.length > 0;
                      const groupQty = g.pallets.reduce((s, p) => s + p.quantity, 0);
                      return (
                        <div key={g.productId} style={{ border: `1.5px solid ${selCount > 0 ? "var(--primary)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
                          {/* Encabezado del producto */}
                          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: selCount > 0 ? "var(--primary-light)" : "var(--bg)", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={(e) => toggleTransferGroup(g.pallets, e.target.checked)}
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                              aria-label={`Seleccionar todos los pallets de ${g.productCode}`}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 800, fontSize: 14 }}>{g.productCode}</span>
                              <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>{g.productDescription}</span>
                            </div>
                            <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
                              {g.pallets.length} palet{g.pallets.length !== 1 ? "s" : ""} · {groupQty.toLocaleString("es-PY")} unid.
                            </span>
                            {selCount > 0 && (
                              <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, flexShrink: 0 }}>✓ {selCount} sel.</span>
                            )}
                          </label>
                          {/* Pallets del producto */}
                          <div style={{ borderTop: "1px solid var(--border-dim)" }}>
                            {g.pallets.map((p, pIdx) => {
                              const days = daysUntil(p.fechaVencimiento);
                              const isSel = transferSel.has(p.id);
                              return (
                                <label
                                  key={p.id}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", cursor: "pointer",
                                    background: isSel ? "var(--primary-light)" : undefined,
                                    borderBottom: pIdx < g.pallets.length - 1 ? "1px solid var(--border-dim)" : undefined,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    onChange={() => toggleTransferPallet(p.id)}
                                    style={{ width: 15, height: 15 }}
                                  />
                                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "monospace", minWidth: 120 }}>{p.code}</span>
                                  {p.lotCode && (
                                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--primary)", background: "var(--primary-light)", padding: "1px 6px", borderRadius: 4 }}>
                                      {p.lotCode}
                                    </span>
                                  )}
                                  <span style={{ fontSize: 13, fontWeight: 700 }}>{p.quantity.toLocaleString("es-PY")} unid.</span>
                                  {p.fechaVencimiento && (
                                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                                      Vence {new Date(p.fechaVencimiento).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" })}
                                      {expiryBadge(days)}
                                    </span>
                                  )}
                                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                                    {p.status === "PARTIAL" && <span className="badge badge--estado-pendiente" style={{ fontSize: 10 }}>PARCIAL</span>}
                                    {p.status === "BLOCKED" && <span className="badge badge--adj-out" style={{ fontSize: 10 }}>BLOQUEADO</span>}
                                    {p.status === "DAMAGED" && <span className="badge badge--estado-rechazado" style={{ fontSize: 10 }}>DAÑADO</span>}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Resumen de la selección */}
                  {selectedTransferPallets.length > 0 && (
                    <div style={{ background: "var(--primary-light)", border: "1.5px solid var(--primary)", borderRadius: 8, padding: "8px 12px", fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                      <strong style={{ color: "var(--primary)" }}>
                        ✓ {selectedTransferPallets.length} palet{selectedTransferPallets.length !== 1 ? "s" : ""} · {transferTotalQty.toLocaleString("es-PY")} unid. · {transferProductCount} producto{transferProductCount !== 1 ? "s" : ""}
                      </strong>
                      <span style={{ color: "var(--muted)" }}>
                        {locationMap[fromLocationId] ?? "origen"} → {toLocationId ? (locationMap[toLocationId] ?? "destino") : "elegí destino"}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, padding: "2px 10px", marginLeft: "auto" }}
                        onClick={() => setTransferSel(new Set())}
                      >
                        Deseleccionar todo
                      </button>
                    </div>
                  )}
                </>
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
                    {/* Cantidad, pallets y peso */}
                    <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr 90px", gap: 8, alignItems: "end" }}>
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
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Peso/pallet (kg)</div>
                        <input className="input" type="number" min={0} step="0.01" placeholder="—"
                          value={group.weightKg} onChange={(e) => updateGroup(group.id, "weightKg", e.target.value)}
                          title="Peso por pallet en kg — igual para todos los pallets de este lote. Se imprime en la etiqueta."
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

              {/* Vista previa de colocación — cómo van a quedar armadas las pilas en el sector elegido */}
              {isEntry && product && locationId && previewPalletCount > 0 && (
                <div style={{ border: "1.5px solid var(--primary)", borderRadius: 8, padding: "8px 12px", fontSize: 13, background: "var(--primary-light, rgba(0,0,0,0.03))" }}>
                  {placementPreviewQ.isFetching ? (
                    <span style={{ color: "var(--muted)" }}>Calculando pilas…</span>
                  ) : placementPreviewQ.isError ? (
                    <span style={{ color: "var(--danger)", fontWeight: 700 }}>
                      {(placementPreviewQ.error as { response?: { data?: { message?: string } } })?.response?.data?.message
                        ?? "No se pudo calcular la colocación en ese sector."}
                    </span>
                  ) : placementPreviewQ.data ? (
                    <>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        📍 {placementPreviewQ.data.locationCode}: se {placementPreviewQ.data.piles.filter((p) => p.isNew).length > 0 ? "van a formar" : "usan"}{" "}
                        {placementPreviewQ.data.piles.length} pila{placementPreviewQ.data.piles.length !== 1 ? "s" : ""}
                        {placementPreviewQ.data.basesTotal != null && (
                          <span style={{ fontWeight: 500, color: "var(--muted)" }}>
                            {" "}· {placementPreviewQ.data.basesUsed}/{placementPreviewQ.data.basesTotal} bases ocupadas
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {placementPreviewQ.data.piles.map((p) => (
                          <span key={p.sequence} style={{
                            padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                            background: p.isNew ? "var(--bg)" : "var(--success-light, rgba(34,197,94,0.12))",
                            border: `1px solid ${p.isNew ? "var(--border)" : "var(--success)"}`,
                          }}>
                            Pila {String(p.sequence).padStart(2, "0")} · {p.items.length} nivel{p.items.length !== 1 ? "es" : ""}
                            {!p.isNew && " (consolida)"}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}
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
                            {/* Sin `max`: la validación nativa del navegador se adelantaba al
                                submit y mostraba su propio texto ("El valor debe ser menor de o
                                igual a N"), tapando el mensaje de la aplicación. El tope se
                                valida acá abajo y otra vez al armar el remito. */}
                            <input
                              className="input"
                              type="number"
                              min={0}
                              placeholder="0"
                              value={row.exitQtyInput}
                              onChange={(e) => handleExitQtyChange(lotIdx, e.target.value)}
                              disabled={blocked}
                              style={{ fontSize: 15, fontWeight: 700, width: "100%", borderColor: !blocked && row.exitQtyInput && enteredQty > availQty ? "var(--danger)" : undefined }}
                              aria-label={`Cantidad a despachar del lote ${row.lot.lotCode}`}
                            />
                            {row.exitQtyInput && enteredQty > availQty && (
                              <p style={{ color: "var(--danger)", fontSize: 11, margin: "3px 0 0" }}>
                                Cantidad seleccionada insuficiente: solicitaste{" "}
                                {enteredQty.toLocaleString("es-PY")} unidades y el lote tiene{" "}
                                {availQty.toLocaleString("es-PY")}. Faltan{" "}
                                {(enteredQty - availQty).toLocaleString("es-PY")} unidades.
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
                {!isTransfer && <input className="input" placeholder="N° MIC/Factura/Remito" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
                {isEntry && <input className="input" placeholder="Proveedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
                {!isTransfer && (
                  <SearchableSelect
                    options={transports.filter((t) => t.active)}
                    value={transports.find((t) => t.plate === vehiclePlate) ?? null}
                    onChange={(v) => {
                      setVehiclePlate(v?.plate ?? "");
                      // Autocompleta transportadora y conductor desde la ficha del vehículo
                      if (v) {
                        if (v.description) setCarrier(v.description);
                        if (v.drivers.length === 1) setDriver(v.drivers[0].name);
                      }
                    }}
                    getKey={(t) => t.id}
                    getLabel={(t) => t.plate}
                    getDescription={(t) => t.type}
                    placeholder="Vehículo / patente"
                  />
                )}
                {!isTransfer && <input className="input" placeholder="Transportadora" value={carrier} onChange={(e) => setCarrier(e.target.value)} />}
                {!isTransfer && <input className="input" placeholder="Conductor" value={driver} onChange={(e) => setDriver(e.target.value)} />}
                {movType === "EXIT" && <input className="input" placeholder="Destino" value={destination} onChange={(e) => setDestination(e.target.value)} />}
                {!isTransfer && (
                  <SearchableSelect
                    options={users}
                    value={users.find((u) => u.id === encargadoId) ?? null}
                    onChange={(u) => setEncargadoId(u?.id ?? "")}
                    getKey={(u) => u.id}
                    getLabel={(u) => u.fullName || u.username}
                    getBadge={(u) => u.role}
                    placeholder="Encargado recepción"
                  />
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
              <button
                className="btn btn--primary"
                type="submit"
                disabled={saving || selectedTransferPallets.length === 0 || !toLocationId}
              >
                {saving
                  ? "Transfiriendo..."
                  : selectedTransferPallets.length > 0
                  ? `⇄ Transferir ${selectedTransferPallets.length} palet${selectedTransferPallets.length !== 1 ? "s" : ""} (${transferTotalQty.toLocaleString("es-PY")} unid.)`
                  : "⇄ Transferir"}
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
                <>
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={savingDoc}
                    aria-label="Confirmar entrada"
                  >
                    {savingDoc ? "Guardando..." : `✓ Confirmar entrada${cart.length ? ` (${cart.length + (product ? 1 : 0)} prod.)` : ""}`}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAttachModal(true)}
                    style={pendingFiles.length > 0 ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 700 } : undefined}
                    aria-label="Adjuntar documentos al remito"
                  >
                    📎 Adjuntar{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : " documentos"}
                  </button>
                </>
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
              <button
                type="button"
                className="btn"
                onClick={() => setShowAttachModal(true)}
                style={pendingFiles.length > 0 ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 700 } : undefined}
                aria-label="Adjuntar documentos al remito"
              >
                📎 Adjuntar{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : " documentos"}
              </button>
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          )}
        </form>
      </section>}

      {/* ── Modal: adjuntar documentos al remito (se suben al confirmar) ── */}
      {showAttachModal && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowAttachModal(false)}
        >
          <div
            className="card"
            style={{ width: "min(540px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>📎 Adjuntar documentos al remito</h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  Se suben al confirmar la {isEntry ? "entrada" : "salida"} y quedan en la bitácora del remito.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAttachModal(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            {pendingFiles.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {pendingFiles.map((pf) => {
                  const cat = ATTACHMENT_CATEGORIES.find((c) => c.value === pf.category);
                  return (
                    <div key={pf.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
                      <span style={{ fontSize: 18 }}>{pf.file.type.startsWith("image/") ? "🖼️" : "📄"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pf.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {cat?.icon} {cat?.label} · {pf.file.name} · {(pf.file.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 12, padding: "3px 8px", color: "var(--danger)", flexShrink: 0 }}
                        onClick={() => setPendingFiles((p) => p.filter((x) => x.id !== pf.id))}
                        aria-label={`Quitar ${pf.name}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <AttachmentUploader
              onCollect={(file, name, category) =>
                setPendingFiles((p) => [...p, { id: ++_pfId, file, name, category }])
              }
            />

            <button type="button" className="btn" onClick={() => setShowAttachModal(false)} style={{ alignSelf: "end" }}>
              Listo{pendingFiles.length > 0 ? ` (${pendingFiles.length} archivo${pendingFiles.length !== 1 ? "s" : ""})` : ""}
            </button>
          </div>
        </div>
      )}

      {showProductCatalog && (
        <ProductCatalogModal
          onSelect={(p) => setProduct(p)}
          onClose={() => setShowProductCatalog(false)}
        />
      )}

    </div>
  );
}
