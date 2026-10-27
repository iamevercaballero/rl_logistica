import type { LotPallet } from "../../api/pallets";
import { distributeQty, fmtQty, parseQtyInput, quantityDelta, roundQty, sumQuantities } from "../../utils/quantity";

export type CandidatePallet = LotPallet & { lotCode: string };

/*
 * El cálculo del reparto vive acá y no en el componente de la tabla porque lo
 * usan también la página (para armar la línea del carrito) y sus tests, y
 * exportar funciones desde un archivo de componente rompe el fast refresh.
 */

/**
 * Las cantidades viven con 3 decimales (columna `numeric(14,3)`). Toda resta y
 * suma se hace por enteros escalados (`quantityDelta` / `sumQuantities`) para
 * que un residuo de coma flotante no haga "no coincidir" la asignación con el
 * faltante.
 */
const round3 = roundQty;

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
    const raw = physicalByPallet[p.id] ?? fmtQty(p.quantity);
    const phys = parseQtyInput(raw);
    if (phys === null || phys < 0) continue;
    const take = quantityDelta(p.quantity, phys);
    if (take > 0) palletItems.push({ palletId: p.id, quantity: take });
  }
  return { palletItems, total: sumQuantities(palletItems.map((i) => i.quantity)) };
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
    remaining = quantityDelta(remaining, take);
    physicalByPallet[p.id] = fmtQty(quantityDelta(p.quantity, take));
  }
  return { physicalByPallet, covered: quantityDelta(target, remaining) };
}

/**
 * Sobrante — espejo de `computeShortageAllocation`: por cada pallet contado por
 * ENCIMA de lo registrado, la diferencia es lo que se le agrega.
 */
export function computeSurplusAllocation(
  pallets: CandidatePallet[],
  physicalByPallet: Record<string, string>,
): { palletItems: { palletId: string; quantity: number }[]; total: number } {
  const palletItems: { palletId: string; quantity: number }[] = [];
  for (const p of pallets) {
    const raw = physicalByPallet[p.id] ?? fmtQty(p.quantity);
    const phys = parseQtyInput(raw);
    if (phys === null || phys < 0) continue;
    const add = quantityDelta(phys, p.quantity);
    if (add > 0) palletItems.push({ palletId: p.id, quantity: add });
  }
  return { palletItems, total: sumQuantities(palletItems.map((i) => i.quantity)) };
}

/**
 * Distribución automática del sobrante — **proporcional al stock de cada pallet**.
 *
 * No hay un FEFO del sobrante: el faltante se reparte vaciando el pallet que
 * saldría primero, pero si se contó el lote entero y sobran unidades, nadie
 * sabe de qué pallet salieron. Repartir en proporción a lo que cada uno ya
 * tiene es la convención que no inventa que sobró en uno en particular, y deja
 * el total del lote correcto igual.
 *
 * El resto de la división va al primer pallet, así la suma repartida es
 * exactamente el sobrante y no queda un saldo sin asignar. Si todos los pallets
 * están en cero —no hay proporción posible— se reparte en partes iguales.
 *
 * Devuelve el **conteo físico resultante por pallet**, igual que el faltante,
 * para que el resto del flujo no distinga quién cargó los números.
 */
export function autoDistributeSurplus(
  pallets: CandidatePallet[],
  target: number,
): { physicalByPallet: Record<string, string>; covered: number } {
  const physicalByPallet: Record<string, string> = {};
  if (pallets.length === 0) return { physicalByPallet, covered: 0 };

  const total = round3(target);
  const stockTotal = sumQuantities(pallets.map((p) => p.quantity));
  const partesIguales = stockTotal <= 0 ? distributeQty(total, pallets.length) : null;

  let remaining = total;
  pallets.forEach((p, i) => {
    const esUltimo = i === pallets.length - 1;
    // Al último le toca todo lo que quede: así la suma cierra exacta aunque la
    // proporción no dé redondeos parejos.
    const add = esUltimo
      ? Math.max(0, remaining)
      : Math.min(
          Math.max(0, remaining),
          partesIguales ? partesIguales[i] : round3((total * p.quantity) / stockTotal),
        );
    remaining = quantityDelta(remaining, add);
    physicalByPallet[p.id] = fmtQty(sumQuantities([p.quantity, add]));
  });

  return { physicalByPallet, covered: quantityDelta(total, Math.max(0, remaining)) };
}
