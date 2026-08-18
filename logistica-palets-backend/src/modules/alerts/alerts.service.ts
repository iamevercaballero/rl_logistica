import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { AlertRule } from './entities/alert-rule.entity';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { EventsGateway } from '../events/events.gateway';
import { businessDaysUntil, businessToday, shiftBusinessDate } from '../../common/date';
import type { WarehouseScope } from '../warehouses/warehouse-access.service';

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

  async getActiveAlerts(scope: WarehouseScope = null): Promise<ActiveAlert[]> {
    const [stockAlerts, expiringAlerts, staleAlerts] = await Promise.all([
      this.evaluateStockRules(scope),
      this.evaluateExpiryAlerts(scope),
      this.evaluateStaleRegularizations(scope),
    ]);
    return [...stockAlerts, ...expiringAlerts, ...staleAlerts];
  }

  /* ── Private evaluation methods ─────────────────────────────────────────── */

  private async evaluateStockRules(scope: WarehouseScope = null): Promise<ActiveAlert[]> {
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
      // Una regla global se evalua solo dentro del alcance del usuario.
      if (scope) {
        params.push(scope);
        warehouseFilter += ` AND s."warehouseId" = ANY($${params.length}::uuid[])`;
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

  private async evaluateExpiryAlerts(scope: WarehouseScope = null): Promise<ActiveAlert[]> {
    // fechaVencimiento es fecha calendario: los umbrales y la comparación se
    // hacen en "YYYY-MM-DD", nunca con un Date real — comparar contra un
    // instante desalinea el resultado según la zona del proceso/servidor.
    const today = businessToday();
    const in15 = shiftBusinessDate(today, 15);
    const in60 = shiftBusinessDate(today, 60);

    const rows: Array<{
      id: string;
      lotCode: string;
      productCode: string;
      fechaVencimiento: string;
      stockActual: number;
    }> = await this.dataSource.query(
      `
      SELECT l.id, l."lotCode", p.code AS "productCode",
             l."fechaVencimiento",
             SUM(pa.quantity) AS "stockActual"
      FROM lots l
      JOIN products p ON p.id = l."productId"
      JOIN pallets pa ON pa."lotId" = l.id AND pa.status NOT IN ('EXITED', 'EMPTY')
      JOIN locations ploc ON ploc.id = pa."currentLocationId"
      WHERE l."fechaVencimiento" IS NOT NULL
        AND l."fechaVencimiento" <= $1
        AND l."fechaVencimiento" >= $2
        ${scope ? 'AND ploc."warehouseId" = ANY($3::uuid[])' : ''}
      GROUP BY l.id, l."lotCode", p.code, l."fechaVencimiento"
      HAVING SUM(pa.quantity) > 0
      ORDER BY l."fechaVencimiento" ASC
      LIMIT 50
      `,
      scope ? [in60, today, scope] : [in60, today],
    );

    return rows.map((r) => {
      const daysLeft = businessDaysUntil(r.fechaVencimiento, today)!;
      const isCritical = r.fechaVencimiento <= in15;
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

  private async evaluateStaleRegularizations(scope: WarehouseScope = null): Promise<ActiveAlert[]> {
    // 48hs de margen real transcurrido — resta directa sobre el instante en
    // vez de getHours()/setHours() (que pasan por los campos locales del
    // proceso) para que sea correcto sin depender de razonar sobre DST.
    const cutoff = new Date(Date.now() - 48 * 3_600_000);

    const rows: Array<{ id: string; documentNumber: string | null; date: string }> =
      await this.dataSource.query(
        `
        SELECT m.id, m."documentNumber", m.date
        FROM movements m
        WHERE m.status = 'PENDING_REGULARIZATION'
          AND m."voidStatus" = 'NONE'
          AND m.date < $1
          ${scope ? 'AND m."warehouseId" = ANY($2::uuid[])' : ''}
        ORDER BY m.date ASC
        LIMIT 20
        `,
        scope ? [cutoff, scope] : [cutoff],
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
