import { IsOptional, IsInt, IsUUID, Min, IsIn } from 'class-validator';

export class UpdatePalletDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsUUID()
  currentLocationId?: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'PARTIAL', 'BLOCKED', 'DAMAGED', 'IN_TRANSIT', 'EMPTY'])
  status?: string;
}
