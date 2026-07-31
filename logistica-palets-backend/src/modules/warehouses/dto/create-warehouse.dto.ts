import { IsString, IsOptional, IsBoolean, Length } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
