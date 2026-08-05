import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { locationZones } from '../entities/location.entity';

/**
 * Generador masivo de estructura: crea los Sector-Subsector de una zona en
 * lote. Código resultante: [prefijo-]SECTOR-SECTOR{n} (ej: "B-B1"), o
 * [prefijo-]S{n} si no se indican sectores (subsectores planos, sin letra).
 * Todo el depósito es apilado en piso — no hay racks/niveles/posiciones que
 * generar acá; la capacidad real la da `capacityBases` (bases/pilas).
 */
export class GenerateLocationsDto {
  @IsUUID()
  warehouseId: string;

  @IsIn(locationZones)
  zone: string;

  /** Prefijo opcional del código (ej: "REC" para recepción). */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  codePrefix?: string;

  /** Sectores a crear (ej: ["A","B"]). Omitido = subsectores planos sin letra de sector. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  @IsString({ each: true })
  sectors?: string[];

  /**
   * Número del primer subsector a crear (ej: 4 → arranca en B4). Permite
   * correr el generador varias veces sobre el mismo sector con capacidades
   * distintas por tramo (ej: B1-B3 con una capacidad, B4-B13 con otra) sin
   * pisar lo ya creado — es idempotente por código, igual que antes.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subsectorStart?: number;

  /** Cantidad de subsectores a crear a partir de `subsectorStart` (ej: 10 → B4..B13 si arranca en 4). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  subsectorsPerSector: number;

  /** Capacidad en bases (pilas) de cada Sector-Subsector creado. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacityBases?: number;

  /** Techo de niveles de apilamiento propio de estos Sector-Subsector. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultMaxStackLevel?: number;
}
