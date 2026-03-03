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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
let ReportsService = class ReportsService {
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    stock() {
        return this.dataSource.query('SELECT * FROM vw_stock_actual');
    }
    movements() {
        return this.dataSource.query('SELECT * FROM vw_movements_detail');
    }
    trace(palletId) {
        return this.dataSource.query('SELECT * FROM vw_pallet_trace WHERE pallet_id = $1', [palletId]);
    }
    async kpis() {
        const [row] = await this.dataSource.query(`
      SELECT
        (SELECT COUNT(*)::int FROM pallets) AS total_pallets,
        COALESCE((SELECT SUM(quantity)::int FROM pallets), 0) AS total_units,
        (SELECT COUNT(*)::int FROM movements WHERE date::date = CURRENT_DATE) AS movements_today
    `);
        const stockByWarehouse = await this.dataSource.query(`
      SELECT
        w.id,
        w.name,
        COALESCE(SUM(p.quantity), 0)::int AS total_units,
        COUNT(p.*)::int AS total_pallets
      FROM warehouses w
      LEFT JOIN locations l ON l."warehouseId" = w.id
      LEFT JOIN pallets p ON p."currentLocationId" = l.id
      GROUP BY w.id, w.name
      ORDER BY w.name ASC
    `);
        return {
            totalPallets: row.total_pallets,
            totalUnits: row.total_units,
            movementsToday: row.movements_today,
            stockByWarehouse,
        };
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], ReportsService);
//# sourceMappingURL=reports.service.js.map