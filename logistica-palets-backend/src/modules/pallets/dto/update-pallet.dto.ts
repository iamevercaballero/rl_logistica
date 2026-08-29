import { IsOptional, IsNumber, IsUUID, Min, IsIn } from 'class-validator';
import { NormalizeDecimal } from '../../../common/normalize-decimal.decorator';
import { QUANTITY_NUMBER_OPTIONS } from '../../../common/quantity';

export class UpdatePalletDto {
  /** Nueva cantidad del palet — admite decimales; 0 lo deja vacío. */
  @IsOptional()
  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsUUID()
  currentLocationId?: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'PARTIAL', 'BLOCKED', 'DAMAGED', 'IN_TRANSIT', 'EMPTY'])
  status?: string;
}
