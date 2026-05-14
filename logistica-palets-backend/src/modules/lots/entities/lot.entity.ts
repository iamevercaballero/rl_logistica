import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Product } from '../../products/entities/product.entity';

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

  @Column({ type: 'int', default: 0 })
  stockActual: number;

  @Column({ type: 'varchar', default: 'NORMAL' })
  status: string;
}
