import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { locationZones } from '../entities/location.entity';

export class CreateLocationDto {
  @IsString()
  code: string; // ej: A-R1-N2-P3

  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  type?: string; // RACK, PISO, TEMPORAL

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
}
