import { useCallback, useEffect, useMemo, useState } from "react";
import { listLocations, type Location } from "../api/locations";
import { listLots, type Lot } from "../api/lots";
import { createPallet, deletePallet, listPallets, type Pallet } from "../api/pallets";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { getFriendlyApiError } from "../utils/apiError";

export default function PalletsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("pallets", role) : false;
  const allowDelete = role ? canDelete("pallets", role) : false;

  const [items, setItems] = useState<Pallet[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lotId, setLotId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState("AVAILABLE");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pallets, lotData, locationData] = await Promise.all([listPallets(), listLots(), listLocations()]);
      setItems(pallets);
      setLots(lotData);
      setLocations(locationData);
      setLotId((current) => current || lotData[0]?.id || "");
      setLocationId((current) => current || locationData[0]?.id || "");
    } catch (err) {
      setError(getFriendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setFormError("");

    if (!allowCreate || codeError || quantityError || !lotId || !locationId) {
      return;
    }

    setSaving(true);
    try {
      await createPallet({
        code: code.trim(),
        lotId,
        quantity: Number(quantity),
        currentLocationId: locationId,
        status,
      });
      setCode("");
      setQuantity("1");
      setStatus("AVAILABLE");
      setSubmitted(false);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Pallet) {
    if (!allowDelete || !window.confirm(`Eliminar pallet ${item.code}?`)) {
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await deletePallet(item.id);
      await refresh();
    } catch (err) {
      setFormError(getFriendlyApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const STATUS_LABEL: Record<string, string> = {
    AVAILABLE: "Disponible",
    BLOCKED: "Bloqueado",
    DAMAGED: "Dañado",
    IN_TRANSIT: "En tránsito",
  };

  const STATUS_BADGE: Record<string, string> = {
    AVAILABLE: "badge badge--entry",
    BLOCKED: "badge badge--adj-out",
    DAMAGED: "badge badge--exit",
    IN_TRANSIT: "badge badge--transfer",
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Palets</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          Gestión de palets individuales. {!allowCreate ? "Modo lectura." : ""}
        </p>
      </div>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" disabled={!allowCreate || saving} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código" />
        <input
          className="input"
          disabled={!allowCreate || saving}
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          style={{ width: 120 }}
          placeholder="Cantidad"
        />
        <select className="input" disabled={!allowCreate || saving} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="AVAILABLE">Disponible</option>
          <option value="BLOCKED">Bloqueado</option>
          <option value="DAMAGED">Dañado</option>
          <option value="IN_TRANSIT">En tránsito</option>
        </select>
        <select className="input" disabled={!allowCreate || saving || lots.length === 0} value={lotId} onChange={(event) => setLotId(event.target.value)}>
          <option value="">Seleccionar lote</option>
          {lots.map((lot) => (
            <option key={lot.id} value={lot.id}>
              {lot.lotCode}
            </option>
          ))}
        </select>
        <select className="input" disabled={!allowCreate || saving || locations.length === 0} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          <option value="">Seleccionar ubicación</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code}
            </option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={!allowCreate || saving || lots.length === 0 || locations.length === 0}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {submitted && codeError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{codeError}</p> : null}
      {submitted && quantityError ? <p style={{ color: "#b91c1c", marginTop: -4 }}>{quantityError}</p> : null}
      {submitted && !lotId ? <p style={{ color: "#b91c1c", marginTop: -4 }}>Seleccioná un lote.</p> : null}
      {submitted && !locationId ? <p style={{ color: "#b91c1c", marginTop: -4 }}>Seleccioná una ubicación.</p> : null}
      {formError ? <p style={{ color: "#b91c1c" }}>{formError}</p> : null}

      {loading ? <p>Cargando...</p> : null}
      {error ? (
        <div>
          <p style={{ color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar.</p>
          <button className="btn" onClick={refresh}>
            Reintentar
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        items.length === 0 ? (
          <p>No hay registros</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cantidad</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.code}</strong></td>
                  <td>{item.quantity.toLocaleString("es-AR")}</td>
                  <td>
                    <span className={STATUS_BADGE[item.status] ?? "badge"}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {allowDelete ? <button className="btn btn--danger" onClick={() => handleDelete(item)}>Eliminar</button> : null}
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
