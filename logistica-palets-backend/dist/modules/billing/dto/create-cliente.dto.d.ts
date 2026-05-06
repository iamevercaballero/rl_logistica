import { TipoContribuyente } from '../entities/cliente.entity';
export declare class CreateClienteDto {
    ruc: string;
    dv: string;
    razonSocial: string;
    nombreFantasia?: string;
    tipoContribuyente: TipoContribuyente;
    direccion?: string;
    email?: string;
    telefono?: string;
    codigoDepartamento?: string;
    codigoDistrito?: string;
    codigoCiudad?: string;
}
