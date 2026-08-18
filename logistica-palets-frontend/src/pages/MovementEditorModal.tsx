import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  editMovementMetadata,
  getMovementLots,
  requestQuantityEdit,
  type Movement,
  type MovementLotBreakdown,
} from "../api/movements";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { formatDateTimePY } from "../utils/dateFormat";

interface Props {
  movement: Movement;
  onClose: () => void;
  onSuccess: () => void;
}

type LotEdit = {
  lotCode: string;
  sapLot: string;
  fechaVencimiento: string;
  fechaFabricacion: string;
  /** palletId → nueva cantidad (solo reducir) */
  pallets: Record<string, string>;
  /** palletId → nuevo peso en kg. Es descriptivo: no genera solicitud de ajuste. */
  weights: Record<string, string>;
  /**
   * SALIDA — palletId → paletas físicas con las que se despachó. Descriptivo
   * como el peso: se aplica directo, sin pasar por aprobación. Vaciarlo borra
   * el dato informado.
   */
  dispatched: Record<string, string>;
  addQuantity: string;
  addPalletCount: string;
};
type MetaPayload = Parameters<typeof editMovementMetadata>[1];
type LotsPayload = Parameters<typeof requestQuantityEdit>[1];

export default function MovementEditorModal({ movement, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEntry = movement.type === "ENTRY";
  const isExit = movement.type === "EXIT";
  // Material configurado sin Lote SAP: no se ofrece el campo para cargarlo. Un
  // valor histórico sí se muestra (solo lectura) — apagar el flag no lo borra.
  const usesSapLot = movement.material.usesSapLot !== false;

  const [reason, setReason] = useState("");
  const [documentNumber, setDocumentNumber] = useState(movement.documentNumber ?? "");
  const [supplier, setSupplier] = useState(movement.supplier ?? "");
  const [carrier, setCarrier] = useState(movement.carrier ?? "");
  const [driver, setDriver] = useState(movement.driver ?? "");
  const [destination, setDestination] = useState(movement.destination ?? "");
  const [documentoMaterial, setDocumentoMaterial] = useState(movement.documentoMaterial ?? "");
  const [notes, setNotes] = useState(movement.notes ?? "");
  const [sapLot, setSapLot] = useState(movement.sapLot ?? "");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaFabricacion, setFechaFabricacion] = useState("");
  const [formError, setFormError] = useState("");

  // Desglose por lote (cantidades y pallets) — entradas y salidas no anuladas
  const canEditLots = (isEntry || isExit) && (movement.voidStatus ?? "NONE") === "NONE";
  const lotsQ = useQuery({
    queryKey: ["movement-lots", movement.id],
    queryFn: () => getMovementLots(movement.id),
    enabled: canEditLots,
    staleTime: 15_000,
  });
  const lots = lotsQ.data?.lots ?? [];

  // Ediciones por lote: datos del lote + nueva cantidad por pallet + agregado
  const [lotEdits, setLotEdits] = useState<Record<string, LotEdit>>({});
  const defaultEdit = (l: MovementLotBreakdown): LotEdit => ({
    lotCode: l.lotCode,
    sapLot: l.sapLot ?? "",
    fechaVencimiento: l.fechaVencimiento ?? "",
    fechaFabricacion: l.fechaFabricacion ?? "",
    // ENTRY: se edita el saldo actual del pallet. EXIT: se edita cuánto salió de ese pallet
    // en ESTE movimiento (quantityInMovement) — son ejes distintos, ver comentario del backend.
    pallets: Object.fromEntries(l.pallets.map((p) => [p.id, String(isExit ? p.quantityInMovement : p.currentQuantity)])),
    weights: Object.fromEntries(l.pallets.map((p) => [p.id, p.weightKg != null ? String(p.weightKg) : ""])),
    dispatched: Object.fromEntries(l.pallets.map((p) => [p.id, p.dispatchedPallets != null ? String(p.dispatchedPallets) : ""])),
    addQuantity: "",
    addPalletCount: "1",
  });
  const getEdit = (l: MovementLotBreakdown): LotEdit => lotEdits[l.lotId] ?? defaultEdit(l);
  function updateLotEdit(l: MovementLotBreakdown, field: Exclude<keyof LotEdit, "pallets" | "weights">, val: string) {
    setLotEdits((prev) => ({ ...prev, [l.lotId]: { ...(prev[l.lotId] ?? defaultEdit(l)), [field]: val } }));
  }
  function updateLotPallet(l: MovementLotBreakdown, palletId: string, val: string) {
    setLotEdits((prev) => {
      const cur = prev[l.lotId] ?? defaultEdit(l);
      return { ...prev, [l.lotId]: { ...cur, pallets: { ...cur.pallets, [palletId]: val } } };
    });
  }
  function updateLotWeight(l: MovementLotBreakdown, palletId: string, val: string) {
    setLotEdits((prev) => {
      const cur = prev[l.lotId] ?? defaultEdit(l);
      return { ...prev, [l.lotId]: { ...cur, weights: { ...cur.weights, [palletId]: val } } };
    });
  }
  function updateLotDispatched(l: MovementLotBreakdown, palletId: string, val: string) {
    setLotEdits((prev) => {
      const cur = prev[l.lotId] ?? defaultEdit(l);
      return { ...prev, [l.lotId]: { ...cur, dispatched: { ...cur.dispatched, [palletId]: val } } };
    });
  }

  const mut = useMutation({
    mutationFn: async ({ metaPayload, lotsPayload }: { metaPayload?: MetaPayload; lotsPayload?: LotsPayload }) => {
      const meta = metaPayload ? await editMovementMetadata(movement.id, metaPayload) : null;
      const qty = lotsPayload ? await requestQuantityEdit(movement.id, lotsPayload) : null;
      return { meta, qty };
    },
    onSuccess: ({ meta, qty }) => {
      queryClient.invalidateQueries({ queryKey: ["movements"] });
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["movement-lots", movement.id] });

      if (meta) {
        toast.success(
          meta.changes > 0
            ? `${meta.changes} campo${meta.changes !== 1 ? "s" : ""} actualizado${meta.changes !== 1 ? "s" : ""}`
            : "Sin cambios en los datos del movimiento",
        );
      }
      if (qty) {
        if (qty.renamed > 0) toast.success(`${qty.renamed} lote${qty.renamed !== 1 ? "s" : ""} renombrado${qty.renamed !== 1 ? "s" : ""}`);
        if (qty.lotFieldChanges > 0) toast.success(`${qty.lotFieldChanges} dato${qty.lotFieldChanges !== 1 ? "s" : ""} de lote actualizado${qty.lotFieldChanges !== 1 ? "s" : ""}`);
        for (const r of qty.requests) {
          toast.success(
            `Solicitud ${r.code} (${r.type === "ADJUSTMENT_IN" ? "+" : "−"}${r.totalQuantity.toLocaleString("es-PY")} unid.) enviada al MANAGER para aprobación`,
          );
        }
        for (const w of qty.warnings) toast.warning(w);
      }
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

    // ── Cambios de metadatos (se aplican directo, auditados) ──
    const metaPayload: MetaPayload = { reason: reason.trim() };
    if (documentNumber.trim() !== (movement.documentNumber ?? "")) metaPayload.documentNumber = documentNumber.trim();
    if (supplier.trim() !== (movement.supplier ?? "")) metaPayload.supplier = supplier.trim();
    if (carrier.trim() !== (movement.carrier ?? "")) metaPayload.carrier = carrier.trim();
    if (driver.trim() !== (movement.driver ?? "")) metaPayload.driver = driver.trim();
    if (destination.trim() !== (movement.destination ?? "")) metaPayload.destination = destination.trim();
    if (isExit && documentoMaterial.trim() !== (movement.documentoMaterial ?? "").trim()) {
      metaPayload.documentoMaterial = documentoMaterial.trim();
    }
    if (notes.trim() !== (movement.notes ?? "")) metaPayload.notes = notes.trim();
    if (sapLot.trim() !== (movement.sapLot ?? "")) metaPayload.sapLot = sapLot.trim();
    // `proveedor` deprecado: no se envía más en payloads nuevos.
    if (fechaVencimiento) metaPayload.fechaVencimiento = fechaVencimiento;
    if (fechaFabricacion) metaPayload.fechaFabricacion = fechaFabricacion;
    const hasMetaChanges = Object.keys(metaPayload).length > 1;

    // ── Cambios de lotes / pallets ──
    const lotChanges: LotsPayload["lots"] = [];
    for (const l of lots) {
      const edit = getEdit(l);

      const newCode = edit.lotCode.trim();
      const codeChanged = !!newCode && newCode !== l.lotCode;
      const sapChanged = edit.sapLot.trim() !== "" && edit.sapLot.trim() !== (l.sapLot ?? "");
      const vencChanged = !!edit.fechaVencimiento && edit.fechaVencimiento !== (l.fechaVencimiento ?? "");
      const fabChanged = !!edit.fechaFabricacion && edit.fechaFabricacion !== (l.fechaFabricacion ?? "");

      // Corrección por pallet. ENTRY: solo se puede bajar el saldo actual (para sumar
      // está "Agregar unidades"). EXIT: se compara contra lo que salió en ESTE movimiento
      // (quantityInMovement) y se puede subir o bajar — no hay "Agregar unidades".
      const palletEdits: { palletId: string; newQuantity: number; weightKg?: number; dispatchedPallets?: number | null }[] = [];
      for (const p of l.pallets) {
        if (!isExit && p.status === "EXITED") continue;
        const raw = edit.pallets[p.id];
        if (raw === undefined) continue;
        const newQty = Number(raw);
        if (raw.trim() === "" || !Number.isInteger(newQty) || newQty < 0) {
          setFormError(`Cantidad inválida en el pallet ${p.code}.`);
          return;
        }

        // El peso es descriptivo: cambia solo si el operario lo tocó.
        const rawWeight = edit.weights[p.id] ?? "";
        const originalWeight = p.weightKg != null ? String(p.weightKg) : "";
        let weightKg: number | undefined;
        if (rawWeight.trim() !== originalWeight.trim()) {
          if (rawWeight.trim() === "") {
            setFormError(`Indicá el peso del pallet ${p.code} o dejá el valor anterior.`);
            return;
          }
          const w = Number(rawWeight);
          if (!Number.isFinite(w) || w < 0) {
            setFormError(`Peso inválido en el pallet ${p.code}.`);
            return;
          }
          weightKg = w;
        }

        // Paletas físicas despachadas: descriptivo, solo en salidas. Vaciar el
        // campo borra el dato; `undefined` es "no lo toqué".
        let dispatchedPallets: number | null | undefined;
        if (isExit) {
          const rawDispatched = (edit.dispatched[p.id] ?? "").trim();
          const originalDispatched = p.dispatchedPallets != null ? String(p.dispatchedPallets) : "";
          if (rawDispatched !== originalDispatched) {
            if (rawDispatched === "") {
              dispatchedPallets = null;
            } else {
              const d = Number(rawDispatched);
              if (!Number.isInteger(d) || d < 0 || d > 999) {
                setFormError(`Paletas físicas inválidas en el pallet ${p.code}: usá un número entero de 0 a 999.`);
                return;
              }
              dispatchedPallets = d;
            }
          }
        }

        const qtyChanged = isExit ? newQty !== p.quantityInMovement : newQty !== p.currentQuantity;

        if (isExit) {
          const ceiling = p.quantityInMovement + p.currentQuantity;
          if (newQty > ceiling) {
            setFormError(`El pallet ${p.code}: como máximo se le puede sacar ${ceiling.toLocaleString("es-PY")} unid. en total.`);
            return;
          }
        } else if (newQty > p.currentQuantity) {
          setFormError(
            `El pallet ${p.code} tiene ${p.currentQuantity.toLocaleString("es-PY")} unid. — solo se puede reducir. Para sumar unidades usá "Agregar unidades" del lote.`,
          );
          return;
        }

        if (qtyChanged || weightKg !== undefined || dispatchedPallets !== undefined) {
          palletEdits.push({ palletId: p.id, newQuantity: newQty, weightKg, dispatchedPallets });
        }
      }

      // Agregado de unidades → pallets nuevos al aprobar (solo ENTRY)
      const addQty = Number(edit.addQuantity);
      const hasAdd = !isExit && edit.addQuantity.trim() !== "" && Number.isInteger(addQty) && addQty > 0;
      if (!isExit && edit.addQuantity.trim() !== "" && (!Number.isInteger(addQty) || addQty < 0)) {
        setFormError(`Cantidad a agregar inválida en el lote ${l.lotCode}.`);
        return;
      }

      if (!codeChanged && !sapChanged && !vencChanged && !fabChanged && palletEdits.length === 0 && !hasAdd) continue;

      lotChanges.push({
        lotId: l.lotId,
        newLotCode: codeChanged ? newCode : undefined,
        sapLot: sapChanged ? edit.sapLot.trim() : undefined,
        fechaVencimiento: vencChanged ? edit.fechaVencimiento : undefined,
        fechaFabricacion: fabChanged ? edit.fechaFabricacion : undefined,
        palletEdits: palletEdits.length > 0 ? palletEdits : undefined,
        addQuantity: hasAdd ? addQty : undefined,
        addPalletCount: hasAdd ? Math.max(1, Number(edit.addPalletCount) || 1) : undefined,
      });
    }

    if (!hasMetaChanges && lotChanges.length === 0) {
      setFormError("No hay cambios para guardar.");
      return;
    }
    setFormError("");

    mut.mutate({
      metaPayload: hasMetaChanges ? metaPayload : undefined,
      lotsPayload: lotChanges.length > 0 ? { reason: reason.trim(), lots: lotChanges } : undefined,
    });
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
              {formatDateTimePY(movement.createdAt ?? movement.date)}
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
              {isEntry && (
                <div>
                  <label style={labelStyle}>N° MIC/Factura/Remito</label>
                  <input
                    className="input"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                  />
                </div>
              )}
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
              {isExit && (
                <div>
                  <label style={labelStyle}>Documento Material</label>
                  <input
                    className="input"
                    value={documentoMaterial}
                    onChange={(e) => setDocumentoMaterial(e.target.value)}
                    placeholder="Pendiente"
                    maxLength={80}
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

          {/* Lotes y pallets — datos por lote + corrección a nivel pallet */}
          {canEditLots && (
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
                Lotes y pallets
                {lots.length > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 400, textTransform: "none", marginLeft: 6 }}>
                    ({lots.length} lote{lots.length !== 1 ? "s" : ""} · cada lote con sus propios datos y pallets)
                  </span>
                )}
              </div>

              {lotsQ.isLoading ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Cargando lotes...</p>
              ) : lots.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  Este movimiento no tiene lotes asociados.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {lots.map((l) => {
                    const edit = getEdit(l);
                    // EXIT: todos los pallets son editables (el punto es corregir lo que salió,
                    // esté o no EXITED). ENTRY: los ya despachados quedan aparte, no editables.
                    const activePallets = isExit ? l.pallets : l.pallets.filter((p) => p.status !== "EXITED");
                    const exitedPallets = isExit ? [] : l.pallets.filter((p) => p.status === "EXITED");
                    const baseline = (p: MovementLotBreakdown["pallets"][number]) => isExit ? p.quantityInMovement : p.currentQuantity;
                    const ceiling = (p: MovementLotBreakdown["pallets"][number]) => isExit ? p.quantityInMovement + p.currentQuantity : p.currentQuantity;
                    const currentTotal = activePallets.reduce((s, p) => s + baseline(p), 0);
                    const newTotal = activePallets.reduce((s, p) => {
                      const raw = edit.pallets[p.id];
                      const n = Number(raw);
                      if (raw === undefined || raw.trim() === "" || !Number.isInteger(n) || n < 0) return s + baseline(p);
                      return s + Math.min(n, ceiling(p));
                    }, 0);
                    const addQtyNum = Number(edit.addQuantity);
                    const addQty = !isExit && edit.addQuantity.trim() !== "" && Number.isInteger(addQtyNum) && addQtyNum > 0 ? addQtyNum : 0;
                    const addCount = Math.max(1, Number(edit.addPalletCount) || 1);
                    const delta = newTotal + addQty - currentTotal;
                    const codeChanged = edit.lotCode.trim() !== "" && edit.lotCode.trim() !== l.lotCode;

                    const tinyLabel: React.CSSProperties = {
                      display: "block", fontSize: 10, fontWeight: 700,
                      color: "var(--muted)", textTransform: "uppercase", marginBottom: 3,
                    };

                    return (
                      <div
                        key={l.lotId}
                        style={{
                          border: `1.5px solid ${delta !== 0 || codeChanged ? "var(--primary)" : "var(--border)"}`,
                          borderRadius: 10,
                          overflow: "hidden",
                        }}
                      >
                        {/* Datos del lote */}
                        <div style={{ background: "var(--bg)", padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "grid", gap: 8 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            <div>
                              <label style={tinyLabel}>Código de lote</label>
                              <input
                                className="input"
                                style={{ fontFamily: "monospace", fontWeight: 700 }}
                                value={edit.lotCode}
                                onChange={(e) => updateLotEdit(l, "lotCode", e.target.value)}
                                aria-label={`Código del lote ${l.lotCode}`}
                              />
                            </div>
                            <div>
                              <label style={tinyLabel}>Lote SAP</label>
                              {usesSapLot ? (
                                <input
                                  className="input"
                                  style={{ fontFamily: "monospace" }}
                                  value={edit.sapLot}
                                  onChange={(e) => updateLotEdit(l, "sapLot", e.target.value)}
                                />
                              ) : (
                                <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace", padding: "7px 0" }}
                                  title="El material no utiliza Lote SAP.">
                                  {l.sapLot ?? "—"}
                                </div>
                              )}
                            </div>
                            {/* "Proveedor del lote" se quitó: el código de lote
                                YA es el lote del proveedor. Mantener los dos
                                campos duplicaba el mismo dato con dos nombres. */}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            <div>
                              <label style={tinyLabel}>F. Vencimiento</label>
                              <input
                                className="input"
                                type="date"
                                value={edit.fechaVencimiento}
                                onChange={(e) => updateLotEdit(l, "fechaVencimiento", e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={tinyLabel}>F. Fabricación</label>
                              <input
                                className="input"
                                type="date"
                                value={edit.fechaFabricacion}
                                onChange={(e) => updateLotEdit(l, "fechaFabricacion", e.target.value)}
                              />
                            </div>
                            <div />
                          </div>
                        </div>

                        {/* Pallets del lote. La última columna cambia según el tipo: el peso
                            es un dato de ENTRADA (se imprime en la etiqueta al recibir), y en
                            una SALIDA ese lugar lo ocupan las paletas físicas despachadas, que
                            es el dato descriptivo equivalente del despacho. */}
                        <div style={{ padding: "8px 12px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 110px 110px", gap: 8, padding: "2px 0 6px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                            <span>Pallet</span>
                            <span style={{ textAlign: "right" }}>{isExit ? "Salió" : "Actual"}</span>
                            <span>{isExit ? "Cantidad correcta" : "Nueva cantidad"}</span>
                            <span title={isExit
                              ? "Paletas físicas con las que se despachó este palet. Informativo: no cambia el stock. Vacío = no informado."
                              : "Peso físico del pallet."}>
                              {isExit ? "Paletas fís." : "Peso (kg)"}
                            </span>
                          </div>
                          <div style={{ display: "grid", gap: 4 }}>
                            {activePallets.map((p) => {
                              const base = baseline(p);
                              const max = ceiling(p);
                              const raw = edit.pallets[p.id] ?? String(base);
                              const n = Number(raw);
                              const valid = raw.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= max;
                              const reduced = valid && n < base;
                              return (
                                <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 110px 110px", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {p.code}
                                    {p.status === "PARTIAL" && <span className="badge badge--estado-pendiente" style={{ fontSize: 9, marginLeft: 6 }}>PARCIAL</span>}
                                    {isExit && p.status === "EXITED" && <span className="badge" style={{ fontSize: 9, marginLeft: 6, background: "var(--muted)", color: "#fff" }}>DESPACHADO</span>}
                                  </span>
                                  <span
                                    style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}
                                    title={isExit ? `Queda disponible en el pallet: ${p.currentQuantity.toLocaleString("es-PY")} unid.` : (p.quantityInMovement !== p.currentQuantity ? `Ingresó con ${p.quantityInMovement.toLocaleString("es-PY")} unid.` : undefined)}
                                  >
                                    {base.toLocaleString("es-PY")}
                                  </span>
                                  <input
                                    className="input"
                                    type="number"
                                    min={0}
                                    max={max}
                                    value={raw}
                                    onChange={(e) => updateLotPallet(l, p.id, e.target.value)}
                                    style={{
                                      fontWeight: 700, fontSize: 13, padding: "4px 8px",
                                      borderColor: !valid ? "var(--danger)" : reduced ? "var(--warning)" : undefined,
                                    }}
                                    aria-label={`${isExit ? "Cantidad correcta" : "Nueva cantidad"} del pallet ${p.code}`}
                                  />
                                  {/* Dato descriptivo del palet: se aplica directo y queda
                                      auditado, sin pasar por aprobación. */}
                                  {isExit ? (
                                    <input
                                      className="input"
                                      type="number"
                                      min={0}
                                      max={999}
                                      placeholder="—"
                                      value={edit.dispatched[p.id] ?? ""}
                                      onChange={(e) => updateLotDispatched(l, p.id, e.target.value)}
                                      style={{ fontSize: 13, padding: "4px 8px", textAlign: "center" }}
                                      aria-label={`Paletas físicas despachadas del pallet ${p.code}`}
                                    />
                                  ) : (
                                    <input
                                      className="input"
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      placeholder="—"
                                      value={edit.weights[p.id] ?? ""}
                                      onChange={(e) => updateLotWeight(l, p.id, e.target.value)}
                                      style={{ fontSize: 13, padding: "4px 8px" }}
                                      aria-label={`Peso del pallet ${p.code}`}
                                    />
                                  )}
                                </div>
                              );
                            })}
                            {exitedPallets.map((p) => (
                              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 110px 110px", gap: 8, alignItems: "center", opacity: 0.55 }}>
                                <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                                  {p.code}
                                  <span className="badge" style={{ fontSize: 9, marginLeft: 6, background: "var(--muted)", color: "#fff" }}>DESPACHADO</span>
                                </span>
                                <span style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }} title={`Ingresó con ${p.quantityInMovement.toLocaleString("es-PY")} unid.`}>—</span>
                                <span style={{ fontSize: 11, color: "var(--muted)" }}>No editable</span>
                                <span style={{ fontSize: 11, color: "var(--muted)", textAlign: isExit ? "center" : undefined }}>
                                  {isExit
                                    ? (p.dispatchedPallets != null ? String(p.dispatchedPallets) : "—")
                                    : (p.weightKg != null ? `${p.weightKg} kg` : "—")}
                                </span>
                              </div>
                            ))}
                            {activePallets.length === 0 && exitedPallets.length === 0 && (
                              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Este lote no tiene pallets registrados en el movimiento.</p>
                            )}
                          </div>
                        </div>

                        {/* Agregar unidades → pallets nuevos (solo entradas) */}
                        {!isExit && (
                        <div style={{ borderTop: "1px dashed var(--border)", padding: "8px 12px", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <div>
                            <label style={{ ...tinyLabel, color: "var(--success)" }}> Agregar unidades</label>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              placeholder="0"
                              value={edit.addQuantity}
                              onChange={(e) => updateLotEdit(l, "addQuantity", e.target.value)}
                              style={{ width: 130, fontWeight: 700 }}
                              aria-label={`Unidades a agregar al lote ${l.lotCode}`}
                            />
                          </div>
                          <div>
                            <label style={tinyLabel}>En pallets nuevos</label>
                            <input
                              className="input"
                              type="number"
                              min={1}
                              value={edit.addPalletCount}
                              onChange={(e) => updateLotEdit(l, "addPalletCount", e.target.value)}
                              style={{ width: 100 }}
                              aria-label={`Cantidad de pallets nuevos para el lote ${l.lotCode}`}
                            />
                          </div>
                          {addQty > 0 && (
                            <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 700, paddingBottom: 6 }}>
                              +{addQty.toLocaleString("es-PY")} unid. en {addCount} pallet{addCount !== 1 ? "s" : ""} nuevo{addCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        )}

                        {/* Resumen del lote */}
                        <div style={{ background: "var(--bg)", borderTop: "1px solid var(--border)", padding: "7px 12px", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ color: "var(--muted)" }}>
                            Total actual: <strong style={{ color: "var(--text)" }}>{currentTotal.toLocaleString("es-PY")} unid.</strong>
                          </span>
                          <span style={{ color: "var(--muted)" }}>→</span>
                          <span style={{ color: "var(--muted)" }}>
                            Nuevo total: <strong style={{ color: "var(--text)" }}>{(newTotal + addQty).toLocaleString("es-PY")} unid.</strong>
                          </span>
                          {delta !== 0 ? (
                            <span style={{ fontWeight: 800, color: delta > 0 ? "var(--success)" : "var(--warning)" }}>
                              {delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString("es-PY")} unid. · requiere aprobación
                            </span>
                          ) : codeChanged ? (
                            <span style={{ fontWeight: 700, color: "var(--primary)" }}>Renombra el lote (directo, auditado)</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                    Los cambios de cantidad por pallet generan solicitudes de ajuste (RLAI/RLAO) pendientes de aprobación
                    del MANAGER — el stock no cambia hasta aprobar. El código y los datos del lote se aplican al guardar y quedan auditados.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Datos de lotes (global) — solo cuando no está el editor por lote */}
          {!canEditLots && (isEntry || movement.lotCode) && (
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
                  {usesSapLot ? (
                    <input
                      className="input"
                      style={{ fontFamily: "monospace" }}
                      value={sapLot}
                      onChange={(e) => setSapLot(e.target.value)}
                      placeholder={movement.sapLot ?? ""}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace", padding: "9px 0" }}
                      title="El material no utiliza Lote SAP.">
                      {movement.sapLot ?? "—"}
                    </div>
                  )}
                </div>
                {/* "Proveedor del lote" quitado — ver nota arriba: el código
                    de lote ya identifica al lote del proveedor. */}
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
