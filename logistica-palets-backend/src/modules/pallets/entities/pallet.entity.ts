import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('pallets')
export class Pallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'uuid' })
  lotId: string;

  @Column('int')
  quantity: number;

  @Column({ type: 'uuid' })
  currentLocationId: string;

  @Column({ default: 'AVAILABLE' })
  status: string;
}
