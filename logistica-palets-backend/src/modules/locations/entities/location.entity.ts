import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

@Entity('locations')
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string; // ej: A1-01-02

  @Column({ default: 'RACK' })
  type: string; // RACK, PISO, TEMPORAL

  @ManyToOne(() => Warehouse, (warehouse) => warehouse.locations, {
    eager: true,
  })
  warehouse: Warehouse;

  @Column({ default: true })
  active: boolean;
}
