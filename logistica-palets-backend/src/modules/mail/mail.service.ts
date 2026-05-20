/**
 * MailService — daily digest at 07:00 every day
 *
 * Sends an HTML email with:
 *  • KPI summary (movements, units, pending regularizations, expiring lots)
 *  • Active alerts (if any)
 *  • Top-10 products by current stock
 *
 * Completely optional: set MAIL_ENABLED=true + SMTP_* vars to activate.
 * If MAIL_ENABLED is absent or false the cron fires but returns immediately.
 * If the SMTP send fails, only a warning is logged (no exception propagates).
 *
 * Environment variables:
 *   MAIL_ENABLED          true | false (default false)
 *   SMTP_HOST             mail server host
 *   SMTP_PORT             587 (default) | 465
 *   SMTP_SECURE           false (default) | true — use TLS directly
 *   SMTP_USER             auth user
 *   SMTP_PASS             auth password
 *   MAIL_FROM             "RL Logística <no-reply@example.com>"
 *   MAIL_REPORT_TO        comma-separated list of recipient emails
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { ReportsService } from '../reports/reports.service';
import { AlertsService } from '../alerts/alerts.service';
import type { ActiveAlert } from '../alerts/alerts.service';

/* ── Local types ──────────────────────────────────────────────────────────── */
interface StockRow {
  id: string;
  currentQuantity: number;
  code: string;
  description: string;
}

interface KpiSnapshot {
  movementsInRange: number;
  totalQuantity: number;
  pendingRegularizations: number;
  expiringLots: number;
  expiringCritical: number;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly enabled: boolean;
  private readonly from: string;
  private readonly recipients: string[];
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    config: ConfigService, // constructor-only — no class property needed
    private readonly reports: ReportsService,
    private readonly alerts: AlertsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.enabled = config.get<string>('MAIL_ENABLED') === 'true';
    this.from = config.get<string>('MAIL_FROM') ?? 'RL Logística <no-reply@rllogistica.com>';
    this.recipients = (config.get<string>('MAIL_REPORT_TO') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (this.enabled) {
      const secure = config.get<string>('SMTP_SECURE') === 'true';
      this.transporter = nodemailer.createTransport({
        host: config.get<string>('SMTP_HOST') ?? 'localhost',
        port: Number(config.get<string>('SMTP_PORT') ?? 587),
        secure,
        auth:
          config.get<string>('SMTP_USER')
            ? {
                user: config.get<string>('SMTP_USER'),
                pass: config.get<string>('SMTP_PASS'),
              }
            : undefined,
      });
    }
  }

  /** 07:00 AM every day */
  @Cron('0 7 * * *', { name: 'daily-stock-report' })
  async sendDailyReport(): Promise<void> {
    if (!this.enabled) return;
    if (!this.recipients.length) {
      this.logger.warn('MAIL_REPORT_TO is empty — skipping daily report email');
      return;
    }

    const dateStr = new Date().toLocaleDateString('es-PY', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    try {
      const [kpisRaw, activeAlerts, topStock] = await Promise.all([
        this.reports.kpis({ range: 'today' }),
        this.alerts.getActiveAlerts(),
        this.dataSource.query<StockRow[]>(`
          SELECT s.id,
                 s."currentQuantity",
                 p.code,
                 p.description
          FROM   stocks s
          JOIN   products p ON p.id = s."productId"
          WHERE  s."currentQuantity" > 0
          ORDER  BY s."currentQuantity" DESC
          LIMIT  10
        `),
      ]);

      // Narrow to the fields we use (kpisRaw is fully typed by ReportsService)
      const kpis: KpiSnapshot = {
        movementsInRange: (kpisRaw as KpiSnapshot).movementsInRange ?? 0,
        totalQuantity: (kpisRaw as KpiSnapshot).totalQuantity ?? 0,
        pendingRegularizations: (kpisRaw as KpiSnapshot).pendingRegularizations ?? 0,
        expiringLots: (kpisRaw as KpiSnapshot).expiringLots ?? 0,
        expiringCritical: (kpisRaw as KpiSnapshot).expiringCritical ?? 0,
      };

      const subject = `[RL Logística] Reporte diario — ${dateStr}`;
      const html = this.buildHtml({ dateStr, kpis, activeAlerts, topStock });

      await this.transporter!.sendMail({
        from: this.from,
        to: this.recipients.join(', '),
        subject,
        html,
      });

      this.logger.log(`Daily report sent to ${this.recipients.join(', ')}`);
    } catch (err) {
      // Never crash the app over a failed email
      this.logger.warn(`Daily report email failed: ${(err as Error).message}`);
    }
  }

  /* ── HTML builder ────────────────────────────────────────────────────────── */
  private buildHtml(data: {
    dateStr: string;
    kpis: KpiSnapshot;
    activeAlerts: ActiveAlert[];
    topStock: StockRow[];
  }): string {
    const { dateStr, kpis, activeAlerts, topStock } = data;
    const criticals = activeAlerts.filter((a) => a.severity === 'critical').length;
    const warnings = activeAlerts.filter((a) => a.severity === 'warning').length;

    const PRIMARY = '#2563eb';
    const DANGER = '#dc2626';
    const WARNING = '#d97706';
    const SUCCESS = '#16a34a';
    const BG = '#0f172a';
    const CARD_BG = '#1e293b';
    const BORDER = '#334155';
    const TEXT = '#f1f5f9';
    const MUTED = '#94a3b8';

    const kpiCard = (label: string, value: string | number, accent: string) => `
      <td style="padding:0 6px 12px">
        <div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:10px;padding:14px 18px;min-width:130px;border-top:3px solid ${accent}">
          <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${label}</div>
          <div style="font-size:26px;font-weight:900;color:${TEXT};letter-spacing:-1px;line-height:1">${
            typeof value === 'number' ? value.toLocaleString('es-PY') : value
          }</div>
        </div>
      </td>`;

    const alertRows = activeAlerts
      .slice(0, 8)
      .map((a) => {
        const color = a.severity === 'critical' ? DANGER : WARNING;
        return `
        <tr>
          <td style="padding:7px 12px;border-bottom:1px solid ${BORDER}">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle"></span>
            <span style="font-size:12px;font-weight:700;color:${color}">${a.severity === 'critical' ? 'CRÍTICA' : 'ADVERTENCIA'}</span>
          </td>
          <td style="padding:7px 12px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT}">${a.message}</td>
        </tr>`;
      })
      .join('');

    const stockRows = topStock
      .filter((s) => s.currentQuantity > 0)
      .map(
        (s, i) => `
        <tr style="background:${i % 2 === 0 ? CARD_BG : BG}">
          <td style="padding:7px 12px;font-size:12px;font-weight:700;color:${TEXT};font-family:monospace">${s.code ?? '—'}</td>
          <td style="padding:7px 12px;font-size:12px;color:${MUTED}">${s.description ?? '—'}</td>
          <td style="padding:7px 12px;font-size:12px;font-weight:700;color:${TEXT};text-align:right">${Number(s.currentQuantity).toLocaleString('es-PY')}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte diario RL Logística</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${TEXT}">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:${PRIMARY};border-radius:12px 12px 0 0;padding:20px 28px">
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-.5px">RL Logística</div>
      <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:2px">Reporte diario de inventario</div>
      <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:6px;text-transform:capitalize">${dateStr}</div>
    </div>

    <!-- KPI row -->
    <div style="background:${CARD_BG};border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:20px 22px">
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><tr>
        ${kpiCard('Movimientos hoy', kpis.movementsInRange, PRIMARY)}
        ${kpiCard('Unidades en stock', kpis.totalQuantity, SUCCESS)}
        ${kpiCard('Pend. regularización', kpis.pendingRegularizations, kpis.pendingRegularizations > 0 ? WARNING : SUCCESS)}
        ${kpiCard('Lotes ≤ 60d', kpis.expiringLots, kpis.expiringCritical > 0 ? DANGER : kpis.expiringLots > 0 ? WARNING : SUCCESS)}
      </tr></table>
    </div>

    ${
      activeAlerts.length > 0
        ? `
    <!-- Alerts -->
    <div style="background:${CARD_BG};border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};border-top:1px solid ${criticals > 0 ? DANGER : WARNING};padding:16px 22px;margin-top:1px">
      <div style="font-size:13px;font-weight:700;color:${criticals > 0 ? DANGER : WARNING};margin-bottom:10px">
        ⚠ ${activeAlerts.length} alerta${activeAlerts.length !== 1 ? 's' : ''} activa${activeAlerts.length !== 1 ? 's' : ''}
        ${criticals > 0 ? `<span style="margin-left:8px;font-size:11px;background:rgba(220,38,38,.15);color:${DANGER};padding:2px 8px;border-radius:999px">${criticals} crítica${criticals !== 1 ? 's' : ''}</span>` : ''}
        ${warnings > 0 ? `<span style="margin-left:6px;font-size:11px;background:rgba(217,119,6,.15);color:${WARNING};padding:2px 8px;border-radius:999px">${warnings} advertencia${warnings !== 1 ? 's' : ''}</span>` : ''}
      </div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden">
        ${alertRows}
      </table>
    </div>`
        : `
    <!-- No alerts banner -->
    <div style="background:rgba(22,163,74,.08);border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};border-top:1px solid rgba(22,163,74,.4);padding:12px 22px;margin-top:1px">
      <span style="font-size:13px;color:${SUCCESS};font-weight:600">✓ Sin alertas activas</span>
    </div>`
    }

    ${
      topStock.length > 0
        ? `
    <!-- Stock table -->
    <div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:0 0 12px 12px;padding:16px 22px;margin-top:1px">
      <div style="font-size:13px;font-weight:700;color:${TEXT};margin-bottom:10px">Top materiales por stock</div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:${PRIMARY}">
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.05em">Código</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.05em">Descripción</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.05em">Unidades</th>
          </tr>
        </thead>
        <tbody>${stockRows}</tbody>
      </table>
    </div>`
        : ''
    }

    <!-- Footer -->
    <div style="text-align:center;padding:18px 0;font-size:11px;color:${MUTED}">
      Generado automáticamente por RL Logística · No responder este correo
    </div>
  </div>
</body>
</html>`;
  }
}
