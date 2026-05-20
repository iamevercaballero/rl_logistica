import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

/**
 * Global module — EventsGateway can be injected anywhere in the DI tree
 * without importing EventsModule in each feature module.
 */
@Global()
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
