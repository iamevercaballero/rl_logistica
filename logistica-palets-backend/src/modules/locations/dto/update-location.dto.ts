import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { locationZones, temperatureZones } from '../entities/location.entity';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  // opcional: permitir cambiar de depósito
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  type?: string;

  @IsOptional()
  @IsIn(locationZones)
  zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  aisle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  rack?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  level?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacityPallets?: number;

  /* ── Restricciones de slotting ─────────────────────────────────────────── */

  @IsOptional()
  @IsIn(temperatureZones)
  temperatureZone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxHeightCm?: number;

  @IsOptional()
  @IsBoolean()
  allowsStacking?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
