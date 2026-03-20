import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    TypeOrmModule.forRootAsync({
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
    AuthModule,
    UsersModule,
    ProductsModule,
    LotsModule,
    WarehousesModule,
    LocationsModule,
    PalletsModule,
    MovementsModule,
    TransportsModule,
    ReportsModule
  ],
  controllers: [AppController],
})
export class AppModule {}
