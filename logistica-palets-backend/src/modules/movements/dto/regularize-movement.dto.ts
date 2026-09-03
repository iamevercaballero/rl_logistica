import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsBusinessDateString } from '../../../common/is-business-date-string.validator';

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
  @IsOptional() @IsString() @MaxLength(80) documentoMaterial?: string;
  /**
   * Documento Material es dato de LÍNEA: SAP no siempre devuelve el mismo
   * número para cada material de una misma tanda, y muchas veces llega
   * después del despacho. Por eso se edita una línea a la vez.
   *
   * Con `true` el valor se copia al resto de las líneas del remito — el caso
   * en que SAP sí devolvió un único documento para toda la tanda.
   */
  @IsOptional() @IsBoolean() applyDocumentoMaterialToDocument?: boolean;
  @IsOptional() @IsString() notes?: string;

  // Campos de lote — se aplican a todos los lotes asociados al movimiento
  @IsOptional() @IsString() sapLot?: string;
  @IsOptional() @IsBusinessDateString() fechaVencimiento?: string;
  @IsOptional() @IsBusinessDateString() fechaFabricacion?: string;
  @IsOptional() @IsString() proveedor?: string;
}
