import { Response, Request } from 'express';
import { BillingService } from './billing.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { QueryFacturaDto } from './dto/query-factura.dto';
export declare class BillingController {
    private readonly service;
    constructor(service: BillingService);
    listarClientes(): Promise<import("./entities/cliente.entity").Cliente[]>;
    crearCliente(dto: CreateClienteDto): Promise<import("./entities/cliente.entity").Cliente>;
    obtenerCliente(id: string): Promise<import("./entities/cliente.entity").Cliente>;
    actualizarCliente(id: string, dto: Partial<CreateClienteDto>): Promise<import("./entities/cliente.entity").Cliente>;
    desactivarCliente(id: string): Promise<void>;
    listarFacturas(query: QueryFacturaDto): Promise<{
        data: import("./entities/factura.entity").Factura[];
        meta: any;
    }>;
    crearFactura(dto: CreateFacturaDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<import("./entities/factura.entity").Factura>;
    obtenerFactura(id: string): Promise<import("./entities/factura.entity").Factura>;
    enviarSIFEN(id: string): Promise<import("./entities/factura.entity").Factura>;
    cancelar(id: string): Promise<import("./entities/factura.entity").Factura>;
    consultarSifen(id: string): Promise<import("./entities/factura.entity").Factura>;
    descargarXML(id: string, res: Response): Promise<void>;
}
