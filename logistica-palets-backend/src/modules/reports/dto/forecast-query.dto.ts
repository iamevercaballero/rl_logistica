import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ForecastQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  horizonDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  lookbackDays?: number;
}
