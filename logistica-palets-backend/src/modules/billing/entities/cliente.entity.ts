import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Factura } from './factura.entity';

export const tiposContribuyente = ['JURIDICA', 'FISICA'] as const;
export type TipoContribuyente = typeof tiposContribuyente[number];

@Entity('clientes')
export class Cliente {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  ruc: string;

  @Column({ length: 2 })
  dv: string;

  @Column({ length: 200 })
  razonSocial: string;

  @Column({ length: 200, nullable: true })
  nombreFantasia: string;

  @Column({ type: 'enum', enum: tiposContribuyente, default: 'JURIDICA' })
  tipoContribuyente: TipoContribuyente;

  @Column({ length: 300, nullable: true })
  direccion: string;

  @Column({ length: 100, nullable: true })
  email: string;

  @Column({ length: 30, nullable: true })
  telefono: string;

  @Column({ length: 5, nullable: true })
  codigoDepartamento: string;

  @Column({ length: 5, nullable: true })
  codigoDistrito: string;

  @Column({ length: 5, nullable: true })
  codigoCiudad: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Factura, (f) => f.cliente)
  facturas: Factura[];
}
