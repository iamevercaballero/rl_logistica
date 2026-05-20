import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from './modules/cache/cache.module';
import { EventsModule } from './modules/events/events.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { LotsModule } from './modules/lots/lots.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { LocationsModule } from './modules/locations/locations.module';
import { PalletsModule } from './modules/pallets/pallets.module';
import { MovementsModule } from './modules/movements/movements.module';
import { TransportsModule } from './modules/transports/transports.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BillingModule } from './modules/billing/billing.module';
import { SeedModule } from './modules/seed/seed.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),

    // Cron jobs (@Cron decorators in services)
    ScheduleModule.forRoot(),

    // Structured logging: JSON en prod, pretty-print en dev
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
              }
            : undefined,
        base: { service: 'rl-logistica', env: process.env.NODE_ENV },
        // Nunca loguear tokens JWT ni cookies en los headers
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[REDACTED]',
        },
        customLogLevel: (_req: unknown, res: { statusCode: number }, err: unknown) => {
          if (err || (res as { statusCode: number }).statusCode >= 500) return 'error';
          if ((res as { statusCode: number }).statusCode >= 400) return 'warn';
          return 'info';
        },
      },
    }),

    ThrottlerModule.forRoot({
      throttlers: [
        {
          // ttl en milisegundos (throttler v6). Default: 120 req/min por IP.
          ttl: Number(process.env.THROTTLE_TTL) || 60_000,
          limit: Number(process.env.THROTTLE_LIMIT) || 120,
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const isProd = process.env.NODE_ENV === 'production';
        const synchronize = process.env.DB_SYNCHRONIZE === 'true';
        // En prod, migrationsRun por default; en dev, sólo si el usuario lo pide.
        const migrationsRun =
          process.env.DB_MIGRATIONS_RUN === 'true' ||
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
          logging:
            process.env.DB_LOGGING === 'true'
              ? ['query', 'error', 'warn']
              : ['error'],
        };
      },
    }),
    CacheModule,
    EventsModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    LotsModule,
    WarehousesModule,
    LocationsModule,
    PalletsModule,
    MovementsModule,
    TransportsModule,
    ReportsModule,
    BillingModule,
    SeedModule,
    AlertsModule,
  ],
  controllers: [AppController],
  providers: [
    // Rate limiting global. Cada endpoint puede sobreescribir con @Throttle.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
