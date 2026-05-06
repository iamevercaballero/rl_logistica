import { Factura } from './factura.entity';
export declare const afectacionesIVA: readonly ["IVA10", "IVA5", "EXENTA", "EXONERADA"];
export type AfectacionIVA = typeof afectacionesIVA[number];
declare const afectacionCode: Record<AfectacionIVA, string>;
export { afectacionCode };
export declare class ItemFactura {
    id: string;
    facturaId: string;
    factura: Factura;
    orden: number;
    codigo: string;
    descripcion: string;
    unidadMedida: string;
    cantidad: number;
    precioUnitario: number;
    descuentoPorcentaje: number;
    descuentoMonto: number;
    totalBruto: number;
    totalNeto: number;
    afectacionIVA: AfectacionIVA;
    tasaIVA: number;
    baseGravada: number;
    ivaLiquidado: number;
}
