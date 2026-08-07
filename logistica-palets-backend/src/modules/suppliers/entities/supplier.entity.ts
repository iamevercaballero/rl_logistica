import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Proveedor del catálogo. Los documentos guardan **además** una copia del
 * nombre (`logistics_documents.supplier`): si mañana el proveedor cambia de
 * razón social o se da de baja, los remitos viejos siguen mostrando con quién
 * se operó realmente ese día.
 */
@Index('uq_supplier_name', ['name'], { unique: true })
@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre o razón social. */
  @Column()
  name: string;

  /** RUC — opcional: muchos proveedores chicos operan sin él. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  ruc?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  active: boolean;
}
