import { IsString, IsNumber, IsUUID, Min, IsOptional, IsIn } from 'class-validator';
import { NormalizeDecimal } from '../../../common/normalize-decimal.decorator';
import { MIN_QUANTITY, QUANTITY_NUMBER_OPTIONS } from '../../../common/quantity';

export class CreatePalletDto {
  @IsString()
  code: string;

  @IsUUID()
  lotId: string;

  /** Cantidad del palet — admite decimales (`pallets.quantity` es `numeric(14,3)`). */
  @NormalizeDecimal()
  @IsNumber(QUANTITY_NUMBER_OPTIONS)
  @Min(MIN_QUANTITY)
  quantity: number;

  @IsUUID()
  currentLocationId: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'PARTIAL', 'BLOCKED', 'DAMAGED', 'IN_TRANSIT', 'EMPTY'])
  status?: string;
}
