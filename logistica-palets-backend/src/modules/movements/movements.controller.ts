import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MovementsService } from './movements.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('movements')
export class MovementsController {
  constructor(private readonly service: MovementsService) {}

  // 📥 ENTRADA
  @Post('entry')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createEntry(@Body() dto: CreateEntryDto) {
    return this.service.createEntry(dto);
  }

  // 📤 SALIDA
  @Post('exit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createExit(@Body() dto: CreateExitDto) {
    return this.service.createExit(dto);
  }

  // 🔄 TRANSFERENCIA
  @Post('transfer')
  @Roles('ADMIN', 'MANAGER')
  createTransfer(@Body() dto: CreateTransferDto) {
    return this.service.createTransfer(dto);
  }

  // 📊 LISTADO
  @Get()
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  findAll(@Query() query: MovementsQueryDto) {
    return this.service.findAll(query);
  }

  // 🔍 DETALLE
  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
