import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { locationZones } from '../entities/location.entity';

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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
