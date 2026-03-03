import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('movements')
export class Movement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: string; // ENTRADA | SALIDA | TRANSFERENCIA

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;

  @Column({ nullable: true })
  reference?: string; // remisión, OC, etc.

  @Column({ nullable: true })
  notes?: string;
}
