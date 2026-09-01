import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';
import { UsersModule } from '../users/users.module';

/**
 * Global module — EventsGateway can be injected anywhere in the DI tree
 * without importing EventsModule in each feature module.
 *
 * JwtModule se importa para que el gateway pueda verificar el token JWT del
 * handshake. El secreto se pasa explícito en verifyAsync (igual que auth.service).
 *
 * UsersModule, para revalidar el token contra la base con el mismo criterio
 * que el camino HTTP (RL-M-03). `WarehousesModule` no hace falta importarlo:
 * es @Global.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), UsersModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
