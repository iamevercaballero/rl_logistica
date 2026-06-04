import { IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { planStatuses } from '../entities/production-plan.entity';

export class UpdateProductionPlanDto {
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @IsOptional()
  @IsEnum(['ENTRY', 'EXIT'])
  type?: 'ENTRY' | 'EXIT';

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  plannedQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedPallets?: number;

  @IsOptional()
  @IsEnum(planStatuses)
  status?: (typeof planStatuses)[number];

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
