import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { GenerateLocationsDto } from './dto/generate-locations.dto';
import {
  WarehouseAccessService,
  type AccessUser,
  type WarehouseScope,
} from '../warehouses/warehouse-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

type AuthedRequest = Request & { user: AccessUser };
const OptionalUuid = new ParseUUIDPipe({ optional: true });

/**
 * El módulo de Ubicaciones es puramente operativo: mapa, ocupación, pilas e
 * incidencias son siempre del depósito activo. Nunca se mezclan sectores de
 * depósitos distintos en una misma vista.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly service: LocationsService,
    private readonly access: WarehouseAccessService,
  ) {}

  private async scopeOf(req: AuthedRequest, warehouseId?: string): Promise<WarehouseScope> {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return warehouseIds;
  }

  /** Depósito único del alcance, para los servicios que aceptan un solo id. */
  private async singleWarehouse(req: AuthedRequest, warehouseId?: string): Promise<string | undefined> {
    const { warehouseId: resolved } = await this.access.resolveQueryScope(req.user, warehouseId);
    return resolved ?? undefined;
  }

  // ✅ READ: todos
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async findAll(@Req() req: AuthedRequest, @Query('warehouseId', OptionalUuid) warehouseId?: string) {
    return this.service.findAll(await this.singleWarehouse(req, warehouseId));
  }

  /** Disponibilidad por ubicación (ocupación vs capacidad) para el selector guiado. */
  @Get('availability')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async availability(@Req() req: AuthedRequest, @Query('warehouseId', OptionalUuid) warehouseId?: string) {
    return this.service.availability(await this.scopeOf(req, warehouseId));
  }

  /** Slotting: ubicaciones recomendadas para guardar un pallet de un producto. */
  @Get('recommendations')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async recommendations(
    @Req() req: AuthedRequest,
    @Query('productId') productId: string,
    @Query('quantity') quantity?: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.recommend(
      productId,
      quantity ? Number(quantity) : 1,
      await this.scopeOf(req, warehouseId),
    );
  }

  /** Mapa del depósito con ocupación y diagnóstico por celda (localizador). */
  @Get('map')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async map(@Req() req: AuthedRequest, @Query('warehouseId', OptionalUuid) warehouseId?: string) {
    return this.service.map(await this.singleWarehouse(req, warehouseId));
  }

  /** Localizador: dónde está un material / lote / lote proveedor / pallet / ubicación. */
  @Get('stock-search')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async stockSearch(
    @Req() req: AuthedRequest,
    @Query('q') q: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.stockSearch(q, await this.singleWarehouse(req, warehouseId));
  }

  /** Ubicaciones con diferencias, sobrecapacidad, pallets bloqueados o stock sin ubicar. */
  @Get('incidents')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async incidents(@Req() req: AuthedRequest, @Query('warehouseId', OptionalUuid) warehouseId?: string) {
    return this.service.incidents(await this.singleWarehouse(req, warehouseId));
  }

  /** Contenido de una ubicación para el panel lateral del localizador. */
  @Get(':id/content')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async content(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    await this.access.assertEntityAccess(req.user, 'location', id);
    return this.service.content(id);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('locations', 'read')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    await this.access.assertEntityAccess(req.user, 'location', id);
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('locations', 'create')
  async create(@Body() dto: CreateLocationDto, @Req() req: AuthedRequest) {
    await this.access.assertWritableWarehouse(req.user, dto.warehouseId);
    return this.service.create(dto);
  }

  @Post('generate')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('locations', 'create')
  async generate(@Body() dto: GenerateLocationsDto, @Req() req: AuthedRequest) {
    await this.access.assertWritableWarehouse(req.user, dto.warehouseId);
    return this.service.generate(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('locations', 'update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
    @Req() req: AuthedRequest,
  ) {
    await this.access.assertEntityAccess(req.user, 'location', id);
    // Reasignar una ubicación a otro depósito exige acceso también al destino.
    if (dto.warehouseId) await this.access.assertWritableWarehouse(req.user, dto.warehouseId);
    return this.service.update(id, dto);
  }

  /**
   * Elimina un pasillo completo. Va declarada ANTES de `@Delete(':id')`: Nest
   * matchea rutas en orden y `aisle` caería en el parámetro `:id`.
   */
  @Delete('aisle')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('locations', 'remove')
  async removeAisle(
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('aisle') aisle: string,
    @Req() req: AuthedRequest,
  ) {
    await this.access.assertWritableWarehouse(req.user, warehouseId);
    return this.service.removeAisle(warehouseId, aisle);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('locations', 'remove')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    await this.access.assertEntityAccess(req.user, 'location', id);
    return this.service.remove(id);
  }
}
