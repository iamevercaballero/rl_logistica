import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  description: string;

  @Column({ nullable: true })
  unitOfMeasure: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'int', nullable: true })
  stockMinimo?: number | null;

  @Column({ default: true })
  stackable: boolean;

  @Column({ type: 'int', nullable: true })
  maxStackLevel?: number | null;

  @Column({ default: true })
  canReceiveWeightOnTop: boolean;

  @Column({ type: 'varchar', nullable: true })
  stackingNotes?: string | null;
}
