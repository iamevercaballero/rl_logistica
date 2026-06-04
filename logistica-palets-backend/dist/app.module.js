"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const throttler_1 = require("@nestjs/throttler");
const schedule_1 = require("@nestjs/schedule");
const nestjs_pino_1 = require("nestjs-pino");
const core_1 = require("@nestjs/core");
const cache_module_1 = require("./modules/cache/cache.module");
const events_module_1 = require("./modules/events/events.module");
const alerts_module_1 = require("./modules/alerts/alerts.module");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const products_module_1 = require("./modules/products/products.module");
const lots_module_1 = require("./modules/lots/lots.module");
const warehouses_module_1 = require("./modules/warehouses/warehouses.module");
const locations_module_1 = require("./modules/locations/locations.module");
const pallets_module_1 = require("./modules/pallets/pallets.module");
const movements_module_1 = require("./modules/movements/movements.module");
const adjustments_module_1 = require("./modules/adjustments/adjustments.module");
const uploads_module_1 = require("./modules/uploads/uploads.module");
const transports_module_1 = require("./modules/transports/transports.module");
const reports_module_1 = require("./modules/reports/reports.module");
const billing_module_1 = require("./modules/billing/billing.module");
const seed_module_1 = require("./modules/seed/seed.module");
const mail_module_1 = require("./modules/mail/mail.module");
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
            schedule_1.ScheduleModule.forRoot(),
            nestjs_pino_1.LoggerModule.forRoot({
                pinoHttp: {
                    level: (_a = process.env.LOG_LEVEL) !== null && _a !== void 0 ? _a : 'info',
                    transport: process.env.NODE_ENV !== 'production'
                        ? {
                            target: 'pino-pretty',
                            options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
                        }
                        : undefined,
                    base: { service: 'rl-logistica', env: process.env.NODE_ENV },
                    redact: {
                        paths: ['req.headers.authorization', 'req.headers.cookie'],
                        censor: '[REDACTED]',
                    },
                    customLogLevel: (_req, res, err) => {
                        if (err || res.statusCode >= 500)
                            return 'error';
                        if (res.statusCode >= 400)
                            return 'warn';
                        return 'info';
                    },
                },
            }),
            throttler_1.ThrottlerModule.forRoot({
                throttlers: [
                    {
                        ttl: Number(process.env.THROTTLE_TTL) || 60000,
                        limit: Number(process.env.THROTTLE_LIMIT) || 120,
                    },
                ],
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                useFactory: () => {
                    const isProd = process.env.NODE_ENV === 'production';
                    const synchronize = process.env.DB_SYNCHRONIZE === 'true';
                    const migrationsRun = process.env.DB_MIGRATIONS_RUN === 'true' ||
                        (isProd && process.env.DB_MIGRATIONS_RUN !== 'false');
                    const migrationsGlob = isProd
                        ? 'dist/migrations/*.js'
                        : 'src/migrations/*.ts';
                    return {
                        type: 'postgres',
                        host: process.env.DB_HOST,
                        port: Number(process.env.DB_PORT),
                        username: process.env.DB_USERNAME,
                        password: process.env.DB_PASSWORD,
                        database: process.env.DB_DATABASE,
                        autoLoadEntities: true,
                        synchronize,
                        migrations: [migrationsGlob],
                        migrationsRun,
                        migrationsTableName: 'typeorm_migrations',
                        logging: process.env.DB_LOGGING === 'true'
                            ? ['query', 'error', 'warn']
                            : ['error'],
                    };
                },
            }),
            cache_module_1.CacheModule,
            events_module_1.EventsModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            products_module_1.ProductsModule,
            lots_module_1.LotsModule,
            warehouses_module_1.WarehousesModule,
            locations_module_1.LocationsModule,
            pallets_module_1.PalletsModule,
            movements_module_1.MovementsModule,
            adjustments_module_1.AdjustmentsModule,
            uploads_module_1.UploadsModule,
            transports_module_1.TransportsModule,
            reports_module_1.ReportsModule,
            billing_module_1.BillingModule,
            seed_module_1.SeedModule,
            alerts_module_1.AlertsModule,
            mail_module_1.MailModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map