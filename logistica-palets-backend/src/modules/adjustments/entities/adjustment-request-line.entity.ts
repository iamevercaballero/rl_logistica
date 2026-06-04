import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Una línea de una solicitud de ajuste: un producto con sus lotes/pallets.
 * palletItemsJson almacena el mismo array que CreateMovementDto.palletItems,
 * serializado como JSON. Se reconstruye al aprobar para crear los Movements.
 */
@Index('idx_adj_line_request', ['requestId'])
@Entity('adjustment_request_lines')
export class AdjustmentRequestLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  requestId: string;

  @Column({ type: 'uuid' })
  productId: string;

  /**
   * JSON serializado de PalletItem[]:
   * ADJUSTMENT_IN: [{ lotCode, quantity, fechaVencimiento?, fechaFabricacion?, sapLot? }, ...]
   * ADJUSTMENT_OUT: [{ palletId, quantity }, ...]
   */
  @Column({ type: 'text' })
  palletItemsJson: string;

  /** Cantidad total de esta línea (denormalizado para listados rápidos). */
  @Column({ type: 'int', default: 0 })
  totalQuantity: number;

  /** Ubicación específica de esta línea (override de la del request). */
  @Column({ type: 'uuid', nullable: true })
  locationId?: string | null;
}
