import { Type } from 'class-transformer';
import { IsInt, IsUUID, Min } from 'class-validator';

/**
 * Vista previa de cómo va a quedar armado un lote de pallets en un
 * Sector-Subsector, antes de confirmar la entrada. No reserva nada — el
 * plan real se rearma (y ahí sí se confirma) al enviar la entrada.
 */
export class PreviewPlacementDto {
  @IsUUID()
  locationId: string;

  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  palletCount: number;
}
