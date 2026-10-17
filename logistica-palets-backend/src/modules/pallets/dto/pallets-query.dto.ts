import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination';

/** Query del listado de palets. Ver `ProductsQueryDto` por qué extiende la paginación. */
export class PalletsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
