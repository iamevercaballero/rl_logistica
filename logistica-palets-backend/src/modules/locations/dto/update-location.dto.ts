import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  // opcional: permitir cambiar de depósito
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
