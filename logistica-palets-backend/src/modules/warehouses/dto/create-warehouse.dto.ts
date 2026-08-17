import { IsString, IsOptional, IsBoolean, Length, Matches } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsString()
  @Matches(/^\d{2}$/, { message: 'El código documental debe tener exactamente 2 dígitos' })
  documentCode: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
