import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { Movement } from '../movements/entities/movement.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Product } from '../products/entities/product.entity';
import { Lot } from '../lots/entities/lot.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Location } from '../locations/entities/location.entity';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly dataSource: DataSource) {}

  async seedFromExcel(maxMovimientos = 300, soloProductos = false): Promise<any> {
    // xlsx se carga dinámicamente para no romper el bundle de producción
    let XLSX: any;
    try {
      XLSX = require('xlsx');
    } catch {
      throw new BadRequestException('Librería xlsx no disponible. Instalá: npm install xlsx');
    }

    const excelPath = this.resolveExcelPath();
    if (!fs.existsSync(excelPath)) {
      throw new BadRequestException(`Excel no encontrado: ${excelPath}`);
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

    // 1. Depósito + Ubicación
    const { deposito, ubicacion } = await this.ensureWarehouseAndLocation();
    this.logger.log(`Depósito: ${deposito.name} | Ubicación: ${ubicacion!.code}`);

    // 2. Productos
    const productIdMap = await this.crearProductos(productos, stats);

    if (soloProductos) {
      return { mensaje: 'Solo productos cargados (modo soloProductos)', stats };
    }

    // 3. Lotes
    await this.crearLotes(stockActual, productIdMap, stats);

    // 4. Stock inicial
    await this.crearStockInicial(stockActual, productIdMap, deposito.id, ubicacion!.id, stats);

    // 5. Entradas históricas
    await this.crearEntradas(entradas, productIdMap, deposito.id, ubicacion!.id, stats);

    // 6. Salidas históricas
    await this.crearSalidas(salidas, productIdMap, deposito.id, ubicacion!.id, stats);

    this.logger.log(`Seed completado: ${JSON.stringify(stats)}`);
    return { mensaje: 'Seed completado exitosamente', stats };
  }

  async resetData(): Promise<any> {
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

  // ─── Helpers privados ────────────────────────────────────────────────────────

  private resolveExcelPath(): string {
    const candidates = [
      process.env.SEED_EXCEL,
      path.join(process.cwd(), 'CONTROL DE STOCK RL LOG Actualizado.xlsx'),
      path.join(process.cwd(), '..', 'CONTROL DE STOCK RL LOG Actualizado.xlsx'),
      path.join(__dirname, '..', '..', '..', '..', 'CONTROL DE STOCK RL LOG Actualizado.xlsx'),
    ].filter(Boolean);

    return candidates.find(p => fs.existsSync(p!)) ?? candidates[0]!;
  }

  private leerExcel(XLSX: any, excelPath: string, maxMov: number) {
    const wb = XLSX.readFile(excelPath);
    const dateToISO = (serial: any) => {
      if (!serial || typeof serial !== 'number') return new Date().toISOString().slice(0, 10);
      return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
    };

    const wsE = wb.Sheets['Entrada'];
    const dataE: any[][] = XLSX.utils.sheet_to_json(wsE, { header: 1, defval: '' });
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
    const dataSal: any[][] = XLSX.utils.sheet_to_json(wsSal, { header: 1, defval: '' });
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
    const data2: any[][] = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
    const stockActual = data2
      .filter((r, i) => i >= 2 && r[0] && typeof r[0] === 'number' && r[3])
      .map(r => ({
        codigo: String(r[0]), desc: String(r[1]).trim(),
        lote: String(r[2]).trim(), cantidad: Math.max(1, Math.round(Number(r[3]))),
        paletas: Number(r[4]) || 0,
      }));

    const prodMap = new Map<string, any>();
    [...entradas, ...salidas].forEach(r => {
      if (!prodMap.has(r.codigo)) prodMap.set(r.codigo, { code: r.codigo, description: r.desc, unitOfMeasure: r.um });
    });
    stockActual.forEach(r => {
      if (!prodMap.has(r.codigo)) prodMap.set(r.codigo, { code: r.codigo, description: r.desc, unitOfMeasure: 'UN' });
    });

    return { productos: Array.from(prodMap.values()), entradas, salidas, stockActual };
  }

  private async ensureWarehouseAndLocation() {
    const wr = this.dataSource.getRepository(Warehouse);
    const lr = this.dataSource.getRepository(Location);

    let deposito = await wr.findOne({ where: { name: 'DEPÓSITO RL LOGÍSTICA' } });
    if (!deposito) {
      deposito = await wr.save(wr.create({ name: 'DEPÓSITO RL LOGÍSTICA', address: 'Asunción, Paraguay' }));
    }

    // Location usa code (no name) y warehouse relation (no warehouseId directo)
    let ubicacion = await lr.findOne({ where: { code: 'ALMACEN-GENERAL', warehouse: { id: deposito.id } } });
    if (!ubicacion) {
      ubicacion = await lr.save(lr.create({ code: 'ALMACEN-GENERAL', type: 'PISO', warehouse: deposito, active: true }));
    }

    return { deposito, ubicacion };
  }

  private async crearProductos(productos: any[], stats: any): Promise<Map<string, string>> {
    const repo = this.dataSource.getRepository(Product);
    const map = new Map<string, string>();

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
        } else {
          stats.productosOmitidos++;
        }
        map.set(prod.code, p.id);
      } catch (e) {
        this.logger.warn(`Producto ${prod.code}: ${e.message}`);
      }
    }
    this.logger.log(`Productos: ${stats.productosCreados} creados, ${stats.productosOmitidos} existentes`);
    return map;
  }

  private async crearLotes(stockActual: any[], productIdMap: Map<string, string>, stats: any) {
    const repo = this.dataSource.getRepository(Lot);
    for (const row of stockActual) {
      const productId = productIdMap.get(row.codigo);
      if (!productId) continue;
      try {
        const existe = await repo.findOne({ where: { lotCode: row.lote, product: { id: productId } } });
        if (!existe) {
          await repo.save(repo.create({ lotCode: row.lote, product: { id: productId } }));
          stats.lotesCreados++;
        }
      } catch (e) {
        this.logger.warn(`Lote ${row.lote}: ${e.message}`);
      }
    }
  }

  private async crearStockInicial(
    stockActual: any[], productIdMap: Map<string, string>,
    warehouseId: string, locationId: string, stats: any,
  ) {
    for (const row of stockActual) {
      const productId = productIdMap.get(row.codigo);
      if (!productId || row.cantidad <= 0) continue;

      try {
        const mvRepo = this.dataSource.getRepository(Movement);
        await mvRepo.save(mvRepo.create({
          type: 'ADJUSTMENT_IN', productId,
          quantity: row.cantidad, pallets: row.paletas || null,
          warehouseId, locationId,
          supplier: 'AMBEV', documentNumber: `STOCK-INICIAL-${row.lote}`,
          date: new Date(),
        }));
        await this.upsertStock(productId, warehouseId, locationId, row.cantidad);
        stats.stockCargado++;
      } catch (e) {
        this.logger.warn(`Stock ${row.codigo}: ${e.message}`);
      }
    }
  }

  private async crearEntradas(
    entradas: any[], productIdMap: Map<string, string>,
    warehouseId: string, locationId: string, stats: any,
  ) {
    const mvRepo = this.dataSource.getRepository(Movement);
    for (const e of entradas) {
      const productId = productIdMap.get(e.codigo);
      if (!productId) continue;
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
      } catch (e2) {
        this.logger.warn(`Entrada ${e.codigo}: ${e2.message}`);
      }
    }
    this.logger.log(`Entradas: ${stats.entradasCreadas}`);
  }

  private async crearSalidas(
    salidas: any[], productIdMap: Map<string, string>,
    warehouseId: string, locationId: string, stats: any,
  ) {
    // Track stock en memoria para evitar negativo
    const stockCache = new Map<string, number>();

    for (const s of salidas) {
      const productId = productIdMap.get(s.codigo);
      if (!productId) continue;

      try {
        const mvRepo = this.dataSource.getRepository(Movement);
        // Garantizar stock suficiente
        let stockDisp = stockCache.get(productId);
        if (stockDisp === undefined) {
          const st = await this.dataSource.getRepository(Stock).findOne({ where: { productId, warehouseId, locationId } });
          stockDisp = Number(st?.currentQuantity ?? 0);
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
      } catch (e2) {
        this.logger.warn(`Salida ${s.codigo}: ${e2.message}`);
      }
    }
    this.logger.log(`Salidas: ${stats.salidasCreadas}`);
  }

  private async upsertStock(productId: string, warehouseId: string, locationId: string, delta: number) {
    const repo = this.dataSource.getRepository(Stock);
    const existing = await repo.findOne({ where: { productId, warehouseId, locationId } });
    if (existing) {
      existing.currentQuantity = Math.max(0, Number(existing.currentQuantity) + delta);
      await repo.save(existing);
    } else if (delta > 0) {
      await repo.save(repo.create({ productId, warehouseId, locationId, currentQuantity: delta }));
    }
  }
}
