import { IsDateString, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { NormalizeDecimal } from '../../../common/normalize-decimal.decorator';
import { QUANTITY_NUMBER_OPTIONS } from '../../../common/quantity';

export class UpsertSapStockDto {
  @IsDateString()
  date: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  /**
   * Cantidad informada por SAP para esta celda. Se compara contra el stock del
   * sistema (`numeric(14,3)`) en el reporte de diferencias, así que admite
   * decimales: en `integer` aparecían diferencias inexistentes ante cualquier
   * stock fraccionario.
   */
  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(0)
  sapQuantity: number;
}
