import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateAlertRuleDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsInt()
  @Min(0)
  thresholdMin: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
