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

  @Column({ type: 'uuid', nullable: true })
  currentLocationId?: string | null;

  /** AVAILABLE | EXITED | BLOCKED | DAMAGED | IN_TRANSIT */
  @Column({ default: 'AVAILABLE' })
  status: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  exitedAt?: Date | null;
}
