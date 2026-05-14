import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class RegularizeMovementDto {
  /** Motivo de la regularización — obligatorio para auditoría */
  @IsString()
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres' })
  reason: string;

  // Campos de cabecera del movimiento
  @IsOptional() @IsString() documentNumber?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() carrier?: string;
  @IsOptional() @IsString() driver?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() notes?: string;

  // Campos de lote — se aplican a todos los lotes asociados al movimiento
  @IsOptional() @IsString() sapLot?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsDateString() fechaFabricacion?: string;
  @IsOptional() @IsString() proveedor?: string;
}
