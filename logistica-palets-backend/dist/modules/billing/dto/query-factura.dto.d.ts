import { EstadoFactura } from '../entities/factura.entity';
export declare class QueryFacturaDto {
    estado?: EstadoFactura;
    clienteId?: string;
    desde?: string;
    hasta?: string;
    buscar?: string;
    page?: number;
    limit?: number;
}
