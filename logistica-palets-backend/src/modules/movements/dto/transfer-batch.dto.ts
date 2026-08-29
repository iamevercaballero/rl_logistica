import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { NormalizeDecimal } from '../../../common/normalize-decimal.decorator';
import { MIN_QUANTITY, QUANTITY_NUMBER_OPTIONS } from '../../../common/quantity';

export class TransferPalletItemDto {
  @IsUUID()
  palletId: string;

  /** Cantidad a transferir de este palet — admite decimales (`numeric(14,3)`). */
  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(MIN_QUANTITY)
  quantity: number;
}

export class TransferBatchLineDto {
  @IsUUID()
  productId: string;

  @ValidateNested({ each: true })
  @Type(() => TransferPalletItemDto)
  @ArrayMinSize(1)
  palletItems: TransferPalletItemDto[];
}

/**
 * Transferencia multi-producto en una sola transacción:
 * mueve N pallets (de distintos productos/lotes) de una ubicación a otra.
 * Genera un movimiento TRANSFER por producto, todos o ninguno.
 */
export class TransferBatchDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsUUID()
  fromLocationId: string;

  @IsUUID()
  toLocationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ValidateNested({ each: true })
  @Type(() => TransferBatchLineDto)
  @ArrayMinSize(1)
  lines: TransferBatchLineDto[];
}
