import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { GenerateLocationsDto } from './dto/generate-locations.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locations')
export class LocationsController {
  constructor(private readonly service: LocationsService) {}

  // ✅ READ: todos
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query('warehouseId') warehouseId?: string) {
    return this.service.findAll(warehouseId);
  }

  /** Disponibilidad por ubicación (ocupación vs capacidad) para el selector guiado. */
  @Get('availability')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  availability() {
    return this.service.availability();
  }

  /** Slotting: ubicaciones recomendadas para guardar un pallet de un producto. */
  @Get('recommendations')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  recommendations(
    @Query('productId') productId: string,
    @Query('quantity') quantity?: string,
  ) {
    return this.service.recommend(productId, quantity ? Number(quantity) : 1);
  }

  /** Mapa del depósito con ocupación y diagnóstico por celda (localizador). */
  @Get('map')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  map(@Query('warehouseId') warehouseId?: string) {
    return this.service.map(warehouseId);
  }

  /** Localizador: dónde está un material / lote / lote proveedor / pallet / ubicación. */
  @Get('stock-search')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  stockSearch(@Query('q') q: string, @Query('warehouseId') warehouseId?: string) {
    return this.service.stockSearch(q, warehouseId);
  }

  /** Ubicaciones con diferencias, sobrecapacidad, pallets bloqueados o stock sin ubicar. */
  @Get('incidents')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  incidents(@Query('warehouseId') warehouseId?: string) {
    return this.service.incidents(warehouseId);
  }

  /** Contenido de una ubicación para el panel lateral del localizador. */
  @Get(':id/content')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  content(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.content(id);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** Crear estructura del depósito es de supervisión, igual que generar y eliminar. */
  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(@Body() dto: CreateLocationDto) {
    return this.service.create(dto);
  }

  /** Genera la estructura de una zona en lote (pasillos × racks × niveles × posiciones). */
  @Post('generate')
  @Roles('ADMIN', 'MANAGER')
  generate(@Body() dto: GenerateLocationsDto) {
    return this.service.generate(dto);
  }

  /** Modificar o desactivar una ubicación: ídem, no es una acción de piso. */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    return this.service.update(id, dto);
  }

  /** Eliminar estructura del depósito es una operación de supervisión, no de piso. */
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
