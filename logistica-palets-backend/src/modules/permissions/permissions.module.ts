import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermission } from './entities/role-permission.entity';
import { UserPermission } from './entities/user-permission.entity';
import { PermissionsService } from './permissions.service';
import { PermissionGuard } from './guards/permission.guard';
import { RoleCeilingService } from './role-ceiling.service';

/**
 * Global por el mismo motivo que `WarehousesModule`: `PermissionGuard` se usa
 * en el `@UseGuards(...)` de casi todos los controllers operativos, y
 * exponerlo global evita importar este módulo en cadena en cada uno.
 */
@Global()
@Module({
  // `DiscoveryModule` es lo que le permite a `RoleCeilingService` recorrer los
  // controllers y leer sus `@Roles()`/`@RequirePermission()` en el arranque.
  imports: [DiscoveryModule, TypeOrmModule.forFeature([RolePermission, UserPermission])],
  providers: [PermissionsService, PermissionGuard, RoleCeilingService],
  exports: [PermissionsService, PermissionGuard, RoleCeilingService],
})
export class PermissionsModule {}
