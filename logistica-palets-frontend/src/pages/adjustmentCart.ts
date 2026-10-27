import type { AdjustmentType, CreateAdjustmentLinePayload } from "../api/adjustments";
import type { Product } from "../api/products";
import type { LotPallet } from "../api/pallets";
import type { ScopedLot } from "../components/adjustments/LotPalletBreakdownTable";
import type { CountLevel } from "../components/adjustments/CountLevelPicker";
import type { ShortageMode } from "../components/adjustments/ShortageModePicker";
import type { SurplusDestination } from "../components/adjustments/SurplusAllocationPicker";

/** Un lote nuevo que se registra para alojar un sobrante. */
export type PalletLine = { qty: string };
export type LotGroup = {
  id: number; lotCode: string; quantity: string; palletCount: string;
  palletLines: PalletLine[]; fechaVencimiento: string; fechaFabricacion: string;
};

/**
 * El conteo crudo que generó una línea del carrito — lo necesario para volver a
 * mostrar el formulario tal como había quedado.
 *
 * `palletItems` y `summary` alcanzan para enviar la línea y para listarla, pero
 * no para reconstruir el sub-formulario: de ahí no se puede volver a sacar a
 * qué palet apuntaba el sobrante ni cómo se repartió el faltante. Sin esto,
 * corregir un conteo obligaba a quitar la línea y cargarla entera de nuevo.
 * Mismo criterio que el carrito de remitos en Movimientos.
 */
export type CartLineEditState = {
  product: Product;
  level: CountLevel;
  scopeLot: ScopedLot | null;
  scopePallet: LotPallet | null;
  physicalQtyInput: string;
  surplusDestination: SurplusDestination;
  surplusPallet: LotPallet | null;
  entrySapLot: string;
  lotGroups: LotGroup[];
  shortageMode: ShortageMode;
  shortagePhysicalByPallet: Record<string, string>;
};

/** Un material ya contado, esperando a que se envíe el ajuste. */
export type CartLine = {
  key: number; productId: string; productLabel: string;
  direction: AdjustmentType;
  palletItems: CreateAdjustmentLinePayload["palletItems"];
  totalQty: number; summary: string;
  /** Presente solo en líneas "pallet existente" — ubicación real del pallet, derivada, no pedida. */
  locationId?: string;
  level: CountLevel;
  scopeLabel: string;
  systemQty: number;
  physicalQty: number;
  editState: CartLineEditState;
};

/**
 * Una solicitud de ajuste a crear. Las salidas van todas juntas; las entradas
 * se separan por depósito, porque cada una registra pallets nuevos ahí.
 */
export type Bucket = { direction: AdjustmentType; warehouseId?: string; lines: CartLine[] };
