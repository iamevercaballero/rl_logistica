import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { MovementsService } from './movements.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('movements')
export class MovementsController {
  constructor(private readonly service: MovementsService) {}

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  create(@Body() dto: CreateMovementDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create(dto, req.user.userId);
  }

  @Post('entry')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createEntry(@Body() dto: CreateEntryDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create({ ...dto, type: 'ENTRY' }, req.user.userId);
  }

  @Post('exit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createExit(@Body() dto: CreateExitDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create({ ...dto, type: 'EXIT' }, req.user.userId);
  }

  @Post('transfer')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createTransfer(@Body() dto: CreateTransferDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create({ ...dto, type: 'TRANSFER' }, req.user.userId);
  }

  @Post('adjustment-in')
  @Roles('ADMIN', 'MANAGER')
  createAdjustmentIn(@Body() dto: CreateEntryDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create({ ...dto, type: 'ADJUSTMENT_IN' }, req.user.userId);
  }

  @Post('adjustment-out')
  @Roles('ADMIN', 'MANAGER')
  createAdjustmentOut(@Body() dto: CreateExitDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create({ ...dto, type: 'ADJUSTMENT_OUT' }, req.user.userId);
  }

  @Post('reprocess')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createReprocess(@Body() dto: CreateEntryDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create({ ...dto, type: 'REPROCESS' }, req.user.userId);
  }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  findAll(@Query() query: MovementsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
