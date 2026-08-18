import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { AlertsService } from './alerts.service';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { WarehouseAccessService, type AccessUser } from '../warehouses/warehouse-access.service';

type AuthedRequest = Request & { user: AccessUser };
const OptionalUuid = new ParseUUIDPipe({ optional: true });

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly svc: AlertsService,
    private readonly access: WarehouseAccessService,
  ) {}

  /** Current active alerts (evaluated on demand), acotadas al depósito activo. */
  @Get('active')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR', 'OPERATOR')
  async getActive(@Req() req: AuthedRequest, @Query('warehouseId', OptionalUuid) warehouseId?: string) {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return this.svc.getActiveAlerts(warehouseIds);
  }

  /** List all configured alert rules. */
  @Get('rules')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  listRules() {
    return this.svc.listRules();
  }

  /** Create a new stock-level alert rule. */
  @Post('rules')
  @Roles('ADMIN', 'MANAGER')
  createRule(@Body() dto: CreateAlertRuleDto) {
    return this.svc.createRule(dto);
  }

  /** Update an existing rule (enable/disable, change threshold). */
  @Patch('rules/:id')
  @Roles('ADMIN', 'MANAGER')
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<CreateAlertRuleDto>) {
    return this.svc.updateRule(id, dto);
  }

  /** Delete a rule permanently. */
  @Delete('rules/:id')
  @Roles('ADMIN', 'MANAGER')
  removeRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeRule(id);
  }
}
