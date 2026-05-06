import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { tiposContribuyente, TipoContribuyente } from '../entities/cliente.entity';

export class CreateClienteDto {
  @IsString()
  @MaxLength(20)
  ruc: string;

  @IsString()
  @MaxLength(2)
  dv: string;

  @IsString()
  @MaxLength(200)
  razonSocial: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombreFantasia?: string;

  @IsEnum(tiposContribuyente)
  tipoContribuyente: TipoContribuyente;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccion?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  codigoDepartamento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  codigoDistrito?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  codigoCiudad?: string;
}
