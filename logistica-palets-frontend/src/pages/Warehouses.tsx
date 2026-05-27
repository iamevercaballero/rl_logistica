import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWarehouse, deleteWarehouse, listWarehouses, type Warehouse } from "../api/warehouses";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

export default function WarehousesPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("warehouses", role) : false;
  const allowDelete = role ? canDelete("warehouses", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const nameId = useId();
  const addrId = useId();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const nameError = useMemo(() => {
    const value = name.trim();
    if (!value) return "Ingresá un nombre.";
    if (value.length < 2 || value.length > 80) return "El nombre debe tener entre 2 y 80 caracteres.";
    return "";
  }, [name]);

  const { data: items = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["warehouses"],
    queryFn: listWarehouses,
  });

  const createMut = useMutation({
    mutationFn: createWarehouse,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      toast.success(`Depósito ${created.name} creado`);
      setName("");
      setAddress("");
      setSubmitted(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWarehouse(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      toast.success("Depósito eliminado");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!allowCreate || nameError) return;
    createMut.mutate({ name: name.trim(), address: address.trim(), active: true });
  }

  function handleDelete(item: Warehouse) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar depósito ${item.name}?`)) return;
    deleteMut.mutate(item.id);
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Depósitos</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          {!allowCreate ? "Modo lectura." : "Crear y administrar depósitos."}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }} aria-label="Nuevo depósito">
        <input
          id={nameId}
          className="input"
          disabled={!allowCreate || saving}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nombre"
          aria-label="Nombre del depósito"
          aria-invalid={submitted && !!nameError}
          aria-describedby={submitted && nameError ? `${nameId}-err` : undefined}
        />
        <input
          id={addrId}
          className="input"
          disabled={!allowCreate || saving}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Dirección"
          aria-label="Dirección"
          style={{ minWidth: 320 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {createMut.isPending ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && nameError ? <p id={`${nameId}-err`} className="form-error" role="alert">{nameError}</p> : null}

      {isLoading ? <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando…</p> : null}
      {isError ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
          <button className="btn btn--primary" onClick={() => refetch()}>Reintentar</button>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        items.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table" aria-label="Lista de depósitos">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Dirección</th>
                <th scope="col">Estado</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td>{item.address || "-"}</td>
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
                        aria-label={`Eliminar depósito ${item.name}`}
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
