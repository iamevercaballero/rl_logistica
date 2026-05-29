import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { editMovementMetadata, type Movement } from "../api/movements";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

interface Props {
  movement: Movement;
  onClose: () => void;
  onSuccess: () => void;
}

export default function MovementEditorModal({ movement, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEntry = movement.type === "ENTRY";
  const isExit = movement.type === "EXIT";

  const [reason, setReason] = useState("");
  const [documentNumber, setDocumentNumber] = useState(movement.documentNumber ?? "");
  const [supplier, setSupplier] = useState(movement.supplier ?? "");
  const [carrier, setCarrier] = useState(movement.carrier ?? "");
  const [driver, setDriver] = useState(movement.driver ?? "");
  const [destination, setDestination] = useState(movement.destination ?? "");
  const [notes, setNotes] = useState(movement.notes ?? "");
  const [sapLot, setSapLot] = useState(movement.sapLot ?? "");
  const [proveedor, setProveedor] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaFabricacion, setFechaFabricacion] = useState("");
  const [formError, setFormError] = useState("");

  const mut = useMutation({
    mutationFn: (payload: Parameters<typeof editMovementMetadata>[1]) =>
      editMovementMetadata(movement.id, payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["movements"] });
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success(
        res.changes > 0
          ? `${res.changes} campo${res.changes !== 1 ? "s" : ""} actualizado${res.changes !== 1 ? "s" : ""}`
          : "Sin cambios detectados",
      );
      onSuccess();
    },
    onError: (err) => {
      const msg = getFriendlyApiError(err);
      setFormError(msg);
      toast.error(msg);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || reason.trim().length < 5) {
      setFormError("El motivo debe tener al menos 5 caracteres.");
      return;
    }
    setFormError("");

    const payload: Parameters<typeof editMovementMetadata>[1] = { reason: reason.trim() };
    if (documentNumber.trim() !== (movement.documentNumber ?? "")) payload.documentNumber = documentNumber.trim();
    if (supplier.trim() !== (movement.supplier ?? "")) payload.supplier = supplier.trim();
    if (carrier.trim() !== (movement.carrier ?? "")) payload.carrier = carrier.trim();
    if (driver.trim() !== (movement.driver ?? "")) payload.driver = driver.trim();
    if (destination.trim() !== (movement.destination ?? "")) payload.destination = destination.trim();
    if (notes.trim() !== (movement.notes ?? "")) payload.notes = notes.trim();
    if (sapLot.trim() !== (movement.sapLot ?? "")) payload.sapLot = sapLot.trim();
    if (proveedor.trim()) payload.proveedor = proveedor.trim();
    if (fechaVencimiento) payload.fechaVencimiento = fechaVencimiento;
    if (fechaFabricacion) payload.fechaFabricacion = fechaFabricacion;

    mut.mutate(payload);
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    marginBottom: 3,
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal"
        style={{ width: "100%", maxWidth: 600, maxHeight: "92vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 14,
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
              Editar {isEntry ? "entrada" : isExit ? "salida" : "movimiento"}
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Los cambios quedan auditados. Solo se actualizan los campos modificados.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: "pointer",
              color: "var(--muted)",
              lineHeight: 1,
              flexShrink: 0,
            }}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Datos de origen — sólo lectura */}
        <div
          style={{
            background: "var(--bg)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div>
            <strong style={{ fontSize: 14 }}>{movement.material.code}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 6 }}>
              · {movement.material.description}
            </span>
            {movement.lotCode && (
              <span
                style={{ fontSize: 11, color: "var(--primary)", marginLeft: 8, fontFamily: "monospace" }}
              >
                {movement.lotCode}
              </span>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800 }}>
              {movement.quantity.toLocaleString("es-PY")} unid.
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {new Date(movement.date).toLocaleDateString("es-PY")}
              {movement.warehouse && ` · ${movement.warehouse.name}`}
              {movement.location && ` / ${movement.location.code}`}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          {/* Motivo — primero y obligatorio */}
          <div>
            <label
              htmlFor="edit-reason"
              style={{ ...labelStyle, color: "var(--danger)" }}
            >
              Motivo de la edición *
            </label>
            <textarea
              id="edit-reason"
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describí por qué se edita este registro (mín. 5 caracteres)..."
              required
              style={{ borderColor: reason.trim().length > 0 && reason.trim().length < 5 ? "var(--danger)" : undefined }}
            />
          </div>

          {/* Datos del movimiento */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                paddingBottom: 6,
                borderBottom: "1px solid var(--border)",
                marginBottom: 8,
              }}
            >
              Datos del movimiento
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <div>
                <label style={labelStyle}>N° remito / documento</label>
                <input
                  className="input"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                />
              </div>
              {isEntry && (
                <div>
                  <label style={labelStyle}>Proveedor</label>
                  <input
                    className="input"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label style={labelStyle}>Transportadora</label>
                <input
                  className="input"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Conductor</label>
                <input
                  className="input"
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                />
              </div>
              {isExit && (
                <div>
                  <label style={labelStyle}>Destino</label>
                  <input
                    className="input"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Observaciones</label>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Datos de lotes — solo para entradas o cuando hay lote asociado */}
          {(isEntry || movement.lotCode) && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  paddingBottom: 6,
                  borderBottom: "1px solid var(--border)",
                  marginBottom: 8,
                }}
              >
                Datos de lotes
                <span
                  style={{ fontSize: 10, fontWeight: 400, textTransform: "none", marginLeft: 6 }}
                >
                  (se aplica a todos los lotes del movimiento)
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={labelStyle}>Lote SAP</label>
                  <input
                    className="input"
                    style={{ fontFamily: "monospace" }}
                    value={sapLot}
                    onChange={(e) => setSapLot(e.target.value)}
                    placeholder={movement.sapLot ?? ""}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Proveedor del lote</label>
                  <input
                    className="input"
                    value={proveedor}
                    onChange={(e) => setProveedor(e.target.value)}
                    placeholder="(sin cambio)"
                  />
                </div>
                <div>
                  <label style={labelStyle}>F. Vencimiento</label>
                  <input
                    className="input"
                    type="date"
                    value={fechaVencimiento}
                    onChange={(e) => setFechaVencimiento(e.target.value)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>F. Fabricación</label>
                  <input
                    className="input"
                    type="date"
                    value={fechaFabricacion}
                    onChange={(e) => setFechaFabricacion(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {formError && (
            <div className="form-error" role="alert">
              {formError}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn--primary"
              type="submit"
              disabled={mut.isPending}
            >
              {mut.isPending ? "Guardando..." : "✓ Guardar cambios"}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
