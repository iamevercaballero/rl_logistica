import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { QueryFacturaDto } from './dto/query-factura.dto';
import { Cliente } from './entities/cliente.entity';
import { Factura } from './entities/factura.entity';
import { XmlGeneratorService } from './xml-generator.service';
import { SifenService } from './sifen.service';
export declare class BillingService {
    private readonly dataSource;
    private readonly clienteRepo;
    private readonly facturaRepo;
    private readonly xmlGenerator;
    private readonly sifenService;
    private readonly config;
    constructor(dataSource: DataSource, clienteRepo: Repository<Cliente>, facturaRepo: Repository<Factura>, xmlGenerator: XmlGeneratorService, sifenService: SifenService, config: ConfigService);
    crearCliente(dto: CreateClienteDto): Promise<Cliente>;
    listarClientes(): Promise<Cliente[]>;
    obtenerCliente(id: string): Promise<Cliente>;
    actualizarCliente(id: string, dto: Partial<CreateClienteDto>): Promise<Cliente>;
    desactivarCliente(id: string): Promise<void>;
    crearFactura(dto: CreateFacturaDto, userId: string): Promise<Factura>;
    listarFacturas(query: QueryFacturaDto): Promise<{
        data: Factura[];
        meta: any;
    }>;
    obtenerFactura(id: string): Promise<Factura>;
    generarYEnviarSIFEN(id: string): Promise<Factura>;
    cancelarFactura(id: string): Promise<Factura>;
    obtenerXML(id: string): Promise<string>;
    consultarEstadoSifen(id: string): Promise<Factura>;
    private calcularItem;
    private calcularTotales;
    private getEmisorConfig;
}
