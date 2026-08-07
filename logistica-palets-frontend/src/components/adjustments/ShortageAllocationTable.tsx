import type { LotPallet } from "../../api/pallets";

export type CandidatePallet = LotPallet & { lotCode: string };

/**
 * Las cantidades viven con 3 decimales (columna `numeric(14,3)`). Redondear a esa
 * misma escala evita que 7.058 − 6.000,1 dé 1.057,9999999999 y que la suma
 * asignada "no coincida" con el faltante por un error de punto flotante.
 */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const fmt = (n: number) => n.toLocaleString("es-PY");

/**
 * Misma lógica que usará el envío: por cada pallet con un físico válido y menor al
 * sistema, la diferencia (positiva) es lo que se descuenta de ese pallet. Pallets no
 * tocados o con físico ≥ sistema no aportan a esta línea de salida.
 */
export function computeShortageAllocation(
  pallets: CandidatePallet[],
  physicalByPallet: Record<string, string>,
): { palletItems: { palletId: string; quantity: number }[]; total: number } {
  const palletItems: { palletId: string; quantity: number }[] = [];
  for (const p of pallets) {
    const raw = physicalByPallet[p.id] ?? String(p.quantity);
    const phys = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(phys) || phys < 0) continue;
    const take = round3(p.quantity - phys);
    if (take > 0) palletItems.push({ palletId: p.id, quantity: take });
  }
  return { palletItems, total: round3(palletItems.reduce((s, i) => s + i.quantity, 0)) };
}

/**
 * Distribución automática del faltante — mismo criterio FEFO que el motor de salidas
 * del backend (`autoFefoExit`): consume los pallets en el orden en que llegan de
 * `/lots/fefo` (lotes con vencimiento más próximo primero) y vacía cada uno antes de
 * pasar al siguiente. Devuelve el **conteo físico resultante por pallet**, no la
 * cantidad tomada, para que el resto del flujo (validación, resumen y envío) sea
 * idéntico al del recuento manual — lo único que cambia es quién carga los números.
 *
 * `covered` es lo que efectivamente se pudo repartir: si es menor a `target`, los
 * pallets disponibles no alcanzan para cubrir el faltante.
 */
export function autoDistributeShortage(
  pallets: CandidatePallet[],
  target: number,
): { physicalByPallet: Record<string, string>; covered: number } {
  const physicalByPallet: Record<string, string> = {};
  let remaining = round3(target);
  for (const p of pallets) {
    const take = Math.min(p.quantity, Math.max(0, remaining));
    remaining = round3(remaining - take);
    physicalByPallet[p.id] = String(round3(p.quantity - take));
  }
  return { physicalByPallet, covered: round3(target - remaining) };
}

type Props = {
  pallets: CandidatePallet[];
  physicalByPallet: Record<string, string>;
  onPhysicalChange: (palletId: string, value: string) => void;
  locationMap: Record<string, string>;
  /** Faltante total a cubrir (positivo) — base del pendiente en vivo. */
  target: number;
  /** En modo automático la distribución la hizo el sistema: se muestra, no se edita. */
  readOnly?: boolean;
};

/**
 * Faltante — distribución explícita por pallet: en vez de pedir "cuánto tomar",
 * se recontea cada pallet (Sistema → Físico) y la diferencia se calcula sola,
 * igual que el resto del flujo. El pie muestra en vivo cuánto falta asignar para
 * llegar al faltante, y cada fila ofrece el valor exacto que lo cierra.
 */
export default function ShortageAllocationTable({
  pallets, physicalByPallet, onPhysicalChange, locationMap, target, readOnly,
}: Props) {
  if (pallets.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Sin pallets disponibles para cubrir el faltante.</p>;
  }

  const { total: assigned } = computeShortageAllocation(pallets, physicalByPallet);
  const pending = round3(target - assigned);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        {readOnly
          ? "Distribución del faltante — así lo repartió el sistema (FEFO: vencimiento más próximo primero)"
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
          const raw = physicalByPallet[p.id] ?? String(p.quantity);
          const phys = Number(raw);
          const valid = raw.trim() !== "" && Number.isFinite(phys) && phys >= 0;
          const take = valid ? round3(p.quantity - phys) : 0;
          const isSurplusHere = valid && take < 0;
          // Valor que, puesto en esta fila, deja el faltante exacto en cero. Solo se
          // ofrece si cabe en el pallet (no puede quedar negativo ni superar el stock).
          const closeValue = valid ? round3(phys - pending) : null;
          const canClose = !readOnly && pending !== 0 && closeValue !== null && closeValue >= 0 && closeValue <= p.quantity;
          return (
            <div key={p.id} style={{ borderBottom: idx < pallets.length - 1 ? "1px solid var(--border)" : undefined }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px 90px 110px", gap: 8, alignItems: "start", padding: "6px 10px" }}>
                <span style={{ fontSize: 12, fontFamily: "monospace", paddingTop: 5 }}>{p.lotCode}</span>
                <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", paddingTop: 5 }}>{p.code}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", paddingTop: 5 }}>{p.currentLocationId ? locationMap[p.currentLocationId] ?? p.currentLocationId.slice(0, 8) : "—"}</span>
                <span style={{ textAlign: "right", fontSize: 13, paddingTop: 5 }}>{fmt(p.quantity)}</span>
                <div style={{ display: "grid", gap: 2 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={raw}
                    readOnly={readOnly}
                    tabIndex={readOnly ? -1 : undefined}
                    onChange={(e) => onPhysicalChange(p.id, e.target.value)}
                    style={{ fontSize: 13, padding: "3px 6px", borderColor: !valid ? "var(--danger)" : undefined, opacity: readOnly ? 0.75 : undefined, cursor: readOnly ? "default" : undefined }}
                    aria-label={`Conteo físico del pallet ${p.code}`}
                  />
                  {canClose && (
                    <button
                      type="button"
                      onClick={() => onPhysicalChange(p.id, String(closeValue))}
                      title={`Dejar ${fmt(closeValue!)} en este pallet cierra el faltante exacto`}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--primary)", fontSize: 11, fontWeight: 700, textAlign: "left" }}
                    >
                      {closeValue! < phys ? "↓" : "↑"} {fmt(closeValue!)}
                    </button>
                  )}
                </div>
                <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, paddingTop: 5, color: !valid ? "var(--muted)" : take > 0 ? "var(--danger)" : take < 0 ? "var(--warning)" : "var(--muted)" }}>
                  {!valid ? "—" : take === 0 ? "0" : take > 0 ? `−${fmt(take)}` : `+${fmt(Math.abs(take))}`}
                </span>
              </div>
              {isSurplusHere && (
                <div style={{ padding: "0 10px 6px", fontSize: 11, color: "var(--warning)" }}>
                  Este pallet tiene sobrante — cargalo aparte con un conteo a nivel Pallet.
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
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--success)" }}>✓ Faltante cubierto</span>
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
