import {
  computeShortageAllocation,
  computeSurplusAllocation,
  type CandidatePallet,
} from "../components/adjustments/allocation";
import type { AdjustmentType, CreateAdjustmentLinePayload } from "../api/adjustments";
import { fmtQty, parseQtyInput, quantitiesEqual, quantityDelta, quantityMismatch, sumQuantities, toQtyPayload } from "../utils/quantity";
import { palletDistributionError, sapLotForProduct } from "./movementFormModel";
import type { Product } from "../api/products";
import type { LotGroup } from "./adjustmentCart";

type LineaArmada = {
  direction: AdjustmentType;
  palletItems: CreateAdjustmentLinePayload["palletItems"];
  totalQty: number;
  summary: string;
};

/**
 * Línea de una diferencia repartida entre los pallets que ya existen.
 *
 * El faltante y el sobrante son el mismo mecanismo con el signo al revés: se
 * recontó cada pallet y la diferencia sale sola. Vive fuera de la pantalla
 * porque es cálculo puro —entra el reparto, sale la línea o el error— y porque
 * el archivo de la pantalla ya estaba contra el tope de líneas del linter.
 *
 * `target` es la diferencia total a cubrir, siempre positiva.
 */
export function buildDistributedLine(
  direction: AdjustmentType,
  pallets: CandidatePallet[],
  physicalByPallet: Record<string, string>,
  target: number,
  automatico: boolean,
): LineaArmada | { error: string } {
  const esSobrante = direction === "ADJUSTMENT_IN";
  const { palletItems, total } = esSobrante
    ? computeSurplusAllocation(pallets, physicalByPallet)
    : computeShortageAllocation(pallets, physicalByPallet);

  if (palletItems.length === 0) {
    return {
      error: esSobrante
        ? "Recontá al menos un pallet donde encontraste más, para repartir el sobrante."
        : "Recontá al menos un pallet donde encontraste menos, para cubrir el faltante.",
    };
  }

  if (!quantitiesEqual(total, target)) {
    const pending = quantityDelta(target, total);
    const verbo = esSobrante ? "repartir" : "asignar";
    const nombre = esSobrante ? "sobrante" : "faltante";
    return {
      error: pending > 0
        ? `Falta ${verbo} ${fmtQty(pending)} unidades — llevás ${fmtQty(total)} de ${fmtQty(target)}.`
        : `Te pasaste por ${fmtQty(Math.abs(pending))} unidades — ${esSobrante ? "repartiste" : "asignaste"} ${fmtQty(total)} y el ${nombre} es ${fmtQty(target)}.`,
    };
  }

  const lotsUsed = [...new Set(palletItems
    .map((i) => pallets.find((p) => p.id === i.palletId)?.lotCode)
    .filter((v): v is string => !!v))];
  const reparto = automatico ? (esSobrante ? " (reparto automático)" : " (distribución automática)") : "";
  const detalle = `${palletItems.length} pallet${palletItems.length !== 1 ? "s" : ""}${reparto}`;

  return { direction, palletItems, totalQty: target, summary: `Lotes: ${lotsUsed.join(", ")} · ${detalle}` };
}

/**
 * Línea de un sobrante que se registra como pallet(s) nuevo(s).
 *
 * Es el mismo formulario de lotes que usa la Entrada, así que comparte sus
 * validaciones: la suma de los lotes tiene que dar la diferencia, y si el lote
 * se desglosa en pallets, la suma de esos pallets tiene que dar el lote.
 */
export function buildNewPalletSurplusLine(
  product: Product,
  lotGroups: LotGroup[],
  entrySapLot: string,
  diff: number,
): LineaArmada | { error: string } {
  const validGroups = lotGroups.filter((g) => g.lotCode.trim() && (parseQtyInput(g.quantity) ?? 0) > 0);
  if (validGroups.length === 0) return { error: "Indicá el lote donde vas a registrar el sobrante." };

  const sumGroups = sumQuantities(validGroups.map((g) => parseQtyInput(g.quantity) ?? 0));
  if (!quantitiesEqual(sumGroups, diff)) {
    return { error: `La suma asignada no coincide con la diferencia — ${quantityMismatch(diff, sumGroups).message}. Ajustá las cantidades.` };
  }

  for (const g of validGroups) {
    if (g.palletLines.length > 0) {
      const err = palletDistributionError(
        g.palletLines.map((l) => l.qty),
        g.quantity,
        { label: `Lote ${g.lotCode.trim()}` },
      );
      if (err) return { error: err };
    }
  }

  const palletItems = validGroups.flatMap((g) => {
    // Igual que en la Entrada: al material sin Lote SAP no se le manda uno.
    const base = {
      lotCode: g.lotCode.trim(),
      fechaVencimiento: g.fechaVencimiento || undefined,
      fechaFabricacion: g.fechaFabricacion || undefined,
      sapLot: sapLotForProduct(product, entrySapLot),
    };
    if (g.palletLines.length > 0) return g.palletLines.map((l) => ({ ...base, quantity: toQtyPayload(l.qty) ?? 0 }));
    return [{ ...base, quantity: toQtyPayload(g.quantity) ?? 0 }];
  });

  return {
    direction: "ADJUSTMENT_IN",
    palletItems,
    totalQty: diff,
    summary: `Lotes: ${validGroups.map((g) => g.lotCode.trim()).join(", ")}`,
  };
}
