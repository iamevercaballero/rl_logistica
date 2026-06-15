import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TransferPalletItemDto {
  @IsUUID()
  palletId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
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
