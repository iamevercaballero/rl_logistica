import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermission } from './entities/role-permission.entity';
import { UserPermission } from './entities/user-permission.entity';
import { PermissionsService } from './permissions.service';
import { PermissionGuard } from './guards/permission.guard';

/**
 * Global por el mismo motivo que `WarehousesModule`: `PermissionGuard` se usa
 * en el `@UseGuards(...)` de casi todos los controllers operativos, y
 * exponerlo global evita importar este módulo en cadena en cada uno.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RolePermission, UserPermission])],
  providers: [PermissionsService, PermissionGuard],
  exports: [PermissionsService, PermissionGuard],
})
export class PermissionsModule {}
