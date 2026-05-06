import { CondicionPago, TipoDE } from '../entities/factura.entity';
import { AfectacionIVA } from '../entities/item-factura.entity';
export declare class CreateItemFacturaDto {
    codigo?: string;
    descripcion: string;
    unidadMedida?: string;
    cantidad: number;
    precioUnitario: number;
    descuentoPorcentaje?: number;
    afectacionIVA: AfectacionIVA;
}
export declare class CreateFacturaDto {
    tipoDE: TipoDE;
    clienteId: string;
    fecha?: string;
    condicionPago: CondicionPago;
    moneda?: string;
    movimientoId?: string;
    observaciones?: string;
    items: CreateItemFacturaDto[];
}
