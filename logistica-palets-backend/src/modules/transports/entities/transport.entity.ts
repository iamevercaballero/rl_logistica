import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** Estado operativo del vehículo. */
export const transportStatuses = [
  'DISPONIBLE',
  'EN_RUTA',
  'MANTENIMIENTO',
  'FUERA_DE_SERVICIO',
] as const;
export type TransportStatus = (typeof transportStatuses)[number];

/** Chofer asociado al vehículo (serializado en driversJson). */
export type TransportDriver = {
  name: string;
  document?: string | null;
  phone?: string | null;
  license?: string | null;
  licenseExpiry?: string | null;
  status?: string | null;
};

@Index('uq_transport_plate', ['plate'], { unique: true })
@Entity('transports')
export class Transport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  plate: string; // ej: ABC-123

  @Column()
  type: string; // ej: SCANIA, CAMIONETA, CAMION

  @Column({ nullable: true })
  description?: string;

  /** Estado operativo (DISPONIBLE, EN_RUTA, MANTENIMIENTO, FUERA_DE_SERVICIO). */
  @Column({ type: 'varchar', length: 20, default: 'DISPONIBLE' })
  status: string;

  /** Capacidad de carga en pallets. */
  @Column({ type: 'int', nullable: true })
  capacityPallets?: number | null;

  /** Capacidad de carga en kilogramos. */
  @Column({ type: 'int', nullable: true })
  capacityKg?: number | null;

  /** Choferes asociados: JSON de TransportDriver[]. */
  @Column({ type: 'text', nullable: true })
  driversJson?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  active: boolean;
}
