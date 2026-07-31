import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

/** Estados que un supervisor puede fijar a mano desde la ficha del lote. */
export const editableLotStatuses = ['NORMAL', 'BLOQUEADO', 'PENDING_REGULARIZATION'] as const;

export class UpdateLotDto {
  @IsOptional()
  @IsString()
  lotCode?: string;

  /**
   * Vía soportada para liberar (o bloquear) un lote. Sin esto, un lote que quedaba
   * en PENDING_REGULARIZATION sólo se podía destrabar con un UPDATE manual sobre la base.
   */
  @IsOptional()
  @IsIn(editableLotStatuses)
  status?: string;

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
