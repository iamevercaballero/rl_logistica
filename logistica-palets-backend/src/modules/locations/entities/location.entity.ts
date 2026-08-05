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
 * Ubicación física del depósito — es el Sector-Subsector que elige el
 * operario (ej. "B-B1"), la unidad que referencian stock, pallets y
 * movimientos (locationId). `aisle`/`rack` guardan Sector/Subsector (nombres
 * de columna sin cambiar por menor superficie de cambio); `level`/`position`
 * quedan sin usar — todo el depósito es apilado en piso, no hay estantería de
 * niveles fijos direccionables. La capacidad real ya no se mide en pallets
 * sino en bases (`capacityBases`): cada base es una pila, y una pila puede
 * alojar varios pallets apilables. Ver entidad `Pila`.
 */
@Index('uq_location_warehouse_code', ['warehouse', 'code'], { unique: true })
@Index('idx_location_zone', ['zone'])
@Entity('locations')
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string; // ej: B-B1 (Sector-Subsector)

  @Column({ default: 'RACK' })
  type: string; // RACK, PISO, TEMPORAL

  /** Zona operativa (RECEPCION, ALMACENAMIENTO, PICKING, DESPACHO, CUARENTENA, DEVOLUCIONES) */
  @Column({ type: 'varchar', length: 30, nullable: true })
  zone?: string | null;

  /** Sector (ej: "B") */
  @Column({ type: 'varchar', length: 20, nullable: true })
  aisle?: string | null;

  /** Subsector dentro del sector (ej: "B1") */
  @Column({ type: 'varchar', length: 20, nullable: true })
  rack?: string | null;

  /** @deprecated Sin uso — el depósito es 100% apilado en piso, no hay niveles direccionables. */
  @Column({ type: 'int', nullable: true })
  level?: number | null;

  /** @deprecated Sin uso — reemplazado por Pila (agrupación de pallets apilados). */
  @Column({ type: 'int', nullable: true })
  position?: number | null;

  /** @deprecated Reemplazado por `capacityBases` — la capacidad real es en pilas, no en pallets sueltos. */
  @Column({ type: 'int', nullable: true })
  capacityPallets?: number | null;

  /** Capacidad en bases (pilas) que caben en este Sector-Subsector. null = sin límite definido. */
  @Column({ type: 'int', nullable: true })
  capacityBases?: number | null;

  /**
   * Techo de niveles de apilamiento propio del Sector-Subsector (ej. limitado
   * por altura física del sector), independiente del `maxStackLevel` del
   * producto — el motor de colocación usa el menor de los dos.
   */
  @Column({ type: 'int', nullable: true })
  defaultMaxStackLevel?: number | null;

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
