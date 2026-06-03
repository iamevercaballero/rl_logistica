import { IsString, IsInt, IsUUID, Min, IsOptional, IsIn } from 'class-validator';

export class CreatePalletDto {
  @IsString()
  code: string;

  @IsUUID()
  lotId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsUUID()
  currentLocationId: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'PARTIAL', 'BLOCKED', 'DAMAGED', 'IN_TRANSIT', 'EMPTY'])
  status?: string;
}
