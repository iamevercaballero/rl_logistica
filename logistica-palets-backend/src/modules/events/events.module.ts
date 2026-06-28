import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';

/**
 * Global module — EventsGateway can be injected anywhere in the DI tree
 * without importing EventsModule in each feature module.
 *
 * JwtModule se importa para que el gateway pueda verificar el token JWT del
 * handshake. El secreto se pasa explícito en verifyAsync (igual que auth.service).
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
