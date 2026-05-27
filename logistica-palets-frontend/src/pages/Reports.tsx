import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDailyStockReport,
  getMovementsReport,
  getStockReport,
  getTraceReport,
  type StockItemRow,
} from "../api/reports";
import { getMovements, regularizeMovement } from "../api/movements";
import { listLots } from "../api/lots";
import { listWarehouses } from "../api/warehouses";
import { listProducts } from "../api/products";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { DataTable, createColumnHelper } from "../design-system/DataTable";
import { exportStockPDF, exportMovementsPDF, exportDailyStockPDF, exportEntradasPDF, exportSalidasPDF, exportLotesPDF, exportTrazabilidadPDF } from "../lib/exportPdf";
import { exportStockExcel, exportMovementsExcel, exportDailyStockExcel, exportEntradasExcel, exportSalidasExcel, exportLotesExcel, exportTrazabilidadExcel } from "../lib/exportExcel";

/* ── DataTable column defs for stock tab ──────────────────────────────────── */
const stockColHelper = createColumnHelper<StockItemRow>();
const STOCK_COLUMNS = [
  stockColHelper.accessor((r) => `${r.material.code} · ${r.material.description}`, {
    id: "material",
    header: "Material",
    cell: (info) => {
      const r = info.row.original;
      return (
        <span>
          <strong>{r.material.code}</strong>
          <span style={{ color: "var(--muted)", marginLeft: 4 }}>· {r.material.description}</span>
        </span>
      );
    },
  }),
  stockColHelper.accessor((r) => r.warehouse?.name ?? "-", {
    id: "deposito",
    header: "Depósito",
  }),
  stockColHelper.accessor((r) => r.location?.code ?? "-", {
    id: "ubicacion",
    header: "Ubicación",
    meta: { align: "center" as const },
  }),
  stockColHelper.accessor("currentQuantity", {
    header: "Cantidad",
    meta: { align: "right" as const },
    cell: (info) => {
      const r = info.row.original;
      return `${info.getValue().toLocaleString("es-AR")} ${r.material.unitOfMeasure ?? ""}`.trim();
    },
  }),
  stockColHelper.accessor("updatedAt", {
    header: "Actualizado",
    meta: { align: "right" as const, noFilter: true },
    cell: (info) => (
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {new Date(info.getValue()).toLocaleString("es-AR")}
      </span>
    ),
  }),
];

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste entrada",
  ADJUSTMENT_OUT: "Ajuste salida",
};

const MOVE_BADGE: Record<string, string> = {
  ENTRY: "badge badge--entry",
  EXIT: "badge badge--exit",
  TRANSFER: "badge badge--transfer",
  ADJUSTMENT_IN: "badge badge--adj-in",
  ADJUSTMENT_OUT: "badge badge--adj-out",
};

type Tab = "stock" | "movimientos" | "lotes" | "entradas" | "diario" | "salidas" | "trazabilidad";

type MovementFilters = {
  warehouseId: string;
  productId: string;
  type: "" | "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  dateFrom: string;
  dateTo: string;
  search: string;
};

const initialFilters: MovementFilters = {
  warehouseId: "", productId: "", type: "", dateFrom: "", dateTo: "", search: "",
};

type RegPayload = {
  reason: string; documentNumber: string; supplier: string; carrier: string;
  driver: string; destination: string; notes: string; sapLot: string;
  fechaVencimiento: string; fechaFabricacion: string; proveedor: string;
};

const emptyReg: RegPayload = {
  reason: "", documentNumber: "", supplier: "", carrier: "",
  driver: "", destination: "", notes: "", sapLot: "",
  fechaVencimiento: "", fechaFabricacion: "", proveedor: "",
};

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>("stock");

  // Stock tab
  const [stockWarehouseId, setStockWarehouseId] = useState("");

  // Historial tab
  const [filters, setFilters] = useState<MovementFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<MovementFilters>(initialFilters);
  const [movPage, setMovPage] = useState(1);
  const [movLimit, setMovLimit] = useState(20);
  const [datePreset, setDatePreset] = useState("");

  // Lotes tab
  const [lotSapSearch, setLotSapSearch] = useState("");
  const [lotProductSearch, setLotProductSearch] = useState("");
  const [lotApplied, setLotApplied] = useState<{ sap: string; product: string } | null>(null);

  // Entradas tab
  const [entProductId, setEntProductId] = useState("");
  const [entDateFrom, setEntDateFrom] = useState("");
  const [entDateTo, setEntDateTo] = useState("");
  const [entDatePreset, setEntDatePreset] = useState("");
  const [entApplied, setEntApplied] = useState({ productId: "", dateFrom: "", dateTo: "" });
  const [entPage, setEntPage] = useState(1);
  const [entLimit, setEntLimit] = useState(20);

  // Salidas tab
  const [salProductId, setSalProductId] = useState("");
  const [salDateFrom, setSalDateFrom] = useState("");
  const [salDateTo, setSalDateTo] = useState("");
  const [salDatePreset, setSalDatePreset] = useState("");
  const [salApplied, setSalApplied] = useState({ productId: "", dateFrom: "", dateTo: "" });
  const [salPage, setSalPage] = useState(1);
  const [salLimit, setSalLimit] = useState(20);

  // Regularization modal (used from Entradas tab)
  const [regModal, setRegModal] = useState<{ id: string; label: string } | null>(null);
  const [regForm, setRegForm] = useState<RegPayload>(emptyReg);
  const [regError, setRegError] = useState("");

  // Trace tab
  const [traceMaterialId, setTraceMaterialId] = useState("");
  const [traceApplied, setTraceApplied] = useState("");

  // Daily tab
  const [dailyDateFrom, setDailyDateFrom] = useState(today);
  const [dailyDateTo, setDailyDateTo] = useState(today);
  const [dailyDatePreset, setDailyDatePreset] = useState("hoy");

  // ── Catalog queries ───────────────────────────────────────────────────────

  const [warehousesQ, productsQ] = useQueries({
    queries: [
      { queryKey: ["warehouses"], queryFn: listWarehouses, staleTime: 5 * 60_000 },
      { queryKey: ["products"],   queryFn: () => listProducts(),   staleTime: 5 * 60_000 },
    ],
  });

  // ── Data queries ──────────────────────────────────────────────────────────

  const stockQ = useQuery({
    queryKey: ["stock", "report", stockWarehouseId],
    queryFn: () => getStockReport(stockWarehouseId || undefined),
  });

  const movementsQ = useQuery({
    queryKey: ["movements", "report", { page: movPage, limit: movLimit, ...appliedFilters }],
    queryFn: () => getMovementsReport({
      page: movPage, limit: movLimit,
      warehouseId: appliedFilters.warehouseId || undefined,
      productId:   appliedFilters.productId   || undefined,
      type:        appliedFilters.type        || undefined,
      dateFrom:    appliedFilters.dateFrom    || undefined,
      dateTo:      appliedFilters.dateTo      || undefined,
      search:      appliedFilters.search.trim() || undefined,
    }),
    placeholderData: (prev) => prev,
  });

  const lotsQ = useQuery({
    queryKey: ["lots", "search", lotApplied],
    queryFn:  () => listLots(lotApplied?.product || undefined, lotApplied?.sap || undefined),
    enabled:  lotApplied !== null,
  });

  const entQ = useQuery({
    queryKey: ["movements", "entradas", { page: entPage, limit: entLimit, ...entApplied }],
    queryFn:  () => getMovements({
      type: "ENTRY", page: entPage, limit: entLimit,
      productId: entApplied.productId || undefined,
      dateFrom:  entApplied.dateFrom  || undefined,
      dateTo:    entApplied.dateTo    || undefined,
    }),
    enabled:  activeTab === "entradas",
    placeholderData: (prev) => prev,
  });

  const salQ = useQuery({
    queryKey: ["movements", "salidas", { page: salPage, limit: salLimit, ...salApplied }],
    queryFn:  () => getMovements({
      type: "EXIT", page: salPage, limit: salLimit,
      productId: salApplied.productId || undefined,
      dateFrom:  salApplied.dateFrom  || undefined,
      dateTo:    salApplied.dateTo    || undefined,
    }),
    enabled:  activeTab === "salidas",
    placeholderData: (prev) => prev,
  });

  const dailyQ = useQuery({
    queryKey: ["daily", "stock", dailyDateFrom, dailyDateTo],
    queryFn:  () => getDailyStockReport({ dateFrom: dailyDateFrom, dateTo: dailyDateTo }),
  });

  const traceQ = useQuery({
    queryKey: ["trace", traceApplied],
    queryFn:  () => getTraceReport(traceApplied),
    enabled:  !!traceApplied,
    staleTime: 30_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const regularizeMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof regularizeMovement>[1] }) =>
      regularizeMovement(id, payload),
    onSuccess: () => {
      toast.success("Movimiento regularizado.");
      setRegModal(null);
      setRegForm(emptyReg);
      setRegError("");
      void qc.invalidateQueries({ queryKey: ["movements"] });
      void qc.invalidateQueries({ queryKey: ["kpis"] });
    },
    onError: (err) => setRegError(getFriendlyApiError(err)),
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const warehouses   = warehousesQ.data ?? [];
  const products     = productsQ.data  ?? [];
  const stock        = stockQ.data     ?? null;
  const movements    = movementsQ.data?.data ?? [];
  const movMeta      = movementsQ.data?.meta ?? { page: movPage, limit: movLimit, total: 0, totalPages: 1 };
  const lotResults   = lotsQ.data ?? [];
  const entries      = entQ.data?.data ?? [];
  const entMeta      = entQ.data?.meta ?? { page: entPage, limit: entLimit, total: 0, totalPages: 1 };
  const salMovements = salQ.data?.data ?? [];
  const salMeta      = salQ.data?.meta ?? { page: salPage, limit: salLimit, total: 0, totalPages: 1 };
  const dailyStock   = dailyQ.data ?? [];
  const traceResult  = traceQ.data ?? null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "stock",        label: "Stock actual"  },
    { key: "movimientos",  label: "Historial"     },
    { key: "lotes",        label: "Lotes & SAP"   },
    { key: "entradas",     label: "Entradas"      },
    { key: "diario",       label: "Control diario"},
    { key: "salidas",      label: "Salidas"       },
    { key: "trazabilidad", label: "Trazabilidad"  },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  function applyDatePreset(preset: string) {
    setDatePreset(preset);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = fmt(now);
    if (preset === "hoy") {
      setFilters((p) => ({ ...p, dateFrom: today, dateTo: today }));
    } else if (preset === "ayer") {
      const ayer = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      setFilters((p) => ({ ...p, dateFrom: ayer, dateTo: ayer }));
    } else if (preset === "semana") {
      const dow = now.getDay();
      const lunes = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((dow + 6) % 7)));
      setFilters((p) => ({ ...p, dateFrom: lunes, dateTo: today }));
    } else if (preset === "mes") {
      const primeroDeMes = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      setFilters((p) => ({ ...p, dateFrom: primeroDeMes, dateTo: today }));
    } else if (preset === "30dias") {
      const hace30 = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
      setFilters((p) => ({ ...p, dateFrom: hace30, dateTo: today }));
    } else if (preset === "todo") {
      setFilters((p) => ({ ...p, dateFrom: "", dateTo: "" }));
    }
  }

  function applyDailyDatePreset(preset: string) {
    setDailyDatePreset(preset);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const t = fmt(now);
    if (preset === "hoy")    { setDailyDateFrom(t); setDailyDateTo(t); }
    else if (preset === "ayer") { const d = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)); setDailyDateFrom(d); setDailyDateTo(d); }
    else if (preset === "semana") { setDailyDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)))); setDailyDateTo(t); }
    else if (preset === "mes")   { setDailyDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setDailyDateTo(t); }
    else if (preset === "30dias"){ setDailyDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30))); setDailyDateTo(t); }
  }

  function applyEntDatePreset(preset: string) {
    setEntDatePreset(preset);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = fmt(now);
    if (preset === "hoy")    { setEntDateFrom(today); setEntDateTo(today); }
    else if (preset === "ayer") { const d = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)); setEntDateFrom(d); setEntDateTo(d); }
    else if (preset === "semana") { setEntDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)))); setEntDateTo(today); }
    else if (preset === "mes")   { setEntDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setEntDateTo(today); }
    else if (preset === "30dias"){ setEntDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30))); setEntDateTo(today); }
    else if (preset === "todo")  { setEntDateFrom(""); setEntDateTo(""); }
  }

  function applySalDatePreset(preset: string) {
    setSalDatePreset(preset);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = fmt(now);
    if (preset === "hoy")    { setSalDateFrom(today); setSalDateTo(today); }
    else if (preset === "ayer") { const d = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)); setSalDateFrom(d); setSalDateTo(d); }
    else if (preset === "semana") { setSalDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)))); setSalDateTo(today); }
    else if (preset === "mes")   { setSalDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setSalDateTo(today); }
    else if (preset === "30dias"){ setSalDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30))); setSalDateTo(today); }
    else if (preset === "todo")  { setSalDateFrom(""); setSalDateTo(""); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Reportes</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Stock real, trazabilidad, lotes SAP, pendientes de regularización y control diario.
        </p>
      </div>

      <div className="tabs" role="tablist" aria-label="Secciones de reportes">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`tab${activeTab === t.key ? " tab--active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Stock actual ── */}
      {activeTab === "stock" && (
        <section className="card" aria-label="Stock actual por depósito">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Stock actual por depósito</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                className="input"
                value={stockWarehouseId}
                onChange={(e) => setStockWarehouseId(e.target.value)}
                aria-label="Filtrar por depósito"
              >
                <option value="">Todos los depósitos</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {stock && (
                <>
                  <button
                    className="btn"
                    onClick={() => exportStockPDF(stock.items, `stock-${new Date().toISOString().slice(0, 10)}`)}
                    title="Exportar PDF"
                  >
                    📄 PDF
                  </button>
                  <button
                    className="btn"
                    onClick={() => void exportStockExcel(stock.items, `stock-${new Date().toISOString().slice(0, 10)}`)}
                    title="Exportar Excel"
                  >
                    📊 Excel
                  </button>
                </>
              )}
            </div>
          </div>

          {stockQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando...</p>}
          {stockQ.isError && (
            <div className="form-error" role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span>No se pudo cargar el stock.</span>
              <button className="btn btn--primary" onClick={() => stockQ.refetch()}>Reintentar</button>
            </div>
          )}

          {stock && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <span className="badge">Materiales: <strong>{stock.totalMaterials}</strong></span>
                <span className="badge">Posiciones: <strong>{stock.stockRows}</strong></span>
                <span className="badge">Cantidad total: <strong>{stock.totalQuantity.toLocaleString("es-AR")}</strong></span>
              </div>
              <DataTable
                data={stock.items}
                columns={STOCK_COLUMNS}
                enableSorting
                enableFiltering
                enableColumnVisibility
                enableExport
                exportFilename={`stock-${new Date().toISOString().slice(0, 10)}`}
                maxHeight={480}
                emptyMessage="Sin posiciones de stock"
                caption="Stock actual por depósito"
              />
            </>
          )}
        </section>
      )}

      {/* ── Tab: Historial de movimientos ── */}
      {activeTab === "movimientos" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Historial de movimientos</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select className="input" value={filters.warehouseId} aria-label="Depósito"
              onChange={(e) => setFilters((p) => ({ ...p, warehouseId: e.target.value }))}>
              <option value="">Todos los depósitos</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select className="input" value={filters.productId} aria-label="Material"
              onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}>
              <option value="">Todos los materiales</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
            <select className="input" value={filters.type} aria-label="Tipo de movimiento"
              onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value as MovementFilters["type"] }))}>
              <option value="">Todos los tipos</option>
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Salida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="ADJUSTMENT_IN">Ajuste entrada</option>
              <option value="ADJUSTMENT_OUT">Ajuste salida</option>
            </select>
            <select
              className="input"
              value={datePreset}
              aria-label="Período"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "personalizado") { setDatePreset("personalizado"); }
                else applyDatePreset(v);
              }}
            >
              <option value="">Período</option>
              <option value="hoy">Hoy</option>
              <option value="ayer">Ayer</option>
              <option value="semana">Esta semana</option>
              <option value="mes">Este mes</option>
              <option value="30dias">Últimos 30 días</option>
              <option value="todo">Todo</option>
              <option value="personalizado">Personalizado…</option>
            </select>
            {datePreset === "personalizado" && (
              <>
                <input className="input" type="date" value={filters.dateFrom} aria-label="Desde"
                  onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
                <input className="input" type="date" value={filters.dateTo} aria-label="Hasta"
                  onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
              </>
            )}
            <input className="input" placeholder="Buscar" value={filters.search} style={{ minWidth: 200 }} aria-label="Buscar"
              onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
            <button className="btn btn--primary" onClick={() => { setAppliedFilters(filters); setMovPage(1); }}>
              Buscar
            </button>
            <button className="btn" onClick={() => { setFilters(initialFilters); setAppliedFilters(initialFilters); setMovPage(1); setDatePreset(""); }}>
              Limpiar
            </button>
            {movements.length > 0 && (
              <>
                <button className="btn" onClick={() => exportMovementsPDF(movements, `movimientos-${new Date().toISOString().slice(0,10)}`)} title="Exportar PDF">
                  📄 PDF
                </button>
                <button className="btn" onClick={() => void exportMovementsExcel(movements, `movimientos-${new Date().toISOString().slice(0,10)}`)} title="Exportar Excel">
                  📊 Excel
                </button>
              </>
            )}
          </div>

          {movementsQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando...</p>}
          {movementsQ.isError && (
            <div className="form-error" role="alert">No se pudo cargar el historial.</div>
          )}

          {!movementsQ.isLoading && movements.length === 0 && !movementsQ.isError ? (
            <p style={{ color: "var(--muted)" }}>No hay registros</p>
          ) : movements.length > 0 && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Material</th><th scope="col">Cantidad</th>
                    <th scope="col">Ubicación</th><th scope="col">Lote</th><th scope="col">Pallets</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={`${m.id}-${m.date}`}>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{new Date(m.date).toLocaleString("es-AR")}</td>
                      <td><span className={MOVE_BADGE[m.type] ?? "badge"}>{MOVE_LABEL[m.type] ?? m.type}</span></td>
                      <td><strong>{m.material.code}</strong> · {m.material.description}</td>
                      <td>{m.quantity.toLocaleString("es-AR")}</td>
                      <td style={{ fontSize: 12 }}>
                        {m.type === "TRANSFER"
                          ? `${m.from?.locationCode ?? "-"} → ${m.to?.locationCode ?? "-"}`
                          : `${m.warehouse?.name ?? "-"} / ${m.location?.code ?? "-"}`}
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{m.lotCode ?? "-"}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12, textAlign: "right" }}>{m.pallets != null ? m.pallets : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                <button className="btn" disabled={movementsQ.isFetching || movMeta.page <= 1}
                  onClick={() => setMovPage((p) => p - 1)}>
                  Anterior
                </button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  Página {movMeta.page} de {movMeta.totalPages}
                  {" · "}{movMeta.total} registros
                </span>
                <button className="btn" disabled={movementsQ.isFetching || movMeta.page >= movMeta.totalPages}
                  onClick={() => setMovPage((p) => p + 1)}>
                  Siguiente
                </button>
                <select className="input" value={movLimit} aria-label="Registros por página"
                  onChange={(e) => { setMovLimit(Number(e.target.value)); setMovPage(1); }}>
                  <option value={10}>10 / pág.</option>
                  <option value={20}>20 / pág.</option>
                  <option value={50}>50 / pág.</option>
                </select>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Tab: Lotes & SAP ── */}
      {activeTab === "lotes" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Consulta de lotes por código SAP</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
            Buscá lotes por su código SAP (ej. <code>Z051308201</code>) o filtrá por material.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input
              className="input"
              placeholder="Lote SAP (ej. Z051308201)"
              value={lotSapSearch}
              onChange={(e) => setLotSapSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setLotApplied({ sap: lotSapSearch.trim(), product: lotProductSearch })}
              style={{ minWidth: 220, fontFamily: "monospace" }}
              aria-label="Código lote SAP"
            />
            <select
              className="input"
              value={lotProductSearch}
              onChange={(e) => setLotProductSearch(e.target.value)}
              aria-label="Material"
            >
              <option value="">Todos los materiales</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
            </select>
            <button className="btn btn--primary"
              onClick={() => setLotApplied({ sap: lotSapSearch.trim(), product: lotProductSearch })}>
              Buscar
            </button>
            <button className="btn" onClick={() => { setLotSapSearch(""); setLotProductSearch(""); setLotApplied(null); }}>
              Limpiar
            </button>
            {lotResults.length > 0 && (
              <>
                <button className="btn" onClick={() => exportLotesPDF(lotResults, `lotes-${new Date().toISOString().slice(0,10)}`)} title="Exportar PDF">📄 PDF</button>
                <button className="btn" onClick={() => void exportLotesExcel(lotResults, `lotes-${new Date().toISOString().slice(0,10)}`)} title="Exportar Excel">📊 Excel</button>
              </>
            )}
          </div>

          {lotsQ.isError && (
            <p className="form-error" role="alert" style={{ fontSize: 13 }}>
              {getFriendlyApiError(lotsQ.error)}
            </p>
          )}
          {!lotApplied && (
            <p style={{ color: "var(--muted)" }}>Ingresá un lote SAP o seleccioná un material y presioná Buscar.</p>
          )}
          {lotsQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Buscando...</p>}
          {lotApplied && !lotsQ.isLoading && lotResults.length === 0 && !lotsQ.isError && (
            <p style={{ color: "var(--muted)" }}>No se encontraron lotes con esos criterios.</p>
          )}
          {lotResults.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Código lote</th><th scope="col">Lote SAP</th><th scope="col">Material</th>
                  <th scope="col">Vencimiento</th><th scope="col">Fabricación</th><th scope="col">Proveedor lote</th>
                  <th scope="col">Stock</th><th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {lotResults.map((lot) => (
                  <tr key={lot.id} style={lot.status === "PENDING_REGULARIZATION" ? { background: "var(--badge-adjout-bg)" } : {}}>
                    <td><strong>{lot.lotCode}</strong></td>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>
                      {lot.sapLot ?? <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td>
                      {lot.product
                        ? <><strong>{lot.product.code}</strong> · {lot.product.description}</>
                        : <span style={{ color: "var(--muted)", fontSize: 12 }}>{lot.productId}</span>}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {lot.fechaVencimiento ? new Date(lot.fechaVencimiento).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {lot.fechaFabricacion ? new Date(lot.fechaFabricacion).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>{lot.proveedor ?? "—"}</td>
                    <td><strong>{lot.stockActual.toLocaleString("es-AR")}</strong></td>
                    <td>
                      {lot.status === "PENDING_REGULARIZATION"
                        ? <span className="badge badge--adj-out">Pendiente</span>
                        : <span className="badge">Normal</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Tab: Entradas ── */}
      {activeTab === "entradas" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Reporte de entradas</h3>

          {/* Filtros */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select className="input" value={entProductId} aria-label="Material"
              onChange={(e) => setEntProductId(e.target.value)}>
              <option value="">Todos los materiales</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
            </select>
            <select className="input" value={entDatePreset} aria-label="Período"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "personalizado") setEntDatePreset("personalizado");
                else applyEntDatePreset(v);
              }}>
              <option value="">Período</option>
              <option value="hoy">Hoy</option>
              <option value="ayer">Ayer</option>
              <option value="semana">Esta semana</option>
              <option value="mes">Este mes</option>
              <option value="30dias">Últimos 30 días</option>
              <option value="todo">Todo</option>
              <option value="personalizado">Personalizado…</option>
            </select>
            {entDatePreset === "personalizado" && (
              <>
                <input className="input" type="date" value={entDateFrom} aria-label="Desde"
                  onChange={(e) => setEntDateFrom(e.target.value)} />
                <input className="input" type="date" value={entDateTo} aria-label="Hasta"
                  onChange={(e) => setEntDateTo(e.target.value)} />
              </>
            )}
            <button className="btn btn--primary" onClick={() => {
              setEntApplied({ productId: entProductId, dateFrom: entDateFrom, dateTo: entDateTo });
              setEntPage(1);
            }}>Buscar</button>
            <button className="btn" onClick={() => {
              setEntProductId(""); setEntDateFrom(""); setEntDateTo(""); setEntDatePreset("");
              setEntApplied({ productId: "", dateFrom: "", dateTo: "" });
              setEntPage(1);
            }}>Limpiar</button>
            {entries.length > 0 && (
              <>
                <button className="btn" onClick={() => exportEntradasPDF(entries, `entradas-${new Date().toISOString().slice(0,10)}`)} title="Exportar PDF">📄 PDF</button>
                <button className="btn" onClick={() => void exportEntradasExcel(entries, `entradas-${new Date().toISOString().slice(0,10)}`)} title="Exportar Excel">📊 Excel</button>
              </>
            )}
          </div>

          {entQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando...</p>}
          {entQ.isError && <div className="form-error" role="alert">No se pudo cargar el reporte.</div>}

          {!entQ.isLoading && entries.length === 0 && !entQ.isError && (
            <p style={{ color: "var(--muted)" }}>No hay entradas para los filtros aplicados.</p>
          )}

          {entries.length > 0 && (
            <>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th scope="col">Fecha</th>
                      <th scope="col">Material</th>
                      <th scope="col">Lote</th>
                      <th scope="col">Lote SAP</th>
                      <th scope="col">N° Documento</th>
                      <th scope="col">Cantidad</th>
                      <th scope="col">Pallets</th>
                      <th scope="col">Depósito / Ubic.</th>
                      <th scope="col">Proveedor</th>
                      <th scope="col">Transportista</th>
                      <th scope="col">Chofer</th>
                      <th scope="col">Notas</th>
                      <th scope="col">Estado</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((m) => (
                      <tr key={m.id} style={m.status === "PENDING_REGULARIZATION" ? { background: "var(--badge-adjout-bg)" } : {}}>
                        <td style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                          {new Date(m.date).toLocaleString("es-AR")}
                        </td>
                        <td><strong>{m.material.code}</strong><span style={{ color: "var(--muted)", marginLeft: 4 }}>· {m.material.description}</span></td>
                        <td style={{ fontSize: 12 }}>{m.lotCode ?? "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{m.sapLot ?? "—"}</td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>{m.documentNumber ?? "—"}</td>
                        <td style={{ fontWeight: 600 }}>{m.quantity.toLocaleString("es-AR")} {m.material.unitOfMeasure ?? ""}</td>
                        <td style={{ textAlign: "center" }}>{m.pallets != null ? m.pallets : "—"}</td>
                        <td style={{ fontSize: 12 }}>
                          {m.warehouse?.name ?? "—"}{m.location?.code ? ` / ${m.location.code}` : ""}
                        </td>
                        <td style={{ fontSize: 12 }}>{m.supplier ?? "—"}</td>
                        <td style={{ fontSize: 12 }}>{m.carrier ?? "—"}</td>
                        <td style={{ fontSize: 12 }}>{m.driver ?? "—"}</td>
                        <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.notes ?? "—"}
                        </td>
                        <td>
                          {m.status === "PENDING_REGULARIZATION"
                            ? <span className="badge badge--adj-out">Pendiente</span>
                            : <span className="badge badge--entry">Normal</span>}
                        </td>
                        <td>
                          {m.status === "PENDING_REGULARIZATION" && (
                            <button
                              className="btn btn--primary"
                              style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
                              onClick={() => {
                                setRegModal({ id: m.id, label: `${m.material.code} · ${new Date(m.date).toLocaleDateString("es-AR")}` });
                                setRegForm(emptyReg);
                                setRegError("");
                              }}
                            >
                              Regularizar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                <button className="btn" disabled={entQ.isFetching || entMeta.page <= 1} onClick={() => setEntPage((p) => p - 1)}>Anterior</button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Página {entMeta.page} de {entMeta.totalPages} · {entMeta.total} registros</span>
                <button className="btn" disabled={entQ.isFetching || entMeta.page >= entMeta.totalPages} onClick={() => setEntPage((p) => p + 1)}>Siguiente</button>
                <select className="input" value={entLimit} aria-label="Registros por página"
                  onChange={(e) => { setEntLimit(Number(e.target.value)); setEntPage(1); }}>
                  <option value={10}>10 / pág.</option>
                  <option value={20}>20 / pág.</option>
                  <option value={50}>50 / pág.</option>
                </select>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Tab: Control diario ── */}
      {activeTab === "diario" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Control de stock</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select className="input" value={dailyDatePreset} aria-label="Período"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "personalizado") setDailyDatePreset("personalizado");
                  else applyDailyDatePreset(v);
                }}>
                <option value="hoy">Hoy</option>
                <option value="ayer">Ayer</option>
                <option value="semana">Esta semana</option>
                <option value="mes">Este mes</option>
                <option value="30dias">Últimos 30 días</option>
                <option value="personalizado">Personalizado…</option>
              </select>
              {dailyDatePreset === "personalizado" && (
                <>
                  <input className="input" type="date" value={dailyDateFrom} aria-label="Desde"
                    onChange={(e) => setDailyDateFrom(e.target.value)} />
                  <input className="input" type="date" value={dailyDateTo} aria-label="Hasta"
                    onChange={(e) => setDailyDateTo(e.target.value)} />
                </>
              )}
              {dailyStock.length > 0 && (
                <>
                  <button className="btn" onClick={() => {
                    const label = dailyDateFrom === dailyDateTo ? dailyDateFrom : `${dailyDateFrom} a ${dailyDateTo}`;
                    exportDailyStockPDF(dailyStock, label, `control-diario-${dailyDateFrom}`);
                  }} title="Exportar PDF">📄 PDF</button>
                  <button className="btn" onClick={() => {
                    const label = dailyDateFrom === dailyDateTo ? dailyDateFrom : `${dailyDateFrom} a ${dailyDateTo}`;
                    void exportDailyStockExcel(dailyStock, label, `control-diario-${dailyDateFrom}`);
                  }} title="Exportar Excel">📊 Excel</button>
                </>
              )}
            </div>
          </div>
          {dailyQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando...</p>}
          {!dailyQ.isLoading && dailyStock.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Sin registros para el período seleccionado.</p>
          ) : dailyStock.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Material</th>
                  <th scope="col">UM</th>
                  <th scope="col">Stock inicial</th>
                  <th scope="col">Entradas</th>
                  <th scope="col">Salidas</th>
                  <th scope="col">Stock final</th>
                </tr>
              </thead>
              <tbody>
                {dailyStock.map((row) => (
                  <tr key={`${row.date}-${row.material.id}`}>
                    <td><strong>{row.material.code}</strong> · {row.material.description}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{row.material.unitOfMeasure ?? "—"}</td>
                    <td>{row.stockInicial.toLocaleString("es-AR")}</td>
                    <td style={{ color: "var(--success)", fontWeight: row.entradas > 0 ? 700 : 400 }}>
                      {row.entradas > 0 ? `+${row.entradas.toLocaleString("es-AR")}` : "0"}
                    </td>
                    <td style={{ color: "var(--danger)", fontWeight: row.salidas > 0 ? 700 : 400 }}>
                      {row.salidas > 0 ? `-${row.salidas.toLocaleString("es-AR")}` : "0"}
                    </td>
                    <td style={{ fontWeight: 700 }}>{row.stockFinal.toLocaleString("es-AR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Tab: Salidas ── */}
      {activeTab === "salidas" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Reporte de salidas</h3>

          {/* Filtros */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select className="input" value={salProductId} aria-label="Material"
              onChange={(e) => setSalProductId(e.target.value)}>
              <option value="">Todos los materiales</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
            </select>
            <select className="input" value={salDatePreset} aria-label="Período"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "personalizado") setSalDatePreset("personalizado");
                else applySalDatePreset(v);
              }}>
              <option value="">Período</option>
              <option value="hoy">Hoy</option>
              <option value="ayer">Ayer</option>
              <option value="semana">Esta semana</option>
              <option value="mes">Este mes</option>
              <option value="30dias">Últimos 30 días</option>
              <option value="todo">Todo</option>
              <option value="personalizado">Personalizado…</option>
            </select>
            {salDatePreset === "personalizado" && (
              <>
                <input className="input" type="date" value={salDateFrom} aria-label="Desde"
                  onChange={(e) => setSalDateFrom(e.target.value)} />
                <input className="input" type="date" value={salDateTo} aria-label="Hasta"
                  onChange={(e) => setSalDateTo(e.target.value)} />
              </>
            )}
            <button className="btn btn--primary" onClick={() => {
              setSalApplied({ productId: salProductId, dateFrom: salDateFrom, dateTo: salDateTo });
              setSalPage(1);
            }}>Buscar</button>
            <button className="btn" onClick={() => {
              setSalProductId(""); setSalDateFrom(""); setSalDateTo(""); setSalDatePreset("");
              setSalApplied({ productId: "", dateFrom: "", dateTo: "" });
              setSalPage(1);
            }}>Limpiar</button>
            {salMovements.length > 0 && (
              <>
                <button className="btn" onClick={() => exportSalidasPDF(salMovements, `salidas-${new Date().toISOString().slice(0,10)}`)} title="Exportar PDF">📄 PDF</button>
                <button className="btn" onClick={() => void exportSalidasExcel(salMovements, `salidas-${new Date().toISOString().slice(0,10)}`)} title="Exportar Excel">📊 Excel</button>
              </>
            )}
          </div>

          {salQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando...</p>}
          {salQ.isError && <div className="form-error" role="alert">No se pudo cargar el reporte.</div>}

          {!salQ.isLoading && salMovements.length === 0 && !salQ.isError && (
            <p style={{ color: "var(--muted)" }}>No hay salidas para los filtros aplicados.</p>
          )}

          {salMovements.length > 0 && (
            <>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th scope="col">Fecha</th>
                      <th scope="col">Material</th>
                      <th scope="col">Lote</th>
                      <th scope="col">Lote SAP</th>
                      <th scope="col">Cantidad</th>
                      <th scope="col">Pallets</th>
                      <th scope="col">Desde</th>
                      <th scope="col">Destino</th>
                      <th scope="col">Transportista</th>
                      <th scope="col">Chofer</th>
                      <th scope="col">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salMovements.map((m) => (
                      <tr key={m.id}>
                        <td style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                          {new Date(m.date).toLocaleString("es-AR")}
                        </td>
                        <td><strong>{m.material.code}</strong><span style={{ color: "var(--muted)", marginLeft: 4 }}>· {m.material.description}</span></td>
                        <td style={{ fontSize: 12 }}>{m.lotCode ?? "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{m.sapLot ?? "—"}</td>
                        <td style={{ fontWeight: 600 }}>{m.quantity.toLocaleString("es-AR")} {m.material.unitOfMeasure ?? ""}</td>
                        <td style={{ textAlign: "center" }}>{m.pallets != null ? m.pallets : "—"}</td>
                        <td style={{ fontSize: 12 }}>
                          {m.warehouse?.name ?? m.from?.warehouseName ?? "—"}{(m.location?.code ?? m.from?.locationCode) ? ` / ${m.location?.code ?? m.from?.locationCode}` : ""}
                        </td>
                        <td style={{ fontSize: 12 }}>{m.destination ?? "—"}</td>
                        <td style={{ fontSize: 12 }}>{m.carrier ?? "—"}</td>
                        <td style={{ fontSize: 12 }}>{m.driver ?? "—"}</td>
                        <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                <button className="btn" disabled={salQ.isFetching || salMeta.page <= 1} onClick={() => setSalPage((p) => p - 1)}>Anterior</button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Página {salMeta.page} de {salMeta.totalPages} · {salMeta.total} registros</span>
                <button className="btn" disabled={salQ.isFetching || salMeta.page >= salMeta.totalPages} onClick={() => setSalPage((p) => p + 1)}>Siguiente</button>
                <select className="input" value={salLimit} aria-label="Registros por página"
                  onChange={(e) => { setSalLimit(Number(e.target.value)); setSalPage(1); }}>
                  <option value={10}>10 / pág.</option>
                  <option value={20}>20 / pág.</option>
                  <option value={50}>50 / pág.</option>
                </select>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Tab: Trazabilidad ── */}
      {activeTab === "trazabilidad" && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Trazabilidad por material</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <select
              className="input"
              value={traceMaterialId}
              onChange={(e) => setTraceMaterialId(e.target.value)}
              style={{ minWidth: 320 }}
              aria-label="Seleccionar material"
            >
              <option value="">Seleccionar material...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}
            </select>
            <button
              className="btn btn--primary"
              onClick={() => setTraceApplied(traceMaterialId)}
              disabled={!traceMaterialId}
            >
              Buscar trazabilidad
            </button>
            {traceResult && traceResult.history.length > 0 && (
              <>
                <button className="btn" onClick={() => exportTrazabilidadPDF(traceResult.material.code, traceResult.history, `trazabilidad-${traceResult.material.code}`)} title="Exportar PDF">📄 PDF</button>
                <button className="btn" onClick={() => void exportTrazabilidadExcel(traceResult.material.code, traceResult.history, `trazabilidad-${traceResult.material.code}`)} title="Exportar Excel">📊 Excel</button>
              </>
            )}
          </div>

          {traceQ.isError && (
            <p className="form-error" role="alert" style={{ fontSize: 13 }}>
              {getFriendlyApiError(traceQ.error)}
            </p>
          )}
          {traceQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Buscando...</p>}
          {!traceApplied && (
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              Seleccioná un material para ver su historial completo de movimientos.
            </p>
          )}
          {traceResult && traceResult.history.length === 0 && (
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>Sin registros para este material.</p>
          )}
          {traceResult && traceResult.history.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {traceResult.history.map((event) => (
                <div
                  key={event.movementId}
                  style={{
                    borderLeft: `3px solid ${
                      event.type === "ENTRY"    ? "var(--success)" :
                      event.type === "EXIT"     ? "var(--danger)"  :
                      event.type === "TRANSFER" ? "var(--primary)" :
                      "var(--border)"
                    }`,
                    paddingLeft: 14, paddingTop: 4, paddingBottom: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className={MOVE_BADGE[event.type] ?? "badge"}>
                      {MOVE_LABEL[event.type] ?? event.type}
                    </span>
                    <strong>{event.quantity.toLocaleString("es-AR")}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {new Date(event.at).toLocaleString("es-AR")}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                    {event.documentNumber && (
                      <span>Doc: <strong style={{ color: "var(--text)" }}>{event.documentNumber}</strong></span>
                    )}
                    <span>Origen: {event.fromWarehouseName || event.warehouseName || "-"} / {event.fromLocationCode || "-"}</span>
                    <span>Destino: {event.toWarehouseName || event.destination || event.warehouseName || "-"} / {event.toLocationCode || event.locationCode || "-"}</span>
                    {event.notes && <span>Notas: {event.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Regularization modal ── */}
      {regModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Regularizar movimiento"
          onClick={(e) => {
            if (e.target === e.currentTarget && !regularizeMut.isPending) {
              setRegModal(null); setRegForm(emptyReg); setRegError("");
            }
          }}
        >
          <div className="modal" style={{ maxWidth: 540 }}>
            <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Regularizar movimiento</h3>
            <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 20 }}>{regModal.label}</p>

            <div style={{
              background: "var(--badge-adjout-bg)",
              border: "1px solid var(--badge-adjout-border)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 12,
              color: "var(--badge-adjout-text)",
            }}>
              Solo se registran los campos que se modifiquen. Cada cambio queda en el log de auditoría.
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
                  Motivo de regularización <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Describir el motivo del cambio..."
                  value={regForm.reason}
                  onChange={(e) => setRegForm((p) => ({ ...p, reason: e.target.value }))}
                  style={{ resize: "vertical" }}
                  aria-required="true"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(
                  [
                    ["documentNumber",  "Nro. documento",   "text"],
                    ["supplier",        "Proveedor",        "text"],
                    ["carrier",         "Transportista",    "text"],
                    ["driver",          "Conductor",        "text"],
                    ["destination",     "Destino",          "text"],
                    ["sapLot",          "Lote SAP",         "text"],
                    ["fechaVencimiento","Fecha vencimiento","date"],
                    ["fechaFabricacion","Fecha fabricación","date"],
                  ] as [keyof RegPayload, string, string][]
                ).map(([field, label, type]) => (
                  <div key={field}>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>{label}</label>
                    <input
                      className="input"
                      type={type}
                      placeholder={field === "sapLot" ? "ej. Z051308201" : label}
                      value={regForm[field]}
                      onChange={(e) => setRegForm((p) => ({ ...p, [field]: e.target.value }))}
                      style={field === "sapLot" ? { fontFamily: "monospace" } : {}}
                    />
                  </div>
                ))}
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Proveedor del lote</label>
                <input className="input" placeholder="Proveedor del lote" value={regForm.proveedor}
                  onChange={(e) => setRegForm((p) => ({ ...p, proveedor: e.target.value }))} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 3 }}>Notas adicionales</label>
                <textarea className="input" rows={2} placeholder="Observaciones..." value={regForm.notes}
                  onChange={(e) => setRegForm((p) => ({ ...p, notes: e.target.value }))}
                  style={{ resize: "vertical" }} />
              </div>
            </div>

            {regError && (
              <p className="form-error" role="alert" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
                {regError}
              </p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button
                className="btn btn--primary"
                disabled={regularizeMut.isPending}
                onClick={() => {
                  if (!regModal) return;
                  if (!regForm.reason.trim()) { setRegError("El motivo es obligatorio."); return; }
                  setRegError("");
                  regularizeMut.mutate({
                    id: regModal.id,
                    payload: {
                      reason:           regForm.reason,
                      documentNumber:   regForm.documentNumber   || undefined,
                      supplier:         regForm.supplier         || undefined,
                      carrier:          regForm.carrier          || undefined,
                      driver:           regForm.driver           || undefined,
                      destination:      regForm.destination      || undefined,
                      notes:            regForm.notes            || undefined,
                      sapLot:           regForm.sapLot           || undefined,
                      fechaVencimiento: regForm.fechaVencimiento || undefined,
                      fechaFabricacion: regForm.fechaFabricacion || undefined,
                      proveedor:        regForm.proveedor        || undefined,
                    },
                  });
                }}
              >
                {regularizeMut.isPending ? "Guardando..." : "Confirmar regularización"}
              </button>
              <button
                className="btn"
                disabled={regularizeMut.isPending}
                onClick={() => { setRegModal(null); setRegForm(emptyReg); setRegError(""); }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
