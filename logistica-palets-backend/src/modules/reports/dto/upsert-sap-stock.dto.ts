import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class UpsertSapStockDto {
  @IsDateString()
  date: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sapQuantity: number;
}
