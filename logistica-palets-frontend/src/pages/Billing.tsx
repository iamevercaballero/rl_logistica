import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { canCreate } from "../auth/rbac";
import type {
  AfectacionIVA, CondicionPago, CreateFacturaPayload, CreateItemPayload,
  EstadoFactura, Factura, TipoDE,
} from "../api/billing";
import {
  cancelarFactura, consultarSIFEN, createCliente, createFactura,
  enviarSIFEN, getClientes, getFacturas,
} from "../api/billing";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

// ─── Constantes de visualización ─────────────────────────────────────────────

const ESTADO_BADGE: Record<EstadoFactura, string> = {
  BORRADOR:  "badge badge--estado-borrador",
  PENDIENTE: "badge badge--estado-pendiente",
  APROBADO:  "badge badge--estado-aprobado",
  RECHAZADO: "badge badge--estado-rechazado",
  CANCELADO: "badge badge--estado-cancelado",
};

const ESTADO_LABEL: Record<EstadoFactura, string> = {
  BORRADOR:  "Borrador",
  PENDIENTE: "Pendiente",
  APROBADO:  "Aprobado",
  RECHAZADO: "Rechazado",
  CANCELADO: "Cancelado",
};

const TIPO_LABEL: Record<TipoDE, string> = {
  FACTURA:      "Factura",
  NOTA_CREDITO: "Nota de Crédito",
  NOTA_DEBITO:  "Nota de Débito",
  AUTOFACTURA:  "Autofactura",
  NOTA_REMISION:"Nota de Remisión",
};

const IVA_LABEL: Record<AfectacionIVA, string> = {
  IVA10:      "10%",
  IVA5:       "5%",
  EXENTA:     "Exenta",
  EXONERADA:  "Exonerada",
};

type Tab = "facturas" | "clientes" | "nueva";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtGs(n: number | string): string {
  return Number(n).toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function numeroFormateado(f: Factura): string {
  return `${f.establecimiento}-${f.puntoExpedicion}-${String(f.numeroDocumento).padStart(7, "0")}`;
}

const emptyItem = (): CreateItemPayload => ({
  descripcion: "",
  unidadMedida: "UNI",
  cantidad: 1,
  precioUnitario: 0,
  descuentoPorcentaje: 0,
  afectacionIVA: "IVA10",
});

// ─── Componente principal ─────────────────────────────────────────────────────

export default function BillingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const role = user?.role ?? "AUDITOR";
  const allowCreate = canCreate("billing", role);

  const [tab, setTab] = useState<Tab>("facturas");

  // Facturas list
  const [page, setPage] = useState(1);
  const [filterEstado, setFilterEstado] = useState<EstadoFactura | "">("");
  const [filterBuscar, setFilterBuscar] = useState("");

  // Detail modal
  const [detalle, setDetalle] = useState<Factura | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Nueva factura form
  const [form, setForm] = useState<CreateFacturaPayload>({
    tipoDE: "FACTURA",
    clienteId: "",
    condicionPago: "CONTADO",
    moneda: "PYG",
    items: [emptyItem()],
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Cliente creation form
  const [clienteForm, setClienteForm] = useState({
    ruc: "", dv: "", razonSocial: "", tipoContribuyente: "JURIDICA" as "JURIDICA" | "FISICA",
  });
  const [clienteError, setClienteError] = useState<string | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const facturasQ = useQuery({
    queryKey: ["billing", "facturas", { page, filterEstado, filterBuscar }],
    queryFn: () => getFacturas({
      estado: filterEstado || undefined,
      buscar: filterBuscar || undefined,
      page,
      limit: 20,
    }),
    placeholderData: (prev) => prev,
  });

  const clientesQ = useQuery({
    queryKey: ["billing", "clientes"],
    queryFn: getClientes,
    staleTime: 2 * 60_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const enviarSifenMut = useMutation({
    mutationFn: enviarSIFEN,
    onSuccess: (updated) => {
      setDetalle(updated);
      setActionMsg(
        updated.estado === "APROBADO"
          ? "✓ Factura aprobada por DNIT/SIFEN"
          : `Estado: ${updated.mensajeSifen}`,
      );
      void qc.invalidateQueries({ queryKey: ["billing", "facturas"] });
    },
    onError: (err) => setActionMsg(getFriendlyApiError(err)),
  });

  const cancelarMut = useMutation({
    mutationFn: cancelarFactura,
    onSuccess: (updated) => {
      setDetalle(updated);
      void qc.invalidateQueries({ queryKey: ["billing", "facturas"] });
    },
    onError: (err) => setActionMsg(getFriendlyApiError(err)),
  });

  const consultarMut = useMutation({
    mutationFn: consultarSIFEN,
    onSuccess: (updated) => {
      setDetalle(updated);
      setActionMsg(`Estado SIFEN: ${updated.mensajeSifen}`);
      void qc.invalidateQueries({ queryKey: ["billing", "facturas"] });
    },
    onError: (err) => setActionMsg(getFriendlyApiError(err)),
  });

  const crearFacturaMut = useMutation({
    mutationFn: createFactura,
    onSuccess: () => {
      toast.success("Factura creada como borrador.");
      setForm({ tipoDE: "FACTURA", clienteId: "", condicionPago: "CONTADO", moneda: "PYG", items: [emptyItem()] });
      setFormError(null);
      setTab("facturas");
      void qc.invalidateQueries({ queryKey: ["billing", "facturas"] });
    },
    onError: (err) => setFormError(getFriendlyApiError(err)),
  });

  const crearClienteMut = useMutation({
    mutationFn: createCliente,
    onSuccess: () => {
      toast.success("Cliente registrado correctamente.");
      setClienteForm({ ruc: "", dv: "", razonSocial: "", tipoContribuyente: "JURIDICA" });
      setClienteError(null);
      void qc.invalidateQueries({ queryKey: ["billing", "clientes"] });
    },
    onError: (err) => setClienteError(getFriendlyApiError(err)),
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const facturas   = facturasQ.data?.data ?? [];
  const total      = facturasQ.data?.meta.total ?? 0;
  const totalPages = facturasQ.data?.meta.totalPages ?? 1;
  const clientes   = clientesQ.data ?? [];
  const actionLoading = enviarSifenMut.isPending || cancelarMut.isPending || consultarMut.isPending;

  // ── Item helpers ──────────────────────────────────────────────────────────

  function setItem(idx: number, field: keyof CreateItemPayload, value: unknown) {
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function calcTotales() {
    let exenta = 0, s5 = 0, s10 = 0, iva5 = 0, iva10 = 0;
    for (const it of form.items) {
      const bruto = Number(it.cantidad) * Number(it.precioUnitario);
      const desc  = bruto * (Number(it.descuentoPorcentaje ?? 0) / 100);
      const neto  = bruto - desc;
      if (it.afectacionIVA === "IVA10")      { s10 += neto; iva10 += neto - neto / 1.1;  }
      else if (it.afectacionIVA === "IVA5")  { s5  += neto; iva5  += neto - neto / 1.05; }
      else                                   { exenta += neto; }
    }
    return { exenta, s5, s10, iva5, iva10, total: exenta + s5 + s10 };
  }

  const totales = calcTotales();

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }}>Facturación Electrónica</h1>
        {allowCreate && (
          <button className="btn btn--primary" onClick={() => setTab("nueva")}>
            + Nueva factura
          </button>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: 24 }} role="tablist" aria-label="Secciones de facturación">
        {(["facturas", "clientes", ...(allowCreate ? ["nueva"] : [])] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? " tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "facturas" ? "Facturas" : t === "clientes" ? "Clientes" : "Nueva Factura"}
          </button>
        ))}
      </div>

      {/* ── TAB: Facturas ──────────────────────────────────────────────────── */}
      {tab === "facturas" && (
        <div>
          <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Buscar por cliente, RUC o N°..."
              value={filterBuscar}
              onChange={(e) => { setFilterBuscar(e.target.value); setPage(1); }}
              style={{ width: 240 }}
              aria-label="Buscar factura"
            />
            <select
              className="input"
              value={filterEstado}
              onChange={(e) => { setFilterEstado(e.target.value as EstadoFactura | ""); setPage(1); }}
              style={{ width: 160 }}
              aria-label="Estado"
            >
              <option value="">Todos los estados</option>
              {(["BORRADOR","PENDIENTE","APROBADO","RECHAZADO","CANCELADO"] as EstadoFactura[]).map((s) => (
                <option key={s} value={s}>{ESTADO_LABEL[s]}</option>
              ))}
            </select>
          </div>

          {facturasQ.isLoading && (
            <p style={{ color: "var(--muted)" }} aria-busy="true">Cargando...</p>
          )}
          {facturasQ.isError && (
            <div className="form-error" role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span>No se pudo cargar las facturas.</span>
              <button className="btn btn--primary" onClick={() => facturasQ.refetch()}>Reintentar</button>
            </div>
          )}

          {!facturasQ.isLoading && facturas.length === 0 && !facturasQ.isError ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
              <p>No hay facturas registradas.</p>
              {allowCreate && (
                <button className="btn btn--primary" onClick={() => setTab("nueva")}>
                  Crear primera factura
                </button>
              )}
            </div>
          ) : facturas.length > 0 && (
            <div>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">N° Factura</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Total</th>
                    <th scope="col">Estado</th>
                    <th scope="col">CDC / Protocolo</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map((f) => (
                    <tr key={f.id}>
                      <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{numeroFormateado(f)}</td>
                      <td>{TIPO_LABEL[f.tipoDE]}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{f.cliente?.razonSocial}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>RUC: {f.cliente?.ruc}-{f.cliente?.dv}</div>
                      </td>
                      <td>{new Date(f.fecha).toLocaleDateString("es-PY")}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                        {f.moneda} {fmtGs(f.totalGeneral)}
                      </td>
                      <td><span className={ESTADO_BADGE[f.estado]}>{ESTADO_LABEL[f.estado]}</span></td>
                      <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {f.cdc ? f.cdc.slice(0, 22) + "…" : "—"}
                        {f.protocoloSifen && (
                          <div style={{ color: "var(--success)" }}>{f.protocoloSifen}</div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="btn btn--sm"
                            onClick={() => { setDetalle(f); setActionMsg(null); }}
                          >
                            Ver
                          </button>
                          {f.estado === "BORRADOR" && allowCreate && (
                            <button
                              className="btn btn--sm btn--primary"
                              onClick={() => enviarSifenMut.mutate(f.id)}
                              disabled={enviarSifenMut.isPending}
                            >
                              Enviar SIFEN
                            </button>
                          )}
                          {f.cdc && f.estado === "PENDIENTE" && (
                            <button
                              className="btn btn--sm"
                              onClick={() => consultarMut.mutate(f.id)}
                              disabled={consultarMut.isPending}
                            >
                              Consultar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>{total} facturas</span>
            <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Ant.</button>
            <span style={{ fontSize: 13 }}>Pág. {page} / {totalPages}</span>
            <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sig. ›</button>
          </div>
        </div>
      )}

      {/* ── TAB: Clientes ─────────────────────────────────────────────────── */}
      {tab === "clientes" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
          <div>
            {clientesQ.isLoading && <p style={{ color: "var(--muted)" }} aria-busy="true">Cargando...</p>}
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">RUC</th>
                  <th scope="col">Razón Social</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Email</th>
                  <th scope="col">Teléfono</th>
                </tr>
              </thead>
              <tbody>
                {clientes.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>
                      Sin clientes registrados
                    </td>
                  </tr>
                ) : clientes.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: "monospace" }}>{c.ruc}-{c.dv}</td>
                    <td style={{ fontWeight: 500 }}>{c.razonSocial}</td>
                    <td>{c.tipoContribuyente === "JURIDICA" ? "Jurídica" : "Física"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td>{c.telefono ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allowCreate && (
            <form
              className="card"
              aria-label="Registrar cliente"
              onSubmit={(e) => {
                e.preventDefault();
                if (!clienteForm.ruc || !clienteForm.razonSocial) {
                  setClienteError("RUC y Razón Social son obligatorios");
                  return;
                }
                setClienteError(null);
                crearClienteMut.mutate({ ...clienteForm, dv: clienteForm.dv || "0" });
              }}
            >
              <h3 style={{ marginBottom: 16, fontWeight: 600 }}>Nuevo Cliente</h3>
              {clienteError && <div className="form-error" role="alert">{clienteError}</div>}
              <div className="form-group">
                <label className="label" htmlFor="cli-ruc">RUC *</label>
                <input
                  id="cli-ruc"
                  className="input"
                  value={clienteForm.ruc}
                  onChange={(e) => setClienteForm((f) => ({ ...f, ruc: e.target.value }))}
                  placeholder="Ej: 80000000"
                  required
                  aria-required="true"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="cli-dv">DV</label>
                <input
                  id="cli-dv"
                  className="input"
                  value={clienteForm.dv}
                  onChange={(e) => setClienteForm((f) => ({ ...f, dv: e.target.value }))}
                  placeholder="0"
                  maxLength={2}
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="cli-rs">Razón Social *</label>
                <input
                  id="cli-rs"
                  className="input"
                  value={clienteForm.razonSocial}
                  onChange={(e) => setClienteForm((f) => ({ ...f, razonSocial: e.target.value }))}
                  required
                  aria-required="true"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="cli-tipo">Tipo Contribuyente</label>
                <select
                  id="cli-tipo"
                  className="input"
                  value={clienteForm.tipoContribuyente}
                  onChange={(e) => setClienteForm((f) => ({ ...f, tipoContribuyente: e.target.value as "JURIDICA" | "FISICA" }))}
                >
                  <option value="JURIDICA">Persona Jurídica</option>
                  <option value="FISICA">Persona Física</option>
                </select>
              </div>
              <button
                className="btn btn--primary"
                type="submit"
                disabled={crearClienteMut.isPending}
                style={{ width: "100%", marginTop: 8 }}
              >
                {crearClienteMut.isPending ? "Guardando..." : "Registrar Cliente"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ── TAB: Nueva Factura ────────────────────────────────────────────── */}
      {tab === "nueva" && allowCreate && (
        <form
          aria-label="Nueva factura"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.clienteId) { setFormError("Seleccioná un cliente"); return; }
            if (!form.items.length) { setFormError("Agregá al menos un ítem"); return; }
            setFormError(null);
            crearFacturaMut.mutate(form);
          }}
        >
          {formError && (
            <div className="form-error" role="alert" style={{ marginBottom: 16 }}>{formError}</div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
            <div className="card">
              <h3 style={{ marginBottom: 16, fontWeight: 600 }}>Datos del Documento</h3>
              <div className="form-group">
                <label className="label" htmlFor="fac-tipo">Tipo de Documento</label>
                <select
                  id="fac-tipo"
                  className="input"
                  value={form.tipoDE}
                  onChange={(e) => setForm((f) => ({ ...f, tipoDE: e.target.value as TipoDE }))}
                >
                  {(["FACTURA","NOTA_CREDITO","NOTA_DEBITO","AUTOFACTURA","NOTA_REMISION"] as TipoDE[]).map((t) => (
                    <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="fac-cliente">Cliente *</label>
                <select
                  id="fac-cliente"
                  className="input"
                  value={form.clienteId}
                  onChange={(e) => setForm((f) => ({ ...f, clienteId: e.target.value }))}
                  required
                  aria-required="true"
                >
                  <option value="">— Seleccionar cliente —</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razonSocial} (RUC: {c.ruc}-{c.dv})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="fac-pago">Condición de Pago</label>
                <select
                  id="fac-pago"
                  className="input"
                  value={form.condicionPago}
                  onChange={(e) => setForm((f) => ({ ...f, condicionPago: e.target.value as CondicionPago }))}
                >
                  <option value="CONTADO">Contado</option>
                  <option value="CREDITO">Crédito</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="fac-moneda">Moneda</label>
                <select
                  id="fac-moneda"
                  className="input"
                  value={form.moneda}
                  onChange={(e) => setForm((f) => ({ ...f, moneda: e.target.value }))}
                >
                  <option value="PYG">Guaraní (PYG)</option>
                  <option value="USD">Dólar (USD)</option>
                  <option value="BRL">Real (BRL)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="fac-obs">Observaciones</label>
                <input
                  id="fac-obs"
                  className="input"
                  value={form.observaciones ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 16, fontWeight: 600 }}>Totales</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Subtotal Exenta/Exonerada", value: totales.exenta },
                  { label: "Subtotal IVA 5%",           value: totales.s5    },
                  { label: "Subtotal IVA 10%",          value: totales.s10   },
                  { label: "IVA 5%",                    value: totales.iva5  },
                  { label: "IVA 10%",                   value: totales.iva10 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <span>{form.moneda} {fmtGs(value)}</span>
                  </div>
                ))}
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18 }}>
                  <span>Total General</span>
                  <span style={{ color: "var(--primary)" }}>{form.moneda} {fmtGs(totales.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Ítems */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600 }}>Ítems de la Factura</h3>
              <button type="button" className="btn btn--sm btn--primary" onClick={addItem}>
                + Agregar ítem
              </button>
            </div>
            {form.items.map((item, idx) => (
              <div
                key={idx}
                style={{ display: "grid", gridTemplateColumns: "2fr 80px 120px 100px 120px 100px auto", gap: 8, marginBottom: 12, alignItems: "end" }}
              >
                <div>
                  {idx === 0 && <label className="label">Descripción</label>}
                  <input
                    className="input"
                    value={item.descripcion}
                    onChange={(e) => setItem(idx, "descripcion", e.target.value)}
                    placeholder="Descripción del producto/servicio"
                    required
                    aria-label={`Descripción ítem ${idx + 1}`}
                  />
                </div>
                <div>
                  {idx === 0 && <label className="label">Unidad</label>}
                  <input
                    className="input"
                    value={item.unidadMedida ?? "UNI"}
                    onChange={(e) => setItem(idx, "unidadMedida", e.target.value)}
                    style={{ textAlign: "center" }}
                    aria-label={`Unidad ítem ${idx + 1}`}
                  />
                </div>
                <div>
                  {idx === 0 && <label className="label">Cantidad</label>}
                  <input
                    className="input"
                    type="number"
                    min="0.0001"
                    step="any"
                    value={item.cantidad}
                    onChange={(e) => setItem(idx, "cantidad", e.target.value)}
                    style={{ textAlign: "right" }}
                    aria-label={`Cantidad ítem ${idx + 1}`}
                  />
                </div>
                <div>
                  {idx === 0 && <label className="label">Precio Unit.</label>}
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="any"
                    value={item.precioUnitario}
                    onChange={(e) => setItem(idx, "precioUnitario", e.target.value)}
                    style={{ textAlign: "right" }}
                    aria-label={`Precio unitario ítem ${idx + 1}`}
                  />
                </div>
                <div>
                  {idx === 0 && <label className="label">IVA</label>}
                  <select
                    className="input"
                    value={item.afectacionIVA}
                    onChange={(e) => setItem(idx, "afectacionIVA", e.target.value)}
                    aria-label={`IVA ítem ${idx + 1}`}
                  >
                    {(["IVA10","IVA5","EXENTA","EXONERADA"] as AfectacionIVA[]).map((a) => (
                      <option key={a} value={a}>{IVA_LABEL[a]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  {idx === 0 && <label className="label">Total</label>}
                  <input
                    className="input"
                    readOnly
                    value={fmtGs(Number(item.cantidad) * Number(item.precioUnitario))}
                    style={{ textAlign: "right", background: "var(--panel-mid)" }}
                    aria-label={`Total ítem ${idx + 1}`}
                  />
                </div>
                <div>
                  {idx === 0 && <label className="label" style={{ visibility: "hidden" }}>x</label>}
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ color: "var(--danger)" }}
                    onClick={() => removeItem(idx)}
                    disabled={form.items.length === 1}
                    aria-label={`Eliminar ítem ${idx + 1}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setTab("facturas")}>Cancelar</button>
            <button type="submit" className="btn btn--primary" disabled={crearFacturaMut.isPending}>
              {crearFacturaMut.isPending ? "Guardando..." : "Crear Factura (Borrador)"}
            </button>
          </div>
        </form>
      )}

      {/* ── Modal: Detalle de Factura ─────────────────────────────────────── */}
      {detalle && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Detalle factura ${numeroFormateado(detalle)}`}
          onClick={(e) => { if (e.target === e.currentTarget) setDetalle(null); }}
        >
          <div className="modal" style={{ maxWidth: 700, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontWeight: 700, marginBottom: 2 }}>
                  {TIPO_LABEL[detalle.tipoDE]} {numeroFormateado(detalle)}
                </h2>
                <span className={ESTADO_BADGE[detalle.estado]}>{ESTADO_LABEL[detalle.estado]}</span>
              </div>
              <button className="btn" onClick={() => setDetalle(null)} aria-label="Cerrar">✕</button>
            </div>

            {actionMsg && (
              <div
                className={detalle.estado === "RECHAZADO" ? "form-error" : "form-success"}
                role="status"
                style={{ marginBottom: 16 }}
              >
                {actionMsg}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <p className="label">Cliente</p>
                <p style={{ fontWeight: 600 }}>{detalle.cliente?.razonSocial}</p>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>RUC: {detalle.cliente?.ruc}-{detalle.cliente?.dv}</p>
              </div>
              <div>
                <p className="label">Timbrado</p>
                <p style={{ fontFamily: "monospace" }}>{detalle.timbrado}</p>
              </div>
              <div>
                <p className="label">Fecha</p>
                <p>{new Date(detalle.fecha).toLocaleDateString("es-PY")}</p>
              </div>
              <div>
                <p className="label">Condición de Pago</p>
                <p>{detalle.condicionPago === "CONTADO" ? "Contado" : "Crédito"}</p>
              </div>
              {detalle.cdc && (
                <div style={{ gridColumn: "span 2" }}>
                  <p className="label">CDC (Código de Control)</p>
                  <p style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", color: "var(--muted)" }}>
                    {detalle.cdc}
                  </p>
                </div>
              )}
              {detalle.protocoloSifen && (
                <div>
                  <p className="label">Protocolo SIFEN</p>
                  <p style={{ fontFamily: "monospace", color: "var(--success)" }}>{detalle.protocoloSifen}</p>
                </div>
              )}
              {detalle.mensajeSifen && (
                <div>
                  <p className="label">Mensaje DNIT</p>
                  <p style={{ fontSize: 13 }}>{detalle.mensajeSifen}</p>
                </div>
              )}
            </div>

            <table className="table" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Descripción</th>
                  <th scope="col" style={{ textAlign: "right" }}>Cant.</th>
                  <th scope="col" style={{ textAlign: "right" }}>P. Unit.</th>
                  <th scope="col">IVA</th>
                  <th scope="col" style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {detalle.items?.map((it) => (
                  <tr key={it.id}>
                    <td>{it.orden}</td>
                    <td>{it.descripcion}</td>
                    <td style={{ textAlign: "right" }}>{Number(it.cantidad).toLocaleString("es-PY")}</td>
                    <td style={{ textAlign: "right" }}>{fmtGs(it.precioUnitario)}</td>
                    <td><span className="badge">{IVA_LABEL[it.afectacionIVA]}</span></td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtGs(it.totalNeto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>Total General</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16, color: "var(--primary)" }}>
                    {detalle.moneda} {fmtGs(detalle.totalGeneral)}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {detalle.estado === "BORRADOR" && allowCreate && (
                <button
                  className="btn btn--primary"
                  onClick={() => enviarSifenMut.mutate(detalle.id)}
                  disabled={actionLoading}
                >
                  {enviarSifenMut.isPending ? "Enviando..." : "Enviar al SIFEN"}
                </button>
              )}
              {detalle.cdc && (
                <a
                  href={`/api/billing/facturas/${detalle.id}/xml`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                >
                  Descargar XML
                </a>
              )}
              {detalle.codigoQR && (
                <a href={detalle.codigoQR} target="_blank" rel="noreferrer" className="btn">
                  Ver KUDE / QR
                </a>
              )}
              {detalle.cdc && detalle.estado === "PENDIENTE" && (
                <button
                  className="btn"
                  onClick={() => consultarMut.mutate(detalle.id)}
                  disabled={actionLoading}
                >
                  {consultarMut.isPending ? "Consultando..." : "Consultar SIFEN"}
                </button>
              )}
              {detalle.estado !== "CANCELADO" && detalle.estado !== "APROBADO" && allowCreate && (
                <button
                  className="btn"
                  style={{ color: "var(--danger)" }}
                  onClick={() => {
                    if (!confirm("¿Cancelar esta factura? La acción no se puede revertir.")) return;
                    cancelarMut.mutate(detalle.id);
                  }}
                  disabled={actionLoading}
                >
                  {cancelarMut.isPending ? "Cancelando..." : "Cancelar factura"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
