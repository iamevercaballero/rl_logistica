import { DataSource } from 'typeorm';
export declare class SeedService {
    private readonly dataSource;
    private readonly logger;
    constructor(dataSource: DataSource);
    seedFromExcel(maxMovimientos?: number, soloProductos?: boolean): Promise<any>;
    resetData(): Promise<any>;
    private resolveExcelPath;
    private leerExcel;
    private ensureWarehouseAndLocation;
    private crearProductos;
    private crearLotes;
    private crearStockInicial;
    private crearEntradas;
    private crearSalidas;
    private upsertStock;
}
