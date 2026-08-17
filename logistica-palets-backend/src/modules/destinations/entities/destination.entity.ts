import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Destino reutilizable del catálogo de Salida.
 *
 * La relación con una RLNS es deliberadamente por snapshot de nombre en
 * `logistics_documents.destination`: renombrar o desactivar esta ficha no
 * modifica documentos históricos.
 */
@Index('uq_destination_name', ['name'], { unique: true })
@Entity('destinations')
export class Destination {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  active: boolean;
}
