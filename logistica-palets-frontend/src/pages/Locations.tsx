import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getLocationContent,
  getLocationIncidents,
  getLocationMap,
  searchStock,
  zoneMeta,
  ISSUE_META,
  type LocationIssue,
} from "../api/locations";
import { useActiveWarehouseId } from "../contexts/WarehouseContext";
import { getPalletHistory, quickTransferPallet } from "../api/pallets";
import LocationPicker from "../components/LocationPicker";
import WarehouseMap, { MapLegend } from "../components/WarehouseMap";
import { fmtQty } from "../utils/number";
import { useAuth } from "../auth/AuthContext";
import { canUpdate } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { daysUntil, fmtDate, fmtDateTime } from "../utils/dateFormat";

/* ── Vistas del localizador ────────────────────────────────────────────────
   1. Buscar inventario → ¿dónde está este material?
   2. Ubicaciones libres → ¿dónde tengo espacio disponible?
   3. Incidencias       → ¿qué está mal en el depósito?
   La administración de la estructura (crear / modificar / desactivar) vive en
   Depósitos y es exclusiva de ADMIN/MANAGER: acá no se toca. */
type ViewKey = "search" | "free" | "incidents";

const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: "search",    label: "Buscar inventario", hint: "Encontrá materiales, lotes y pallets" },
  { key: "free",      label: "Ubicaciones libres", hint: "Dónde guardar una nueva entrada" },
  { key: "incidents", label: "Incidencias",        hint: "Diferencias, sobrecapacidad y bloqueos" },
];


const PALLET_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Disponible",
  PARTIAL: "Parcial",
  BLOCKED: "Bloqueado",
  DAMAGED: "Dañado",
  IN_TRANSIT: "En tránsito",
};


/* ── KPI ────────────────────────────────────────────────────────────────── */

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: accent }}>{value}</div>
    </div>
  );
}

function IssueBadge({ issue }: { issue: LocationIssue }) {
  const meta = ISSUE_META[issue];
  return (
    <span
      className="badge"
      title={meta.hint}
      style={{ fontSize: 10, background: "rgba(234,179,8,0.16)", color: "#eab308", border: "1px solid rgba(234,179,8,0.45)" }}
    >
      {meta.label}
    </span>
  );
}

/* ── Panel lateral: contenido de una ubicación ──────────────────────────── */

function LocationDrawer({
  locationId,
  onClose,
  onTransferred,
}: {
  locationId: string;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const { user } = useAuth();
  const allowTransfer = user?.role ? canUpdate("pallets", user.role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tracePalletId, setTracePalletId] = useState<string | null>(null);
  const [transferPalletId, setTransferPalletId] = useState<string | null>(null);
  const [destination, setDestination] = useState("");

  const contentQ = useQuery({
    queryKey: ["locations", "content", locationId],
    queryFn: () => getLocationContent(locationId),
    staleTime: 10_000,
  });

  const historyQ = useQuery({
    queryKey: ["pallets", tracePalletId, "history"],
    queryFn: () => getPalletHistory(tracePalletId!),
    enabled: !!tracePalletId,
    staleTime: 30_000,
  });

  const transferMut = useMutation({
    mutationFn: ({ palletId, toLocationId }: { palletId: string; toLocationId: string }) =>
      quickTransferPallet(palletId, toLocationId),
    onSuccess: () => {
      toast.success("Pallet transferido");
      setTransferPalletId(null);
      setDestination("");
      onTransferred();
      void contentQ.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pallets"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
      void queryClient.invalidateQueries({ queryKey: ["locations", "availability"] });
      void queryClient.invalidateQueries({ queryKey: ["locations", "recommendations"] });
      void queryClient.invalidateQueries({ queryKey: ["locations", "map"] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const data = contentQ.data;
  const loc = data?.location;
  const occ = data?.occupancy;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }} onClick={onClose} role="presentation">
      <div style={{ flex: 1, background: "rgba(0,0,0,0.45)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de la ubicación"
        style={{
          width: "min(520px, 100vw)", background: "var(--bg-base)", display: "flex",
          flexDirection: "column", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>
              {loc?.code ?? "…"}
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
              {zoneMeta(loc?.zone) ? `${zoneMeta(loc?.zone)!.label}` : "Sin zona"}
              {loc?.aisle && <> · Sector {loc.aisle}</>}
              {loc?.rack && <> · {loc.rack}</>}
              {loc?.warehouseName && <> · {loc.warehouseName}</>}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
        </div>

        <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>
          {contentQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 13 }} aria-busy="true">Cargando contenido…</p>}
          {contentQ.isError && (
            <div role="alert" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar la ubicación.</p>
              <button className="btn btn--primary" onClick={() => contentQ.refetch()}>Reintentar</button>
            </div>
          )}

          {data && occ && loc && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                <Kpi label="Estado" value={loc.active ? "Activa" : "Inactiva"} accent={loc.active ? "var(--success)" : "var(--danger)"} />
                <Kpi label="Bases" value={occ.basesCapacity != null ? `${occ.basesUsed} / ${occ.basesCapacity}` : `${occ.basesUsed}`} />
                <Kpi label="Pallets" value={occ.pallets} />
                <Kpi label="Unidades" value={fmtQty(occ.units)} />
              </div>

              {occ.mismatch !== 0 && (
                <div
                  role="alert"
                  style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.45)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}
                >
                  <strong>Diferencia de stock:</strong> los pallets suman {fmtQty(occ.units)} unid. pero el stock
                  registrado es {fmtQty(occ.stockUnits)} unid. ({occ.mismatch > 0 ? "+" : ""}{fmtQty(occ.mismatch)}).
                </div>
              )}

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
                  Contenido ({data.pallets.length} pallet{data.pallets.length !== 1 ? "s" : ""} en {data.piles.length} pila{data.piles.length !== 1 ? "s" : ""})
                </div>
                {data.pallets.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>Ubicación libre — sin pallets.</p>
                ) : (
                  <div style={{ display: "grid", gap: 14 }}>
                    {data.piles.map((pile) => (
                      <div key={pile.pilaId ?? "sin-pila"} style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                          {pile.sequence != null ? `Pila ${String(pile.sequence).padStart(2, "0")}` : "Sin pila asignada"}
                          <span style={{ fontWeight: 400 }}>· {pile.pallets.length} nivel{pile.pallets.length !== 1 ? "es" : ""}</span>
                        </div>
                        {[...pile.pallets].sort((a, b) => (a.stackPosition ?? 0) - (b.stackPosition ?? 0)).map((p) => {
                      const dLeft = daysUntil(p.fechaVencimiento);
                      const expiryColor =
                        dLeft == null ? undefined : dLeft < 0 ? "var(--danger)" : dLeft <= 30 ? "var(--warning)" : undefined;
                      return (
                        <div key={p.palletId} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "var(--bg)" }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                            <strong style={{ fontSize: 13 }}>{p.productCode}</strong>
                            <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 100 }}>{p.productDescription}</span>
                            <strong style={{ fontSize: 14 }}>
                              {fmtQty(p.quantity)} {p.unitOfMeasure ?? ""}
                            </strong>
                          </div>
                          <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", margin: "8px 0 0", fontSize: 11 }}>
                            <div><dt style={{ display: "inline", color: "var(--muted)" }}>Lote: </dt><dd style={{ display: "inline", margin: 0, fontFamily: "monospace" }}>{p.lotCode}</dd></div>
                            <div><dt style={{ display: "inline", color: "var(--muted)" }}>Lote proveedor: </dt><dd style={{ display: "inline", margin: 0, fontFamily: "monospace" }}>{p.supplierLot ?? "—"}</dd></div>
                            <div><dt style={{ display: "inline", color: "var(--muted)" }}>Pallet: </dt><dd style={{ display: "inline", margin: 0, fontFamily: "monospace" }}>{p.palletCode}</dd></div>
                            <div>
                              <dt style={{ display: "inline", color: "var(--muted)" }}>Vencimiento: </dt>
                              <dd style={{ display: "inline", margin: 0, color: expiryColor, fontWeight: expiryColor ? 800 : 400 }}>
                                {fmtDate(p.fechaVencimiento)}
                                {dLeft != null && dLeft < 0 ? " (vencido)" : dLeft != null && dLeft <= 30 ? ` (${dLeft} d)` : ""}
                              </dd>
                            </div>
                          </dl>

                          {p.palletStatus !== "AVAILABLE" && (
                            <div style={{ marginTop: 6 }}>
                              <span className="badge" style={{ fontSize: 10 }}>{PALLET_STATUS_LABEL[p.palletStatus] ?? p.palletStatus}</span>
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: "3px 10px" }}
                              onClick={() => setTracePalletId(tracePalletId === p.palletId ? null : p.palletId)}
                            >
                              {tracePalletId === p.palletId ? "Ocultar trazabilidad" : "Ver trazabilidad"}
                            </button>
                            {allowTransfer && (
                              <button
                                className="btn"
                                style={{ fontSize: 11, padding: "3px 10px" }}
                                onClick={() => {
                                  setTransferPalletId(transferPalletId === p.palletId ? null : p.palletId);
                                  setDestination("");
                                }}
                              >
                                Transferir
                              </button>
                            )}
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: "3px 10px" }}
                              disabled={!p.entryDocumentId}
                              title={p.entryDocumentId ? "Reimprimir la etiqueta de este pallet" : "Sin documento de entrada asociado"}
                              onClick={() => window.open(`/print/labels/${p.entryDocumentId}?pallet=${p.palletId}`, "_blank")}
                            >
                              Imprimir etiqueta
                            </button>
                          </div>

                          {transferPalletId === p.palletId && (
                            <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 10, display: "grid", gap: 8 }}>
                              <LocationPicker
                                value={destination}
                                onChange={setDestination}
                                excludeUnavailable
                                productId={p.productId}
                                excludeLocationId={locationId}
                                placeholder="Ubicación destino"
                              />
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  className="btn btn--primary"
                                  style={{ fontSize: 12 }}
                                  disabled={!destination || destination === locationId || transferMut.isPending}
                                  onClick={() => transferMut.mutate({ palletId: p.palletId, toLocationId: destination })}
                                >
                                  {transferMut.isPending ? "Transfiriendo…" : "Confirmar transferencia"}
                                </button>
                                <button className="btn" style={{ fontSize: 12 }} onClick={() => setTransferPalletId(null)}>Cancelar</button>
                              </div>
                            </div>
                          )}

                          {tracePalletId === p.palletId && (
                            <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
                              {historyQ.isLoading ? (
                                <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Cargando movimientos…</p>
                              ) : (historyQ.data?.history ?? []).length === 0 ? (
                                <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Sin movimientos registrados.</p>
                              ) : (
                                <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                                  {(historyQ.data?.history ?? []).map((h) => {
                                    const voided = h.voidStatus === "VOIDED";
                                    return (
                                      <li key={h.movementId} style={{ fontSize: 11, display: "flex", gap: 8, alignItems: "baseline", opacity: voided ? 0.6 : 1 }}>
                                        <span style={{ color: "var(--muted)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                                          {fmtDateTime(h.createdAt ?? h.date)}
                                        </span>
                                        <span style={{ fontWeight: 700 }}>{h.type}</span>
                                        <span style={{ color: "var(--muted)", textDecoration: voided ? "line-through" : undefined }}>
                                          {fmtQty(h.quantity)} unid.
                                          {h.from?.locationCode && ` · desde ${h.from.locationCode}`}
                                          {h.to?.locationCode && ` · hacia ${h.to.locationCode}`}
                                          {h.documentNumber && ` · doc. ${h.documentNumber}`}
                                        </span>
                                        {voided && (
                                          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>· Anulado</span>
                                        )}
                                        {h.voidStatus === "VOID_PENDING" && (
                                          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--warning)" }}>· Anulación pendiente</span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ol>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Página ─────────────────────────────────────────────────────────────── */

export default function LocationsPage() {
  const queryClient = useQueryClient();

  const [view, setView] = useState<ViewKey>("search");
  const [term, setTerm] = useState("");
  const [submittedTerm, setSubmittedTerm] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState("ALL");
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // El mapa, la ocupación y las incidencias son SIEMPRE del depósito activo:
  // no hay selector local. Cambiar de depósito reemplaza el mapa completo.
  const activeWarehouseId = useActiveWarehouseId();
  const warehouseId = activeWarehouseId ?? "";

  const mapQ = useQuery({
    queryKey: ["locations", "map", warehouseId],
    queryFn: () => getLocationMap(warehouseId),
    enabled: !!warehouseId,
    staleTime: 15_000,
  });

  const searchQ = useQuery({
    queryKey: ["locations", "stock-search", warehouseId, submittedTerm],
    queryFn: () => searchStock(submittedTerm, warehouseId),
    enabled: submittedTerm.trim().length >= 2 && !!warehouseId,
    staleTime: 10_000,
  });

  const incidentsQ = useQuery({
    queryKey: ["locations", "incidents", warehouseId],
    queryFn: () => getLocationIncidents(warehouseId),
    enabled: view === "incidents" && !!warehouseId,
    staleTime: 15_000,
  });

  const cells = useMemo(() => mapQ.data?.locations ?? [], [mapQ.data]);
  const summary = mapQ.data?.summary;

  /** Material seleccionado dentro de los resultados (o el primero por defecto). */
  const activeProduct = useMemo(() => {
    const products = searchQ.data?.products ?? [];
    if (products.length === 0) return null;
    return products.find((p) => p.productId === selectedProductId) ?? products[0];
  }, [searchQ.data, selectedProductId]);

  /** Filas del material activo — alimentan el resaltado del mapa y el listado. */
  const activeRows = useMemo(() => {
    const rows = searchQ.data?.rows ?? [];
    if (!activeProduct) return rows;
    return rows.filter((r) => r.productId === activeProduct.productId);
  }, [searchQ.data, activeProduct]);

  const highlight = useMemo(() => {
    if (view !== "search" || !searchQ.data) return null;
    return new Set(activeRows.map((r) => r.locationId).filter((id): id is string => !!id));
  }, [view, searchQ.data, activeRows]);

  /** Cantidad del material activo por ubicación: es lo que se pinta en la celda. */
  const highlightQty = useMemo(() => {
    const map = new Map<string, number>();
    if (view !== "search" || !searchQ.data) return map;
    for (const r of activeRows) {
      if (!r.locationId) continue;
      map.set(r.locationId, (map.get(r.locationId) ?? 0) + r.quantity);
    }
    return map;
  }, [view, searchQ.data, activeRows]);

  /** Ubicaciones sin ubicar: pallets del material que no están en ningún hueco. */
  const unlocatedRows = useMemo(() => activeRows.filter((r) => !r.locationId), [activeRows]);

  const zoneFiltered = useMemo(() => {
    if (zoneFilter === "ALL") return cells;
    return cells.filter((c) => (c.zone ?? "SIN_ZONA") === zoneFilter);
  }, [cells, zoneFilter]);

  /** Vista "Ubicaciones libres": solo sectores activos con bases disponibles. */
  const freeCells = useMemo(
    () => zoneFiltered.filter((c) => c.active && (c.state === "FREE" || (c.capacityBases != null && c.basesUsed < c.capacityBases))),
    [zoneFiltered],
  );

  const incidentCells = incidentsQ.data?.locations ?? [];

  function refreshAfterMutation() {
    void queryClient.invalidateQueries({ queryKey: ["locations", "map"] });
    void queryClient.invalidateQueries({ queryKey: ["locations", "stock-search"] });
    void queryClient.invalidateQueries({ queryKey: ["locations", "incidents"] });
    void queryClient.invalidateQueries({ queryKey: ["warehouse-layout"] });
    void queryClient.invalidateQueries({ queryKey: ["locations", "availability"] });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSelectedProductId(null);
    setSubmittedTerm(term.trim());
    setView("search");
  }

  const searchIsEmpty =
    searchQ.data && searchQ.data.rows.length === 0;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Localizador de stock</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          ¿Dónde está este material? ¿Qué contiene esta ubicación? ¿Dónde tengo espacio disponible?
        </p>
      </div>

      {/* ── Buscador + depósito ── */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }} aria-label="Buscar inventario">
        <input
          className="input"
          style={{ flex: 1, minWidth: 260 }}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Material, descripción, lote interno, lote proveedor, pallet o ubicación"
          aria-label="Buscar material, lote, pallet o ubicación"
        />
        
        <button className="btn btn--primary" type="submit" disabled={term.trim().length < 2}>Buscar</button>
        {submittedTerm && (
          <button
            type="button"
            className="btn"
            onClick={() => { setTerm(""); setSubmittedTerm(""); setSelectedProductId(null); }}
          >
            Limpiar
          </button>
        )}
      </form>

      {/* ── Vistas ── */}
      <div role="tablist" aria-label="Vistas del localizador" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            type="button"
            aria-selected={view === v.key}
            title={v.hint}
            className="btn"
            onClick={() => setView(v.key)}
            style={{
              fontSize: 13, padding: "5px 14px",
              background: view === v.key ? "var(--primary)" : undefined,
              color: view === v.key ? "#fff" : undefined,
            }}
          >
            {v.label}
            {v.key === "incidents" && incidentsQ.data
              ? ` (${incidentsQ.data.summary.locations + incidentsQ.data.summary.palletsWithoutLocation + incidentsQ.data.summary.stockWithoutLocation})`
              : ""}
          </button>
        ))}
      </div>

      {!warehouseId && (
        <p style={{ color: "var(--muted)" }} aria-busy="true">Resolviendo depósito activo…</p>
      )}

      {mapQ.isError && (
        <div role="alert" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar el mapa del depósito.</p>
          <button className="btn btn--primary" onClick={() => mapQ.refetch()}>Reintentar</button>
        </div>
      )}

      {/* ══ Vista 1: Buscar inventario ══ */}
      {view === "search" && (
        <div style={{ display: "grid", gap: 14 }}>
          {!submittedTerm && (
            <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>
              Buscá por <strong>código o descripción del material</strong>, <strong>lote interno</strong>,{" "}
              <strong>lote del proveedor</strong>, <strong>código de pallet</strong> o <strong>código de ubicación</strong>.
              El mapa de abajo resalta únicamente las ubicaciones donde está lo que buscaste.
            </div>
          )}

          {searchQ.isLoading && <p style={{ color: "var(--muted)" }} aria-busy="true">Buscando…</p>}
          {searchQ.isError && (
            <div role="alert" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <p className="form-error" style={{ marginBottom: 0 }}>{getFriendlyApiError(searchQ.error)}</p>
              <button className="btn btn--primary" onClick={() => searchQ.refetch()}>Reintentar</button>
            </div>
          )}

          {searchIsEmpty && (
            <div className="card">
              <p style={{ margin: 0, fontSize: 14 }}>
                Sin stock vigente para <strong>{searchQ.data!.query}</strong> en este depósito.
              </p>
              {searchQ.data!.emptyProducts.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
                    Materiales del catálogo que coinciden
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    {searchQ.data!.emptyProducts.map((p) => (
                      <div key={p.id} style={{ fontSize: 13 }}>
                        <strong style={{ fontFamily: "monospace" }}>{p.code}</strong> — {p.description}
                        <span style={{ color: "var(--muted)" }}> · sin stock</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {searchQ.data && searchQ.data.rows.length > 0 && activeProduct && (
            <>
              {/* Materiales encontrados (si hay más de uno, se elige cuál resaltar) */}
              {searchQ.data.products.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {searchQ.data.products.map((p) => (
                    <button
                      key={p.productId}
                      type="button"
                      className="btn"
                      onClick={() => setSelectedProductId(p.productId)}
                      style={{
                        fontSize: 12, padding: "4px 12px",
                        background: p.productId === activeProduct.productId ? "var(--primary)" : undefined,
                        color: p.productId === activeProduct.productId ? "#fff" : undefined,
                      }}
                    >
                      {p.productCode} · {fmtQty(p.quantity)} {p.unitOfMeasure ?? ""}
                    </button>
                  ))}
                </div>
              )}

              <div className="card">
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 2 }}>
                  Material {activeProduct.productCode} — {activeProduct.productDescription}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                  {activeProduct.lots} lote{activeProduct.lots !== 1 ? "s" : ""} ·{" "}
                  {activeProduct.pallets} pallet{activeProduct.pallets !== 1 ? "s" : ""} ·{" "}
                  {activeProduct.locations} ubicación{activeProduct.locations !== 1 ? "es" : ""}
                  {activeProduct.unlocatedPallets > 0 && (
                    <> · <span style={{ color: "var(--warning)", fontWeight: 700 }}>{activeProduct.unlocatedPallets} sin ubicar</span></>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                  <Kpi label="Stock total" value={`${fmtQty(activeProduct.quantity)} ${activeProduct.unitOfMeasure ?? ""}`} />
                  <Kpi label="Lotes" value={activeProduct.lots} />
                  <Kpi label="Pallets" value={activeProduct.pallets} />
                  <Kpi label="Ubicaciones" value={activeProduct.locations} />
                </div>
              </div>

              {searchQ.data.truncated && (
                <p style={{ fontSize: 12, color: "var(--warning)", margin: 0 }}>
                  La búsqueda devolvió demasiados resultados y fue recortada. Afiná el criterio.
                </p>
              )}

              {/* Detalle por ubicación */}
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="table" aria-label="Detalle del stock encontrado">
                  <thead>
                    <tr>
                      <th scope="col">Ubicación</th>
                      <th scope="col">Lote</th>
                      <th scope="col">Lote proveedor</th>
                      <th scope="col">Vencimiento</th>
                      <th scope="col">Pallet</th>
                      <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((r) => {
                      const dLeft = daysUntil(r.fechaVencimiento);
                      return (
                        <tr key={r.palletId}>
                          <td>
                            {r.locationId ? (
                              <button
                                className="btn"
                                style={{ fontSize: 12, padding: "2px 8px", fontFamily: "monospace" }}
                                onClick={() => setDrawerId(r.locationId!)}
                              >
                                {r.locationCode}
                              </button>
                            ) : (
                              <span style={{ color: "var(--warning)", fontWeight: 700, fontSize: 12 }}>Sin ubicación</span>
                            )}
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.lotCode}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.supplierLot ?? "—"}</td>
                          <td style={{ fontSize: 12, color: dLeft != null && dLeft < 0 ? "var(--danger)" : dLeft != null && dLeft <= 30 ? "var(--warning)" : undefined }}>
                            {fmtDate(r.fechaVencimiento)}
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.palletCode}</td>
                          <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtQty(r.quantity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {unlocatedRows.length > 0 && (
                <p style={{ fontSize: 12, color: "var(--warning)", margin: 0 }}>
                  {unlocatedRows.length} pallet(s) de este material no tienen ubicación asignada — revisalos en Incidencias.
                </p>
              )}
            </>
          )}

          {/* Mapa */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                Mapa del depósito
                {highlight && <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 13 }}> — {highlight.size} ubicación(es) resaltada(s)</span>}
              </h3>
            </div>
            <MapLegend states={["FREE", "OCCUPIED", "FULL", "EXPIRING", "PROVISIONAL", "INCIDENT", "INACTIVE"]} />
            {mapQ.isLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }} aria-busy="true">Cargando mapa…</p>
            ) : (
              <WarehouseMap
                cells={cells}
                highlight={highlight}
                highlightQty={highlightQty}
                selectedId={drawerId}
                onSelect={(c) => setDrawerId(c.id)}
                emptyMessage="Este depósito todavía no tiene ubicaciones. Generá la estructura desde Depósitos."
              />
            )}
          </div>
        </div>
      )}

      {/* ══ Vista 2: Ubicaciones libres ══ */}
      {view === "free" && (
        <div style={{ display: "grid", gap: 14 }}>
          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
              <Kpi label="Ubicaciones" value={fmtQty(summary.totalLocations)} />
              <Kpi label="Libres" value={fmtQty(summary.freeLocations)} accent="var(--success)" />
              <Kpi label="Con lugar" value={fmtQty(freeCells.length)} />
              <Kpi label="Llenas" value={fmtQty(summary.fullLocations)} accent="var(--warning)" />
              <Kpi
                label="Ocupación"
                value={summary.totalLocations > 0 ? `${Math.round((summary.occupiedLocations / summary.totalLocations) * 100)}%` : "0%"}
              />
            </div>
          )}

          {summary && summary.byZone.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setZoneFilter("ALL")}
                style={{ fontSize: 12, padding: "4px 12px", background: zoneFilter === "ALL" ? "var(--primary)" : undefined, color: zoneFilter === "ALL" ? "#fff" : undefined }}
              >
                Todas ({summary.totalLocations})
              </button>
              {summary.byZone.map((z) => {
                const meta = zoneMeta(z.zone);
                return (
                  <button
                    key={z.zone}
                    type="button"
                    className="btn"
                    onClick={() => setZoneFilter(z.zone)}
                    style={{ fontSize: 12, padding: "4px 12px", background: zoneFilter === z.zone ? "var(--primary)" : undefined, color: zoneFilter === z.zone ? "#fff" : undefined }}
                  >
                    {meta ? `${meta.label}` : z.zone === "SIN_ZONA" ? "Sin zona" : z.zone}
                    {" "}({z.free} libre{z.free !== 1 ? "s" : ""})
                  </button>
                );
              })}
            </div>
          )}

          <div className="card">
            <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800 }}>
              Ubicaciones con lugar disponible
              <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 13 }}> — {freeCells.length} de {zoneFiltered.length}</span>
            </h3>
            <MapLegend states={["FREE", "OCCUPIED"]} />
            {mapQ.isLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }} aria-busy="true">Cargando mapa…</p>
            ) : (
              <WarehouseMap
                cells={freeCells}
                highlight={null}
                selectedId={drawerId}
                onSelect={(c) => setDrawerId(c.id)}
                emptyMessage="No hay ubicaciones con lugar disponible en este filtro."
              />
            )}
          </div>
        </div>
      )}

      {/* ══ Vista 3: Incidencias ══ */}
      {view === "incidents" && (
        <div style={{ display: "grid", gap: 14 }}>
          {incidentsQ.isLoading && <p style={{ color: "var(--muted)" }} aria-busy="true">Analizando el depósito…</p>}
          {incidentsQ.isError && (
            <div role="alert" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <p className="form-error" style={{ marginBottom: 0 }}>No se pudieron cargar las incidencias.</p>
              <button className="btn btn--primary" onClick={() => incidentsQ.refetch()}>Reintentar</button>
            </div>
          )}

          {incidentsQ.data && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                <Kpi label="Diferencias" value={incidentsQ.data.summary.stockMismatch} accent={incidentsQ.data.summary.stockMismatch ? "#eab308" : undefined} />
                <Kpi label="Sobrecapacidad" value={incidentsQ.data.summary.overCapacity} accent={incidentsQ.data.summary.overCapacity ? "var(--warning)" : undefined} />
                <Kpi label="Bloqueados" value={incidentsQ.data.summary.blockedPallets} />
                <Kpi label="Vencidos" value={incidentsQ.data.summary.expired} accent={incidentsQ.data.summary.expired ? "var(--danger)" : undefined} />
                <Kpi label={`Vencen ≤ ${incidentsQ.data.summary.expiryWarningDays} d`} value={incidentsQ.data.summary.expiring} />
                <Kpi label="Sin ubicar" value={incidentsQ.data.summary.palletsWithoutLocation} accent={incidentsQ.data.summary.palletsWithoutLocation ? "var(--warning)" : undefined} />
              </div>

              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Ubicaciones con incidencia ({incidentCells.length})</h3>
                </div>
                {incidentCells.length === 0 ? (
                  <p style={{ padding: "16px 14px", margin: 0, color: "var(--muted)", fontSize: 13 }}>Sin incidencias en este depósito.</p>
                ) : (
                  <table className="table" aria-label="Ubicaciones con incidencia">
                    <thead>
                      <tr>
                        <th scope="col">Ubicación</th>
                        <th scope="col">Motivo</th>
                        <th scope="col" style={{ textAlign: "right" }}>Pallets</th>
                        <th scope="col" style={{ textAlign: "right" }}>Unidades</th>
                        <th scope="col" style={{ textAlign: "right" }}>Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidentCells.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button
                              className="btn"
                              style={{ fontSize: 12, padding: "2px 8px", fontFamily: "monospace" }}
                              onClick={() => setDrawerId(c.id)}
                            >
                              {c.code}
                            </button>
                          </td>
                          <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {c.issues.map((i) => <IssueBadge key={i} issue={i} />)}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {c.basesUsed}{c.capacityBases != null ? ` / ${c.capacityBases}` : ""} base{c.basesUsed !== 1 ? "s" : ""}
                          </td>
                          <td style={{ textAlign: "right" }}>{fmtQty(c.units)}</td>
                          <td style={{ textAlign: "right", color: Math.abs(c.units - c.stockUnits) > 0.001 ? "#eab308" : undefined, fontWeight: Math.abs(c.units - c.stockUnits) > 0.001 ? 800 : 400 }}>
                            {fmtQty(c.stockUnits)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {incidentsQ.data.palletsWithoutLocation.length > 0 && (
                <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                      Pallets sin ubicación ({incidentsQ.data.palletsWithoutLocation.length})
                    </h3>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                      Tienen stock vigente pero no están asignados a ningún hueco del depósito.
                    </p>
                  </div>
                  <table className="table" aria-label="Pallets sin ubicación">
                    <thead>
                      <tr>
                        <th scope="col">Material</th>
                        <th scope="col">Lote</th>
                        <th scope="col">Pallet</th>
                        <th scope="col">Vencimiento</th>
                        <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidentsQ.data.palletsWithoutLocation.map((p) => (
                        <tr key={p.palletId}>
                          <td><strong>{p.productCode}</strong> <span style={{ color: "var(--muted)", fontSize: 12 }}>{p.productDescription}</span></td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.lotCode}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.palletCode}</td>
                          <td style={{ fontSize: 12 }}>{fmtDate(p.fechaVencimiento)}</td>
                          <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtQty(p.quantity)} {p.unitOfMeasure ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {incidentsQ.data.stockWithoutLocation.length > 0 && (
                <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                      Stock sin ubicación ({incidentsQ.data.stockWithoutLocation.length})
                    </h3>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                      Saldo registrado a nivel depósito, sin hueco asignado.
                    </p>
                  </div>
                  <table className="table" aria-label="Stock sin ubicación">
                    <thead>
                      <tr>
                        <th scope="col">Material</th>
                        <th scope="col">Depósito</th>
                        <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidentsQ.data.stockWithoutLocation.map((s) => (
                        <tr key={s.productId + (s.warehouseName ?? "")}>
                          <td><strong>{s.productCode}</strong> <span style={{ color: "var(--muted)", fontSize: 12 }}>{s.productDescription}</span></td>
                          <td style={{ fontSize: 12 }}>{s.warehouseName ?? "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtQty(s.quantity)} {s.unitOfMeasure ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="card">
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800 }}>Mapa de incidencias</h3>
                <MapLegend states={["INCIDENT", "EXPIRING", "INACTIVE"]} />
                <WarehouseMap
                  cells={incidentCells}
                  highlight={null}
                  selectedId={drawerId}
                  onSelect={(c) => setDrawerId(c.id)}
                  emptyMessage="Sin ubicaciones con incidencia."
                />
              </div>
            </>
          )}
        </div>
      )}

      {drawerId && (
        // key: al pasar a otra ubicación el panel se remonta limpio (sin la
        // trazabilidad ni el destino de transferencia del pallet anterior).
        <LocationDrawer
          key={drawerId}
          locationId={drawerId}
          onClose={() => setDrawerId(null)}
          onTransferred={refreshAfterMutation}
        />
      )}
    </div>
  );
}
