import { IsUUID, IsInt, Min, IsOptional, IsString } from 'class-validator';

export class CreateTransferDto {
  @IsUUID()
  palletId: string;

  @IsUUID()
  destinationLocationId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
