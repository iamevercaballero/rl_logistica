import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  attachmentCategories,
  attachmentEntityTypes,
  type AttachmentCategory,
  type AttachmentEntityType,
} from '../entities/attachment.entity';

/**
 * Parámetros de la subida de un adjunto.
 *
 * Antes llegaban como `@Query('entityType')` sueltos, y el `ValidationPipe` global
 * no alcanza a los parámetros por nombre: `entityId` podía ser cualquier cadena y
 * `entityType`/`category` cualquier texto, que terminaba insertado en columnas
 * `varchar(20)` — un 500 en el mejor caso, un adjunto colgado de una entidad
 * inexistente en el peor. Con un DTO, el pipe global sí los valida.
 */
export class UploadAttachmentDto {
  /** Nombre descriptivo que pone el operador. Obligatorio por regla de negocio. */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'El nombre del archivo es obligatorio.' })
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsIn(attachmentCategories)
  category?: AttachmentCategory;

  @IsIn(attachmentEntityTypes)
  entityType: AttachmentEntityType;

  @IsUUID()
  entityId: string;
}

/** Filtros para listar adjuntos o el historial de una entidad. */
export class AttachmentQueryDto {
  @IsIn(attachmentEntityTypes)
  entityType: AttachmentEntityType;

  @IsUUID()
  entityId: string;
}
