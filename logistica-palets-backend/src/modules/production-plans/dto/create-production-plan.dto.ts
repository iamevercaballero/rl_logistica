import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductionPlanDto {
  @IsDateString()
  plannedDate: string;

  @IsEnum(['ENTRY', 'EXIT'])
  type: 'ENTRY' | 'EXIT';

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
  @IsPositive()
  plannedQuantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedPallets?: number;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
