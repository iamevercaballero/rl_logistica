"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SifenService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SifenService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
let SifenService = SifenService_1 = class SifenService {
    constructor(http, config) {
        this.http = http;
        this.config = config;
        this.logger = new common_1.Logger(SifenService_1.name);
    }
    async enviarDE(xmlFirmado, cdc) {
        const url = this.config.get('SIFEN_URL');
        if (!url) {
            this.logger.warn('SIFEN_URL no configurado — modo simulación');
            return this.simularRespuesta(cdc);
        }
        try {
            const soapEnvelope = this.buildSoapEnvelope(xmlFirmado);
            const { data } = await (0, rxjs_1.firstValueFrom)(this.http.post(url, soapEnvelope, {
                headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'recibe' },
                timeout: 30000,
            }));
            return this.parsearRespuesta(data, cdc);
        }
        catch (err) {
            this.logger.error(`Error SIFEN: ${err.message}`);
            return { estado: 'ERROR', mensaje: `Error de comunicación con SIFEN: ${err.message}` };
        }
    }
    async consultarEstado(cdc) {
        const url = this.config.get('SIFEN_URL_CONSULTA');
        if (!url) {
            return { estado: 'APROBADO', mensaje: 'Modo simulación', protocolo: 'SIM-001' };
        }
        try {
            const soapEnvelope = this.buildConsultaEnvelope(cdc);
            const { data } = await (0, rxjs_1.firstValueFrom)(this.http.post(url, soapEnvelope, {
                headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'consulta' },
                timeout: 30000,
            }));
            return this.parsearRespuesta(data, cdc);
        }
        catch (err) {
            return { estado: 'ERROR', mensaje: err.message };
        }
    }
    buildSoapEnvelope(xmlDE) {
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
    buildConsultaEnvelope(cdc) {
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
    parsearRespuesta(soapResponse, cdc) {
        var _a;
        const aprobado = /<dEstRes>.*?Aprobado.*?<\/dEstRes>/i.test(soapResponse);
        const rechazado = /<dEstRes>.*?Rechazado.*?<\/dEstRes>/i.test(soapResponse);
        const protMatch = soapResponse.match(/<dProtAut>(.*?)<\/dProtAut>/);
        const msgMatch = soapResponse.match(/<dMsgRes>(.*?)<\/dMsgRes>/);
        const protocolo = protMatch === null || protMatch === void 0 ? void 0 : protMatch[1];
        const mensaje = (_a = msgMatch === null || msgMatch === void 0 ? void 0 : msgMatch[1]) !== null && _a !== void 0 ? _a : '';
        const codigoQR = this.construirUrlKUDE(cdc, protocolo);
        if (aprobado)
            return { estado: 'APROBADO', mensaje, protocolo, codigoQR };
        if (rechazado)
            return { estado: 'RECHAZADO', mensaje };
        return { estado: 'ERROR', mensaje: mensaje || 'Respuesta no reconocida del SIFEN' };
    }
    construirUrlKUDE(cdc, protocolo) {
        const base = 'https://ekuatia.set.gov.py/consultas/qr';
        return `${base}?nVersion=150&Id=${cdc}${protocolo ? `&dProtAut=${protocolo}` : ''}`;
    }
    simularRespuesta(cdc) {
        const protocolo = `SIM-${Date.now()}`;
        return {
            estado: 'APROBADO',
            mensaje: 'Simulación — configure SIFEN_URL para envío real',
            protocolo,
            codigoQR: this.construirUrlKUDE(cdc, protocolo),
        };
    }
};
exports.SifenService = SifenService;
exports.SifenService = SifenService = SifenService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], SifenService);
//# sourceMappingURL=sifen.service.js.map