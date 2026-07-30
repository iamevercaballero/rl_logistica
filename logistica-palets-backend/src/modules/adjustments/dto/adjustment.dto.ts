import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { adjustmentRequestTypes, AdjustmentRequestType } from '../entities/adjustment-request.entity';
import { PalletItemDto } from '../../movements/dto/create-movement.dto';

export class AdjustmentLineDto {
  @IsUUID()
  productId: string;

  /** Detalle de pallets (ADJUSTMENT_IN: con lotCode; ADJUSTMENT_OUT: con palletId). */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PalletItemDto)
  palletItems: PalletItemDto[];

  /** Ubicación específica de esta línea (override del header). */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class CreateAdjustmentDto {
  @IsIn(adjustmentRequestTypes)
  type: AdjustmentRequestType;

  /** Motivo del ajuste (obligatorio). */
  @IsString()
  @MaxLength(60)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  adjustmentCategory?: string;

  /**
   * Obligatorio para ADJUSTMENT_IN: sin depósito, el pallet nuevo queda con
   * currentLocationId null — stock "fantasma" invisible en las vistas por
   * depósito/ubicación (layout, ocupación, slotting). ADJUSTMENT_OUT no lo
   * necesita: usa la ubicación real del pallet que ya existe.
   */
  @ValidateIf((o: CreateAdjustmentDto) => o.type === 'ADJUSTMENT_IN')
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines: AdjustmentLineDto[];
}

export class UpdateAdjustmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  adjustmentCategory?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines?: AdjustmentLineDto[];
}

export class RejectAdjustmentDto {
  @IsString()
  @MaxLength(500)
  rejectReason: string;
}

export class AdjustmentQueryDto {
  @IsOptional()
  @IsIn(adjustmentRequestTypes)
  type?: AdjustmentRequestType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
