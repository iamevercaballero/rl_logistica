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
  HttpCode,
  HttpStatus,
  MethodNotAllowedException,
} from '@nestjs/common';
import { PalletsService } from './pallets.service';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pallets')
export class PalletsController {
  constructor(private readonly service: PalletsService) {}

  // ✅ READ
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query('lotId') lotId?: string, @Query('status') status?: string) {
    return this.service.findAll(lotId, status);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /**
   * Full movement history for a single pallet.
   * Used by the traceability UI panel.
   */
  @Get(':id/history')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  // ✅ WRITE
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  create(@Body() dto: CreatePalletDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  update(@Param('id') id: string, @Body() dto: UpdatePalletDto) {
    return this.service.update(id, dto);
  }

  // ❌ DELETE deshabilitado — los pallets no se eliminan para mantener trazabilidad
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  remove(@Param('id') _id: string) {
    throw new MethodNotAllowedException('La eliminación de pallets está deshabilitada para preservar la trazabilidad');
  }
}
