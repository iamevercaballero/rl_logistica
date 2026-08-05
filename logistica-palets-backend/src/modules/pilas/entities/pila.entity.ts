import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export const pilaStatuses = ['OPEN', 'CLOSED', 'EMPTY'] as const;
export type PilaStatus = (typeof pilaStatuses)[number];

/**
 * Agrupación física de pallets apilados que comparten una base (un lugar de
 * piso) dentro de un Sector-Subsector (`Location`). El operario nunca elige
 * una pila directamente — el motor de colocación decide en cuál entra cada
 * pallet nuevo, o abre una. `productId`/`lotId` son una firma de compatibilidad
 * denormalizada (qué hay actualmente en la pila), null cuando está vacía.
 *
 * `locationId` es uuid sin FK, mismo criterio que `pallets.currentLocationId`
 * y `stocks.locationId` en este esquema.
 */
@Index('idx_pila_location', ['locationId'])
@Index('idx_pila_product', ['productId'])
@Index('idx_pila_status', ['status'])
@Index('uq_pila_location_sequence', ['locationId', 'sequence'], { unique: true })
@Entity('pilas')
export class Pila {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  locationId: string;

  /** Monotónico por ubicación — nunca se reutiliza, ni al vaciarse una pila vieja. */
  @Column({ type: 'int' })
  sequence: number;

  @Column({ default: 'OPEN' })
  status: string; // OPEN | CLOSED | EMPTY

  /** Techo de niveles propio de esta pila puntual; null = hereda de Location/Product. */
  @Column({ type: 'int', nullable: true })
  maxLevels?: number | null;

  @Column({ type: 'uuid', nullable: true })
  productId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  lotId?: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt?: Date | null;
}
