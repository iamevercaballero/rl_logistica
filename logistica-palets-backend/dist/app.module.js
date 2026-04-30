"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const products_module_1 = require("./modules/products/products.module");
const lots_module_1 = require("./modules/lots/lots.module");
const warehouses_module_1 = require("./modules/warehouses/warehouses.module");
const locations_module_1 = require("./modules/locations/locations.module");
const pallets_module_1 = require("./modules/pallets/pallets.module");
const movements_module_1 = require("./modules/movements/movements.module");
const transports_module_1 = require("./modules/transports/transports.module");
const reports_module_1 = require("./modules/reports/reports.module");
const app_controller_1 = require("./app.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                useFactory: () => ({
                    type: 'postgres',
                    host: process.env.DB_HOST,
                    port: Number(process.env.DB_PORT),
                    username: process.env.DB_USERNAME,
                    password: process.env.DB_PASSWORD,
                    database: process.env.DB_DATABASE,
                    autoLoadEntities: true,
                    synchronize: true
                })
            }),
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            products_module_1.ProductsModule,
            lots_module_1.LotsModule,
            warehouses_module_1.WarehousesModule,
            locations_module_1.LocationsModule,
            pallets_module_1.PalletsModule,
            movements_module_1.MovementsModule,
            transports_module_1.TransportsModule,
            reports_module_1.ReportsModule
        ],
        controllers: [app_controller_1.AppController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map