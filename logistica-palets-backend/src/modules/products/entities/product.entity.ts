import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../common/numeric.transformer';

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

  /**
   * El material se maneja con Lote SAP ("Lote Ypané").
   *
   * En `true` las entradas siguen autocompletando `Lot.sapLot` como hasta hoy;
   * en `false` el sistema nunca escribe un lote SAP para este material — ni
   * automáticamente en la entrada ni al corregir un movimiento.
   *
   * Es configuración de operaciones **futuras**: apagarlo no toca los lotes SAP
   * ya registrados. Y no participa de la identidad del lote — esa sigue siendo
   * `lotCode`, igual que antes.
   */
  @Column({ default: true })
  usesSapLot: boolean;

  @Column({ default: true })
  stackable: boolean;

  @Column({ type: 'int', nullable: true })
  maxStackLevel?: number | null;

  @Column({ default: true })
  canReceiveWeightOnTop: boolean;

  @Column({ type: 'varchar', nullable: true })
  stackingNotes?: string | null;

  /* ── Atributos para slotting (ubicación recomendada) ───────────────────── */

  /** Peso del pallet estándar de este producto (kg). */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  weightKg?: number | null;

  /** Altura del pallet estándar (cm). */
  @Column({ type: 'int', nullable: true })
  heightCm?: number | null;

  /** Requiere manejo cuidadoso (no apilar peso encima, zona protegida). */
  @Column({ default: false })
  fragile: boolean;

  /** Requisito de temperatura: AMBIENT | CHILLED | FROZEN. */
  @Column({ type: 'varchar', length: 20, default: 'AMBIENT' })
  temperatureZone: string;

  /** Política de rotación: FEFO (por vencimiento) | FIFO (por ingreso). */
  @Column({ type: 'varchar', length: 10, default: 'FEFO' })
  rotationPolicy: string;

  /** Grupo de compatibilidad (ej: ALIMENTOS, QUIMICOS). Para futuras reglas. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  compatibilityGroup?: string | null;
}
