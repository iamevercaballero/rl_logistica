import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { adjustmentReasons, movementTypes, MovementType } from '../entities/movement.entity';
import { IsBusinessDateString } from '../../../common/is-business-date-string.validator';

/**
 * Las cantidades del inventario son decimales (TS, KG, HL admiten fracciones).
 * Se aceptan hasta 3 decimales, alineado con `numeric(14,3)` en la base.
 */
const QUANTITY_OPTIONS = { maxDecimalPlaces: 3 } as const;
/** Mínimo positivo representable con 3 decimales — descarta 0 y negativos. */
const MIN_QUANTITY = 0.001;
/** Alineado con `pallets.weightKg` numeric(10,2). */
const WEIGHT_OPTIONS = { maxDecimalPlaces: 2 } as const;

export class PalletItemDto {
  /** SALIDA: ID de palet físico existente (marca palet como EXITED) */
  @IsOptional()
  @IsUUID()
  palletId?: string;

  /** ENTRADA: código de lote interno (crea palet si no existe) */
  @IsOptional()
  @IsString()
  lotCode?: string;

  @Type(() => Number)
  @IsNumber(QUANTITY_OPTIONS)
  @Min(MIN_QUANTITY)
  quantity: number;

  @IsOptional()
  @IsBusinessDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsBusinessDateString()
  fechaFabricacion?: string;

  /** Lote SAP del día (ej: Z051308201) — agrupa lotes proveedor del mismo día */
  @IsOptional()
  @IsString()
  sapLot?: string;

  /** Lote del proveedor — sólo trazabilidad; puede repetirse entre lotes internos. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierLot?: string;

  /** Proveedor del lote — informativo por ítem de entrada */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  proveedor?: string;

  /** Peso físico del pallet (kg) — informativo, se imprime en la etiqueta. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(WEIGHT_OPTIONS)
  @Min(0)
  weightKg?: number;

  /**
   * SALIDA: en cuántas paletas físicas quedó preparado este palet de origen.
   * Opcional y meramente informativo — no cambia cuánto se descuenta ni de
   * dónde. Se admite 0 para el palet cuyo contenido se consolidó en otro.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  dispatchedPallets?: number;

  /**
   * ENTRADA: Sector-Subsector destino de **este** pallet. Si se omite, hereda
   * el `locationId` de la línea — así el flujo simple (todo el lote al mismo
   * sector) sigue funcionando sin cambios, y el gestor de pallets puede
   * repartir el lote entre sectores distintos cuando hace falta.
   */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class CreateMovementDto {
  @IsIn(movementTypes)
  type: MovementType;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(QUANTITY_OPTIONS)
  @Min(MIN_QUANTITY)
  quantity?: number;

  /** Cantidad de palets físicos — es un conteo, siempre entero. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pallets?: number;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  fromLocationId?: string;

  @IsOptional()
  @IsUUID()
  toLocationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  driver?: string;

  /** CI del chofer — viene de Transportes, no se tipea a mano. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  driverDocument?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

  /** Documento de material informado por SAP (solo EXIT). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  documentoMaterial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsUUID()
  palletId?: string;

  @IsOptional()
  @IsUUID()
  lotId?: string;

  @IsOptional()
  @IsUUID()
  encargadoRecepcionId?: string;

  /** Marcar como entrada provisoria — crea movimiento PENDING_REGULARIZATION */
  @IsOptional()
  @IsBoolean()
  isProvisional?: boolean;

  /** Motivo del ajuste — obligatorio en ADJUSTMENT_IN / ADJUSTMENT_OUT */
  @IsOptional()
  @IsIn(adjustmentReasons)
  adjustmentReason?: string;

  /** Categoría libre del ajuste */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  adjustmentCategory?: string;

  /** Ítems de palets: uno por palet físico */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PalletItemDto)
  palletItems?: PalletItemDto[];
}
