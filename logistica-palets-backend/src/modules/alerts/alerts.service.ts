import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { AlertRule } from './entities/alert-rule.entity';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { EventsGateway } from '../events/events.gateway';

/* ── Active alert types ────────────────────────────────────────────────────── */

export type AlertSeverity = 'warning' | 'critical';

export interface ActiveAlert {
  id: string;
  type:
    | 'STOCK_BELOW_MIN'
    | 'LOT_EXPIRING_CRITICAL'
    | 'LOT_EXPIRING_WARNING'
    | 'PENDING_REGULARIZATION_STALE';
  severity: AlertSeverity;
  message: string;
  data: Record<string, unknown>;
  triggeredAt: string;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    private readonly dataSource: DataSource,
    private readonly events: EventsGateway,
  ) {}

  /* ── CRUD ───────────────────────────────────────────────────────────────── */

  async listRules(): Promise<AlertRule[]> {
    return this.ruleRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createRule(dto: CreateAlertRuleDto): Promise<AlertRule> {
    const rule = this.ruleRepo.create({
      description: dto.description ?? null,
      productId: dto.productId ?? null,
      warehouseId: dto.warehouseId ?? null,
      thresholdMin: dto.thresholdMin,
      enabled: dto.enabled ?? true,
    });
    return this.ruleRepo.save(rule);
  }

  async updateRule(
    id: string,
    dto: Partial<CreateAlertRuleDto>,
  ): Promise<AlertRule> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Regla de alerta no encontrada');
    Object.assign(rule, dto);
    return this.ruleRepo.save(rule);
  }

  async removeRule(id: string): Promise<{ deleted: boolean }> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Regla de alerta no encontrada');
    await this.ruleRepo.remove(rule);
    return { deleted: true };
  }

  /* ── Active alerts (evaluated on-demand) ─────────────────────────────────── */

  async getActiveAlerts(): Promise<ActiveAlert[]> {
    const [stockAlerts, expiringAlerts, staleAlerts] = await Promise.all([
      this.evaluateStockRules(),
      this.evaluateExpiryAlerts(),
      this.evaluateStaleRegularizations(),
    ]);
    return [...stockAlerts, ...expiringAlerts, ...staleAlerts];
  }

  /* ── Private evaluation methods ─────────────────────────────────────────── */

  private async evaluateStockRules(): Promise<ActiveAlert[]> {
    const rules = await this.ruleRepo.find({ where: { enabled: true } });
    if (rules.length === 0) return [];

    const alerts: ActiveAlert[] = [];

    for (const rule of rules) {
      const params: unknown[] = [rule.thresholdMin];
      let productFilter = '';
      let warehouseFilter = '';

      if (rule.productId) {
        params.push(rule.productId);
        productFilter = `AND s."productId" = $${params.length}`;
      }
      if (rule.warehouseId) {
        params.push(rule.warehouseId);
        warehouseFilter = `AND s."warehouseId" = $${params.length}`;
      }

      const rows: Array<{
        productCode: string;
        productDescription: string;
        warehouseName: string | null;
        currentQuantity: number;
      }> = await this.dataSource.query(
        `
        SELECT
          p.code AS "productCode",
          p.description AS "productDescription",
          w.name AS "warehouseName",
          COALESCE(SUM(s."currentQuantity"), 0) AS "currentQuantity"
        FROM stocks s
        JOIN products p ON p.id = s."productId"
        LEFT JOIN warehouses w ON w.id = s."warehouseId"
        WHERE 1=1 ${productFilter} ${warehouseFilter}
        GROUP BY p.code, p.description, w.name
        HAVING COALESCE(SUM(s."currentQuantity"), 0) < $1
        `,
        params,
      );

      for (const row of rows) {
        alerts.push({
          id: `stock-rule-${rule.id}-${row.productCode}`,
          type: 'STOCK_BELOW_MIN',
          severity: row.currentQuantity === 0 ? 'critical' : 'warning',
          message: `${row.productCode} — Stock ${row.currentQuantity} por debajo del mínimo ${rule.thresholdMin}${row.warehouseName ? ` (${row.warehouseName})` : ''}`,
          data: {
            ruleId: rule.id,
            productCode: row.productCode,
            productDescription: row.productDescription,
            warehouseName: row.warehouseName,
            currentQuantity: Number(row.currentQuantity),
            thresholdMin: rule.thresholdMin,
          },
          triggeredAt: new Date().toISOString(),
        });
      }
    }

    return alerts;
  }

  private async evaluateExpiryAlerts(): Promise<ActiveAlert[]> {
    const now = new Date();
    const in15 = new Date(now); in15.setDate(in15.getDate() + 15);
    const in60 = new Date(now); in60.setDate(in60.getDate() + 60);

    const rows: Array<{
      id: string;
      lotCode: string;
      productCode: string;
      fechaVencimiento: string;
      stockActual: number;
    }> = await this.dataSource.query(
      `
      SELECT l.id, l."lotCode", p.code AS "productCode",
             l."fechaVencimiento", l."stockActual"
      FROM lots l
      JOIN products p ON p.id = l."productId"
      WHERE l."fechaVencimiento" IS NOT NULL
        AND l."fechaVencimiento" <= $1
        AND l."fechaVencimiento" >= $2
        AND l."stockActual" > 0
      ORDER BY l."fechaVencimiento" ASC
      LIMIT 50
      `,
      [in60, now],
    );

    return rows.map((r) => {
      const expDate = new Date(r.fechaVencimiento);
      const daysLeft = Math.round((expDate.getTime() - now.getTime()) / 86_400_000);
      const isCritical = expDate <= in15;
      return {
        id: `expiry-${r.id}`,
        type: isCritical ? ('LOT_EXPIRING_CRITICAL' as const) : ('LOT_EXPIRING_WARNING' as const),
        severity: isCritical ? ('critical' as const) : ('warning' as const),
        message: `Lote ${r.lotCode} (${r.productCode}) vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''} — ${r.stockActual} uds en stock`,
        data: {
          lotId: r.id,
          lotCode: r.lotCode,
          productCode: r.productCode,
          fechaVencimiento: r.fechaVencimiento,
          stockActual: Number(r.stockActual),
          daysLeft,
        },
        triggeredAt: new Date().toISOString(),
      };
    });
  }

  private async evaluateStaleRegularizations(): Promise<ActiveAlert[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48);

    const rows: Array<{ id: string; documentNumber: string | null; date: string }> =
      await this.dataSource.query(
        `
        SELECT m.id, m."documentNumber", m.date
        FROM movements m
        WHERE m.status = 'PENDING_REGULARIZATION'
          AND m.date < $1
        ORDER BY m.date ASC
        LIMIT 20
        `,
        [cutoff],
      );

    return rows.map((r) => ({
      id: `stale-reg-${r.id}`,
      type: 'PENDING_REGULARIZATION_STALE' as const,
      severity: 'critical' as const,
      message: `Movimiento pendiente de regularización hace más de 48h — ${r.documentNumber ?? r.id.slice(0, 8)}`,
      data: {
        movementId: r.id,
        documentNumber: r.documentNumber,
        date: r.date,
      },
      triggeredAt: new Date().toISOString(),
    }));
  }

  /* ── Cron job — evaluates every 15 minutes ─────────────────────────────── */

  @Cron(CronExpression.EVERY_10_MINUTES)
  async evaluateAndBroadcast() {
    try {
      const alerts = await this.getActiveAlerts();
      if (alerts.length > 0) {
        this.logger.warn(
          `Cron: ${alerts.length} alerta(s) activa(s) [critical: ${alerts.filter((a) => a.severity === 'critical').length}]`,
        );
        // Emit via WebSocket so connected dashboards refresh their alert panel
        this.events.emitStockUpdated({ warehouseId: null });
      } else {
        this.logger.debug('Cron: sin alertas activas');
      }
    } catch (err) {
      this.logger.error('Error evaluando alertas:', err);
    }
  }
}
