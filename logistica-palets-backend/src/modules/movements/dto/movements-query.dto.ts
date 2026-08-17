import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { movementStatuses, movementTypes, MovementType } from '../entities/movement.entity';

export class MovementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Acepta un tipo (?type=ENTRY) o varios separados por coma (?type=ENTRY,EXIT). */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsIn(movementTypes, { each: true })
  type?: MovementType[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(movementStatuses)
  status?: string;

  /** Filtra Salidas según tengan o no Documento Material SAP. */
  @IsOptional()
  @IsIn(['PENDING', 'COMPLETED'])
  documentoMaterialStatus?: 'PENDING' | 'COMPLETED';
}
