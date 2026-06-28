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
  findAll() {
    return this.service.findAll();
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

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // ✅ WRITE: admin/manager
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

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
