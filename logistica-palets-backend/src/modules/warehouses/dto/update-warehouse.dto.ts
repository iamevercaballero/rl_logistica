import { IsString, IsOptional, IsBoolean, Matches } from 'class-validator';

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/, { message: 'El código documental debe tener exactamente 2 dígitos' })
  documentCode?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** El depósito opera con Lote SAP. Apagarlo no toca los `lots.sapLot` ya guardados. */
  @IsOptional()
  @IsBoolean()
  usesSapLot?: boolean;
}
