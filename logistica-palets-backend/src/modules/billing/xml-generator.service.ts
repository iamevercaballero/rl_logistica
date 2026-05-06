import { Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { Factura, tiposDECode } from './entities/factura.entity';
import { ItemFactura, afectacionCode } from './entities/item-factura.entity';

@Injectable()
export class XmlGeneratorService {
  /**
   * Genera el CDC (Código de Control) de 44 caracteres según especificación DNIT/eKuatía.
   * Estructura: RUC(8)+DV(1)+TipoDE(2)+Est(3)+Pun(3)+Num(7)+FechaYYYYMMDD(8)+CodSeg(9)+DigitoControl(3)
   */
  generarCDC(factura: Factura, codigoSeguridad: string): string {
    const ruc = factura.cliente.ruc.replace(/\D/g, '').padStart(8, '0').slice(0, 8);
    const dv = factura.cliente.dv.slice(0, 1);
    const tipoDE = tiposDECode[factura.tipoDE].padStart(2, '0');
    const est = factura.establecimiento.padStart(3, '0');
    const pun = factura.puntoExpedicion.padStart(3, '0');
    const num = String(factura.numeroDocumento).padStart(7, '0');
    const fecha = this.formatFecha(factura.fecha);
    const seg = codigoSeguridad.padStart(9, '0').slice(0, 9);
    const base = `${ruc}${dv}${tipoDE}${est}${pun}${num}${fecha}${seg}`;
    // Dígito verificador Módulo 11 aplicado al base (últimos 3 chars)
    const dv11 = this.modulo11(base).toString().padStart(3, '0');
    return `${base}${dv11}`;
  }

  /**
   * Genera el XML del Documento Electrónico (DE) según esquema eKuatía v150.
   * El XML resultante debe ser firmado digitalmente antes de enviarse al SIFEN.
   */
  generarXML(factura: Factura, emisor: EmisorConfig): string {
    const cdc = factura.cdc;
    const version = '150';
    const fecha = this.formatFecha(factura.fecha);
    const hora = this.formatHora(factura.fecha);

    const root = create({ version: '1.0', encoding: 'UTF-8' })
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
          .ele('dSisFact').txt('2').up()           // 2 = sistema electrónico
          .ele('dNumTim').txt(factura.timbrado).up()
          .ele('dFeIniT').txt(this.formatFecha(factura.fechaVigenciaTimbrado)).up()
          .ele('dFeFinT').txt(this.formatFecha(factura.fechaVigenciaTimbrado)).up()
          .ele('iTiDE').txt(tiposDECode[factura.tipoDE]).up()
          .ele('dEst').txt(factura.establecimiento).up()
          .ele('dPunExp').txt(factura.puntoExpedicion).up()
          .ele('dNumDoc').txt(String(factura.numeroDocumento).padStart(7, '0')).up()
          .ele('gEmis')
            .ele('dRucEm').txt(emisor.ruc).up()
            .ele('dDVEmi').txt(emisor.dv).up()
            .ele('iTipCont').txt('2').up()         // 2 = persona jurídica
            .ele('dNomEmi').txt(emisor.razonSocial).up()
            .ele('dNomFanEmi').txt(emisor.nombreFantasia ?? emisor.razonSocial).up()
            .ele('dDirEmi').txt(emisor.direccion).up()
            .ele('dNumCasEmi').txt(emisor.numeroCasa ?? '0').up()
            .ele('cDepEmi').txt(emisor.codigoDepartamento ?? '11').up()
            .ele('cDisEmi').txt(emisor.codigoDistrito ?? '1').up()
            .ele('cCiuEmi').txt(emisor.codigoCiudad ?? '1').up()
            .ele('dTelEmi').txt(emisor.telefono ?? '').up()
            .ele('dEmailE').txt(emisor.email ?? '').up()
            .ele('dCodActivEconEmi').txt(emisor.actividadEconomica ?? '46900').up()
            .ele('dDesActivEconEmi').txt(emisor.descripcionActividad ?? 'Comercio al por mayor').up()
            .ele('gRespDE')
              .ele('dNomRes').txt(emisor.responsable).up()
              .ele('dCarRes').txt(emisor.cargoResponsable ?? 'Gerente').up()
            .up()   // gRespDE
          .up()     // gEmis
          .ele('gDatRec')
            .ele('iTiOpe').txt(this.tipoOperacion(factura)).up()
            .ele('cPaisRec').txt('PRY').up()
            .ele('dDesPaisRec').txt('Paraguay').up()
            .ele('iTiContRec').txt(factura.cliente.tipoContribuyente === 'JURIDICA' ? '1' : '2').up()
            .ele('dRucRec').txt(factura.cliente.ruc).up()
            .ele('dDVRec').txt(factura.cliente.dv).up()
            .ele('dNomRec').txt(factura.cliente.razonSocial).up()
            .ele('dNomFanRec').txt(factura.cliente.nombreFantasia ?? factura.cliente.razonSocial).up()
            .ele('dDirRec').txt(factura.cliente.direccion ?? '').up()
            .ele('dEmailRec').txt(factura.cliente.email ?? '').up()
            .ele('dTelRec').txt(factura.cliente.telefono ?? '').up()
          .up()     // gDatRec
        .up()       // gDatGralOpe
        .ele('gDtipDE')
          .ele('gCamFE')
            .ele('iIndPres').txt('1').up()         // 1 = presencial
            .ele('dDesIndPres').txt('Operación presencial').up()
          .up()     // gCamFE
        .up();      // gDtipDE

    // Sección items
    const deNode = root.root().ele('gCamItem');
    factura.items.forEach((item, idx) => {
      this.agregarItem(deNode, item, idx + 1);
    });
    deNode.up();

    // Totales
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
      .up()   // gTotSub

      // Condición de pago
      .ele('gCamCond')
        .ele('iCondOpe').txt(factura.condicionPago === 'CONTADO' ? '1' : '2').up()
        .ele('dDCondOpe').txt(factura.condicionPago === 'CONTADO' ? 'Contado' : 'Crédito').up()
        .ele('gPaConEIne')
          .ele('iTiPago').txt('1').up()            // 1 = efectivo
          .ele('dDesTiPag').txt('Efectivo').up()
          .ele('dMonTiPag').txt(this.fmt(factura.totalGeneral)).up()
          .ele('cMoneTiPag').txt(factura.moneda).up()
        .up()   // gPaConEIne
      .up();    // gCamCond

    return root.end({ prettyPrint: true });
  }

  private agregarItem(parent: any, item: ItemFactura, orden: number): void {
    parent.ele('gCamItEspecif')
      .ele('dNumIt').txt(String(orden)).up()
      .ele('dCodInt').txt(item.codigo ?? String(orden)).up()
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
      .up()   // gValorItem
      .ele('gValorRestaItem')
        .ele('dAfecIVA').txt(afectacionCode[item.afectacionIVA]).up()
        .ele('dTasaIVA').txt(this.fmt(item.tasaIVA)).up()
        .ele('dBasGravIVA').txt(this.fmt(item.baseGravada)).up()
        .ele('dLiqIVAItem').txt(this.fmt(item.ivaLiquidado)).up()
      .up()   // gValorRestaItem
    .up();    // gCamItEspecif
  }

  private tipoOperacion(factura: Factura): string {
    // B2B=1, B2C=2, B2G=3
    return factura.cliente.tipoContribuyente === 'JURIDICA' ? '1' : '2';
  }

  private fmt(n: number | string): string {
    return Number(n).toFixed(2);
  }

  private formatFecha(date: Date | string): string {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private formatHora(date: Date | string): string {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  private modulo11(cadena: string): number {
    let suma = 0;
    let factor = 2;
    for (let i = cadena.length - 1; i >= 0; i--) {
      suma += parseInt(cadena[i], 10) * factor;
      factor = factor === 9 ? 2 : factor + 1;
    }
    const resto = suma % 11;
    if (resto === 0) return 0;
    if (resto === 1) return 1;
    return 11 - resto;
  }

  generarCodigoSeguridad(): string {
    return Math.floor(Math.random() * 900000000 + 100000000).toString();
  }
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
