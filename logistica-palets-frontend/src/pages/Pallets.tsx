import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { listLocations } from "../api/locations";
import { listLots } from "../api/lots";
import {
  createPallet,
  deletePallet,
  listPallets,
  getPalletHistory,
  type Pallet,
  type PalletHistoryEvent,
} from "../api/pallets";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Disponible",
  BLOCKED: "Bloqueado",
  DAMAGED: "Dañado",
  IN_TRANSIT: "En tránsito",
  EXITED: "Despachado",
};

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE: "badge badge--entry",
  BLOCKED: "badge badge--adjout",
  DAMAGED: "badge badge--exit",
  IN_TRANSIT: "badge badge--transfer",
  EXITED: "badge",
};

const MOVE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT_IN: "Ajuste +",
  ADJUSTMENT_OUT: "Ajuste -",
};

const MOVE_COLOR: Record<string, string> = {
  ENTRY: "var(--success)",
  EXIT: "var(--danger)",
  TRANSFER: "var(--primary)",
  ADJUSTMENT_IN: "var(--info)",
  ADJUSTMENT_OUT: "var(--warning)",
};

/* ── History Timeline ─────────────────────────────────────────────────────── */
function HistoryTimeline({ events }: { events: PalletHistoryEvent[] }) {
  if (events.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Sin historial de movimientos.</p>;
  }

  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {events.map((ev, idx) => {
        const color = MOVE_COLOR[ev.type] ?? "var(--border)";
        const isLast = idx === events.length - 1;
        return (
          <li key={ev.movementId} style={{ display: "flex", gap: 12, position: "relative" }}>
            {/* Timeline stem */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: color,
                border: `2px solid ${color}`,
                marginTop: 4,
                flexShrink: 0,
                boxShadow: `0 0 0 3px ${color}20`,
              }} aria-hidden="true" />
              {!isLast && (
                <div style={{ width: 2, flex: 1, background: "var(--border-dim)", marginTop: 4, marginBottom: 0 }} aria-hidden="true" />
              )}
            </div>

            {/* Content */}
            <div style={{ paddingBottom: isLast ? 0 : 16, flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  color,
                  background: `${color}15`,
                  border: `1px solid ${color}30`,
                }}>
                  {MOVE_LABEL[ev.type] ?? ev.type}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {new Date(ev.date).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                {ev.status === "PENDING_REGULARIZATION" && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "rgba(245,158,11,0.10)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.28)" }}>
                    Pend. regularizar
                  </span>
                )}
              </div>

              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                {ev.quantity.toLocaleString("es-PY")} unidades
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {ev.from && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    De: <strong style={{ color: "var(--text-variant)" }}>{ev.from.warehouseName ?? ""} {ev.from.locationCode}</strong>
                  </span>
                )}
                {ev.to && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    A: <strong style={{ color: "var(--text-variant)" }}>{ev.to.warehouseName ?? ""} {ev.to.locationCode}</strong>
                  </span>
                )}
                {ev.documentNumber && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Doc: <strong style={{ color: "var(--text-variant)" }}>{ev.documentNumber}</strong>
                  </span>
                )}
                {ev.supplier && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Proveedor: {ev.supplier}
                  </span>
                )}
                {ev.carrier && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Transportista: {ev.carrier}{ev.driver ? ` · Chofer: ${ev.driver}` : ""}
                  </span>
                )}
                {ev.destination && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Destino: {ev.destination}
                  </span>
                )}
                {ev.notes && (
                  <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
                    "{ev.notes}"
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Pallet History Modal ─────────────────────────────────────────────────── */
function PalletHistoryModal({ palletId, onClose }: { palletId: string; onClose: () => void }) {
  const histQ = useQuery({
    queryKey: ["pallets", palletId, "history"],
    queryFn: () => getPalletHistory(palletId),
    staleTime: 30_000,
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const data = histQ.data;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9800,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-end",
        padding: 16,
      }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Historial de trazabilidad del pallet"
        style={{
          width: "min(480px, 95vw)",
          maxHeight: "calc(100vh - 32px)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "cp-slide-in 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-base)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 2 }}>
              Trazabilidad del pallet
            </h2>
            {data && (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                <strong style={{ color: "var(--text-variant)", fontFamily: "monospace" }}>{data.pallet.code}</strong>
                {data.product && ` · ${data.product.code} — ${data.product.description}`}
              </div>
            )}
          </div>
          <button
            className="btn"
            style={{ padding: "0 10px", height: 32, flexShrink: 0 }}
            onClick={onClose}
            aria-label="Cerrar trazabilidad"
          >
            ✕
          </button>
        </div>

        {/* Status bar */}
        {data && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-dim)", background: "var(--panel-mid)", display: "flex", gap: 12, fontSize: 12, color: "var(--muted)" }}>
            <span>Estado: <span className={STATUS_BADGE[data.pallet.status] ?? "badge"}>{STATUS_LABEL[data.pallet.status] ?? data.pallet.status}</span></span>
            <span>Cantidad: <strong style={{ color: "var(--text)" }}>{data.pallet.quantity.toLocaleString("es-PY")}</strong></span>
            <span style={{ marginLeft: "auto" }}>{data.history.length} evento{data.history.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Timeline */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 16px 24px" }}>
          {histQ.isLoading && (
            <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }} aria-busy="true">
              Cargando historial…
            </p>
          )}
          {histQ.isError && (
            <p className="form-error" role="alert" style={{ margin: 0, textAlign: "center" }}>
              No se pudo cargar el historial.
            </p>
          )}
          {data && <HistoryTimeline events={data.history} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function PalletsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("pallets", role) : false;
  const allowDelete = role ? canDelete("pallets", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const codeId = useId();
  const qtyId = useId();

  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState("AVAILABLE");
  const [lotId, setLotId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [historyPalletId, setHistoryPalletId] = useState<string | null>(null);

  const codeError = useMemo(() => {
    const value = code.trim();
    if (!value) return "Ingresá un código.";
    if (value.length < 2 || value.length > 80) return "El código debe tener entre 2 y 80 caracteres.";
    return "";
  }, [code]);

  const quantityError = useMemo(() => {
    const parsed = Number(quantity);
    if (!quantity.trim()) return "Ingresá una cantidad.";
    if (!Number.isFinite(parsed) || parsed < 0) return "La cantidad debe ser mayor o igual a 0.";
    return "";
  }, [quantity]);

  const [palletsQ, lotsQ, locationsQ] = useQueries({
    queries: [
      { queryKey: ["pallets"], queryFn: () => listPallets() },
      { queryKey: ["lots"], queryFn: () => listLots() },
      { queryKey: ["locations"], queryFn: listLocations },
    ],
  });

  const items = palletsQ.data ?? [];
  const lots = lotsQ.data ?? [];
  const locations = locationsQ.data ?? [];
  const isLoading = palletsQ.isLoading || lotsQ.isLoading || locationsQ.isLoading;
  const isError = palletsQ.isError || lotsQ.isError || locationsQ.isError;

  useEffect(() => {
    if (!lotId && lots[0]) setLotId(lots[0].id);
  }, [lots, lotId]);
  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const createMut = useMutation({
    mutationFn: createPallet,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      toast.success(`Pallet ${created.code} creado`);
      setCode("");
      setQuantity("1");
      setStatus("AVAILABLE");
      setSubmitted(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePallet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      toast.success("Pallet eliminado");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  // Barcode scanner: USB mode always active; camera scan populates code field
  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const { cameraActive, cameraSupported, startCamera, stopCamera } = useBarcodeScanner({
    enabled: allowCreate && !saving,
    onScan: (scanned) => {
      setCode(scanned);
      toast.success(`Código escaneado: ${scanned}`);
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!allowCreate || codeError || quantityError || !lotId || !locationId) return;
    createMut.mutate({
      code: code.trim(),
      lotId,
      quantity: Number(quantity),
      currentLocationId: locationId,
      status,
    });
  }

  function handleDelete(item: Pallet) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar pallet ${item.code}?`)) return;
    deleteMut.mutate(item.id);
  }

  function refetchAll() {
    palletsQ.refetch();
    lotsQ.refetch();
    locationsQ.refetch();
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Palets</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Gestión de palets individuales. {!allowCreate ? "Modo lectura." : ""}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }} aria-label="Nuevo pallet">
        {/* Code field + scan button */}
        <div style={{ display: "flex", gap: 4 }}>
          <input
            id={codeId}
            className="input"
            disabled={!allowCreate || saving}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Código del pallet"
            aria-label="Código del pallet"
            aria-invalid={submitted && !!codeError}
            aria-describedby={submitted && codeError ? `${codeId}-err` : undefined}
            style={{ minWidth: 180 }}
          />
          {allowCreate && cameraSupported && (
            <button
              type="button"
              className={`btn${cameraActive ? " btn--primary" : ""}`}
              onClick={() => {
                if (cameraActive) stopCamera();
                else if (scanVideoRef.current) void startCamera(scanVideoRef.current);
              }}
              title={cameraActive ? "Detener cámara" : "Escanear código con cámara"}
              aria-label={cameraActive ? "Detener cámara" : "Escanear código con cámara"}
              style={{ padding: "0 10px", flexShrink: 0 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
          )}
        </div>
        {/* Hidden video element for camera scanning */}
        <video
          ref={scanVideoRef}
          muted
          playsInline
          aria-hidden="true"
          style={{
            display: cameraActive ? "block" : "none",
            width: 240, height: 180,
            borderRadius: 8,
            border: "2px solid var(--primary)",
            objectFit: "cover",
            alignSelf: "flex-start",
          }}
        />
        <input
          id={qtyId}
          className="input"
          disabled={!allowCreate || saving}
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          style={{ width: 120 }}
          placeholder="Cantidad"
          aria-label="Cantidad"
          aria-invalid={submitted && !!quantityError}
          aria-describedby={submitted && quantityError ? `${qtyId}-err` : undefined}
        />
        <select
          className="input"
          disabled={!allowCreate || saving}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Estado"
        >
          <option value="AVAILABLE">Disponible</option>
          <option value="BLOCKED">Bloqueado</option>
          <option value="DAMAGED">Dañado</option>
          <option value="IN_TRANSIT">En tránsito</option>
        </select>
        <select
          className="input"
          disabled={!allowCreate || saving || lots.length === 0}
          value={lotId}
          onChange={(event) => setLotId(event.target.value)}
          aria-label="Lote"
        >
          <option value="">Seleccionar lote</option>
          {lots.map((lot) => (
            <option key={lot.id} value={lot.id}>{lot.lotCode}</option>
          ))}
        </select>
        <select
          className="input"
          disabled={!allowCreate || saving || locations.length === 0}
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          aria-label="Ubicación"
        >
          <option value="">Seleccionar ubicación</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{location.code}</option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving || lots.length === 0 || locations.length === 0}>
          {createMut.isPending ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && codeError ? <p id={`${codeId}-err`} className="form-error" role="alert">{codeError}</p> : null}
      {submitted && quantityError ? <p id={`${qtyId}-err`} className="form-error" role="alert">{quantityError}</p> : null}
      {submitted && !lotId ? <p className="form-error" role="alert">Seleccioná un lote.</p> : null}
      {submitted && !locationId ? <p className="form-error" role="alert">Seleccioná una ubicación.</p> : null}

      {isLoading ? <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando…</p> : null}
      {isError ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
          <button className="btn btn--primary" onClick={refetchAll}>Reintentar</button>
        </div>
      ) : null}

      {historyPalletId && (
        <PalletHistoryModal
          palletId={historyPalletId}
          onClose={() => setHistoryPalletId(null)}
        />
      )}

      {!isLoading && !isError ? (
        items.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table" aria-label="Lista de palets">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Estado</th>
                <th scope="col" style={{ textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong style={{ fontFamily: "monospace", letterSpacing: 0 }}>{item.code}</strong>
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.quantity.toLocaleString("es-AR")}
                  </td>
                  <td>
                    <span className={STATUS_BADGE[item.status] ?? "badge"}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        style={{ fontSize: 12, height: 28, padding: "0 10px" }}
                        onClick={() => setHistoryPalletId(item.id)}
                        aria-label={`Ver historial del pallet ${item.code}`}
                        title="Ver trazabilidad"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <polyline points="12 8 12 12 14 14"/>
                          <path d="M3.05 11a9 9 0 1 0 .5-3"/><polyline points="3 4 3 11 10 11"/>
                        </svg>
                        Historial
                      </button>
                      {allowDelete ? (
                        <button
                          className="btn btn--danger"
                          style={{ fontSize: 12, height: 28, padding: "0 10px" }}
                          onClick={() => handleDelete(item)}
                          disabled={saving}
                          aria-label={`Eliminar pallet ${item.code}`}
                        >
                          Eliminar
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}
