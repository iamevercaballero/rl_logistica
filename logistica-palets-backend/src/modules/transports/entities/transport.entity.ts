import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('transports')
export class Transport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  plate: string; // ej: ABC-123

  @Column()
  type: string; // ej: SCANIA, CAMIONETA, CAMION

  @Column({ nullable: true })
  description?: string;

  @Column({ default: true })
  active: boolean;
}
