import { IsOptional, IsString } from 'class-validator';

export class UpdateLotDto {
  @IsOptional()
  @IsString()
  lotCode?: string;
}
