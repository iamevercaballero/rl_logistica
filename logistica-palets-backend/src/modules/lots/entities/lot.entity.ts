import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { numericTransformer } from '../../../common/numeric.transformer';

@Index('uq_lot_product_code', ['productId', 'lotCode'], { unique: true })
@Index('idx_lot_status', ['status'])
@Index('idx_lot_product', ['productId'])
@Index('idx_lot_vencimiento', ['fechaVencimiento'])
@Entity('lots')
export class Lot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  lotCode: string;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { eager: true })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'date', nullable: true })
  fechaVencimiento?: string | null;

  @Column({ type: 'date', nullable: true })
  fechaFabricacion?: string | null;

  @Column({ type: 'varchar', nullable: true })
  proveedor?: string | null;

  @Column({ type: 'varchar', nullable: true })
  sapLot?: string | null;

  /**
   * Lote del proveedor — dato de trazabilidad únicamente. Puede repetirse entre
   * lotes internos distintos (un mismo envío del proveedor suele partirse en
   * varios lotes internos), por eso NO participa de la clave de unicidad, que
   * es (productId, lotCode).
   */
  @Column({ type: 'varchar', nullable: true })
  supplierLot?: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer })
  stockActual: number;

  /**
   * Estado del lote:
   *   NORMAL                  → operativo
   *   BLOQUEADO               → retenido por el supervisor (calidad, revisión)
   *   PENDING_REGULARIZATION  → vino de una entrada provisoria, falta completarlo
   *   ARCHIVED                → dado de baja conservando su historia (ver
   *                             `LotsService.remove`). No se borra: `movements.lotId`
   *                             y `pallets.lotId` no tienen FK, así que eliminarlo
   *                             dejaría esas filas apuntando al vacío.
   *
   * Un lote ARCHIVED nunca entra en FEFO, pero no porque se lo excluya por estado:
   * archivar exige stock cero y sin pallets vivos, y las dos consultas FEFO
   * (`LotsService.findFefo` y `MovementsService.autoFefoExit`) filtran por stock.
   */
  @Column({ type: 'varchar', default: 'NORMAL' })
  status: string;
}

/** Lote dado de baja conservando su historia. Lo fija `LotsService.remove`. */
export const LOT_STATUS_ARCHIVED = 'ARCHIVED';
