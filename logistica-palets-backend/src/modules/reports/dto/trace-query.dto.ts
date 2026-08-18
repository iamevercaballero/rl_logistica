import { IsOptional, IsUUID } from 'class-validator';

export class TraceQueryDto {
  @IsUUID()
  materialId: string;

  /** Depósito activo. Es una preferencia: el backend valida el acceso igual. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
