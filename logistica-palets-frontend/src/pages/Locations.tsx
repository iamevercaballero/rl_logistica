import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { createLocation, deleteLocation, listLocations, type Location } from "../api/locations";
import { listWarehouses } from "../api/warehouses";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

export default function LocationsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("locations", role) : false;
  const allowDelete = role ? canDelete("locations", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const codeId = useId();
  const whId = useId();

  const [code, setCode] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const codeError = useMemo(() => {
    const value = code.trim();
    if (!value) return "Ingresá un código.";
    if (value.length < 2 || value.length > 80) return "El código debe tener entre 2 y 80 caracteres.";
    return "";
  }, [code]);

  const [locationsQ, warehousesQ] = useQueries({
    queries: [
      { queryKey: ["locations"], queryFn: listLocations },
      { queryKey: ["warehouses"], queryFn: listWarehouses },
    ],
  });

  const items = locationsQ.data ?? [];
  const warehouses = warehousesQ.data ?? [];
  const isLoading = locationsQ.isLoading || warehousesQ.isLoading;
  const isError = locationsQ.isError || warehousesQ.isError;

  useEffect(() => {
    if (!warehouseId && warehouses[0]) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  const createMut = useMutation({
    mutationFn: createLocation,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast.success(`Ubicación ${created.code} creada`);
      setCode("");
      setSubmitted(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast.success("Ubicación eliminada");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!allowCreate || codeError || !warehouseId) return;
    createMut.mutate({ code: code.trim(), warehouseId });
  }

  function handleDelete(item: Location) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar ubicación ${item.code}?`)) return;
    deleteMut.mutate(item.id);
  }

  function refetchAll() {
    locationsQ.refetch();
    warehousesQ.refetch();
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Ubicaciones</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          {!allowCreate ? "Modo lectura." : "Racks, pisos y ubicaciones temporales por depósito."}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }} aria-label="Nueva ubicación">
        <input
          id={codeId}
          className="input"
          disabled={!allowCreate || saving}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Código (ej: A1-01-02)"
          aria-label="Código de ubicación"
          aria-invalid={submitted && !!codeError}
          aria-describedby={submitted && codeError ? `${codeId}-err` : undefined}
        />
        <select
          id={whId}
          className="input"
          disabled={!allowCreate || saving || warehouses.length === 0}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
          aria-label="Depósito"
          aria-invalid={submitted && !warehouseId}
        >
          <option value="">Seleccionar depósito</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving || warehouses.length === 0}>
          {createMut.isPending ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && codeError ? <p id={`${codeId}-err`} className="form-error" role="alert">{codeError}</p> : null}
      {submitted && !warehouseId ? <p className="form-error" role="alert">Seleccioná un depósito.</p> : null}

      {isLoading ? <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando…</p> : null}
      {isError ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
          <button className="btn btn--primary" onClick={refetchAll}>Reintentar</button>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        items.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table" aria-label="Lista de ubicaciones">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Depósito</th>
                <th scope="col">ID</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.code}</strong></td>
                  <td>{item.warehouse?.name ?? item.warehouseId ?? "-"}</td>
                  <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{item.id}</td>
                  <td style={{ textAlign: "right" }}>
                    {allowDelete ? (
                      <button
                        className="btn btn--danger"
                        onClick={() => handleDelete(item)}
                        disabled={saving}
                        aria-label={`Eliminar ubicación ${item.code}`}
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
