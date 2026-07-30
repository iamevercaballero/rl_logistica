import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Nueva cantidad de un pallet existente del movimiento.
 * ENTRY: solo se permite reducir el saldo actual del pallet.
 * EXIT: se compara contra lo que ESE movimiento registró para el pallet — se
 * puede subir (sacar más) o bajar (devolver stock).
 */
export class PalletQuantityEditDto {
  @IsUUID()
  palletId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  newQuantity: number;
}

export class QuantityEditLotDto {
  @IsUUID()
  lotId: string;

  /** Renombrar el código de lote — directo, auditado, cascada a códigos de pallets. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  newLotCode?: string;

  /** Datos del lote — se aplican directo (sin stock), auditados. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sapLot?: string;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsDateString()
  fechaFabricacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  proveedor?: string;

  /** Reducciones por pallet (newQuantity ≤ cantidad actual del pallet). */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PalletQuantityEditDto)
  palletEdits?: PalletQuantityEditDto[];

  /** Unidades a agregar al lote → se crean pallets nuevos al aprobar. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  addQuantity?: number;

  /** En cuántos pallets nuevos repartir el agregado (default 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  addPalletCount?: number;
}

export class RequestQuantityEditDto {
  @IsString()
  @MinLength(5)
  reason: string;

  @ValidateNested({ each: true })
  @Type(() => QuantityEditLotDto)
  @ArrayMinSize(1)
  lots: QuantityEditLotDto[];
}
