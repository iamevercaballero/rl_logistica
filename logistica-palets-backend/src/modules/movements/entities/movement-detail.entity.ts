import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('movement_details')
export class MovementDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  movementId: string;

  @Column({ type: 'uuid' })
  palletId: string;

  @Column({ type: 'uuid' })
  lotId: string;

  @Column({ type: 'uuid' })
  locationId: string;

  @Column('int')
  quantity: number;
}
