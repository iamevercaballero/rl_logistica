import { Factura } from './entities/factura.entity';
export declare class XmlGeneratorService {
    generarCDC(factura: Factura, codigoSeguridad: string): string;
    generarXML(factura: Factura, emisor: EmisorConfig): string;
    private agregarItem;
    private tipoOperacion;
    private fmt;
    private formatFecha;
    private formatHora;
    private modulo11;
    generarCodigoSeguridad(): string;
}
export interface EmisorConfig {
    ruc: string;
    dv: string;
    razonSocial: string;
    nombreFantasia?: string;
    direccion: string;
    numeroCasa?: string;
    codigoDepartamento?: string;
    codigoDistrito?: string;
    codigoCiudad?: string;
    telefono?: string;
    email?: string;
    actividadEconomica?: string;
    descripcionActividad?: string;
    responsable: string;
    cargoResponsable?: string;
}
