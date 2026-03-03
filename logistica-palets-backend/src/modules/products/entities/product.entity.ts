import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string; // SKU / código interno

  @Column()
  description: string;

  @Column({ nullable: true })
  unitOfMeasure: string;

  @Column({ default: true })
  active: boolean;
  lots: any;
}
