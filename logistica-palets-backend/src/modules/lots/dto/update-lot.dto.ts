import { IsIn, IsOptional, IsString } from 'class-validator';
import { IsBusinessDateString } from '../../../common/is-business-date-string.validator';
import { LOT_STATUS_ARCHIVED } from '../entities/lot.entity';

/**
 * Estados que un supervisor puede fijar a mano desde la ficha del lote.
 *
 * `ARCHIVED` está incluido a propósito: archivar es la baja de `LotsService.remove`
 * y no destruye nada, así que un archivado por error se revierte poniendo el lote
 * en NORMAL, sin tener que tocar la base. Fijarlo por acá no saltea ningún control
 * de stock — archivar no mueve mercadería, y FEFO filtra por stock, no por estado.
 */
export const editableLotStatuses = [
  'NORMAL',
  'BLOQUEADO',
  'PENDING_REGULARIZATION',
  LOT_STATUS_ARCHIVED,
] as const;

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
