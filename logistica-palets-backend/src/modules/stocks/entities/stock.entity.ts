import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_stock_product_warehouse_location', ['productId', 'warehouseId', 'locationId'])
@Index('idx_stock_product', ['productId'])
@Entity('stocks')
export class Stock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  locationId?: string | null;

  @Column({ type: 'int', default: 0 })
  currentQuantity: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
