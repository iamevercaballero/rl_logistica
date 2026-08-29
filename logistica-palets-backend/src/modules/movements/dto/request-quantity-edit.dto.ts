import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsBusinessDateString } from '../../../common/is-business-date-string.validator';
import { NormalizeDecimal } from '../../../common/normalize-decimal.decorator';
import { MIN_QUANTITY, QUANTITY_NUMBER_OPTIONS, WEIGHT_NUMBER_OPTIONS } from '../../../common/quantity';

/**
 * Nueva cantidad de un pallet existente del movimiento.
 * ENTRY: solo se permite reducir el saldo actual del pallet.
 * EXIT: se compara contra lo que ESE movimiento registró para el pallet — se
 * puede subir (sacar más) o bajar (devolver stock).
 */
export class PalletQuantityEditDto {
  @IsUUID()
  palletId: string;

  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(0)
  newQuantity: number;

  /**
   * Nuevo peso del pallet (kg). Es un dato descriptivo, no mueve stock: se
   * aplica directo y queda auditado, sin pasar por aprobación.
   */
  @IsOptional()
  @NormalizeDecimal()
  @IsNumber(WEIGHT_NUMBER_OPTIONS)
  @Min(0)
  weightKg?: number;

  /**
   * SALIDA: paletas físicas con las que se despachó este palet. Descriptivo,
   * como el peso — se aplica directo y auditado, sin pasar por aprobación.
   *
   * Tres estados distintos, a propósito: ausente = no se toca; un número = ese
   * valor; `null` = se borra el dato informado.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  dispatchedPallets?: number | null;
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
  @IsBusinessDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsBusinessDateString()
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
  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(MIN_QUANTITY)
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
