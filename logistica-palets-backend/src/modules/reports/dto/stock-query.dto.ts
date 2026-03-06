import { IsOptional, IsUUID } from 'class-validator';

export class StockQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
