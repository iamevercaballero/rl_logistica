import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { documentTypes, DocumentType } from '../entities/logistics-document.entity';
import { PalletItemDto } from './create-movement.dto';

/**
 * Una línea del documento = un producto (con sus lotes/pallets).
 * Hereda la cabecera (remito, proveedor, transporte) del documento padre,
 * por lo que el operador la carga una sola vez.
 */
export class CreateDocumentLineDto {
  @IsUUID()
  productId: string;

  /** Cantidad total de la línea (si no se usan palletItems). Admite decimales. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity?: number;

  /** Cantidad de palets físicos — es un conteo, siempre entero. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pallets?: number;

  /** Ubicación destino (entrada) u origen (salida) de esta línea. */
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /** Lote existente (cuando aplica sin palletItems). */
  @IsOptional()
  @IsUUID()
  lotId?: string;

  /** Detalle palet a palet de esta línea. */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PalletItemDto)
  palletItems?: PalletItemDto[];
}

export class CreateDocumentDto {
  @IsIn(documentTypes)
  type: DocumentType;

  @IsOptional()
  @IsDateString()
  date?: string;

  /** N° de remito (proveedor en entrada, salida en despacho). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  documentNumber?: string;

  /** Proveedor (entrada). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplier?: string;

  /** Cliente / destino (salida). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

  /** Depósito principal (destino en entrada, origen en salida). */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  driver?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehiclePlate?: string;

  @IsOptional()
  @IsUUID()
  encargadoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Marca todo el documento como entrada provisoria (PENDING_REGULARIZATION). */
  @IsOptional()
  @IsBoolean()
  isProvisional?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDocumentLineDto)
  lines: CreateDocumentLineDto[];
}
