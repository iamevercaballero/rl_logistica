import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listProductionPlans,
  createProductionPlan,
  updateProductionPlan,
  deleteProductionPlan,
  type ProductionPlanRow,
  type PlanStatus,
  type PlanType,
  type CreateProductionPlanPayload,
} from "../api/productionPlans";
import { listWarehouses } from "../api/warehouses";
import { useToast } from "../design-system/toast";
import { useAuth } from "../auth/AuthContext";
import ProductSearch from "../components/ProductSearch";
import type { Product } from "../api/products";
import { fmtDateLong, fmtDateShort } from "../utils/dateFormat";

/* ── Constants ────────────────────────────────────────────────────────────── */
const STATUS_LABEL: Record<PlanStatus, string> = {
  PLANNED: "Planificado",
  CONFIRMED: "Confirmado",
  EXECUTED: "Ejecutado",
  CANCELLED: "Cancelado",
};

const STATUS_COLOR: Record<PlanStatus, string> = {
  PLANNED: "var(--info)",
  CONFIRMED: "var(--success)",
  EXECUTED: "var(--muted)",
  CANCELLED: "var(--danger)",
};

const STATUS_BG: Record<PlanStatus, string> = {
  PLANNED: "rgba(99,102,241,0.10)",
  CONFIRMED: "rgba(16,185,129,0.10)",
  EXECUTED: "rgba(107,114,128,0.10)",
  CANCELLED: "rgba(239,68,68,0.08)",
};

const TYPE_LABEL: Record<PlanType, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
};

/* ── Empty form state ─────────────────────────────────────────────────────── */
function emptyForm(): Omit<CreateProductionPlanPayload, "productId"> & { product: Product | null } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    product: null,
    plannedDate: tomorrow.toISOString().slice(0, 10),
    type: "ENTRY",
    warehouseId: "",
    plannedQuantity: 0,
    plannedPallets: undefined,
    supplier: "",
    destination: "",
    carrier: "",
    notes: "",
  };
}

/* ── StatusBadge ──────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: PlanStatus }) {
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
        color: STATUS_COLOR[status],
        background: STATUS_BG[status],
        border: `1px solid ${STATUS_COLOR[status]}30`,
        display: "inline-block",
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ── TypeBadge ────────────────────────────────────────────────────────────── */
function TypeBadge({ type }: { type: PlanType }) {
  const isEntry = type === "ENTRY";
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
        color: isEntry ? "var(--success)" : "var(--danger)",
        background: isEntry ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.08)",
        border: `1px solid ${isEntry ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.28)"}`,
      }}
    >
      {isEntry ? "↑ Entrada" : "↓ Salida"}
    </span>
  );
}

/* ── CreateModal ──────────────────────────────────────────────────────────── */
interface CreateModalProps {
  warehouses: { id: string; name: string }[];
  onClose: () => void;
  onSave: (payload: CreateProductionPlanPayload) => void;
  loading: boolean;
}

function CreateModal({ warehouses, onClose, onSave, loading }: CreateModalProps) {
  const [form, setForm] = useState(emptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.product) e.product = "Seleccione un material";
    if (!form.plannedDate) e.plannedDate = "Requerido";
    if (!form.plannedQuantity || form.plannedQuantity <= 0) e.plannedQuantity = "Debe ser > 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const payload: CreateProductionPlanPayload = {
      productId: form.product!.id,
      plannedDate: form.plannedDate,
      type: form.type,
      plannedQuantity: Number(form.plannedQuantity),
      plannedPallets: form.plannedPallets ? Number(form.plannedPallets) : undefined,
      warehouseId: form.warehouseId || undefined,
      supplier: form.supplier || undefined,
      destination: form.destination || undefined,
      carrier: form.carrier || undefined,
      notes: form.notes || undefined,
    };
    onSave(payload);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear plan de producción"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Nuevo plan</h2>
          <button className="btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Tipo */}
          <div className="form-field">
            <label className="form-label">Tipo</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["ENTRY", "EXIT"] as PlanType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn${form.type === t ? " btn--primary" : ""}`}
                  style={{ flex: 1, fontSize: 13 }}
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Material */}
          <div className="form-field">
            <label className="form-label">Material *</label>
            <ProductSearch value={form.product} onChange={(p) => { setForm((f) => ({ ...f, product: p })); setErrors((e) => ({ ...e, product: "" })); }} />
            {form.product && (
              <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border-dim)", fontSize: 12, color: "var(--muted)" }}>
                {form.product.code} — {form.product.description}
              </div>
            )}
            {errors.product && <span className="form-error" style={{ fontSize: 11 }}>{errors.product}</span>}
          </div>

          {/* Fecha + Depósito */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="form-field">
              <label className="form-label">Fecha planificada *</label>
              <input className="input" type="date" value={form.plannedDate}
                onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))} required />
              {errors.plannedDate && <span className="form-error" style={{ fontSize: 11 }}>{errors.plannedDate}</span>}
            </div>
            <div className="form-field">
              <label className="form-label">Depósito</label>
              <select className="input" value={form.warehouseId ?? ""} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}>
                <option value="">— Sin asignar —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          {/* Cantidad + Pallets */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="form-field">
              <label className="form-label">Cantidad planificada *</label>
              <input className="input" type="number" min={1} value={form.plannedQuantity || ""}
                onChange={(e) => setForm((f) => ({ ...f, plannedQuantity: Number(e.target.value) }))} />
              {errors.plannedQuantity && <span className="form-error" style={{ fontSize: 11 }}>{errors.plannedQuantity}</span>}
            </div>
            <div className="form-field">
              <label className="form-label">Pallets esperados</label>
              <input className="input" type="number" min={1} value={form.plannedPallets ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, plannedPallets: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
          </div>

          {/* Proveedor / Destino */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="form-field">
              <label className="form-label">{form.type === "ENTRY" ? "Proveedor" : "Destino"}</label>
              {form.type === "ENTRY" ? (
                <input className="input" value={form.supplier ?? ""} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
              ) : (
                <input className="input" value={form.destination ?? ""} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} />
              )}
            </div>
            <div className="form-field">
              <label className="form-label">Transportista</label>
              <input className="input" value={form.carrier ?? ""} onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value }))} />
            </div>
          </div>

          {/* Notas */}
          <div className="form-field">
            <label className="form-label">Notas</label>
            <textarea className="input" rows={2} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose} disabled={loading}>Cancelar</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? "Guardando..." : "Crear plan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function PlanProduccionPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<PlanStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<PlanType | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const warehousesQ = useQuery({ queryKey: ["warehouses"], queryFn: listWarehouses, staleTime: 5 * 60_000 });

  const plansQ = useQuery({
    queryKey: ["production-plans", { statusFilter, typeFilter, dateFrom, dateTo, page }],
    queryFn: () =>
      listProductionPlans({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit: 30,
      }),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: createProductionPlan,
    onSuccess: () => {
      toast.success("Plan creado correctamente");
      setShowCreate(false);
      void qc.invalidateQueries({ queryKey: ["production-plans"] });
    },
    onError: () => toast.error("Error al crear el plan"),
  });

  const confirmMut = useMutation({
    mutationFn: ({ id }: { id: string }) => updateProductionPlan(id, { status: "CONFIRMED" }),
    onSuccess: () => {
      toast.success("Plan confirmado");
      void qc.invalidateQueries({ queryKey: ["production-plans"] });
    },
    onError: () => toast.error("Error al confirmar"),
  });

  const cancelMut = useMutation({
    mutationFn: deleteProductionPlan,
    onSuccess: () => {
      toast.success("Plan cancelado");
      void qc.invalidateQueries({ queryKey: ["production-plans"] });
    },
    onError: () => toast.error("Error al cancelar"),
  });

  const executeMut = useMutation({
    mutationFn: ({ id }: { id: string }) => updateProductionPlan(id, { status: "EXECUTED" }),
    onSuccess: () => {
      toast.success("Plan marcado como ejecutado");
      void qc.invalidateQueries({ queryKey: ["production-plans"] });
    },
    onError: () => toast.error("Error al ejecutar"),
  });

  const plans = plansQ.data?.data ?? [];
  const meta = plansQ.data?.meta;
  const warehouses = warehousesQ.data ?? [];

  const isAdmin = user?.role === "ADMIN" || user?.role === "MANAGER";

  function handleConfirm(plan: ProductionPlanRow) {
    if (!confirm(`¿Confirmar el plan para ${plan.product.code} el ${fmtDateShort(plan.plannedDate)}?`)) return;
    confirmMut.mutate({ id: plan.id });
  }

  function handleCancel(plan: ProductionPlanRow) {
    if (!confirm(`¿Cancelar el plan para ${plan.product.code}?`)) return;
    cancelMut.mutate(plan.id);
  }

  function handleExecute(plan: ProductionPlanRow) {
    if (!confirm(`¿Marcar como ejecutado el plan para ${plan.product.code}?`)) return;
    executeMut.mutate({ id: plan.id });
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, margin: 0, marginBottom: 4 }}>
            Plan de Producción
          </h1>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
            Planificación de entradas y salidas futuras
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 5 }}><path d="M12 5v14M5 12h14" /></svg>
            Nuevo plan
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="form-field" style={{ margin: 0, minWidth: 150 }}>
            <label className="form-label">Estado</label>
            <select className="input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as PlanStatus | ""); setPage(1); }}>
              <option value="">Todos</option>
              <option value="PLANNED">Planificado</option>
              <option value="CONFIRMED">Confirmado</option>
              <option value="EXECUTED">Ejecutado</option>
              <option value="CANCELLED">Cancelado</option>
            </select>
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 130 }}>
            <label className="form-label">Tipo</label>
            <select className="input" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as PlanType | ""); setPage(1); }}>
              <option value="">Todos</option>
              <option value="ENTRY">Entradas</option>
              <option value="EXIT">Salidas</option>
            </select>
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="form-label">Desde</label>
            <input className="input" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="form-label">Hasta</label>
            <input className="input" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          <button className="btn" onClick={() => { setStatusFilter(""); setTypeFilter(""); setDateFrom(""); setDateTo(""); setPage(1); }}>
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Summary badges */}
      {!plansQ.isLoading && plans.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {(["PLANNED", "CONFIRMED", "EXECUTED", "CANCELLED"] as PlanStatus[]).map((s) => {
            const count = plans.filter((p) => p.status === s).length;
            if (count === 0) return null;
            return (
              <span key={s} style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: STATUS_COLOR[s], background: STATUS_BG[s], border: `1px solid ${STATUS_COLOR[s]}30` }}>
                {count} {STATUS_LABEL[s].toLowerCase()}{count !== 1 ? "s" : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
        {plansQ.isLoading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Cargando planes...</div>
        ) : plansQ.isError ? (
          <div className="form-error" style={{ margin: 16 }}>Error al cargar los planes.</div>
        ) : plans.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <p style={{ color: "var(--muted)", marginBottom: 16 }}>No hay planes para los filtros seleccionados</p>
            {isAdmin && (
              <button className="btn btn--primary" onClick={() => setShowCreate(true)}>+ Crear primer plan</button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Fecha</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Tipo</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Material</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Cantidad</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pallets</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Depósito</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Estado</th>
                  {isAdmin && <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 700, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {plans.map((plan, idx) => (
                  <PlanRow
                    key={plan.id}
                    plan={plan}
                    isAdmin={isAdmin}
                    isEven={idx % 2 === 0}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    onExecute={handleExecute}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
            Página {meta.page} de {meta.totalPages} ({meta.total} planes)
          </span>
          <button className="btn" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          warehouses={warehouses}
          onClose={() => setShowCreate(false)}
          onSave={(payload) => createMut.mutate(payload)}
          loading={createMut.isPending}
        />
      )}
    </div>
  );
}

/* ── PlanRow sub-component ────────────────────────────────────────────────── */
interface PlanRowProps {
  plan: ProductionPlanRow;
  isAdmin: boolean;
  isEven: boolean;
  onConfirm: (p: ProductionPlanRow) => void;
  onCancel: (p: ProductionPlanRow) => void;
  onExecute: (p: ProductionPlanRow) => void;
}

function PlanRow({ plan, isAdmin, isEven, onConfirm, onCancel, onExecute }: PlanRowProps) {
  const daysAway = (() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const t = new Date(plan.plannedDate + "T00:00:00");
    return Math.round((t.getTime() - now.getTime()) / 86_400_000);
  })();

  const isOverdue = daysAway < 0 && (plan.status === "PLANNED" || plan.status === "CONFIRMED");

  return (
    <tr style={{ background: isEven ? "transparent" : "var(--bg)", borderBottom: "1px solid var(--border-dim)" }}>
      <td style={{ padding: "10px 14px" }}>
        <div style={{ fontWeight: 700, color: isOverdue ? "var(--danger)" : "var(--text)" }}>
          {fmtDateLong(plan.plannedDate)}
        </div>
        <div style={{ fontSize: 11, color: isOverdue ? "var(--danger)" : "var(--muted)" }}>
          {daysAway === 0 ? "Hoy" : daysAway > 0 ? `en ${daysAway}d` : `hace ${Math.abs(daysAway)}d`}
        </div>
      </td>
      <td style={{ padding: "10px 14px" }}>
        <TypeBadge type={plan.type} />
      </td>
      <td style={{ padding: "10px 14px" }}>
        <div style={{ fontWeight: 700 }}>{plan.product.code}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {plan.product.description}
        </div>
      </td>
      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>
        {plan.plannedQuantity.toLocaleString("es-PY")}
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>{plan.product.unitOfMeasure ?? "u."}</span>
      </td>
      <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--muted)" }}>
        {plan.plannedPallets ?? "—"}
      </td>
      <td style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 12 }}>
        {plan.warehouseName ?? "—"}
        {plan.locationCode && <span style={{ marginLeft: 4, color: "var(--muted)" }}>· {plan.locationCode}</span>}
      </td>
      <td style={{ padding: "10px 14px" }}>
        <StatusBadge status={plan.status} />
        {plan.confirmedAt && (
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            Conf: {fmtDateShort(plan.confirmedAt)}
          </div>
        )}
      </td>
      {isAdmin && (
        <td style={{ padding: "10px 14px", textAlign: "center" }}>
          <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
            {plan.status === "PLANNED" && (
              <button
                className="btn"
                style={{ fontSize: 11, padding: "3px 9px", color: "var(--success)", borderColor: "rgba(16,185,129,0.35)" }}
                onClick={() => onConfirm(plan)}
                title="Confirmar"
              >
                ✓ Confirmar
              </button>
            )}
            {plan.status === "CONFIRMED" && (
              <button
                className="btn"
                style={{ fontSize: 11, padding: "3px 9px", color: "var(--info)", borderColor: "rgba(99,102,241,0.35)" }}
                onClick={() => onExecute(plan)}
                title="Marcar ejecutado"
              >
                → Ejecutar
              </button>
            )}
            {(plan.status === "PLANNED" || plan.status === "CONFIRMED") && (
              <button
                className="btn"
                style={{ fontSize: 11, padding: "3px 9px", color: "var(--danger)", borderColor: "rgba(239,68,68,0.3)" }}
                onClick={() => onCancel(plan)}
                title="Cancelar"
              >
                ✕
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
