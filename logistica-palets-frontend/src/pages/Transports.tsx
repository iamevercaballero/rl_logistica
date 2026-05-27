import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTransport, deleteTransport, listTransports, type Transport } from "../api/transports";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

export default function TransportsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("transports", role) : false;
  const allowDelete = role ? canDelete("transports", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const plateId = useId();
  const typeId = useId();
  const descId = useId();

  const [plate, setPlate] = useState("");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const plateError = useMemo(() => {
    const value = plate.trim();
    if (!value) return "Ingresá una patente.";
    if (value.length < 2 || value.length > 80) return "La patente debe tener entre 2 y 80 caracteres.";
    return "";
  }, [plate]);

  const typeError = useMemo(() => {
    const value = type.trim();
    if (!value) return "Ingresá un tipo.";
    if (value.length < 2 || value.length > 80) return "El tipo debe tener entre 2 y 80 caracteres.";
    return "";
  }, [type]);

  const { data: items = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["transports"],
    queryFn: listTransports,
  });

  const createMut = useMutation({
    mutationFn: createTransport,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["transports"] });
      toast.success(`Transporte ${created.plate} creado`);
      setPlate("");
      setType("");
      setDescription("");
      setSubmitted(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTransport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transports"] });
      toast.success("Transporte eliminado");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!allowCreate || plateError || typeError) return;
    createMut.mutate({
      plate: plate.trim(),
      type: type.trim(),
      description: description.trim(),
    });
  }

  function handleDelete(item: Transport) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar transporte ${item.plate}?`)) return;
    deleteMut.mutate(item.id);
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Transportes</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          {!allowCreate ? "Modo lectura." : "Flota disponible para movimientos."}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }} aria-label="Nuevo transporte">
        <input
          id={plateId}
          className="input"
          disabled={!allowCreate || saving}
          value={plate}
          onChange={(event) => setPlate(event.target.value)}
          placeholder="Patente"
          aria-label="Patente"
          aria-invalid={submitted && !!plateError}
          aria-describedby={submitted && plateError ? `${plateId}-err` : undefined}
        />
        <input
          id={typeId}
          className="input"
          disabled={!allowCreate || saving}
          value={type}
          onChange={(event) => setType(event.target.value)}
          placeholder="Tipo (Scania, Camión...)"
          aria-label="Tipo de transporte"
          aria-invalid={submitted && !!typeError}
          aria-describedby={submitted && typeError ? `${typeId}-err` : undefined}
        />
        <input
          id={descId}
          className="input"
          disabled={!allowCreate || saving}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descripción"
          aria-label="Descripción"
          style={{ minWidth: 260 }}
        />
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving}>
          {createMut.isPending ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && plateError ? <p id={`${plateId}-err`} className="form-error" role="alert">{plateError}</p> : null}
      {submitted && typeError ? <p id={`${typeId}-err`} className="form-error" role="alert">{typeError}</p> : null}

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
          <table className="table" aria-label="Lista de transportes">
            <thead>
              <tr>
                <th scope="col">Patente</th>
                <th scope="col">Tipo</th>
                <th scope="col">Descripción</th>
                <th scope="col">Estado</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.plate}</strong></td>
                  <td>{item.type}</td>
                  <td>{item.description || "-"}</td>
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
                        aria-label={`Eliminar transporte ${item.plate}`}
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
