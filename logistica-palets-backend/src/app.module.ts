import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { FriendlyThrottlerGuard } from './common/friendly-throttler.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from './modules/cache/cache.module';
import { EventsModule } from './modules/events/events.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { ProductsModule } from './modules/products/products.module';
import { LotsModule } from './modules/lots/lots.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { LocationsModule } from './modules/locations/locations.module';
import { PalletsModule } from './modules/pallets/pallets.module';
import { MovementsModule } from './modules/movements/movements.module';
import { AdjustmentsModule } from './modules/adjustments/adjustments.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { TransportsModule } from './modules/transports/transports.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { DestinationsModule } from './modules/destinations/destinations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BillingModule } from './modules/billing/billing.module';
import { SeedModule } from './modules/seed/seed.module';
import { MailModule } from './modules/mail/mail.module';
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
        /**
         * Id de correlación. El default de pino es un contador por proceso, que
         * se reinicia con el contenedor y se repite entre réplicas: dos pedidos
         * distintos terminan con el mismo id y no hay forma de saber cuál es
         * cuál. Un UUID no tiene ese problema.
         *
         * Se respeta el `X-Request-Id` entrante si viene de un proxy —así la
         * traza se puede seguir desde el borde— y se devuelve siempre en la
         * respuesta, para que el operador que ve un error pueda dictarlo y se
         * llegue directo a sus líneas de log.
         */
        genReqId: (req: { headers?: Record<string, unknown> }, res: { setHeader: (k: string, v: string) => void }) => {
          const entrante = req.headers?.['x-request-id'];
          const id =
            typeof entrante === 'string' && /^[\w.-]{8,64}$/.test(entrante) ? entrante : randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
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
          // Si no se van a correr migraciones, no hace falta cargarlas: evita
          // importar los .ts crudos vía ts-node en dev (rompe con Node 22+).
          migrations: migrationsRun ? [migrationsGlob] : [],
          migrationsRun,
          migrationsTableName: 'typeorm_migrations',
          logging:
            process.env.DB_LOGGING === 'true'
              ? ['query', 'error', 'warn']
              : ['error'],
          // Fuerza la zona de la sesión en el connect — ver el comentario en
          // src/data-source.ts. No confiar en el default de sesión del server:
          // el mismo Postgres puede resolver un `TimeZone` distinto según el
          // camino de red por el que llega la conexión (host↔WSL2↔contenedor
          // en dev vs. red interna del compose en prod).
          extra: { options: '-c timezone=Etc/GMT+3' },
        };
      },
    }),
    CacheModule,
    EventsModule,
    AuthModule,
    PermissionsModule,
    UsersModule,
    ProductsModule,
    LotsModule,
    WarehousesModule,
    LocationsModule,
    PalletsModule,
    MovementsModule,
    AdjustmentsModule,
    UploadsModule,
    TransportsModule,
    SuppliersModule,
    DestinationsModule,
    ReportsModule,
    BillingModule,
    SeedModule,
    AlertsModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [
    // Rate limiting global. Cada endpoint puede sobreescribir con @Throttle.
    { provide: APP_GUARD, useClass: FriendlyThrottlerGuard },
  ],
})
export class AppModule {}
