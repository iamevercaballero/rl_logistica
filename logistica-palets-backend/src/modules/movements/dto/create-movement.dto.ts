import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { adjustmentReasons, movementTypes, MovementType } from '../entities/movement.entity';

export class PalletItemDto {
  /** SALIDA: ID de palet físico existente (marca palet como EXITED) */
  @IsOptional()
  @IsUUID()
  palletId?: string;

  /** ENTRADA: código de lote (crea palet si no existe) */
  @IsOptional()
  @IsString()
  lotCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsDateString()
  fechaFabricacion?: string;

  /** Lote SAP del día (ej: Z051308201) — agrupa lotes proveedor del mismo día */
  @IsOptional()
  @IsString()
  sapLot?: string;
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
  @IsInt()
  @Min(1)
  quantity?: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

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
