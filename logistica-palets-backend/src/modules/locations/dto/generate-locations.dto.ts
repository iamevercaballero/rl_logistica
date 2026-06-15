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
 * Generador masivo de estructura: crea las posiciones de una zona en lote.
 * Código resultante: [prefijo-]PASILLO-R{rack}-N{nivel}-P{posición}
 * (las partes ausentes se omiten; una zona plana genera [prefijo-]P{n}).
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

  /** Pasillos a crear (ej: ["A","B"]). Omitido = zona plana sin pasillos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  @IsString({ each: true })
  aisles?: string[];

  /** Racks por pasillo. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  racks?: number;

  /** Niveles por rack (1 = piso). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  levels?: number;

  /** Posiciones por nivel (o posiciones totales en zona plana). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  positions: number;

  /** Capacidad en pallets de cada posición creada. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacityPallets?: number;
}
