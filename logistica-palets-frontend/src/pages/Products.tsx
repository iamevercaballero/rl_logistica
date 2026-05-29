import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createProduct, deleteProduct, listProducts, type Product } from "../api/products";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
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
  const allowDelete = role ? canDelete("products", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const codeId = useId();
  const descId = useId();
  const umId = useId();

  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("UN");
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
      setSubmitted(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Material eliminado");
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
    });
  }

  function handleDelete(item: Product) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar material ${item.code}?`)) return;
    deleteMut.mutate(item.id);
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Materiales</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Catálogo de materiales operativos. {!allowCreate ? "Modo lectura." : ""}
        </p>
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
        {search && (
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {items.length} resultado{items.length !== 1 ? "s" : ""}
          </span>
        )}
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
                  <td>
                    <span className={item.active ? "badge badge--entry" : "badge"}>
                      {item.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {allowDelete ? (
                      <button
                        className="btn btn--danger"
                        onClick={() => handleDelete(item)}
                        disabled={saving}
                        aria-label={`Eliminar material ${item.code}`}
                      >
                        Eliminar
                      </button>
                    ) : null}
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
