import { SeedService } from './seed.service';
export declare class SeedController {
    private readonly seedService;
    private readonly logger;
    constructor(seedService: SeedService);
    seedFromExcel(body: {
        maxMovimientos?: number;
        soloProductos?: boolean;
    }): Promise<any>;
    reset(): Promise<any>;
}
