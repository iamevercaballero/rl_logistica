import {
  Column, CreateDateColumn, Entity, Index, JoinColumn,
  ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Cliente } from './cliente.entity';
import { ItemFactura } from './item-factura.entity';

export const estadosFactura = ['BORRADOR', 'PENDIENTE', 'APROBADO', 'RECHAZADO', 'CANCELADO'] as const;
export type EstadoFactura = typeof estadosFactura[number];

export const condicionesPago = ['CONTADO', 'CREDITO'] as const;
export type CondicionPago = typeof condicionesPago[number];

export const tiposDE = ['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'AUTOFACTURA', 'NOTA_REMISION'] as const;
export type TipoDE = typeof tiposDE[number];

const tiposDECode: Record<TipoDE, string> = {
  FACTURA: '01',
  NOTA_CREDITO: '05',
  NOTA_DEBITO: '06',
  AUTOFACTURA: '07',
  NOTA_REMISION: '08',
};
export { tiposDECode };

@Entity('facturas')
export class Factura {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: tiposDE, default: 'FACTURA' })
  tipoDE: TipoDE;

  @Column({ length: 3 })
  establecimiento: string;

  @Column({ length: 3 })
  puntoExpedicion: string;

  @Column()
  numeroDocumento: number;

  @Column({ length: 20 })
  timbrado: string;

  @Column({ type: 'date' })
  fechaVigenciaTimbrado: Date;

  @Column({ length: 44, nullable: true })
  @Index({ unique: true, where: 'cdc IS NOT NULL' })
  cdc: string;

  @Column({ type: 'uuid' })
  clienteId: string;

  @ManyToOne(() => Cliente, (c) => c.facturas, { eager: true })
  @JoinColumn({ name: 'clienteId' })
  cliente: Cliente;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  fecha: Date;

  @Column({ type: 'enum', enum: condicionesPago, default: 'CONTADO' })
  condicionPago: CondicionPago;

  @Column({ length: 3, default: 'PYG' })
  moneda: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  subtotalExenta: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  subtotal5: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  subtotal10: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  iva5: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  iva10: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalGeneral: number;

  @Column({ type: 'enum', enum: estadosFactura, default: 'BORRADOR' })
  estado: EstadoFactura;

  @Column({ type: 'text', nullable: true })
  xmlGenerado: string;

  @Column({ length: 500, nullable: true })
  codigoQR: string;

  @Column({ length: 20, nullable: true })
  protocoloSifen: string;

  @Column({ length: 1000, nullable: true })
  mensajeSifen: string;

  @Column({ type: 'timestamp', nullable: true })
  fechaAprobacion: Date;

  @Column({ type: 'uuid', nullable: true })
  movimientoId: string;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ length: 500, nullable: true })
  observaciones: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ItemFactura, (i) => i.factura, { cascade: true, eager: true })
  items: ItemFactura[];

  get numeroFormateado(): string {
    return `${this.establecimiento}-${this.puntoExpedicion}-${String(this.numeroDocumento).padStart(7, '0')}`;
  }
}
