import { IsBooleanString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination';

/** Query del listado de lotes. Ver `ProductsQueryDto` por qué extiende la paginación. */
export class LotsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sapLot?: string;

  @IsOptional()
  @IsBooleanString()
  includePallets?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
