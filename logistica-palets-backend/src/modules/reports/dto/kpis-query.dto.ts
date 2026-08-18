import { IsIn, IsOptional, IsUUID } from 'class-validator';

const ranges = ['today', 'week', 'month'] as const;

export class KpisQueryDto {
  @IsOptional()
  @IsIn(ranges)
  range?: (typeof ranges)[number];

  /** Depósito activo. Es una preferencia: el backend valida el acceso igual. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
