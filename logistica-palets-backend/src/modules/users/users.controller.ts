import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserWarehousesDto } from './dto/set-user-warehouses.dto';
import { WarehouseAccessService } from '../warehouses/warehouse-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly warehouseAccess: WarehouseAccessService,
  ) {}

  /** Depósitos asignados a un usuario (vacío = alcance global por rol). */
  @Get(':id/warehouses')
  @Roles('ADMIN')
  listWarehouses(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseAccess.listAssignments(id);
  }

  /**
   * Reemplaza las asignaciones de depósito del usuario. Es la puerta prevista
   * para la administración futura desde el módulo de usuarios: la arquitectura
   * ya soporta 1..N depósitos por usuario sin cambios de esquema.
   */
  @Put(':id/warehouses')
  @Roles('ADMIN')
  setWarehouses(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserWarehousesDto) {
    return this.warehouseAccess.setAssignments(id, dto.warehouseIds);
  }

  @Get()
  @Roles('ADMIN')
  findAll() {
    return this.service.findAll();
  }

  /** Lista simplificada para dropdowns — accesible a todos los roles */
  @Get('active')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findActive() {
    return this.service.findActive();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateUserDto) {
    return this.service.createWithPassword(dto.username, dto.password, (dto.role as any) ?? 'OPERATOR', dto.fullName);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
