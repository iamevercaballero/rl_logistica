import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserWarehousesDto } from './dto/set-user-warehouses.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { UserRole } from './entities/user.entity';
import { WarehouseAccessService } from '../warehouses/warehouse-access.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SetUserPermissionsDto } from '../permissions/dto/set-user-permission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

type AuthedRequest = Request & { user: { userId: string; role: UserRole } };

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly warehouseAccess: WarehouseAccessService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── Depósitos (arquitectura existente, reutilizada tal cual) ──────────────

  /** Depósitos asignados a un usuario (vacío = alcance global por rol). */
  @Get(':id/warehouses')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'read')
  listWarehouses(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseAccess.listAssignments(id);
  }

  /**
   * Reemplaza las asignaciones de depósito del usuario. Antes era ADMIN-only;
   * ahora MANAGER puede asignar depósitos al personal que administra (nunca a
   * un ADMIN o a otro MANAGER).
   */
  @Put(':id/warehouses')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'update')
  async setWarehouses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserWarehousesDto,
    @Req() req: AuthedRequest,
  ) {
    const target = await this.service.findOne(id);
    this.service.assertManagerCeiling(req.user, target.role as UserRole);

    const before = await this.warehouseAccess.listAssignments(id);
    const after = await this.warehouseAccess.setAssignments(id, dto.warehouseIds);

    const added = after.filter((w) => !before.includes(w));
    const removed = before.filter((w) => !after.includes(w));
    for (const w of added) await this.service.writeAudit(req.user.userId, id, 'WAREHOUSE_ASSIGNED', 'warehouseId', null, w);
    for (const w of removed) await this.service.writeAudit(req.user.userId, id, 'WAREHOUSE_REMOVED', 'warehouseId', w, null);

    return after;
  }

  // ── Permisos ───────────────────────────────────────────────────────────────

  /** Plantilla del rol, overrides propios y permisos efectivos — para la pestaña Permisos. */
  @Get(':id/permissions')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'read')
  async getPermissions(@Param('id', ParseUUIDPipe) id: string) {
    const target = await this.service.findOne(id);
    const role = target.role as UserRole;
    const [roleDefaults, overrides, effective] = await Promise.all([
      this.permissions.getRolePermissions(role),
      this.permissions.getUserOverrides(id),
      this.permissions.getEffectivePermissions(id, role),
    ]);
    return { role, roleDefaults, overrides, effective };
  }

  /**
   * Reemplazo completo de los overrides del usuario. Cada uno se valida contra
   * el techo del actor (`PermissionsService.assertCanManagePermission`) antes
   * de aplicar nada — si uno solo no pasa, no se guarda ninguno.
   */
  @Put(':id/permissions')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'update')
  async setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserPermissionsDto,
    @Req() req: AuthedRequest,
  ) {
    const target = await this.service.findOne(id);
    const targetRole = target.role as UserRole;

    for (const o of dto.overrides) {
      await this.permissions.assertCanManagePermission(req.user, targetRole, o.module, o.action);
    }

    const before = await this.permissions.getUserOverrides(id);
    await this.permissions.restoreRoleDefaults(id);
    for (const o of dto.overrides) {
      await this.permissions.setUserPermission(id, o.module, o.action, o.effect);
    }

    const beforeKeys = new Set(before.map((b) => `${b.module}:${b.action}:${b.effect}`));
    const afterKeys = new Set(dto.overrides.map((o) => `${o.module}:${o.action}:${o.effect}`));
    for (const o of dto.overrides) {
      const key = `${o.module}:${o.action}:${o.effect}`;
      if (!beforeKeys.has(key)) {
        await this.service.writeAudit(
          req.user.userId, id,
          o.effect === 'ALLOW' ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
          `${o.module}:${o.action}`, null, o.effect,
        );
      }
    }
    for (const b of before) {
      if (!afterKeys.has(`${b.module}:${b.action}:${b.effect}`)) {
        await this.service.writeAudit(req.user.userId, id, 'PERMISSION_REVOKED', `${b.module}:${b.action}`, b.effect, null);
      }
    }

    return this.permissions.getEffectivePermissions(id, targetRole);
  }

  /** "Restaurar permisos del rol": borra todos los overrides del usuario. */
  @Post(':id/permissions/restore')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'update')
  async restorePermissions(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    const target = await this.service.findOne(id);
    const targetRole = target.role as UserRole;
    this.service.assertManagerCeiling(req.user, targetRole);

    await this.permissions.restoreRoleDefaults(id);
    await this.service.writeAudit(req.user.userId, id, 'PERMISSIONS_RESTORED');
    return this.permissions.getEffectivePermissions(id, targetRole);
  }

  // ── Historial ────────────────────────────────────────────────────────────

  @Get(':id/audit-log')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'read')
  auditLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findAuditLog(id);
  }

  // ── CRUD de usuarios ─────────────────────────────────────────────────────

  /** Incluye `warehouseIds` de cada usuario — para el buscador/filtro por depósito de la lista. */
  @Get()
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'read')
  async findAll() {
    const users = await this.service.findAll();
    const assignments = await this.warehouseAccess.listAssignmentsForUsers(users.map((u) => u.id));
    return users.map((u) => ({ ...u, warehouseIds: assignments.get(u.id) ?? [] }));
  }

  /** Lista simplificada para dropdowns — accesible a todos los roles */
  @Get('active')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findActive() {
    return this.service.findActive();
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'create')
  create(@Body() dto: CreateUserDto, @Req() req: AuthedRequest) {
    return this.service.createWithPassword(
      req.user, dto.username, dto.password,
      (dto.role as UserRole) ?? 'OPERATOR', dto.fullName, dto.mustChangePassword,
    );
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Req() req: AuthedRequest) {
    return this.service.update(req.user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'remove')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.remove(req.user, id);
  }

  // ── Seguridad ────────────────────────────────────────────────────────────

  @Post(':id/reset-password')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'update')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto, @Req() req: AuthedRequest) {
    return this.service.resetPassword(req.user, id, dto.newPassword, dto.mustChangePassword ?? true);
  }

  @Post(':id/close-sessions')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('users', 'update')
  closeSessions(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.closeSessions(req.user, id);
  }
}
