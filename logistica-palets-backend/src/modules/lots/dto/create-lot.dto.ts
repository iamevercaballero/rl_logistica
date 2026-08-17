import { IsOptional, IsString, IsUUID } from 'class-validator';
import { IsBusinessDateString } from '../../../common/is-business-date-string.validator';

export class CreateLotDto {
  @IsString()
  lotCode: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsBusinessDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsBusinessDateString()
  fechaFabricacion?: string;

  @IsOptional()
  @IsString()
  proveedor?: string;

  @IsOptional()
  @IsString()
  sapLot?: string;
}
