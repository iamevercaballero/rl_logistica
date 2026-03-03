import { IsOptional, IsInt, IsUUID, Min, IsIn } from 'class-validator';

export class UpdatePalletDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsUUID()
  currentLocationId?: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'BLOCKED', 'DAMAGED', 'IN_TRANSIT'])
  status?: string;
}
