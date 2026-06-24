import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { transportStatuses } from '../entities/transport.entity';

export const driverStatuses = ['ACTIVO', 'INACTIVO'] as const;

export class TransportDriverDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  /** Número de licencia de conducir. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  license?: string;

  /** Vencimiento de la licencia (YYYY-MM-DD). */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  licenseExpiry?: string;

  /** Estado del chofer (ACTIVO / INACTIVO). */
  @IsOptional()
  @IsIn(driverStatuses)
  status?: string;
}

export class CreateTransportDto {
  @IsString()
  @MaxLength(30)
  plate: string;

  @IsString()
  @MaxLength(60)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsIn(transportStatuses)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacityPallets?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacityKg?: number;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TransportDriverDto)
  @ArrayMaxSize(10)
  drivers?: TransportDriverDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
