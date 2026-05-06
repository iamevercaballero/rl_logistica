import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Factura } from './factura.entity';

export const afectacionesIVA = ['IVA10', 'IVA5', 'EXENTA', 'EXONERADA'] as const;
export type AfectacionIVA = typeof afectacionesIVA[number];

const afectacionCode: Record<AfectacionIVA, string> = {
  IVA10: '1',
  IVA5: '2',
  EXENTA: '3',
  EXONERADA: '4',
};
export { afectacionCode };

@Entity('items_factura')
export class ItemFactura {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  facturaId: string;

  @ManyToOne(() => Factura, (f) => f.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'facturaId' })
  factura: Factura;

  @Column()
  orden: number;

  @Column({ length: 50, nullable: true })
  codigo: string;

  @Column({ length: 500 })
  descripcion: string;

  @Column({ length: 10, default: 'UNI' })
  unidadMedida: string;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  cantidad: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  precioUnitario: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  descuentoPorcentaje: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  descuentoMonto: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalBruto: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalNeto: number;

  @Column({ type: 'enum', enum: afectacionesIVA, default: 'IVA10' })
  afectacionIVA: AfectacionIVA;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 10 })
  tasaIVA: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  baseGravada: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  ivaLiquidado: number;
}
