import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLotDto {
  @IsString()
  lotCode: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsDateString()
  fechaFabricacion?: string;

  @IsOptional()
  @IsString()
  proveedor?: string;

  @IsOptional()
  @IsString()
  sapLot?: string;
}
