import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
} from 'typeorm';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';
import { numericTransformer } from '../../../common/numeric.transformer';

/** Zonas operativas estándar de un depósito. */
export const locationZones = [
  'RECEPCION',
  'ALMACENAMIENTO',
  'PICKING',
  'DESPACHO',
  'CUARENTENA',
  'DEVOLUCIONES',
] as const;
export type LocationZone = (typeof locationZones)[number];

/** Zonas de temperatura para slotting (compartido con Product). */
export const temperatureZones = ['AMBIENT', 'CHILLED', 'FROZEN'] as const;
export type TemperatureZone = (typeof temperatureZones)[number];

/**
 * Ubicación física del depósito. Es la unidad que referencian stock, pallets
 * y movimientos (locationId). La jerarquía Zona → Pasillo → Rack → Nivel →
 * Posición se modela como atributos de la misma fila: el código sigue siendo
 * el identificador operativo y nada del resto del sistema cambia.
 */
@Index('uq_location_warehouse_code', ['warehouse', 'code'], { unique: true })
@Index('idx_location_zone', ['zone'])
@Entity('locations')
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string; // ej: A-R1-N2-P3

  @Column({ default: 'RACK' })
  type: string; // RACK, PISO, TEMPORAL

  /** Zona operativa (RECEPCION, ALMACENAMIENTO, PICKING, DESPACHO, CUARENTENA, DEVOLUCIONES) */
  @Column({ type: 'varchar', length: 30, nullable: true })
  zone?: string | null;

  /** Pasillo (ej: "A") */
  @Column({ type: 'varchar', length: 20, nullable: true })
  aisle?: string | null;

  /** Rack dentro del pasillo (ej: "R2") */
  @Column({ type: 'varchar', length: 20, nullable: true })
  rack?: string | null;

  /** Nivel del rack (1 = piso) */
  @Column({ type: 'int', nullable: true })
  level?: number | null;

  /** Posición dentro del nivel */
  @Column({ type: 'int', nullable: true })
  position?: number | null;

  /** Capacidad en pallets (null = sin límite definido) */
  @Column({ type: 'int', nullable: true })
  capacityPallets?: number | null;

  /* ── Restricciones para slotting (ubicación recomendada) ───────────────── */

  /** Temperatura que ofrece la ubicación: AMBIENT | CHILLED | FROZEN. */
  @Column({ type: 'varchar', length: 20, default: 'AMBIENT' })
  temperatureZone: string;

  /** Peso máximo soportado (kg). null = sin límite definido. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  maxWeightKg?: number | null;

  /** Altura máxima del hueco (cm). null = sin límite definido. */
  @Column({ type: 'int', nullable: true })
  maxHeightCm?: number | null;

  /** Permite apilar más de un pallet (junto con capacityPallets). */
  @Column({ default: true })
  allowsStacking: boolean;

  @ManyToOne(() => Warehouse, (warehouse) => warehouse.locations, {
    eager: true,
  })
  warehouse: Warehouse;

  @Column({ default: true })
  active: boolean;
}
