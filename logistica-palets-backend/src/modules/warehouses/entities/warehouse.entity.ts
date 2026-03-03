import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { Location } from '../../locations/entities/location.entity';

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => Location, (location) => location.warehouse)
  locations: Location[];


}
