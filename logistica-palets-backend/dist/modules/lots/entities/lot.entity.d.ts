import { Product } from '../../products/entities/product.entity';
export declare class Lot {
    id: string;
    lotCode: string;
    productId: string;
    product: Product;
    fechaVencimiento?: string | null;
    fechaFabricacion?: string | null;
    proveedor?: string | null;
    sapLot?: string | null;
    stockActual: number;
    status: string;
}
