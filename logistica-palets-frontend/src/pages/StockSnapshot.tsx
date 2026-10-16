import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useWarehouse } from "../contexts/WarehouseContext";
import {
  stockSnapshotFromLots,
  revertStockSnapshot,
  type StockLotSnapshotResult,
  type StockLotSnapshotProductResult,
  type StockSnapshotProductStatus,
  type StockSnapshotRevertResult,
} from "../api/movements";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { formatDateOnly } from "../utils/dateFormat";

const STATUS_LABELS: Record<StockSnapshotProductStatus, string> = {
  ADJUSTED: "Ajustado",
  WOULD_ADJUST: "Se ajustaría",
  SKIPPED_NOT_FOUND: "Código no existe en catálogo",
  SKIPPED_INACTIVE: "Material inactivo",
  SKIPPED_ALREADY_HAS_STOCK: "Ya tiene stock cargado",
  SKIPPED_NON_POSITIVE: "Neto cero o negativo",
  ERROR: "Error al crear ajuste",
};

function FilePicker({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div
        style={{
          border: "2px dashed var(--border)", borderRadius: 8, padding: "12px 16px", textAlign: "center",
          cursor: "pointer", background: file ? "var(--primary-light)" : "var(--bg)",
        }}
        onClick={() => inputRef.current?.click()}
      >
        {file ? (
          <span style={{ fontSize: 13, fontWeight: 600 }}>
             {file.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({(file.size / 1024).toFixed(0)} KB)</span>
          </span>
        ) : (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Click para seleccionar (.xlsx o .csv)</span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}

export default function StockSnapshotPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [lotFile, setLotFile] = useState<File | null>(null);
  const [result, setResult] = useState<StockLotSnapshotResult | null>(null);

  // Depósito destino: arranca en el activo de la sesión, pero es una elección
  // propia de esta pantalla. El stock entero de la carga queda en el depósito
  // que se elija acá, así que no se hereda en silencio del selector global.
  const { allowedWarehouses, activeWarehouseId } = useWarehouse();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const targetWarehouseId = warehouseId ?? activeWarehouseId ?? null;
  const targetWarehouse = allowedWarehouses.find((w) => w.id === targetWarehouseId) ?? null;

  const [statusFilter, setStatusFilter] = useState<StockSnapshotProductStatus | "ALL">("ALL");
  const [revertResult, setRevertResult] = useState<StockSnapshotRevertResult | null>(null);

  const revertPreviewMut = useMutation({
    mutationFn: () => revertStockSnapshot(false),
    onSuccess: (res) => {
      setRevertResult(res);
      toast.success(`${res.totalFound} movimiento(s) de carga inicial encontrados.`);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const revertCommitMut = useMutation({
    mutationFn: () => revertStockSnapshot(true),
    onSuccess: (res) => {
      setRevertResult(res);
      toast.success(`${res.totalReverted} movimiento(s) revertidos.`);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const previewMut = useMutation({
    mutationFn: () => stockSnapshotFromLots(lotFile!, false, targetWarehouseId ?? undefined),
    onSuccess: (res) => {
      setResult(res);
      toast.success("Vista previa calculada. Revisá el resultado antes de confirmar.");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });
  const commitMut = useMutation({
    mutationFn: () => stockSnapshotFromLots(lotFile!, true, targetWarehouseId ?? undefined),
    onSuccess: (res) => {
      setResult(res);
      toast.success(`Stock inicial cargado: ${res.summary.adjusted} materiales ajustados (${res.summary.newProducts} nuevos).`);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const filteredProducts = useMemo(() => {
    if (!result) return [];
    if (statusFilter === "ALL") return result.products;
    return result.products.filter((p) => p.status === statusFilter);
  }, [result, statusFilter]);

  if (user?.role !== "ADMIN") {
    return (
      <div className="empty-state">
        <p>Esta sección es exclusiva para administradores.</p>
      </div>
    );
  }

  // Sin depósito no se calcula ni la vista previa: el backend lo exige cuando
  // hay más de uno activo, y un ensayo que no dice dónde va a caer el stock no
  // sirve para decidir.
  const canPreview = !!lotFile && !!targetWarehouseId && !previewMut.isPending && !commitMut.isPending;
  const canCommit = !!result && !result.committed && result.summary.adjusted > 0 && !commitMut.isPending;

  function handleCommit() {
    if (!result) return;
    const newProductsNote = result.summary.newProducts > 0
      ? ` (${result.summary.newProducts} productos nuevos se crearán en el catálogo)`
      : "";
    // El depósito va en la confirmación porque es lo irreversible en cuanto
    // el depósito empieza a operar: después de eso la carga ya no se revierte.
    const destino = result.warehouse?.name ?? targetWarehouse?.name ?? "(sin determinar)";
    if (!window.confirm(
      `Se van a crear ${result.summary.adjusted} movimientos de ajuste de stock inicial${newProductsNote}, ` +
      `en el depósito "${destino}" (ubicación STOCK-INICIAL). ¿Confirmás?`,
    )) return;
    if (!window.confirm(`Confirmación final: esto modifica el stock real de "${destino}". ¿Continuar?`)) return;
    commitMut.mutate();
  }

  function handleRevertCommit() {
    if (!revertResult) return;
    if (!window.confirm(`Se van a revertir ${revertResult.totalFound} movimiento(s) de carga inicial (se descuenta el stock que sumaron, se borran lotes/pallets asociados y se borran los movimientos). ¿Confirmás?`)) return;
    if (!window.confirm("Confirmación final: esto modifica el stock real del sistema. ¿Continuar?")) return;
    revertCommitMut.mutate();
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 8 }}>Carga inicial de inventario</h1>
      <p style={{ color: "var(--muted)", marginBottom: 28, fontSize: 14 }}>
        Una fila = un lote de un material. La identidad del lote es <strong>material + lote de proveedor</strong>,
        igual que al registrar una entrada; el lote SAP se guarda como dato informativo. Si un mismo lote de
        proveedor aparece repetido con <strong>vencimientos distintos</strong>, esas filas no se importan y se
        listan como error. Cada lote genera su palet lógico en la ubicación temporal <code>STOCK-INICIAL</code>,
        pendiente de ubicar. Si un material no existe en el catálogo, se crea automáticamente.
      </p>

      {/* Las columnas que acepta no estaban escritas en ninguna parte: el
          operador subía la planilla del cliente y la vista previa le devolvía
          cero filas sin decir qué le faltaba. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Columnas que lee</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, marginBottom: 12 }}>
          Se lee la <strong>primera hoja</strong> del archivo. Los encabezados se buscan solos (no hace
          falta que estén en la fila 1) y no distinguen mayúsculas ni tildes. Las columnas que no figuran
          acá se ignoran.
        </p>
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr><th>Columna</th><th>Nombres aceptados</th><th>¿Obligatoria?</th></tr>
          </thead>
          <tbody>
            {[
              ["Código de material", "CODIGO · COD · CODIGO MATERIAL", "Sí"],
              ["Lote de proveedor", "LOTE PROVEEDOR · LOTE DE PROVEEDOR", "Sí — es la clave del lote"],
              ["Cantidad", "CANTIDAD · STOCK · STOCK LU", "Sí"],
              ["Descripción", "DESCRIPCION · MATERIAL · MATERIA", "Sólo si el material es nuevo"],
              ["Unidad de medida", "UM · UMB · UNIDAD DE MEDIDA", "No (queda sin unidad)"],
              ["Fecha de vencimiento", "FECHA DE VENCIMIENTO · VENCIMIENTO", "No (el lote no entra al FEFO por fecha)"],
              ["Lote SAP", "LOTE SAP · LOTE · LOTE INTERNO", "No (informativo)"],
            ].map(([campo, alias, obligatoria]) => (
              <tr key={campo}>
                <td style={{ fontWeight: 600 }}>{campo}</td>
                <td style={{ color: "var(--muted)" }}>{alias}</td>
                <td>{obligatoria}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 20, borderColor: "var(--badge-exit-border)" }}>
        <h3 style={{ fontWeight: 700, marginBottom: 8, color: "var(--danger)" }}>Revertir carga anterior</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Busca los ajustes creados por una carga previa de este snapshot (categoría "Carga inicial"),
          descuenta el stock que sumaron, borra lotes/pallets asociados y los movimientos. No toca productos.
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: revertResult ? 14 : 0 }}>
          <button className="btn" disabled={revertPreviewMut.isPending || revertCommitMut.isPending} onClick={() => revertPreviewMut.mutate()}>
            {revertPreviewMut.isPending ? "Buscando..." : "Buscar ajustes a revertir"}
          </button>
          <button
            className="btn btn--danger"
            disabled={!revertResult || revertResult.committed || revertResult.totalFound === 0 || revertCommitMut.isPending}
            onClick={handleRevertCommit}
          >
            {revertCommitMut.isPending ? "Revirtiendo..." : `Revertir ${revertResult?.totalFound ?? ""} movimiento(s)`}
          </button>
        </div>
        {revertResult && (
          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead><tr><th>Código</th><th>Descripción</th><th style={{ textAlign: "right" }}>Cantidad</th><th>Estado</th></tr></thead>
              <tbody>
                {revertResult.items.map((i) => (
                  <tr key={i.movementId}>
                    <td>{i.code}</td>
                    <td>{i.description}</td>
                    <td style={{ textAlign: "right" }}>{i.quantity.toLocaleString("es-PY")}</td>
                    <td>{revertResult.committed ? (i.reverted ? "✓ Revertido" : `Error: ${i.error}`) : "Pendiente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Archivo y destino</h3>
        <FilePicker label="Planilla de stock por lote" file={lotFile} onChange={setLotFile} />

        {/* Elegir el depósito acá y no heredarlo del selector global: todo el
            inventario de la carga queda en este depósito, y en cuanto empieza
            a operar la carga ya no se puede revertir. */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
            Depósito destino
          </div>
          <select
            value={targetWarehouseId ?? ""}
            onChange={(e) => setWarehouseId(e.target.value || null)}
            style={{
              width: "100%", padding: "9px 12px", borderRadius: "var(--radius)",
              border: "1px solid var(--border)", background: "var(--bg)",
              color: "var(--text)", fontSize: 14,
            }}
          >
            <option value="">— Elegí el depósito —</option>
            {allowedWarehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>
            {targetWarehouse
              ? <>El stock queda en la ubicación <code>STOCK-INICIAL</code> de <strong>{targetWarehouse.name}</strong>, pendiente de ubicar.</>
              : "Hace falta elegirlo para calcular la vista previa."}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button className="btn btn--primary" disabled={!canPreview} onClick={() => previewMut.mutate()}>
            {previewMut.isPending ? "Calculando..." : "Vista previa (no modifica nada)"}
          </button>
          <button className="btn btn--danger" disabled={!canCommit} onClick={handleCommit}>
            {commitMut.isPending ? "Cargando..." : "Confirmar carga de stock"}
          </button>
        </div>
        {result?.committed && (
          <p style={{ fontSize: 13, color: "var(--success)", marginTop: 10, marginBottom: 0 }}>
            ✓ Carga confirmada. Para volver a correrlo necesitás recalcular la vista previa.
          </p>
        )}
      </div>

      {result && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ fontWeight: 700, marginBottom: 14 }}>
              {result.committed ? "Resultado" : "Vista previa"}
            </h3>

            {/* Se lee siempre la PRIMERA hoja del libro. Cuando la carga sale
                corta, la causa casi siempre es que esa hoja no era la del
                stock — así que decir qué se leyó ahorra abrir el Excel a
                adivinar. Las columnas ignoradas delatan el otro caso: un
                encabezado que el importador no reconoce. */}
            <div
              style={{
                marginBottom: 14, padding: "8px 12px", borderRadius: "var(--radius)",
                background: "var(--bg)", border: "1px solid var(--border)", fontSize: 12.5,
                color: "var(--muted)",
              }}
            >
              Leído de la hoja <strong style={{ color: "var(--text)" }}>{result.source.sheetName}</strong>,
              con los encabezados en la fila <strong style={{ color: "var(--text)" }}>{result.source.headerRow}</strong>.
              {result.source.ignoredHeaders.length > 0 && (
                <>
                  {" "}Columnas ignoradas:{" "}
                  <span style={{ color: "var(--text)" }}>
                    {result.source.ignoredHeaders.join(", ")}
                  </span>.
                </>
              )}
              {result.warehouse && (
                <>
                  <br />
                  {result.committed ? "Cargado en" : "Se carga en"}{" "}
                  <strong style={{ color: "var(--text)" }}>{result.warehouse.name}</strong>
                  {" "}→ ubicación <code>STOCK-INICIAL</code>.
                </>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 12 }}>
              {[
                { label: "Materiales", value: result.totals.materials, tone: "var(--primary-text)" },
                { label: "Lotes", value: result.totals.lots, tone: "var(--primary-text)" },
                { label: "Registros", value: result.totals.records, tone: "var(--primary-text)" },
                { label: "Advertencias", value: result.totals.warnings, tone: result.totals.warnings ? "var(--warning, #b8860b)" : "var(--muted)" },
                { label: "Errores", value: result.totals.errors, tone: result.totals.errors ? "var(--danger)" : "var(--muted)" },
              ].map(({ label, value, tone }) => (
                <div key={label} style={{ textAlign: "center", padding: "10px 6px", background: "var(--panel)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: tone }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
              {[
                { label: "Filas leídas", value: result.sourceRows },
                { label: result.committed ? "Materiales cargados" : "Se cargarían", value: result.summary.adjusted },
                { label: "Materiales nuevos", value: result.summary.newProducts },
                { label: "Ya tenían stock", value: result.summary.skippedAlreadyHasStock },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign: "center", padding: "8px 6px", background: "var(--bg)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {result.integrity && (
              <div
                style={{
                  marginBottom: 16, padding: "10px 14px", borderRadius: "var(--radius)", fontSize: 13,
                  border: `1px solid ${result.integrity.consistent ? "var(--border)" : "var(--danger)"}`,
                  background: result.integrity.consistent ? "var(--bg)" : "var(--primary-light)",
                }}
              >
                <strong>{result.integrity.consistent ? "✓ Inventario consistente" : "⚠ Inconsistencia detectada"}</strong>
                <div style={{ color: "var(--muted)", marginTop: 4 }}>
                  Stock {result.integrity.stockTotal.toLocaleString("es-PY")} · Lotes{" "}
                  {result.integrity.lotsTotal.toLocaleString("es-PY")} · Palets{" "}
                  {result.integrity.palletsTotal.toLocaleString("es-PY")}
                </div>
                {!result.integrity.consistent && (
                  <div style={{ color: "var(--danger)", marginTop: 4 }}>
                    {result.integrity.mismatches.length} material(es) con stock, lotes y palets que no coinciden.
                  </div>
                )}
              </div>
            )}
            {result.rowIssues.length > 0 && (
              <details open={result.totals.errors > 0}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {result.totals.errors} error(es) · {result.totals.warnings} advertencia(s) — ver detalle por fila
                </summary>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>
                  Los <strong>errores</strong> descartan la fila; las <strong>advertencias</strong> se importan igual pero conviene revisarlas.
                </p>
                <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, marginTop: 8 }}>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead><tr><th>Tipo</th><th>Fila</th><th>Material</th><th>Motivo</th></tr></thead>
                    <tbody>
                      {[...result.rowIssues]
                        .sort((a, b) => (a.severity === b.severity ? a.row - b.row : a.severity === "ERROR" ? -1 : 1))
                        .slice(0, 300)
                        .map((i, idx) => (
                          <tr key={idx}>
                            <td>
                              <span
                                className="badge"
                                style={{ color: i.severity === "ERROR" ? "var(--danger)" : undefined, whiteSpace: "nowrap" }}
                              >
                                {i.severity === "ERROR" ? "Error" : "Advertencia"}
                              </span>
                            </td>
                            <td>{i.row}</td><td>{i.code ?? "-"}</td><td>{i.reason}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {result.rowIssues.length > 300 && (
                    <p style={{ fontSize: 12, color: "var(--muted)", padding: 8, margin: 0 }}>
                      Mostrando 300 de {result.rowIssues.length}.
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontWeight: 700, margin: 0 }}>Detalle por producto ({filteredProducts.length})</h3>
              <select
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StockSnapshotProductStatus | "ALL")}
                style={{ width: 260 }}
              >
                <option value="ALL">Todos los estados</option>
                {(Object.keys(STATUS_LABELS) as StockSnapshotProductStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Código</th><th>Descripción</th><th>Lotes</th>
                    <th style={{ textAlign: "right" }}>Neto</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredProducts as StockLotSnapshotProductResult[]).map((p) => (
                    <tr key={p.code}>
                      <td>
                        <strong>{p.code}</strong>
                        {p.isNewProduct && <div><span className="badge badge--entry" style={{ fontSize: 10 }}>Nuevo</span></div>}
                      </td>
                      <td>{p.description || "-"}</td>
                      <td>
                        <details>
                          <summary style={{ cursor: "pointer", fontSize: 12 }}>{p.lots.length} lote(s)</summary>
                          <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 11, color: "var(--muted)" }}>
                            {p.lots.map((l, i) => (
                              <li key={i}>
                                <strong>{l.lotCode}</strong>
                                {l.sapLot ? ` · SAP ${l.sapLot}` : ""} — {l.quantity.toLocaleString("es-PY")}
                                {l.fechaVencimiento ? ` — vto. ${formatDateOnly(l.fechaVencimiento)}` : " — sin vto."}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{p.net.toLocaleString("es-PY")}</td>
                      <td>
                        <span className={`badge ${p.status === "ADJUSTED" || p.status === "WOULD_ADJUST" ? "badge--entry" : ""}`}>
                          {STATUS_LABELS[p.status]}
                        </span>
                        {p.error && <div style={{ fontSize: 11, color: "var(--danger)" }}>{p.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
