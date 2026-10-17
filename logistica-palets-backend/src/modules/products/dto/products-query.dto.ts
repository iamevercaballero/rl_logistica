import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination';

/**
 * Query del catálogo. Extiende la paginación porque el `ValidationPipe` global
 * corre con `forbidNonWhitelisted`: un `@Query()` tipado sólo como
 * `PageQueryDto` rechazaría `search` con "property search should not exist".
 */
export class ProductsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
