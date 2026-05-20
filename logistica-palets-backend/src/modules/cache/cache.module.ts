import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

/**
 * Global module — no need to import in every feature module.
 * Just inject CacheService anywhere in the DI tree.
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
