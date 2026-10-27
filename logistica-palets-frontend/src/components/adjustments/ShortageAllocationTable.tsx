import QuantityInput from "../../design-system/QuantityInput";
import { fmtQty, parseQtyInput, quantityDelta, sumQuantities } from "../../utils/quantity";
import {
  computeShortageAllocation,
  computeSurplusAllocation,
  type CandidatePallet,
} from "./allocation";

const fmt = fmtQty;

type Props = {
  pallets: CandidatePallet[];
  physicalByPallet: Record<string, string>;
  onPhysicalChange: (palletId: string, value: string) => void;
  locationMap: Record<string, string>;
  /** Faltante total a cubrir (positivo) — base del pendiente en vivo. */
  target: number;
  /** En modo automático la distribución la hizo el sistema: se muestra, no se edita. */
  readOnly?: boolean;
  /**
   * Qué se está repartiendo. El faltante descuenta de cada pallet y el sobrante
   * le agrega; el resto —recontar pallet por pallet y derivar la diferencia— es
   * idéntico, así que la tabla es la misma.
   */
  direction?: "SHORTAGE" | "SURPLUS";
};

/**
 * Faltante — distribución explícita por pallet: en vez de pedir "cuánto tomar",
 * se recontea cada pallet (Sistema → Físico) y la diferencia se calcula sola,
 * igual que el resto del flujo. El pie muestra en vivo cuánto falta asignar para
 * llegar al faltante, y cada fila ofrece el valor exacto que lo cierra.
 */
export default function ShortageAllocationTable({
  pallets, physicalByPallet, onPhysicalChange, locationMap, target, readOnly, direction = "SHORTAGE",
}: Props) {
  const esSobrante = direction === "SURPLUS";
  const palabra = esSobrante ? "sobrante" : "faltante";
  if (pallets.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Sin pallets disponibles para cubrir el {palabra}.</p>;
  }

  const { total: assigned } = esSobrante
    ? computeSurplusAllocation(pallets, physicalByPallet)
    : computeShortageAllocation(pallets, physicalByPallet);
  const pending = quantityDelta(target, assigned);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        {readOnly
          ? esSobrante
            ? "Distribución del sobrante — así lo repartió el sistema (en proporción al stock de cada pallet)"
            : "Distribución del faltante — así lo repartió el sistema (FEFO: vencimiento más próximo primero)"
          : esSobrante
            ? "Distribución del sobrante — recontá los pallets donde encontraste más"
            : "Distribución del faltante — recontá los pallets donde encontraste menos"}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px 90px 110px", gap: 8, padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
          <span>Lote</span>
          <span>Pallet</span>
          <span>Ubicación</span>
          <span style={{ textAlign: "right" }}>Sistema</span>
          <span>Físico</span>
          <span style={{ textAlign: "right" }}>Diferencia</span>
        </div>
        {pallets.map((p, idx) => {
          const raw = physicalByPallet[p.id] ?? fmtQty(p.quantity);
          const phys = parseQtyInput(raw);
          const valid = phys !== null && phys >= 0;
          // `aporta` es lo que esta fila suma al total que se está repartiendo:
          // en el faltante, lo que se descuenta; en el sobrante, lo que se agrega.
          const aporta = phys !== null && valid
            ? (esSobrante ? quantityDelta(phys, p.quantity) : quantityDelta(p.quantity, phys))
            : 0;
          // Una fila con el signo contrario al que se está cargando: no es un
          // error de tipeo necesariamente, pero no entra en este ajuste.
          const alReves = valid && aporta < 0;
          // Valor que, puesto en esta fila, deja la cuenta exacta en cero.
          const closeValue = phys !== null && valid
            ? (esSobrante ? sumQuantities([phys, pending]) : quantityDelta(phys, pending))
            : null;
          // En el faltante no puede pedir más de lo que el pallet tiene; en el
          // sobrante no hay techo, sólo no puede quedar negativo.
          const canClose = !readOnly && pending !== 0 && closeValue !== null && closeValue >= 0
            && (esSobrante || closeValue <= p.quantity);
          return (
            <div key={p.id} style={{ borderBottom: idx < pallets.length - 1 ? "1px solid var(--border)" : undefined }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px 90px 110px", gap: 8, alignItems: "start", padding: "6px 10px" }}>
                <span style={{ fontSize: 12, fontFamily: "monospace", paddingTop: 5 }}>{p.lotCode}</span>
                <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", paddingTop: 5 }}>{p.code}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", paddingTop: 5 }}>{p.currentLocationId ? locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8) : "—"}</span>
                <span style={{ textAlign: "right", fontSize: 13, paddingTop: 5 }}>{fmt(p.quantity)}</span>
                <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <QuantityInput
                    allowZero
                    align="right"
                    value={raw}
                    readOnly={readOnly}
                    invalid={!valid}
                    onChange={(v) => onPhysicalChange(p.id, v)}
                    style={{ width: "100%", fontSize: 13, padding: "3px 6px", opacity: readOnly ? 0.75 : undefined, cursor: readOnly ? "default" : undefined }}
                    aria-label={`Conteo físico del pallet ${p.code}`}
                  />
                  {canClose && (
                    <button
                      type="button"
                      onClick={() => onPhysicalChange(p.id, fmtQty(closeValue!))}
                      title={`Dejar ${fmt(closeValue!)} en este pallet cierra el ${palabra} exacto`}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--primary)", fontSize: 11, fontWeight: 700, textAlign: "left" }}
                    >
                      {closeValue! < (phys ?? 0) ? "↓" : "↑"} {fmt(closeValue!)}
                    </button>
                  )}
                </div>
                <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, paddingTop: 5, color: !valid ? "var(--muted)" : aporta > 0 ? (esSobrante ? "var(--success)" : "var(--danger)") : aporta < 0 ? "var(--warning)" : "var(--muted)" }}>
                  {!valid
                    ? "—"
                    : aporta === 0
                      ? "0"
                      : aporta > 0
                        ? `${esSobrante ? "+" : "−"}${fmt(aporta)}`
                        : `${esSobrante ? "−" : "+"}${fmt(Math.abs(aporta))}`}
                </span>
              </div>
              {alReves && (
                <div style={{ padding: "0 10px 6px", fontSize: 11, color: "var(--warning)" }}>
                  {esSobrante
                    ? "Este pallet tiene faltante — cargalo aparte, no entra en este sobrante."
                    : "Este pallet tiene sobrante — cargalo aparte con un conteo a nivel Pallet."}
                </div>
              )}
            </div>
          );
        })}
        {/* Pie en vivo: el operador ve cuánto le falta sin sacar la cuenta a mano. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "8px 10px", borderTop: "1.5px solid var(--border)", background: "var(--bg)" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Asignado <strong style={{ color: "var(--text)" }}>{fmt(assigned)}</strong> de {fmt(target)}
          </span>
          {pending === 0 ? (
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--success)" }}>✓ {esSobrante ? "Sobrante repartido" : "Faltante cubierto"}</span>
          ) : pending > 0 ? (
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--warning)" }}>Falta asignar {fmt(pending)}</span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)" }}>Te pasaste por {fmt(Math.abs(pending))}</span>
          )}
        </div>
      </div>
    </div>
  );
}
