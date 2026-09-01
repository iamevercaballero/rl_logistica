import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkImportProducts,
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
  type BulkImportResult,
  type Product,
} from "../api/products";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete, canUpdate } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

const UNITS_OF_MEASURE = [
  { value: "UN", label: "UN — Unidad" },
  { value: "KG", label: "KG — Kilogramo" },
  { value: "LT", label: "LT — Litro" },
  { value: "ML", label: "ML — Mililitro" },
  { value: "GR", label: "GR — Gramo" },
  { value: "TN", label: "TN — Tonelada" },
  { value: "TS", label: "TS — Tonelada seca" },
  { value: "HL", label: "HL — Hectolitro" },
  { value: "MT", label: "MT — Metro" },
  { value: "M2", label: "M2 — Metro cuadrado" },
  { value: "M3", label: "M3 — Metro cúbico" },
  { value: "PQ", label: "PQ — Paquete" },
  { value: "CJ", label: "CJ — Caja" },
  { value: "PL", label: "PL — Pallet" },
  { value: "PC", label: "PC — Pieza" },
  { value: "PR", label: "PR — Par" },
  { value: "DO", label: "DO — Docena" },
  { value: "GL", label: "GL — Galón" },
  { value: "RL", label: "RL — Rollo" },
  { value: "BL", label: "BL — Bolsa" },
  { value: "FD", label: "FD — Fardo" },
] as const;

export default function ProductsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("products", role) : false;
  const allowUpdate = role ? canUpdate("products", role) : false;
  const allowDelete = role ? canDelete("products", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const codeId = useId();
  const descId = useId();
  const umId = useId();

  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("UN");
  // Default true: hasta hoy todos los materiales autocompletaban lote SAP.
  const [usesSapLot, setUsesSapLot] = useState(true);
  const [stackable, setStackable] = useState(true);
  const [maxStackLevel, setMaxStackLevel] = useState("");
  const [canReceiveWeightOnTop, setCanReceiveWeightOnTop] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce 300ms
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchInput]);

  const codeError = useMemo(() => {
    const value = code.trim();
    if (!value) return "Ingresá un código de material.";
    if (value.length < 2 || value.length > 80) return "El código debe tener entre 2 y 80 caracteres.";
    return "";
  }, [code]);

  const descriptionError = useMemo(() => {
    const value = description.trim();
    if (!value) return "Ingresá una descripción.";
    if (value.length < 2 || value.length > 160) return "La descripción debe tener entre 2 y 160 caracteres.";
    return "";
  }, [description]);

  const { data: items = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["products", search],
    queryFn: () => listProducts(search || undefined),
  });

  const createMut = useMutation({
    mutationFn: createProduct,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Material ${created.code} creado`);
      setCode("");
      setDescription("");
      setUnitOfMeasure("UN");
      setStackable(true);
      setMaxStackLevel("");
      setCanReceiveWeightOnTop(true);
      setSubmitted(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      // El backend desactiva en vez de borrar cuando el material tiene historia.
      toast.success(
        res.deactivated
          ? "Material desactivado. Se conserva porque tiene movimientos registrados."
          : "Material eliminado",
      );
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  // Carga masiva desde Excel/CSV
  const [showBulkImport, setShowBulkImport] = useState(false);

  // Edición de material existente (modal)
  const [editing, setEditing] = useState<Product | null>(null);
  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateProduct>[1] }) =>
      updateProduct(id, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Material ${updated.code} actualizado`);
      setEditing(null);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!allowCreate || codeError || descriptionError) return;
    createMut.mutate({
      code: code.trim(),
      description: description.trim(),
      unitOfMeasure: unitOfMeasure,
      active: true,
      usesSapLot,
      stackable,
      maxStackLevel: maxStackLevel ? Number(maxStackLevel) : undefined,
      canReceiveWeightOnTop,
    });
  }

  function handleDelete(item: Product) {
    if (!allowDelete) return;
    const mensaje =
      `¿Dar de baja el material ${item.code}?\n\n` +
      `Si tiene movimientos registrados quedará inactivo y podrá reactivarse después. ` +
      `Si nunca se usó, se elimina definitivamente.`;
    if (!window.confirm(mensaje)) return;
    deleteMut.mutate(item.id);
  }

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Materiales</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
            Catálogo de materiales operativos. {!allowCreate ? "Modo lectura." : ""}
          </p>
        </div>
        {allowCreate && (
          <button className="btn" type="button" onClick={() => setShowBulkImport(true)}>
            Carga masiva
          </button>
        )}
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, maxWidth: 400 }}>
        <div style={{ position: "relative", flex: 1 }}>
          {/* Magnifying glass icon */}
          <svg
            width="14" height="14"
            viewBox="0 0 24 24"
            fill="none" stroke="var(--muted)" strokeWidth="2"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar código o descripción…"
            aria-label="Buscar materiales"
            style={{ paddingLeft: 32, paddingRight: searchInput ? 30 : 10, width: "100%", boxSizing: "border-box" }}
          />
          {/* Clear button */}
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Limpiar búsqueda"
              style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer",
                color: "var(--muted)", padding: 2, lineHeight: 1, borderRadius: "50%",
                display: "flex", alignItems: "center",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {search
            ? `${items.length} resultado${items.length !== 1 ? "s" : ""}`
            : `${items.length} material${items.length !== 1 ? "es" : ""}`}
        </span>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }} aria-label="Nuevo material">
        <input
          id={codeId}
          className="input"
          disabled={!allowCreate || saving}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Código material"
          aria-label="Código de material"
          aria-invalid={submitted && !!codeError}
          aria-describedby={submitted && codeError ? `${codeId}-err` : undefined}
        />
        <input
          id={descId}
          className="input"
          disabled={!allowCreate || saving}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descripción"
          aria-label="Descripción"
          aria-invalid={submitted && !!descriptionError}
          aria-describedby={submitted && descriptionError ? `${descId}-err` : undefined}
          style={{ minWidth: 320 }}
        />
        <select
          id={umId}
          className="input"
          disabled={!allowCreate || saving}
          value={unitOfMeasure}
          onChange={(event) => setUnitOfMeasure(event.target.value)}
          aria-label="Unidad de medida"
          style={{ width: 200 }}
        >
          {UNITS_OF_MEASURE.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {createMut.isPending ? "Guardando..." : "Guardar material"}
        </button>
      </form>

      {/* Stacking rules row */}
      {allowCreate && (
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
            title="El material se maneja con Lote SAP (Lote Ypané). Si se desmarca, las entradas no generan ni guardan lote SAP para este material.">
            <input
              type="checkbox"
              checked={usesSapLot}
              onChange={(e) => setUsesSapLot(e.target.checked)}
              disabled={saving}
            />
            Utiliza Lote SAP
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={stackable}
              onChange={(e) => setStackable(e.target.checked)}
              disabled={saving}
            />
            Apilable
          </label>
          {stackable && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Niveles máx.:</span>
              <input
                className="input"
                type="number"
                min={1}
                max={20}
                value={maxStackLevel}
                onChange={(e) => setMaxStackLevel(e.target.value)}
                disabled={saving}
                placeholder="Sin límite"
                style={{ width: 90 }}
                aria-label="Niveles máximos de apilamiento"
              />
            </label>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={canReceiveWeightOnTop}
              onChange={(e) => setCanReceiveWeightOnTop(e.target.checked)}
              disabled={saving}
            />
            Recibe peso encima
          </label>
        </div>
      )}

      {submitted && codeError ? <p id={`${codeId}-err`} className="form-error" role="alert">{codeError}</p> : null}
      {submitted && descriptionError ? <p id={`${descId}-err`} className="form-error" role="alert">{descriptionError}</p> : null}

      {isLoading ? <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando…</p> : null}
      {isError ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
          <button className="btn btn--primary" onClick={() => refetch()}>Reintentar</button>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        items.length === 0 ? (
          <p>No hay materiales registrados</p>
        ) : (
          <table className="table" aria-label="Lista de materiales">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descripción</th>
                <th scope="col">UM</th>
                <th scope="col" style={{ textAlign: "center" }} title="Indica si este material puede colocarse sobre otro pallet.">Apilable</th>
                <th scope="col" style={{ textAlign: "center" }} title="Indica si otro pallet puede colocarse encima de este material sin dañarlo.">Recibe peso</th>
                <th scope="col">Estado</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.code}</strong></td>
                  <td>{item.description}</td>
                  <td><span className="badge">{item.unitOfMeasure ?? "-"}</span></td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`badge ${item.stackable === false ? "" : "badge--entry"}`}
                      title={item.stackable === false ? "No apilable" : "Apilable"}>
                      {item.stackable === false ? "No" : "Sí"}
                    </span>
                    {item.stackable !== false && item.maxStackLevel != null && (
                      <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>≤{item.maxStackLevel}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`badge ${item.canReceiveWeightOnTop === false ? "" : "badge--entry"}`}
                      title={item.canReceiveWeightOnTop === false ? "No recibe peso encima" : "Recibe peso encima"}>
                      {item.canReceiveWeightOnTop === false ? "No" : "Sí"}
                    </span>
                  </td>
                  <td>
                    <span className={item.active ? "badge badge--entry" : "badge"}>
                      {item.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {allowUpdate ? (
                      <button
                        className="btn"
                        onClick={() => setEditing(item)}
                        disabled={saving}
                        aria-label={`Editar material ${item.code}`}
                        style={{ marginRight: allowDelete ? 6 : 0 }}
                      >
                        Editar
                      </button>
                    ) : null}
                    {allowDelete ? (
                      <button
                        className="btn btn--danger"
                        onClick={() => handleDelete(item)}
                        disabled={saving}
                        aria-label={`Dar de baja material ${item.code}`}
                      >
                        Dar de baja
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {/* Leyenda explicativa de atributos logísticos */}
      <div style={{ marginTop: 12, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        <span><strong style={{ color: "var(--text)" }}>Apilable:</strong> el material puede colocarse sobre otro pallet.</span>
        <span><strong style={{ color: "var(--text)" }}>Recibe peso encima:</strong> otro pallet puede colocarse encima sin dañarlo.</span>
      </div>

      {editing && (
        <EditProductModal
          product={editing}
          units={UNITS_OF_MEASURE}
          saving={updateMut.isPending}
          onCancel={() => setEditing(null)}
          onSave={(payload) => updateMut.mutate({ id: editing.id, payload })}
        />
      )}

      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["products"] })}
        />
      )}
    </div>
  );
}

// ── Modal de carga masiva de materiales (Excel/CSV) ─────────────────────────────
function BulkImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const mut = useMutation({
    mutationFn: (f: File) => bulkImportProducts(f),
    onSuccess: (res) => {
      setResult(res);
      if (res.imported > 0) {
        toast.success(`${res.imported} material${res.imported !== 1 ? "es" : ""} importado${res.imported !== 1 ? "s" : ""}`);
        onImported();
      }
      if (res.skipped > 0) {
        toast.error(`${res.skipped} fila${res.skipped !== 1 ? "s" : ""} omitida${res.skipped !== 1 ? "s" : ""}, revisá el detalle`);
      }
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
  }

  function handleImport() {
    if (!file) return;
    mut.mutate(file);
  }

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      role="dialog" aria-modal="true" aria-label="Carga masiva de materiales"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 560, display: "grid", gap: 12, maxHeight: "90vh", overflowY: "auto" }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Carga masiva de materiales</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          Subí un Excel o CSV con columnas Código, Descripción, UM y Apilable. Se omiten filas con código o
          descripción vacíos, UM vacía, o código duplicado (en el archivo o ya existente).
        </p>

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
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Hacé click para seleccionar un archivo (.xlsx o .csv)</span>
          )}
          <input ref={inputRef} type="file" accept=".xlsx,.csv" onChange={handleFileChange} style={{ display: "none" }} />
        </div>

        {result && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
              <span><strong>{result.totalRows}</strong> filas leídas</span>
              <span style={{ color: "var(--success)" }}><strong>{result.imported}</strong> importados</span>
              <span style={{ color: result.skipped ? "var(--danger)" : "var(--muted)" }}>
                <strong>{result.skipped}</strong> omitidos
              </span>
            </div>
            {result.errors.length > 0 && (
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
                <table className="table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr><th scope="col">Fila</th><th scope="col">Código</th><th scope="col">Motivo</th></tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td>{e.row}</td>
                        <td>{e.code ?? "-"}</td>
                        <td>{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn btn--primary" onClick={handleImport} disabled={!file || mut.isPending}>
            {mut.isPending ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de edición de material ───────────────────────────────────────────────
type EditPayload = Parameters<typeof updateProduct>[1];

function EditProductModal({
  product, units, saving, onCancel, onSave,
}: {
  product: Product;
  units: ReadonlyArray<{ value: string; label: string }>;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: EditPayload) => void;
}) {
  const [code, setCode] = useState(product.code);
  const [description, setDescription] = useState(product.description);
  const [unitOfMeasure, setUnitOfMeasure] = useState(product.unitOfMeasure ?? "UN");
  const [usesSapLot, setUsesSapLot] = useState(product.usesSapLot !== false);
  const [stackable, setStackable] = useState(product.stackable !== false);
  const [maxStackLevel, setMaxStackLevel] = useState(product.maxStackLevel != null ? String(product.maxStackLevel) : "");
  const [canReceiveWeightOnTop, setCanReceiveWeightOnTop] = useState(product.canReceiveWeightOnTop !== false);
  const [active, setActive] = useState(product.active);

  const codeError = code.trim().length < 2 || code.trim().length > 80;
  const descError = description.trim().length < 2 || description.trim().length > 160;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (codeError || descError) return;
    onSave({
      code: code.trim(),
      description: description.trim(),
      unitOfMeasure,
      usesSapLot,
      stackable,
      maxStackLevel: stackable && maxStackLevel ? Number(maxStackLevel) : null,
      canReceiveWeightOnTop,
      active,
    });
  }

  return (
    <div
      onMouseDown={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      role="dialog" aria-modal="true" aria-label={`Editar material ${product.code}`}
    >
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card"
        style={{ width: "100%", maxWidth: 460, display: "grid", gap: 12, maxHeight: "90vh", overflowY: "auto" }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Editar material</h2>

        <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
          CÓDIGO
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={codeError} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
          DESCRIPCIÓN
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={descError} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
          UNIDAD DE MEDIDA
          <select className="input" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)}>
            {units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
            title="El material puede colocarse sobre otro pallet.">
            <input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
            Apilable
          </label>
          {stackable && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Niveles máx.:</span>
              <input className="input" type="number" min={1} max={20} value={maxStackLevel}
                onChange={(e) => setMaxStackLevel(e.target.value)} placeholder="Sin límite" style={{ width: 90 }} />
            </label>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
            title="Otro pallet puede colocarse encima sin dañarlo.">
            <input type="checkbox" checked={canReceiveWeightOnTop} onChange={(e) => setCanReceiveWeightOnTop(e.target.checked)} />
            Recibe peso encima
          </label>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
          title="El material se maneja con Lote SAP (Lote Ypané). Si se desmarca, las entradas no generan ni guardan lote SAP para este material.">
          <input type="checkbox" checked={usesSapLot} onChange={(e) => setUsesSapLot(e.target.checked)} />
          Utiliza Lote SAP
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activo
        </label>

        {(codeError || descError) && (
          <p className="form-error" role="alert" style={{ marginBottom: 0 }}>
            Revisá código (2-80) y descripción (2-160).
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={saving || codeError || descError}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}
