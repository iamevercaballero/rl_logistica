import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export interface SifenResponse {
    protocolo?: string;
    estado: 'APROBADO' | 'RECHAZADO' | 'ERROR';
    mensaje: string;
    codigoQR?: string;
}
export declare class SifenService {
    private readonly http;
    private readonly config;
    private readonly logger;
    constructor(http: HttpService, config: ConfigService);
    enviarDE(xmlFirmado: string, cdc: string): Promise<SifenResponse>;
    consultarEstado(cdc: string): Promise<SifenResponse>;
    private buildSoapEnvelope;
    private buildConsultaEnvelope;
    private parsearRespuesta;
    private construirUrlKUDE;
    private simularRespuesta;
}
