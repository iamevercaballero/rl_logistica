import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { temperatureZones } from '../../locations/entities/location.entity';

export const rotationPolicies = ['FEFO', 'FIFO'] as const;

export class CreateProductDto {
  @IsString()
  @Length(1, 80)
  code: string;

  @IsString()
  @Length(2, 160)
  description: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  unitOfMeasure?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockMinimo?: number;

  /**
   * El material se maneja con Lote SAP. Sin especificar, queda en `true`
   * (comportamiento actual): el campo es opt-out explícito, no opt-in.
   */
  @IsOptional()
  @IsBoolean()
  usesSapLot?: boolean;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxStackLevel?: number | null;

  @IsOptional()
  @IsBoolean()
  canReceiveWeightOnTop?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  stackingNotes?: string | null;

  /* ── Atributos de slotting ─────────────────────────────────────────────── */

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  heightCm?: number;

  @IsOptional()
  @IsBoolean()
  fragile?: boolean;

  @IsOptional()
  @IsIn(temperatureZones)
  temperatureZone?: string;

  @IsOptional()
  @IsIn(rotationPolicies)
  rotationPolicy?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  compatibilityGroup?: string | null;
}
