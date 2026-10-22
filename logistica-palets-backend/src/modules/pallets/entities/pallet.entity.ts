import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformer } from '../../../common/numeric.transformer';

export const palletStatuses = [
  'AVAILABLE',
  'PARTIAL',
  'BLOCKED',
  'DAMAGED',
  'IN_TRANSIT',
  'EMPTY',
  'EXITED',
] as const;

export type PalletStatus = (typeof palletStatuses)[number];

/**
 * Estados de un palet que todavía es stock operable: se puede despachar y se
 * puede mover.
 *
 * `PARTIAL` cuenta. Un palet abierto —al que ya se le sacó algo— sigue
 * teniendo saldo en el piso; excluirlo deja stock que el sistema muestra pero
 * no deja tocar.
 *
 * Existe como constante porque el criterio estaba escrito a mano en cada
 * consulta y se desincronizó: el motor de salida aceptaba `AVAILABLE` y
 * `PARTIAL`, pero la pantalla que ofrece los lotes y el selector de
 * transferencias pedían sólo `AVAILABLE`. Resultado: tras la primera salida
 * parcial, el palet desaparecía de ambas pantallas y su saldo quedaba
 * inalcanzable, aunque el motor lo habría despachado sin problema. Se nota
 * sobre todo con el stock inicial, donde hay un solo palet por lote y la
 * primera salida parcial deja el lote entero sin nada seleccionable.
 */
export const OPERABLE_PALLET_STATUSES = ['AVAILABLE', 'PARTIAL'] as const;

@Index('idx_pallet_current_location', ['currentLocationId'])
@Index('idx_pallet_lot', ['lotId'])
@Index('idx_pallet_status', ['status'])
@Index('idx_pallet_pila', ['pilaId'])
@Entity('pallets')
export class Pallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'uuid' })
  lotId: string;

  @Column({ type: 'numeric', precision: 14, scale: 3, transformer: numericTransformer })
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

  /** Peso físico del pallet (kg) — informativo, cargado por lote en la entrada e impreso en la etiqueta. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  weightKg?: number | null;

  /** Pila (base física) a la que pertenece este pallet. Null en pallets EXITED/sin pila asignada. */
  @Column({ type: 'uuid', nullable: true })
  pilaId?: string | null;

  /** Nivel dentro de la pila — 1 = base (apoya en el piso), 2 = siguiente encima, etc. */
  @Column({ type: 'int', nullable: true })
  stackPosition?: number | null;
}
