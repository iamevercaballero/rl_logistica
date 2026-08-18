import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../common/numeric.transformer';

@Index('idx_movement_detail_movement', ['movementId'])
@Index('idx_movement_detail_pallet', ['palletId'])
@Index('idx_movement_detail_lot', ['lotId'])
@Index('idx_movement_detail_location', ['locationId'])
@Index('idx_movement_detail_pila', ['pilaId'])
@Entity('movement_details')
export class MovementDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  movementId: string;

  @Column({ type: 'uuid', nullable: true })
  palletId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  lotId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  locationId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  pilaId?: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 3, transformer: numericTransformer })
  quantity: number;

  @Column({ type: 'varchar', nullable: true })
  role?: string | null;

  /**
   * SALIDA: en cuántas paletas físicas quedó preparado este palet de origen.
   *
   * Es un dato **informativo** de cómo salió la carga del depósito: el stock,
   * los lotes y el palet de origen se descuentan igual que siempre (FEFO /
   * selección parcial), sin mirar este número. `null` = no se informó, que es
   * el caso normal y equivale a que el palet salió como una sola paleta.
   */
  @Column({ type: 'int', nullable: true })
  dispatchedPallets?: number | null;
}
