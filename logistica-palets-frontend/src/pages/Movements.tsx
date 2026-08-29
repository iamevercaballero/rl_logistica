import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import ProductSearch from "../components/ProductSearch";
import ProductCatalogModal from "../components/ProductCatalogModal";
import LocationPicker, { type LocationSessionUsage } from "../components/LocationPicker";
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
import { buildLocationPlanView, type LocationPlanView } from "../lib/placementView";
import { fefoLots, generateSapLot, type Lot } from "../api/lots";
import { uploadAttachment, ATTACHMENT_CATEGORIES, type AttachmentCategory } from "../api/attachments";
import AttachmentUploader from "../components/AttachmentUploader";
import { listPallets, type LotPallet } from "../api/pallets";
import { listTransports, type Transport, type TransportDriver } from "../api/transports";
import { listSuppliers, createSupplier } from "../api/suppliers";
import { createDestination, listDestinations } from "../api/destinations";
import { warehouseLabel, warehouseUsesSapLot } from "../api/warehouses";
import { listLocations, zoneMeta, type Location } from "../api/locations";
import { useActiveWarehouseId, useWarehouse } from "../contexts/WarehouseContext";
import { listActiveUsers } from "../api/users";
import type { Product } from "../api/products";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useAuth } from "../auth/AuthContext";
import { canCreate } from "../auth/rbac";
import SearchableSelect from "../design-system/SearchableSelect";
import ExpandableText from "../design-system/ExpandableText";
import DocumentPreviewModal from "../components/DocumentPreviewModal";
import type { DocumentPreview, PreviewLine } from "./documentPreviewModel";
import HybridSearchInput from "../design-system/HybridSearchInput";
import QuantityInput from "../design-system/QuantityInput";
import { daysUntil, formatDateOnly, formatDateTimePY, todayInputValue } from "../utils/dateFormat";
import { distributeQty, fmtQty, parseQtyInput, quantityDelta, roundQty, sumQuantities, toQtyPayload } from "../utils/quantity";
import { entryLotQuantity, responsibleFieldLabel, sapLotApplies, sapLotForProduct, showsExternalDocumentNumber } from "./movementFormModel";
import {
  deselectPalletForExit,
  exitRowError,
  exitRowIsPartial,
  exitRowTotal,
  fefoSuggest,
  palletExitTake,
  selectPalletForExit,
  type ExitSelection,
} from "./exitFormModel";

/**
 * Un pallet físico de la entrada: su cantidad, su peso y su sector destino.
 * Peso y ubicación son por pallet — dos pallets del mismo lote pueden pesar
 * distinto e ir a sectores distintos.
 */
type PalletLine = { qty: string; weightKg: string; locationId: string };

/** Fecha de hoy (YYYY-MM-DD) en zona horaria de Paraguay, para pre-cargar el campo fecha. */
const todayISO = () => todayInputValue();

// ── Línea del carrito de remito: un producto ya cargado (con sus lotes/pallets)
//    listo para agregarse al documento multi-producto.
/**
 * Estado editable crudo que generó una línea del carrito — lo necesario para
 * volver a mostrar el gestor de lotes/pallets (Entrada) o la selección FEFO
 * (Salida) tal como habían quedado. `palletItems`/`preview` alcanzan para
 * enviar o imprimir la línea, pero no para reconstruir el formulario: sin
 * esto, "Editar" solo podría ofrecer un resumen de lectura, no los campos.
 */
type CartLineEditState =
  | { movType: "ENTRY"; product: Product; lotGroups: LotGroup[]; entrySapLot: string }
  | { movType: "EXIT"; product: Product; fefoRows: FefoRow[] };

type CartLine = {
  key: number;
  productId: string;
  productLabel: string;
  palletItems: PalletItem[];
  totalQty: number;
  palletsCount: number;
  summary: string;
  /**
   * Cómo se va a ver este producto en la nota. Se arma junto con `palletItems`,
   * en el mismo lugar y con los mismos datos, para que la vista previa no pueda
   * mostrar algo distinto de lo que se envía.
   */
  preview: PreviewLine;
  editState: CartLineEditState;
};
let _cartKey = 0;

// ── Adjunto pendiente: elegido en el formulario, se sube al confirmar el remito
type PendingFile = { id: number; file: File; name: string; category: AttachmentCategory };
let _pfId = 0;

// ── Tipo formulario entrada simplificado (una cantidad total por lote)
type LotGroup = {
  id: number; lotCode: string; quantity: string; palletCount: string;
  palletLines: PalletLine[];
  /** Valores rápidos del gestor: solo se copian a los pallets al pulsar Aplicar. */
  bulkLocationId: string; bulkWeightKg: string;
  fechaVencimiento: string; fechaFabricacion: string;
};

// ── Tipo fila FEFO (salida)
/**
 * Salida de un lote. `selectedIds` + `qtyByPallet` son la **única fuente de
 * verdad**: la selección de pallets y cuánto se retira de cada uno. El total a
 * despachar del lote se **deriva** (`exitRowTotal`) — nunca se guarda ni se usa
 * para re-seleccionar pallets. Ver `exitFormModel.ts`.
 */
type FefoRow = {
  lot: Lot & { pallets: LotPallet[] };
  selectedIds: Set<string>;
  expanded: boolean;
  /**
   * Campo auxiliar del atajo "Sugerir selección FEFO": una cantidad objetivo que
   * SOLO se usa al hacer clic en el botón. Nunca se auto-ejecuta ni afecta el
   * total (que es derivado).
   */
  fefoTargetInput: string;
  /** palletId → cuánto se retira de ese palet (string crudo, lo tipeado). Editable. */
  qtyByPallet: Record<string, string>;
  /**
   * EXIT only — palletId → paletas físicas con las que se despachó ese palet.
   * Es opcional y solo informativo: no interviene en cuánto se descuenta ni de
   * qué palet. Sin cargar nada, la salida se comporta igual que siempre.
   */
  dispatchedByPallet: Record<string, string>;
};

/** Vista `ExitSelection` (modelo puro) de una fila. */
function rowSelection(row: FefoRow): ExitSelection {
  return { selectedIds: row.selectedIds, qtyByPallet: row.qtyByPallet };
}

/** Cuánto se retira de un palet, según lo cargado en su campo. */
function palletExitQty(row: FefoRow, palletId: string): number {
  return palletExitTake(row.qtyByPallet, palletId);
}

/** Total del lote: la suma exacta de lo cargado en los pallets seleccionados (derivado). */
function rowExitQty(row: FefoRow): number {
  return exitRowTotal(rowSelection(row));
}

/**
 * Campo de "Datos logísticos": etiqueta arriba, control abajo.
 *
 * Antes eran seis o siete inputs sueltos en una sola grilla de `minmax(160px,
 * 1fr)`, identificados solo por su placeholder. En una pantalla ancha entraban
 * todos en una línea a 160px cada uno — ilegibles y sin forma de saber qué es
 * cada campo una vez escrito, porque el placeholder desaparece al tipear.
 *
 * Con etiqueta fija el campo se sigue entendiendo lleno, y con un mínimo más
 * generoso la grilla corta a dos o tres columnas en vez de exprimir siete.
 */
function Field({
  label,
  children,
  hint,
  span,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  /** El campo ocupa toda la fila (observaciones). */
  span?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 4, alignContent: "start", gridColumn: span ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      {children}
      {hint}
    </div>
  );
}

// ── Payload regularización
type RegPayload = {
  reason: string; documentNumber: string; supplier: string; carrier: string;
  driver: string; destination: string; notes: string;
  sapLot: string; fechaVencimiento: string; fechaFabricacion: string;
};
const emptyReg = (): RegPayload => ({
  reason: "", documentNumber: "", supplier: "", carrier: "", driver: "",
  destination: "", notes: "", sapLot: "", fechaVencimiento: "", fechaFabricacion: "",
});

let _gid = 0;

/**
 * Reparte la cantidad total entre N pallets (con decimales, ver `distributeQty`
 * en utils). Conserva el peso y la ubicación ya cargados en cada posición:
 * cambiar la cantidad de pallets no debe borrar lo que el operario configuró.
 */
function distributePalletLines(totalQty: number, count: number, previous: PalletLine[] = []): PalletLine[] {
  return distributeQty(totalQty, count).map((qty, i) => ({
    qty: fmtQty(qty),
    weightKg: previous[i]?.weightKg ?? "",
    locationId: previous[i]?.locationId ?? "",
  }));
}

/** Suma exacta de lo cargado en los pallets de un lote. */
function palletLinesSum(lines: PalletLine[]): number {
  return sumQuantities(lines.map((l) => parseQtyInput(l.qty) ?? 0));
}

/** Cantidad efectiva del lote — ver `entryLotQuantity` en el modelo. */
function lotGroupQuantity(group: LotGroup): number {
  return entryLotQuantity(group.palletLines.map((l) => l.qty), group.quantity);
}

const newLotGroup = (): LotGroup => ({
  id: ++_gid, lotCode: "", quantity: "", palletCount: "",
  palletLines: [],
  bulkLocationId: "", bulkWeightKg: "",
  fechaVencimiento: "", fechaFabricacion: "",
});

export default function MovementsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Entrada/Salida operan siempre dentro del depósito activo: no se vuelve a
  // elegir depósito en el formulario, se muestra como contexto.
  const { activeWarehouse } = useWarehouse();
  const activeWarehouseId = useActiveWarehouseId();

  const [locationsQ, usersQ, pendingQ] = useQueries({
    queries: [
      {
        queryKey: ["locations", activeWarehouseId],
        queryFn: () => listLocations(activeWarehouseId),
        enabled: !!activeWarehouseId,
      },
      { queryKey: ["users", "active"], queryFn: listActiveUsers },
      {
        queryKey: ["movements", "pending", activeWarehouseId],
        queryFn: () => getMovements({
          page: 1, limit: 100, status: "PENDING_REGULARIZATION", warehouseId: activeWarehouseId,
        }),
        enabled: !!activeWarehouseId,
        select: (resp: { data: Movement[] }) => resp.data,
      },
    ],
  });
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const users = usersQ.data ?? [];
  const pending = pendingQ.data ?? [];

  // Flota registrada — para elegir vehículo (patente) en el remito
  const transportsQ = useQuery({ queryKey: ["transports"], queryFn: listTransports, staleTime: 60_000 });
  const transports = useMemo(() => transportsQ.data ?? [], [transportsQ.data]);

  // Catálogo de proveedores para el selector de Entrada
  const suppliersQ = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliers(), staleTime: 60_000 });
  const suppliers = suppliersQ.data ?? [];

  // Catálogo reutilizable de destinos. La RLNS guarda aparte el nombre como snapshot.
  const destinationsQ = useQuery({ queryKey: ["destinations"], queryFn: () => listDestinations(), staleTime: 60_000 });
  const destinations = destinationsQ.data ?? [];

  const [formError, setFormError] = useState("");

  // Permisos: OPERATOR/MANAGER/ADMIN operan; AUDITOR es solo lectura (ve historial).
  const { user } = useAuth();
  const canOperate = user ? canCreate("movements", user.role) : false;
  /** Solo supervisión puede poner el remito a nombre de otra persona. */
  const canReassignEncargado = user?.role === "ADMIN" || user?.role === "MANAGER";

  // Formulario común
  const [movType, setMovType] = useState<MovementType>("ENTRY");
  // UI-only: cuando es true muestra el módulo de Ajuste de Inventario (RLAI/RLAO)
  const [showInventoryAdj, setShowInventoryAdj] = useState(false);
  // UI-only: historial de remitos (RLNE/RLNS) con botones de impresión.
  // AUDITOR (solo lectura) arranca directamente en el historial.
  const [showDocHistory, setShowDocHistory] = useState(!canOperate);
  // UI-only: ficha "Ver productos" (catálogo buscable con stock y atributos)
  const [showProductCatalog, setShowProductCatalog] = useState(false);

  /**
   * Remito armado esperando confirmación. Mientras exista, se muestra la vista
   * previa de la nota y no se mandó nada todavía.
   */
  const [pendingSubmission, setPendingSubmission] =
    useState<{ payload: CreateDocumentPayload; preview: DocumentPreview } | null>(null);
  // UI-only: último documento confirmado (panel post-confirmación)
  const [lastCreatedDoc, setLastCreatedDoc] = useState<{
    id: string; code: string; type: "ENTRY" | "EXIT"; totalProducts: number; attachments: number;
  } | null>(null);

  // Adjuntos del remito elegidos antes de confirmar (se suben al crear el documento)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showAttachModal, setShowAttachModal] = useState(false);

  const isDocType = movType === "ENTRY" || movType === "EXIT";
  const docsQ = useQuery({
    // "Historial reciente" es del depósito activo, como el resto del módulo —
    // sin esto mezclaba remitos de todos los depósitos que ve el usuario.
    queryKey: ["documents", movType, showDocHistory, activeWarehouseId],
    queryFn: () => getDocuments({ type: movType as "ENTRY" | "EXIT", warehouseId: activeWarehouseId }),
    enabled: isDocType && showDocHistory && !!activeWarehouseId,
    staleTime: 30_000,
  });
  const documents: LogisticsDocument[] = docsQ.data ?? [];
  const [product, setProduct] = useState<Product | null>(null);
  // El depósito de la operación es el activo: no hay estado local que pueda
  // divergir de lo que muestra el header.
  const warehouseId = activeWarehouseId ?? "";
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [driverDocument, setDriverDocument] = useState("");
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierRuc, setNewSupplierRuc] = useState("");
  const [carrier, setCarrier] = useState("");
  const [driver, setDriver] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");

  /**
   * Choferes activos de TODA la flota (no solo del vehículo elegido): el
   * conductor es un campo híbrido independiente, no debe bloquearse a la
   * espera de que se elija primero el vehículo. Se dedupe por nombre y se
   * junta la patente de cada vehículo asociado para mostrarla como badge.
   */
  const allDrivers = useMemo(() => {
    const map = new Map<string, TransportDriver & { plates: string[] }>();
    for (const t of transports) {
      if (!t.active) continue;
      for (const d of t.drivers) {
        if (d.status === "INACTIVO") continue;
        const key = d.name.trim().toLowerCase();
        const existing = map.get(key);
        if (existing) {
          if (!existing.plates.includes(t.plate)) existing.plates.push(t.plate);
          if (!existing.document && d.document) existing.document = d.document;
        } else {
          map.set(key, { ...d, plates: [t.plate] });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [transports]);

  /** Transportadoras conocidas (de la ficha de cada vehículo), para sugerir sin obligar a tipear desde cero. */
  const carrierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of transports) {
      if (t.active && t.carrier?.trim()) set.add(t.carrier.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [transports]);
  const [destination, setDestination] = useState("");
  const [documentoMaterial, setDocumentoMaterial] = useState("");
  const [notes, setNotes] = useState("");
  // Responsable de recepción/envío. Se elige a propósito y no se autocompleta
  // con el usuario logueado: es un dato operativo (quién recibió la mercadería),
  // distinto de quién registra el remito. Un OPERATOR no puede reasignarlo — su
  // remito queda a su nombre y el `effectiveEncargadoId` (en buildSubmission) lo
  // resuelve con `user.userId`. ADMIN/MANAGER lo eligen del selector.
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
  // TRANSFERENCIA producto-primero: pallets disponibles del producto buscado.
  // Sin `warehouseId` esto mostraba ubicaciones de origen de OTROS depósitos —
  // justo lo que el comentario de arriba de `warehouseId` descarta ("el
  // depósito de la operación es el activo, no hay estado que pueda divergir").
  const transferProductPalletsQ = useQuery({
    queryKey: ["pallets", "by-product", transferProduct?.id, activeWarehouseId],
    queryFn: () => listPallets({ productId: transferProduct!.id, status: "AVAILABLE", warehouseId: activeWarehouseId }),
    enabled: isTransfer && !!transferProduct && !!activeWarehouseId,
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

  /** Ubicación completa por id — para el popover "dónde está" del desglose de palets. */
  const locationById = useMemo<Record<string, Location>>(() => {
    const m: Record<string, Location> = {};
    for (const l of locations) m[l.id] = l;
    return m;
  }, [locations]);

  /** Qué palet tiene abierto el popover de ubicación en el desglose (uno solo a la vez). */
  const [locationPopoverPalletId, setLocationPopoverPalletId] = useState<string | null>(null);

  /** Cierra el popover de ubicación al clickear afuera — mismo criterio que HybridSearchInput. */
  useEffect(() => {
    if (!locationPopoverPalletId) return;
    function handler(e: MouseEvent) {
      const target = e.target as Element;
      if (!target.closest('[data-location-popover]') && !target.closest('[data-location-popover-trigger]')) {
        setLocationPopoverPalletId(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [locationPopoverPalletId]);


  // FEFO via useQuery — SALIDA (sin filtro de ubicación)
  const fefoEnabled = movType === "EXIT" && !!product && !!activeWarehouseId;

  const fefoQ = useQuery({
    // Sin `activeWarehouseId` acá, una Salida en el depósito 02 podía listar y
    // dejar seleccionar lotes/palets que en realidad están en el 01 — el
    // remito se armaba con stock que físicamente no está en ese depósito.
    queryKey: ["lots", "fefo", { productId: product?.id }, activeWarehouseId],
    queryFn: () => fefoLots(product?.id, undefined, undefined, activeWarehouseId),
    enabled: fefoEnabled,
    staleTime: 15_000,
  });
  const fefoLoading = fefoQ.isFetching;

  /**
   * Para qué producto ya se inicializó `fefoRows` (a mano o restaurado por
   * "Editar"). Evita que un refetch en segundo plano de `fefoQ` — stock que
   * cambió en otra pestaña, un `invalidateQueries(["lots"])` disparado por
   * otra operación — pise en silencio la selección que el operador ya venía
   * armando para ese mismo producto. Solo se vuelve a inicializar cuando el
   * producto cambia de verdad.
   *
   * "Editar" (más abajo) marca este ref *antes* de que el efecto llegue a
   * correr: así el efecto nunca compite con la restauración, la respeta
   * siempre, sin depender de si `fefoQ` ya tenía los datos en caché o todavía
   * los estaba pidiendo.
   */
  const fefoRowsBuiltForProduct = useRef<string | null>(null);

  // ── Gestor de pallets (Entrada) ──
  const [showPalletManager, setShowPalletManager] = useState(false);
  /**
   * Lotes plegados dentro del gestor de pallets (por `group.id`).
   *
   * Una entrada de tres lotes con ocho pallets cada uno son 24 filas apiladas:
   * hay que scrollear el modal entero para llegar al lote que falta cargar. Un
   * lote resuelto se pliega y deja ver su resumen; se vuelve a abrir con un
   * click en el encabezado, para revisarlo o corregirlo.
   */
  const [collapsedLots, setCollapsedLots] = useState<Set<number>>(() => new Set());

  function toggleLotCollapsed(groupId: number) {
    setCollapsedLots((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  /** Todos los pallets del producto actual, aplanados con su lote de origen. */
  const palletRows = useMemo(
    () => lotGroups.flatMap((g) =>
      g.palletLines.map((line, idx) => ({ groupId: g.id, lotCode: g.lotCode, idx, line })),
    ),
    [lotGroups],
  );
  const totalPalletLines = palletRows.length;

  /**
   * Colocación estimada por sector. Se consulta un preview por cada sector con
   * pallets asignados; el resultado dice, para el k-ésimo pallet de ese sector,
   * si se apila sobre una pila existente o abre una base nueva.
   */
  const palletsByLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of palletRows) {
      const loc = r.line.locationId;
      if (!loc) continue;
      map.set(loc, (map.get(loc) ?? 0) + 1);
    }
    return [...map.entries()];
  }, [palletRows]);

  const placementQueries = useQueries({
    queries: palletsByLocation.map(([locId, count]) => ({
      queryKey: ["placement-preview", locId, product?.id, count],
      queryFn: () => previewPlacement({ locationId: locId, productId: product!.id, palletCount: count }),
      enabled: showPalletManager && isEntry && !!product,
      staleTime: 5_000,
      retry: false,
    })),
  });

  /** locationId → plan (o error) para pintar el estado de cada fila. */
  const planByLocation = useMemo(() => {
    const map = new Map<string, { plan?: PlacementPlan; error?: string; loading: boolean }>();
    palletsByLocation.forEach(([locId], i) => {
      const q = placementQueries[i];
      map.set(locId, {
        plan: q?.data,
        loading: !!q?.isFetching,
        error: q?.isError
          ? ((q.error as { response?: { data?: { message?: string } } })?.response?.data?.message
             ?? "No se pudo calcular la colocación.")
          : undefined,
      });
    });
    return map;
  }, [palletsByLocation, placementQueries]);

  /**
   * Ocupación que esta carga ya comprometió y todavía no está en la base. Se le
   * pasa al selector de ubicación para que las recomendaciones y el mapa se
   * adapten: sin esto, después de mandar un pallet a un sector el siguiente
   * seguía viendo ese mismo sector como si estuviera vacío.
   */
  const locationSessionUsage = useMemo(() => {
    const m = new Map<string, LocationSessionUsage>();
    for (const [locId, pallets] of palletsByLocation) {
      const state = planByLocation.get(locId);
      m.set(locId, { pallets, basesFree: state?.plan?.basesFree ?? null, error: state?.error });
    }
    return m;
  }, [palletsByLocation, planByLocation]);

  /** locationId → P-número (1-based, el que se ve en la columna Pallet) de cada
   *  fila, en el mismo orden que `posInLocation` — permite traducir "índice
   *  dentro del plan de este sector" a la etiqueta que el operador ve en pantalla. */
  const rowNumbersByLocation = useMemo(() => {
    const map = new Map<string, number[]>();
    palletRows.forEach((r, globalIdx) => {
      const loc = r.line.locationId;
      if (!loc) return;
      map.set(loc, [...(map.get(loc) ?? []), globalIdx + 1]);
    });
    return map;
  }, [palletRows]);

  /**
   * Lectura por-fila del plan de colocación de cada sector: a qué pila entra
   * cada pallet, cuántas bases van quedando libres a medida que se procesan
   * (no el total final repetido en todas las filas) y qué otros pallets de
   * esta misma carga terminan en la misma pila (para poder confirmar un
   * apilado a simple vista, no solo intuirlo).
   */
  const locationPlanViews = useMemo(() => {
    const views = new Map<string, LocationPlanView>();
    for (const [locId, count] of palletsByLocation) {
      const plan = planByLocation.get(locId)?.plan;
      const rowNumbers = rowNumbersByLocation.get(locId);
      if (!plan || !rowNumbers) continue;
      views.set(locId, buildLocationPlanView(plan, count, rowNumbers));
    }
    return views;
  }, [palletsByLocation, planByLocation, rowNumbersByLocation]);

  useEffect(() => {
    if (!fefoEnabled) {
      fefoRowsBuiltForProduct.current = null;
      setFefoRows([]);
      return;
    }
    const pid = product?.id ?? null;
    // Ya se inicializó para este producto (a mano, o restaurado por "Editar"):
    // un refetch de fondo con datos nuevos no debe pisar lo que el operador ya
    // tiene armado.
    if (fefoRowsBuiltForProduct.current === pid) return;
    if (!fefoQ.data) return;

    fefoRowsBuiltForProduct.current = pid;
    setFefoRows(fefoQ.data.map((l) => ({
      lot: l as Lot & { pallets: LotPallet[] },
      selectedIds: new Set<string>(),
      expanded: true,
      fefoTargetInput: "",
      qtyByPallet: {},
      dispatchedByPallet: {},
    })));
  }, [fefoQ.data, fefoEnabled, product?.id]);

  function resetForm() {
    // El depósito NO se limpia: es el contexto de la sesión, no un campo del
    // formulario. Limpiar la carga no saca al operador de su depósito.
    setProduct(null); setFromLocationId(""); setToLocationId("");
    setDocumentNumber(""); setSupplier(""); setCarrier(""); setDriver(""); setDriverDocument(""); setVehiclePlate(""); setDestination(""); setDocumentoMaterial(""); setNotes("");
    setEncargadoId(""); setDate(todayISO());
    setEntrySapLot(generateSapLot()); setLotGroups([newLotGroup()]);
    setFefoRows([]);
    setTransferSel(new Set()); setTransferFilter(""); setTransferProduct(null);
    setCart([]);
    setPendingFiles([]);
    setShowAttachModal(false);
    setFormError("");
    setWizardStep(1);
    setPendingSubmission(null);
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
  const transferTotalQty = sumQuantities(selectedTransferPallets.map((p) => p.quantity));
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
        const qty = parseQtyInput(field === "quantity" ? val : x.quantity) ?? 0;
        const cnt = Math.floor(Number(field === "palletCount" ? val : x.palletCount)) || 0;
        updated.palletLines = distributePalletLines(qty, cnt, x.palletLines);
      }
      return updated;
    }));
  }

  /** Edita un campo de un pallet puntual (cantidad, peso o sector). */
  function updatePalletLine(groupId: number, lineIdx: number, patch: Partial<PalletLine>) {
    setLotGroups((g) => g.map((x) => {
      if (x.id !== groupId) return x;
      const palletLines = x.palletLines.map((l, i) => (i === lineIdx ? { ...l, ...patch } : l));
      const next = { ...x, palletLines };
      // La cantidad del lote se DERIVA de los pallets (como en Salida): si se
      // editó una cantidad, el total del lote pasa a ser la suma exacta de sus
      // pallets — sin bloquear ni pelear con un total tipeado de antemano.
      if ("qty" in patch) next.quantity = fmtQty(palletLinesSum(palletLines));
      return next;
    }));
  }

  /** Copia la ubicación general de un lote a todos sus pallets; luego cada fila sigue editable. */
  /**
   * Aplica el sector general a todos los pallets del lote y lo pliega: aplicar
   * es justo el momento en que el bloque queda resuelto, y dejarlo abierto
   * obliga a scrollear de más para llegar al lote siguiente.
   */
  function applyLocationToLot(groupId: number) {
    const target = lotGroups.find((group) => group.id === groupId);
    if (!target?.bulkLocationId) return;
    setCollapsedLots((current) => new Set(current).add(groupId));
    setLotGroups((groups) => groups.map((group) => (
      group.id === groupId
        ? { ...group, palletLines: group.palletLines.map((line) => ({ ...line, locationId: target.bulkLocationId })) }
        : group
    )));
  }

  /** Copia el peso general de un lote a todos sus pallets; luego cada fila sigue editable. */
  function applyWeightToLot(groupId: number) {
    setLotGroups((groups) => groups.map((group) => {
      if (group.id !== groupId || group.bulkWeightKg === "") return group;
      return {
        ...group,
        palletLines: group.palletLines.map((line) => ({ ...line, weightKg: group.bulkWeightKg })),
      };
    }));
  }

  // ── Helpers FEFO
  /**
   * Tilda o destilda un palet del lote.
   *
   * Tildar carga la cantidad completa del palet (editable a menos). Destildar lo
   * saca de la selección y borra su cantidad. **No toca ningún otro palet ni
   * ningún total** — el total del lote se deriva de la selección
   * (`rowExitQty`), nunca al revés. Ver `exitFormModel.ts` (requisitos 5, 6, 7).
   */
  function togglePallet(lotIdx: number, palletId: string) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const pallet = r.lot.pallets.find((p) => p.id === palletId);
      const next = r.selectedIds.has(palletId)
        ? deselectPalletForExit(rowSelection(r), palletId)
        : selectPalletForExit(rowSelection(r), palletId, pallet?.quantity ?? 0);
      return { ...r, selectedIds: next.selectedIds, qtyByPallet: next.qtyByPallet };
    }));
  }

  /**
   * EXIT — cantidad a retirar de un palet puntual. Solo escribe ese campo; el
   * total del lote se recalcula solo (es derivado).
   */
  function setPalletExitQty(lotIdx: number, palletId: string, value: string) {
    setFefoRows((rows) => rows.map((r, i) => i === lotIdx
      ? { ...r, qtyByPallet: { ...r.qtyByPallet, [palletId]: value } }
      : r));
  }

  /** Campo auxiliar del atajo FEFO — no dispara nada por sí solo. */
  function setFefoTarget(lotIdx: number, value: string) {
    setFefoRows((rows) => rows.map((r, i) => i === lotIdx ? { ...r, fefoTargetInput: value } : r));
  }

  /**
   * Atajo explícito "Sugerir selección FEFO": con la cantidad objetivo del
   * campo auxiliar, selecciona pallets en orden hasta cubrirla y reparte. Solo
   * corre con este clic — nunca mientras el operador edita pallets a mano.
   */
  function applyFefoSuggestion(lotIdx: number) {
    setFefoRows((rows) => rows.map((r, i) => {
      if (i !== lotIdx) return r;
      const target = parseQtyInput(r.fefoTargetInput) ?? 0;
      if (target <= 0) return r;
      const next = fefoSuggest(r.lot.pallets, target);
      return { ...r, expanded: true, selectedIds: next.selectedIds, qtyByPallet: next.qtyByPallet };
    }));
  }
  /** Paletas físicas resultantes de un palet — dato informativo de la nota. */
  function setDispatchedPallets(lotIdx: number, palletId: string, value: string) {
    setFefoRows((rows) => rows.map((r, i) => i === lotIdx
      ? { ...r, dispatchedByPallet: { ...r.dispatchedByPallet, [palletId]: value } }
      : r));
  }
  function toggleExpanded(lotIdx: number) {
    setFefoRows((rows) => rows.map((r, i) => i === lotIdx ? { ...r, expanded: !r.expanded } : r));
  }

  // EXIT: total real de la salida — la suma de lo cargado palet por palet, que
  // es exactamente lo que se va a descontar.
  const totalExitQty = sumQuantities(fefoRows.map((row) => rowExitQty(row)));
  const totalExitPallets = fefoRows.reduce((sum, row) => sum + row.selectedIds.size, 0);

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
    queryClient.invalidateQueries({ queryKey: ["location-availability"] });
    queryClient.invalidateQueries({ queryKey: ["location-recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["location-map"] });
    queryClient.invalidateQueries({ queryKey: ["location-content"] });
  }

  const transferMut = useMutation({
    mutationFn: transferBatch,
    onSuccess: (res) => {
      invalidateAfterMovement();
      toast.success(
        `Transferencia registrada: ${res.totalPallets} palet${res.totalPallets !== 1 ? "s" : ""} · ${fmtQty(res.totalQty)} unid. → ${locationMap[toLocationId] ?? "destino"}`,
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

  /** Alta rápida de proveedor: al crearlo queda seleccionado en el remito. */
  const createSupplierMut = useMutation({
    mutationFn: createSupplier,
    onSuccess: (created) => {
      toast.success(`Proveedor ${created.name} agregado`);
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setSupplier(created.name);
      setShowNewSupplier(false);
      setNewSupplierName("");
      setNewSupplierRuc("");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  /** Alta rápida dentro del selector: guarda en catálogo y deja el destino seleccionado. */
  const createDestinationMut = useMutation({
    mutationFn: createDestination,
    onSuccess: (created) => {
      toast.success(`Destino ${created.name} agregado`);
      void queryClient.invalidateQueries({ queryKey: ["destinations"] });
      setDestination(created.name);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const createDocumentMut = useMutation({
    mutationFn: (payload: CreateDocumentPayload) => createDocument(payload),
    onSuccess: (res, variables) => {
      setPendingSubmission(null);
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
      // La cantidad del lote es la suma de sus pallets cuando hay desglose
      // (`lotGroupQuantity`), o el valor tipeado cuando va sin desglose.
      const validGroups = lotGroups.filter((g) => g.lotCode.trim() && lotGroupQuantity(g) > 0);
      if (validGroups.length === 0) return { error: "Agregá al menos un lote con código y cantidad." };
      const missingVenc = validGroups.find((g) => !g.fechaVencimiento);
      if (missingVenc) return { error: `Lote ${missingVenc.lotCode.trim()}: falta la fecha de vencimiento.` };
      // Cada pallet del desglose tiene que tener una cantidad > 0 — un pallet en
      // blanco es una fila que sobra.
      for (const g of validGroups) {
        const vacio = g.palletLines.some((l) => (parseQtyInput(l.qty) ?? 0) <= 0);
        if (g.palletLines.length > 0 && vacio) {
          return { error: `Lote ${g.lotCode.trim()}: hay pallets sin cantidad. Cargá cuánto entra en cada uno o bajá la cantidad de pallets.` };
        }
      }
      const palletItems: PalletItem[] = validGroups.flatMap((g) => {
        const base = {
          lotCode: g.lotCode.trim(),
          fechaVencimiento: g.fechaVencimiento || undefined,
          fechaFabricacion: g.fechaFabricacion || undefined,
          // En una entrada multi-producto cada línea resuelve su lote SAP con su
          // propio material, porque se arma al agregarlo al remito.
          sapLot: sapLotForProduct(product, entrySapLot, activeWarehouse),
        };
        // Peso y sector se definen exclusivamente por pallet en el gestor.
        if (g.palletLines.length > 0) {
          return g.palletLines.map((l) => ({
            ...base,
            quantity: toQtyPayload(l.qty) ?? 0,
            weightKg: l.weightKg ? toQtyPayload(l.weightKg) ?? undefined : undefined,
            locationId: l.locationId || undefined,
          }));
        }
        return [{ ...base, quantity: toQtyPayload(g.quantity) ?? 0 }];
      });
      // Total de la entrada = la suma real por lote (los pallets cuando hay
      // desglose). Se manda como `line.quantity` y el backend revalida que
      // coincida con la suma de `palletItems`.
      const totalQty = sumQuantities(validGroups.map((g) => lotGroupQuantity(g)));
      const productLabel = `${product.code} · ${product.description}`;
      const entryLotSap = sapLotForProduct(product, entrySapLot, activeWarehouse) ?? null;
      return {
        line: {
          key: ++_cartKey,
          productId: product.id,
          productLabel,
          palletItems,
          totalQty,
          palletsCount: palletItems.length,
          summary: `Lotes: ${validGroups.map((g) => g.lotCode.trim()).join(", ")}`,
          preview: {
            productLabel,
            unitOfMeasure: product.unitOfMeasure,
            quantity: totalQty,
            pallets: palletItems.length,
            lots: validGroups.map((g) => ({
              lotCode: g.lotCode.trim(),
              sapLot: entryLotSap,
              fechaVencimiento: g.fechaVencimiento || null,
            })),
          },
          // Se guarda `lotGroups` tal cual está en pantalla (no solo `validGroups`):
          // así "Editar" devuelve exactamente lo que había, filas a medio llenar
          // incluidas, no una versión depurada.
          editState: { movType: "ENTRY", product, lotGroups, entrySapLot },
        },
      };
    }

    // SALIDA: arma palletItems desde la selección por palet. Lo que se retira de
    // cada palet es exactamente lo que quedó cargado en su campo — la selección
    // manual es la única fuente de verdad (ver exitFormModel.ts). El total es
    // la suma de esos campos, nunca al revés.
    const palletItems: PalletItem[] = [];
    // Lotes donde algún palet seleccionado quedó sin cantidad o pide más de lo
    // que tiene — ver `exitRowError`.
    const repartoInvalido: string[] = [];
    // Lotes que efectivamente aportan cantidad — los que van a salir impresos.
    const lotesDespachados: FefoRow[] = [];

    for (const row of fefoRows) {
      const selectedPallets = row.lot.pallets.filter((p) => row.selectedIds.has(p.id));
      if (selectedPallets.length === 0) continue;
      // Paletas físicas resultantes: informativo, opcional y por palet. Si el
      // campo quedó vacío no se manda nada y la salida es la de siempre.
      const dispatchedOf = (palletId: string) => {
        const raw = (row.dispatchedByPallet[palletId] ?? "").trim();
        if (raw === "") return undefined;
        const parsed = Number(raw);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
      };

      const rowError = exitRowError(rowSelection(row), row.lot.pallets);
      if (rowError) {
        repartoInvalido.push(`Lote ${row.lot.lotCode}: ${rowError}`);
        continue;
      }

      let aportaAlgo = false;
      for (const p of selectedPallets) {
        const take = palletExitQty(row, p.id);
        if (take <= 0) continue;
        palletItems.push({ palletId: p.id, quantity: roundQty(take), dispatchedPallets: dispatchedOf(p.id) });
        aportaAlgo = true;
      }
      if (aportaAlgo) lotesDespachados.push(row);
    }

    if (repartoInvalido.length > 0) {
      return { error: repartoInvalido.join(" ") };
    }

    if (palletItems.length === 0) return { error: "Tildá al menos un palet e ingresá cuánto retirar." };
    const totalQty = sumQuantities(palletItems.map((i) => i.quantity || 0));
    const lotsUsed = lotesDespachados.map((r) => r.lot.lotCode);
    const productLabel = `${product.code} · ${product.description}`;
    return {
      line: {
        key: ++_cartKey,
        productId: product.id,
        productLabel,
        palletItems,
        totalQty,
        palletsCount: palletItems.length,
        summary: lotsUsed.length ? `Lotes: ${lotsUsed.join(", ")}` : `${palletItems.length} pallet(s)`,
        preview: {
          productLabel,
          unitOfMeasure: product.unitOfMeasure,
          quantity: totalQty,
          pallets: palletItems.length,
          lots: lotesDespachados.map((r) => ({
            lotCode: r.lot.lotCode,
            sapLot: r.lot.sapLot ?? null,
            fechaVencimiento: r.lot.fechaVencimiento ?? null,
          })),
        },
        // `fefoRows` completo (no solo los lotes que aportaron cantidad): así
        // "Editar" devuelve toda la lista con las mismas selecciones y
        // cantidades por palet, no solo un resumen de lo que quedó armado.
        editState: { movType: "EXIT", product, fefoRows },
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

  /**
   * Saca una línea del carrito y la devuelve al formulario tal como había
   * quedado — mismo producto y mismos lotes/pallets (Entrada), o misma
   * selección FEFO con sus cantidades por palet (Salida). Se vuelve a sumar al
   * carrito con "Agregar otro producto" o al confirmar el remito, ya con los
   * cambios.
   *
   * Si hay un producto sin agregar en el formulario, no se pisa en silencio:
   * se corta acá para no perder esa carga.
   */
  function editCartLine(key: number) {
    if (product) {
      setFormError("Agregá o quitá el material que estás cargando antes de editar otro producto del remito.");
      return;
    }
    const line = cart.find((l) => l.key === key);
    if (!line) return;
    setCart((c) => c.filter((l) => l.key !== key));
    setFormError("");
    setMovType(line.editState.movType);
    setProduct(line.editState.product);
    if (line.editState.movType === "ENTRY") {
      setLotGroups(line.editState.lotGroups);
      setEntrySapLot(line.editState.entrySapLot);
      // Van directo a "Lotes y cantidades" — el paso donde están los lotes,
      // vencimientos y pallets que vinieron a corregir.
      setWizardStep(2);
    } else {
      // Se marca ANTES de que el efecto de fefoQ llegue a correr: así, tenga o
      // no ya los datos en caché, nunca reconstruye filas vacías por encima de
      // esta selección restaurada.
      fefoRowsBuiltForProduct.current = line.editState.product.id;
      setFefoRows(line.editState.fefoRows);
    }
  }

  /**
   * Arma el remito completo (carrito + producto actual) y lo deja listo para
   * confirmar. Devuelve `null` y escribe el error del formulario si algo falta.
   *
   * El payload y la vista previa se construyen de una sola pasada sobre las
   * mismas líneas: lo que muestra la previa es literalmente lo que se envía.
   */
  function buildSubmission(): { payload: CreateDocumentPayload; preview: DocumentPreview } | null {
    let lines = cart;
    if (product) {
      const res = buildCurrentLine();
      if (res && "error" in res) {
        if (cart.length === 0) { setFormError(res.error); return null; }
      } else if (res && "line" in res) {
        lines = [...cart, res.line];
      }
    }
    if (lines.length === 0) { setFormError("Agregá al menos un producto al remito."); return null; }

    // Responsable de recepción/envío: el que se eligió en el selector; un
    // OPERATOR no puede reasignar, así que su remito queda a su propio nombre.
    // No se hereda del usuario logueado por defecto — hay que resolverlo.
    const effectiveEncargadoId = canReassignEncargado ? encargadoId : user?.userId ?? "";
    if (isEntry && !effectiveEncargadoId) {
      setFormError("Elegí quién recibió la mercadería (encargado de recepción).");
      return null;
    }
    setFormError("");

    const payload: CreateDocumentPayload = {
      type: isEntry ? "ENTRY" : "EXIT",
      date: date || undefined,
      documentNumber: isEntry ? documentNumber || undefined : undefined,
      supplier: isEntry ? supplier || undefined : undefined,
      destination: !isEntry ? destination || undefined : undefined,
      documentoMaterial: !isEntry ? documentoMaterial.trim() || undefined : undefined,
      warehouseId: warehouseId || undefined,
      carrier: carrier || undefined,
      driver: driver || undefined,
      driverDocument: driverDocument || undefined,
      vehiclePlate: vehiclePlate || undefined,
      notes: notes || undefined,
      encargadoId: effectiveEncargadoId || undefined,
      lines: lines.map((l) => ({
        productId: l.productId,
        // Total declarado del producto en el remito. El backend revalida que la
        // suma de `palletItems` coincida (mismo criterio que el frontend).
        quantity: l.totalQty,
        palletItems: l.palletItems,
      })),
    };

    // Responsable tal como va a quedar en el remito (no el creador).
    const responsible = users.find((u) => u.id === effectiveEncargadoId);
    const preview: DocumentPreview = {
      type: isEntry ? "ENTRY" : "EXIT",
      date: date || todayISO(),
      warehouseName: warehouseLabel(activeWarehouse),
      supplier: isEntry ? supplier : undefined,
      destination: !isEntry ? destination : undefined,
      documentNumber: isEntry ? documentNumber : undefined,
      documentoMaterial: !isEntry ? documentoMaterial.trim() : undefined,
      carrier,
      vehiclePlate,
      driver,
      driverDocument,
      responsibleName: responsible?.fullName || responsible?.username || "",
      notes,
      attachments: pendingFiles.map((f) => f.name),
      lines: lines.map((l) => l.preview),
    };

    return { payload, preview };
  }

  /**
   * Paso de confirmación: en vez de registrar de una, se muestra cómo va a
   * quedar la nota. Una entrada o una salida mueven stock real y corregirlas
   * después cuesta un ajuste — mirar antes es más barato que revertir.
   */
  function submitDocument() {
    const submission = buildSubmission();
    if (!submission) return;
    setPendingSubmission(submission);
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
    // `proveedor` quedó deprecado: el código de lote ya identifica el lote del
    // proveedor. No se manda más en payloads nuevos (el histórico no se toca).
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
                <tr><th scope="col">Fecha y hora</th><th scope="col">Material</th><th scope="col">Cantidad</th><th scope="col">Observación</th><th scope="col"></th></tr>
              </thead>
              <tbody>
                {pending.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--muted)" }}>{formatDateTimePY(m.createdAt ?? m.date)}</td>
                    <td><strong>{m.material.code}</strong><span style={{ color: "var(--muted)", fontSize: 12 }}> · {m.material.description}</span></td>
                    <td style={{ fontWeight: 700 }}>{fmtQty(m.quantity)}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 220, minWidth: 140 }}>
                      <ExpandableText value={m.notes} label="la nota" />
                    </td>
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
              <span style={{ marginLeft: 12, color: "var(--muted)" }}>{fmtQty(regMovement.quantity)} unid.</span>
              <span style={{ marginLeft: 12, color: "var(--muted)" }}>{formatDateOnly(regMovement.date)}</span>
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
                {/* "Proveedor del lote" se quitó: el código de lote ya es el
                    lote del proveedor y lo identifica. El dato histórico queda
                    en la base; solo dejó de pedirse y de enviarse. */}
                <div><label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Lote SAP</label>
                  <input className="input" value={regForm.sapLot} onChange={(e) => setRegForm((p) => ({ ...p, sapLot: e.target.value }))} /></div>
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
          <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 12 }}></div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 900, color: "var(--text)" }}>
            {lastCreatedDoc.type === "ENTRY" ? "Entrada confirmada" : "Salida confirmada"}
          </h2>
          <p style={{ color: "var(--muted)", margin: "0 0 20px", fontSize: 14 }}>
            {lastCreatedDoc.totalProducts} producto(s) registrado(s)
            {lastCreatedDoc.attachments > 0 && (
              <> ·  {lastCreatedDoc.attachments} adjunto(s) guardado(s) en la bitácora</>
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
               Etiquetas de pallet
            </button>
            {/* El checklist de recepción solo existe para Entradas. */}
            {lastCreatedDoc.type === "ENTRY" && (
              <button
                type="button"
                className="btn btn--primary"
                style={{ fontSize: 15, padding: "10px 22px", gap: 8, display: "flex", alignItems: "center" }}
                onClick={() => window.open(`/print/checklist/${lastCreatedDoc.id}`, "_blank")}
              >
                📋 Checklist
              </button>
            )}
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
                        {formatDateOnly(doc.date)}
                      </td>
                      <td style={{ fontSize: 13 }}>{(movType === "ENTRY" ? doc.supplier : doc.destination) ?? "—"}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{doc.documentNumber ?? "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{doc.totalLines}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtQty(doc.totalQuantity)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: doc.status === "APROBADO" ? "var(--badge-in-bg, #dcfce7)" : "var(--badge-adj-bg, #fef9c3)",
                          color: doc.status === "APROBADO" ? "var(--badge-in-text, #166534)" : "var(--badge-adj-text, #854d0e)",
                        }}>
                          {doc.status.replace("_", " ")}
                        </span>
                        {/* El status de arriba no cambia si una línea se anuló después de
                            aprobado — esta es la señal aparte de que ya no está 100% intacto. */}
                        {!!doc.voidedLines && (
                          <div
                            title="Al menos un movimiento de este remito fue anulado después de aprobado."
                            style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, whiteSpace: "nowrap" }}
                          >
                            ⊘ {doc.voidedLines} anulada{doc.voidedLines !== 1 ? "s" : ""}
                          </div>
                        )}
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
                          
                        </button>
                        {/* Reimpresión del checklist: solo para remitos de Entrada. */}
                        {doc.type === "ENTRY" && (
                          <button
                            type="button"
                            title="Imprimir checklist de recepción"
                            onClick={() => window.open(`/print/checklist/${doc.id}`, "_blank")}
                            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 14, marginLeft: 4 }}
                          >
                            📋
                          </button>
                        )}
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

          {/* El depósito ya no se elige acá: la operación pertenece al depósito
              activo de la sesión (el del header). Se muestra como contexto para
              que el operador vea sin ambigüedad dónde está cargando. */}
          {(movType !== "ENTRY" || wizardStep === 1) && !isTransfer && movType !== "EXIT" && (
            <>
              <div className="form-section-title">Depósito</div>
              <div style={{ display: "grid", gap: 4, maxWidth: 420 }}>
                <div
                  className="input"
                  aria-label="Depósito de la operación"
                  style={{ display: "flex", alignItems: "center", fontWeight: 700, background: "var(--panel-hi)" }}
                >
                  {warehouseLabel(activeWarehouse)}
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Para operar en otro depósito, cambiálo en el selector del encabezado.
                </span>
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
                            {loc.code} · {loc.pallets} pal. · {fmtQty(loc.qty)} unid.
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
                  <LocationPicker value={toLocationId} onChange={setToLocationId} placeholder="Seleccionar destino" excludeUnavailable productId={transferProduct?.id} excludeLocationId={fromLocationId || undefined} />
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
                      {originPallets.length} palet{originPallets.length !== 1 ? "s" : ""} · {transferGroups.length} producto{transferGroups.length !== 1 ? "s" : ""} · {fmtQty(sumQuantities(originPallets.map((p) => p.quantity)))} unid.
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
                      const groupQty = sumQuantities(g.pallets.map((p) => p.quantity));
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
                              {g.pallets.length} palet{g.pallets.length !== 1 ? "s" : ""} · {fmtQty(groupQty)} unid.
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
                                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtQty(p.quantity)} unid.</span>
                                  {p.fechaVencimiento && (
                                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                                      Vence {formatDateOnly(p.fechaVencimiento)}
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
                        ✓ {selectedTransferPallets.length} palet{selectedTransferPallets.length !== 1 ? "s" : ""} · {fmtQty(transferTotalQty)} unid. · {transferProductCount} producto{transferProductCount !== 1 ? "s" : ""}
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
                {/* Si el depósito no maneja Lote SAP, el concepto no existe acá:
                    no se muestra ni el título ni el campo. Dentro de un depósito
                    que sí lo maneja, el material puede estar configurado como "no
                    utiliza Lote SAP" y ahí se avisa — el input sigue apareciendo
                    porque la cabecera es del remito, no de un material. */}
                {warehouseUsesSapLot(activeWarehouse) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>Lote SAP:</label>
                    {product?.usesSapLot === false ? (
                      <span style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
                        No aplica a este material
                      </span>
                    ) : (
                      <input className="input" value={entrySapLot} onChange={(e) => setEntrySapLot(e.target.value)}
                        placeholder={generateSapLot()} style={{ width: 140, fontSize: 13 }} title="Lote SAP del día — compartido para toda la entrada" />
                    )}
                  </div>
                )}
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
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 2 }}>F. Vencimiento *</div>
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
                    {/* Cantidad y pallets — el peso y el sector se cargan en el gestor */}
                    <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "end" }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 2 }}>Cantidad *</div>
                        {group.palletLines.length > 0 ? (
                          // Con desglose, la cantidad del lote se DERIVA de los pallets:
                          // se edita cada pallet en "Gestionar pallets", no acá.
                          <>
                            <QuantityInput readOnly allowZero
                              value={fmtQty(palletLinesSum(group.palletLines))}
                              onChange={() => {}}
                              unitOfMeasure={product?.unitOfMeasure}
                              aria-label={`Cantidad del lote ${group.lotCode || "nuevo"} (suma de los pallets)`}
                              style={{ fontSize: 14, fontWeight: 700 }} />
                            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                              suma de los {group.palletLines.length} pallets — editá cada uno en "Gestionar pallets"
                            </div>
                          </>
                        ) : (
                          <QuantityInput placeholder="Unidades recibidas"
                            value={group.quantity} onChange={(v) => updateGroup(group.id, "quantity", v)}
                            unitOfMeasure={product?.unitOfMeasure} showError
                            aria-label={`Cantidad del lote ${group.lotCode || "nuevo"}`}
                            style={{ fontSize: 14, fontWeight: 700 }} />
                        )}
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 2 }}>Cant. pallets</div>
                        <input className="input" type="number" min={0} placeholder="Distribuye automático"
                          value={group.palletCount} onChange={(e) => updateGroup(group.id, "palletCount", e.target.value)}
                          style={{ fontSize: 13 }} />
                      </div>
                    </div>
                    {group.palletLines.length > 0 && (() => {
                      const sum = palletLinesSum(group.palletLines);
                      const sinSector = group.palletLines.filter((l) => !l.locationId).length;
                      return (
                        <div style={{ padding: "6px 10px", borderTop: "1px solid var(--border)", background: "var(--bg-base)", fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ color: "var(--muted)" }}>{group.palletLines.length} pallets</span>
                          <span style={{ color: sum > 0 ? "var(--success)" : "var(--muted)", fontWeight: 700 }}>{fmtQty(sum)} unid.</span>
                          {sinSector > 0 && (
                            <span style={{ color: "var(--warning)" }}>{sinSector} sin sector asignado</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
                <button type="button" className="btn" onClick={addLotGroup} style={{ alignSelf: "start", fontSize: 13 }}>+ Agregar otro lote</button>
              </div>

              {/* Resumen inline */}
              {lotGroups.some((g) => g.lotCode.trim() && lotGroupQuantity(g) > 0) && (
                <div style={{ background: "var(--bg)", border: "1px solid var(--border-dim)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>Total entrada: </span>
                  <strong style={{ color: "var(--success)" }}>
                    {fmtQty(sumQuantities(lotGroups.map((g) => lotGroupQuantity(g))))} unidades
                  </strong>
                  {(lotGroups.some((g) => g.palletLines.length > 0) || lotGroups.some((g) => (Number(g.palletCount) || 0) > 0)) && (
                    <span style={{ color: "var(--muted)", marginLeft: 10 }}>
                      en {lotGroups.reduce((s, g) => s + (g.palletLines.length > 0 ? g.palletLines.length : (Number(g.palletCount) || 0)), 0)} pallets
                    </span>
                  )}
                  <span style={{ color: "var(--muted)", marginLeft: 10 }}>
                    · {lotGroups.filter((g) => g.lotCode.trim() && lotGroupQuantity(g) > 0).length} lote(s)
                  </span>
                </div>
              )}

              {/* Gestor de pallets: peso y sector de cada pallet, uno por uno */}
              {totalPalletLines > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowPalletManager(true)}
                  style={{ alignSelf: "start", fontSize: 13, borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 700 }}
                >
                  Gestionar pallets y ubicación ({totalPalletLines})
                </button>
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
                    {totalExitPallets} palet{totalExitPallets !== 1 ? "s" : ""} · {fmtQty(totalExitQty)} unid.
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
                    const availQty = sumQuantities(availPallets.map((p) => p.quantity));
                    const selPallets = availPallets.filter((p) => row.selectedIds.has(p.id));
                    // Total del lote: la suma de lo cargado en los palets tildados.
                    // Es un valor derivado — se recalcula solo al editar un palet.
                    const despacha = rowExitQty(row);
                    const rowError = selPallets.length > 0 ? exitRowError(rowSelection(row), row.lot.pallets) : null;
                    const rowParcial = exitRowIsPartial(rowSelection(row), row.lot.pallets);
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
                            {row.lot.sapLot && sapLotApplies(activeWarehouse, product) && (
                              <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, fontFamily: "monospace" }}>{row.lot.sapLot}</span>
                            )}
                            {blocked && (
                              <span className="badge badge--adj-out" style={{ fontSize: 10 }}>PROVISORIO — bloqueado</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12 }}>
                            {row.lot.fechaVencimiento && (
                              <span style={{ color: "var(--muted)" }}>
                                Vence: {formatDateOnly(row.lot.fechaVencimiento)}
                                {expiryBadge(days)}
                              </span>
                            )}
                            <span style={{ fontWeight: 700 }}>{fmtQty(availQty)} unid.</span>
                            <span style={{ color: "var(--muted)" }}>{availPallets.length} palet{availPallets.length !== 1 ? "s" : ""}</span>
                          </div>
                        </div>

                        {/* ── Cantidad a despachar (CALCULADA, solo lectura) + atajo FEFO ── */}
                        <div style={{ padding: "10px 12px", background: "var(--panel)", display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>
                              Cantidad a despachar
                            </div>
                            {/* Valor CALCULADO: la suma de lo cargado en los palets
                                tildados. No es editable — se ajusta editando cada palet. */}
                            <div style={{ fontSize: 18, fontWeight: 800, color: selPallets.length > 0 ? "var(--text)" : "var(--muted)" }}>
                              {fmtQty(despacha)} <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>unid.</span>
                            </div>
                            {selPallets.length > 0 && (
                              <div style={{ fontSize: 11, color: rowError ? "var(--danger)" : "var(--muted)", fontWeight: rowError ? 700 : 400 }}>
                                {selPallets.length}/{availPallets.length} palet{availPallets.length !== 1 ? "s" : ""}
                                {" · "}
                                {rowParcial ? "salida parcial" : "palets completos"}
                              </div>
                            )}
                          </div>

                          {/* Atajo FEFO — acción explícita: solo actúa al hacer clic. */}
                          <div>
                            {blocked ? (
                              <span style={{ fontSize: 12, color: "var(--muted)" }}>Pendiente de regularización — no se puede despachar</span>
                            ) : (
                              <div style={{ display: "grid", gap: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                                  Sugerir selección (orden FEFO)
                                </span>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                  <QuantityInput
                                    allowZero
                                    placeholder="cantidad"
                                    value={row.fefoTargetInput}
                                    onChange={(v) => setFefoTarget(lotIdx, v)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyFefoSuggestion(lotIdx); } }}
                                    style={{ fontSize: 13, width: 110 }}
                                    aria-label={`Cantidad objetivo para sugerir palets del lote ${row.lot.lotCode}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => applyFefoSuggestion(lotIdx)}
                                    disabled={(parseQtyInput(row.fefoTargetInput) ?? 0) <= 0}
                                    className="btn btn--sm"
                                    style={{ fontSize: 12, fontWeight: 700 }}
                                  >
                                    Sugerir
                                  </button>
                                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                                    reemplaza la selección; después editá a mano
                                  </span>
                                </div>
                                {rowError && (
                                  <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 700 }}>{rowError}</span>
                                )}
                              </div>
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
                              {rowParcial && (
                                <span style={{ color: "var(--warning)", fontWeight: 600, marginLeft: 4 }}>
                                  · parcial
                                </span>
                              )}
                            </button>
                            {row.expanded && (() => {
                              return (
                                <div style={{ borderTop: "1px solid var(--border-dim)" }}>
                                  {availPallets.map((p, pIdx) => {
                                    const isSelected = row.selectedIds.has(p.id);
                                    // Lo cargado para este palet: es lo que se descuenta.
                                    const take = palletExitQty(row, p.id);
                                    const excede = quantityDelta(take, p.quantity) > 0;
                                    const isPartial = take > 0 && quantityDelta(p.quantity, take) > 0;
                                    return (
                                      <label
                                        key={p.id}
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "auto auto 1fr auto auto",
                                          alignItems: "center",
                                          gap: 10,
                                          padding: "7px 16px",
                                          cursor: blocked ? "not-allowed" : "pointer",
                                          background: isSelected
                                            ? excede
                                              ? "var(--badge-exit-bg)"
                                              : isPartial
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
                                          {fmtQty(p.quantity)} unid. stock
                                        </span>
                                        {/* Cuánto sale de ESTE palet. Editable: en una salida
                                            fraccionaria el reparto real lo decide el operador, y
                                            este número es el que descuenta stock y palet. */}
                                        {isSelected && (
                                          <span
                                            style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
                                            onClick={(e) => e.preventDefault()}
                                          >
                                            <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>Sale</span>
                                            <span style={{ position: "relative" }}>
                                              <button
                                                type="button"
                                                data-location-popover-trigger
                                                onClick={() => setLocationPopoverPalletId((cur) => (cur === p.id ? null : p.id))}
                                                aria-label={`Dónde está el palet ${p.code}`}
                                                aria-expanded={locationPopoverPalletId === p.id}
                                                title="Dónde está este palet"
                                                style={{
                                                  display: "flex", alignItems: "center", justifyContent: "center",
                                                  width: 22, height: 22, padding: 0, borderRadius: 5,
                                                  border: "1px solid var(--border)",
                                                  background: locationPopoverPalletId === p.id ? "var(--primary-light)" : "none",
                                                  color: locationPopoverPalletId === p.id ? "var(--primary)" : "var(--muted)",
                                                  cursor: "pointer",
                                                }}
                                              >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                                  <circle cx="12" cy="10" r="3" />
                                                </svg>
                                              </button>
                                              {locationPopoverPalletId === p.id && (() => {
                                                const loc = p.currentLocationId ? locationById[p.currentLocationId] : undefined;
                                                const zone = zoneMeta(loc?.zone);
                                                return (
                                                  <div
                                                    role="dialog"
                                                    data-location-popover
                                                    aria-label={`Ubicación del palet ${p.code}`}
                                                    style={{
                                                      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20,
                                                      width: 210, background: "var(--panel)", border: "1.5px solid var(--border)",
                                                      borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.25)", padding: 10,
                                                    }}
                                                  >
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                                                      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace" }}>{p.code}</span>
                                                      <button
                                                        type="button"
                                                        onClick={() => setLocationPopoverPalletId(null)}
                                                        aria-label="Cerrar"
                                                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--muted)", fontSize: 14, lineHeight: 1 }}
                                                      >×</button>
                                                    </div>
                                                    {loc ? (
                                                      <div style={{ fontSize: 12, display: "grid", gap: 2 }}>
                                                        <span>Ubicación: <strong style={{ fontFamily: "monospace" }}>{loc.code}</strong></span>
                                                        {zone && <span style={{ color: "var(--muted)" }}>Zona: {zone.label}</span>}
                                                        {loc.aisle && <span style={{ color: "var(--muted)" }}>Sector: {loc.aisle}</span>}
                                                        {loc.rack && <span style={{ color: "var(--muted)" }}>Subsector: {loc.rack}</span>}
                                                      </div>
                                                    ) : (
                                                      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Sin ubicación registrada.</p>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                            </span>
                                            <QuantityInput
                                              allowZero
                                              align="right"
                                              value={row.qtyByPallet[p.id] ?? ""}
                                              disabled={blocked}
                                              invalid={excede}
                                              onChange={(v) => setPalletExitQty(lotIdx, p.id, v)}
                                              style={{ width: 92, fontSize: 12, padding: "3px 6px", fontWeight: 700 }}
                                              aria-label={`Cantidad a despachar del palet ${p.code}`}
                                            />
                                            {excede ? (
                                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)" }}>
                                                solo tiene {fmtQty(p.quantity)}
                                              </span>
                                            ) : isPartial ? (
                                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--warning)" }}>
                                                parcial — quedan {fmtQty(quantityDelta(p.quantity, take))}
                                              </span>
                                            ) : take > 0 ? (
                                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--success)" }}>
                                                palet completo
                                              </span>
                                            ) : (
                                              <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 700 }}>
                                                sin cantidad
                                              </span>
                                            )}
                                          </span>
                                        )}
                                        {!isSelected && p.currentLocationId && (
                                          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace", justifySelf: "end" }}>
                                            {locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8)}
                                          </span>
                                        )}
                                        {/* Paletas físicas con las que sale este palet. Opcional:
                                            en blanco, la salida se registra como siempre. */}
                                        {isSelected && (
                                          <span
                                            style={{ display: "flex", alignItems: "center", gap: 5, justifySelf: "end" }}
                                            onClick={(e) => e.preventDefault()}
                                            title="Paletas físicas con las que se despacha este palet. Solo informativo: no cambia el stock ni el descuento. En blanco = 1."
                                          >
                                            <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
                                              Paletas fís.
                                            </span>
                                            <input
                                              className="input"
                                              type="number"
                                              min={0}
                                              max={999}
                                              placeholder="1"
                                              value={row.dispatchedByPallet[p.id] ?? ""}
                                              disabled={blocked}
                                              onChange={(e) => setDispatchedPallets(lotIdx, p.id, e.target.value)}
                                              style={{ width: 58, fontSize: 12, padding: "3px 6px", textAlign: "center" }}
                                              aria-label={`Paletas físicas despachadas del palet ${p.code}`}
                                            />
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
              {/* Grilla responsive con etiquetas: el mínimo de 230px corta a dos
                  o tres columnas en vez de apretar siete campos en una línea. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, alignItems: "start" }}>
                {showsExternalDocumentNumber(movType) && (
                  <Field label="N° MIC / Factura / Remito">
                    <input className="input" placeholder="Ej: 001-001-0001234" value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value)} aria-label="N° MIC/Factura/Remito" />
                  </Field>
                )}
                {/* Proveedor: del catálogo. Si no existe, se da de alta sin salir del formulario. */}
                {isEntry && (
                  <Field
                    label="Proveedor"
                    hint={
                      <button
                        type="button"
                        onClick={() => setShowNewSupplier(true)}
                        style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 11, color: "var(--muted)", textDecoration: "underline", justifySelf: "start" }}
                      >
                        Agregar proveedor
                      </button>
                    }
                  >
                    <HybridSearchInput
                      options={suppliers}
                      value={supplier}
                      onChange={setSupplier}
                      onSelect={(s) => setSupplier(s.name)}
                      getKey={(s) => s.id}
                      getLabel={(s) => s.name}
                      getDescription={(s) => s.ruc ?? ""}
                      placeholder="Buscar o escribir proveedor"
                    />
                  </Field>
                )}
                {/* Vehículo/patente: campo híbrido — busca en Transportes o acepta uno nuevo sin registrarlo antes. */}
                {!isTransfer && (
                  <Field label="Vehículo / chapa">
                    <HybridSearchInput<Transport>
                      options={transports.filter((t) => t.active)}
                      value={vehiclePlate}
                      onChange={setVehiclePlate}
                      onSelect={(t) => {
                        // Patente registrada: autocompleta transportadora y, si el
                        // vehículo tiene un único chofer activo, también el conductor y su CI.
                        setVehiclePlate(t.plate);
                        setCarrier(t.carrier || t.description || "");
                        const activos = t.drivers.filter((d) => d.status !== "INACTIVO");
                        if (activos.length === 1) {
                          setDriver(activos[0].name);
                          setDriverDocument(activos[0].document ?? "");
                        } else {
                          setDriver("");
                          setDriverDocument("");
                        }
                      }}
                      getKey={(t) => t.id}
                      getLabel={(t) => t.plate}
                      getDescription={(t) => [t.carrier, t.type].filter(Boolean).join(" · ")}
                      placeholder="Buscar o escribir chapa"
                    />
                  </Field>
                )}
                {/* Transportadora: campo híbrido — sugiere transportadoras ya cargadas en Transportes, pero admite cualquier texto. */}
                {!isTransfer && (
                  <Field label="Transportadora">
                    <HybridSearchInput<string>
                      options={carrierOptions}
                      value={carrier}
                      onChange={setCarrier}
                      onSelect={setCarrier}
                      getKey={(c) => c}
                      getLabel={(c) => c}
                      placeholder="Buscar o escribir transportadora"
                    />
                  </Field>
                )}
                {/* Conductor: campo híbrido sobre TODA la flota (no depende de elegir vehículo primero); al elegir uno registrado completa la CI. */}
                {!isTransfer && (
                  <Field label="Conductor" hint={
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    </span>
                  }>
                    <HybridSearchInput<TransportDriver & { plates: string[] }>
                      options={allDrivers}
                      value={driver}
                      onChange={(text) => { setDriver(text); setDriverDocument(""); }}
                      onSelect={(d) => { setDriver(d.name); setDriverDocument(d.document ?? ""); }}
                      getKey={(d) => d.name}
                      getLabel={(d) => d.name}
                      getDescription={(d) => (d.document ? `CI ${d.document}` : "")}
                      getBadge={(d) => d.plates.join(", ") || undefined}
                      placeholder="Buscar o escribir conductor"
                    />
                  </Field>
                )}
                {/* CI del conductor: se autocompleta al elegir un chofer registrado, pero queda editable para choferes manuales o correcciones. */}
                {!isTransfer && (
                  <Field label="CI del conductor">
                    <input
                      className="input"
                      placeholder="Opcional"
                      value={driverDocument}
                      onChange={(e) => setDriverDocument(e.target.value)}
                      aria-label="CI del conductor"
                    />
                  </Field>
                )}
                {movType === "EXIT" && (
                  <Field label="Destino">
                    <HybridSearchInput
                      options={destinations}
                      value={destination}
                      onChange={setDestination}
                      onSelect={(selected) => setDestination(selected.name)}
                      getKey={(selected) => selected.id}
                      getLabel={(selected) => selected.name}
                      getDescription={(selected) => selected.notes ?? ""}
                      placeholder="Buscar o escribir destino"
                      onCreate={(name) => createDestinationMut.mutate({ name })}
                      getCreateLabel={(name) => `Agregar nuevo destino: ${name}`}
                      creating={createDestinationMut.isPending}
                      registeredTitle="Destino guardado en el catálogo"
                    />
                  </Field>
                )}
                {movType === "EXIT" && (
                  <Field label="Documento Material">
                    <input
                      className="input"
                      placeholder="Opcional"
                      value={documentoMaterial}
                      onChange={(e) => setDocumentoMaterial(e.target.value)}
                      maxLength={80}
                      aria-label="Documento Material"
                    />
                  </Field>
                )}
                {/* Responsable de la operación (quién recibió/envió). Obligatorio
                    en una entrada. Solo ADMIN/MANAGER pueden elegir a otra
                    persona; el OPERATOR ve su propio nombre y no lo cambia. */}
                {!isTransfer && (
                  <Field label={`${responsibleFieldLabel(movType)}${isEntry ? " *" : ""}`}>
                    {canReassignEncargado ? (
                      <SearchableSelect
                        options={users}
                        value={users.find((u) => u.id === encargadoId) ?? null}
                        onChange={(u) => setEncargadoId(u?.id ?? "")}
                        getKey={(u) => u.id}
                        getLabel={(u) => u.fullName || u.username}
                        getBadge={(u) => u.role}
                        placeholder={responsibleFieldLabel(movType)}
                      />
                    ) : (
                      <input
                        className="input"
                        value={users.find((u) => u.id === user?.userId)?.fullName || user?.username || ""}
                        readOnly
                        disabled
                        title="El remito queda a tu nombre"
                        aria-label={responsibleFieldLabel(movType)}
                      />
                    )}
                  </Field>
                )}
                <Field label="Observaciones" span>
                  <textarea className="input"
                    placeholder="Opcional — se imprime en la nota"
                    value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                    aria-label="Observaciones" />
                </Field>
              </div>
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
                        <td style={{ textAlign: "right" }}>{fmtQty(l.totalQty)}</td>
                        <td style={{ textAlign: "right" }}>{l.palletsCount}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => editCartLine(l.key)}
                            disabled={!!product}
                            title={product ? "Agregá o quitá el material que estás cargando para poder editar esta línea" : "Volver a cargar este producto — lotes, pallets y fechas incluidos"}
                            style={{ padding: "2px 8px", marginRight: 6, fontWeight: 700 }}
                            aria-label={`Editar ${l.productLabel}`}
                          >
                            Editar
                          </button>
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
                  ? `⇄ Transferir ${selectedTransferPallets.length} palet${selectedTransferPallets.length !== 1 ? "s" : ""} (${fmtQty(transferTotalQty)} unid.)`
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
                    aria-label="Revisar y confirmar la entrada"
                  >
                    {savingDoc ? "Guardando..." : `Revisar y confirmar entrada${cart.length ? ` (${cart.length + (product ? 1 : 0)} prod.)` : ""}`}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAttachModal(true)}
                    style={pendingFiles.length > 0 ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 700 } : undefined}
                    aria-label="Adjuntar documentos al remito"
                  >
                     Adjuntar{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : " documentos"}
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
                {savingDoc ? "Guardando..." : `Revisar y confirmar remito${cart.length ? ` (${cart.length + (product ? 1 : 0)} prod.)` : ""}`}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowAttachModal(true)}
                style={pendingFiles.length > 0 ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 700 } : undefined}
                aria-label="Adjuntar documentos al remito"
              >
                 Adjuntar{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : " documentos"}
              </button>
              <button type="button" className="btn" onClick={resetForm}>Limpiar</button>
            </div>
          )}
        </form>
      </section>}

      {/* ── Revisión previa: la nota como va a quedar, antes de tocar stock ── */}
      {pendingSubmission && (
        <DocumentPreviewModal
          preview={pendingSubmission.preview}
          saving={savingDoc}
          onConfirm={() => createDocumentMut.mutate(pendingSubmission.payload)}
          onBack={() => setPendingSubmission(null)}
        />
      )}

      {/* ── Alta rápida de proveedor (sin salir del remito) ── */}
      {showNewSupplier && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowNewSupplier(false)}
        >
          <div
            className="card"
            style={{ width: "min(420px, 100%)", display: "grid", gap: 12 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Agregar proveedor"
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Agregar proveedor</h3>
              <button type="button" onClick={() => setShowNewSupplier(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>
                Nombre o razón social *
              </label>
              <input className="input" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Ej: Cervepar S.A." aria-label="Nombre del proveedor" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>
                RUC (opcional)
              </label>
              <input className="input" value={newSupplierRuc} onChange={(e) => setNewSupplierRuc(e.target.value)}
                placeholder="Ej: 80012345-6" aria-label="RUC del proveedor" />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={createSupplierMut.isPending || newSupplierName.trim().length < 2}
                onClick={() => createSupplierMut.mutate({
                  name: newSupplierName.trim(),
                  ruc: newSupplierRuc.trim() || undefined,
                })}
              >
                {createSupplierMut.isPending ? "Guardando..." : "Agregar"}
              </button>
              <button type="button" className="btn" onClick={() => setShowNewSupplier(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Gestor jerárquico: Producto → Lote → Pallets ── */}
      {showPalletManager && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowPalletManager(false)}
        >
          <div
            className="card"
            style={{ width: "min(1100px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 14 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Gestionar pallets y ubicación"
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Gestionar pallets y ubicación</h3>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  Cargá los valores generales por lote y editá debajo solamente las excepciones.
                </p>
              </div>
              <button type="button" onClick={() => setShowPalletManager(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
            </div>

            {/* Producto */}
            <div style={{ border: "1.5px solid var(--primary)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", background: "var(--primary-light)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>Producto</div>
                  <strong style={{ fontSize: 14 }}>{product ? `${product.code} · ${product.description}` : "Producto actual"}</strong>
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
                  {lotGroups.filter((group) => group.palletLines.length > 0).length} lote(s) · {totalPalletLines} pallet{totalPalletLines !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Lotes */}
              <div style={{ padding: 12, display: "grid", gap: 12 }}>
                {lotGroups.filter((group) => group.palletLines.length > 0).map((group) => {
                  const locatedCount = group.palletLines.filter((line) => !!line.locationId).length;
                  const weightedCount = group.palletLines.filter((line) => line.weightKg !== "").length;
                  const collapsed = collapsedLots.has(group.id);
                  const pendingLocation = group.palletLines.length - locatedCount;
                  return (
                    <section key={group.id} aria-label={`Lote ${group.lotCode || "sin código"}`} style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
                      {/* Encabezado plegable: un click acá oculta o vuelve a mostrar
                          el desglose del lote. */}
                      <button
                        type="button"
                        onClick={() => toggleLotCollapsed(group.id)}
                        aria-expanded={!collapsed}
                        aria-label={`${collapsed ? "Mostrar" : "Ocultar"} el desglose del lote ${group.lotCode || "sin código"}`}
                        style={{
                          width: "100%", textAlign: "left", cursor: "pointer", font: "inherit",
                          padding: "9px 10px", background: "var(--bg)", border: "none",
                          borderBottom: "1px solid var(--border)",
                          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: "var(--muted)", width: 12, flexShrink: 0 }} aria-hidden="true">
                            {collapsed ? "▼" : "▲"}
                          </span>
                          <span>
                            <span style={{ display: "block", fontSize: 10, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>Lote</span>
                            <strong style={{ fontFamily: "monospace", fontSize: 14 }}>{group.lotCode || "Sin código"}</strong>
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          {/* Plegado, el encabezado tiene que alcanzar para saber si
                              al lote le falta algo. */}
                          {collapsed && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: pendingLocation > 0 ? "var(--warning)" : "var(--success)" }}>
                              {pendingLocation > 0
                                ? `${pendingLocation} pallet(s) sin sector`
                                : "Todos con sector"}
                            </span>
                          )}
                          <div style={{ padding: "5px 9px", border: "1px solid var(--border-dim)", borderRadius: 6, background: "var(--bg-base)" }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Cantidad total</div>
                            <strong style={{ fontSize: 13 }}>{fmtQty(lotGroupQuantity(group))} unid.</strong>
                          </div>
                          <div style={{ padding: "5px 9px", border: "1px solid var(--border-dim)", borderRadius: 6, background: "var(--bg-base)" }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Cantidad de pallets</div>
                            <strong style={{ fontSize: 13 }}>{group.palletLines.length}</strong>
                          </div>
                        </div>
                      </button>

                      {!collapsed && (<>
                      {/* Carga rápida por lote */}
                      <div style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10, borderBottom: "1px solid var(--border)", background: "var(--bg-base)" }}>
                        <div style={{ display: "grid", gap: 5, alignContent: "start" }}>
                          <label style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Ubicación recomendada</label>
                          <LocationPicker
                            value={group.bulkLocationId}
                            onChange={(locId) => updateGroup(group.id, "bulkLocationId", locId)}
                            warehouseId={warehouseId || undefined}
                            productId={product?.id}
                            sessionUsage={locationSessionUsage}
                            placeholder="Elegí un sector para el lote"
                          />
                          <button
                            type="button"
                            className="btn"
                            disabled={!group.bulkLocationId}
                            onClick={() => applyLocationToLot(group.id)}
                            style={{ justifySelf: "start", fontSize: 12, fontWeight: 700, borderColor: "var(--primary)", color: "var(--primary)" }}
                          >
                            Aplicar ubicación al lote
                          </button>
                        </div>

                        <div style={{ display: "grid", gap: 5, alignContent: "start" }}>
                          <label htmlFor={`lot-weight-${group.id}`} style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Peso general del lote (kg por pallet)</label>
                          <QuantityInput
                            id={`lot-weight-${group.id}`}
                            allowZero
                            placeholder="Ej: 850"
                            value={group.bulkWeightKg}
                            onChange={(v) => updateGroup(group.id, "bulkWeightKg", v)}
                          />
                          <button
                            type="button"
                            className="btn"
                            disabled={group.bulkWeightKg === "" || (parseQtyInput(group.bulkWeightKg) ?? -1) < 0}
                            onClick={() => applyWeightToLot(group.id)}
                            style={{ justifySelf: "start", fontSize: 12, fontWeight: 700, borderColor: "var(--primary)", color: "var(--primary)" }}
                          >
                            Aplicar peso al lote
                          </button>
                        </div>
                      </div>

                      {/* Pallets */}
                      <div style={{ padding: "7px 10px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "var(--bg)" }}>
                        <strong style={{ fontSize: 12 }}>Pallets · desglose editable</strong>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>
                          {locatedCount}/{group.palletLines.length} ubicados · {weightedCount}/{group.palletLines.length} con peso
                        </span>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th scope="col">Pallet</th>
                              <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                              <th scope="col" style={{ textAlign: "right" }}>Peso (kg)</th>
                              <th scope="col">Sector-Subsector</th>
                              <th scope="col">Colocación</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.palletLines.map((line, lineIdx) => {
                              const globalIdx = palletRows.findIndex((row) => row.groupId === group.id && row.idx === lineIdx);
                              const effectiveLoc = line.locationId;
                              const state = effectiveLoc ? planByLocation.get(effectiveLoc) : undefined;
                              const view = effectiveLoc ? locationPlanViews.get(effectiveLoc) : undefined;
                              const posInLocation = effectiveLoc
                                ? palletRows.slice(0, globalIdx).filter((row) => row.line.locationId === effectiveLoc).length
                                : -1;
                              const pile = posInLocation >= 0 ? view?.keyToPile.get(String(posInLocation)) : undefined;
                              const item = pile?.items.find((it) => it.key === String(posInLocation));
                              const basesFreeHere = posInLocation >= 0 ? (view?.runningBasesFree[posInLocation] ?? null) : null;

                              let placement: { text: string; color: string };
                              if (!effectiveLoc) {
                                placement = { text: "Elegí un sector", color: "var(--warning)" };
                              } else if (state?.loading) {
                                placement = { text: "Calculando…", color: "var(--muted)" };
                              } else if (state?.error) {
                                placement = { text: state.error, color: "var(--danger)" };
                              } else if (pile && item) {
                                const levelTxt = pile.items.length > 1 && pile.maxLevel ? `nivel ${item.stackPosition}/${pile.maxLevel}` : null;
                                if (item.stackPosition === 1) {
                                  const basesTxt = basesFreeHere != null ? `quedan ${basesFreeHere} bases` : null;
                                  placement = { text: ["Abre base nueva", levelTxt, basesTxt].filter(Boolean).join(" · "), color: "var(--muted)" };
                                } else {
                                  const baseRef = pile.isNew ? "la base nueva" : "la pila existente";
                                  const siblings = (view?.pileRowNumbers.get(pile.sequence) ?? []).filter((n) => n !== globalIdx + 1);
                                  const withTxt = siblings.length ? `con P${siblings.join(", P")}` : null;
                                  placement = { text: [`Se apila sobre ${baseRef}`, levelTxt, withTxt].filter(Boolean).join(" · "), color: "var(--success)" };
                                }
                              } else {
                                placement = { text: "—", color: "var(--muted)" };
                              }

                              return (
                                <tr key={`${group.id}-${lineIdx}`}>
                                  <td style={{ fontWeight: 700, fontFamily: "monospace" }}>P{lineIdx + 1}</td>
                                  <td style={{ textAlign: "right" }}>
                                    <QuantityInput
                                      allowZero align="right" value={line.qty}
                                      onChange={(v) => updatePalletLine(group.id, lineIdx, { qty: v })}
                                      style={{ fontSize: 12, padding: "3px 6px", width: 90 }}
                                      aria-label={`Cantidad del pallet ${lineIdx + 1} del lote ${group.lotCode}`}
                                    />
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    <QuantityInput
                                      allowZero align="right" placeholder="—" value={line.weightKg}
                                      onChange={(v) => updatePalletLine(group.id, lineIdx, { weightKg: v })}
                                      style={{ fontSize: 12, padding: "3px 6px", width: 90 }}
                                      aria-label={`Peso del pallet ${lineIdx + 1} del lote ${group.lotCode}`}
                                    />
                                  </td>
                                  <td style={{ minWidth: 230 }}>
                                    <LocationPicker
                                      value={line.locationId}
                                      onChange={(locId) => updatePalletLine(group.id, lineIdx, { locationId: locId })}
                                      warehouseId={warehouseId || undefined}
                                      productId={product?.id}
                                      sessionUsage={locationSessionUsage}
                                      placeholder="Elegí un sector"
                                    />
                                  </td>
                                  <td style={{ minWidth: 190, fontSize: 12, color: placement.color, fontWeight: 600 }}>{placement.text}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      </>)}
                    </section>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn btn--primary" onClick={() => setShowPalletManager(false)}>
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

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
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}> Adjuntar documentos al remito</h3>
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
                      <span style={{ fontSize: 18 }}>{pf.file.type.startsWith("image/") ? "" : ""}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pf.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {cat?.label} · {pf.file.name} · {(pf.file.size / 1024).toFixed(0)} KB
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
