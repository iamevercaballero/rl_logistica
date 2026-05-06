"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XmlGeneratorService = void 0;
const common_1 = require("@nestjs/common");
const xmlbuilder2_1 = require("xmlbuilder2");
const factura_entity_1 = require("./entities/factura.entity");
const item_factura_entity_1 = require("./entities/item-factura.entity");
let XmlGeneratorService = class XmlGeneratorService {
    generarCDC(factura, codigoSeguridad) {
        const ruc = factura.cliente.ruc.replace(/\D/g, '').padStart(8, '0').slice(0, 8);
        const dv = factura.cliente.dv.slice(0, 1);
        const tipoDE = factura_entity_1.tiposDECode[factura.tipoDE].padStart(2, '0');
        const est = factura.establecimiento.padStart(3, '0');
        const pun = factura.puntoExpedicion.padStart(3, '0');
        const num = String(factura.numeroDocumento).padStart(7, '0');
        const fecha = this.formatFecha(factura.fecha);
        const seg = codigoSeguridad.padStart(9, '0').slice(0, 9);
        const base = `${ruc}${dv}${tipoDE}${est}${pun}${num}${fecha}${seg}`;
        const dv11 = this.modulo11(base).toString().padStart(3, '0');
        return `${base}${dv11}`;
    }
    generarXML(factura, emisor) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const cdc = factura.cdc;
        const version = '150';
        const fecha = this.formatFecha(factura.fecha);
        const hora = this.formatHora(factura.fecha);
        const root = (0, xmlbuilder2_1.create)({ version: '1.0', encoding: 'UTF-8' })
            .ele('rDE', {
            xmlns: 'http://ekuatia.set.gov.py/sifen/xsd',
            'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            'xsi:schemaLocation': 'http://ekuatia.set.gov.py/sifen/xsd siRecepDE_v150.xsd',
        })
            .ele('DE', { Id: cdc })
            .ele('dVerFor').txt(version).up()
            .ele('gDatGralOpe')
            .ele('dFeEmiDE').txt(fecha).up()
            .ele('dHoraEmiDE').txt(hora).up()
            .ele('dSisFact').txt('2').up()
            .ele('dNumTim').txt(factura.timbrado).up()
            .ele('dFeIniT').txt(this.formatFecha(factura.fechaVigenciaTimbrado)).up()
            .ele('dFeFinT').txt(this.formatFecha(factura.fechaVigenciaTimbrado)).up()
            .ele('iTiDE').txt(factura_entity_1.tiposDECode[factura.tipoDE]).up()
            .ele('dEst').txt(factura.establecimiento).up()
            .ele('dPunExp').txt(factura.puntoExpedicion).up()
            .ele('dNumDoc').txt(String(factura.numeroDocumento).padStart(7, '0')).up()
            .ele('gEmis')
            .ele('dRucEm').txt(emisor.ruc).up()
            .ele('dDVEmi').txt(emisor.dv).up()
            .ele('iTipCont').txt('2').up()
            .ele('dNomEmi').txt(emisor.razonSocial).up()
            .ele('dNomFanEmi').txt((_a = emisor.nombreFantasia) !== null && _a !== void 0 ? _a : emisor.razonSocial).up()
            .ele('dDirEmi').txt(emisor.direccion).up()
            .ele('dNumCasEmi').txt((_b = emisor.numeroCasa) !== null && _b !== void 0 ? _b : '0').up()
            .ele('cDepEmi').txt((_c = emisor.codigoDepartamento) !== null && _c !== void 0 ? _c : '11').up()
            .ele('cDisEmi').txt((_d = emisor.codigoDistrito) !== null && _d !== void 0 ? _d : '1').up()
            .ele('cCiuEmi').txt((_e = emisor.codigoCiudad) !== null && _e !== void 0 ? _e : '1').up()
            .ele('dTelEmi').txt((_f = emisor.telefono) !== null && _f !== void 0 ? _f : '').up()
            .ele('dEmailE').txt((_g = emisor.email) !== null && _g !== void 0 ? _g : '').up()
            .ele('dCodActivEconEmi').txt((_h = emisor.actividadEconomica) !== null && _h !== void 0 ? _h : '46900').up()
            .ele('dDesActivEconEmi').txt((_j = emisor.descripcionActividad) !== null && _j !== void 0 ? _j : 'Comercio al por mayor').up()
            .ele('gRespDE')
            .ele('dNomRes').txt(emisor.responsable).up()
            .ele('dCarRes').txt((_k = emisor.cargoResponsable) !== null && _k !== void 0 ? _k : 'Gerente').up()
            .up()
            .up()
            .ele('gDatRec')
            .ele('iTiOpe').txt(this.tipoOperacion(factura)).up()
            .ele('cPaisRec').txt('PRY').up()
            .ele('dDesPaisRec').txt('Paraguay').up()
            .ele('iTiContRec').txt(factura.cliente.tipoContribuyente === 'JURIDICA' ? '1' : '2').up()
            .ele('dRucRec').txt(factura.cliente.ruc).up()
            .ele('dDVRec').txt(factura.cliente.dv).up()
            .ele('dNomRec').txt(factura.cliente.razonSocial).up()
            .ele('dNomFanRec').txt((_l = factura.cliente.nombreFantasia) !== null && _l !== void 0 ? _l : factura.cliente.razonSocial).up()
            .ele('dDirRec').txt((_m = factura.cliente.direccion) !== null && _m !== void 0 ? _m : '').up()
            .ele('dEmailRec').txt((_o = factura.cliente.email) !== null && _o !== void 0 ? _o : '').up()
            .ele('dTelRec').txt((_p = factura.cliente.telefono) !== null && _p !== void 0 ? _p : '').up()
            .up()
            .up()
            .ele('gDtipDE')
            .ele('gCamFE')
            .ele('iIndPres').txt('1').up()
            .ele('dDesIndPres').txt('Operación presencial').up()
            .up()
            .up();
        const deNode = root.root().ele('gCamItem');
        factura.items.forEach((item, idx) => {
            this.agregarItem(deNode, item, idx + 1);
        });
        deNode.up();
        root.root()
            .ele('gTotSub')
            .ele('dSubExe').txt(this.fmt(factura.subtotalExenta)).up()
            .ele('dSubExo').txt('0').up()
            .ele('dSub5').txt(this.fmt(factura.subtotal5)).up()
            .ele('dSub10').txt(this.fmt(factura.subtotal10)).up()
            .ele('dTotOpe').txt(this.fmt(factura.totalGeneral)).up()
            .ele('dTotDesc').txt('0').up()
            .ele('dTotDescGlobal').txt('0').up()
            .ele('dTotAntItem').txt('0').up()
            .ele('dTotAnt').txt('0').up()
            .ele('dPorcDescTotal').txt('0').up()
            .ele('dDescTotal').txt('0').up()
            .ele('dAnticipo').txt('0').up()
            .ele('dRedon').txt('0').up()
            .ele('dTotGralOpe').txt(this.fmt(factura.totalGeneral)).up()
            .ele('dIVA5').txt(this.fmt(factura.subtotal5)).up()
            .ele('dIVA10').txt(this.fmt(factura.subtotal10)).up()
            .ele('dLiqTotIVA5').txt(this.fmt(factura.iva5)).up()
            .ele('dLiqTotIVA10').txt(this.fmt(factura.iva10)).up()
            .up()
            .ele('gCamCond')
            .ele('iCondOpe').txt(factura.condicionPago === 'CONTADO' ? '1' : '2').up()
            .ele('dDCondOpe').txt(factura.condicionPago === 'CONTADO' ? 'Contado' : 'Crédito').up()
            .ele('gPaConEIne')
            .ele('iTiPago').txt('1').up()
            .ele('dDesTiPag').txt('Efectivo').up()
            .ele('dMonTiPag').txt(this.fmt(factura.totalGeneral)).up()
            .ele('cMoneTiPag').txt(factura.moneda).up()
            .up()
            .up();
        return root.end({ prettyPrint: true });
    }
    agregarItem(parent, item, orden) {
        var _a;
        parent.ele('gCamItEspecif')
            .ele('dNumIt').txt(String(orden)).up()
            .ele('dCodInt').txt((_a = item.codigo) !== null && _a !== void 0 ? _a : String(orden)).up()
            .ele('dDesProSer').txt(item.descripcion).up()
            .ele('cUniMed').txt(item.unidadMedida).up()
            .ele('dDesUniMed').txt(item.unidadMedida).up()
            .ele('dCantProSer').txt(String(item.cantidad)).up()
            .ele('gValorItem')
            .ele('dPUniProSer').txt(this.fmt(item.precioUnitario)).up()
            .ele('dTotBruItm').txt(this.fmt(item.totalBruto)).up()
            .ele('dDescItem').txt(this.fmt(item.descuentoMonto)).up()
            .ele('dPorcDesIt').txt(this.fmt(item.descuentoPorcentaje)).up()
            .ele('dDescGloItem').txt('0').up()
            .ele('dAntPreUniIt').txt('0').up()
            .ele('dAntGloPreUniIt').txt('0').up()
            .ele('dTotNeto').txt(this.fmt(item.totalNeto)).up()
            .up()
            .ele('gValorRestaItem')
            .ele('dAfecIVA').txt(item_factura_entity_1.afectacionCode[item.afectacionIVA]).up()
            .ele('dTasaIVA').txt(this.fmt(item.tasaIVA)).up()
            .ele('dBasGravIVA').txt(this.fmt(item.baseGravada)).up()
            .ele('dLiqIVAItem').txt(this.fmt(item.ivaLiquidado)).up()
            .up()
            .up();
    }
    tipoOperacion(factura) {
        return factura.cliente.tipoContribuyente === 'JURIDICA' ? '1' : '2';
    }
    fmt(n) {
        return Number(n).toFixed(2);
    }
    formatFecha(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    formatHora(date) {
        const d = new Date(date);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }
    modulo11(cadena) {
        let suma = 0;
        let factor = 2;
        for (let i = cadena.length - 1; i >= 0; i--) {
            suma += parseInt(cadena[i], 10) * factor;
            factor = factor === 9 ? 2 : factor + 1;
        }
        const resto = suma % 11;
        if (resto === 0)
            return 0;
        if (resto === 1)
            return 1;
        return 11 - resto;
    }
    generarCodigoSeguridad() {
        return Math.floor(Math.random() * 900000000 + 100000000).toString();
    }
};
exports.XmlGeneratorService = XmlGeneratorService;
exports.XmlGeneratorService = XmlGeneratorService = __decorate([
    (0, common_1.Injectable)()
], XmlGeneratorService);
//# sourceMappingURL=xml-generator.service.js.map