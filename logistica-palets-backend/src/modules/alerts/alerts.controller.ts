import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { AlertsService } from './alerts.service';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly svc: AlertsService) {}

  /** Current active alerts (evaluated on demand). */
  @Get('active')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR', 'OPERATOR')
  getActive() {
    return this.svc.getActiveAlerts();
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
  updateRule(@Param('id') id: string, @Body() dto: Partial<CreateAlertRuleDto>) {
    return this.svc.updateRule(id, dto);
  }

  /** Delete a rule permanently. */
  @Delete('rules/:id')
  @Roles('ADMIN', 'MANAGER')
  removeRule(@Param('id') id: string) {
    return this.svc.removeRule(id);
  }
}
