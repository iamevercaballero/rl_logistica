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

  /**
   * El depósito opera con Lote SAP ("Lote Ypané").
   *
   * Complementa a `Product.usesSapLot`: el lote SAP se usa cuando el depósito
   * **y** el material lo usan. Apagarlo acá saca el concepto de todo el
   * depósito — el campo de la entrada y la fila de la etiqueta de pallet — sin
   * tener que apagarlo material por material.
   *
   * Como el flag de material, es configuración de operaciones futuras: los
   * `lots.sapLot` ya registrados no se modifican.
   */
  @Column({ default: true })
  usesSapLot: boolean;

  @OneToMany(() => Location, (location) => location.warehouse)
  locations: Location[];


}
