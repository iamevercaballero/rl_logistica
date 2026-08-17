import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { listLocations } from "../api/locations";
import {
  getPalletHistory,
  getPalletKpis,
  listPallets,
  quickTransferPallet,
  reconcilePalletStatuses,
  type LotPallet,
  type PalletHistoryEvent,
} from "../api/pallets";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { fmtDateLong, fmtDateTimeLong } from "../utils/dateFormat";
import LocationPicker from "../components/LocationPicker";

/* ── Constants ───────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE:  "Disponible",
  PARTIAL:    "Parcial",
  BLOCKED:    "Bloqueado",
  DAMAGED:    "Dañado",
  IN_TRANSIT: "En tránsito",
  EXITED:     "Despachado",
  EMPTY:      "Vacío",
};

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE:  "badge badge--entry",
  PARTIAL:    "badge badge--transfer",
  BLOCKED:    "badge badge--adjout",
  DAMAGED:    "badge badge--exit",
  IN_TRANSIT: "badge badge--transfer",
  EXITED:     "badge",
  EMPTY:      "badge",
};

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE:  "var(--success)",
  PARTIAL:    "var(--primary)",
  BLOCKED:    "var(--warning)",
  DAMAGED:    "var(--danger)",
  IN_TRANSIT: "var(--info)",
  EXITED:     "var(--muted)",
  EMPTY:      "var(--muted)",
};

const MOVE_LABEL: Record<string, string> = {
  ENTRY:          "Entrada",
  EXIT:           "Salida",
  TRANSFER:       "Transferencia",
  ADJUSTMENT_IN:  "Ajuste +",
  ADJUSTMENT_OUT: "Ajuste -",
};

const MOVE_COLOR: Record<string, string> = {
  ENTRY:          "var(--success)",
  EXIT:           "var(--danger)",
  TRANSFER:       "var(--primary)",
  ADJUSTMENT_IN:  "var(--info)",
  ADJUSTMENT_OUT: "var(--warning)",
};

/* ── KPI Card ────────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  color,
  dim,
}: {
  label: string;
  value: number;
  color?: string;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: `1px solid ${dim ? "var(--border-dim)" : "var(--border)"}`,
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        minWidth: 90,
        flex: 1,
        opacity: dim ? 0.65 : 1,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          color: color ?? "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value.toLocaleString("es-PY")}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

/* ── History Timeline ─────────────────────────────────────────────────────── */

function HistoryTimeline({ events }: { events: PalletHistoryEvent[] }) {
  if (events.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
        Sin historial de movimientos.
      </p>
    );
  }
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {events.map((ev, idx) => {
        const voided = ev.voidStatus === "VOIDED";
        const color = voided ? "var(--muted)" : MOVE_COLOR[ev.type] ?? "var(--border)";
        const isLast = idx === events.length - 1;
        return (
          <li key={ev.movementId} style={{ display: "flex", gap: 12, position: "relative", opacity: voided ? 0.6 : 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div
                style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: color, border: `2px solid ${color}`,
                  marginTop: 4, flexShrink: 0, boxShadow: `0 0 0 3px ${color}20`,
                }}
                aria-hidden="true"
              />
              {!isLast && (
                <div style={{ width: 2, flex: 1, background: "var(--border-dim)", marginTop: 4 }} aria-hidden="true" />
              )}
            </div>
            <div style={{ paddingBottom: isLast ? 0 : 16, flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    color, background: `${color}15`, border: `1px solid ${color}30`,
                  }}
                >
                  {MOVE_LABEL[ev.type] ?? ev.type}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {fmtDateTimeLong(ev.createdAt ?? ev.date)}
                </span>
                {ev.status === "PENDING_REGULARIZATION" && !voided && (
                  <span
                    style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                      background: "rgba(245,158,11,0.10)", color: "var(--warning)",
                      border: "1px solid rgba(245,158,11,0.28)",
                    }}
                  >
                    Pend. regularizar
                  </span>
                )}
                {ev.voidStatus === "VOID_PENDING" && (
                  <span
                    style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                      background: "rgba(245,158,11,0.10)", color: "var(--warning)",
                      border: "1px solid rgba(245,158,11,0.28)",
                    }}
                  >
                    Anulación pendiente
                  </span>
                )}
                {voided && (
                  <span
                    style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                      background: "var(--panel-hi)", color: "var(--muted)",
                      border: "1px dashed var(--border)",
                    }}
                  >
                    Anulado
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4, textDecoration: voided ? "line-through" : undefined }}>
                {ev.quantity.toLocaleString("es-PY")} unidades
                {ev.remainingAfter !== undefined && (
                  <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 6 }}>
                    (saldo: {ev.remainingAfter.toLocaleString("es-PY")})
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {ev.from && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    De: <strong style={{ color: "var(--text-variant)" }}>
                      {ev.from.warehouseName ?? ""} {ev.from.locationCode}
                    </strong>
                  </span>
                )}
                {ev.to && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    A: <strong style={{ color: "var(--text-variant)" }}>
                      {ev.to.warehouseName ?? ""} {ev.to.locationCode}
                    </strong>
                  </span>
                )}
                {ev.documentNumber && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    MIC/Fac/Rem.: <strong style={{ color: "var(--text-variant)" }}>{ev.documentNumber}</strong>
                  </span>
                )}
                {ev.supplier && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Proveedor: {ev.supplier}</span>
                )}
                {ev.carrier && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Transportista: {ev.carrier}{ev.driver ? ` · Chofer: ${ev.driver}` : ""}
                  </span>
                )}
                {ev.destination && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Destino: {ev.destination}</span>
                )}
                {ev.notes && (
                  <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>"{ev.notes}"</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Quick Transfer Modal ─────────────────────────────────────────────────── */

type LocationOpt = { id: string; code: string; warehouseName?: string | null };

function QuickTransferModal({
  pallet,
  onClose,
}: {
  pallet: LotPallet;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [toLocationId, setToLocationId] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const transferMut = useMutation({
    mutationFn: () => quickTransferPallet(pallet.id, toLocationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pallets"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
      void queryClient.invalidateQueries({ queryKey: ["location-availability"] });
      void queryClient.invalidateQueries({ queryKey: ["location-recommendations"] });
      void queryClient.invalidateQueries({ queryKey: ["location-map"] });
      void queryClient.invalidateQueries({ queryKey: ["location-content"] });
      toast.success(`Pallet ${pallet.code} transferido`);
      onClose();
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const currentLabel = pallet.locationCode
    ? `${pallet.warehouseName ? pallet.warehouseName + " · " : ""}${pallet.locationCode}`
    : "Sin ubicación";

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9900,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transferencia rápida de pallet"
        style={{
          width: "min(400px, 95vw)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          animation: "cp-slide-in 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div
          style={{
            padding: "14px 16px", borderBottom: "1px solid var(--border)",
            background: "var(--bg-base)", display: "flex",
            alignItems: "center", justifyContent: "space-between",
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Transferencia rápida</h2>
          <button className="btn" style={{ padding: "0 10px", height: 32 }} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ padding: "16px" }}>
          <div
            style={{
              background: "var(--bg-base)", border: "1px solid var(--border-dim)",
              borderRadius: 6, padding: "10px 12px", marginBottom: 16, fontSize: 13,
            }}
          >
            <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
              {pallet.code}
            </div>
            {pallet.productCode && (
              <div style={{ color: "var(--muted)", marginBottom: 2 }}>
                {pallet.productCode} — {pallet.productDescription}
              </div>
            )}
            <div style={{ display: "flex", gap: 16, color: "var(--muted)" }}>
              <span>
                Cantidad: <strong style={{ color: "var(--text)" }}>{pallet.quantity.toLocaleString("es-PY")}</strong>
              </span>
              <span>
                Desde: <strong style={{ color: "var(--text)" }}>{currentLabel}</strong>
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Ubicación destino</span>
            <LocationPicker
              value={toLocationId}
              onChange={setToLocationId}
              excludeUnavailable
              excludeLocationId={pallet.currentLocationId ?? undefined}
              productId={pallet.productId}
              placeholder="Seleccionar ubicación…"
            />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={onClose} disabled={transferMut.isPending}>Cancelar</button>
            <button
              className="btn btn--primary"
              disabled={!toLocationId || transferMut.isPending}
              onClick={() => transferMut.mutate()}
            >
              {transferMut.isPending ? "Transfiriendo…" : "Confirmar transferencia"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Detail Modal ─────────────────────────────────────────────────────────── */

function PalletDetailModal({
  pallet,
  locations,
  canTransfer,
  onClose,
  onTransfer,
}: {
  pallet: LotPallet;
  locations: LocationOpt[];
  canTransfer: boolean;
  onClose: () => void;
  onTransfer: (p: LotPallet) => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const histQ = useQuery({
    queryKey: ["pallets", pallet.id, "history"],
    queryFn: () => getPalletHistory(pallet.id),
    staleTime: 30_000,
  });

  const currentLoc = locations.find((l) => l.id === pallet.currentLocationId);

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9800,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 16,
      }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del pallet"
        style={{
          width: "min(520px, 95vw)",
          maxHeight: "calc(100vh - 32px)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-lg)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          animation: "cp-slide-in 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px", borderBottom: "1px solid var(--border)",
            background: "var(--bg-base)", display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: 12,
          }}
        >
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 2 }}>Detalle del pallet</h2>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              <strong style={{ fontFamily: "monospace", color: "var(--text-variant)" }}>{pallet.code}</strong>
              {" · "}
              <span className={STATUS_BADGE[pallet.status] ?? "badge"}>
                {STATUS_LABEL[pallet.status] ?? pallet.status}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {canTransfer && pallet.status !== "EXITED" && pallet.status !== "EMPTY" && (
              <button
                className="btn btn--primary"
                style={{ fontSize: 12, height: 30, padding: "0 10px" }}
                onClick={() => { onClose(); onTransfer(pallet); }}
              >
                Transferir
              </button>
            )}
            <button
              className="btn"
              style={{ padding: "0 10px", height: 30, flexShrink: 0 }}
              onClick={onClose}
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* Datos generales */}
          <section style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
            <SectionTitle>Datos generales</SectionTitle>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", margin: 0 }}>
              <InfoRow label="Código" value={<span style={{ fontFamily: "monospace" }}>{pallet.code}</span>} />
              <InfoRow label="Cantidad" value={pallet.quantity.toLocaleString("es-PY")} />
              <InfoRow
                label="Creado"
                value={pallet.createdAt ? fmtDateLong(pallet.createdAt) : "—"}
              />
              {pallet.exitedAt && (
                <InfoRow
                  label="Despachado"
                  value={fmtDateLong(pallet.exitedAt)}
                />
              )}
            </dl>
          </section>

          {/* Producto / Lote */}
          {(pallet.productCode || pallet.lotCode) && (
            <section style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
              <SectionTitle>Producto / Lote</SectionTitle>
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", margin: 0 }}>
                {pallet.productCode && <InfoRow label="Código material" value={pallet.productCode} />}
                {pallet.productDescription && <InfoRow label="Descripción" value={pallet.productDescription} />}
                {pallet.lotCode && (
                  <InfoRow label="Lote" value={<span style={{ fontFamily: "monospace" }}>{pallet.lotCode}</span>} />
                )}
                {pallet.fechaVencimiento && (
                  <InfoRow
                    label="Vencimiento"
                    value={fmtDateLong(pallet.fechaVencimiento)}
                  />
                )}
              </dl>
            </section>
          )}

          {/* Ubicación física */}
          <section style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
            <SectionTitle>Ubicación física</SectionTitle>
            {pallet.currentLocationId ? (
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", margin: 0 }}>
                <InfoRow label="Almacén" value={pallet.warehouseName ?? currentLoc?.warehouseName ?? "—"} />
                <InfoRow label="Rack / posición" value={pallet.locationCode ?? currentLoc?.code ?? "—"} />
              </dl>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "var(--warning)", fontWeight: 600 }}>
                Sin ubicación asignada
              </p>
            )}
          </section>

          {/* Apilamiento */}
          <section style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-dim)" }}>
            <SectionTitle>Reglas de apilamiento</SectionTitle>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", margin: 0 }}>
              <InfoRow
                label="Apilable"
                value={
                  pallet.stackable === false
                    ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>No</span>
                    : <span style={{ color: "var(--success)", fontWeight: 700 }}>Sí</span>
                }
              />
              <InfoRow
                label="Recibe peso encima"
                value={
                  pallet.canReceiveWeightOnTop === false
                    ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>No</span>
                    : <span style={{ color: "var(--success)", fontWeight: 700 }}>Sí</span>
                }
              />
              {pallet.maxStackLevel != null && (
                <InfoRow label="Niveles máx." value={String(pallet.maxStackLevel)} />
              )}
            </dl>
          </section>

          {/* Historial */}
          <section style={{ padding: "14px 16px 24px" }}>
            <SectionTitle>Historial de movimientos</SectionTitle>
            {histQ.isLoading && <p style={{ color: "var(--muted)", fontSize: 13 }} aria-busy="true">Cargando…</p>}
            {histQ.isError && <p className="form-error" role="alert">No se pudo cargar el historial.</p>}
            {histQ.data && <HistoryTimeline events={histQ.data.history} />}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 style={{
      fontSize: 11, fontWeight: 700, color: "var(--muted)",
      margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.5,
    }}>
      {children}
    </h3>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: "var(--muted)", marginBottom: 1 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{value}</dd>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function PalletsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowTransfer = role ? canCreate("pallets", role) : false;
  const allowReconcile = role ? canDelete("pallets", role) : false; // ADMIN/MANAGER
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Modal state ──────────────────────────────────────────────────────────
  const [detailPallet, setDetailPallet] = useState<LotPallet | null>(null);
  const [transferPallet, setTransferPallet] = useState<LotPallet | null>(null);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchInput]);

  // ── Queries ───────────────────────────────────────────────────────────────
  const [palletsQ, locationsQ, kpisQ] = useQueries({
    queries: [
      { queryKey: ["pallets"], queryFn: () => listPallets() },
      { queryKey: ["locations"], queryFn: listLocations },
      { queryKey: ["pallets", "kpis"], queryFn: getPalletKpis, staleTime: 60_000 },
    ],
  });

  const allPallets = palletsQ.data ?? [];
  const locations = locationsQ.data ?? [];
  const kpis = kpisQ.data;
  const isLoading = palletsQ.isLoading || locationsQ.isLoading;
  const isError = palletsQ.isError || locationsQ.isError;

  // ── Derived filter options ────────────────────────────────────────────────
  const productOptions = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; description: string }>();
    for (const p of allPallets) {
      if (p.productId && !seen.has(p.productId)) {
        seen.set(p.productId, { id: p.productId, code: p.productCode ?? "", description: p.productDescription ?? "" });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [allPallets]);

  const locationOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const p of allPallets) {
      if (p.currentLocationId && p.locationCode && !seen.has(p.currentLocationId)) {
        seen.set(p.currentLocationId, {
          id: p.currentLocationId,
          label: p.warehouseName ? `${p.warehouseName} · ${p.locationCode}` : p.locationCode,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allPallets]);

  // ── Client-side filtering ─────────────────────────────────────────────────
  const items = useMemo(() => {
    let result = allPallets;
    if (statusFilter)   result = result.filter((p) => p.status === statusFilter);
    if (productFilter)  result = result.filter((p) => p.productId === productFilter);
    if (locationFilter) result = result.filter((p) => p.currentLocationId === locationFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.code.toLowerCase().includes(q) ||
          (p.productCode ?? "").toLowerCase().includes(q) ||
          (p.productDescription ?? "").toLowerCase().includes(q) ||
          (p.lotCode ?? "").toLowerCase().includes(q) ||
          (p.locationCode ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [allPallets, statusFilter, productFilter, locationFilter, search]);

  const locationOpts: LocationOpt[] = locations.map((l) => ({
    id: l.id,
    code: l.code,
    warehouseName: l.warehouse?.name,
  }));

  function refetchAll() {
    palletsQ.refetch();
    locationsQ.refetch();
    kpisQ.refetch();
  }

  const reconcileMut = useMutation({
    mutationFn: reconcilePalletStatuses,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      const total = res.exited + res.partial;
      if (total === 0) {
        toast.success("Estados ya consistentes. Nada que reconciliar.");
      } else {
        toast.success(`Reconciliados: ${res.partial} parcial(es), ${res.exited} despachado(s).`);
      }
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Palets</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Vista operativa de palets. Los palets se generan automáticamente al registrar entradas en Movimientos.
        </p>
      </div>

      {/* KPI bar */}
      {kpis && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <KpiCard label="Total" value={kpis.total} />
          <KpiCard label="Disponibles" value={kpis.available} color="var(--success)" />
          <KpiCard label="Parciales" value={kpis.partial} color="var(--primary)" dim={kpis.partial === 0} />
          <KpiCard label="Bloqueados" value={kpis.blocked} color="var(--warning)" dim={kpis.blocked === 0} />
          <KpiCard label="Sin ubicación" value={kpis.noLocation} color="var(--danger)" dim={kpis.noLocation === 0} />
          <KpiCard label="Despachados" value={kpis.exited} dim />
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 300 }}>
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2"
            style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar código, producto, lote…"
            aria-label="Buscar pallets"
            style={{ paddingLeft: 30, paddingRight: searchInput ? 28 : 10, width: "100%", boxSizing: "border-box" }}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Limpiar búsqueda"
              style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filtrar por estado"
          style={{ flex: "0 0 auto", minWidth: 145 }}
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        {/* Product filter */}
        {productOptions.length > 0 && (
          <select
            className="input"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            aria-label="Filtrar por producto"
            style={{ flex: "0 0 auto", minWidth: 160 }}
          >
            <option value="">Todos los productos</option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.description}</option>
            ))}
          </select>
        )}

        {/* Location filter */}
        {locationOptions.length > 0 && (
          <select
            className="input"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            aria-label="Filtrar por ubicación"
            style={{ flex: "0 0 auto", minWidth: 160 }}
          >
            <option value="">Todas las ubicaciones</option>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        )}

        {/* Clear */}
        {(statusFilter || productFilter || locationFilter || search) && (
          <button
            className="btn"
            style={{ fontSize: 12, height: 34 }}
            onClick={() => { setStatusFilter(""); setProductFilter(""); setLocationFilter(""); setSearchInput(""); }}
          >
            Limpiar filtros
          </button>
        )}

        {/* Reconcile statuses (ADMIN/MANAGER) */}
        {allowReconcile && (
          <button
            className="btn"
            style={{ marginLeft: "auto", fontSize: 12, height: 34 }}
            onClick={() => {
              if (window.confirm("Recalcular el estado de los pallets según su historial de movimientos?\n\nSolo afecta pallets en estado Disponible que ya tuvieron salidas. No toca bloqueados, dañados ni despachados.")) {
                reconcileMut.mutate();
              }
            }}
            disabled={reconcileMut.isPending || isLoading}
            title="Reconciliar estados (Disponible → Parcial/Despachado según historial)"
          >
            {reconcileMut.isPending ? "Reconciliando…" : "Reconciliar estados"}
          </button>
        )}

        {/* Refresh */}
        <button
          className="btn"
          style={{ marginLeft: allowReconcile ? 0 : "auto", fontSize: 12, height: 34, padding: "0 10px" }}
          onClick={refetchAll}
          disabled={isLoading}
          title="Actualizar"
          aria-label="Actualizar lista"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>

        {/* Count */}
        {!isLoading && (
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {items.length} pallet{items.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* States */}
      {isLoading && <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando…</p>}
      {isError && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
          <button className="btn btn--primary" onClick={refetchAll}>Reintentar</button>
        </div>
      )}

      {/* Modals */}
      {detailPallet && (
        <PalletDetailModal
          pallet={detailPallet}
          locations={locationOpts}
          canTransfer={allowTransfer}
          onClose={() => setDetailPallet(null)}
          onTransfer={(p) => { setDetailPallet(null); setTransferPallet(p); }}
        />
      )}
      {transferPallet && (
        <QuickTransferModal
          pallet={transferPallet}
          onClose={() => setTransferPallet(null)}
        />
      )}

      {/* Table */}
      {!isLoading && !isError && (
        items.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {allPallets.length === 0
              ? "No hay palets registrados. Los palets se crean al registrar entradas en el módulo Movimientos."
              : "Ningún pallet coincide con los filtros aplicados."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" aria-label="Lista de palets">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Lote</th>
                  <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                  <th scope="col">Ubicación</th>
                  <th scope="col">Estado</th>
                  <th scope="col" style={{ textAlign: "right" }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDetailPallet(item)}
                  >
                    <td>
                      <strong style={{ fontFamily: "monospace", fontSize: 13 }}>{item.code}</strong>
                    </td>
                    <td style={{ maxWidth: 220 }}>
                      {item.productCode ? (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.productCode}</div>
                          <div
                            style={{
                              fontSize: 11, color: "var(--muted)",
                              overflow: "hidden", textOverflow: "ellipsis",
                              whiteSpace: "nowrap", maxWidth: 200,
                            }}
                            title={item.productDescription}
                          >
                            {item.productDescription}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      {item.lotCode
                        ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{item.lotCode}</span>
                        : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {item.quantity.toLocaleString("es-PY")}
                    </td>
                    <td>
                      {item.locationCode ? (
                        <div>
                          {item.warehouseName && (
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.warehouseName}</div>
                          )}
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{item.locationCode}</div>
                        </div>
                      ) : (
                        <span style={{ color: "var(--warning)", fontSize: 12, fontWeight: 600 }}>Sin ubicación</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={STATUS_BADGE[item.status] ?? "badge"}
                        style={{ borderLeft: `3px solid ${STATUS_COLOR[item.status] ?? "transparent"}` }}
                      >
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </td>
                    <td
                      style={{ textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {allowTransfer && item.status !== "EXITED" && item.status !== "EMPTY" && (
                        <button
                          className="btn"
                          style={{ fontSize: 11, height: 26, padding: "0 8px" }}
                          onClick={() => setTransferPallet(item)}
                          title="Transferir pallet"
                          aria-label={`Transferir pallet ${item.code}`}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <polyline points="17 1 21 5 17 9"/>
                            <path d="M3 11V9a4 4 0 014-4h14"/>
                            <polyline points="7 23 3 19 7 15"/>
                            <path d="M21 13v2a4 4 0 01-4 4H3"/>
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
