import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  Index,
} from 'typeorm';
import { Location } from '../../locations/entities/location.entity';

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /** Código operativo estable usado en RLNE/RLNS (01, 02, ...). */
  @Index('idx_warehouse_document_code', { unique: true })
  @Column({ type: 'varchar', length: 2, nullable: true })
  documentCode?: string | null;

  @Column({ nullable: true })
  address: string;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => Location, (location) => location.warehouse)
  locations: Location[];


}
