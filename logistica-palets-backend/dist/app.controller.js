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
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const typeorm_1 = require("typeorm");
let AppController = class AppController {
    constructor(dataSource) {
        this.dataSource = dataSource;
        this.startedAt = Date.now();
    }
    root() {
        return { ok: true, name: 'Logistica Palets API', time: new Date().toISOString() };
    }
    async health() {
        const checks = {};
        let status = 'ok';
        const t0 = Date.now();
        try {
            await this.dataSource.query('SELECT 1');
            checks.database = { status: 'ok', latencyMs: Date.now() - t0 };
        }
        catch (e) {
            checks.database = {
                status: 'down',
                latencyMs: Date.now() - t0,
                note: e instanceof Error ? e.message : 'unknown error',
            };
            status = 'error';
        }
        const result = {
            status,
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - this.startedAt) / 1000),
            checks,
        };
        if (status !== 'ok')
            throw new common_1.ServiceUnavailableException(result);
        return result;
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "root", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "health", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], AppController);
//# sourceMappingURL=app.controller.js.map