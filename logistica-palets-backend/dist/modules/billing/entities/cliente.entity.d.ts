import { Factura } from './factura.entity';
export declare const tiposContribuyente: readonly ["JURIDICA", "FISICA"];
export type TipoContribuyente = typeof tiposContribuyente[number];
export declare class Cliente {
    id: string;
    ruc: string;
    dv: string;
    razonSocial: string;
    nombreFantasia: string;
    tipoContribuyente: TipoContribuyente;
    direccion: string;
    email: string;
    telefono: string;
    codigoDepartamento: string;
    codigoDistrito: string;
    codigoCiudad: string;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
    facturas: Factura[];
}
