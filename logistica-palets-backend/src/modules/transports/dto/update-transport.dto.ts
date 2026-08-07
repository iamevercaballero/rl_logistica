import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { transportStatuses } from '../entities/transport.entity';
import { TransportDriverDto } from './create-transport.dto';

export class UpdateTransportDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  type?: string;

  /** Transportadora (empresa) — se copia al remito al elegir el vehículo. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  carrier?: string;

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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Registro de inspección del vehículo (queda en la bitácora). */
export class RegisterInspectionDto {
  @IsIn(['APROBADA', 'CON_OBSERVACIONES', 'RECHAZADA'])
  result: 'APROBADA' | 'CON_OBSERVACIONES' | 'RECHAZADA';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Estado operativo a aplicar tras la inspección (opcional). */
  @IsOptional()
  @IsIn(transportStatuses)
  setStatus?: string;
}
