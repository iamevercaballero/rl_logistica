import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface SifenResponse {
  protocolo?: string;
  estado: 'APROBADO' | 'RECHAZADO' | 'ERROR';
  mensaje: string;
  codigoQR?: string;
}

@Injectable()
export class SifenService {
  private readonly logger = new Logger(SifenService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Envía el XML firmado al SIFEN y retorna el resultado.
   * SIFEN expone un servicio SOAP; aquí se realiza el POST con el envelope correspondiente.
   *
   * Variables de entorno requeridas:
   *   SIFEN_URL  - endpoint del ambiente (test o producción)
   *   SIFEN_CERT - ruta al certificado PFX de firma digital
   *   SIFEN_PASS - contraseña del certificado
   */
  async enviarDE(xmlFirmado: string, cdc: string): Promise<SifenResponse> {
    const url = this.config.get<string>('SIFEN_URL');

    if (!url) {
      this.logger.warn('SIFEN_URL no configurado — modo simulación');
      return this.simularRespuesta(cdc);
    }

    try {
      const soapEnvelope = this.buildSoapEnvelope(xmlFirmado);
      const { data } = await firstValueFrom(
        this.http.post(url, soapEnvelope, {
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'recibe' },
          timeout: 30000,
        }),
      );
      return this.parsearRespuesta(data, cdc);
    } catch (err) {
      this.logger.error(`Error SIFEN: ${err.message}`);
      return { estado: 'ERROR', mensaje: `Error de comunicación con SIFEN: ${err.message}` };
    }
  }

  async consultarEstado(cdc: string): Promise<SifenResponse> {
    const url = this.config.get<string>('SIFEN_URL_CONSULTA');
    if (!url) {
      return { estado: 'APROBADO', mensaje: 'Modo simulación', protocolo: 'SIM-001' };
    }

    try {
      const soapEnvelope = this.buildConsultaEnvelope(cdc);
      const { data } = await firstValueFrom(
        this.http.post(url, soapEnvelope, {
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'consulta' },
          timeout: 30000,
        }),
      );
      return this.parsearRespuesta(data, cdc);
    } catch (err) {
      return { estado: 'ERROR', mensaje: err.message };
    }
  }

  private buildSoapEnvelope(xmlDE: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header/>
  <soap:Body>
    <rEnviDe xmlns="http://ekuatia.set.gov.py/sifen/xsd">
      <dId>1</dId>
      ${xmlDE}
    </rEnviDe>
  </soap:Body>
</soap:Envelope>`;
  }

  private buildConsultaEnvelope(cdc: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <rEnviConsDE xmlns="http://ekuatia.set.gov.py/sifen/xsd">
      <dId>1</dId>
      <dCDC>${cdc}</dCDC>
    </rEnviConsDE>
  </soap:Body>
</soap:Envelope>`;
  }

  private parsearRespuesta(soapResponse: string, cdc: string): SifenResponse {
    // Parseo básico de la respuesta SOAP del SIFEN
    const aprobado = /<dEstRes>.*?Aprobado.*?<\/dEstRes>/i.test(soapResponse);
    const rechazado = /<dEstRes>.*?Rechazado.*?<\/dEstRes>/i.test(soapResponse);
    const protMatch = soapResponse.match(/<dProtAut>(.*?)<\/dProtAut>/);
    const msgMatch = soapResponse.match(/<dMsgRes>(.*?)<\/dMsgRes>/);
    const protocolo = protMatch?.[1];
    const mensaje = msgMatch?.[1] ?? '';
    const codigoQR = this.construirUrlKUDE(cdc, protocolo);

    if (aprobado) return { estado: 'APROBADO', mensaje, protocolo, codigoQR };
    if (rechazado) return { estado: 'RECHAZADO', mensaje };
    return { estado: 'ERROR', mensaje: mensaje || 'Respuesta no reconocida del SIFEN' };
  }

  private construirUrlKUDE(cdc: string, protocolo?: string): string {
    const base = 'https://ekuatia.set.gov.py/consultas/qr';
    return `${base}?nVersion=150&Id=${cdc}${protocolo ? `&dProtAut=${protocolo}` : ''}`;
  }

  private simularRespuesta(cdc: string): SifenResponse {
    const protocolo = `SIM-${Date.now()}`;
    return {
      estado: 'APROBADO',
      mensaje: 'Simulación — configure SIFEN_URL para envío real',
      protocolo,
      codigoQR: this.construirUrlKUDE(cdc, protocolo),
    };
  }
}
