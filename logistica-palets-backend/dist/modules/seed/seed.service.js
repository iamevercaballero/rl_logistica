"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SeedService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const movement_entity_1 = require("../movements/entities/movement.entity");
const stock_entity_1 = require("../stocks/entities/stock.entity");
const product_entity_1 = require("../products/entities/product.entity");
const lot_entity_1 = require("../lots/entities/lot.entity");
const warehouse_entity_1 = require("../warehouses/entities/warehouse.entity");
const location_entity_1 = require("../locations/entities/location.entity");
let SeedService = SeedService_1 = class SeedService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(SeedService_1.name);
    }
    async seedFromExcel(maxMovimientos = 300, soloProductos = false) {
        let XLSX;
        try {
            XLSX = require('xlsx');
        }
        catch {
            throw new common_1.BadRequestException('Librería xlsx no disponible. Instalá: npm install xlsx');
        }
        const excelPath = this.resolveExcelPath();
        if (!fs.existsSync(excelPath)) {
            throw new common_1.BadRequestException(`Excel no encontrado: ${excelPath}`);
        }
        this.logger.log(`Leyendo Excel: ${excelPath}`);
        const { productos, entradas, salidas, stockActual } = this.leerExcel(XLSX, excelPath, maxMovimientos);
        const stats = {
            productosCreados: 0,
            productosOmitidos: 0,
            lotesCreados: 0,
            stockCargado: 0,
            entradasCreadas: 0,
            salidasCreadas: 0,
        };
        const { deposito, ubicacion } = await this.ensureWarehouseAndLocation();
        this.logger.log(`Depósito: ${deposito.name} | Ubicación: ${ubicacion.code}`);
        const productIdMap = await this.crearProductos(productos, stats);
        if (soloProductos) {
            return { mensaje: 'Solo productos cargados (modo soloProductos)', stats };
        }
        await this.crearLotes(stockActual, productIdMap, stats);
        await this.crearStockInicial(stockActual, productIdMap, deposito.id, ubicacion.id, stats);
        await this.crearEntradas(entradas, productIdMap, deposito.id, ubicacion.id, stats);
        await this.crearSalidas(salidas, productIdMap, deposito.id, ubicacion.id, stats);
        this.logger.log(`Seed completado: ${JSON.stringify(stats)}`);
        return { mensaje: 'Seed completado exitosamente', stats };
    }
    async resetData() {
        this.logger.warn('Eliminando datos de movimientos, stock, lotes, productos...');
        await this.dataSource.query(`DELETE FROM "movement_details" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "movements" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "stocks" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "pallets" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "lots" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "locations" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "warehouses" WHERE true`).catch(() => null);
        await this.dataSource.query(`DELETE FROM "products" WHERE true`).catch(() => null);
        return { mensaje: 'Datos eliminados' };
    }
    resolveExcelPath() {
        var _a;
        const candidates = [
            process.env.SEED_EXCEL,
            path.join(process.cwd(), 'CONTROL DE STOCK RL LOG Actualizado.xlsx'),
            path.join(process.cwd(), '..', 'CONTROL DE STOCK RL LOG Actualizado.xlsx'),
            path.join(__dirname, '..', '..', '..', '..', 'CONTROL DE STOCK RL LOG Actualizado.xlsx'),
        ].filter(Boolean);
        return (_a = candidates.find(p => fs.existsSync(p))) !== null && _a !== void 0 ? _a : candidates[0];
    }
    leerExcel(XLSX, excelPath, maxMov) {
        const wb = XLSX.readFile(excelPath);
        const dateToISO = (serial) => {
            if (!serial || typeof serial !== 'number')
                return new Date().toISOString().slice(0, 10);
            return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
        };
        const wsE = wb.Sheets['Entrada'];
        const dataE = XLSX.utils.sheet_to_json(wsE, { header: 1, defval: '' });
        const entradas = dataE
            .filter((r, i) => i >= 6 && r[3] && typeof r[3] === 'number' && r[4] && r[6])
            .map(r => ({
            fecha: dateToISO(r[2]), codigo: String(r[3]),
            desc: String(r[4]).trim(), paletas: Number(r[5]) || 0,
            cantidad: Math.max(1, Math.round(Number(r[6]))), um: String(r[7] || 'UN').trim(),
            remito: r[9] ? String(r[9]) : '', proveedor: String(r[11] || '').trim(),
            transport: String(r[12] || '').trim(), conductor: String(r[13] || '').trim(),
        }))
            .filter(r => r.cantidad > 0)
            .sort((a, b) => b.fecha.localeCompare(a.fecha))
            .slice(0, maxMov);
        const wsSal = wb.Sheets['Salida'];
        const dataSal = XLSX.utils.sheet_to_json(wsSal, { header: 1, defval: '' });
        const salidas = dataSal
            .filter((r, i) => i >= 6 && r[2] && typeof r[2] === 'number' && r[3] && r[6])
            .map(r => ({
            fecha: dateToISO(r[1]), codigo: String(r[2]),
            desc: String(r[3]).trim(), paletas: Number(r[5]) || 0,
            cantidad: Math.max(1, Math.round(Number(r[6]))), um: String(r[7] || 'UN').trim(),
            remito: r[10] ? String(r[10]) : '', transport: String(r[11] || '').trim(),
            destino: String(r[12] || '').trim(), conductor: String(r[13] || '').trim(),
        }))
            .filter(r => r.cantidad > 0)
            .sort((a, b) => b.fecha.localeCompare(a.fecha))
            .slice(0, maxMov);
        const ws2 = wb.Sheets['Hoja2'];
        const data2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
        const stockActual = data2
            .filter((r, i) => i >= 2 && r[0] && typeof r[0] === 'number' && r[3])
            .map(r => ({
            codigo: String(r[0]), desc: String(r[1]).trim(),
            lote: String(r[2]).trim(), cantidad: Math.max(1, Math.round(Number(r[3]))),
            paletas: Number(r[4]) || 0,
        }));
        const prodMap = new Map();
        [...entradas, ...salidas].forEach(r => {
            if (!prodMap.has(r.codigo))
                prodMap.set(r.codigo, { code: r.codigo, description: r.desc, unitOfMeasure: r.um });
        });
        stockActual.forEach(r => {
            if (!prodMap.has(r.codigo))
                prodMap.set(r.codigo, { code: r.codigo, description: r.desc, unitOfMeasure: 'UN' });
        });
        return { productos: Array.from(prodMap.values()), entradas, salidas, stockActual };
    }
    async ensureWarehouseAndLocation() {
        const wr = this.dataSource.getRepository(warehouse_entity_1.Warehouse);
        const lr = this.dataSource.getRepository(location_entity_1.Location);
        let deposito = await wr.findOne({ where: { name: 'DEPÓSITO RL LOGÍSTICA' } });
        if (!deposito) {
            deposito = await wr.save(wr.create({ name: 'DEPÓSITO RL LOGÍSTICA', address: 'Asunción, Paraguay' }));
        }
        let ubicacion = await lr.findOne({ where: { code: 'ALMACEN-GENERAL', warehouse: { id: deposito.id } } });
        if (!ubicacion) {
            ubicacion = await lr.save(lr.create({ code: 'ALMACEN-GENERAL', type: 'PISO', warehouse: deposito, active: true }));
        }
        return { deposito, ubicacion };
    }
    async crearProductos(productos, stats) {
        const repo = this.dataSource.getRepository(product_entity_1.Product);
        const map = new Map();
        for (const prod of productos) {
            try {
                let p = await repo.findOne({ where: { code: prod.code } });
                if (!p) {
                    p = await repo.save(repo.create({
                        code: prod.code,
                        description: prod.description.slice(0, 160),
                        unitOfMeasure: prod.unitOfMeasure.slice(0, 20),
                        active: true,
                    }));
                    stats.productosCreados++;
                }
                else {
                    stats.productosOmitidos++;
                }
                map.set(prod.code, p.id);
            }
            catch (e) {
                this.logger.warn(`Producto ${prod.code}: ${e.message}`);
            }
        }
        this.logger.log(`Productos: ${stats.productosCreados} creados, ${stats.productosOmitidos} existentes`);
        return map;
    }
    async crearLotes(stockActual, productIdMap, stats) {
        const repo = this.dataSource.getRepository(lot_entity_1.Lot);
        for (const row of stockActual) {
            const productId = productIdMap.get(row.codigo);
            if (!productId)
                continue;
            try {
                const existe = await repo.findOne({ where: { lotCode: row.lote, product: { id: productId } } });
                if (!existe) {
                    await repo.save(repo.create({ lotCode: row.lote, product: { id: productId } }));
                    stats.lotesCreados++;
                }
            }
            catch (e) {
                this.logger.warn(`Lote ${row.lote}: ${e.message}`);
            }
        }
    }
    async crearStockInicial(stockActual, productIdMap, warehouseId, locationId, stats) {
        for (const row of stockActual) {
            const productId = productIdMap.get(row.codigo);
            if (!productId || row.cantidad <= 0)
                continue;
            try {
                const mvRepo = this.dataSource.getRepository(movement_entity_1.Movement);
                await mvRepo.save(mvRepo.create({
                    type: 'ADJUSTMENT_IN', productId,
                    quantity: row.cantidad, pallets: row.paletas || null,
                    warehouseId, locationId,
                    supplier: 'AMBEV', documentNumber: `STOCK-INICIAL-${row.lote}`,
                    date: new Date(),
                }));
                await this.upsertStock(productId, warehouseId, locationId, row.cantidad);
                stats.stockCargado++;
            }
            catch (e) {
                this.logger.warn(`Stock ${row.codigo}: ${e.message}`);
            }
        }
    }
    async crearEntradas(entradas, productIdMap, warehouseId, locationId, stats) {
        const mvRepo = this.dataSource.getRepository(movement_entity_1.Movement);
        for (const e of entradas) {
            const productId = productIdMap.get(e.codigo);
            if (!productId)
                continue;
            try {
                await mvRepo.save(mvRepo.create({
                    type: 'ENTRY', productId, date: new Date(e.fecha),
                    quantity: e.cantidad, pallets: e.paletas || null,
                    warehouseId, locationId,
                    supplier: e.proveedor || 'AMBEV',
                    carrier: e.transport || null, driver: e.conductor || null,
                    documentNumber: e.remito || null,
                }));
                await this.upsertStock(productId, warehouseId, locationId, e.cantidad);
                stats.entradasCreadas++;
            }
            catch (e2) {
                this.logger.warn(`Entrada ${e.codigo}: ${e2.message}`);
            }
        }
        this.logger.log(`Entradas: ${stats.entradasCreadas}`);
    }
    async crearSalidas(salidas, productIdMap, warehouseId, locationId, stats) {
        var _a;
        const stockCache = new Map();
        for (const s of salidas) {
            const productId = productIdMap.get(s.codigo);
            if (!productId)
                continue;
            try {
                const mvRepo = this.dataSource.getRepository(movement_entity_1.Movement);
                let stockDisp = stockCache.get(productId);
                if (stockDisp === undefined) {
                    const st = await this.dataSource.getRepository(stock_entity_1.Stock).findOne({ where: { productId, warehouseId, locationId } });
                    stockDisp = Number((_a = st === null || st === void 0 ? void 0 : st.currentQuantity) !== null && _a !== void 0 ? _a : 0);
                }
                if (stockDisp < s.cantidad) {
                    const ajuste = s.cantidad * 3;
                    await mvRepo.save(mvRepo.create({
                        type: 'ADJUSTMENT_IN', productId,
                        quantity: ajuste, warehouseId, locationId,
                        documentNumber: 'AJUSTE-HISTORICO', date: new Date(s.fecha),
                    }));
                    await this.upsertStock(productId, warehouseId, locationId, ajuste);
                    stockDisp += ajuste;
                }
                await mvRepo.save(mvRepo.create({
                    type: 'EXIT', productId, date: new Date(s.fecha),
                    quantity: s.cantidad, pallets: s.paletas || null,
                    warehouseId, locationId,
                    carrier: s.transport || null, driver: s.conductor || null,
                    destination: s.destino || null, documentNumber: s.remito || null,
                }));
                await this.upsertStock(productId, warehouseId, locationId, -s.cantidad);
                stockCache.set(productId, stockDisp - s.cantidad);
                stats.salidasCreadas++;
            }
            catch (e2) {
                this.logger.warn(`Salida ${s.codigo}: ${e2.message}`);
            }
        }
        this.logger.log(`Salidas: ${stats.salidasCreadas}`);
    }
    async upsertStock(productId, warehouseId, locationId, delta) {
        const repo = this.dataSource.getRepository(stock_entity_1.Stock);
        const existing = await repo.findOne({ where: { productId, warehouseId, locationId } });
        if (existing) {
            existing.currentQuantity = Math.max(0, Number(existing.currentQuantity) + delta);
            await repo.save(existing);
        }
        else if (delta > 0) {
            await repo.save(repo.create({ productId, warehouseId, locationId, currentQuantity: delta }));
        }
    }
};
exports.SeedService = SeedService;
exports.SeedService = SeedService = SeedService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], SeedService);
//# sourceMappingURL=seed.service.js.map