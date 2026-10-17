import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { documentTypes, DocumentType } from '../entities/logistics-document.entity';
import { PalletItemDto } from './create-movement.dto';
import { NormalizeDecimal } from '../../../common/normalize-decimal.decorator';
import { MAX_QUANTITY, MIN_QUANTITY, QUANTITY_NUMBER_OPTIONS } from '../../../common/quantity';

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
  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(MIN_QUANTITY)
  @Max(MAX_QUANTITY)
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
  // Mismo tope que `CreateMovementDto.palletItems`, y por el mismo motivo: cada
  // palet abre su propio bloqueo pesimista dentro de la transacción, así que
  // una sola petición con miles de ítems sostiene la tabla bloqueada. El tope
  // vivía sólo en el endpoint de movimiento suelto; ésta es la ruta que usa la
  // pantalla de entradas y salidas, y aceptaba cualquier cantidad.
  @ArrayMaxSize(200)
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

  /** Documento de material informado por SAP (solo Salida). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  documentoMaterial?: string;

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

  /** CI del chofer — viene de Transportes, no se tipea a mano. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  driverDocument?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehiclePlate?: string;

  /**
   * Responsable de la recepción (entrada) / envío (salida). Obligatorio en una
   * entrada: la nota y el checklist lo imprimen en "RECIBIDO POR" y es un dato
   * operativo distinto de quién registró el remito. En una salida es opcional
   * (el "RECIBIDO POR" de la nota de salida lo firma el cliente en destino).
   */
  @ValidateIf((o: CreateDocumentDto) => o.type === 'ENTRY' || o.encargadoId !== undefined)
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
  // Un remito real no pasa de unas decenas de líneas; el tope acota el trabajo
  // que una sola petición puede encadenar dentro de la transacción.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateDocumentLineDto)
  lines: CreateDocumentLineDto[];
}
