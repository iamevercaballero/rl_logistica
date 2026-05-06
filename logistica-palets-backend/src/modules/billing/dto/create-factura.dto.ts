import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsEnum, IsOptional, IsString,
  IsUUID, MaxLength, ValidateNested,
} from 'class-validator';
import { condicionesPago, CondicionPago, tiposDE, TipoDE } from '../entities/factura.entity';
import { afectacionesIVA, AfectacionIVA } from '../entities/item-factura.entity';

export class CreateItemFacturaDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigo?: string;

  @IsString()
  @MaxLength(500)
  descripcion: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unidadMedida?: string;

  @Type(() => Number)
  cantidad: number;

  @Type(() => Number)
  precioUnitario: number;

  @IsOptional()
  @Type(() => Number)
  descuentoPorcentaje?: number;

  @IsEnum(afectacionesIVA)
  afectacionIVA: AfectacionIVA;
}

export class CreateFacturaDto {
  @IsEnum(tiposDE)
  tipoDE: TipoDE;

  @IsUUID()
  clienteId: string;

  @IsOptional()
  @IsDateString()
  fecha?: string;

  @IsEnum(condicionesPago)
  condicionPago: CondicionPago;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  moneda?: string;

  @IsOptional()
  @IsUUID()
  movimientoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateItemFacturaDto)
  items: CreateItemFacturaDto[];
}
